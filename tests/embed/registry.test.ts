import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ prisma: (await import("../support/fakePrisma")).prisma }));

import {
  embedOriginAllowed,
  findEmbedKey,
  hasExpired,
  INTERNAL_EMBED_KEY,
  resetRegistryCache,
} from "@/embed/registry";
import { db, failOnce, resetDb, seedKey } from "../support/fakePrisma";

beforeEach(() => {
  resetDb();
  resetRegistryCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("findEmbedKey", () => {
  it("returns a key from the database", async () => {
    seedKey();
    await expect(findEmbedKey("pk_dre_7f3a91c4")).resolves.toMatchObject({
      name: "Acme Corp",
      avatarId: "avatar-acme",
      internal: false,
    });
  });

  it("carries the customer's prompt variables", async () => {
    seedKey({ dynamicVariables: { brand: "Acme" } });
    const record = await findEmbedKey("pk_dre_7f3a91c4");
    expect(record?.dynamicVariables).toEqual({ brand: "Acme" });
  });

  it.each([
    ["unknown", "pk_nope"],
    ["empty", ""],
    ["undefined", undefined],
  ])("returns null for a %s key", async (_label, key) => {
    seedKey();
    await expect(findEmbedKey(key)).resolves.toBeNull();
  });

  it("does not return a disabled key", async () => {
    seedKey({ enabled: false });
    await expect(findEmbedKey("pk_dre_7f3a91c4")).resolves.toBeNull();
  });

  it("always provides the reserved internal key, with no row behind it", async () => {
    await expect(findEmbedKey(INTERNAL_EMBED_KEY)).resolves.toMatchObject({ internal: true });
  });
});

describe("caching", () => {
  it("does not query the database for every lookup", async () => {
    seedKey();
    const findMany = vi.spyOn(
      (await import("../support/fakePrisma")).prisma.embedKey,
      "findMany",
    );

    await findEmbedKey("pk_dre_7f3a91c4");
    await findEmbedKey("pk_dre_7f3a91c4");
    await findEmbedKey(INTERNAL_EMBED_KEY);

    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("shares one refresh between concurrent lookups", async () => {
    seedKey();
    const findMany = vi.spyOn(
      (await import("../support/fakePrisma")).prisma.embedKey,
      "findMany",
    );

    await Promise.all([
      findEmbedKey("pk_dre_7f3a91c4"),
      findEmbedKey("pk_dre_7f3a91c4"),
      findEmbedKey("pk_dre_7f3a91c4"),
    ]);

    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("picks up a new key once the cache is cleared — no restart", async () => {
    await expect(findEmbedKey("pk_dre_later")).resolves.toBeNull();

    seedKey({ key: "pk_dre_later", name: "Added at runtime" });
    resetRegistryCache();

    await expect(findEmbedKey("pk_dre_later")).resolves.toMatchObject({
      name: "Added at runtime",
    });
  });
});

describe("when the database is unreachable", () => {
  it("serves the keys it already had when the refresh fails", async () => {
    vi.useFakeTimers();
    try {
      seedKey();
      await findEmbedKey("pk_dre_7f3a91c4");

      // Past the cache's TTL, so the next lookup tries to refresh.
      vi.advanceTimersByTime(31_000);
      failOnce(new Error("connection refused"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      // Stale beats blank: a database blip should not take embedding down.
      await expect(findEmbedKey("pk_dre_7f3a91c4")).resolves.toMatchObject({ name: "Acme Corp" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when it has nothing cached", async () => {
    seedKey();
    failOnce(new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(findEmbedKey("pk_dre_7f3a91c4")).resolves.toBeNull();
    // The first-party page keeps working, since it needs no row.
    await expect(findEmbedKey(INTERNAL_EMBED_KEY)).resolves.not.toBeNull();
  });
});

describe("embedOriginAllowed", () => {
  it("allows a listed origin", async () => {
    seedKey({ allowedOrigins: ["https://acme.example", "https://*.acme.example"] });
    const record = (await findEmbedKey("pk_dre_7f3a91c4"))!;
    expect(embedOriginAllowed(record, "https://www.acme.example")).toBe(true);
  });

  it("refuses an unlisted origin", async () => {
    vi.stubEnv("NODE_ENV", "production");
    seedKey();
    const record = (await findEmbedKey("pk_dre_7f3a91c4"))!;
    expect(embedOriginAllowed(record, "https://attacker.example")).toBe(false);
  });

  it("ties the internal key to the origin the request arrived at", async () => {
    const record = (await findEmbedKey(INTERNAL_EMBED_KEY))!;
    expect(embedOriginAllowed(record, "https://us.example", "https://us.example")).toBe(true);
    expect(embedOriginAllowed(record, "https://them.example", "https://us.example")).toBe(false);
    expect(embedOriginAllowed(record, "https://us.example")).toBe(false);
  });

  it("is off in production for localhost", async () => {
    vi.stubEnv("NODE_ENV", "production");
    seedKey();
    const record = (await findEmbedKey("pk_dre_7f3a91c4"))!;
    expect(embedOriginAllowed(record, "http://localhost:3000")).toBe(false);
  });
});

describe("the fake database", () => {
  it("is actually being used, not a real connection", () => {
    expect(db.keys).toEqual([]);
  });
});

describe("expiry", () => {
  const PAST = new Date(Date.now() - 1000);
  const FUTURE = new Date(Date.now() + 60_000);

  it("refuses a key past its expiry", async () => {
    seedKey({ expiresAt: PAST });
    await expect(findEmbedKey("pk_dre_7f3a91c4")).resolves.toBeNull();
  });

  it("allows a key that has not expired yet", async () => {
    seedKey({ expiresAt: FUTURE });
    await expect(findEmbedKey("pk_dre_7f3a91c4")).resolves.not.toBeNull();
  });

  it("allows a key with no expiry at all", async () => {
    seedKey({ expiresAt: null });
    await expect(findEmbedKey("pk_dre_7f3a91c4")).resolves.not.toBeNull();
  });

  it("stops working on time, even while still cached", async () => {
    vi.useFakeTimers();
    try {
      const expiresAt = new Date(Date.now() + 5_000);
      seedKey({ expiresAt });

      // Cached while valid...
      await expect(findEmbedKey("pk_dre_7f3a91c4")).resolves.not.toBeNull();

      // ...and still cached once it expires. Expiry is checked per lookup,
      // so it must not keep working until the cache happens to refresh.
      vi.advanceTimersByTime(6_000);
      await expect(findEmbedKey("pk_dre_7f3a91c4")).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports the expiry on the record", async () => {
    seedKey({ expiresAt: FUTURE });
    const record = await findEmbedKey("pk_dre_7f3a91c4");
    expect(record?.expiresAt).toEqual(FUTURE);
  });

  it("never expires the first-party key", async () => {
    await expect(findEmbedKey(INTERNAL_EMBED_KEY)).resolves.toMatchObject({ expiresAt: null });
  });
});

describe("hasExpired", () => {
  it("is exact at the boundary", () => {
    const expiresAt = new Date(Date.parse("2026-06-01T12:00:00Z"));
    const record = {
      key: "pk_dre_7f3a91c4",
      name: "Acme Corp",
      enabled: true,
      avatarId: "avatar-acme",
      allowedOrigins: ["https://acme.example"],
      expiresAt,
      maxConcurrentSessions: null,
      internal: false,
    };

    expect(hasExpired(record, expiresAt.getTime() - 1)).toBe(false);
    expect(hasExpired(record, expiresAt.getTime())).toBe(true);
  });

  it("never expires a key with no date", () => {
    const record = {
      key: "pk",
      name: "n",
      enabled: true,
      avatarId: "a",
      allowedOrigins: [],
      expiresAt: null,
      maxConcurrentSessions: null,
      internal: false,
    };
    expect(hasExpired(record, Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});

describe("the first-party page behind a proxy", () => {
  /**
   * nginx may or may not set `x-forwarded-proto`, so the page and the route
   * can disagree about the scheme while both mean this very host. Requiring
   * them to match made the first-party page unable to start a call.
   */
  it("matches its own host whichever scheme each side inferred", async () => {
    const record = (await findEmbedKey(INTERNAL_EMBED_KEY))!;
    expect(embedOriginAllowed(record, "https://avatar.dr-e.com", "http://avatar.dr-e.com")).toBe(
      true,
    );
    expect(embedOriginAllowed(record, "http://avatar.dr-e.com", "https://avatar.dr-e.com")).toBe(
      true,
    );
  });

  it("still refuses another host", async () => {
    const record = (await findEmbedKey(INTERNAL_EMBED_KEY))!;
    expect(embedOriginAllowed(record, "https://attacker.example", "https://avatar.dr-e.com")).toBe(
      false,
    );
  });

  it("still refuses another port on the same host", async () => {
    const record = (await findEmbedKey(INTERNAL_EMBED_KEY))!;
    expect(embedOriginAllowed(record, "http://localhost:3999", "http://localhost:3000")).toBe(
      false,
    );
  });

  it("refuses nonsense on either side", async () => {
    const record = (await findEmbedKey(INTERNAL_EMBED_KEY))!;
    expect(embedOriginAllowed(record, "not-an-origin", "https://avatar.dr-e.com")).toBe(false);
    expect(embedOriginAllowed(record, "https://avatar.dr-e.com", "not-an-origin")).toBe(false);
  });
});
