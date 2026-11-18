import { MAX_TEXT_LENGTH, type FootprintEvent } from "./schema";

/**
 * Last stop before disk.
 *
 * These lines end up in a file that someone will eventually `cat`, pipe
 * through `jq`, or paste into a terminal, so text is capped and stripped of
 * control characters. Newlines are not a line-forging risk — `JSON.stringify`
 * escapes them — but a transcript full of ANSI escapes in someone's terminal
 * is its own kind of unpleasant surprise.
 */

// Everything below space, plus DEL. A transcript has no legitimate use for
// any of them, and stripping them is the entire point of this module — which
// is why the rule against control characters in a regex is disabled here
// rather than worked around.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

export function cleanText(value: string): string {
  return value.replace(CONTROL_CHARACTERS, " ").replace(/\s{2,}/g, " ").trim().slice(0, MAX_TEXT_LENGTH);
}

export interface RedactionOptions {
  /** When false, transcript turns keep their shape but lose their words. */
  keepTranscripts: boolean;
}

/**
 * Returns the event as it should be stored, or `null` when it should not be
 * stored at all.
 */
export function redact(event: FootprintEvent, options: RedactionOptions): FootprintEvent | null {
  if (event.type === "transcript_turn") {
    if (!options.keepTranscripts) {
      // The turn still happened, and knowing that it did — and how long it was
      // — is most of the analytical value without keeping any of the words.
      return { ...event, text: "" };
    }
    return { ...event, text: cleanText(event.text) };
  }

  if (event.type === "error") {
    return { ...event, message: cleanText(event.message) };
  }

  if (event.type === "widget_loaded") {
    return {
      ...event,
      ...(event.referrer ? { referrer: cleanText(event.referrer) } : {}),
      ...(event.userId ? { userId: cleanText(event.userId) } : {}),
    };
  }

  return event;
}

/** Transcripts are stored unless explicitly switched off. */
export function keepTranscripts(): boolean {
  return process.env.FOOTPRINT_TRANSCRIPTS !== "false";
}
