import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/embed/rateLimit";

const NOW = 1_700_000_000_000;

describe("createRateLimiter", () => {
  it("allows a burst up to capacity, then refuses", () => {
    const limiter = createRateLimiter({ capacity: 3, refillPerSecond: 1 });
    expect([1, 2, 3].map(() => limiter.take("a", NOW))).toEqual([true, true, true]);
    expect(limiter.take("a", NOW)).toBe(false);
  });

  it("refills over time", () => {
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 1 });
    limiter.take("a", NOW);
    limiter.take("a", NOW);
    expect(limiter.take("a", NOW)).toBe(false);
    expect(limiter.take("a", NOW + 1000)).toBe(true);
  });

  it("never refills past capacity", () => {
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 1 });
    limiter.take("a", NOW);
    const muchLater = NOW + 60 * 60 * 1000;
    expect(limiter.take("a", muchLater)).toBe(true);
    expect(limiter.take("a", muchLater)).toBe(true);
    expect(limiter.take("a", muchLater)).toBe(false);
  });

  it("keeps callers apart", () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 0 });
    expect(limiter.take("a", NOW)).toBe(true);
    expect(limiter.take("a", NOW)).toBe(false);
    expect(limiter.take("b", NOW)).toBe(true);
  });

  it("is not fooled by a clock that goes backwards", () => {
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 1 });
    limiter.take("a", NOW);
    limiter.take("a", NOW);
    expect(limiter.take("a", NOW - 60_000)).toBe(false);
  });

  it("forgets idle callers so memory stays bounded", () => {
    const limiter = createRateLimiter({
      capacity: 1,
      refillPerSecond: 1,
      idleEvictionMs: 1000,
    });
    limiter.take("a", NOW);
    expect(limiter.size()).toBe(1);
    limiter.take("b", NOW + 5000);
    expect(limiter.size()).toBe(1);
  });
});
