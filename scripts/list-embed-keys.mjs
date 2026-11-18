#!/usr/bin/env node
/**
 * Lists the embed keys, and lets one be turned off.
 *
 *   pnpm embed:keys
 *   pnpm embed:keys -- --disable pk_dre_...
 *   pnpm embed:keys -- --enable pk_dre_...
 *   pnpm embed:keys -- --key pk_dre_... --expires 2027-01-01
 *   pnpm embed:keys -- --key pk_dre_... --expires never
 *   pnpm embed:keys -- --key pk_dre_... --max-concurrent 5     (0 = unlimited)
 */
import { prisma } from "./db.mjs";

const args = process.argv.slice(2);

function flag(name) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? null : args[index + 1];
}

for (const [name, enabled] of [
  ["disable", false],
  ["enable", true],
]) {
  const key = flag(name);
  if (!key) continue;

  const updated = await prisma.embedKey.updateMany({ where: { key }, data: { enabled } });
  if (updated.count === 0) {
    console.error(`✗ No key "${key}".`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`${enabled ? "Enabled" : "Disabled"} ${key}. Live within thirty seconds.`);
}

const target = flag("key");
if (target) {
  const data = {};

  const expires = flag("expires");
  if (expires) {
    if (expires === "never") data.expiresAt = null;
    else {
      const when = new Date(expires);
      if (Number.isNaN(when.getTime())) {
        console.error(`✗ --expires is not a date I can read: "${expires}".`);
        await prisma.$disconnect();
        process.exit(1);
      }
      data.expiresAt = when;
    }
  }

  const concurrent = flag("max-concurrent");
  if (concurrent !== null) {
    const limit = Number(concurrent);
    if (!Number.isInteger(limit) || limit < 0) {
      console.error(`✗ --max-concurrent must be 0 or more; got "${concurrent}".`);
      await prisma.$disconnect();
      process.exit(1);
    }
    data.maxConcurrentSessions = limit === 0 ? null : limit;
  }

  if (Object.keys(data).length > 0) {
    const updated = await prisma.embedKey.updateMany({ where: { key: target }, data });
    if (updated.count === 0) {
      console.error(`✗ No key "${target}".`);
      await prisma.$disconnect();
      process.exit(1);
    }
    console.log(`Updated ${target}. Live within thirty seconds.`);
  }
}

const keys = await prisma.embedKey.findMany({ orderBy: { createdAt: "asc" } });

if (keys.length === 0) {
  console.log("No embed keys yet. Add one with `pnpm embed:key`.");
} else {
  for (const key of keys) {
    const [sessions, live] = await Promise.all([
      prisma.footprint.count({ where: { embedKeyValue: key.key, type: "session_started" } }),
      prisma.activeSession.count({ where: { embedKeyValue: key.key } }),
    ]);

    const expired = key.expiresAt !== null && key.expiresAt.getTime() <= Date.now();
    const expiry =
      key.expiresAt === null
        ? "never"
        : `${key.expiresAt.toISOString().slice(0, 10)}${expired ? " (expired)" : ""}`;
    const limit = key.maxConcurrentSessions ?? "unlimited";

    console.log(
      `${key.enabled && !expired ? "●" : "○"} ${key.key}  ${key.name}` +
        `\n    origins:  ${key.allowedOrigins.join(", ")}` +
        `\n    avatar:   ${key.avatarId}` +
        `\n    expires:  ${expiry}` +
        `\n    at once:  ${live} live, limit ${limit}` +
        `\n    sessions: ${sessions}\n`,
    );
  }
}

await prisma.$disconnect();
