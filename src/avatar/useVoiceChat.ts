"use client";

import { useCallback } from "react";
import { useAvatarContext } from "./context";

export interface UseVoiceChatResult {
  isMuted: boolean;
  isUserTalking: boolean;
  isAvatarTalking: boolean;
  mute: () => Promise<void>;
  unmute: () => Promise<void>;
  toggleMute: () => Promise<void>;
  setDevice: (deviceId: ConstrainDOMString) => Promise<boolean>;
}

/** The microphone and who is currently talking. */
export function useVoiceChat(): UseVoiceChatResult {
  const { sessionRef, isMuted, isUserTalking, isAvatarTalking, setMuted } = useAvatarContext();

  const toggleMute = useCallback(() => setMuted(!isMuted), [isMuted, setMuted]);

  const setDevice = useCallback(
    async (deviceId: ConstrainDOMString) => {
      const session = sessionRef.current;
      if (!session) return false;
      try {
        return await session.voiceChat.setDevice(deviceId);
      } catch (error) {
        console.warn("[Avatar] setDevice failed", error);
        return false;
      }
    },
    [sessionRef],
  );

  return {
    isMuted,
    isUserTalking,
    isAvatarTalking,
    mute: () => setMuted(true),
    unmute: () => setMuted(false),
    toggleMute,
    setDevice,
  };
}
