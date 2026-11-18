import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSession, stubMicrophone, stubSessionEndpoint } from "../avatar/fakeSession";

vi.mock("@elatre/liveavatar-web-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof SdkModule>();
  return { ...actual, ElevenLabsAgentSession: FakeSession };
});

import type * as SdkModule from "@elatre/liveavatar-web-sdk";
import { AgentEventsEnum, SessionEvent } from "@elatre/liveavatar-web-sdk";
import { AvatarProvider, MessageSender, useSession, type AvatarMessage } from "@/avatar";
import { InteractiveAvatar } from "@/components/avatar";
import { FootprintRecorder, useFootprints } from "@/telemetry";
import type { FootprintPayload } from "@/telemetry";

let sent: FootprintPayload[];
let sendBeacon: ReturnType<typeof vi.fn>;

/**
 * Captures what the collector would have posted, without a network.
 *
 * Both mocks push into the array captured here rather than into the `sent`
 * variable: a collector disposed during cleanup beacons asynchronously, and
 * through the variable those events would land in the *next* test's results.
 */
function captureFlushes(): void {
  const captured: FootprintPayload[] = [];
  sent = captured;

  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/footprints")) {
        const body = JSON.parse(init.body as string) as { events: FootprintPayload[] };
        captured.push(...body.events);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ sessionId: "s", sessionToken: "t" }), { status: 200 }),
      );
    }),
  );
  // jsdom's Blob cannot be read back — no `text()`, and `Response` makes
  // "[object Blob]" of it — so it is replaced with something that keeps its
  // contents. Reading the body matters: a beacon is how the end of a call
  // leaves the browser, and asserting only that one was sent would not notice
  // an empty one.
  class ReadableBlob {
    readonly text: string;
    constructor(parts: string[]) {
      this.text = parts.join("");
    }
  }
  vi.stubGlobal("Blob", ReadableBlob);

  sendBeacon = vi.fn((_url: string, blob: ReadableBlob) => {
    captured.push(...(JSON.parse(blob.text) as { events: FootprintPayload[] }).events);
    return true;
  });
  vi.stubGlobal("navigator", {
    sendBeacon,
    language: "en-GB",
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
  });
}

function typesOf(): string[] {
  return sent.map((event) => event.type);
}

beforeEach(() => {
  FakeSession.last = null;
  captureFlushes();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useFootprints", () => {
  function setup(options: Record<string, unknown> = {}) {
    return renderHook(() =>
      useFootprints({ sessionKey: "session-1", grant: "grant-1", ...options }),
    );
  }

  it("describes the embed as soon as it starts", async () => {
    const { result } = setup();
    act(() => result.current.flush());
    await waitFor(() => expect(typesOf()).toContain("widget_loaded"));
  });

  it("records nothing at all when disabled", async () => {
    const { result } = setup({ enabled: false });
    act(() => result.current.track({ type: "widget_opened" }));
    result.current.onEvent({ type: "session_requested" });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toHaveLength(0);
  });

  it("carries the embedder's user id, and nothing it was not given", async () => {
    const { result } = setup({ userId: "customer-42" });
    act(() => result.current.flush());
    await waitFor(() => expect(typesOf()).toContain("widget_loaded"));

    const loaded = sent.find((event) => event.type === "widget_loaded");
    expect(loaded).toMatchObject({ userId: "customer-42", locale: "en-GB" });
  });

  it("summarises the call when it ends", async () => {
    const { result } = setup();
    act(() => {
      result.current.onEvent({ type: "session_requested" });
      result.current.onEvent({ type: "interruption" });
      result.current.onEvent({ type: "interruption" });
      result.current.onMessages([message("a"), message("b")]);
      result.current.onEvent({ type: "session_ended", reason: "client" });
    });

    await waitFor(() => expect(typesOf()).toContain("session_ended"));
    expect(sent.find((event) => event.type === "session_ended")).toMatchObject({
      reason: "client",
      turns: 2,
      interruptions: 2,
    });
  });

  it("flushes the end of a call immediately, not on a timer", async () => {
    const { result } = setup();
    act(() => {
      result.current.onEvent({ type: "session_requested" });
      result.current.onEvent({ type: "session_ended", reason: "client" });
    });
    await waitFor(() => expect(typesOf()).toContain("session_ended"));
  });

  it("resets its counters between calls", async () => {
    const { result } = setup();
    act(() => {
      result.current.onEvent({ type: "session_requested" });
      result.current.onEvent({ type: "interruption" });
      result.current.onEvent({ type: "session_ended", reason: "client" });
      result.current.onEvent({ type: "session_requested" });
      result.current.onEvent({ type: "session_ended", reason: "client" });
    });

    await waitFor(() => expect(sent.filter((e) => e.type === "session_ended")).toHaveLength(2));
    const [, second] = sent.filter((e) => e.type === "session_ended");
    expect(second).toMatchObject({ interruptions: 0, turns: 0 });
  });
});

