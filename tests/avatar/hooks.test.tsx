import { useEffect, useRef } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSession, stubSessionEndpoint } from "./fakeSession";

vi.mock("@elatre/liveavatar-web-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof SdkModule>();
  return { ...actual, ElevenLabsAgentSession: FakeSession };
});

import type * as SdkModule from "@elatre/liveavatar-web-sdk";
import { AgentEventsEnum, SessionDisconnectReason, SessionEvent } from "@elatre/liveavatar-web-sdk";
import {
  AvatarProvider,
  useAvatarActions,
  useChatHistory,
  useSession,
  useTextChat,
  useVoiceChat,
} from "@/avatar";
import type { AvatarConfig } from "@/avatar";

function Probe() {
  const { status, error, startSession, stopSession, attachElement, sessionId } = useSession();
  const videoRef = useRef<HTMLVideoElement>(null);
  // Mirrors how the real components attach: once, in an effect.
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    return attachElement(element);
  }, [attachElement]);
  const { isMuted, toggleMute, isUserTalking } = useVoiceChat();
  const { sendMessage, notifyUserActivity } = useTextChat();
  const { interrupt } = useAvatarActions();
  const messages = useChatHistory();

  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="session">{sessionId ?? ""}</span>
      <span data-testid="error">{error?.code ?? ""}</span>
      <span data-testid="muted">{String(isMuted)}</span>
      <span data-testid="talking">{String(isUserTalking)}</span>
      <span data-testid="messages">{messages.map((m) => m.message).join("|")}</span>
      <span data-testid="typed">{messages.filter((m) => m.isTyped).length}</span>
      <button onClick={() => void startSession()}>start</button>
      <button onClick={() => void stopSession()}>stop</button>
      <button onClick={() => void toggleMute()}>mic</button>
      <button onClick={interrupt}>interrupt</button>
      <button onClick={() => sendMessage("typed hello")}>send</button>
      <button onClick={() => sendMessage("   ")}>send-blank</button>
      <button onClick={notifyUserActivity}>activity</button>
      <video data-testid="video" ref={videoRef} />
    </div>
  );
}

function renderProbe(config: AvatarConfig = { avatarId: "avatar-1" }) {
  return render(
    <AvatarProvider config={config}>
      <Probe />
    </AvatarProvider>,
  );
}

async function connect() {
  renderProbe();
  await userEvent.click(screen.getByText("start"));
  await waitFor(() => expect(FakeSession.last?.calls.start).toBe(1));
  const session = FakeSession.last;
  if (!session) throw new Error("no session");
  act(() => session.fire(SessionEvent.SESSION_STREAM_READY));
  return session;
}

