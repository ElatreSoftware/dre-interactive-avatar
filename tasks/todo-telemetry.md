# Tasks: `telemetry`

- [x] **T1: Event schema** — zod envelope + discriminated union for lifecycle,
      transcript and embed-context events; types inferred, never declared twice.
      Verify: `pnpm test tests/telemetry/schema.test.ts`
- [x] **T2: Redaction** — cap text at 2,000 chars, strip control characters,
      drop transcript text when `FOOTPRINT_TRANSCRIPTS=false`.
      Verify: `pnpm test tests/telemetry/redact.test.ts`
- [x] **T3: JSONL sink** — `FootprintSink` interface, append-only daily files,
      serialised writes, UTC rollover.
      Verify: `pnpm test tests/telemetry/jsonlSink.test.ts`
- [x] **T4: Ingest route** — grant → size → rate limit → parse → redact → stamp
      → append; one bad event drops itself, not the batch.
      Verify: `pnpm test tests/telemetry/ingest.test.ts`
- [x] **T5: Browser collector** — queue, batch, flush on four triggers,
      `sendBeacon` on unload, two retries then drop, never throws.
      Verify: `pnpm test tests/telemetry/collector.test.ts`
- [x] **T6: `onEvent` seam + `useFootprints`** — provider emits domain events;
      the hook turns them into footprints.
      Verify: `pnpm test tests/telemetry/useFootprints.test.tsx`
- [x] **T7: Scripts + env** — `footprints:prune`, `footprints:tail`, env vars
      validated, `.env.example` updated.
      Verify: `pnpm footprints:prune --dry-run`
- [x] **T8: Docs + e2e** — `docs/footprints.md` with every event and the
      retention policy; an e2e asserting a session writes a readable file.
      Verify: `pnpm e2e`

All eight complete: 385 unit tests across 23 files, 9 Playwright tests, lint,
typecheck and build clean.

### Found while building, by tests rather than by reading

- **The grace period was dropping real events.** Waiting for the host
  handshake before *creating* the collector meant a visitor who clicked within
  300ms had their `widget_opened` and `mic_granted` thrown away. The collector
  now runs from mount, and only `widget_loaded` waits. Caught by the e2e.
- **The handshake greeted exactly once, to nobody.** The loader's "greet only
  once" guard fired on the frame's `load`, before React had mounted a listener
  inside it — so the hello, with the user id and the host viewport, was shouted
  into an empty room. `ready` is now an announcement rather than an answer, so
  the loader can greet again without an infinite exchange.
- **`deviceClass` called every desktop visitor a phone.** The widget measured
  its own 96px frame. The host now sends its viewport in the greeting.
- **A deleted footprints directory was never recreated**, because the mkdir
  promise was memoised. Found by an e2e that cleans up between runs; the sink
  now forgets and retries on ENOENT.
- **The telemetry barrel broke the client build**, re-exporting the filesystem
  sink into the browser bundle. Split into `index.ts` and `server.ts`.
