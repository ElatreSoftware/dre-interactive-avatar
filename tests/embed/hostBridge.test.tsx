import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOST_SOURCE, PROTOCOL_VERSION } from "@/embed/protocol";
import { useHostBridge } from "@/embed/useHostBridge";

const HOST_ORIGIN = "https://acme.example";

let postMessage: ReturnType<typeof vi.fn>;
let parent: { postMessage: typeof postMessage };

/** A `message` event cannot be constructed with a `source`, so it is assigned. */
function deliver(data: unknown, origin = HOST_ORIGIN, source: unknown = parent): void {
  const event = new MessageEvent("message", { data, origin });
  Object.defineProperty(event, "source", { value: source });
  act(() => {
    window.dispatchEvent(event);
  });
}

function hostMessage(type: string, extra: Record<string, unknown> = {}) {
  return { source: HOST_SOURCE, v: PROTOCOL_VERSION, type, ...extra };
}

beforeEach(() => {
  postMessage = vi.fn();
  parent = { postMessage };
  vi.stubGlobal("parent", parent);
  Object.defineProperty(window, "parent", { value: parent, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, "parent", { value: window, configurable: true });
});

describe("useHostBridge", () => {
  it("learns where to reply from a hello, and does not answer it", () => {
    const { result } = renderHook(() => useHostBridge());
    deliver(hostMessage("hello"));

    // `ready` is an announcement, not an answer: the host greets again on
    // hearing it, so answering would be an endless exchange.
    expect(postMessage).not.toHaveBeenCalled();
    expect(result.current.parentOrigin).toBe(HOST_ORIGIN);

    act(() => result.current.reportLayout("expanded"));
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "resize" }),
      HOST_ORIGIN,
    );
  });

  it("learns the parent origin from the event, not the message body", () => {
    const { result } = renderHook(() => useHostBridge());
    deliver(hostMessage("hello", { parentOrigin: "https://attacker.example" }), HOST_ORIGIN);
    expect(result.current.parentOrigin).toBe(HOST_ORIGIN);
  });

  it("carries the embedder's opaque user id", () => {
    const { result } = renderHook(() => useHostBridge());
    deliver(hostMessage("hello", { userId: "customer-42" }));
    expect(result.current.userId).toBe("customer-42");
  });

  it("takes the host's viewport, which it cannot measure itself", () => {
    const { result } = renderHook(() => useHostBridge());
    deliver(hostMessage("hello", { viewport: { width: 1440, height: 900 } }));
    expect(result.current.hostViewport).toEqual({ width: 1440, height: 900 });
  });

  it("ignores a malformed viewport", () => {
    const { result } = renderHook(() => useHostBridge());
    deliver(hostMessage("hello", { viewport: { width: "wide" } }));
    expect(result.current.hostViewport).toBeNull();
  });

  it("tolerates a repeated hello", () => {
    const { result } = renderHook(() => useHostBridge());
    deliver(hostMessage("hello", { userId: "a" }));
    deliver(hostMessage("hello", { userId: "b" }));
    expect(result.current.userId).toBe("b");
    expect(postMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["a message from somewhere other than the parent", hostMessage("hello"), HOST_ORIGIN, {}],
    ["a foreign source tag", { source: "evil", v: 1, type: "hello" }, HOST_ORIGIN, undefined],
    ["an unknown type", hostMessage("destroy"), HOST_ORIGIN, undefined],
  ])("ignores %s", (_label, data, origin, source) => {
    const { result } = renderHook(() => useHostBridge());
    deliver(data, origin, source === undefined ? parent : source);
    expect(postMessage).not.toHaveBeenCalled();
    expect(result.current.parentOrigin).toBeNull();
  });

  it("passes open and close requests straight to their handlers", () => {
    const onOpenRequest = vi.fn();
    const onCloseRequest = vi.fn();
    renderHook(() => useHostBridge(undefined, { onOpenRequest, onCloseRequest }));

    deliver(hostMessage("hello"));
    deliver(hostMessage("open"));
    expect(onOpenRequest).toHaveBeenCalledTimes(1);

    deliver(hostMessage("open"));
    expect(onOpenRequest).toHaveBeenCalledTimes(2);

    deliver(hostMessage("close"));
    expect(onCloseRequest).toHaveBeenCalledTimes(1);
  });

  it("ignores an open request that did not come from the parent", () => {
    const onOpenRequest = vi.fn();
    renderHook(() => useHostBridge(undefined, { onOpenRequest }));
    deliver(hostMessage("open"), HOST_ORIGIN, {});
    expect(onOpenRequest).not.toHaveBeenCalled();
  });

  it("stays silent until it knows where to send things", () => {
    const { result } = renderHook(() => useHostBridge());
    act(() => result.current.reportLayout("expanded"));
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("asks for room when the stage opens, and gives it back on close", () => {
    const { result } = renderHook(() => useHostBridge());
    deliver(hostMessage("hello"));
    postMessage.mockClear();

    act(() => {
      result.current.reportLayout("expanded");
      result.current.reportOpen(true);
    });
    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: "resize", layout: "expanded" }),
      HOST_ORIGIN,
    );
    expect(postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: "opened" }),
      HOST_ORIGIN,
    );

    postMessage.mockClear();
    act(() => {
      result.current.reportLayout("notice");
      result.current.reportOpen(false);
    });
    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: "resize", layout: "notice" }),
      HOST_ORIGIN,
    );
  });

  it("reports errors to the host", () => {
    const { result } = renderHook(() => useHostBridge());
    deliver(hostMessage("hello"));
    postMessage.mockClear();
    act(() => result.current.reportError("mic blocked"));
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", message: "mic blocked" }),
      HOST_ORIGIN,
    );
  });

  it("removes its listener on unmount", () => {
    const { unmount } = renderHook(() => useHostBridge());
    unmount();
    deliver(hostMessage("hello"));
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe("announcing itself", () => {
  it("speaks first when the server has told it who framed us", () => {
    renderHook(() => useHostBridge(HOST_ORIGIN));
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ready" }),
      HOST_ORIGIN,
    );
  });

  it("can report a layout before any hello arrives", () => {
    const { result } = renderHook(() => useHostBridge(HOST_ORIGIN));
    postMessage.mockClear();
    act(() => result.current.reportLayout("expanded"));
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "resize", layout: "expanded" }),
      HOST_ORIGIN,
    );
  });

  it("stays quiet when it is not framed", () => {
    Object.defineProperty(window, "parent", { value: window, configurable: true });
    renderHook(() => useHostBridge(HOST_ORIGIN));
    expect(postMessage).not.toHaveBeenCalled();
  });
});
