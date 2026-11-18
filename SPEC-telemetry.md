# Spec: `telemetry` — session footprints

Module id: `telemetry` · Map: [CAPABILITY-MAP.md](CAPABILITY-MAP.md) · Depends on: `embed`

> **Superseded, 2026-11-18.** Footprints and embed keys now live in Postgres
> via Prisma, not in JSONL files, and retention is enforced by the service
> itself rather than by a cron job. The event schema, the collector's delivery
> rules and the ingest order below are unchanged. See `prisma/schema.prisma`
> and `docs/footprints.md`.

## Assumptions I'm making

Correct any of these now.

1. **Deployment is a long-lived Node process with a persistent volume.** This
   is load-bearing. On Vercel, Lambda or Cloud Run the filesystem is ephemeral
   and per-instance: the line you append is invisible to the next request and
   gone at the next deploy. If that is the target, the sink has to change and
   the rest of this spec still stands.
2. **Retention is 90 days**, enforced by a prune script you run on a cron.
3. **Transcripts are stored by default**, as you asked, with a kill switch
   (`FOOTPRINT_TRANSCRIPTS=false`) that keeps every other event.
4. Only **finalized** transcript turns are stored, after audio-tag stripping —
   not the streaming chunks. A chunk-level record would be ~50× the volume and
   tells you nothing extra.
5. The embedder may pass an opaque `data-user-id`. We store it as given and
   never interpret it.
6. `rawMessage` (text with `[slow]`-style tags intact) is **not** stored; the
   cleaned text is.

## Objective

Know what happened in every session: who embedded it, what the user did, what
was said, why it ended. Flat files, queryable with `jq`, swappable for a real
database the day you need one.

## What counts as a footprint

A versioned, discriminated union. Every event shares an envelope:

```ts
interface FootprintEnvelope {
  v: 1;
  id: string;            // client-generated uuid, for idempotency
  seq: number;           // monotonic within a widget session; survives reordering
  sessionKey: string;    // our uuid, exists from widget load (before any token)
  avatarSessionId?: string; // LiveAvatar's id, once it exists
  embedKey: string;
  clientTs: number;      // what the browser claims
  type: FootprintType;
  payload: ...;          // narrowed by `type`
}
```

The server stamps its own truth over anything the client asserts, and never
trusts the client for these:

```ts
interface ServerStamp {
  receivedAt: number;
  parentOrigin: string;  // from the verified embed grant, not from the body
  ipHash: string;        // sha256(ip + IP_HASH_SALT), truncated to 16 hex
  userAgent: string;
  country?: string;      // only if a CDN header supplies it
}
```

### Session lifecycle

`widget_loaded`, `widget_opened`, `mic_requested`, `mic_granted`,
`mic_denied`, `mic_unavailable`, `session_requested`, `session_token_failed`,
`session_started`, `stream_ready`, `avatar_speak_started`,
`avatar_speak_ended`, `user_speak_started`, `user_speak_ended`,
`interruption`, `mute_toggled`, `connection_quality_changed`,
`session_ended` (`{ reason: SessionEndReason, durationMs, turns }`),
`widget_closed`, `error`.

`session_ended` is the event that matters most and the one that is hardest to
capture, because the usual way a call ends is the tab closing. See *Delivery*.

### Conversation content

`transcript_turn` — `{ sender, text, isTyped, wasInterrupted, charCount }`.
Text is capped at 2,000 characters and stripped of control characters, because
these lines end up in a file that someone will eventually `cat`.

### Embed context

Emitted once per session as `widget_loaded`'s payload: `parentOrigin`,
`referrer`, `locale`, `timezone`, `viewport`, `deviceClass`
(`desktop|tablet|mobile`), `userId?`. The user agent and hashed IP come from
the server stamp, not from here.

## Tech stack

No new runtime dependencies. zod 4 for the schema (shared by browser and
server), `node:fs/promises` for the sink, `node:crypto` for hashing.

## Commands

```
Dev:        pnpm dev
Build:      pnpm build
Test:       pnpm test
Lint:       pnpm lint
Typecheck:  pnpm typecheck
Prune:      pnpm footprints:prune            # deletes files past retention
Tail:       pnpm footprints:tail             # pretty-prints today's file
```

## Project structure

```
src/telemetry/schema.ts        zod schemas + TS types for every event
src/telemetry/collector.ts     Browser: queue, batch, flush, beacon
src/telemetry/useFootprints.ts Binds AvatarProvider's events to the collector
src/telemetry/sink.ts          FootprintSink interface
src/telemetry/jsonlSink.ts     Append-only, one file per UTC day
src/telemetry/redact.ts        Caps, control-character stripping, text policy
src/telemetry/rateLimit.ts     In-process token bucket
src/app/api/footprints/route.ts  Ingest
scripts/prune-footprints.mjs
scripts/tail-footprints.mjs
data/footprints/YYYY-MM-DD.jsonl   gitignored
tests/telemetry/*.test.ts
docs/footprints.md             Event reference + jq recipes + retention policy
```

## How it works

### Where events come from

`AvatarProvider` gains one optional prop:

```ts
onEvent?: (event: AvatarLifecycleEvent) => void;
```

That is the whole seam. The avatar layer keeps knowing nothing about telemetry
— it emits domain events, and `useFootprints` decides what to record. Nothing
in `src/avatar/` imports `src/telemetry/`, so the session layer stays
independently testable and the widget still works with telemetry switched off.

### Delivery

A queue that flushes when any of these happen: 10 events buffered, 2 seconds
idle, the call ends, or the page goes away.

