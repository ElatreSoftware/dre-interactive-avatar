/**
 * Session footprints — the server half.
 *
 * Imports `node:fs`. Never import this from a client component; see the note
 * in `./index.ts`.
 */
export { createDatabaseSink, getFootprintSink, resetFootprintSink } from "./store";
export {
  DEFAULT_RETENTION_DAYS,
  pruneFootprints,
  retentionCutoff,
  retentionDays,
  sweepIfDue,
} from "./retention";
export { createMemorySink } from "./sink";
export type { FootprintSink } from "./sink";
export { cleanText, keepTranscripts, redact } from "./redact";
