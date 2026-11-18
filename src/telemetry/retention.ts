import { prisma } from "@/lib/db";

/**
 * Retention, enforced by the service itself.
 *
 * There is no cron job and nothing to install: the sweep runs from the ingest
 * path, at most once an hour per process. A retention policy that depends on
 * someone remembering to schedule a job is a policy that silently lapses, and
 * the lapse looks exactly like everything working.
 */

export const DEFAULT_RETENTION_DAYS = 90;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

let lastSweep = 0;
let sweeping = false;

export function retentionDays(): number {
  const configured = Number(process.env.FOOTPRINTS_RETENTION_DAYS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RETENTION_DAYS;
}

export function retentionCutoff(now: number = Date.now()): Date {
  return new Date(now - retentionDays() * 24 * 60 * 60 * 1000);
}

/**
 * Deletes everything past the window. Returns how many rows went.
 *
 * Closed call records go the same way and on the same clock: they are the
 * same kind of thing — a record of a call that happened — and a table that
 * only ever grows is a slow outage.
 */
export async function pruneFootprints(now: number = Date.now()): Promise<number> {
  const cutoff = retentionCutoff(now);

  const [events, sessions] = await Promise.all([
    prisma.footprint.deleteMany({ where: { receivedAt: { lt: cutoff } } }),
    prisma.activeSession.deleteMany({
      // Only closed ones: a long call still running is not expired.
      where: { deletedAt: { not: null, lt: cutoff } },
    }),
  ]);

  const count = events.count + sessions.count;
  // Warn, not info: a retention delete is worth seeing in production logs.
  if (count > 0) {
    console.warn(
      `[footprints] retention removed ${events.count} event(s) and ${sessions.count} closed call(s)`,
    );
  }
  return count;
}

/**
 * Prunes if it has not been done recently.
 *
 * Deliberately not awaited by the caller: ingest answers the browser and lets
 * this run behind it, so a slow delete never becomes a slow page.
 */
export function sweepIfDue(now: number = Date.now()): void {
  if (sweeping || now - lastSweep < SWEEP_INTERVAL_MS) return;
  sweeping = true;
  lastSweep = now;

  void pruneFootprints(now)
    .catch((error) => {
      console.error("[footprints] retention sweep failed:", error);
      // Let the next request try again rather than waiting a full hour.
      lastSweep = 0;
    })
    .finally(() => {
      sweeping = false;
    });
}

/** Test helper: forget when the last sweep ran. */
export function resetSweepState(): void {
  lastSweep = 0;
  sweeping = false;
}
