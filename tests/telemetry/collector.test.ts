import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCollector } from "@/telemetry/collector";

const ENDPOINT = "/api/footprints";
const GRANT = "grant-token";

let fetchMock: ReturnType<typeof vi.fn>;
let sendBeacon: ReturnType<typeof vi.fn>;

/**
 * Collectors listen on `window`, so one left alive by an earlier test would
 * answer this test's `pagehide` too. They are disposed after each case.
 */
const live: ReturnType<typeof createCollector>[] = [];

function collector(overrides: Record<string, unknown> = {}) {
  const instance = createCollector({ sessionKey: "session-key-1", grant: GRANT, ...overrides });
  live.push(instance);
  return instance;
}

function bodyOf(call: unknown[]): { events: { type: string; seq: number }[]; grant?: string } {
  const init = call[1] as RequestInit;
  return JSON.parse(init.body as string);
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  sendBeacon = vi.fn().mockReturnValue(true);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("navigator", { sendBeacon });
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

afterEach(() => {
  while (live.length) live.pop()!.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("batching", () => {
  it("does not send immediately", () => {
    collector().track({ type: "widget_opened" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends after the idle window", () => {
    collector({ idleFlushMs: 2000 }).track({ type: "widget_opened" });
    vi.advanceTimersByTime(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0]!).events).toHaveLength(1);
  });

  it("sends at once when the batch is full", () => {
    const c = collector({ batchSize: 3 });
    c.track({ type: "widget_opened" });
    c.track({ type: "mic_granted" });
    expect(fetchMock).not.toHaveBeenCalled();
    c.track({ type: "stream_ready" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0]!).events).toHaveLength(3);
  });

  it("numbers events so a late batch can still be ordered", () => {
    const c = collector({ batchSize: 2 });
    c.track({ type: "widget_opened" });
    c.track({ type: "mic_granted" });
    expect(bodyOf(fetchMock.mock.calls[0]!).events.map((e) => e.seq)).toEqual([0, 1]);
  });

  it("flushes nothing when there is nothing queued", () => {
    collector().flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("carries the grant in a header, not the body, for a normal flush", () => {
    const c = collector();
    c.track({ type: "widget_opened" });
    c.flush();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-embed-grant"]).toBe(GRANT);
    expect(bodyOf(fetchMock.mock.calls[0]!).grant).toBeUndefined();
  });
});

describe("surviving the unload", () => {
  it("beacons on pagehide, where fetch would be cancelled", () => {
    const c = collector();
    c.track({ type: "session_ended", reason: "page_hidden", durationMs: 1, turns: 0, interruptions: 0 });
    window.dispatchEvent(new Event("pagehide"));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("beacons when the page is hidden", () => {
    const c = collector();
    c.track({ type: "widget_opened" });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it("ignores a visibility change back to visible", () => {
    const c = collector();
    c.track({ type: "widget_opened" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("puts events back when the browser refuses the beacon", () => {
    sendBeacon.mockReturnValue(false);
    const c = collector();
    c.track({ type: "widget_opened" });
    window.dispatchEvent(new Event("pagehide"));

    c.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0]!).events).toHaveLength(1);
  });

  it("sends the grant in the beacon body, never in the URL", () => {
    const c = collector();
    c.track({ type: "widget_opened" });
    window.dispatchEvent(new Event("pagehide"));

    const [url] = sendBeacon.mock.calls[0] as [string, Blob];
    expect(url).toBe(ENDPOINT);
    expect(url).not.toContain(GRANT);
  });
});

describe("failure", () => {
  it("retries a 5xx twice, then gives up", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    const c = collector();
    c.track({ type: "widget_opened" });
    c.flush();

    for (let i = 0; i < 3; i += 1) {
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 4xx, which will not improve", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
    const c = collector();
    c.track({ type: "widget_opened" });
    c.flush();

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never throws when the network does", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const c = collector();
    expect(() => {
      c.track({ type: "widget_opened" });
      c.flush();
    }).not.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
  });
});

describe("dispose", () => {
  it("flushes what is left and stops listening", () => {
    const c = collector();
    c.track({ type: "widget_opened" });
    c.dispose();
    expect(sendBeacon).toHaveBeenCalledTimes(1);

    sendBeacon.mockClear();
    window.dispatchEvent(new Event("pagehide"));
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("ignores events tracked after disposal", () => {
    const c = collector();
    c.dispose();
    c.track({ type: "widget_opened" });
    c.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is safe to call twice", () => {
    const c = collector();
    c.track({ type: "widget_opened" });
    c.dispose();
    c.dispose();
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });
});