beforeEach(() => {
  FakeSession.last = null;
  stubSessionEndpoint();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllGlobals());

describe("useSession", () => {
  it("connects and reaches listening once the stream is ready", async () => {
    await connect();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("listening"));
    expect(screen.getByTestId("session")).toHaveTextContent("sess-1");
  });

  it("sends the greeting prompt only after the stream is ready", async () => {
    renderProbe({ avatarId: "avatar-1", greetingPrompt: "Hello" });
    await userEvent.click(screen.getByText("start"));
    await waitFor(() => expect(FakeSession.last?.calls.start).toBe(1));
    const session = FakeSession.last!;
    expect(session.calls.userMessages).toEqual([]);
    act(() => session.fire(SessionEvent.SESSION_STREAM_READY));
    await waitFor(() => expect(session.calls.userMessages).toEqual(["Hello"]));
    expect(screen.getByTestId("messages")).toHaveTextContent("");
  });

  it("stays on connecting until the stream arrives", async () => {
    renderProbe();
    await userEvent.click(screen.getByText("start"));
    await waitFor(() => expect(FakeSession.last?.calls.start).toBe(1));
    expect(screen.getByTestId("status")).toHaveTextContent("connecting");
  });

  it("creates the session with the LITE voice config and keep-alive off", async () => {
    const session = await connect();
    expect(session.config).toEqual({
      apiUrl: window.location.origin,
      livekitUrl: "wss://dev.rcmgen.ai",
      voiceChat: { defaultMuted: false },
      autoKeepAlive: false,
    });
  });

  it("does not start a second session while one is live", async () => {
    await connect();
    await userEvent.click(screen.getByText("start"));
    expect(FakeSession.last?.calls.start).toBe(1);
  });

  it("classifies a denied microphone", async () => {
    renderProbe();
    const denied = new Error("Permission denied");
    denied.name = "NotAllowedError";
    // The session is constructed inside startSession, so arm the error via the
    // factory's next instance.
    const original = FakeSession.prototype.start;
    vi.spyOn(FakeSession.prototype, "start").mockImplementationOnce(async function (
      this: FakeSession,
    ) {
      this.calls.start += 1;
      throw denied;
    });

    await userEvent.click(screen.getByText("start"));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("mic_denied"));
    expect(screen.getByTestId("status")).toHaveTextContent("error");
    FakeSession.prototype.start = original;
  });

  it("surfaces a failed token mint without creating a session", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("nope", { status: 500 }));
    renderProbe();
    await userEvent.click(screen.getByText("start"));

    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("token_failed"));
    expect(FakeSession.last).toBeNull();
  });

  it("stops cleanly and reports no error", async () => {
    const session = await connect();
    await userEvent.click(screen.getByText("stop"));

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ended"));
    expect(session.calls.stop).toBe(1);
    expect(screen.getByTestId("error")).toHaveTextContent("");
  });

  it("maps a server stop to a user-facing error", async () => {
    const session = await connect();
    act(() =>
      session.fire(AgentEventsEnum.SESSION_STOPPED, {
        event_id: "e",
        stop_reason: "IDLE_TIMEOUT",
      }),
    );
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("idle_timeout"));
  });

  it("treats an unexpected disconnect as a lost connection", async () => {
    const session = await connect();
    act(() =>
      session.fire(SessionEvent.SESSION_DISCONNECTED, SessionDisconnectReason.UNKNOWN_REASON),
    );
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("connection_lost"));
  });

  it("stops the session on unmount, so none is left billing", async () => {
    const { unmount } = renderProbe();
    await userEvent.click(screen.getByText("start"));
    await waitFor(() => expect(FakeSession.last?.calls.start).toBe(1));

    unmount();
    await waitFor(() => expect(FakeSession.last?.calls.stop).toBe(1));
  });

  it("stops the session on pagehide", async () => {
    const session = await connect();
    act(() => window.dispatchEvent(new Event("pagehide")));
    await waitFor(() => expect(session.calls.stop).toBe(1));
  });
});

describe("video attach", () => {
  // Regression: the SDK's attach() silently refuses before the tracks are
  // subscribed. Attaching once on connect left transcripts working and video blank.
  it("attaches once the stream is ready, not before", async () => {
    renderProbe();
    await userEvent.click(screen.getByText("start"));
    await waitFor(() => expect(FakeSession.last?.calls.start).toBe(1));
    const session = FakeSession.last!;

    expect(session.calls.attach).toEqual([]);
    act(() => session.fire(SessionEvent.SESSION_STREAM_READY));
    expect(session.calls.attach).toHaveLength(1);
  });

  it("never calls the SDK while it would be refused", async () => {
    renderProbe();
    await userEvent.click(screen.getByText("start"));
    await waitFor(() => expect(FakeSession.last?.calls.start).toBe(1));
    expect(FakeSession.last?.calls.refusedAttach).toBe(0);
  });
});

describe("useTextChat", () => {
  // The headline bug: a typed message produces no transcription event, so
  // without this it is answered but never shown.
  it("puts a typed message into the transcript immediately", async () => {
    const session = await connect();
    await userEvent.click(screen.getByText("send"));

    expect(screen.getByTestId("messages")).toHaveTextContent("typed hello");
    expect(screen.getByTestId("typed")).toHaveTextContent("1");
    expect(session.calls.userMessages).toEqual(["typed hello"]);
  });

  it("does not show a typed message twice when the agent echoes it", async () => {
    const session = await connect();
    await userEvent.click(screen.getByText("send"));
    act(() =>
      session.fire(AgentEventsEnum.USER_TRANSCRIPTION, { event_id: "e", text: "typed hello" }),
    );
    expect(screen.getByTestId("messages")).toHaveTextContent(/^typed hello$/);
  });

  it("ignores a blank message", async () => {
    const session = await connect();
    await userEvent.click(screen.getByText("send-blank"));
    expect(session.calls.userMessages).toEqual([]);
    expect(screen.getByTestId("messages")).toHaveTextContent("");
  });

  it("signals user activity so the agent holds off", async () => {
    const session = await connect();
    await userEvent.click(screen.getByText("activity"));
    expect(session.calls.userActivity).toBe(1);
  });

  it("never throws when the vendor send fails", async () => {
    const session = await connect();
    session.sendError = new Error("channel closed");
    await userEvent.click(screen.getByText("send"));
    // Still shown locally, even though the send failed.
    expect(screen.getByTestId("messages")).toHaveTextContent("typed hello");
  });
});

