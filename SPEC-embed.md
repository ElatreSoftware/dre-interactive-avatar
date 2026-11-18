# Spec: `embed` — the widget as something other sites can mount

Module id: `embed` · Map: [CAPABILITY-MAP.md](CAPABILITY-MAP.md) · Depends on: —

> **Superseded, 2026-11-18.** The embed key registry is a database table, not
> `config/embed-keys.json`, and keys take effect within thirty seconds instead
> of needing a restart. Everything else below — `frame-ancestors` as the
> enforcement, the grant, origin matching — is unchanged.

## Assumptions I'm making

Correct any of these now; each one changes the build.

1. Deployment is a **long-lived Node process** (`next start`, container, or a
   VM) behind HTTPS — not Vercel/Lambda. This follows from the JSONL sink you
   picked in `telemetry`, and `embed` inherits it because the key registry and
   rate limiter are also in-process.
2. The key registry is a **gitignored JSON file** read once at boot
   (`config/embed-keys.json`), with `EMBED_KEYS_FILE` to relocate it. Keys are
   added by editing the file and restarting. No admin UI, no self-serve.
3. One embed key maps to **one avatar and one ElevenLabs agent config**. A
   customer wanting two avatars gets two keys.
4. Customers embed with our `embed.js` loader. Hand-written `<iframe>` tags are
   supported but documented as the unsupported-by-default path, because they
   are the way the microphone silently breaks.
5. Embed keys are **public** — they ship in the customer's page source. They
   identify, they do not authenticate. The parent-origin allowlist is what
   stops someone else using a scraped key.

## Objective

Let a customer put the avatar on their own site by adding one script tag, and
let us control — per customer — which sites may do that.

```html
<script
  src="https://widget.example.com/embed.js"
  data-embed-key="pk_dre_7f3a91c4"
  data-position="bottom-right"
  async
></script>
```

Done means: that tag on `https://customer.example` shows the bubble, opens the
call, and completes a conversation; the same tag on an origin not on that key's
allowlist shows nothing and mints no session.

## Tech stack

No new runtime dependencies. Next.js 16 App Router, React 19, TypeScript 5.9
strict, Tailwind v4, zod 4 — all already here. `embed.js` is hand-written
ES2019 with no framework, because it runs on the customer's page and must not
assume anything about it.

## Commands

```
Dev:        pnpm dev
Build:      pnpm build
Test:       pnpm test
Coverage:   pnpm test -- --coverage
Lint:       pnpm lint
Typecheck:  pnpm typecheck
E2E:        pnpm e2e
```

## Project structure

```
src/app/embed/[embedKey]/page.tsx     Standalone widget document, no page chrome
src/app/embed/[embedKey]/layout.tsx   Transparent body, no global nav
src/middleware.ts                     Per-key CSP frame-ancestors (nodejs runtime)
src/embed/registry.ts                 Load + validate embed-keys.json, lookup by key
src/embed/grant.ts                    HMAC sign/verify the short-lived embed grant
src/embed/protocol.ts                 Shared postMessage message types + guards
src/embed/useHostBridge.ts            Iframe side: handshake, resize, open/close
public/embed.js                       The loader that customers include
config/embed-keys.example.json        Committed example; the real file is ignored
tests/embed/*.test.ts                 Registry, grant, protocol, middleware
e2e/embed/host.html                   A fake customer page served on another origin
e2e/embed.spec.ts                     Cross-origin mount, resize, denied origin
docs/embedding.md                     What we hand the customer
```

## How it works

### 1. The loader (`public/embed.js`)

Reads its own `<script>` tag's `data-*` attributes, then injects a single
iframe pointing at `/embed/<key>?o=<encodeURIComponent(location.origin)>`.

It sets, and this is the part that matters:

```js
iframe.allow = "microphone; autoplay; clipboard-write";
```

A cross-origin iframe has **no microphone** unless the parent grants it with
this attribute. Omit it and `getUserMedia` rejects with `NotAllowedError` that
looks exactly like the user clicking "Block" — which is why hand-written iframe
tags are a support burden and the loader exists.

It does not use `sandbox`. The combination our widget needs
(`allow-scripts allow-same-origin allow-forms allow-popups`) is equivalent to
no sandbox at all for a document on our own origin, so it would be decoration.

Collapsed, the iframe is 88×88 at the configured corner. There is no overlay,
no wrapper div, and `pointer-events` stay on the iframe only, so the customer's
page is untouched everywhere else.

### 2. The handshake

The loader cannot know our origin is trustworthy and we cannot know theirs from
HTTP headers — a `fetch` from inside the iframe carries *our* origin, not the
parent's. So both sides learn it from the browser instead:

```
parent → iframe   { source: "dre-host",   v: 1, type: "hello", userId? }
iframe → parent   { source: "dre-widget", v: 1, type: "ready" }
iframe → parent   { source: "dre-widget", v: 1, type: "resize", w, h }
iframe → parent   { source: "dre-widget", v: 1, type: "opened" | "closed" | "error" }
parent → iframe   { source: "dre-host",   v: 1, type: "open" | "close" }
```

Every handler checks `event.source`, our `source` tag and the version, and both
sides target an explicit origin — never `"*"`. The iframe takes the parent
origin from `event.origin` on the `hello`, which the browser sets and no script
can forge.

### 3. Resizing

