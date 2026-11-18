import type { StoredFootprint } from "./schema";

/**
 * Where footprints go.
 *
 * One interface, one implementation today. The point of it is that swapping
 * JSONL for Postgres is a new file and a config line rather than a rewrite of
 * the route that calls it.
 */
export interface FootprintSink {
  write(records: readonly StoredFootprint[]): Promise<void>;
  /** Flush and release anything held open. */
  close(): Promise<void>;
}

/** Keeps everything in memory. For tests, and for proving the seam is real. */
export function createMemorySink(): FootprintSink & { records: StoredFootprint[] } {
  const records: StoredFootprint[] = [];
  return {
    records,
    async write(batch) {
      records.push(...batch);
    },
    async close() {},
  };
}
