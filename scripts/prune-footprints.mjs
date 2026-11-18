#!/usr/bin/env node
/**
 * Deletes footprints past the retention window, now.
 *
 * The service already does this on its own as events arrive — this is for
 * catching up after a quiet spell, or for shortening retention and wanting it
 * to take effect immediately.
 *
 *   pnpm footprints:prune
 *   pnpm footprints:prune -- --days 30 --dry-run
 */
import { prisma } from "./db.mjs";

const args = process.argv.slice(2);

function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}

const dryRun = args.includes("--dry-run");
const days = Number(flag("days", process.env.FOOTPRINTS_RETENTION_DAYS ?? 90));

if (!Number.isFinite(days) || days < 1) {
  console.error(`Retention must be a positive number of days; got "${days}".`);
  process.exit(1);
}

const cutoff = new Date(Date.now() - days * 86_400_000);
const where = { receivedAt: { lt: cutoff } };

if (dryRun) {
  const count = await prisma.footprint.count({ where });
  console.log(`Would delete ${count} event(s) older than ${cutoff.toISOString().slice(0, 10)}.`);
} else {
  const { count } = await prisma.footprint.deleteMany({ where });
  console.log(`Deleted ${count} event(s) older than ${cutoff.toISOString().slice(0, 10)}.`);
}

await prisma.$disconnect();