function message(id: string, overrides: Partial<AvatarMessage> = {}): AvatarMessage {
  return {
    id,
    sender: MessageSender.USER,
    message: "hello",
    rawMessage: "hello",
    isPartial: false,
    timestamp: 1,
    ...overrides,
  };
}

describe("transcript turns", () => {
  function setup() {
    return renderHook(() => useFootprints({ sessionKey: "session-1", grant: "grant-1" }));
  }

  it("records a finished turn once, however often the list is re-reported", async () => {
    const { result } = setup();
    act(() => {
      result.current.onMessages([message("a")]);
      result.current.onMessages([message("a"), message("b")]);
      result.current.onMessages([message("a"), message("b")]);
      result.current.flush();
    });

    await waitFor(() => expect(sent.filter((e) => e.type === "transcript_turn")).toHaveLength(2));
  });

  it("ignores a turn that is still streaming", async () => {
    const { result } = setup();
    act(() => result.current.onMessages([message("a", { isPartial: true })]));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(typesOf()).not.toContain("transcript_turn");
  });

  it("records a partial turn once it finishes", async () => {
    const { result } = setup();
    act(() => {
      result.current.onMessages([message("a", { isPartial: true })]);
      result.current.onMessages([message("a", { isPartial: false })]);
      result.current.flush();
    });

    await waitFor(() => expect(typesOf()).toContain("transcript_turn"));
  });

  it("keeps the true length when the text is truncated", async () => {
    const { result } = setup();
    const long = "x".repeat(2500);
    act(() => {
      result.current.onMessages([message("a", { message: long })]);
      result.current.flush();
    });

    await waitFor(() => expect(typesOf()).toContain("transcript_turn"));
    const turn = sent.find((event) => event.type === "transcript_turn");
    expect(turn).toMatchObject({ charCount: 2500 });
    expect((turn as { text: string }).text).toHaveLength(2000);
  });

  it("marks a typed turn as typed", async () => {
    const { result } = setup();
    act(() => {
      result.current.onMessages([message("a", { isTyped: true })]);
      result.current.flush();
    });

    await waitFor(() => expect(typesOf()).toContain("transcript_turn"));
    expect(sent.find((e) => e.type === "transcript_turn")).toMatchObject({ isTyped: true });
  });
});