A fixed 88×88 iframe cannot display the call stage — it would be clipped at the
bubble's edge. On open, the iframe posts `resize` and the loader animates to
`min(420px, 100vw - 32px) × min(680px, 100vh - 32px)`, or the full viewport
below 640px wide. On close it animates back. The loader owns the transition so
it matches the widget's own corner-origin animation rather than fighting it.

### 4. Who is allowed to frame us

Two mechanisms, with different jobs.

**`frame-ancestors` is the enforcement.** `src/middleware.ts` matches
`/embed/:key*`, looks the key up, and sets

```
Content-Security-Policy: frame-ancestors https://customer.example https://*.customer.example
```

The browser refuses to render the document inside a page on any other origin.
This is the real boundary, and it is enforced by something the attacker does not
control. `X-Frame-Options` is deliberately **not** set: it has no allowlist form,
and `ALLOW-FROM` is dead everywhere.

The middleware must run on the **nodejs runtime**, since it reads the registry
from disk.

**The embed grant is defence in depth.** The embed document is rendered with a
short-lived HMAC grant (`embedKey`, `parentOrigin`, `exp` ≈ 10 min, signed with
`EMBED_GRANT_SECRET`). `POST /api/avatar/session` now requires it, verifies the
signature and expiry, and checks the origin against the allowlist again.

Being honest about what this buys: a grant is only issued to a document that was
already allowed to frame, so the two checks mostly agree. What it adds is that a
scraped key alone is useless from `curl` or a script — you need a live grant,
which expires, and which you can only obtain by actually being framed on an
allowed origin.

Rate limiting is per key and per hashed IP, in-process, on both the embed
document and the session mint.

### 5. The registry

```jsonc
// config/embed-keys.json  — gitignored
{
  "keys": [
    {
      "key": "pk_dre_7f3a91c4",
      "name": "Acme Corp",
      "enabled": true,
      "avatarId": "...",
      "allowedOrigins": ["https://acme.example", "https://*.acme.example"],
      "dynamicVariables": { "brand": "Acme" }
    }
  ]
}
```

Validated with zod at boot; a malformed file fails startup loudly rather than
silently serving no keys. Origin matching supports one leading `*.` wildcard
label and nothing more — no regex, no substring matching, because
`https://acme.example.attacker.com` passes a naive `endsWith`. `http://localhost:*`
is accepted only when `NODE_ENV !== "production"`.

An unknown, disabled or expired key renders a plain 404 document with no CSP
allowlist, so it cannot be framed anywhere.

## Code style

Unchanged from the existing codebase: named exports, no default exports outside
`app/`, explicit return types on exported functions, comments that explain the
*why*. `embed.js` is the exception and is written defensively:

```js
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return; // async + no currentScript means we cannot find our own config
  var key = script.getAttribute("data-embed-key");
  if (!key) {
    console.error("[dre-widget] missing data-embed-key on the script tag");
    return;
  }
  // Never throw past this point: an exception here is an exception on the
  // customer's page, and they will blame us for breaking their checkout.
})();
```

## Testing strategy

Vitest + RTL for units, Playwright for the cross-origin story.

| Level | Covers |
|---|---|
| Unit | Registry parsing, wildcard origin matching (including the `endsWith` trap), grant sign/verify/expiry, protocol guards rejecting wrong `source`/version/origin |
| Integration | Middleware emits the right `frame-ancestors` per key; 404 for unknown keys; session route rejects a missing, expired or origin-mismatched grant |
| E2E | A static `host.html` served on a *second* Playwright origin mounts the widget, opens, resizes, closes. A second fixture on a disallowed origin renders nothing. |

Coverage thresholds stay where they are. No test may spend vendor credits: the
e2e stops at "stage opened", with the session route stubbed.

## Boundaries

- **Always:** keep vendor keys server-side; validate every registry and
  postMessage payload with zod or an explicit guard; target explicit origins in
  `postMessage`; treat the embed key as public; fail closed on an unknown key.
- **Ask first:** adding a dependency; changing the public loader attributes once
  documented; allowing a customer to override `avatarId` from the page;
  relaxing `frame-ancestors` to `*` for any reason.
- **Never:** `postMessage(..., "*")`; `X-Frame-Options` on the embed route;
  substring or regex origin matching; an exception escaping `embed.js` onto the
  customer's page; a session minted without a valid grant.

## Success criteria

- [x] `host.html` on a different origin, one script tag, completes a call.
- [x] A disallowed origin is refused by the browser; the console shows a CSP
      violation and no session is minted.
- [x] `curl -X POST /api/avatar/session` with a valid key and no grant → 403.
- [x] A grant older than its expiry → 403.
- [x] Open/close resizes without clipping, and at 375px the stage is usable.
- [x] Removing `allow="microphone"` reproduces the denied-mic failure, and the
      widget reports it as "the embedding page has not granted microphone
      access" rather than "you blocked your microphone". *(Unit-tested against
      Permissions Policy; not reproduced in a live browser.)*
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` clean.

## Open questions

1. What is the production origin for the widget itself? It has to be fixed
   before `embed.js` can carry an absolute iframe URL.
2. Should a key be able to carry `dynamicVariables` (per-customer prompt
   values)? Assumed yes above.
3. Should the loader expose a global `window.DreWidget.open()/close()` so the
   customer can trigger the call from their own button? Cheap to add now,
   awkward later.
4. Rotation: one key per customer, or a key list with an `expiresAt` so a
   leaked key can be retired without downtime?
