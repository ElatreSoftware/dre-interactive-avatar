"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceChat } from "./useVoiceChat";
import type { MicrophoneDevice } from "./types";

export interface UseMicrophoneDevicesResult {
  devices: MicrophoneDevice[];
  selectedDeviceId: string | null;
  selectDevice: (deviceId: string) => Promise<void>;
}

/**
 * Enumerate microphones and switch between them.
 *
 * Labels are only populated once permission has been granted, so this is most
 * useful after the session has started.
 */
export function useMicrophoneDevices(): UseMicrophoneDevicesResult {
  const { setDevice } = useVoiceChat();
  const [devices, setDevices] = useState<MicrophoneDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  /** Guards against an older switch resolving after a newer one. */
  const requestSeq = useRef(0);

  const enumerate = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        all
          .filter((device) => device.kind === "audioinput" && device.deviceId !== "default")
          .map((device) => ({
            deviceId: device.deviceId,
            label: device.label || `Microphone ${device.deviceId.slice(0, 4)}`,
          })),
      );
    } catch (error) {
      console.warn("[Avatar] could not enumerate microphones", error);
    }
  }, []);

  const selectDevice = useCallback(
    async (deviceId: string) => {
      const request = (requestSeq.current += 1);
      const ok = await setDevice({ exact: deviceId });
      // Ignore a stale result, and do not claim a device we failed to switch to.
      if (ok && request === requestSeq.current) setSelectedDeviceId(deviceId);
    },
    [setDevice],
  );

  useEffect(() => {
    // The device list can only be read asynchronously, and it changes outside
    // React (plugging in a headset). The resulting setState is therefore not
    // the render-loop hazard the rule guards against; `enumerate` already
    // tolerates being called again and bails on failure.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void enumerate();
    const media = navigator.mediaDevices;
    if (!media?.addEventListener) return;
    media.addEventListener("devicechange", enumerate);
    return () => media.removeEventListener("devicechange", enumerate);
  }, [enumerate]);

  return { devices, selectedDeviceId, selectDevice };
}
