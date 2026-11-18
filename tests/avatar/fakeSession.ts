import { vi } from "vitest";

type Handler = (payload?: unknown) => void;

/**
 * Stand-in for `ElevenLabsAgentSession`.
 *
 * It mirrors the real `attach()`: it refuses until the tracks are subscribed.
 * That is the behaviour that caused a blank video in production, so the double
 * has to reproduce it or the regression test is worthless.
 */
export class FakeSession {
  static last: FakeSession | null = null;

  handlers = new Map<string, Handler[]>();
  voiceHandlers = new Map<string, Handler[]>();
  sessionId: string | null = "sess-1";
  isStreamReady = false;

  startError: Error | null = null;
  muteError: Error | null = null;
  sendError: Error | null = null;

  calls = {
    start: 0,
    stop: 0,
    attach: [] as HTMLMediaElement[],
    refusedAttach: 0,
    mute: 0,
    unmute: 0,
    interrupt: 0,
    keepAlive: 0,
    userMessages: [] as string[],
    contextUpdates: [] as string[],
    userActivity: 0,
    devices: [] as ConstrainDOMString[],
  };

  voiceChat = {
    mute: async () => {
      if (this.muteError) throw this.muteError;
      this.calls.mute += 1;
      this.fireVoice("MUTED");
    },
    unmute: async () => {
      if (this.muteError) throw this.muteError;
      this.calls.unmute += 1;
      this.fireVoice("UNMUTED");
    },
    setDevice: async (deviceId: ConstrainDOMString) => {
      this.calls.devices.push(deviceId);
      return true;
    },
    on: (event: string, handler: Handler) => {
      this.voiceHandlers.set(event, [...(this.voiceHandlers.get(event) ?? []), handler]);
    },
  };

  constructor(
    public token: string,
    public config: unknown,
  ) {
    FakeSession.last = this;
  }

  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  /** Emit a session/agent event, as the SDK would. */
  fire(event: string, payload?: unknown) {
    if (event === "session.stream_ready") this.isStreamReady = true;
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }

  fireVoice(event: string, payload?: unknown) {
    for (const handler of this.voiceHandlers.get(event) ?? []) handler(payload);
  }

  async start() {
    this.calls.start += 1;
    if (this.startError) throw this.startError;
  }
  async stop() {
    this.calls.stop += 1;
  }
  async keepAlive() {
    this.calls.keepAlive += 1;
  }
  attach(element: HTMLMediaElement) {
    if (!this.isStreamReady) {
      this.calls.refusedAttach += 1;
      return;
    }
    this.calls.attach.push(element);
  }
  interrupt() {
    this.calls.interrupt += 1;
  }
  sendUserMessage(text: string) {
    if (this.sendError) throw this.sendError;
    this.calls.userMessages.push(text);
  }
  sendContextualUpdate(text: string) {
    if (this.sendError) throw this.sendError;
    this.calls.contextUpdates.push(text);
  }
  sendUserActivity() {
    if (this.sendError) throw this.sendError;
    this.calls.userActivity += 1;
  }
  startListening() {}
  stopListening() {}
}

/** Stub `/api/avatar/session` so no test touches a vendor. */
/**
 * A fresh Response per call. A shared one can only be read once, so the second
 * session of any test would fail as `token_failed` — a confusing way to
 * discover that the stub, not the code, ran out.
 */
export function stubSessionEndpoint() {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ sessionId: "s1", sessionToken: "t1" }), { status: 200 }),
      ),
    ),
  );
}

/** Grant (or refuse) the pre-flight microphone prompt. */
export function stubMicrophone(outcome: "granted" | "denied" | "missing" = "granted") {
  const getUserMedia = vi.fn(async () => {
    if (outcome === "denied") {
      const error = new Error("Permission denied");
      error.name = "NotAllowedError";
      throw error;
    }
    return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
  });

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    writable: true,
    value:
      outcome === "missing"
        ? {}
        : {
            getUserMedia,
            enumerateDevices: vi.fn().mockResolvedValue([]),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          },
  });
  return getUserMedia;
}
