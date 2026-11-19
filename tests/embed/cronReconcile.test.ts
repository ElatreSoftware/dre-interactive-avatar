import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ prisma: (await import("../support/fakePrisma")).prisma }));
vi.mock("@/embed/vendorSession", () => ({ fetchVendorSessionState: vi.fn() }));

import { GET, POST } from "@/app/api/cron/reconcile/route";
import { fetchVendorSessionState as realFetch } from "@/embed/vendorSession";
import { db, resetDb, seedActiveSession } from "../support/fakePrisma";

const fetchVendorSessionState = vi.mocked(realFetch);
const SECRET = "a-cron-secret-nobody-else-knows";
const OLD = new Date(Date.now() - 30 * 60_000);

function request(headers: Record<string, string> = {}, url = "http://localhost/api/cron/reconcile") {
  return new Request(url, { method: "POST", headers });
}

const authed = (extra: Record<string, string> = {}) =>
  request({ authorization: `Bearer ${SECRET}`, ...extra });

beforeEach(() => {
  resetDb();
  fetchVendorSessionState.mockReset();
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("authorization", () => {
  it("closes finished calls for an authorized run", async () => {
    seedActiveSession({ avatarSessionId: "sess_1", startedAt: OLD });
    fetchVendorSessionState.mockResolvedValue({
      state: "ended",
      endedAt: new Date(),
      reason: "USER_CLOSED",
    });

    const response = await POST(authed());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, checked: 1, closed: 1 });
    expect(db.activeSessions[0]).toMatchObject({ endReason: "USER_CLOSED" });
  });

  it("accepts the bare header form too", async () => {
    seedActiveSession({ avatarSessionId: "sess_1", startedAt: OLD });
    fetchVendorSessionState.mockResolvedValue({ state: "live" });

    const response = await POST(request({ "x-cron-secret": SECRET }));
    expect(response.status).toBe(200);
  });

  it("answers a GET as well, for runners that only do GETs", async () => {
    fetchVendorSessionState.mockResolvedValue({ state: "live" });
    const response = await GET(authed());
    expect(response.status).toBe(200);
  });

  it.each([
    ["no credentials", {}],
    ["the wrong secret", { authorization: "Bearer nope" }],
    ["an empty bearer", { authorization: "Bearer " }],
  ])("refuses a run with %s, and closes nothing", async (_label, headers) => {
    seedActiveSession({ avatarSessionId: "sess_1", startedAt: OLD });
    fetchVendorSessionState.mockResolvedValue({
      state: "ended",
      endedAt: new Date(),
      reason: "USER_CLOSED",
    });

    const response = await POST(request(headers));

    expect(response.status).toBe(401);
    expect(db.activeSessions[0]?.deletedAt).toBeNull();
    expect(fetchVendorSessionState).not.toHaveBeenCalled();
  });

  it("refuses to run at all when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    seedActiveSession({ avatarSessionId: "sess_1", startedAt: OLD });

    const response = await POST(authed());

    // Fails closed rather than running wide open.
    expect(response.status).toBe(500);
    expect(fetchVendorSessionState).not.toHaveBeenCalled();
  });
});

describe("the run itself", () => {
  it("leaves running calls alone", async () => {
    seedActiveSession({ avatarSessionId: "sess_1", startedAt: OLD });
    fetchVendorSessionState.mockResolvedValue({ state: "live" });

    await expect((await POST(authed())).json()).resolves.toEqual({
      ok: true,
      checked: 1,
      closed: 0,
    });
    expect(db.activeSessions[0]?.deletedAt).toBeNull();
  });

  it("closes nothing when LiveAvatar cannot be reached", async () => {
    seedActiveSession({ avatarSessionId: "sess_1", startedAt: OLD });
    fetchVendorSessionState.mockResolvedValue({ state: "unknown" });

    await POST(authed());

    // A vendor outage must not read as a room full of finished calls.
    expect(db.activeSessions[0]?.deletedAt).toBeNull();
  });

  it("honours a smaller limit from the query string", async () => {
    for (let i = 0; i < 5; i += 1) {
      seedActiveSession({ avatarSessionId: `s${i}`, startedAt: OLD });
    }
    fetchVendorSessionState.mockResolvedValue({ state: "live" });

    const response = await POST(
      request(
        { authorization: `Bearer ${SECRET}` },
        "http://localhost/api/cron/reconcile?limit=2",
      ),
    );

    await expect(response.json()).resolves.toMatchObject({ checked: 2 });
  });

  it("reports a failure rather than succeeding quietly", async () => {
    seedActiveSession({ avatarSessionId: "sess_1", startedAt: OLD });
    fetchVendorSessionState.mockRejectedValue(new Error("boom"));

    const response = await POST(authed());

    // A job that 200s every minute while closing nothing is worse than one
    // that goes red: the cron runner's own alerting should see this.
    expect(response.status).toBe(500);
  });

  it("does not touch a call too fresh for the vendor to know", async () => {
    seedActiveSession({ avatarSessionId: "fresh", startedAt: new Date() });

    await expect((await POST(authed())).json()).resolves.toMatchObject({ checked: 0 });
    expect(fetchVendorSessionState).not.toHaveBeenCalled();
  });
});
