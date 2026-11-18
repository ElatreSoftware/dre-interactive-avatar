#!/usr/bin/env node
/**
 * Writes sandbox/index.html against a key that actually exists.
 *
 *   pnpm sandbox
 *   pnpm sandbox -- --key pk_dre_... --host http://localhost:3150
 *
 * Generated rather than hand-written because a test page with a stale key
 * fails as `frame-ancestors 'none'` and a 404 — which reads like the
 * allowlist rejecting you, not like the key having been deleted. Regenerating
 * is cheaper than diagnosing that twice.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { prisma } from "./db.mjs";

const args = process.argv.slice(2);

function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}

const host = flag("host", "http://localhost:3000");
const wanted = flag("key", null);

const record = wanted
  ? await prisma.embedKey.findUnique({ where: { key: wanted } })
  : await prisma.embedKey.findFirst({ where: { enabled: true }, orderBy: { createdAt: "asc" } });

if (!record) {
  console.error(
    wanted ? `✗ No key "${wanted}".` : "✗ No enabled embed keys. Add one with `pnpm embed:key`.",
  );
  await prisma.$disconnect();
  process.exit(1);
}

const origins = record.allowedOrigins.map((origin) => `      <li><code>${origin}</code></li>`).join("\n");

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${record.name} — test page</title>
    <style>
      body { font: 16px/1.6 system-ui, sans-serif; margin: 0; padding: 48px; max-width: 54ch; }
      code { background: #eee; padding: 2px 5px; border-radius: 4px; font-size: 0.9em; }
      li { margin: 0.4em 0; }
      .meta { color: #555; font-size: 0.9em; }
    </style>
  </head>
  <body>
    <h1>${record.name} — test page</h1>
    <p>
      Everything on this page is the page. The widget in the corner is mounted
      by the single script tag at the bottom of the source.
    </p>
    <ul>
      <li>Click the corner button — it asks for the microphone first.</li>
      <li>Allow it, and the call stage animates out of the corner.</li>
      <li>Talk over the avatar to interrupt it.</li>
    </ul>

    <p class="meta">Widget host: <code>${host}</code><br />Key: <code>${record.key}</code></p>
    <p class="meta">Serve this page from one of:</p>
    <ul class="meta">
${origins}
    </ul>
    <p class="meta">
      Any other origin is blocked by the browser, which is the allowlist
      working. Regenerate this file with <code>pnpm sandbox</code> after
      changing keys.
    </p>

    <script
      src="${host}/embed.js"
      data-embed-key="${record.key}"
      data-user-id="sandbox-tester"
      async
    ></script>
  </body>
</html>
`;

await mkdir("sandbox", { recursive: true });
await writeFile("sandbox/index.html", page, "utf8");
await prisma.$disconnect();

console.log(`✓ sandbox/index.html — key ${record.key} (${record.name}), host ${host}`);
console.log(`  Serve it from one of: ${record.allowedOrigins.join(", ")}`);
