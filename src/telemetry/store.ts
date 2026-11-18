import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { FootprintSink } from "./sink";
import type { StoredFootprint } from "./schema";

/**
 * Footprints, in the database.
 *
 * The envelope is columns — the fields every event has and that anything will
 * want to filter or sort by — and the event's own fields are JSON. Giving each
 * event type its own columns would mean a migration every time we record
 * something new, for data nothing joins against.
 */

/** Envelope fields, kept out of the JSON payload so they are not stored twice. */
const ENVELOPE_KEYS = new Set([
  "v",
  "id",
  "seq",
  "sessionKey",
  "clientTs",
  "type",
  "receivedAt",
  "embedKey",
  "parentOrigin",
  "ipHash",
  "userAgent",
]);

function toRow(record: StoredFootprint): Prisma.FootprintCreateManyInput {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!ENVELOPE_KEYS.has(key)) payload[key] = value;
  }

  const avatarSessionId =
    record.type === "session_started" && typeof record.avatarSessionId === "string"
      ? record.avatarSessionId
      : null;

  return {
    v: record.v,
    eventId: record.id,
    seq: record.seq,
    sessionKey: record.sessionKey,
    avatarSessionId,
    type: record.type,
    payload: payload as Prisma.InputJsonValue,
    clientTs: new Date(record.clientTs),
    receivedAt: new Date(record.receivedAt),
    embedKeyValue: record.embedKey,
    parentOrigin: record.parentOrigin,
    ipHash: record.ipHash,
    userAgent: record.userAgent,
  };
}

export function createDatabaseSink(): FootprintSink {
  return {
    async write(records) {
      if (records.length === 0) return;
      try {
        await prisma.footprint.createMany({
          data: records.map(toRow),
          // A beacon can be delivered twice; `eventId` is unique, so a replay
          // is a no-op rather than a duplicate row or a failed batch.
          skipDuplicates: true,
        });
      } catch (error) {
        // Telemetry must never become the caller's problem.
        console.error("[footprints] write failed:", error);
      }
    },
    async close() {},
  };
}

let shared: FootprintSink | null = null;

export function getFootprintSink(): FootprintSink {
  shared ??= createDatabaseSink();
  return shared;
}

/** Test helper: forget the shared sink. */
export function resetFootprintSink(): void {
  shared = null;
}
