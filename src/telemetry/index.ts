/**
 * Session footprints — the browser half.
 *
 * Client-safe on purpose. The sink touches `node:fs`, so it lives in
 * `./server` instead: a barrel that re-exported both would drag the filesystem
 * into the browser bundle, and the build fails rather than letting it through.
 *
 * Nothing in `src/avatar/` imports this folder. The session layer emits domain
 * events through `AvatarProvider`'s `onEvent` and knows nothing about where
 * they end up.
 */
export { createCollector, DEFAULT_ENDPOINT } from "./collector";
export type { CollectorOptions, FootprintCollector } from "./collector";
export { useFootprints } from "./useFootprints";
export type { Footprints, UseFootprintsOptions } from "./useFootprints";
export { FootprintRecorder } from "./FootprintRecorder";
export {
  FOOTPRINT_VERSION,
  footprintBatch,
  footprintEvent,
  MAX_BATCH_SIZE,
  MAX_TEXT_LENGTH,
} from "./schema";
export type {
  FootprintEvent,
  FootprintPayload,
  FootprintType,
  ServerStamp,
  StoredFootprint,
} from "./schema";
