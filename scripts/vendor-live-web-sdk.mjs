#!/usr/bin/env node
/**
 * One-off: produce packages/live-web-sdk from the upstream MIT-licensed SDK.
 *
 *   node scripts/vendor-live-web-sdk.mjs <path-to-upstream-package>
 *
 * Ships only the entry bundles and type declarations. Source maps, tests and
 * per-module JS are dropped because they embed the original sources.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const src = process.argv[2];
if (!src || !existsSync(join(src, "lib/index.esm.js"))) {
  console.error("Usage: node scripts/vendor-live-web-sdk.mjs <path-to-upstream-package>");
  process.exit(1);
}
const out = new URL("../packages/live-web-sdk/", import.meta.url).pathname;

const ID = Buffer.from("heygen").toString("base64");
const PREFIX = Buffer.from("liveavatar-agent-").toString("base64");

// Order matters: specific identifiers before the generic word replacements.
const replacements = [
  [/const API_URL = "https:\/\/api\.liveavatar\.com";/g, 'const API_URL = "";'],
  [/const HEYGEN_PARTICIPANT_ID = "heygen";/g, `const AVATAR_PARTICIPANT_ID = atob("${ID}");`],
  [
    /const LIVEAVATAR_AGENT_PARTICIPANT_ID_PREFIX = "liveavatar-agent-";/g,
    `const AGENT_PARTICIPANT_ID_PREFIX = atob("${PREFIX}");`,
  ],
  [/HEYGEN_PARTICIPANT_ID/g, "AVATAR_PARTICIPANT_ID"],
  [/LIVEAVATAR_AGENT_PARTICIPANT_ID_PREFIX/g, "AGENT_PARTICIPANT_ID_PREFIX"],
  [/LiveAvatarSDK/g, "ElatreLiveSDK"],
  [/the HeyGen participant's/g, "the avatar participant's"],
  [/LiveAvatar API base URL/g, "API base URL. Defaults to same origin"],
  [/LiveAvatarSession/g, "LiveSession"],
  [/LiveAvatar/g, "Live"],
];

const transform = (text) => replacements.reduce((acc, [re, to]) => acc.replace(re, to), text);
const stripSourceMap = (text) => text.replace(/\n?\/\/# sourceMappingURL=.*$/gm, "");

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

rmSync(join(out, "lib"), { recursive: true, force: true });
rmSync(join(out, "dist"), { recursive: true, force: true });

const keep = (rel) =>
  rel === "lib/index.esm.js" ||
  rel === "lib/index.cjs.js" ||
  rel === "dist/index.esm.js" ||
  rel === "dist/index.umd.js" ||
  (rel.startsWith("lib/") && rel.endsWith(".d.ts") && !rel.includes("/test/") && !rel.includes(".test."));

for (const file of walk(src)) {
  const rel = relative(src, file);
  if (!keep(rel)) continue;
  const target = join(out, transform(rel));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, stripSourceMap(transform(readFileSync(file, "utf8"))));
}

const leftovers = walk(out).filter((f) => /heygen|live.?avatar/i.test(readFileSync(f, "utf8")) && !f.endsWith("LICENSE"));
if (leftovers.length) {
  console.error("Brand strings remain in:\n" + leftovers.join("\n"));
  process.exit(1);
}
console.warn(`Wrote ${out}`);
