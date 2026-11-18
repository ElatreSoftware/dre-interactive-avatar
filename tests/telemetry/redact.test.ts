import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanText, keepTranscripts, redact } from "@/telemetry/redact";
import { FOOTPRINT_VERSION, MAX_TEXT_LENGTH, type FootprintEvent } from "@/telemetry/schema";

function turn(text: string): FootprintEvent {
  return {
    v: FOOTPRINT_VERSION,
    id: "id-123456",
    seq: 1,
    sessionKey: "session-1",
    clientTs: 1,
    type: "transcript_turn",
    sender: "user",
    text,
    isTyped: false,
    wasInterrupted: false,
    charCount: text.length,
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("cleanText", () => {
  it("caps length", () => {
    expect(cleanText("x".repeat(MAX_TEXT_LENGTH + 500))).toHaveLength(MAX_TEXT_LENGTH);
  });

  it.each([
    ["newlines", "a\nb", "a b"],
    ["carriage returns", "a\r\nb", "a b"],
    ["tabs", "a\tb", "a b"],
    ["null bytes", "a\u0000b", "a b"],
    ["ANSI escapes", "a\u001b[31mred", "a [31mred"],
    ["DEL", "a\u007fb", "a b"],
  ])("neutralises %s", (_label, input, expected) => {
    expect(cleanText(input)).toBe(expected);
  });

  it("leaves ordinary text, punctuation and non-Latin scripts alone", () => {
    expect(cleanText("Hello — வணக்கம், 你好! 😀")).toBe("Hello — வணக்கம், 你好! 😀");
  });
});

describe("redact", () => {
  it("keeps transcript text when transcripts are on", () => {
    expect(redact(turn("Hello there"), { keepTranscripts: true })).toMatchObject({
      text: "Hello there",
    });
  });

  it("drops the words but keeps the turn when transcripts are off", () => {
    const result = redact(turn("Something private"), { keepTranscripts: false });
    expect(result).toMatchObject({ type: "transcript_turn", text: "", charCount: 17 });
  });

  it("cleans an error message too", () => {
    const event = {
      ...turn("x"),
      type: "error" as const,
      code: "boom",
      message: "failed\nat\u0000line",
    } as unknown as FootprintEvent;
    expect(redact(event, { keepTranscripts: true })).toMatchObject({ message: "failed at line" });
  });

  it("passes a lifecycle event through untouched", () => {
    const event = { ...turn("x"), type: "widget_opened" } as unknown as FootprintEvent;
    expect(redact(event, { keepTranscripts: true })).toBe(event);
  });
});

describe("keepTranscripts", () => {
  it("defaults to on", () => {
    expect(keepTranscripts()).toBe(true);
  });

  it("is off only for an explicit false", () => {
    vi.stubEnv("FOOTPRINT_TRANSCRIPTS", "false");
    expect(keepTranscripts()).toBe(false);
    vi.stubEnv("FOOTPRINT_TRANSCRIPTS", "0");
    expect(keepTranscripts()).toBe(true);
  });
});
