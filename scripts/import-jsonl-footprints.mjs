#!/usr/bin/env node
/**
 * One-off: imports footprints written before the move to the database.
 *
 *   node --env-file=.env scripts/import-jsonl-footprints.mjs data/footprints/*.jsonl
 *
 * Safe to run twice — `eventId` is unique and duplicates are skipped. The row
 * mapping is a deliberate copy of `src/telemetry/store.ts` rather than an
 * import of it: this script outlives neither the files it reads nor the shape
 * they were written in, and tying it to live code would mean breaking it the
 * next time that shape changes.
 */
import { readFile } from "node:fs/promises";
import { prisma } from "./db.mjs";

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

const files = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const dryRun = process.argv.includes("--dry-run");

if (files.length === 0) {
  console.error("Usage: node --env-file=.env scripts/import-jsonl-footprints.mjs <file.jsonl>...");
  process.exit(1);
}

let read = 0;
let skipped = 0;
const rows = [];

for (const file of files) {
  const body = await readFile(file, "utf8");
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    read += 1;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }

    // A line missing the envelope is not a footprint; it is something else
    // that ended up in the file.
    if (!event?.id || !event.type || !event.sessionKey || !event.receivedAt) {
      skipped += 1;
      continue;
    }

    const payload = {};
    for (const [key, value] of Object.entries(event)) {
      if (!ENVELOPE_KEYS.has(key)) payload[key] = value;
    }

    rows.push({
      v: event.v ?? 1,
      eventId: event.id,
      seq: event.seq ?? 0,
      sessionKey: event.sessionKey,
      avatarSessionId:
        event.type === "session_started" && typeof event.avatarSessionId === "string"
          ? event.avatarSessionId
          : null,
      type: event.type,
      payload,
      clientTs: new Date(event.clientTs ?? event.receivedAt),
      receivedAt: new Date(event.receivedAt),
      embedKeyValue: event.embedKey ?? "unknown",
      parentOrigin: event.parentOrigin ?? "",
      ipHash: event.ipHash ?? "",
      userAgent: event.userAgent ?? "",
    });
  }
}

if (dryRun) {
  console.log(`Would import ${rows.length} of ${read} line(s); ${skipped} unreadable.`);
  await prisma.$disconnect();
  process.exit(0);
}

// The keys these events reference may no longer exist. `embedKeyValue` is a
// recorded value rather than a foreign key, so the rows stand on their own.
const { count } = await prisma.footprint.createMany({ data: rows, skipDuplicates: true });

console.log(
  `Imported ${count} event(s) from ${read} line(s).` +
    (count < rows.length ? ` ${rows.length - count} already present.` : "") +
    (skipped > 0 ? ` ${skipped} unreadable line(s) skipped.` : ""),
);

await prisma.$disconnect();
