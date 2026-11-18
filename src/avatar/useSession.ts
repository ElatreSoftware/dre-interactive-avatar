"use client";

import { useAvatarContext } from "./context";
import type { ConnectionQualityLevel, SessionError, SessionStatus } from "./types";

export interface UseSessionResult {
  status: SessionStatus;
  isStreamReady: boolean;
  connectionQuality: ConnectionQualityLevel;
  sessionId: string | null;
  error: SessionError | null;
  /** True while a session is live or coming up. */
  isActive: boolean;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  /** Attach the stream to a media element; returns a detach cleanup. */
  attachElement: (element: HTMLMediaElement) => () => void;
  keepAlive: () => Promise<void>;
}

/** Session lifecycle: connect, disconnect, and where it currently is. */
export function useSession(): UseSessionResult {
  const {
    sessionRef,
    status,
    isStreamReady,
    connectionQuality,
    sessionId,
    error,
    startSession,
    stopSession,
    attachElement,
  } = useAvatarContext();

  return {
    status,
    isStreamReady,
    connectionQuality,
    sessionId,
    error,
    isActive: status === "connecting" || status === "listening" || status === "speaking",
    startSession,
    stopSession,
    attachElement,
    keepAlive: async () => {
      // Off by default: calling this extends a billed session.
      await sessionRef.current?.keepAlive();
    },
  };
}