The last one is the hard one. `visibilitychange → hidden` and `pagehide` both
fire where `beforeunload` does not (bfcache, mobile Safari), and only
`navigator.sendBeacon` is guaranteed to survive the unload — a `fetch` is
cancelled. So: `sendBeacon` on the way out, `fetch` with `keepalive` as the
fallback, and a synthetic `session_ended` with `reason: "page_hidden"` pushed
into the queue immediately before.

Events carry `seq`, so a beacon arriving out of order still reconstructs.

Failed flushes retry twice with backoff, then drop. Telemetry never blocks,
never retries forever, and never surfaces an error to the user — a footprint is
not worth a broken call.

### Ingest — `POST /api/footprints`

In order:

1. Verify the embed grant (from `embed`). No valid grant → 403, nothing written.
2. Reject bodies over 64 KB or batches over 50 events.
3. Rate limit per `embedKey` + `ipHash`. Over the bucket → 429, nothing written.
4. zod-parse the batch. **Any invalid event drops that event, not the batch** —
   one bad line should not lose a session.
5. Redact, stamp, append.
6. Respond `204`. The browser ignores the body; a beacon cannot read it anyway.

This endpoint is public by construction — it has to be reachable from the
browser — which is exactly why steps 1–3 come before any disk write. An
unauthenticated append-only endpoint is a disk-filling primitive.

### The sink

```ts
export interface FootprintSink {
  write(records: StoredFootprint[]): Promise<void>;
  close(): Promise<void>;
}
```

`JsonlSink` writes one JSON object per line to `data/footprints/<UTC date>.jsonl`.
Writes are serialized through a promise chain: POSIX `O_APPEND` is atomic for
small writes, but "small" is not a guarantee I want a transcript to depend on,
and a torn line is unparseable forever.

`JSON.stringify` escapes newlines, so no payload can forge a line break and
inject a fake record — this is the log-injection case, and it is handled by the
encoding rather than by filtering.

One interface, one implementation. Postgres later is a new file and a config
line, not a rewrite.

### Retention

`pnpm footprints:prune` deletes files whose date is older than
`FOOTPRINTS_RETENTION_DAYS` (default 90). Documented in `docs/footprints.md`
along with the sentence each embedding customer needs in their own privacy
notice — because you are storing what their users said, and they are the ones
who owe those users the disclosure.

## New environment variables

```
FOOTPRINTS_ENABLED=true
FOOTPRINTS_DIR=./data/footprints
FOOTPRINTS_RETENTION_DAYS=90
FOOTPRINT_TRANSCRIPTS=true
IP_HASH_SALT=                  # required when FOOTPRINTS_ENABLED; rotating it breaks IP correlation, by design
```

All validated in `src/lib/env.ts` alongside the existing ones.

## Code style

Matches the codebase. The schema is the single source of truth — types are
inferred from zod, never declared twice:

```ts
export const transcriptTurn = z.object({
  type: z.literal("transcript_turn"),
  sender: z.enum(["user", "avatar"]),
  text: z.string().max(2000),
  isTyped: z.boolean(),
  wasInterrupted: z.boolean(),
});

export type TranscriptTurn = z.infer<typeof transcriptTurn>;
```

## Testing strategy

| Level | Covers |
|---|---|
| Unit | Schema accepts every event and rejects malformed ones; redaction caps and strips; `seq` is monotonic; rate limiter refills correctly |
| Unit | Collector batches, flushes on all four triggers, calls `sendBeacon` on `pagehide`, drops after two failed retries, never throws |
| Unit | `JsonlSink` under concurrent writes produces N parseable lines with no interleaving; rolls files at UTC midnight; a payload containing `\n` and `}` stays one line |
| Integration | Ingest rejects no-grant / oversized / rate-limited; drops one bad event and keeps the rest; server stamp overrides a client-supplied `parentOrigin` |
| E2E | A scripted session with a stubbed vendor produces a file whose events replay the session in order |

Tests write to a temp directory, never `data/`. No test spends vendor credits.

## Boundaries

- **Always:** validate with zod on both sides; stamp server truth over client
  claims; hash IPs with a salt; cap and strip text before it touches disk;
  fail open for the *user* (telemetry errors never break a call) and closed for
  the *disk* (no grant, no write).
- **Ask first:** adding a dependency; storing `rawMessage`; storing raw IPs;
  forwarding footprints anywhere off this box; changing retention; recording
  chunk-level transcripts.
- **Never:** write an event without a verified grant; log a session token or
  vendor key into a footprint; let a telemetry failure surface to the end user;
  block a call on a flush; commit `data/`.

## Success criteria

- [x] A completed call yields a JSONL file that replays the session in order,
      attributed to the right embed key and parent origin.
- [x] Killing the tab mid-call still records `session_ended`.
- [x] A `POST` with no grant, a bad grant, a 1 MB body, or 500 events writes
      nothing and returns the right status.
- [x] A transcript containing `\n`, `"` and `}` round-trips as exactly one line.
- [x] 200 concurrent writes yield 200 parseable lines.
- [x] `FOOTPRINT_TRANSCRIPTS=false` records lifecycle and context, no text.
- [x] `pnpm footprints:prune` removes files past retention and nothing else.
- [x] `docs/footprints.md` documents every event and the retention policy.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` clean.

## Open questions

1. **Is the deployment really a long-lived Node process?** Everything here
   turns on it.
2. 90 days — right number?
3. Should footprints also capture the **ElevenLabs conversation id**, so a
   session can be reconciled against ElevenLabs' own dashboard? Cheap, and the
   kind of thing that is painful to backfill.
4. Do you want a **daily rollup** (sessions, turns, interruptions, mean
   duration, per key) written beside the raw files? A hundred lines, and it is
   what you will actually read.
5. Should the ingest endpoint also accept events from **our own non-embedded
   page** (`/`), or is telemetry embed-only?