describe("useVoiceChat", () => {
  it("toggles the microphone", async () => {
    const session = await connect();
    await userEvent.click(screen.getByText("mic"));
    await waitFor(() => expect(screen.getByTestId("muted")).toHaveTextContent("true"));
    expect(session.calls.mute).toBe(1);

    await userEvent.click(screen.getByText("mic"));
    await waitFor(() => expect(screen.getByTestId("muted")).toHaveTextContent("false"));
  });

  it("reports a mic failure as an error rather than throwing", async () => {
    const session = await connect();
    session.muteError = new Error("device busy");
    await userEvent.click(screen.getByText("mic"));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("mic_denied"));
  });

  it("tracks who is talking", async () => {
    const session = await connect();
    act(() => session.fire(AgentEventsEnum.USER_SPEAK_STARTED, { event_id: "e" }));
    expect(screen.getByTestId("talking")).toHaveTextContent("true");

    act(() => session.fire(AgentEventsEnum.USER_SPEAK_ENDED, { event_id: "e" }));
    expect(screen.getByTestId("talking")).toHaveTextContent("false");
  });
});

describe("interruption", () => {
  it("drops back to listening and truncates the avatar turn", async () => {
    const session = await connect();
    act(() => {
      session.fire(AgentEventsEnum.AVATAR_SPEAK_STARTED, { event_id: "u1" });
      session.fire(AgentEventsEnum.AVATAR_TRANSCRIPTION_CHUNK, {
        event_id: "e",
        text: "Once upon a time there was",
      });
    });
    expect(screen.getByTestId("status")).toHaveTextContent("speaking");

    act(() => {
      session.fire(AgentEventsEnum.ELEVENLABS_AGENT_EVENT, {
        event_id: "e2",
        elevenlabs_event_type: "interruption",
        data: { reason: "user_speech" },
      });
      session.fire(AgentEventsEnum.ELEVENLABS_AGENT_EVENT, {
        event_id: "e3",
        elevenlabs_event_type: "agent_response_correction",
        data: { corrected_agent_response: "Once upon a time" },
      });
    });

    expect(screen.getByTestId("status")).toHaveTextContent("listening");
    expect(screen.getByTestId("messages")).toHaveTextContent(/^Once upon a time$/);
  });

  it("forwards a manual interrupt and updates optimistically", async () => {
    const session = await connect();
    act(() => session.fire(AgentEventsEnum.AVATAR_SPEAK_STARTED, { event_id: "u1" }));

    await userEvent.click(screen.getByText("interrupt"));
    expect(session.calls.interrupt).toBe(1);
    expect(screen.getByTestId("status")).toHaveTextContent("listening");
  });

  it("ignores a late speak_ended after an interruption", async () => {
    const session = await connect();
    act(() => {
      session.fire(AgentEventsEnum.AVATAR_SPEAK_STARTED, { event_id: "u1" });
      session.fire(AgentEventsEnum.ELEVENLABS_AGENT_EVENT, {
        event_id: "e",
        elevenlabs_event_type: "interruption",
        data: {},
      });
      session.fire(AgentEventsEnum.AVATAR_SPEAK_ENDED, { event_id: "u1" });
    });
    expect(screen.getByTestId("status")).toHaveTextContent("listening");
  });
});

describe("hook guards", () => {
  it("throws a helpful error outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/must be used inside <AvatarProvider>/);
  });
});
