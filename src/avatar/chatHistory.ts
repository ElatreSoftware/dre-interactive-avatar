import { MessageSender, type AvatarMessage } from "./types";

/**
 * Chat history as a pure reducer.
 *
 * The official demo keeps this inline in the provider with a `currentSenderRef`
 * and a pile of `setMessages(prev => ...)` closures. Pulling it out means every
 * ordering that actually bites — interruption mid-utterance, a correction with
 * no preceding chunks, a final with no chunks, a typed message landing between
 * two spoken turns — is a unit test rather than something you discover live.
 */

export type ChatHistoryEvent =
  | { type: "chunk"; sender: MessageSender; text: string }
  | { type: "final"; sender: MessageSender; text: string }
  /** The user typed this; it is final the moment it is sent. */
  | { type: "typed"; text: string }
  | { type: "interrupted" }
  | { type: "corrected"; text: string }
  | { type: "closePartials" }
  | { type: "reset" };

/**
 * ElevenLabs audio tags — `[slow]`, `[excited]`, `[whispers]`, `[laughs]` — are
 * delivery directives for the TTS engine, not words the avatar says. They show
 * up inline in `agent_response` text and must never reach the transcript.
 *
 * Conservative on purpose: only a short bracketed phrase (at most four words,
 * no sentence punctuation) is treated as a tag, so genuine bracketed prose like
 * "[see the attached form]" survives. A trailing unterminated bracket is hidden
 * too, so a tag split across streaming chunks never flashes on screen.
 */
const AUDIO_TAG = /\[[^\]\n]{1,40}\]/g;
const TRAILING_PARTIAL_TAG = /\[[^\]\n]{0,40}$/;

function looksLikeAudioTag(inner: string): boolean {
  const trimmed = inner.trim();
  if (!trimmed) return false;
  if (/[.!?,;:]/.test(trimmed)) return false;
  return trimmed.split(/\s+/).length <= 4;
}

export function stripAudioTags(text: string): string {
  return text
    .replace(AUDIO_TAG, (match) => (looksLikeAudioTag(match.slice(1, -1)) ? "" : match))
    .replace(TRAILING_PARTIAL_TAG, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

let seq = 0;
function nextId(sender: MessageSender): string {
  seq += 1;
  return `${sender}-${seq}`;
}

/** Test helper: make ids deterministic. */
export function resetMessageIds(): void {
  seq = 0;
}

function lastIndexOfSender(messages: AvatarMessage[], sender: MessageSender): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.sender === sender) return i;
  }
  return -1;
}

function openMessage(
  messages: AvatarMessage[],
  sender: MessageSender,
): { index: number; message: AvatarMessage } | null {
  const index = lastIndexOfSender(messages, sender);
  const message = index >= 0 ? messages[index] : undefined;
  return message && message.isPartial ? { index, message } : null;
}

function create(
  sender: MessageSender,
  message: string,
  extra: Partial<AvatarMessage> = {},
): AvatarMessage {
  return {
    id: nextId(sender),
    sender,
    rawMessage: message,
    message: display(sender, message),
    isPartial: false,
    timestamp: Date.now(),
    ...extra,
  };
}

/** Audio tags only ever appear in avatar speech; user text is left untouched. */
function display(sender: MessageSender, raw: string): string {
  return sender === MessageSender.AVATAR ? stripAudioTags(raw) : raw;
}

/** Set a message's text, keeping the raw and displayed forms in step. */
function withText(
  message: AvatarMessage,
  raw: string,
  extra: Partial<AvatarMessage> = {},
): Partial<AvatarMessage> {
  return { rawMessage: raw, message: display(message.sender, raw), ...extra };
}

function replaceAt(
  messages: AvatarMessage[],
  index: number,
  patch: Partial<AvatarMessage>,
): AvatarMessage[] {
  const next = [...messages];
  const current = messages[index];
  if (!current) return messages;
  next[index] = { ...current, ...patch };
  return next;
}

export function chatHistoryReducer(
  messages: AvatarMessage[],
  event: ChatHistoryEvent,
): AvatarMessage[] {
  switch (event.type) {
    case "reset":
      return [];

    case "chunk": {
      const open = openMessage(messages, event.sender);
      // User chunks arrive cumulative (the whole utterance so far); avatar
      // chunks arrive as deltas. Appending a cumulative chunk would repeat it.
      if (!open) {
        return [...messages, create(event.sender, event.text, { isPartial: true })];
      }
      // Accumulate on the RAW text: a tag split across chunks ("[sl" + "ow]")
      // only becomes strippable once both halves have arrived.
      const raw =
        event.sender === MessageSender.USER ? event.text : open.message.rawMessage + event.text;
      return replaceAt(messages, open.index, withText(open.message, raw));
    }

    case "final": {
      const open = openMessage(messages, event.sender);
      if (open) {
        return replaceAt(messages, open.index, withText(open.message, event.text, {
          isPartial: false,
        }));
      }

      const lastIndex = lastIndexOfSender(messages, event.sender);
      const last = lastIndex >= 0 ? messages[lastIndex] : undefined;
      // A spoken final that just repeats what was typed is the agent echoing
      // our own message back; do not show it twice.
      if (last && last.rawMessage === event.text) return messages;
      return [...messages, create(event.sender, event.text)];
    }

    case "typed":
      // Typed messages never produce a transcription event, so nothing else
      // will ever add them. This is the only path that puts them on screen.
      return [...messages, create(MessageSender.USER, event.text, { isTyped: true })];

    case "interrupted": {
      const index = lastIndexOfSender(messages, MessageSender.AVATAR);
      if (index < 0) return messages;
      return replaceAt(messages, index, { isPartial: false, wasInterrupted: true });
    }

    case "corrected": {
      const index = lastIndexOfSender(messages, MessageSender.AVATAR);
      if (index < 0) {
        return [
          ...messages,
          create(MessageSender.AVATAR, event.text, { wasInterrupted: true }),
        ];
      }
      const target = messages[index];
      if (!target) return messages;
      return replaceAt(
        messages,
        index,
        withText(target, event.text, { isPartial: false, wasInterrupted: true }),
      );
    }

    case "closePartials":
      if (!messages.some((m) => m.isPartial)) return messages;
      return messages.map((m) => (m.isPartial ? { ...m, isPartial: false } : m));
  }
}
