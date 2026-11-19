import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ prisma: (await import("../support/fakePrisma")).prisma }));

import {
  checkConcurrency,
  claimSession,
  countActiveSessions,
  linkSession,
  releaseSession,
  touchSession,
} from "@/embed/concurrency";
import type { EmbedKeyRecord } from "@/embed/registry";
import { db, failOnce, resetDb, seedActiveSession } from "../support/fakePrisma";

const NOW = Date.parse("2026-06-01T12:00:00Z");
const MINUTE = 60_000;

function record(maxConcurrentSessions: number | null): EmbedKeyRecord {
  return {
    key: "pk_dre_7f3a91c4",
    name: "Acme Corp",
    enabled: true,
    avatarId: "avatar-acme",
    allowedOrigins: ["https://acme.example"],
    expiresAt: null,
    maxConcurrentSessions,
  };
}

beforeEach(() => resetDb());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("checkConcurrency", () => {
  it("allows anything when no limit is set", async () => {
    for (let i = 0; i < 20; i += 1) seedActiveSession({ avatarSessionId: `s${i}` });
    await expect(checkConcurrency(record(null), NOW)).resolves.toEqual({ ok: true });
  });

  it("allows a call below the limit", async () => {
    seedActiveSession({ avatarSessionId: "s1" });
    await expect(checkConcurrency(record(2), NOW)).resolves.toEqual({ ok: true });
  });

  it("refuses at the limit, and says where it stands", async () => {
    seedActiveSession({ avatarSessionId: "s1" });
    seedActiveSession({ avatarSessionId: "s2" });
    await expect(checkConcurrency(record(2), NOW)).resolves.toEqual({
      ok: false,
      active: 2,
      limit: 2,
    });
  });

  it("counts only this customer's calls", async () => {
    seedActiveSession({ avatarSessionId: "s1", embedKeyValue: "pk_someone_else" });
    seedActiveSession({ avatarSessionId: "s2", embedKeyValue: "pk_someone_else" });
    await expect(checkConcurrency(record(1), NOW)).resolves.toEqual({ ok: true });
  });

  it("treats a limit of zero as no limit, not as a ban", async () => {
    seedActiveSession({ avatarSessionId: "s1" });
    await expect(checkConcurrency(record(0), NOW)).resolves.toEqual({ ok: true });
  });
});

describe("stale sessions", () => {
  /**
   * A browser that crashes or loses power never says goodbye, so a slot that
   * nothing has touched for a while has to be reclaimed — otherwise a
   * customer's limit ratchets down to zero and stays there.
   */
  it("reclaims a slot nothing has been heard from, without losing the record", async () => {
    seedActiveSession({ avatarSessionId: "ghost", lastSeenAt: new Date(NOW - 4 * MINUTE) });
    seedActiveSession({ avatarSessionId: "live", lastSeenAt: new Date(NOW - MINUTE) });

    await expect(countActiveSessions("pk_dre_7f3a91c4", NOW)).resolves.toBe(1);

    // Both rows are still there; only one of them still counts.
    expect(db.activeSessions).toHaveLength(2);
    const ghost = db.activeSessions.find((row) => row.avatarSessionId === "ghost")!;
    const live = db.activeSessions.find((row) => row.avatarSessionId === "live")!;
    expect(ghost.deletedAt).toBeInstanceOf(Date);
    expect(live.deletedAt).toBeNull();
  });

  it("does not close the same ghost twice", async () => {
    const closedAt = new Date(NOW - 5 * MINUTE);
    seedActiveSession({
      avatarSessionId: "ghost",
      lastSeenAt: new Date(NOW - 4 * MINUTE),
      deletedAt: closedAt,
    });

    await countActiveSessions("pk_dre_7f3a91c4", NOW);
    // The time it stopped counting is when it stopped counting, not now.
    expect(db.activeSessions[0]!.deletedAt).toEqual(closedAt);
  });

  it("keeps a call whose heartbeat is still arriving", async () => {
    seedActiveSession({ avatarSessionId: "live", lastSeenAt: new Date(NOW - 2 * MINUTE) });
    await expect(countActiveSessions("pk_dre_7f3a91c4", NOW)).resolves.toBe(1);
  });
});

describe("the life of a slot", () => {
  it("is claimed, linked, refreshed and released", async () => {
    await claimSession("pk_dre_7f3a91c4", "vendor-1");
    expect(db.activeSessions).toHaveLength(1);

    await linkSession("vendor-1", "widget-1");
    expect(db.activeSessions[0]!.sessionKey).toBe("widget-1");

    const before = db.activeSessions[0]!.lastSeenAt.getTime();
    await new Promise((resolve) => setTimeout(resolve, 2));
    await touchSession("widget-1");
    expect(db.activeSessions[0]!.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before);

    await releaseSession("widget-1");
    expect(db.activeSessions).toHaveLength(1);
    expect(db.activeSessions[0]!.deletedAt).toBeInstanceOf(Date);
  });

  it("stops counting once released", async () => {
    await claimSession("pk_dre_7f3a91c4", "vendor-1");
    await linkSession("vendor-1", "widget-1");
    await expect(countActiveSessions("pk_dre_7f3a91c4", NOW)).resolves.toBe(1);

    await releaseSession("widget-1");
    await expect(countActiveSessions("pk_dre_7f3a91c4", NOW)).resolves.toBe(0);
  });

  it("does not revive a closed call when a late event arrives", async () => {
    seedActiveSession({
      avatarSessionId: "vendor-1",
      sessionKey: "widget-1",
      deletedAt: new Date(NOW - MINUTE),
    });

    // A batch flushed after the call ended must not take the line back.
    await touchSession("widget-1");
    expect(db.activeSessions[0]!.deletedAt).toBeInstanceOf(Date);
    await expect(countActiveSessions("pk_dre_7f3a91c4", NOW)).resolves.toBe(0);
  });

  it("keeps the record of a released call for later", async () => {
    await claimSession("pk_dre_7f3a91c4", "vendor-1");
    await linkSession("vendor-1", "widget-1");
    await releaseSession("widget-1");

    const [row] = db.activeSessions;
    expect(row).toMatchObject({
      avatarSessionId: "vendor-1",
      sessionKey: "widget-1",
      embedKeyValue: "pk_dre_7f3a91c4",
    });
    expect(row!.startedAt).toBeInstanceOf(Date);
  });

  it("claims the same vendor session only once", async () => {
    await claimSession("pk_dre_7f3a91c4", "vendor-1");
    await claimSession("pk_dre_7f3a91c4", "vendor-1");
    expect(db.activeSessions).toHaveLength(1);
  });

  it("releases nothing for an unknown session", async () => {
    seedActiveSession({ avatarSessionId: "s1", sessionKey: "widget-1" });
    await releaseSession("widget-elsewhere");
    expect(db.activeSessions[0]!.deletedAt).toBeNull();
  });
});

