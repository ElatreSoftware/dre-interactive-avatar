# Implementation Plan: `telemetry`

Spec: [SPEC-telemetry.md](../SPEC-telemetry.md) · Depends on: `embed` (built)

## Shape of the work

The schema sits at the bottom and everything else depends on it, so it is
written first and nothing else starts until its shape is settled.

```
          ┌──────────────────────────┐
          │ T8  docs + e2e           │
          └────────────┬─────────────┘
   ┌───────────────────┴──────────────┐
   │ T6  onEvent seam + useFootprints │
   └───────────────────┬──────────────┘
        ┌──────────────┴───────────┐
        │ T5  browser collector    │
        └──────────────┬───────────┘
                ┌──────┴──────┐
                │ T4  ingest  │
                └──────┬──────┘
        ┌──────────────┴──────────────┐
   ┌────┴─────┐  ┌────────┐  ┌────────┴───────┐
   │ T2 redact│  │ T3 sink│  │ T7 scripts/env │
   └────┬─────┘  └────┬───┘  └────────────────┘
        └───────┬─────┘
          ┌─────┴─────┐
          │ T1 schema │
          └───────────┘
```

T2 and T3 are independent of each other; everything else is a chain.

## Decisions taken while planning

**The avatar layer stays ignorant of telemetry.** `AvatarProvider` gains a
single `onEvent` prop emitting domain events it already knows about. Nothing in
`src/avatar/` imports `src/telemetry/`, so the session layer remains testable
on its own and the widget still works with footprints switched off.

**`onEvent` is held in a ref.** The provider binds SDK listeners once; a caller
passing an inline arrow function must not cause them to rebind, or every render
would detach and reattach every listener on a live call.

**Transcript events are emitted on finalisation, not per chunk.** The reducer
already distinguishes the two, and chunk-level records would be ~50× the volume
for no extra information.

**The collector never throws and never blocks.** A footprint is not worth a
broken call: failed flushes retry twice, then drop.

## Risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| `session_ended` is lost when the tab closes | It is the most valuable event and the usual way a call ends | A synthetic end event is queued before `pagehide`/`visibilitychange → hidden`, flushed with `sendBeacon`, which survives unload where `fetch` is cancelled |
| The ingest endpoint is public by construction | An append-only endpoint anyone can reach is a disk-filling primitive | Grant verification, size caps and rate limiting all run *before* the first byte is written |
| A torn JSONL line is unparseable forever | `O_APPEND` is atomic only for small writes, and "small" is not a promise worth betting a transcript on | Writes are serialised through a promise chain, and the sink is tested under concurrency |
| Log injection via transcript text | A payload containing a newline could forge a record | `JSON.stringify` escapes newlines; handled by the encoding rather than by filtering, and tested with a hostile string |
| Clients lying about who they are | `parentOrigin` in a body is a suggestion | The server stamps origin, time and hashed IP from the verified grant, overwriting whatever the client claimed |
| Transcripts are personal data | Real obligations, for you and every embedder | Retention window, a prune script, a documented notice, and `FOOTPRINT_TRANSCRIPTS=false` to turn text off while keeping everything else |
| Disk fills up | Nothing rotates on its own | One file per UTC day plus `pnpm footprints:prune`; documented as a cron, not a hope |

## Verification checkpoints

- After **T3**: 200 concurrent writes yield 200 parseable lines, hostile strings included.
- After **T4**: `curl` without a grant writes nothing; an oversized batch is refused.
- After **T5**: the collector flushes on all four triggers and uses `sendBeacon` on unload.
- After **T8**: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e`.