describe("the provider's onEvent seam", () => {
  it("reports a whole call without the avatar layer knowing what it is for", async () => {
    stubSessionEndpoint();
    stubMicrophone("granted");
    const events: string[] = [];

    render(
      <AvatarProvider
        config={{ avatarId: "avatar-1" }}
        onEvent={(event) => events.push(event.type)}
      >
        <InteractiveAvatar />
      </AvatarProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: /start video call/i }));
    await waitFor(() => expect(FakeSession.last?.calls.start).toBe(1));

    const session = FakeSession.last!;
    act(() => session.fire(SessionEvent.SESSION_STREAM_READY));
    act(() => session.fire(AgentEventsEnum.AVATAR_SPEAK_STARTED, {}));
    act(() => session.fire(AgentEventsEnum.AVATAR_SPEAK_ENDED, {}));

    expect(events).toContain("session_requested");
    expect(events).toContain("stream_ready");
    expect(events).toContain("avatar_speak_started");
    expect(events).toContain("avatar_speak_ended");
  });

  it("survives a handler that throws", async () => {
    stubSessionEndpoint();
    stubMicrophone("granted");

    render(
      <AvatarProvider
        config={{ avatarId: "avatar-1" }}
        onEvent={() => {
          throw new Error("reporting is broken");
        }}
      >
        <InteractiveAvatar />
      </AvatarProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: /start video call/i }));
    // The call still connects: a reporting failure is not a call failure.
    await waitFor(() => expect(FakeSession.last?.calls.start).toBe(1));
  });
});

describe("FootprintRecorder", () => {
  it("renders nothing", () => {
    stubSessionEndpoint();
    const { container } = render(
      <AvatarProvider config={{ avatarId: "avatar-1" }}>
        <FootprintRecorder onMessages={() => {}} />
      </AvatarProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the identity grace period", () => {
  /**
   * The user id arrives over the host handshake a moment after mount. Delaying
   * the whole collector for it would silently drop anything a fast visitor
   * does in the meantime — which is exactly what an e2e caught.
   */
  it("records events from mount, before identity is settled", async () => {
    const { result } = renderHook(() =>
      useFootprints({ sessionKey: "session-1", grant: "g", identitySettled: false }),
    );

    act(() => {
      result.current.track({ type: "widget_opened" });
      result.current.track({ type: "mic_granted" });
      result.current.flush();
    });

    await waitFor(() => expect(typesOf()).toEqual(["widget_opened", "mic_granted"]));
  });

  it("holds widget_loaded back until identity settles", async () => {
    const { result, rerender } = renderHook(
      ({ settled }: { settled: boolean }) =>
        useFootprints({
          sessionKey: "session-1",
          grant: "g",
          userId: "customer-42",
          identitySettled: settled,
        }),
      { initialProps: { settled: false } },
    );

    act(() => result.current.flush());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(typesOf()).not.toContain("widget_loaded");

    rerender({ settled: true });
    act(() => result.current.flush());
    await waitFor(() => expect(typesOf()).toContain("widget_loaded"));
    expect(sent.find((e) => e.type === "widget_loaded")).toMatchObject({ userId: "customer-42" });
  });

  it("describes the embed exactly once, however often identity changes", async () => {
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string }) =>
        useFootprints({ sessionKey: "session-1", grant: "g", userId, identitySettled: true }),
      { initialProps: { userId: "first" } },
    );

    rerender({ userId: "second" });
    rerender({ userId: "third" });
    act(() => result.current.flush());

    await waitFor(() => expect(typesOf()).toContain("widget_loaded"));
    expect(sent.filter((e) => e.type === "widget_loaded")).toHaveLength(1);
  });

  it("prefers the host's viewport over the frame's own", async () => {
    const { result } = renderHook(() =>
      useFootprints({
        sessionKey: "session-1",
        grant: "g",
        viewport: { width: 1440, height: 900 },
      }),
    );
    act(() => result.current.flush());

    await waitFor(() => expect(typesOf()).toContain("widget_loaded"));
    expect(sent.find((e) => e.type === "widget_loaded")).toMatchObject({
      viewport: { width: 1440, height: 900 },
      deviceClass: "desktop",
    });
  });
});

