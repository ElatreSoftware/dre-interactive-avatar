"use client";

import { useCallback } from "react";
import { useAvatarContext } from "./context";

export interface UseAvatarActionsResult {
  interrupt: () => void;
  startListening: () => void;
  stopListening: () => void;
}

/**
 * Direct commands to the avatar.
 *
 * `interrupt()` is the manual "stop talking" path. The reliable barge-in is the
 * ElevenLabs agent's own server-side VAD, which fires when the user speaks;
 * Avatar does not document `avatar.interrupt` for this connector, so this
 * may be a no-op server-side. We update the UI optimistically either way, and
 * it must never throw.
 */
export function useAvatarActions(): UseAvatarActionsResult {
  const { sessionRef, noteInterrupted } = useAvatarContext();

  const run = useCallback((label: string, action: () => void) => {
    try {
      action();
    } catch (error) {
      console.warn(`[Avatar] ${label} failed`, error);
    }
  }, []);

  return {
    interrupt: useCallback(() => {
      run("interrupt", () => sessionRef.current?.interrupt());
      noteInterrupted();
    }, [noteInterrupted, run, sessionRef]),
    startListening: useCallback(
      () => run("startListening", () => sessionRef.current?.startListening()),
      [run, sessionRef],
    ),
    stopListening: useCallback(
      () => run("stopListening", () => sessionRef.current?.stopListening()),
      [run, sessionRef],
    ),
  };
}
