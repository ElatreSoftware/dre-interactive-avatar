# Tasks: `embed`

Plan: [plan-embed.md](plan-embed.md) · Spec: [SPEC-embed.md](../SPEC-embed.md)

- [x] **E1: Embed key registry + origin matching**
  - Acceptance: `loadRegistry()` reads `config/embed-keys.json` or `EMBED_KEYS_JSON`,
    validates with zod, memoises, and throws a message naming the bad field.
    `findKey(key)` returns the record or `null` for unknown/disabled.
    `originAllowed(origin, patterns)` compares protocol, host and port parsed by
    `new URL()`, supports exactly one leading `*.` label, and rejects
    `https://acme.example.attacker.com`, `https://notacme.example`,
    `http://acme.example` (wrong scheme) and `https://acme.example:8443` (wrong port).
    `http://localhost:<any>` is allowed only when `NODE_ENV !== "production"`.
  - Verify: `pnpm test tests/embed/registry.test.ts` — hostile cases first, written before the matcher
  - Files: `src/embed/registry.ts`, `src/embed/originMatch.ts`, `config/embed-keys.example.json`, `tests/embed/registry.test.ts`, `tests/embed/originMatch.test.ts`

- [x] **E2: Embed grant (HMAC)**
  - Acceptance: `signGrant({ embedKey, parentOrigin })` returns a compact
    `base64url(payload).base64url(sig)` string; `verifyGrant(token)` returns the
    payload or a typed failure for `malformed | bad_signature | expired`.
    Uses `crypto.timingSafeEqual`. TTL 10 minutes, configurable.
    `EMBED_GRANT_SECRET` added to `src/lib/env.ts` with a minimum length.
  - Verify: `pnpm test tests/embed/grant.test.ts` — round-trip, tampered payload, tampered signature, expiry at the boundary
  - Files: `src/embed/grant.ts`, `src/lib/env.ts`, `tests/embed/grant.test.ts`, `.env.example`

- [x] **E3: `/embed/[embedKey]` document**
  - Acceptance: renders `AvatarProvider` + `InteractiveAvatar` with the key's
    `avatarId` and `dynamicVariables`, transparent background, no global chrome.
    Unknown or disabled key renders `notFound()`. The page embeds a freshly
    signed grant (parent origin taken from the `o` query param, cross-checked
    against `Referer` when present) and passes it to the client.
  - Verify: `pnpm test tests/embed/embedPage.test.tsx`; `pnpm dev` then open `/embed/<key>` directly
  - Files: `src/app/embed/[embedKey]/page.tsx`, `src/app/embed/[embedKey]/layout.tsx`, `tests/embed/embedPage.test.tsx`

- [x] **E4: Per-key `frame-ancestors` middleware**
  - Acceptance: `src/middleware.ts` (nodejs runtime) matches `/embed/:key*` and
    sets `Content-Security-Policy: frame-ancestors <key's origins>`. Unknown key
    → no allowlist, so it is framable nowhere. `X-Frame-Options` is never set.
    `frame-ancestors 'none'` is the fallback, never `*`.
  - Verify: `pnpm test tests/embed/middleware.test.ts`; `curl -sI localhost:3000/embed/<key> | grep -i content-security`
  - Files: `src/middleware.ts`, `tests/embed/middleware.test.ts`

- [x] **E5: postMessage protocol + iframe-side bridge**
  - Acceptance: `src/embed/protocol.ts` exports the message union and a guard
    that rejects a wrong `source`, a wrong version, a non-object payload, and a
    message from an unexpected origin. `useHostBridge()` answers `hello` with
    `ready`, learns the parent origin from `event.origin`, posts `resize` on
    open/close with measured dimensions, and always targets an explicit origin.
    Listeners clean up; a second `hello` is answered idempotently.
  - Verify: `pnpm test tests/embed/protocol.test.ts tests/embed/hostBridge.test.tsx`
  - Files: `src/embed/protocol.ts`, `src/embed/useHostBridge.ts`, `tests/embed/protocol.test.ts`, `tests/embed/hostBridge.test.tsx`

