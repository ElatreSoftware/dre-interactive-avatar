import { afterEach, describe, expect, it, vi } from "vitest";
import { requestMicrophoneAccess } from "@/avatar/microphone";

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    writable: true,
    value,
  });
}

afterEach(() => setMediaDevices({}));

describe("requestMicrophoneAccess", () => {
  it("grants and releases the track immediately", async () => {
    const stop = vi.fn();
    setMediaDevices({
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }, { stop }] }),
    });

    await expect(requestMicrophoneAccess()).resolves.toBe("granted");
    // We want the permission, not the stream; holding it would pin the mic
    // indicator on before the call even starts.
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("reports a refusal", async () => {
    const denied = new Error("Permission denied");
    denied.name = "NotAllowedError";
    setMediaDevices({ getUserMedia: vi.fn().mockRejectedValue(denied) });

    await expect(requestMicrophoneAccess()).resolves.toBe("denied");
  });

  it("treats an insecure context as a refusal", async () => {
    const blocked = new Error("Only secure origins");
    blocked.name = "SecurityError";
    setMediaDevices({ getUserMedia: vi.fn().mockRejectedValue(blocked) });

    await expect(requestMicrophoneAccess()).resolves.toBe("denied");
  });

  it("reports a missing device as unavailable, not a refusal", async () => {
    const missing = new Error("no device");
    missing.name = "NotFoundError";
    setMediaDevices({ getUserMedia: vi.fn().mockRejectedValue(missing) });

    await expect(requestMicrophoneAccess()).resolves.toBe("unavailable");
  });

  it("reports unavailable when the browser has no media API", async () => {
    setMediaDevices(undefined);
    await expect(requestMicrophoneAccess()).resolves.toBe("unavailable");
    setMediaDevices({});
    await expect(requestMicrophoneAccess()).resolves.toBe("unavailable");
  });
});

describe("inside an iframe", () => {
  afterEach(() => {
    Object.defineProperty(window, "parent", { value: window, configurable: true });
    Reflect.deleteProperty(document, "featurePolicy");
  });

  function frameWith(allowsMicrophone: boolean | null): void {
    Object.defineProperty(window, "parent", { value: {}, configurable: true });
    if (allowsMicrophone === null) return;
    Object.defineProperty(document, "featurePolicy", {
      value: { allowsFeature: (feature: string) => feature !== "microphone" || allowsMicrophone },
      configurable: true,
    });
  }

  it("blames the embedding page when it has not granted the microphone", async () => {
    frameWith(false);
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    await expect(requestMicrophoneAccess()).resolves.toBe("blocked_by_embedder");
    // Never prompts: there is nothing the visitor could answer that would help.
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("proceeds normally when the embedding page has granted it", async () => {
    frameWith(true);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
    });
    await expect(requestMicrophoneAccess()).resolves.toBe("granted");
  });

  it("says nothing when the browser cannot tell us", async () => {
    frameWith(null);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
    });
    await expect(requestMicrophoneAccess()).resolves.toBe("granted");
  });
});
