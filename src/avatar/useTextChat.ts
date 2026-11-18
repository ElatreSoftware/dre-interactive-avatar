"use client";

import { useCallback } from "react";
import { useAvatarContext } from "./context";

export interface UseTextChatResult {
  /** Send a typed message as a user turn. */
  sendMessage: (text: string) => void;
  /** Silent context for the agent; does not prompt a reply. */
  sendContextualUpdate: (text: string) => void;
  /** Tell the agent the user is active, so it holds off speaking (~2s). */
  notifyUserActivity: () => void;
}

/**
 * Typing alongside voice.
 *
 * `sendMessage` also appends the message to the transcript itself. That is not
 * belt-and-braces: a typed message produces no `user_transcript` event, so if
 * the UI waited for one the message would be answered but never shown. (The
 * official SDK demo has exactly this gap.)
 */
export function useTextChat(): UseTextChatResult {
  const { sessionRef, appendTypedMessage } = useAvatarContext();

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      appendTypedMessage(trimmed);
      try {
        sessionRef.current?.sendUserMessage(trimmed);
      } catch (error) {
        console.warn("[Avatar] sendUserMessage failed", error);
      }
    },
    [appendTypedMessage, sessionRef],
  );

  const sendContextualUpdate = useCallback(
    (text: string) => {
      try {
        sessionRef.current?.sendContextualUpdate(text);
      } catch (error) {
        console.warn("[Avatar] sendContextualUpdate failed", error);
      }
    },
    [sessionRef],
  );

  const notifyUserActivity = useCallback(() => {
    try {
      sessionRef.current?.sendUserActivity();
    } catch (error) {
      console.warn("[Avatar] sendUserActivity failed", error);
    }
  }, [sessionRef]);

  return { sendMessage, sendContextualUpdate, notifyUserActivity };
}