- [x] **E6: `public/embed.js` loader**
  - Acceptance: reads `data-embed-key`, `data-position`, `data-user-id` from its
    own script tag; derives the widget origin from `document.currentScript.src`;
    injects one iframe with `allow="microphone; autoplay; clipboard-write"`,
    `title`, and no `sandbox`; collapsed 88×88 at the corner; animates to
    `min(420px, 100vw - 32px) × min(680px, 100vh - 32px)` on `resize`, full
    viewport under 640px. Exposes `window.DreWidget.open()/close()/destroy()`.
    A missing key logs one error and returns. No exception escapes.
  - Verify: `pnpm test tests/embed/loader.test.ts` (jsdom, script tag + fake iframe); manual check against `e2e/embed/host.html`
  - Files: `public/embed.js`, `tests/embed/loader.test.ts`

- [x] **E7: Require a grant to mint a session**
  - Acceptance: `/api/avatar/session` requires `x-embed-grant`; verifies it;
    checks the grant's origin against the key's allowlist; uses the key's
    `avatarId`/`dynamicVariables` rather than trusting the body. Missing,
    malformed, expired or origin-mismatched → 403 with no detail.
    `/` keeps working via a reserved internal key. In-process rate limit per
    key + hashed IP.
  - Verify: `pnpm test tests/avatar/sessionRoute.test.ts` (existing tests updated, not deleted); `curl -X POST localhost:3000/api/avatar/session` → 403
  - Files: `src/app/api/avatar/session/route.ts`, `src/embed/rateLimit.ts`, `src/app/page.tsx`, `tests/avatar/sessionRoute.test.ts`

- [x] **E8: Distinguish a blocked mic from an ungranted iframe**
  - Acceptance: `requestMicrophoneAccess()` gains a `blocked_by_embedder`
    result, detected via `document.featurePolicy?.allowsFeature("microphone")`
    (or `permissions.query` where available) before calling `getUserMedia`.
    The widget shows "The page embedding this widget has not allowed microphone
    access." and the docs name the fix.
  - Verify: `pnpm test tests/avatar/microphone.test.ts`
  - Files: `src/avatar/microphone.ts`, `src/components/avatar/InteractiveAvatar.tsx`, `tests/avatar/microphone.test.ts`

- [x] **E9: Cross-origin e2e**
  - Acceptance: a static `host.html` served on a second origin mounts the
    widget, opens it, asserts the stage's measured height exceeds the collapsed
    bubble, and closes it. A `denied.html` on a disallowed origin renders no
    widget. No vendor credits spent — the session route is stubbed.
  - Verify: `pnpm e2e`
  - Files: `e2e/embed/host.html`, `e2e/embed/denied.html`, `e2e/embed.spec.ts`, `playwright.config.ts`

- [x] **E10: Docs and config hygiene**
  - Acceptance: `docs/embedding.md` covers the script tag, every `data-*`
    attribute, the `allow` requirement and the HTTPS requirement, the
    `window.DreWidget` API, and how to request an allowlist change.
    `config/embed-keys.json` and `data/` are gitignored; `.env.example` lists
    `EMBED_GRANT_SECRET` and `EMBED_KEYS_FILE`.
  - Verify: follow the doc from scratch against a clean checkout
  - Files: `docs/embedding.md`, `.gitignore`, `.env.example`, `README.md`

All ten complete: 283 unit tests across 17 files, 6 Playwright tests, lint,
typecheck and build clean.

### Changed while building

- **E4** ships as `src/proxy.ts`, not `src/middleware.ts`: Next 16 renamed the
  convention and refuses a `runtime` segment config in it — a proxy always runs
  on Node, which is what the registry needed anyway.
- **E5** delivers host requests as callbacks (`onOpenRequest`) and an imperative
  handle on `InteractiveAvatar`, rather than a `request` prop with a nonce. The
  nonce version worked but drove an action through state and an effect, which
  `react-hooks/set-state-in-effect` correctly objected to.
- **E6** greets from both sides. The frame's `load` event and React mounting
  inside it race, and whichever loses drops the handshake — leaving the host
  sizing the widget at 96px forever. Caught by the e2e, not by a unit test.
- **E9** runs the app on port 3100. On 3000 Playwright silently reused a dev
  server without the test registry, which surfaced as a 404 inside an iframe.

## Final gate

`pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e`, plus every
success criterion in SPEC-embed.md checked off.
