"use client";

import { useEffect } from "react";
import { useChatHistory } from "@/avatar";
import type { AvatarMessage } from "@/avatar";

/**
 * Watches the transcript and reports finalised turns.
 *
 * A component rather than a hook call inside the provider, because reading the
 * transcript means being *inside* `AvatarProvider`. It renders nothing.
 */
export function FootprintRecorder({
  onMessages,
}: {
  onMessages: (messages: readonly AvatarMessage[]) => void;
}) {
  const messages = useChatHistory();

  useEffect(() => {
    onMessages(messages);
  }, [messages, onMessages]);

  return null;
}
