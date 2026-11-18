"use client";

import { useCallback, useEffect, useImperativeHandle, useState, type Ref } from "react";
import { requestMicrophoneAccess, useSession } from "@/avatar";
import type { MicrophonePermission } from "@/avatar";
import { AvatarCallStage } from "./AvatarCallStage";
import { AvatarLauncher } from "./AvatarLauncher";

export interface InteractiveAvatarProps {
  title?: string;
  /** Start the session as soon as the stage opens. */
  autoStart?: boolean;
  allowTextInput?: boolean;
  showTranscript?: boolean;
  poster?: string;
  launcherLabel?: string;
  className?: string;
  /** Told whenever the stage opens or closes. */
  onOpenChange?: (isOpen: boolean) => void;
  /**
   * Told how much room the widget needs. An embedder sizes its frame from
   * this — including for the permission notice, which is taller than the
   * launcher it sits above.
   */
  onLayoutChange?: (layout: "collapsed" | "notice" | "expanded") => void;
  /** The outcome of the microphone prompt — the one thing only this component sees. */
  onPermission?: (permission: MicrophonePermission) => void;
  /**
   * Lets an embedder open or close the call from outside — the host page's
   * `DreWidget.open()`. Opening this way still goes through the microphone
   * prompt; there is no back door that skips it.
   */
  controlRef?: Ref<AvatarControl>;
}

export interface AvatarControl {
  open: () => void;
  close: () => void;
}

const PERMISSION_NOTICE: Record<"denied" | "unavailable" | "blocked_by_embedder", string> = {
  denied: "Microphone access is blocked. Allow it in your browser, then try again.",
  unavailable: "We couldn't find a microphone. Plug one in and try again.",
  // Nothing the visitor does will fix this one — it is the embedding page's
  // iframe tag that is wrong, so the message says so rather than blaming them.
  blocked_by_embedder: "This page hasn't allowed microphone access for the assistant.",
};

/**
 * The drop-in widget: a small corner button that opens a full avatar call.
 *
 * Permission is settled before the stage opens, so the user never watches a
 * call spin up only to die on a prompt they haven't answered yet.
 */
export function InteractiveAvatar({
  title = "AI Assistant",
  autoStart = true,
  allowTextInput = true,
  showTranscript = true,
  poster,
  launcherLabel,
  className,
  onOpenChange,
  onLayoutChange,
  onPermission,
  controlRef,
}: InteractiveAvatarProps) {
  const { isActive, startSession, stopSession } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleOpen = useCallback(async () => {
    setNotice(null);
    setIsRequesting(true);
    try {
      const permission = await requestMicrophoneAccess();
      onPermission?.(permission);
      if (permission !== "granted") {
        setNotice(PERMISSION_NOTICE[permission]);
        return;
      }
      setIsOpen(true);
      onOpenChange?.(true);
      if (autoStart) void startSession();
    } finally {
      setIsRequesting(false);
    }
  }, [autoStart, onOpenChange, onPermission, startSession]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    onOpenChange?.(false);
    if (isActive) void stopSession();
  }, [isActive, onOpenChange, stopSession]);

  useEffect(() => {
    onLayoutChange?.(isOpen ? "expanded" : notice ? "notice" : "collapsed");
  }, [isOpen, notice, onLayoutChange]);

  useImperativeHandle(
    controlRef,
    () => ({ open: () => void handleOpen(), close: handleClose }),
    [handleOpen, handleClose],
  );

  if (isOpen) {
    return (
      <AvatarCallStage
        title={title}
        onClose={handleClose}
        allowTextInput={allowTextInput}
        showTranscript={showTranscript}
        poster={poster}
      />
    );
  }

  return (
    <AvatarLauncher
      onClick={() => void handleOpen()}
      label={launcherLabel}
      isBusy={isRequesting}
      notice={notice}
      className={className}
    />
  );
}
