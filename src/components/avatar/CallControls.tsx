"use client";

import { useEffect, useRef } from "react";
import { useAvatarActions, useSession, useVoiceChat } from "@/avatar";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { MicIcon, MicOffIcon, PhoneOffIcon, StopIcon, SubtitlesIcon } from "@/components/ui/icons";

export interface CallControlsProps {
  isTranscriptOpen: boolean;
  onToggleTranscript: () => void;
  showTranscriptToggle?: boolean;
  /** True while the end-call confirmation is showing. Owned by the stage, so
   *  Escape can cancel the confirmation instead of closing the whole call. */
  isConfirmingEnd: boolean;
  onRequestEnd: () => void;
  onCancelEnd: () => void;
  /** End the call and put the widget away. */
  onEnd: () => void;
}

/**
 * A floating pill over the video, the way a video-call UI reads — not a
 * toolbar bolted under the frame.
 */
export function CallControls({
  isTranscriptOpen,
  onToggleTranscript,
  showTranscriptToggle = true,
  isConfirmingEnd,
  onRequestEnd,
  onCancelEnd,
  onEnd,
}: CallControlsProps) {
  const { status } = useSession();
  const { isMuted, toggleMute } = useVoiceChat();
  const { interrupt } = useAvatarActions();

  const isLive = status === "listening" || status === "speaking";

  // Focused explicitly rather than with `autoFocus`: the prompt replaces the
  // control pill in place, and the keyboard should land on the safe answer.
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isConfirmingEnd) cancelRef.current?.focus();
  }, [isConfirmingEnd]);

  if (isConfirmingEnd) {
    return (
      <div className="absolute inset-x-0 bottom-0 flex justify-center p-5">
        <div
          role="dialog"
          aria-label="End this call?"
          className="flex max-w-full flex-col items-center gap-3 rounded-3xl bg-brand-950/80 p-4 text-center shadow-xl ring-1 ring-white/10 backdrop-blur-md"
        >
          <p className="text-sm font-medium text-white">End this call?</p>
          <div className="flex items-center justify-center gap-2">
            {/* "Keep talking" first and focused: the prompt exists to catch a
                mistaken tap, so the safe answer is the one under your thumb. */}
            <Button
              ref={cancelRef}
              variant="ghost"
              className="text-white hover:bg-white/10"
              onClick={onCancelEnd}
            >
              Keep talking
            </Button>
            <Button variant="danger" onClick={onEnd}>
              End call
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-x-0 bottom-0 flex justify-center p-5">
      <div className="flex items-center gap-2 rounded-full bg-brand-950/70 p-2 shadow-xl ring-1 ring-white/10 backdrop-blur-md">
        <IconButton
          label={isMuted ? "Unmute microphone" : "Mute microphone"}
          active={isMuted}
          onClick={() => void toggleMute()}
          disabled={!isLive}
          tone="onDark"
        >
          {isMuted ? <MicOffIcon /> : <MicIcon />}
        </IconButton>

        {/* Speaking over the avatar interrupts it automatically; this is the
            manual equivalent for people who would rather tap than talk. */}
        <IconButton
          label="Stop the avatar talking"
          onClick={interrupt}
          disabled={status !== "speaking"}
          tone="onDark"
        >
          <StopIcon />
        </IconButton>

        {showTranscriptToggle ? (
          <IconButton
            label={isTranscriptOpen ? "Hide subtitles" : "Show subtitles"}
            active={isTranscriptOpen}
            aria-expanded={isTranscriptOpen}
            onClick={onToggleTranscript}
            tone="onDark"
          >
            <SubtitlesIcon />
          </IconButton>
        ) : null}

        <span aria-hidden className="mx-1 h-6 w-px bg-white/15" />

        <IconButton label="End conversation" tone="danger" onClick={onRequestEnd}>
          <PhoneOffIcon />
        </IconButton>
      </div>
    </div>
  );
}
