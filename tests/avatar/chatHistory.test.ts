import { beforeEach, describe, expect, it } from "vitest";
import { chatHistoryReducer, resetMessageIds, stripAudioTags } from "@/avatar/chatHistory";
import type { ChatHistoryEvent } from "@/avatar/chatHistory";
import { MessageSender, type AvatarMessage } from "@/avatar/types";

const USER = MessageSender.USER;
const AVATAR = MessageSender.AVATAR;

function run(events: ChatHistoryEvent[], from: AvatarMessage[] = []): AvatarMessage[] {
  return events.reduce(chatHistoryReducer, from);
}

const texts = (messages: AvatarMessage[]) => messages.map((m) => m.message);

beforeEach(resetMessageIds);

describe("streaming", () => {
  it("replaces on user chunks, which arrive cumulative", () => {
    const messages = run([
      { type: "chunk", sender: USER, text: "what" },
      { type: "chunk", sender: USER, text: "what time" },
      { type: "chunk", sender: USER, text: "what time is it" },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ message: "what time is it", isPartial: true });
  });

  it("appends on avatar chunks, which arrive as deltas", () => {
    const messages = run([
      { type: "chunk", sender: AVATAR, text: "It is " },
      { type: "chunk", sender: AVATAR, text: "four " },
      { type: "chunk", sender: AVATAR, text: "o'clock" },
    ]);
    expect(texts(messages)).toEqual(["It is four o'clock"]);
  });

  it("finalises the open message with the authoritative text", () => {
    const messages = run([
      { type: "chunk", sender: AVATAR, text: "It is f" },
      { type: "final", sender: AVATAR, text: "It is four o'clock." },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ message: "It is four o'clock.", isPartial: false });
  });

  it("creates a message when a final arrives with no chunks", () => {
    expect(texts(run([{ type: "final", sender: USER, text: "standalone" }]))).toEqual([
      "standalone",
    ]);
  });

  it("starts a new message rather than reopening a finalised one", () => {
    const messages = run([
      { type: "final", sender: AVATAR, text: "first" },
      { type: "chunk", sender: AVATAR, text: "second" },
    ]);
    expect(texts(messages)).toEqual(["first", "second"]);
  });

  it("interleaves the two speakers in order", () => {
    const messages = run([
      { type: "final", sender: USER, text: "hello" },
      { type: "final", sender: AVATAR, text: "hi there" },
      { type: "final", sender: USER, text: "bye" },
    ]);
    expect(messages.map((m) => m.sender)).toEqual([USER, AVATAR, USER]);
  });

  it("gives every message a unique id", () => {
    const messages = run([
      { type: "final", sender: USER, text: "a" },
      { type: "final", sender: AVATAR, text: "b" },
      { type: "typed", text: "c" },
    ]);
    expect(new Set(messages.map((m) => m.id)).size).toBe(3);
  });

  it("closes partials on demand", () => {
    const messages = run([
      { type: "chunk", sender: AVATAR, text: "half" },
      { type: "closePartials" },
    ]);
    expect(messages.every((m) => !m.isPartial)).toBe(true);
  });

  it("resets to empty", () => {
    expect(run([{ type: "final", sender: USER, text: "x" }, { type: "reset" }])).toEqual([]);
  });
});

describe("typed messages", () => {
  // The bug this guards: typed text produces no transcription event, so if the
  // UI waits for one the message is answered but never shown.
  it("appears in the history immediately, flagged as typed", () => {
    const messages = run([{ type: "typed", text: "hello there" }]);
    expect(messages).toEqual([
      expect.objectContaining({
        sender: USER,
        message: "hello there",
        isTyped: true,
        isPartial: false,
      }),
    ]);
  });

  it("does not get duplicated if the agent echoes it back as a transcript", () => {
    const messages = run([
      { type: "typed", text: "hello there" },
      { type: "final", sender: USER, text: "hello there" },
    ]);
    expect(texts(messages)).toEqual(["hello there"]);
  });

  it("sits in order between spoken turns", () => {
    const messages = run([
      { type: "final", sender: USER, text: "spoken one" },
      { type: "final", sender: AVATAR, text: "reply" },
      { type: "typed", text: "typed one" },
      { type: "final", sender: AVATAR, text: "second reply" },
    ]);
    expect(texts(messages)).toEqual(["spoken one", "reply", "typed one", "second reply"]);
    expect(messages[2]?.isTyped).toBe(true);
  });
});

