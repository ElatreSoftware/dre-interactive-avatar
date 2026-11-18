/**
 * Public types for the Avatar + ElevenLabs session layer.
 *
 * Mirrors the shape of the official SDK demo's `src/liveavatar` folder, with
 * the vocabulary kept ours so the UI does not depend on SDK enums.
 */

export enum MessageSender {
  USER = "user",
  AVATAR = "avatar",
}

export interface AvatarMessage {
  id: string;
  sender: MessageSender;
  /** Display text: avatar speech has its audio tags (`[slow]`) removed. */
  message: string;
  /** The text as the vendor sent it, tags and all. Kept so streaming chunks
   *  accumulate correctly and so callers can inspect the original. */
  rawMessage: string;
  /** True while the message is still streaming in chunk by chunk. */
  isPartial: boolean;
  /** True when the avatar was cut off mid-utterance by the user. */
  wasInterrupted?: boolean;
  /** True when the user typed this rather than speaking it. */
  isTyped?: boolean;
  timestamp: number;
}

/** Where the conversation is, from the user's point of view. */
export type SessionStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "ended"
  | "error";

export type SessionErrorCode =
  | "mic_denied"
  | "token_failed"
  | "session_start_failed"
  | "no_credits"
  | "idle_timeout"
  | "max_duration"
  | "avatar_unavailable"
  | "agent_hung_up"
  | "connection_lost"
  | "unknown";

export interface SessionError {
  code: SessionErrorCode;
  /** Shown to the end user. Never contains vendor internals. */
  message: string;
  retryable: boolean;
}

/** Why a session ended: cleanly at the user's request, or for some fault. */
export type SessionEndReason = SessionErrorCode | "client";

export type ConnectionQualityLevel = "unknown" | "good" | "bad";

export interface MicrophoneDevice {
  deviceId: string;
  label: string;
}

export interface SessionCredentials {
  sessionId: string;
  sessionToken: string;
}

/** Config the host app passes to `AvatarProvider`. */
export interface AvatarConfig {
  /** Avatar avatar id to render. */
  avatarId: string;
  /** Your route that mints a session token. Defaults to `/api/avatar/session`. */
  sessionEndpoint?: string;
  /** Use Avatar's free sandbox avatar instead of billing a real one. */
  isSandbox?: boolean;
  /** Join with the microphone muted (text-first experience). */
  startMuted?: boolean;
  /** Values interpolated into the ElevenLabs agent prompt. */
  dynamicVariables?: Record<string, string>;
  /**
   * Sent to the agent as a hidden user message once the stream is playing, so
   * the opening line is heard in full. Requires the ElevenLabs agent's "First
   * message" to be empty, or the agent will greet twice.
   */
  greetingPrompt?: string;
  /** Identifies the embedding customer. Public by design; the grant is what authorises. */
  embedKey?: string;
  /**
   * Short-lived signed proof that this document was framed by an allowed
   * origin. Issued by `/embed/<key>`; required by the session route.
   */
  grant?: string;
  /** Tear the session down after this many ms hidden. Defaults to 60s. 0 disables. */
  teardownAfterHiddenMs?: number;
}

/**
 * What the provider reports about a session, for a host app that wants to
 * record or react to it.
 *
 * Deliberately domain vocabulary, not vendor vocabulary: this is the seam the
 * telemetry layer binds to, and it must not drag the SDK's enums along with
 * it.
 */
export type AvatarLifecycleEvent =
  | { type: "session_requested" }
  | { type: "session_started"; sessionId: string | null }
  | { type: "stream_ready" }
  | { type: "session_ended"; reason: SessionEndReason }
  | { type: "user_speak_started" }
  | { type: "user_speak_ended" }
  | { type: "avatar_speak_started" }
  | { type: "avatar_speak_ended" }
  | { type: "interruption" }
  | { type: "mute_toggled"; isMuted: boolean }
  | { type: "connection_quality_changed"; quality: ConnectionQualityLevel }
  | { type: "error"; error: SessionError };