describe("when the database misbehaves", () => {
  it.each([
    ["claim", () => claimSession("pk_dre_7f3a91c4", "vendor-1")],
    ["link", () => linkSession("vendor-1", "widget-1")],
    ["touch", () => touchSession("widget-1")],
    ["release", () => releaseSession("widget-1")],
  ])("does not let a failed %s break the call", async (_label, run) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    failOnce(new Error("connection refused"));
    await expect(run()).resolves.toBeUndefined();
  });
});

describe("a session that is simply too old", () => {
  /**
   * The quiet check trusts a stream of events: while something keeps
   * arriving, the row stays open. That is right for a real call and wrong for
   * anything stuck — a page left open in a background tab, a loop that keeps
   * reporting. Vendor sessions have their own maximum duration well under an
   * hour, so an hour-old row is not a call any more.
   */
  it("frees the line after an hour, however recently it reported in", async () => {
    seedActiveSession({
      avatarSessionId: "marathon",
      startedAt: new Date(NOW - 61 * MINUTE),
      lastSeenAt: new Date(NOW - 1000), // chatty right up to now
    });

    await expect(countActiveSessions("pk_dre_7f3a91c4", NOW)).resolves.toBe(0);
    expect(db.activeSessions[0]!.deletedAt).toBeInstanceOf(Date);
  });

  it("leaves a long call alone before the hour is up", async () => {
    seedActiveSession({
      avatarSessionId: "long",
      startedAt: new Date(NOW - 59 * MINUTE),
      lastSeenAt: new Date(NOW - 1000),
    });

    await expect(countActiveSessions("pk_dre_7f3a91c4", NOW)).resolves.toBe(1);
  });

  it("lets the next caller through once the old one is swept", async () => {
    seedActiveSession({
      avatarSessionId: "stuck",
      startedAt: new Date(NOW - 2 * 60 * MINUTE),
      lastSeenAt: new Date(NOW - 1000),
    });

    // Limit of one, and the one is occupied by something that cannot be a
    // call any more. The caller asking is what clears it.
    await expect(checkConcurrency(record(1), NOW)).resolves.toEqual({ ok: true });
  });

  it("takes the configured age when one is set", async () => {
    vi.stubEnv("SESSION_MAX_AGE_MINUTES", "15");
    seedActiveSession({
      avatarSessionId: "stuck",
      startedAt: new Date(NOW - 16 * MINUTE),
      lastSeenAt: new Date(NOW - 1000),
    });

    await expect(countActiveSessions("pk_dre_7f3a91c4", NOW)).resolves.toBe(0);
  });

  it("ignores a nonsensical configured age", async () => {
    vi.stubEnv("SESSION_MAX_AGE_MINUTES", "soon");
    seedActiveSession({
      avatarSessionId: "fine",
      startedAt: new Date(NOW - 30 * MINUTE),
      lastSeenAt: new Date(NOW - 1000),
    });

    // Falls back to the hour, so this is still live.
    await expect(countActiveSessions("pk_dre_7f3a91c4", NOW)).resolves.toBe(1);
  });
});

describe("the quiet window", () => {
  it("is three minutes by default, now that calls send a heartbeat", async () => {
    seedActiveSession({ avatarSessionId: "quiet", lastSeenAt: new Date(NOW - 4 * MINUTE) });
    await expect(countActiveSessions("pk_dre_7f3a91c4", NOW)).resolves.toBe(0);

    resetDb();
    seedActiveSession({ avatarSessionId: "beating", lastSeenAt: new Date(NOW - 2 * MINUTE) });
    await expect(countActiveSessions("pk_dre_7f3a91c4", NOW)).resolves.toBe(1);
  });

  it("takes a configured window", async () => {
    vi.stubEnv("SESSION_STALE_MINUTES", "5");
    seedActiveSession({ avatarSessionId: "quiet", lastSeenAt: new Date(NOW - 4 * MINUTE) });
    await expect(countActiveSessions("pk_dre_7f3a91c4", NOW)).resolves.toBe(1);
  });

  it("refuses to go under two minutes, whatever it is told", async () => {
    // Below two heartbeats, a live call loses its line between beats and a
    // second caller gets in while the first is still talking.
    vi.stubEnv("SESSION_STALE_MINUTES", "0.5");
    seedActiveSession({ avatarSessionId: "beating", lastSeenAt: new Date(NOW - 90 * 1000) });
    await expect(countActiveSessions("pk_dre_7f3a91c4", NOW)).resolves.toBe(1);
  });
});

