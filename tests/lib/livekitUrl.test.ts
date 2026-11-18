import { describe, expect, it, vi } from "vitest";
import { maskLivekitUrl } from "@/lib/livekitUrl";
describe("maskLivekitUrl", () => {
  it("replaces only data.livekit_url", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const body = JSON.stringify({
      code: 1000,
      data: { livekit_url: "wss://heygen-abc.livekit.cloud", livekit_client_token: "t" },
    });
    expect(JSON.parse(maskLivekitUrl(body))).toEqual({
      code: 1000,
      data: { livekit_url: "wss://livekit", livekit_client_token: "t" },
    });
  });

  it("returns bodies it cannot interpret unchanged", () => {
    expect(maskLivekitUrl("not json")).toBe("not json");
    expect(maskLivekitUrl('{"data":null}')).toBe('{"data":null}');
  });
});
