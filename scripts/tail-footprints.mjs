#!/usr/bin/env node
/**
 * Prints recent footprints in a readable form.
 *
 *   pnpm footprints:tail
 *   pnpm footprints:tail -- --session <key> --limit 200
 *   pnpm footprints:tail -- --embed-key pk_dre_... --since 2026-03-04
 */
import { prisma } from "./db.mjs";

const args = process.argv.slice(2);

function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}

const limit = Number(flag("limit", 100));
const sessionKey = flag("session", null);
const embedKeyValue = flag("embed-key", null);
const since = flag("since", null);

const where = {
  ...(sessionKey ? { sessionKey } : {}),
  ...(embedKeyValue ? { embedKeyValue } : {}),
  ...(since ? { receivedAt: { gte: new Date(since) } } : {}),
};

const events = await prisma.footprint.findMany({
  where,
  orderBy: [{ receivedAt: "desc" }, { seq: "desc" }],
  take: Number.isFinite(limit) && limit > 0 ? limit : 100,
});

// Newest first from the database, oldest first on screen: a conversation
// reads downwards.
for (const event of events.reverse()) {
  const time = event.receivedAt.toISOString().slice(11, 19);
  const session = event.sessionKey.slice(0, 8);
  const payload = event.payload ?? {};

  const detail =
    event.type === "transcript_turn"
      ? `${payload.sender}: ${payload.text || `<${payload.charCount} chars, text off>`}`
      : Object.entries(payload)
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join(" ");

  console.log(`${time}  ${session}  ${event.type.padEnd(26)} ${detail}`);
}

console.log(`\n${events.length} event(s).`);
await prisma.$disconnect();
