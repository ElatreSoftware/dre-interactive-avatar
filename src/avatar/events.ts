import { MessageSender } from "./types";
import type { ChatHistoryEvent } from "./chatHistory";
import type { SessionEndReason, SessionError, SessionErrorCode } from "./types";

/**
 * Translation layer: raw Avatar / ElevenLabs payloads -> our `AvatarEvent`.
 *
 * Everything here is pure and defensive. The SDK is 0.0.20 and the
 * `elevenlabs_agent_event` passthrough is typed as `Record<string, any>`, so no
 * field is assumed to exist. Anything unrecognised returns `null` and is
 * dropped — an unknown event must never break the conversation.
 */

/** Narrow an unknown value to a record without using `any`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(source: unknown, key: string): string | null {
  if (!isRecord(source)) return null;
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The ElevenLabs passthrough rides inside `elevenlabs_agent_event` as
 * `{ elevenlabs_event_type, data }`. This is the only place interruption is
 * reported on the LITE connector path — there is no `onInterruption` callback
 * in either SDK.
 */
export function mapElevenLabsEvent(payload: unknown): ChatHistoryEvent | null {
  if (!isRecord(payload)) return null;
  const eventType = readString(payload, "elevenlabs_event_type");
  if (!eventType) return null;
  const data = isRecord(payload.data) ? payload.data : {};

  switch (eventType) {
    case "interruption":
      return { type: "interrupted" };

    case "agent_response_correction": {
      // The agent was cut off; `corrected_agent_response` is the truncated
      // text that was actually spoken. Replace what we optimistically showed.
      const corrected = readString(data, "corrected_agent_response");
      return corrected === null ? null : { type: "corrected", text: corrected };
    }

    case "user_transcript": {
      const text = readString(data, "user_transcript") ?? readString(data, "text");
      return text === null ? null : { type: "final", sender: MessageSender.USER, text };
    }

    case "agent_response": {
      const text = readString(data, "agent_response") ?? readString(data, "text");
      return text === null ? null : { type: "final", sender: MessageSender.AVATAR, text };
    }

    case "internal_tentative_agent_response": {
      const text =
        readString(data, "tentative_agent_response") ?? readString(data, "agent_response");
      return text === null ? null : { type: "chunk", sender: MessageSender.AVATAR, text };
    }

    default:
      // vad_score, conversation_initiation_metadata, client_tool_call, ...
      return null;
  }
}

/** Avatar's `session.stopped` reasons -> our error codes. */
const STOP_REASON_TO_CODE: Record<string, SessionErrorCode> = {
  IDLE_TIMEOUT: "idle_timeout",
  MAX_DURATION_REACHED: "max_duration",
  NO_CREDITS: "no_credits",
  AVATAR_DELETED: "avatar_unavailable",
  AGENT_HANG_UP: "agent_hung_up",
  SERVER_ERROR: "connection_lost",
  ZOMBIE_SESSION_REAP: "connection_lost",
  USER_DISCONNECTED: "unknown",
  USER_CLOSED: "unknown",
};

export function mapStopReason(reason: string | null | undefined): SessionEndReason {
  if (!reason) return "unknown";
  if (reason === "USER_CLOSED" || reason === "USER_DISCONNECTED") return "client";
  return STOP_REASON_TO_CODE[reason] ?? "unknown";
}

const ERROR_COPY: Record<SessionErrorCode, { message: string; retryable: boolean }> = {
  mic_denied: {
    message: "We need microphone access to talk. Allow it in your browser, then try again.",
    retryable: true,
  },
  token_failed: {
    message: "We couldn't start the session. Please try again in a moment.",
    retryable: true,
  },
  session_start_failed: {
    message: "The avatar couldn't be reached. Please try again.",
    retryable: true,
  },
  no_credits: {
    message: "This avatar is temporarily unavailable. Please check back later.",
    retryable: false,
  },
  idle_timeout: { message: "The conversation timed out after a pause.", retryable: true },
  max_duration: { message: "This conversation reached its time limit.", retryable: true },
  avatar_unavailable: { message: "This avatar is no longer available.", retryable: false },
  agent_hung_up: { message: "The assistant ended the conversation.", retryable: true },
  connection_lost: { message: "The connection dropped. Please try again.", retryable: true },
  unknown: { message: "Something went wrong. Please try again.", retryable: true },
};

/** Build a user-facing error. Vendor text is never surfaced. */
export function toSessionError(code: SessionErrorCode): SessionError {
  const copy = ERROR_COPY[code];
  return { code, message: copy.message, retryable: copy.retryable };
}

/** Classify an exception thrown while starting a session. */
export function classifyStartError(error: unknown): SessionError {
  const name = error instanceof Error ? error.name : "";
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (name === "NotAllowedError" || name === "NotFoundError" || /permission|microphone/i.test(text))
    return toSessionError("mic_denied");
  if (/token/i.test(text)) return toSessionError("token_failed");
  return toSessionError("session_start_failed");
}