describe("one ending per session", () => {
  /**
   * A stop arrives twice — the agent's SESSION_STOPPED and the transport
   * disconnecting. Reporting both produced a second `session_ended` with a
   * duration of zero, which skewed every average computed from it. Found in
   * real recorded sessions, not in a test.
   */
  it("reports session_ended once, however many times the session says it stopped", async () => {
    stubSessionEndpoint();
    stubMicrophone("granted");
    const events: string[] = [];

    render(
      <AvatarProvider
        config={{ avatarId: "avatar-1" }}
        onEvent={(event) => events.push(event.type)}
      >
        <InteractiveAvatar />
      </AvatarProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: /start video call/i }));
    await waitFor(() => expect(FakeSession.last?.calls.start).toBe(1));

    const session = FakeSession.last!;
    act(() => session.fire(AgentEventsEnum.SESSION_STOPPED, { stop_reason: "client" }));
    act(() => session.fire(SessionEvent.SESSION_DISCONNECTED, "CLIENT_INITIATED"));

    expect(events.filter((type) => type === "session_ended")).toHaveLength(1);
  });

  it("reports an ending again for the next call", async () => {
    stubSessionEndpoint();
    const events: string[] = [];

    // Driven through the hook rather than the UI: the stage closes itself a
    // few seconds after a call ends, and this is about the second session, not
    // about how it was started.
    function Probe() {
      const { startSession, stopSession } = useSession();
      return (
        <>
          <button type="button" onClick={() => void startSession()}>
            start
          </button>
          <button type="button" onClick={() => void stopSession()}>
            stop
          </button>
        </>
      );
    }

    render(
      <AvatarProvider
        config={{ avatarId: "avatar-1" }}
        onEvent={(event) => events.push(event.type)}
      >
        <Probe />
      </AvatarProvider>,
    );

    for (let call = 0; call < 2; call += 1) {
      await userEvent.click(screen.getByRole("button", { name: "start" }));
      await waitFor(() => expect(FakeSession.last?.calls.start).toBe(1));

      // Both endings of one call: the agent says it stopped, and the
      // transport then tears down. Exactly one should be reported.
      act(() => FakeSession.last!.fire(AgentEventsEnum.SESSION_STOPPED, { stop_reason: "client" }));
      await userEvent.click(screen.getByRole("button", { name: "stop" }));
      FakeSession.last = null;
    }

    expect(events.filter((type) => type === "session_ended")).toHaveLength(2);
  });
});

describe("a tab closed without ending the call", () => {
  /**
   * The commonest way a call ends. Nobody presses End; the tab goes away.
   * Without an ending reported, the customer's line stays occupied until the
   * ten-minute stale sweep reclaims it — and with a limit of one, that is ten
   * minutes during which they cannot call back.
   */
  it("reports the ending on pagehide, by beacon", async () => {
    stubSessionEndpoint();
    stubMicrophone("granted");

    function Harness() {
      const footprints = useFootprints({ sessionKey: "session-1", grant: "g" });
      return (
        <AvatarProvider config={{ avatarId: "avatar-1" }} onEvent={footprints.onEvent}>
          <InteractiveAvatar />
        </AvatarProvider>
      );
    }

    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /start video call/i }));
    await waitFor(() => expect(FakeSession.last?.calls.start).toBe(1));

    sendBeacon.mockClear();
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    await waitFor(() => expect(typesOf()).toContain("session_ended"));
    // A fetch started during unload is cancelled; a beacon is not.
    expect(sendBeacon).toHaveBeenCalled();
  });

  it("reports it once, even if the user pressed End first", async () => {
    stubSessionEndpoint();
    const events: string[] = [];

    function Probe() {
      const { startSession, stopSession } = useSession();
      return (
        <>
          <button type="button" onClick={() => void startSession()}>
            start
          </button>
          <button type="button" onClick={() => void stopSession()}>
            stop
          </button>
        </>
      );
    }

    render(
      <AvatarProvider config={{ avatarId: "avatar-1" }} onEvent={(e) => events.push(e.type)}>
        <Probe />
      </AvatarProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(FakeSession.last?.calls.start).toBe(1));
    await userEvent.click(screen.getByRole("button", { name: "stop" }));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(events.filter((type) => type === "session_ended")).toHaveLength(1);
  });
});
