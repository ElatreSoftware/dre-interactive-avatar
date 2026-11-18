"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AvatarProvider } from "@/avatar";
import type { MicrophonePermission } from "@/avatar";
import { InteractiveAvatar, type AvatarControl } from "@/components/avatar";
import { useHostBridge } from "@/embed/useHostBridge";
import { FootprintRecorder, useFootprints } from "@/telemetry";

export interface EmbedWidgetProps {
  embedKey: string;
  grant: string;
  avatarId: string;
  /** The origin that framed us, as the server resolved it. */
  parentOrigin: string;
  dynamicVariables?: Record<string, string>;
  name: string;
  recordFootprints?: boolean;
}

/**
 * How long to wait for the host's `hello` before describing the embed.
 *
 * The handshake is a single message hop and normally lands in the same tick,
 * but it is not guaranteed to, and `widget_loaded` carries the embedder's user
 * id and the host's viewport. This delays that one event only — the collector
 * itself runs from mount, so a visitor who clicks inside the first 300ms is
 * still recorded.
 */
const IDENTITY_GRACE_MS = 300;

function newSessionKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Client half of the embed document: the widget, the bridge that tells the
 * host page how much room it needs, and the footprint collector.
 */
export function EmbedWidget({
  embedKey,
  grant,
  avatarId,
  parentOrigin,
  dynamicVariables,
  name,
  recordFootprints = true,
}: EmbedWidgetProps) {
  const control = useRef<AvatarControl>(null);
  const handlers = useMemo(
    () => ({
      onOpenRequest: () => control.current?.open(),
      onCloseRequest: () => control.current?.close(),
    }),
    [],
  );
  const { reportLayout, reportOpen, userId, hostViewport } = useHostBridge(parentOrigin, handlers);

  const [sessionKey] = useState(newSessionKey);

  // The grace period is the only thing that needs state; knowing the user id
  // already settles the question, so that half is derived rather than stored.
  const [graceElapsed, setGraceElapsed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGraceElapsed(true), IDENTITY_GRACE_MS);
    return () => clearTimeout(timer);
  }, []);
  const identitySettled = graceElapsed || userId !== null;

  const footprints = useFootprints({
    sessionKey,
    grant,
    userId,
    viewport: hostViewport,
    enabled: recordFootprints,
    identitySettled,
  });

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      reportOpen(isOpen);
      footprints.track({ type: isOpen ? "widget_opened" : "widget_closed" });
    },
    [footprints, reportOpen],
  );

  const handlePermission = useCallback(
    (permission: MicrophonePermission) => {
      footprints.track(
        permission === "granted"
          ? { type: "mic_granted" }
          : { type: "mic_refused", reason: permission },
      );
    },
    [footprints],
  );

  return (
    <AvatarProvider
      config={{ avatarId, embedKey, grant, dynamicVariables, greetingPrompt: "Hello" }}
      onEvent={footprints.onEvent}
    >
      <FootprintRecorder onMessages={footprints.onMessages} />
      <InteractiveAvatar
        title={name}
        onLayoutChange={reportLayout}
        onOpenChange={handleOpenChange}
        onPermission={handlePermission}
        controlRef={control}
      />
    </AvatarProvider>
  );
}