describe("interruption", () => {
  it("marks the cut-off avatar message and closes it", () => {
    const messages = run([
      { type: "chunk", sender: AVATAR, text: "The answer is forty two and" },
      { type: "interrupted" },
    ]);
    expect(messages[0]).toMatchObject({ wasInterrupted: true, isPartial: false });
  });

  it("applies the correction as the text actually spoken", () => {
    const messages = run([
      { type: "chunk", sender: AVATAR, text: "The answer is forty two and then some" },
      { type: "interrupted" },
      { type: "corrected", text: "The answer is forty" },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      message: "The answer is forty",
      wasInterrupted: true,
      isPartial: false,
    });
  });

  it("creates a message if a correction arrives with no avatar turn", () => {
    expect(run([{ type: "corrected", text: "truncated" }])).toEqual([
      expect.objectContaining({ sender: AVATAR, message: "truncated", wasInterrupted: true }),
    ]);
  });

  it("ignores an interruption with nothing to interrupt", () => {
    const before = run([{ type: "final", sender: USER, text: "hi" }]);
    expect(chatHistoryReducer(before, { type: "interrupted" })).toBe(before);
  });

  it("survives a full interrupt-and-answer-again cycle", () => {
    const messages = run([
      { type: "final", sender: USER, text: "tell me a long story" },
      { type: "chunk", sender: AVATAR, text: "Once upon a time there was" },
      { type: "interrupted" },
      { type: "corrected", text: "Once upon a time" },
      { type: "typed", text: "actually, never mind" },
      { type: "final", sender: AVATAR, text: "No problem." },
    ]);
    expect(texts(messages)).toEqual([
      "tell me a long story",
      "Once upon a time",
      "actually, never mind",
      "No problem.",
    ]);
    expect(messages[1]?.wasInterrupted).toBe(true);
    expect(messages[3]?.wasInterrupted).toBeUndefined();
  });
});

describe("purity", () => {
  it("never mutates the array it was given", () => {
    const before = run([{ type: "chunk", sender: AVATAR, text: "x" }]);
    const snapshot = structuredClone(before);
    chatHistoryReducer(before, { type: "chunk", sender: AVATAR, text: "y" });
    expect(before).toEqual(snapshot);
  });
});

describe("audio tags", () => {
  it("strips a leading delivery tag", () => {
    expect(stripAudioTags("[slow] I can do that, but which order do you mean?")).toBe(
      "I can do that, but which order do you mean?",
    );
  });

  it("strips tags anywhere in the sentence, tidying the spacing", () => {
    expect(stripAudioTags("Hello [laughs] there [whispers] friend")).toBe(
      "Hello there friend",
    );
    expect(stripAudioTags("Really? [sighs] Fine.")).toBe("Really? Fine.");
  });

  it("strips multi-word tags up to four words", () => {
    expect(stripAudioTags("[strong french accent] Bonjour")).toBe("Bonjour");
    expect(stripAudioTags("[speaking very slowly indeed] Hello")).toBe("Hello");
  });

  it("leaves genuine bracketed prose alone", () => {
    expect(stripAudioTags("Please sign [the form attached to this email] today")).toBe(
      "Please sign [the form attached to this email] today",
    );
    expect(stripAudioTags("Check [section 3.1, clause b] first")).toBe(
      "Check [section 3.1, clause b] first",
    );
  });

  it("hides a tag that is still streaming in, so it never flashes", () => {
    expect(stripAudioTags("Here we go [sl")).toBe("Here we go");
  });

  it("handles non-Latin scripts", () => {
    expect(stripAudioTags("[slow] கேக்குது, ஆம். நீங்கள் என்ன செய்ய சொல்லுறீங்க")).toBe(
      "கேக்குது, ஆம். நீங்கள் என்ன செய்ய சொல்லுறீங்க",
    );
  });

  it("leaves a message that is nothing but a tag empty", () => {
    expect(stripAudioTags("[laughs]")).toBe("");
  });

  it("strips tags from avatar finals but not from user text", () => {
    const messages = run([
      { type: "final", sender: USER, text: "[slow] is a literal thing I said" },
      { type: "final", sender: AVATAR, text: "[excited] Of course!" },
    ]);
    expect(texts(messages)).toEqual([
      "[slow] is a literal thing I said",
      "Of course!",
    ]);
  });

  it("strips a tag split across streaming chunks", () => {
    const messages = run([
      { type: "chunk", sender: AVATAR, text: "Here we go [sl" },
      { type: "chunk", sender: AVATAR, text: "ow] and now we continue" },
    ]);
    expect(texts(messages)).toEqual(["Here we go and now we continue"]);
  });

  it("keeps the raw text alongside the cleaned one", () => {
    const messages = run([{ type: "final", sender: AVATAR, text: "[slow] Hello" }]);
    expect(messages[0]?.rawMessage).toBe("[slow] Hello");
    expect(messages[0]?.message).toBe("Hello");
  });

  it("strips tags from a correction too", () => {
    const messages = run([
      { type: "chunk", sender: AVATAR, text: "[slow] Once upon a time there was" },
      { type: "interrupted" },
      { type: "corrected", text: "[slow] Once upon a time" },
    ]);
    expect(texts(messages)).toEqual(["Once upon a time"]);
  });

  it("still de-duplicates an echoed typed message, comparing raw text", () => {
    const messages = run([
      { type: "typed", text: "hello there" },
      { type: "final", sender: USER, text: "hello there" },
    ]);
    expect(texts(messages)).toEqual(["hello there"]);
  });
});
