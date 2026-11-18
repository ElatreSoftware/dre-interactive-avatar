"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AgentEventsEnum,
  ConnectionQuality,
  ElevenLabsAgentSession,
  SessionDisconnectReason,
  SessionEvent,
  SessionState,
  VoiceChatEvent,
} from "@elatre/liveavatar-web-sdk";
import { chatHistoryReducer } from "./chatHistory";
import { classifyStartError, mapElevenLabsEvent, mapStopReason, toSessionError } from "./events";
import { fetchSessionCredentials } from "./sessionClient";
import { MessageSender } from "./types";
import type { AvatarLifecycleEvent } from "./types";
import type {
  ConnectionQualityLevel,
  AvatarConfig,
  AvatarMessage,
  SessionCredentials,
  SessionEndReason,
  SessionError,
  SessionStatus,
} from "./types";

/**
 *
 * Structured after the official SDK demo's Elatre's `src/avatar` folder — a context
 * provider holding the session, with focused hooks on top — but deliberately
 * not copying three of its bugs:
 *
 *  1. The demo calls `new AvatarSession(...)` inside `useRef(...)` on every
 *     render, constructing (and discarding) a session each time. We create it
 *     lazily, once.
 *  2. Only its chat-history effect unsubscribes, so React StrictMode
 *     double-subscribes the rest. Every effect here returns a cleanup.
 *  3. On disconnect it calls `removeAllListeners()` on the session, which tears
 *     off the transcript and talking listeners with no way back — a reconnect
 *     on the same instance goes silent. We build a fresh session per connect
 *     instead, so reconnecting always works.
 */

export type SessionFactory = (
  credentials: SessionCredentials,
  options: { startMuted: boolean },
) => ElevenLabsAgentSession;

// The SDK appends the livekit_url host as a path segment; /v1/sessions/start
// rewrites that host to "livekit", giving wss://dev.rcmgen.ai/livekit/rtc.
export const LIVEKIT_URL = "wss://dev.rcmgen.ai";

const defaultSessionFactory: SessionFactory = (credentials, { startMuted }) =>
  new ElevenLabsAgentSession(credentials.sessionToken, {
    // Same-origin: /v1/sessions/* relays to the proxy server-side, avoiding CORS.
    apiUrl: window.location.origin,
    livekitUrl: LIVEKIT_URL,
    voiceChat: { defaultMuted: startMuted },
    // Left off deliberately: it extends the billed session indefinitely.
    autoKeepAlive: false,
  });

export interface AvatarContextValue {
  sessionRef: React.RefObject<ElevenLabsAgentSession | null>;
  status: SessionStatus;
  isStreamReady: boolean;
  isUserTalking: boolean;
  isAvatarTalking: boolean;
  isMuted: boolean;
  connectionQuality: ConnectionQualityLevel;
  messages: AvatarMessage[];
  error: SessionError | null;
  sessionId: string | null;
  interruptionCount: number;
  config: AvatarConfig;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  attachElement: (element: HTMLMediaElement) => () => void;
  setMuted: (muted: boolean) => Promise<void>;
  appendTypedMessage: (text: string) => void;
  noteInterrupted: () => void;
}

const AvatarContext = createContext<AvatarContextValue | null>(null);

export function useAvatarContext(): AvatarContextValue {
  const context = useContext(AvatarContext);
  if (!context) {
    throw new Error(
      "Avatar hooks must be used inside <AvatarProvider>. Wrap your widget in the provider.",
    );
  }
  return context;
}

function toQualityLevel(quality: ConnectionQuality): ConnectionQualityLevel {
  if (quality === ConnectionQuality.GOOD) return "good";
  if (quality === ConnectionQuality.BAD) return "bad";
  return "unknown";
}

const DEFAULT_TEARDOWN_AFTER_HIDDEN_MS = 60_000;
const GREETING_DELAY_MS = 500;

