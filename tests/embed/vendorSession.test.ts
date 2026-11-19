import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchVendorSessionState } from "@/embed/vendorSession";
import { resetServerEnvCache } from "@/lib/env";

const ENV = {
  LIVEAVATAR_API_KEY: "key-123",
  LIVEAVATAR_ELEVENLABS_SECRET_ID: "secret-1",
  ELEVENLABS_AGENT_ID: "agent-1",
  LIVEAVATAR_API_URL: "https://api.liveavatar.test",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  resetServerEnvCache();
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
});

afterEach(() => {
  resetServerEnvCache();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("fetchVendorSessionState", () => {
  it("reports a session with no ending as live", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: { id: "s1" } })));
    await expect(fetchVendorSessionState("s1")).resolves.toEqual({ state: "live" });
  });

  it("reads the ending from end_at and end_reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({ data: { id: "s1", end_at: "2026-06-01T12:00:00Z", end_reason: "USER_CLOSED" } }),
      ),
    );
    await expect(fetchVendorSessionState("s1")).resolves.toEqual({
      state: "ended",
      endedAt: new Date("2026-06-01T12:00:00Z"),
      reason: "USER_CLOSED",
    });
  });

  it("still counts as ended when the reason is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ data: { id: "s1", end_at: "2026-06-01T12:00:00Z" } })),
    );
    const result = await fetchVendorSessionState("s1");
    expect(result).toMatchObject({ state: "ended", reason: "UNKNOWN" });
  });

  it.each([400, 404])(
    "treats a %i with a null body as a session that is certainly not running",
    async (status) => {
      // What LiveAvatar actually answers for an unknown id is 400 with
      // `{"code":4000,"data":null,"message":"Session not found"}` — not a
      // 404. Verified against the live API.
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(json({ code: 4000, data: null, message: "Session not found" }, status)),
      );
      await expect(fetchVendorSessionState("s1")).resolves.toEqual({ state: "gone" });
    },
  );

  it("reads a naive timestamp as UTC, not as the server's local time", async () => {
    // LiveAvatar returns `2026-11-18T14:36:47` with no zone, which JS would
    // otherwise read as local time — hours out on any non-UTC server.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ data: { id: "s1", end_at: "2026-11-18T14:36:47" } })),
    );
    const result = await fetchVendorSessionState("s1");
    expect(result).toMatchObject({
      state: "ended",
      endedAt: new Date("2026-11-18T14:36:47Z"),
    });
  });

  it("respects a timestamp that does carry a zone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ data: { id: "s1", end_at: "2026-11-18T14:36:47+05:30" } })),
    );
    await expect(fetchVendorSessionState("s1")).resolves.toMatchObject({
      endedAt: new Date("2026-11-18T09:06:47Z"),
    });
  });

  it.each([
    ["a server error", () => json({}, 500)],
    ["a refusal", () => json({}, 401)],
    ["a 400 that is not a missing session", () => json({ code: 5000 }, 400)],
    ["an unrecognised shape", () => json({ nonsense: true })],
    ["invalid json", () => new Response("<html>", { status: 200 })],
  ])("decides nothing on %s", async (_label, make) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(make()));
    await expect(fetchVendorSessionState("s1")).resolves.toEqual({ state: "unknown" });
  });

  it("decides nothing when the vendor is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(fetchVendorSessionState("s1")).resolves.toEqual({ state: "unknown" });
  });

  it("decides nothing when the server is not configured", async () => {
    vi.stubEnv("LIVEAVATAR_API_KEY", "");
    resetServerEnvCache();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchVendorSessionState("s1")).resolves.toEqual({ state: "unknown" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("authenticates with the api key and escapes the id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: { id: "a/b" } }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchVendorSessionState("a/b");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.liveavatar.test/v1/sessions/a%2Fb");
    expect(init.headers["X-API-KEY"]).toBe("key-123");
  });
});
