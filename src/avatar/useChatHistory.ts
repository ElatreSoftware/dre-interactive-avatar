"use client";

import { useAvatarContext } from "./context";
import type { AvatarMessage } from "./types";

/**
 * The conversation so far: spoken turns from both sides, plus anything the
 * user typed. Interrupted avatar turns carry `wasInterrupted` and the text
 * that was actually spoken, not the text the model had planned.
 */
export function useChatHistory(): AvatarMessage[] {
  return useAvatarContext().messages;
}
