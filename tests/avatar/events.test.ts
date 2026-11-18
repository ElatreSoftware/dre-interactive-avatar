import { describe, expect, it } from "vitest";
import {
  classifyStartError,
  mapElevenLabsEvent,
  mapStopReason,
  toSessionError,
} from "@/avatar/events";
import { MessageSender } from "@/avatar/types";

describe("mapElevenLabsEvent", () => {
  it("maps an interruption", () => {
    expect(mapElevenLabsEvent({ elevenlabs_event_type: "interruption", data: {} })).toEqual({
      type: "interrupted",
    });
  });

  it("maps a response correction to the truncated text", () => {
    expect(
      mapElevenLabsEvent({
        elevenlabs_event_type: "agent_response_correction",
        data: {
          original_agent_response: "The full answer is forty two and then some",
          corrected_agent_response: "The full answer is forty",
        },
      }),
    ).toEqual({ type: "corrected", text: "The full answer is forty" });
  });

  it("drops a correction with no corrected text", () => {
    expect(
      mapElevenLabsEvent({ elevenlabs_event_type: "agent_response_correction", data: {} }),
    ).toBeNull();
  });

  it("maps transcripts, accepting either field name", () => {
    expect(
      mapElevenLabsEvent({
        elevenlabs_event_type: "user_transcript",
        data: { user_transcript: "hello" },
      }),
    ).toEqual({ type: "final", sender: MessageSender.USER, text: "hello" });
    expect(
      mapElevenLabsEvent({ elevenlabs_event_type: "user_transcript", data: { text: "hi" } }),
    ).toEqual({ type: "final", sender: MessageSender.USER, text: "hi" });
    expect(
      mapElevenLabsEvent({
        elevenlabs_event_type: "agent_response",
        data: { agent_response: "hey" },
      }),
    ).toEqual({ type: "final", sender: MessageSender.AVATAR, text: "hey" });
  });

  it("maps a tentative agent response to a chunk", () => {
    expect(
      mapElevenLabsEvent({
        elevenlabs_event_type: "internal_tentative_agent_response",
        data: { tentative_agent_response: "thinking" },
      }),
    ).toEqual({ type: "chunk", sender: MessageSender.AVATAR, text: "thinking" });
  });

  it("ignores unknown and malformed payloads without throwing", () => {
    expect(
      mapElevenLabsEvent({ elevenlabs_event_type: "vad_score", data: { vad_score: 0.9 } }),
    ).toBeNull();
    expect(mapElevenLabsEvent(null)).toBeNull();
    expect(mapElevenLabsEvent("nope")).toBeNull();
    expect(mapElevenLabsEvent({})).toBeNull();
    expect(mapElevenLabsEvent({ elevenlabs_event_type: "" })).toBeNull();
    expect(mapElevenLabsEvent({ elevenlabs_event_type: "user_transcript" })).toBeNull();
    expect(mapElevenLabsEvent({ elevenlabs_event_type: "user_transcript", data: "bad" })).toBeNull();
  });
});

describe("mapStopReason", () => {
  it("treats user-initiated stops as a clean client close", () => {
    expect(mapStopReason("USER_CLOSED")).toBe("client");
    expect(mapStopReason("USER_DISCONNECTED")).toBe("client");
  });

  it("maps server stop reasons to error codes", () => {
    expect(mapStopReason("IDLE_TIMEOUT")).toBe("idle_timeout");
    expect(mapStopReason("MAX_DURATION_REACHED")).toBe("max_duration");
    expect(mapStopReason("NO_CREDITS")).toBe("no_credits");
    expect(mapStopReason("AGENT_HANG_UP")).toBe("agent_hung_up");
    expect(mapStopReason("AVATAR_DELETED")).toBe("avatar_unavailable");
    expect(mapStopReason("ZOMBIE_SESSION_REAP")).toBe("connection_lost");
  });

  it("falls back to unknown", () => {
    expect(mapStopReason("SOMETHING_NEW")).toBe("unknown");
    expect(mapStopReason(null)).toBe("unknown");
    expect(mapStopReason(undefined)).toBe("unknown");
  });
});

describe("toSessionError", () => {
  it("produces user-facing copy and a retry flag", () => {
    expect(toSessionError("mic_denied")).toEqual({
      code: "mic_denied",
      message: expect.stringContaining("microphone"),
      retryable: true,
    });
    expect(toSessionError("no_credits").retryable).toBe(false);
    expect(toSessionError("avatar_unavailable").retryable).toBe(false);
  });

  it("never leaks vendor jargon into the message", () => {
    for (const code of ["mic_denied", "no_credits", "idle_timeout", "unknown"] as const) {
      expect(toSessionError(code).message).not.toMatch(/livekit|heygen|elevenlabs|jwt|token/i);
    }
  });
});

describe("classifyStartError", () => {
  it("detects a denied microphone", () => {
    const denied = new Error("Permission denied");
    denied.name = "NotAllowedError";
    expect(classifyStartError(denied).code).toBe("mic_denied");

    const missing = new Error("no device");
    missing.name = "NotFoundError";
    expect(classifyStartError(missing).code).toBe("mic_denied");
    expect(classifyStartError(new Error("microphone unavailable")).code).toBe("mic_denied");
  });

  it("detects a token failure", () => {
    expect(classifyStartError(new Error("failed to mint session token")).code).toBe("token_failed");
  });

  it("falls back to a start failure", () => {
    expect(classifyStartError(new Error("boom")).code).toBe("session_start_failed");
    expect(classifyStartError("string failure").code).toBe("session_start_failed");
    expect(classifyStartError(null).code).toBe("session_start_failed");
  });
});
