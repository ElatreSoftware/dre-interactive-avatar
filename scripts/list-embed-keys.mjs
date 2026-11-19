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
 *   pnpm embed:keys -- --key pk_dre_... --add-origin https://new.example
 *   pnpm embed:keys -- --key pk_dre_... --remove-origin https://old.example
 *   pnpm embed:keys -- --key pk_dre_... --free-lines
 */
import { isValidOriginPattern } from "../src/embed/originMatch.ts";
import { prisma } from "./db.mjs";

const args = process.argv.slice(2);

function flag(name) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? null : args[index + 1];
}

function flags(name) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === `--${name}` && args[i + 1]) values.push(args[i + 1]);
  }
  return values;
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

  if (args.includes("--free-lines")) {
    // For the call where a customer says every line is busy and nobody is on
    // one. A crashed browser cannot tell us it is gone, and until the quiet
    // window passes its row still holds a line.
    const { count } = await prisma.activeSession.updateMany({
      where: { embedKeyValue: target, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    console.log(
      count === 0
        ? `No lines were held by ${target}.`
        : `Freed ${count} line(s) held by ${target}. Any call still running will be cut off.`,
    );
  }

  const added = flags("add-origin");
  const removed = flags("remove-origin");

  if (added.length > 0 || removed.length > 0) {
    for (const origin of [...added, ...removed]) {
      if (isValidOriginPattern(origin)) continue;
      console.error(
        `✗ "${origin}" is not a usable origin.\n` +
          '  Expected scheme://host[:port], with at most one leading "*." label.\n' +
          "  Note http://localhost:5500 and http://127.0.0.1:5500 are different origins.",
      );
      await prisma.$disconnect();
      process.exit(1);
    }

    const current = await prisma.embedKey.findUnique({
      where: { key: target },
      select: { allowedOrigins: true },
    });
    if (!current) {
      console.error(`✗ No key "${target}".`);
      await prisma.$disconnect();
      process.exit(1);
    }

    const next = current.allowedOrigins
      .filter((origin) => !removed.includes(origin))
      .concat(added.filter((origin) => !current.allowedOrigins.includes(origin)));

    if (next.length === 0) {
      console.error("✗ That would leave the key with no origins, so nothing could embed it.");
      await prisma.$disconnect();
      process.exit(1);
    }
    data.allowedOrigins = next;
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
      // Only calls still running; closed rows stay as history.
      prisma.activeSession.count({ where: { embedKeyValue: key.key, deletedAt: null } }),
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
