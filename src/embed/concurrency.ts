import { prisma } from "@/lib/db";
import type { EmbedKeyRecord } from "./registry";

/**
 * How many calls a customer may have running at once.
 *
 * Tracked in a table written when a session is minted, not derived from
 * footprints: a spend control must not depend on telemetry being switched on,
 * or on a browser having flushed its last batch.
 *
 * The hard part is knowing when a call ended. A browser that crashes, loses
 * power or is force-quit never tells us, so a slot is released three ways:
 * the end of the call reports it, nothing is heard from it for ten minutes,
 * or it is simply too old to still be a call.
 *
 * Rows are closed rather than deleted. Setting `deletedAt` is what frees the
 * line; the row stays, so a finished call can still be looked at — when it
 * started, when it ended, and whether it ended or merely went quiet. Closed
 * rows are cleared out by the same retention sweep as footprints.
 */

/** A session nothing has been heard from for this long is assumed dead. */
const STALE_AFTER_MS = 10 * 60 * 1000;

/**
 * No call holds a line longer than this, whatever it claims.
 *
 * The quiet check above trusts a stream of events: as long as something keeps
 * arriving, the row stays open. That is right for a real call and wrong for
 * anything stuck — a page left open in a background tab, a loop that keeps
 * reporting, a bug. Vendor sessions have their own maximum duration well
 * under an hour, so a row older than this is not a call any more, whatever
 * its last event said.
 */
const MAX_AGE_MS = 60 * 60 * 1000;

function maxAgeMs(): number {
  const configured = Number(process.env.SESSION_MAX_AGE_MINUTES);
  return Number.isFinite(configured) && configured > 0 ? configured * 60_000 : MAX_AGE_MS;
}

export type ClaimResult = { ok: true } | { ok: false; active: number; limit: number };

function staleBefore(now: number): Date {
  return new Date(now - STALE_AFTER_MS);
}

function startedBefore(now: number): Date {
  return new Date(now - maxAgeMs());
}

/**
 * Counts live calls for a key, after closing ones that have gone quiet.
 *
 * The sweep is part of counting rather than a scheduled job: the only moment
 * the number matters is the moment someone asks for a new session.
 */
export async function countActiveSessions(
  embedKeyValue: string,
  now: number = Date.now(),
): Promise<number> {
  await prisma.activeSession.updateMany({
    where: {
      embedKeyValue,
      deletedAt: null,
      OR: [
        // Nothing heard from it lately.
        { lastSeenAt: { lt: staleBefore(now) } },
        // Or old enough that it cannot still be a call, however chatty it is.
        { startedAt: { lt: startedBefore(now) } },
      ],
    },
    data: { deletedAt: new Date(now) },
  });
  return prisma.activeSession.count({ where: { embedKeyValue, deletedAt: null } });
}

/**
 * Whether another call may start. Checked *before* minting, because the
 * vendor charges for the session whether or not we then refuse it.
 */
export async function checkConcurrency(
  record: EmbedKeyRecord,
  now: number = Date.now(),
): Promise<ClaimResult> {
  const limit = record.maxConcurrentSessions;
  if (limit === null || limit <= 0) return { ok: true };

  const active = await countActiveSessions(record.key, now);
  if (active >= limit) return { ok: false, active, limit };
  return { ok: true };
}

/** Records a minted session as live. Never throws: the call already exists. */
export async function claimSession(
  embedKeyValue: string,
  avatarSessionId: string,
): Promise<void> {
  try {
    await prisma.activeSession.upsert({
      where: { avatarSessionId },
      // A vendor session id is unique to one call, so this only ever updates
      // when the same mint is retried.
      update: { lastSeenAt: new Date(), deletedAt: null },
      create: { avatarSessionId, embedKeyValue },
    });
  } catch (error) {
    // Losing a slot record costs a customer one concurrent call until the
    // stale sweep; failing the request would cost them the call itself.
    console.error("[embed] could not record an active session:", error);
  }
}

/** Ties our widget session id to a minted session, so its end can release it. */
export async function linkSession(
  avatarSessionId: string,
  sessionKey: string,
): Promise<void> {
  try {
    await prisma.activeSession.updateMany({
      where: { avatarSessionId, deletedAt: null },
      data: { sessionKey, lastSeenAt: new Date() },
    });
  } catch (error) {
    console.error("[embed] could not link an active session:", error);
  }
}

/** Marks a call as still alive. A closed call is not revived. */
export async function touchSession(sessionKey: string): Promise<void> {
  try {
    await prisma.activeSession.updateMany({
      where: { sessionKey, deletedAt: null },
      data: { lastSeenAt: new Date() },
    });
  } catch (error) {
    console.error("[embed] could not refresh an active session:", error);
  }
}

/** Frees the line, keeping the record of the call. */
export async function releaseSession(sessionKey: string): Promise<void> {
  try {
    await prisma.activeSession.updateMany({
      where: { sessionKey, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  } catch (error) {
    console.error("[embed] could not release an active session:", error);
  }
}
