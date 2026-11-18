/**
 * An in-process token bucket.
 *
 * Deliberately not distributed: this matches the single long-lived Node
 * process the rest of the module assumes. Behind several instances each one
 * limits its own share, which is a weaker guarantee — it is a cost control and
 * an abuse speed bump, not a correctness mechanism.
 */

export interface RateLimitOptions {
  /** Burst size. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
  /** Buckets untouched for this long are forgotten, so memory stays bounded. */
  idleEvictionMs?: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimiter {
  /** True when the caller may proceed; false when it has run out of budget. */
  take(key: string, now?: number): boolean;
  reset(): void;
  size(): number;
}

const DEFAULT_EVICTION_MS = 10 * 60 * 1000;

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const { capacity, refillPerSecond, idleEvictionMs = DEFAULT_EVICTION_MS } = options;
  const buckets = new Map<string, Bucket>();
  let lastSweep = 0;

  function sweep(now: number): void {
    if (now - lastSweep < idleEvictionMs) return;
    lastSweep = now;
    for (const [key, bucket] of buckets) {
      if (now - bucket.updatedAt > idleEvictionMs) buckets.delete(key);
    }
  }

  return {
    take(key, now = Date.now()) {
      sweep(now);
      const bucket = buckets.get(key);

      if (!bucket) {
        buckets.set(key, { tokens: capacity - 1, updatedAt: now });
        return true;
      }

      const elapsedSeconds = Math.max(0, now - bucket.updatedAt) / 1000;
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillPerSecond);
      bucket.updatedAt = now;

      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    },
    reset() {
      buckets.clear();
      lastSweep = 0;
    },
    size() {
      return buckets.size;
    },
  };
}

/** Sessions cost vendor credits, so the budget is deliberately small. */
export const sessionRateLimiter = createRateLimiter({
  capacity: 5,
  refillPerSecond: 1 / 12, // five per minute, sustained
});
