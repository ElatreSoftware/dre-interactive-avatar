# Capability Map: Embeddable Widget + Session Footprints

The widget stops being "our page" and becomes something other sites drop into
their own HTML. Two capabilities fall out of that, and they ship and verify
separately.

| Module id | Responsibility | Depends on |
|---|---|---|
| `embed` | Standalone embeddable route, the `embed.js` loader, embed keys, parent-origin allowlisting, host↔iframe messaging | — |
| `telemetry` | Footprint event schema, browser collector, ingest route, append-only JSONL sink, retention | `embed` (for tenant identity and parent origin) |

Build order: **`embed` → `telemetry`**

`telemetry` depends on `embed` because every footprint is stamped with *which
customer* and *which page* it came from. Without the embed key there is nothing
to attribute a session to, and the schema would have to change the moment
tenancy arrived.

---

## Module: `embed`

**In scope**

- `/embed/[embedKey]` — the widget alone, no page chrome, transparent background.
- `public/embed.js` — a one-line `<script>` the customer drops in. It injects
  the iframe, positions it, and resizes it between the collapsed bubble and the
  open call stage.
- An embed-key registry: key → display name, avatar id, allowed parent origins,
  enabled flag.
- Enforcement in two places, because one is not enough:
  - `Content-Security-Policy: frame-ancestors` on the embed document, so a
    browser refuses to frame us on a site that is not on the allowlist.
  - An `Origin` check on `POST /api/avatar/session`, so a scraped embed key
    cannot be used to mint tokens from a `curl` or someone else's page.
- A `postMessage` channel between loader and iframe: `resize`, `opened`,
  `closed`, `ready`, `error`.

**Out of scope** — billing, a dashboard, self-serve key creation.

**Hard constraints discovered while reading the current code**

- A cross-origin iframe gets no microphone unless the *parent* grants it:
  `<iframe allow="microphone; autoplay; clipboard-write">`. Our loader sets
  this; a customer hand-writing their own iframe tag and omitting it will see
  the permission denied with no obvious cause. This needs to be loud in the docs
  and detectable at runtime.
- The embedding page must be HTTPS, or `getUserMedia` is unavailable regardless
  of the `allow` attribute.
- `X-Frame-Options` cannot express an allowlist. It must not be set on the
  embed route; `frame-ancestors` is the only mechanism that works.

**Success criteria**

- A plain HTML file on a different origin, with one `<script>` tag, shows the
  bubble and completes a call.
- The same file served from an origin not on the key's allowlist fails to frame,
  and a direct `curl` with that key mints no token.
- Opening and closing the call resizes the iframe without clipping the stage.

---

## Module: `telemetry`

**In scope**

- A versioned, discriminated-union event schema validated with zod on both
  sides, covering the three families you picked:
  - **Session lifecycle** — widget opened, mic granted/denied/unavailable,
    session requested, stream ready, avatar spoke first, interruption, mute
    toggled, connection quality degraded, ended + reason, total duration.
  - **Conversation content** — finalized transcript turns, user and avatar,
    with audio tags already stripped; typed vs spoken marked.
  - **Embed context** — embed key, parent origin, referrer, user agent, locale,
    viewport, coarse device class.
- A browser collector that queues events and flushes on an interval and on
  `pagehide` via `sendBeacon`, so the `session_ended` event is not the one event
  you always lose.
- `POST /api/footprints` — validates, rate-limits, stamps server-side truth
  (receive time, parent origin, hashed IP) over anything the client claims.
- An append-only JSONL sink, one file per UTC day, one event per line.
- A `FootprintSink` interface with the JSONL implementation behind it, so
  swapping in Postgres later is one file, not a rewrite.
- Documented retention and a prune script.

**Out of scope** — querying, dashboards, aggregation. These are flat log files;
`jq` is the query engine for now.

**Success criteria**

- A completed call produces one well-formed JSONL file whose events replay the
  session in order, attributed to the right embed key and parent origin.
- Killing the browser tab mid-call still records an end event.
- A forged request with a bad key, a bad origin, or a malformed body is rejected
  and written nowhere.

---

> **Resolved, 2026-11-18.** Both modules are built, and storage moved to
> Postgres via Prisma: there is no configuration file and no cron job. The
> questions below are kept for the reasoning, not as open items.

## Decisions needed before the module specs are written

1. **JSONL on disk means no serverless.** Vercel, Lambda and Cloud Run give you
   an ephemeral, per-instance filesystem: the file is invisible to the next
   request and gone at the next deploy. This only works on a long-lived Node
   process with a persistent volume. Confirm that is the deployment, or the sink
   needs to be something else.
2. **Transcripts are personal data.** Storing what people said, keyed to an
   origin and a hashed IP, puts real obligations on you and on every customer
   embedding this. Minimum: a documented retention window, and the embedder
   telling their users. Say what retention you want.
3. **Where does the key registry live** with no database — a gitignored JSON
   file read at boot, or a single env var holding JSON?
4. **Does the embedder get to pass their own `userId`** through the loader, so
   footprints join to their users? Useful; also the easiest way for PII to
   arrive unannounced.
5. **Is `rawMessage`** (the text with `[slow]`-style audio tags still in it)
   worth storing alongside the clean text, or is the clean text enough?