export interface AvatarProviderProps {
  config: AvatarConfig;
  children: ReactNode;
  /** Swap the SDK session in tests, or for an alternative integration. */
  sessionFactory?: SessionFactory;
  /**
   * Called for everything worth recording about a session.
   *
   * The single seam the telemetry layer binds to. Nothing in this folder
   * imports it back, so the session layer stays testable on its own and the
   * widget works unchanged with footprints switched off.
   */
  onEvent?: (event: AvatarLifecycleEvent) => void;
}

export function AvatarProvider({
  config,
  children,
  sessionFactory = defaultSessionFactory,
  onEvent,
}: AvatarProviderProps) {
  const sessionRef = useRef<ElevenLabsAgentSession | null>(null);

  const [status, setStatus] = useState<SessionStatus>("idle");
  const [isStreamReady, setIsStreamReady] = useState(false);
  const [isUserTalking, setIsUserTalking] = useState(false);
  const [isAvatarTalking, setIsAvatarTalking] = useState(false);
  const [isMuted, setIsMuted] = useState(config.startMuted ?? false);
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQualityLevel>("unknown");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<SessionError | null>(null);
  const [interruptionCount, setInterruptionCount] = useState(0);
  const [messages, dispatchMessages] = useReducer(chatHistoryReducer, []);

  const elementRef = useRef<HTMLMediaElement | null>(null);
  const isStreamReadyRef = useRef(false);
  const isClosingRef = useRef(false);
  const hasEndedRef = useRef(false);
  const isConnectingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  /**
   * Held in a ref, and read through a stable callback.
   *
   * Callers pass an inline arrow function; if `emit` depended on it, every
   * render would rebuild `bindEvents` and detach and reattach every SDK
   * listener on a live call.
   */
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const emit = useCallback((event: AvatarLifecycleEvent) => {
    try {
      onEventRef.current?.(event);
    } catch (error) {
      // A reporting failure must never break the call it is reporting on.
      console.warn("[Avatar] onEvent handler threw", error);
    }
  }, []);

  /**
   * `AvatarSession.attach()` logs "Stream is not yet ready" and returns if
   * the remote tracks are not subscribed yet, with no error and no retry. The
   * UI mounts its <video> and connects in the same breath, so attaching once on
   * connect gives a working data channel (transcripts) and a blank video.
   */
  const applyAttach = useCallback(() => {
    const element = elementRef.current;
    const session = sessionRef.current;
    if (!element || !session || !isStreamReadyRef.current) return;
    try {
      session.attach(element);
      // Autoplay can still be refused even after a user gesture.
      void element.play?.().catch(() => undefined);
    } catch (attachError) {
      console.warn("[Avatar] attach failed", attachError);
    }
  }, []);

  const endWith = useCallback(
    (reason: SessionEndReason) => {
      // One session, one ending. A stop usually arrives twice — once as the
      // agent's SESSION_STOPPED and once as the transport disconnecting — and
      // reporting both produced a second `session_ended` with a duration of
      // zero, which quietly skewed every average computed from it.
      if (!hasEndedRef.current) {
        hasEndedRef.current = true;
        emit({ type: "session_ended", reason });
      }
      dispatchMessages({ type: "closePartials" });
      setIsAvatarTalking(false);
      setIsUserTalking(false);
      setIsStreamReady(false);
      isStreamReadyRef.current = false;
      if (reason === "client") {
        setStatus("ended");
        setError(null);
      } else {
        setStatus("error");
        setError(toSessionError(reason));
      }
    },
    [emit],
  );

  const bindEvents = useCallback(
    (session: ElevenLabsAgentSession) => {
      session.on(SessionEvent.SESSION_STREAM_READY, () => {
        emit({ type: "stream_ready" });
        isStreamReadyRef.current = true;
        setIsStreamReady(true);
        applyAttach();
        setStatus((current) => (current === "connecting" ? "listening" : current));

        const greeting = configRef.current.greetingPrompt;
        if (greeting) {
          // Give the attached element a moment to start playback first.
          setTimeout(() => {
            if (sessionRef.current === session && !isClosingRef.current) {
              session.sendUserMessage(greeting);
            }
          }, GREETING_DELAY_MS);
        }
      });

      session.on(SessionEvent.SESSION_STATE_CHANGED, (state) => {
        if (state !== SessionState.CONNECTED) return;
        setSessionId(session.sessionId);
        emit({ type: "session_started", sessionId: session.sessionId });
      });

      session.on(SessionEvent.SESSION_CONNECTION_QUALITY_CHANGED, (quality) => {
        const level = toQualityLevel(quality);
        setConnectionQuality(level);
        emit({ type: "connection_quality_changed", quality: level });
      });

      session.on(SessionEvent.SESSION_DISCONNECTED, (reason) => {
        if (isClosingRef.current || reason === SessionDisconnectReason.CLIENT_INITIATED) {
          endWith("client");
          return;
        }
        endWith(
          reason === SessionDisconnectReason.SESSION_START_FAILED
            ? "session_start_failed"
            : "connection_lost",
        );
      });

      session.on(AgentEventsEnum.SESSION_STOPPED, (event) => {
        isClosingRef.current = true;
        endWith(mapStopReason(event.stop_reason));
      });

      // Turn-taking.
      session.on(AgentEventsEnum.USER_SPEAK_STARTED, () => {
        setIsUserTalking(true);
        emit({ type: "user_speak_started" });
      });
      session.on(AgentEventsEnum.USER_SPEAK_ENDED, () => {
        setIsUserTalking(false);
        emit({ type: "user_speak_ended" });
      });
      session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, () => {
        setIsAvatarTalking(true);
        setStatus("speaking");
        emit({ type: "avatar_speak_started" });
      });
      session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
        setIsAvatarTalking(false);
        emit({ type: "avatar_speak_ended" });
        dispatchMessages({ type: "closePartials" });
        setStatus((current) => (current === "speaking" ? "listening" : current));
      });

      // Transcripts.
      session.on(AgentEventsEnum.USER_TRANSCRIPTION_CHUNK, (event) =>
        dispatchMessages({ type: "chunk", sender: MessageSender.USER, text: event.text }),
      );
      session.on(AgentEventsEnum.USER_TRANSCRIPTION, (event) =>
        dispatchMessages({ type: "final", sender: MessageSender.USER, text: event.text }),
      );
      session.on(AgentEventsEnum.AVATAR_TRANSCRIPTION_CHUNK, (event) =>
        dispatchMessages({ type: "chunk", sender: MessageSender.AVATAR, text: event.text }),
      );
      session.on(AgentEventsEnum.AVATAR_TRANSCRIPTION, (event) =>
        dispatchMessages({ type: "final", sender: MessageSender.AVATAR, text: event.text }),
      );

      // The ElevenLabs passthrough — where interruption lives.
      session.on(AgentEventsEnum.ELEVENLABS_AGENT_EVENT, (event) => {
        const mapped = mapElevenLabsEvent(event);
        if (!mapped) return;
        dispatchMessages(mapped);
        if (mapped.type === "interrupted") {
          emit({ type: "interruption" });
          setInterruptionCount((count) => count + 1);
          setIsAvatarTalking(false);
          setStatus((current) => (current === "speaking" ? "listening" : current));
        }
      });

      session.voiceChat.on(VoiceChatEvent.MUTED, () => {
        setIsMuted(true);
        emit({ type: "mute_toggled", isMuted: true });
      });
      session.voiceChat.on(VoiceChatEvent.UNMUTED, () => {
        setIsMuted(false);
        emit({ type: "mute_toggled", isMuted: false });
      });
    },
    [applyAttach, emit, endWith],
  );

  const teardown = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    isClosingRef.current = true;
    isConnectingRef.current = false;
    isStreamReadyRef.current = false;

    const session = sessionRef.current;
    sessionRef.current = null;
    if (!session) return;
    try {
      await session.stop();
    } catch (stopError) {
      // The user has already left; teardown failures must never surface.
      console.warn("[Avatar] stop failed", stopError);
    }
  }, []);

  const startSession = useCallback(async () => {
    if (isConnectingRef.current || sessionRef.current) return;
    isConnectingRef.current = true;
    isClosingRef.current = false;

    dispatchMessages({ type: "reset" });
    setError(null);
    setInterruptionCount(0);
    setStatus("connecting");
    hasEndedRef.current = false;
    emit({ type: "session_requested" });

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const credentials = await fetchSessionCredentials(configRef.current, abort.signal);
      if (abort.signal.aborted) return;

      const session = sessionFactory(credentials, {
        startMuted: configRef.current.startMuted ?? false,
      });
      sessionRef.current = session;
      bindEvents(session);

      await session.start();
      if (abort.signal.aborted) {
        await session.stop();
        return;
      }

      setSessionId(session.sessionId);
      // Some orderings deliver the stream before `start()` resolves.
      applyAttach();
      // Stay on "connecting" until the stream arrives; SESSION_STREAM_READY
      // flips us to "listening".
      if (isStreamReadyRef.current) setStatus("listening");
    } catch (startError) {
      if (!abort.signal.aborted) {
        const sessionError = classifyStartError(startError);
        setStatus("error");
        setError(sessionError);
        emit({ type: "error", error: sessionError });
      }
      sessionRef.current = null;
    } finally {
      isConnectingRef.current = false;
    }
  }, [applyAttach, bindEvents, emit, sessionFactory]);

  const stopSession = useCallback(async () => {
    await teardown();
    endWith("client");
  }, [endWith, teardown]);

  const attachElement = useCallback(
    (element: HTMLMediaElement) => {
      elementRef.current = element;
      applyAttach();
      return () => {
        if (elementRef.current === element) elementRef.current = null;
        element.srcObject = null;
      };
    },
    [applyAttach],
  );

  const setMuted = useCallback(async (muted: boolean) => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      await (muted ? session.voiceChat.mute() : session.voiceChat.unmute());
      setIsMuted(muted);
    } catch (micError) {
      console.warn("[Avatar] mic toggle failed", micError);
      setError(toSessionError("mic_denied"));
    }
  }, []);

  const appendTypedMessage = useCallback((text: string) => {
    dispatchMessages({ type: "typed", text });
  }, []);

  const noteInterrupted = useCallback(() => {
    dispatchMessages({ type: "interrupted" });
    setInterruptionCount((count) => count + 1);
    setIsAvatarTalking(false);
    setStatus((current) => (current === "speaking" ? "listening" : current));
  }, []);

  // Always release the session on unmount. Sessions bill per minute and idle
  // out after five, so an orphan is both a cost and a stuck avatar.
  useEffect(() => {
    return () => {
      void teardown();
    };
  }, [teardown]);

  // A backgrounded tab holding a session open burns credits for nothing.
  useEffect(() => {
    const graceMs = config.teardownAfterHiddenMs ?? DEFAULT_TEARDOWN_AFTER_HIDDEN_MS;
    if (graceMs <= 0) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        timer = setTimeout(() => void stopSession(), graceMs);
      } else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const onPageHide = () => void teardown();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [config.teardownAfterHiddenMs, stopSession, teardown]);

  const value = useMemo<AvatarContextValue>(
    () => ({
      sessionRef,
      status,
      isStreamReady,
      isUserTalking,
      isAvatarTalking,
      isMuted,
      connectionQuality,
      messages,
      error,
      sessionId,
      interruptionCount,
      config,
      startSession,
      stopSession,
      attachElement,
      setMuted,
      appendTypedMessage,
      noteInterrupted,
    }),
    [
      status,
      isStreamReady,
      isUserTalking,
      isAvatarTalking,
      isMuted,
      connectionQuality,
      messages,
      error,
      sessionId,
      interruptionCount,
      config,
      startSession,
      stopSession,
      attachElement,
      setMuted,
      appendTypedMessage,
      noteInterrupted,
    ],
  );

  return <AvatarContext.Provider value={value}>{children}</AvatarContext.Provider>;
}
