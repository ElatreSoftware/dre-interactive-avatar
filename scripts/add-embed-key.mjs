#!/usr/bin/env node
/**
 * Adds a customer to the embed key registry.
 *
 *   pnpm embed:key -- \
 *     --name "Acme Corp" \
 *     --origin https://acme.example \
 *     --origin "https://*.acme.example" \
 *     --var brand=Acme \
 *     --expires 2027-01-01 \
 *     --max-concurrent 5
 *
 * Writes to the database, which the running service re-reads within thirty
 * seconds. No restart, no file to deploy.
 *
 * `--key` reuses an existing key value instead of generating one. That is for
 * moving a customer between environments — staging to production, a local
 * database to a managed one — so their embed keeps working untouched. Do not
 * use it to invent a memorable key: these are public, and a guessable one is
 * one fewer thing an attacker has to find.
 *
 * Origins are validated with the application's own matcher — imported, not
 * reimplemented, so the script and the server can never disagree about what
 * `https://*.acme.example` means.
 */
import { randomBytes } from "node:crypto";
import { isValidOriginPattern } from "../src/embed/originMatch.ts";
import { prisma } from "./db.mjs";

const args = process.argv.slice(2);

function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}

function flags(name) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === `--${name}` && args[i + 1]) values.push(args[i + 1]);
  }
  return values;
}

function die(message, hint) {
  console.error(`✗ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

const name = flag("name");
const origins = flags("origin");
const avatarId = flag("avatar", process.env.NEXT_PUBLIC_AVATAR_ID);
const dryRun = args.includes("--dry-run");

const expiresRaw = flag("expires", null);
let expiresAt = null;
if (expiresRaw) {
  expiresAt = new Date(expiresRaw);
  if (Number.isNaN(expiresAt.getTime())) {
    die(`--expires is not a date I can read: "${expiresRaw}".`, "Try 2027-01-31, or an ISO timestamp.");
  }
  if (expiresAt.getTime() <= Date.now()) {
    die(`--expires is in the past (${expiresAt.toISOString()}).`, "The key would never work.");
  }
}

const concurrentRaw = flag("max-concurrent", null);
let maxConcurrentSessions = null;
if (concurrentRaw !== null) {
  maxConcurrentSessions = Number(concurrentRaw);
  if (!Number.isInteger(maxConcurrentSessions) || maxConcurrentSessions < 1) {
    die(`--max-concurrent must be a whole number of 1 or more; got "${concurrentRaw}".`);
  }
}

if (!name) die("Missing --name.", 'pnpm embed:key -- --name "Acme Corp" --origin https://acme.example');
if (origins.length === 0) {
  die(
    "Missing --origin.",
    "At least one, and every origin the customer will embed from: production, staging, previews.",
  );
}
if (!avatarId) die("Missing --avatar and no NEXT_PUBLIC_AVATAR_ID to fall back to.");

for (const origin of origins) {
  if (isValidOriginPattern(origin)) continue;
  die(
    `"${origin}" is not a usable origin.`,
    'Expected scheme://host[:port], with at most one leading "*." label — for example https://*.acme.example',
  );
}

const dynamicVariables = {};
for (const pair of flags("var")) {
  const separator = pair.indexOf("=");
  if (separator < 1) die(`--var expects key=value; got "${pair}".`);
  dynamicVariables[pair.slice(0, separator)] = pair.slice(separator + 1);
}

const existing = await prisma.embedKey.findFirst({ where: { name } });
if (existing) {
  die(
    `There is already a key named "${name}" (${existing.key}).`,
    "Edit its allowed origins instead of issuing a second key, or pick a different name.",
  );
}

const reusedKey = flag("key", null);
if (reusedKey !== null && !/^[A-Za-z0-9_-]{12,}$/.test(reusedKey)) {
  die(
    `--key must be at least 12 URL-safe characters; got "${reusedKey}".`,
    "Omit it entirely to have one generated.",
  );
}
if (reusedKey && (await prisma.embedKey.findUnique({ where: { key: reusedKey } }))) {
  die(`The key "${reusedKey}" already exists here.`, "Change it with `pnpm embed:keys`.");
}

// Public by design — it ships in the customer's page source. It identifies;
// the origin allowlist is what authorises.
const key = reusedKey ?? `pk_dre_${randomBytes(6).toString("hex")}`;

const data = {
  key,
  name,
  avatarId,
  allowedOrigins: origins,
  ...(Object.keys(dynamicVariables).length > 0 ? { dynamicVariables } : {}),
  ...(expiresAt ? { expiresAt } : {}),
  ...(maxConcurrentSessions !== null ? { maxConcurrentSessions } : {}),
};

if (dryRun) {
  console.log("\nWould create:\n");
  console.log(JSON.stringify(data, null, 2));
  await prisma.$disconnect();
  process.exit(0);
}

await prisma.embedKey.create({ data });
await prisma.$disconnect();

console.log(`\n✓ Added "${name}"\n`);
console.log("  Give them this, and nothing else:\n");
console.log(`    <script src="https://YOUR-WIDGET-HOST/embed.js" data-embed-key="${key}" async></script>\n`);
console.log("  They can embed from:");
for (const origin of origins) console.log(`    ${origin}`);
if (expiresAt) console.log(`\n  Expires: ${expiresAt.toISOString()}`);
console.log(
  `  Concurrent calls: ${maxConcurrentSessions === null ? "unlimited" : maxConcurrentSessions}`,
);
console.log(
  "\n  Live within thirty seconds — the service re-reads keys on its own.\n" +
    '  Remind them the page must be HTTPS, and that embed.js sets allow="microphone" for them.',
);
