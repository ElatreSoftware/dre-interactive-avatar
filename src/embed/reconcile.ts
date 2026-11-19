import { prisma } from "@/lib/db";
import { fetchVendorSessionState } from "./vendorSession";

/**
 * Closes open call records against LiveAvatar's own record of them.
 *
 * This is the piece that makes a concurrent-session limit mean something.
 * Everything else that frees a line is a guess made from our side: the
 * browser reporting its own ending (which a crashed tab never does), or the
 * quiet sweep (which is a timeout wearing a confident expression). The vendor
 * is the only party that actually knows, and `GET /v1/sessions/{id}` is how
 * it is asked — LiveAvatar publishes no webhooks to be told by.
 *
 * It runs from the request path, like retention: nothing to schedule, and so
 * nothing to forget to schedule.
 */

/**
 * A session minted a moment ago may not be startable-and-started yet, so the
 * vendor can legitimately not know it. Below this age its answer is ignored.
 */
const GRACE_MS = 2 * 60 * 1000;

/**
 * How many rows one run will ask about.
 *
 * The vendor allows ~10 requests a second and this asks one at a time, so
 * even the cron ceiling stays far under it. The mint path uses the smaller
 * default, because there it is latency a visitor waits through.
 */
const MAX_PER_SWEEP = 25;
const MAX_PER_CRON = 200;

function graceMs(): number {
  const configured = Number(process.env.SESSION_RECONCILE_GRACE_SECONDS);
  return Number.isFinite(configured) && configured >= 0 ? configured * 1000 : GRACE_MS;
}

export interface ReconcileSummary {
  checked: number;
  closed: number;
}

/**
 * Asks about every open call old enough to have registered, and closes the
 * ones the vendor says are over.
 *
 * Deliberately sequential: a burst of parallel requests is how a polite
 * reconciler becomes a rate-limit incident. There are only ever as many open
 * rows as there are live calls.
 */
export interface ReconcileOptions {
  /**
   * Narrows the sweep to one customer. Passed on the session-mint path, where
   * the only rows that can wrongly refuse this caller are their own, and
   * where every extra vendor round trip is latency the visitor waits through.
   */
  embedKeyValue?: string;
  /** How many rows to ask about at most. */
  limit?: number;
}

export async function reconcileSessions(
  now: number = Date.now(),
  { embedKeyValue, limit = MAX_PER_SWEEP }: ReconcileOptions = {},
): Promise<ReconcileSummary> {
  const open = await prisma.activeSession.findMany({
    where: {
      deletedAt: null,
      startedAt: { lt: new Date(now - graceMs()) },
      ...(embedKeyValue ? { embedKeyValue } : {}),
    },
    orderBy: { startedAt: "asc" },
    take: Math.min(Math.max(limit, 1), MAX_PER_CRON),
  });

  let closed = 0;
  for (const row of open) {
    const state = await fetchVendorSessionState(row.avatarSessionId);
    // "live" keeps the line. "unknown" changes nothing at all: an unreachable
    // vendor must never be read as a room full of finished calls.
    if (state.state !== "ended" && state.state !== "gone") continue;

    const result = await prisma.activeSession.updateMany({
      where: { avatarSessionId: row.avatarSessionId, deletedAt: null },
      data:
        state.state === "ended"
          ? { deletedAt: state.endedAt, endReason: state.reason }
          : { deletedAt: new Date(now), endReason: "VENDOR_UNKNOWN_SESSION" },
    });
    closed += result.count;
  }

  if (closed > 0) {
    console.warn(`[embed] reconciled ${closed} finished call(s) with LiveAvatar`);
  }
  return { checked: open.length, closed };
}

/** The ceiling one cron run will work through. */
export { MAX_PER_CRON };
