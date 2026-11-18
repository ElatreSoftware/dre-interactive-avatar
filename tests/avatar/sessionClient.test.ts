import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionTokenError, fetchSessionCredentials } from "@/avatar/sessionClient";
import type { AvatarConfig } from "@/avatar";

const config: AvatarConfig = { avatarId: "avatar-1" };

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

function respond(status: number, payload: unknown) {
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("fetchSessionCredentials", () => {
  it("returns the credentials from the default endpoint", async () => {
    respond(200, { sessionId: "s", sessionToken: "t" });
    await expect(fetchSessionCredentials(config)).resolves.toEqual({
      sessionId: "s",
      sessionToken: "t",
    });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("/api/avatar/session");
  });

  it("honours a custom endpoint and forwards config", async () => {
    respond(200, { sessionId: "s", sessionToken: "t" });
    await fetchSessionCredentials({
      ...config,
      sessionEndpoint: "/custom",
      isSandbox: true,
      dynamicVariables: { tier: "pro" },
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/custom");
    expect(JSON.parse(init.body as string)).toEqual({
      avatarId: "avatar-1",
      isSandbox: true,
      dynamicVariables: { tier: "pro" },
    });
  });

  it("throws on a non-OK response", async () => {
    respond(500, { error: "nope" });
    await expect(fetchSessionCredentials(config)).rejects.toBeInstanceOf(SessionTokenError);
  });

  it("throws on a malformed payload", async () => {
    respond(200, { sessionId: "s" });
    await expect(fetchSessionCredentials(config)).rejects.toBeInstanceOf(SessionTokenError);
    respond(200, null);
    await expect(fetchSessionCredentials(config)).rejects.toBeInstanceOf(SessionTokenError);
  });
});
