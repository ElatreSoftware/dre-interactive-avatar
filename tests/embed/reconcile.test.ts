import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ prisma: (await import("../support/fakePrisma")).prisma }));

vi.mock("@/embed/vendorSession", () => ({ fetchVendorSessionState: vi.fn() }));

import { reconcileSessions } from "@/embed/reconcile";
import { fetchVendorSessionState as realFetch } from "@/embed/vendorSession";
import { db, resetDb, seedActiveSession } from "../support/fakePrisma";

const fetchVendorSessionState = vi.mocked(realFetch);

const NOW = Date.parse("2026-06-01T12:00:00Z");
const MINUTE = 60_000;
/** Older than the grace period, so the vendor's answer counts. */
const STARTED = new Date(NOW - 10 * MINUTE);

beforeEach(() => {
  resetDb();
  fetchVendorSessionState.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function row(overrides = {}) {
  return seedActiveSession({ startedAt: STARTED, ...overrides });
}

describe("reconcileSessions", () => {
  it("closes a call the vendor says has ended, with its reason", async () => {
    row({ avatarSessionId: "sess_1" });
    const endedAt = new Date(NOW - MINUTE);
    fetchVendorSessionState.mockResolvedValue({ state: "ended", endedAt, reason: "USER_CLOSED" });

    await expect(reconcileSessions(NOW)).resolves.toEqual({ checked: 1, closed: 1 });
    expect(db.activeSessions[0]).toMatchObject({ deletedAt: endedAt, endReason: "USER_CLOSED" });
  });

  it("closes a call the vendor has never heard of", async () => {
    row({ avatarSessionId: "sess_1" });
    fetchVendorSessionState.mockResolvedValue({ state: "gone" });

    await expect(reconcileSessions(NOW)).resolves.toEqual({ checked: 1, closed: 1 });
    expect(db.activeSessions[0]?.endReason).toBe("VENDOR_UNKNOWN_SESSION");
  });

  it("leaves a running call alone", async () => {
    row({ avatarSessionId: "sess_1" });
    fetchVendorSessionState.mockResolvedValue({ state: "live" });

    await expect(reconcileSessions(NOW)).resolves.toEqual({ checked: 1, closed: 0 });
    expect(db.activeSessions[0]?.deletedAt).toBeNull();
  });

  it("closes nothing when the vendor cannot be reached", async () => {
    row({ avatarSessionId: "sess_1" });
    row({ avatarSessionId: "sess_2" });
    fetchVendorSessionState.mockResolvedValue({ state: "unknown" });

    // The whole point: an outage at LiveAvatar must not read as a room full
    // of finished calls and cut off everyone still talking.
    await expect(reconcileSessions(NOW)).resolves.toEqual({ checked: 2, closed: 0 });
    expect(db.activeSessions.every((r) => r.deletedAt === null)).toBe(true);
  });

  it("does not ask about a call that has only just been minted", async () => {
    // The vendor can legitimately not know a session yet: it is minted here
    // before the browser starts it.
    row({ avatarSessionId: "fresh", startedAt: new Date(NOW - 5_000) });

    await expect(reconcileSessions(NOW)).resolves.toEqual({ checked: 0, closed: 0 });
    expect(fetchVendorSessionState).not.toHaveBeenCalled();
  });

  it("does not ask about calls that are already closed", async () => {
    row({ avatarSessionId: "done", deletedAt: new Date(NOW - MINUTE) });
    await reconcileSessions(NOW);
    expect(fetchVendorSessionState).not.toHaveBeenCalled();
  });

  it("can be narrowed to one customer", async () => {
    row({ avatarSessionId: "mine", embedKeyValue: "pk_mine" });
    row({ avatarSessionId: "theirs", embedKeyValue: "pk_theirs" });
    fetchVendorSessionState.mockResolvedValue({ state: "ended", endedAt: new Date(NOW), reason: "X" });

    await expect(reconcileSessions(NOW, { embedKeyValue: "pk_mine" })).resolves.toEqual({ checked: 1, closed: 1 });
    expect(fetchVendorSessionState).toHaveBeenCalledWith("mine");
  });

  it("keeps the vendor's own ending time, not the time we noticed", async () => {
    row({ avatarSessionId: "sess_1" });
    const endedAt = new Date(NOW - 7 * MINUTE);
    fetchVendorSessionState.mockResolvedValue({ state: "ended", endedAt, reason: "IDLE_TIMEOUT" });

    await reconcileSessions(NOW);
    expect(db.activeSessions[0]?.deletedAt).toEqual(endedAt);
  });

  it("asks one at a time rather than bursting at the rate limit", async () => {
    for (let i = 0; i < 4; i += 1) row({ avatarSessionId: `s${i}` });
    let inFlight = 0;
    let peak = 0;
    fetchVendorSessionState.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { state: "live" };
    });

    await reconcileSessions(NOW);
    expect(peak).toBe(1);
  });
});
