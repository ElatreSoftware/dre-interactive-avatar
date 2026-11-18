#!/usr/bin/env node
/**
 * Checks that the service is configured the way the docs claim.
 *
 *   pnpm footprints:check
 *
 * Exits non-zero on a real problem, so it belongs in a deploy pipeline.
 */
import { prisma } from "./db.mjs";

const problems = [];
const notes = [];

function fail(message, fix) {
  problems.push({ message, fix });
}

const production = process.env.NODE_ENV === "production";

if (!process.env.EMBED_GRANT_SECRET) {
  const message = "EMBED_GRANT_SECRET is not set.";
  const fix = "openssl rand -hex 32   # then put it in .env";
  if (production) fail(message, fix);
  else notes.push(`${message} A random one is generated per process while developing.`);
} else if (process.env.EMBED_GRANT_SECRET.length < 32) {
  fail("EMBED_GRANT_SECRET is shorter than 32 characters.", "openssl rand -hex 32");
}

if (process.env.FOOTPRINTS_ENABLED === "false") {
  notes.push("Footprints are disabled (FOOTPRINTS_ENABLED=false).");
}

if (!process.env.IP_HASH_SALT) {
  fail(
    "IP_HASH_SALT is not set, so visitor IPs are hashed unsalted — which is reversible.",
    "openssl rand -hex 16   # then put it in .env",
  );
}

const days = Number(process.env.FOOTPRINTS_RETENTION_DAYS ?? 90);
if (!Number.isFinite(days) || days < 1) {
  fail(
    `FOOTPRINTS_RETENTION_DAYS is "${process.env.FOOTPRINTS_RETENTION_DAYS}".`,
    "Set a positive number of days.",
  );
}

try {
  const [keys, enabled, events] = await Promise.all([
    prisma.embedKey.count(),
    prisma.embedKey.count({ where: { enabled: true } }),
    prisma.footprint.count(),
  ]);

  notes.push(`${enabled} enabled embed key(s) of ${keys}; ${events} footprint event(s) stored.`);

  if (keys === 0) notes.push("No embed keys yet — add one with `pnpm embed:key`.");

  // An expiry that passes unnoticed looks exactly like a broken widget to the
  // customer, so it is worth a week's warning.
  const soon = new Date(Date.now() + 7 * 86_400_000);
  const expiring = await prisma.embedKey.findMany({
    where: { enabled: true, expiresAt: { not: null, lt: soon } },
    select: { key: true, name: true, expiresAt: true },
  });
  for (const key of expiring) {
    const when = key.expiresAt.toISOString().slice(0, 10);
    const gone = key.expiresAt.getTime() <= Date.now();
    notes.push(`${key.name} (${key.key}) ${gone ? "expired" : "expires"} ${when}.`);
  }

  const live = await prisma.activeSession.count({ where: { deletedAt: null } });
  if (live > 0) notes.push(`${live} call(s) currently counted as live.`);

  // Retention runs from the ingest path, so a backlog means either nothing is
  // arriving or the sweep is failing. Either is worth knowing about.
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const stale = await prisma.footprint.count({ where: { receivedAt: { lt: cutoff } } });

  if (stale > 0) {
    const oldest = await prisma.footprint.findFirst({
      orderBy: { receivedAt: "asc" },
      select: { receivedAt: true },
    });
    fail(
      `${stale} event(s) are older than the ${days}-day window (oldest ${oldest?.receivedAt.toISOString().slice(0, 10)}).`,
      "Retention sweeps when events arrive. If none are, run `pnpm footprints:prune` once.",
    );
  } else {
    notes.push(`Nothing older than the ${days}-day retention window.`);
  }
} catch (error) {
  fail(`Cannot reach the database: ${error.message}`, "Start it with `pnpm db:up`.");
}

if (process.env.FOOTPRINT_TRANSCRIPTS !== "false") {
  notes.push(
    "Transcripts are being stored. Each embedding customer needs that in their own privacy notice.",
  );
}

for (const note of notes) console.log(`  ${note}`);

await prisma.$disconnect();

if (problems.length === 0) {
  console.log("\nLooks correctly configured.");
  process.exit(0);
}

console.error(`\n${problems.length} problem(s):\n`);
for (const { message, fix } of problems) {
  console.error(`  ✗ ${message}`);
  console.error(`    ${fix}\n`);
}
process.exit(1);
