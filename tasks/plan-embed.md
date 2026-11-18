# Implementation Plan: `embed`

Spec: [SPEC-embed.md](../SPEC-embed.md) · Map: [CAPABILITY-MAP.md](../CAPABILITY-MAP.md)

## Shape of the work

Four layers, built bottom-up. Each is useful and testable before the one above
it exists.

```
                     ┌─────────────────────────┐
                     │  E9  cross-origin e2e   │
                     └────────────┬────────────┘
              ┌───────────────────┴───────────────────┐
     ┌────────┴────────┐                     ┌────────┴────────┐
     │ E6  embed.js    │                     │ E7  grant gate  │
     │     loader      │                     │     on /session │
     └────────┬────────┘                     └────────┬────────┘
     ┌────────┴────────┐  ┌─────────────────┐         │
     │ E5  protocol +  │  │ E4  middleware  │         │
     │     host bridge │  │     CSP         │         │
     └────────┬────────┘  └────────┬────────┘         │
              │          ┌─────────┴─────────┐        │
              └──────────┤ E3  /embed/[key]  │        │
                         └─────────┬─────────┘        │
            ┌──────────────────────┴───────┐ ┌────────┴────────┐
            │ E1  registry + origin match  │ │ E2  embed grant │
            └──────────────────────────────┘ └─────────────────┘
```

**E1 and E2 are independent** and are the only two that could run in parallel.
Everything else is a chain, because each layer needs the one below to exist
before it can be verified end to end.

## Build order

1. **E1 registry + origin matching** — pure functions, no framework. The
   wildcard matcher is the single highest-risk piece of logic in the module, so
   it gets written first and test-first.
2. **E2 embed grant** — HMAC sign/verify, also pure. Parallel with E1.
3. **E3 the embed document** — `/embed/[embedKey]`, renders the existing widget
   with no page chrome. First point where something is visible in a browser.
4. **E4 middleware CSP** — per-key `frame-ancestors`. First point where framing
   is actually controlled.
5. **E5 protocol + host bridge** — typed `postMessage` both ways, the iframe
   half wired into the widget's open/close.
6. **E6 `embed.js`** — the loader. First point where a customer-shaped
   integration exists.
7. **E7 grant gate** — `/api/avatar/session` starts requiring a valid grant.
   Deliberately last of the server work: it breaks the existing `/` page until
   that page is given a grant too, so it lands when everything else can prove
   it still works.
8. **E8 microphone diagnosis** — turn the iframe-without-`allow` failure into a
   message that says what is actually wrong.
9. **E9 cross-origin e2e** — a second Playwright origin, an allowed fixture and
   a denied one.
10. **E10 docs + config hygiene** — `docs/embedding.md`, `.gitignore`,
    `.env.example`.

## Decisions taken while planning

**The loader derives our origin from its own `<script src>`.** This closes open
question 1 in the spec — there is no production origin to configure, because
`document.currentScript.src` already names the host that served the loader. A
customer who copies the tag to a staging site automatically points at the same
widget host they loaded it from.

**The registry has two sources behind one interface.** A JSON file on disk is
the documented path, with `EMBED_KEYS_JSON` as an env-var alternative holding
the same shape. This costs about ten lines and buys the fallback for the risk
below.

**The existing `/` page keeps working.** It becomes an internal embedder: it
gets a grant from a reserved local key, so E7 does not fork the session route
into "embedded" and "not embedded" paths. One code path, one set of tests.

## Risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| Next.js middleware on the Node runtime may not be available or stable in 16.4.6 | The middleware reads the key registry from disk, which the Edge runtime cannot do | Confirmed `loadNodeMiddleware` exists in the installed Next. If `runtime: "nodejs"` misbehaves, the registry's env-var source is Edge-safe and the middleware switches to it with no other change — this is why E1 abstracts the source. |
| Wildcard origin matching | `endsWith("acme.example")` matches `acme.example.attacker.com`. This is the module's one genuine security hole if done casually | Parse with `new URL()`, compare protocol + host + port as separate fields, allow exactly one leading `*.` label and require at least one more label after it. Hostile cases are in the first test file written. |
| A cross-origin iframe gets no microphone without `allow` on the parent | Looks identical to the user denying permission; every hand-written integration will hit it | E8: feature-detect with `document.featurePolicy`/`navigator.permissions` and distinguish "the embedding page has not granted microphone access" from "you blocked it". |
| React 19 Strict Mode double-mounts | `postMessage` listeners registered twice send duplicate handshakes | Register in `useEffect` with a real cleanup; the protocol is idempotent — a second `hello` re-answers rather than re-initialising. |
| E7 breaks `/` | The session route starts demanding something the existing page does not send | `/` becomes an internal embedder with a reserved key, done in the same task. The existing session tests get a grant helper rather than being deleted. |
| Collapsed iframe clips the call stage | A fixed 88×88 frame cannot show a 680px panel | E5 and E6 are one vertical slice: the resize message and the loader that honours it land together, and the e2e asserts the open stage's measured height. |
| Playwright serving two origins | Cross-origin behaviour cannot be tested from one origin | Two static servers on different ports in `playwright.config.ts`; `localhost:PORT` is a distinct origin from `127.0.0.1:PORT`, which is the cheap second origin if a port is awkward. |

## Verification checkpoints

- After **E2**: `pnpm test` — registry and grant units green, including hostile
  origin cases.
- After **E4**: `curl -sI localhost:3000/embed/<key>` shows the right
  `frame-ancestors`; an unknown key 404s with none.
- After **E6**: a local `host.html` on a second port mounts the widget, opens
  and closes with correct sizing.
- After **E7**: `curl -X POST /api/avatar/session` with no grant returns 403;
  `/` still starts a call.
- After **E9**: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e`.

## Out of scope

Billing, dashboards, self-serve key issuance, and anything in `telemetry` —
which is the next module, not this one.
