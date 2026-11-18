import { describe, expect, it } from "vitest";
import {
  FOOTPRINT_VERSION,
  footprintBatch,
  footprintEvent,
  MAX_BATCH_SIZE,
  MAX_TEXT_LENGTH,
} from "@/telemetry/schema";

function event(payload: Record<string, unknown>) {
  return {
    v: FOOTPRINT_VERSION,
    id: "01234567-89ab",
    seq: 0,
    sessionKey: "session-key-1",
    clientTs: 1_700_000_000_000,
    ...payload,
  };
}

describe("footprintEvent", () => {
  it.each([
    ["widget_loaded", { type: "widget_loaded", locale: "en-GB", deviceClass: "mobile" }],
    ["widget_opened", { type: "widget_opened" }],
    ["mic_refused", { type: "mic_refused", reason: "blocked_by_embedder" }],
    ["session_started", { type: "session_started", avatarSessionId: "sess-1" }],
    [
      "session_ended",
      { type: "session_ended", reason: "client", durationMs: 1000, turns: 4, interruptions: 1 },
    ],
    ["mute_toggled", { type: "mute_toggled", isMuted: true }],
    ["connection_quality_changed", { type: "connection_quality_changed", quality: "bad" }],
    [
      "transcript_turn",
      {
        type: "transcript_turn",
        sender: "avatar",
        text: "Hello",
        isTyped: false,
        wasInterrupted: false,
        charCount: 5,
      },
    ],
    ["error", { type: "error", code: "mic_denied", message: "refused" }],
  ])("accepts a %s event", (_label, payload) => {
    expect(footprintEvent.safeParse(event(payload)).success).toBe(true);
  });

  it.each([
    ["an unknown type", { type: "exfiltrate" }],
    ["a missing type", {}],
    ["a bad enum value", { type: "mic_refused", reason: "bored" }],
    ["a negative duration", { type: "session_ended", reason: "client", durationMs: -1, turns: 0, interruptions: 0 }],
    ["a missing required field", { type: "mute_toggled" }],
  ])("rejects %s", (_label, payload) => {
    expect(footprintEvent.safeParse(event(payload)).success).toBe(false);
  });

  it("rejects an event from a future schema version", () => {
    const future = { ...event({ type: "widget_opened" }), v: FOOTPRINT_VERSION + 1 };
    expect(footprintEvent.safeParse(future).success).toBe(false);
  });

  it("rejects text beyond the cap, rather than storing it", () => {
    const tooLong = event({
      type: "transcript_turn",
      sender: "user",
      text: "x".repeat(MAX_TEXT_LENGTH + 1),
      isTyped: false,
      wasInterrupted: false,
      charCount: MAX_TEXT_LENGTH + 1,
    });
    expect(footprintEvent.safeParse(tooLong).success).toBe(false);
  });

  it("ignores fields it does not know about", () => {
    const parsed = footprintEvent.parse(event({ type: "widget_opened", injected: "x" }));
    expect(parsed).not.toHaveProperty("injected");
  });
});

describe("footprintBatch", () => {
  it("accepts a batch at the limit", () => {
    const events = Array.from({ length: MAX_BATCH_SIZE }, (_, seq) =>
      event({ type: "widget_opened", seq }),
    );
    expect(footprintBatch.safeParse({ events }).success).toBe(true);
  });

  it("refuses a batch over the limit", () => {
    const events = Array.from({ length: MAX_BATCH_SIZE + 1 }, () => event({ type: "widget_opened" }));
    expect(footprintBatch.safeParse({ events }).success).toBe(false);
  });

  it("refuses an empty batch", () => {
    expect(footprintBatch.safeParse({ events: [] }).success).toBe(false);
  });
});
