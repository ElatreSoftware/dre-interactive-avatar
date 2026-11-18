"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useSession } from "@/avatar";
import { Button } from "@/components/ui/Button";
import { AvatarVideo } from "./AvatarVideo";
import { CallControls } from "./CallControls";
import { ConnectionQualityDot } from "./ConnectionQualityDot";
import { StatusPill } from "./StatusPill";
import { TranscriptPanel } from "./TranscriptPanel";

const CLOSE_AFTER_END_MS = 3_000;

/** Matches `stage-out` in globals.css. */
const LEAVE_ANIMATION_MS = 220;

export interface AvatarCallStageProps {
  title: string;
  onClose: () => void;
  allowTextInput?: boolean;
  showTranscript?: boolean;
  poster?: string;
}

/**
 * The call itself: a large avatar with floating controls, and the transcript
 * beside it on a wide screen or below it on a narrow one.
 *
 * No scrim behind the panel. The widget is usually inside an iframe sized to
 * the panel, where a tinted backdrop is not "the page behind, dimmed" — it is
 * a grey border drawn around the call.
 *
 * The padding is transparent, and it is what makes the rounded corners read:
 * flush against the edge of the frame, the curve is clipped on two sides and
 * the result looks like an uneven gap rather than a rounded panel.
 */
export function AvatarCallStage({
  title,
  onClose,
  allowTextInput = true,
  showTranscript = true,
  poster,
}: AvatarCallStageProps) {
  const { status, error, startSession } = useSession();
  const stageRef = useRef<HTMLDivElement>(null);
  // Off by default: the avatar is the point, and a transcript opened by
  // default takes half the frame from it on a phone-sized embed.
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const [isConfirmingEnd, setIsConfirmingEnd] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Plays the exit animation, then closes.
   *
   * Reduced motion skips straight to closing — an animation nobody asked to
   * see is worse than no animation, and it would only delay them leaving.
   */
  const requestClose = useCallback(() => {
    if (leaveTimer.current) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      onClose();
      return;
    }

    setIsConfirmingEnd(false);
    setIsLeaving(true);
    leaveTimer.current = setTimeout(() => {
      leaveTimer.current = null;
      onClose();
    }, LEAVE_ANIMATION_MS);
  }, [onClose]);

  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    },
    [],
  );

  // Mount-only: taking focus again on every re-render would snatch it back
  // from the end-call prompt the moment that prompt opened.
  useEffect(() => {
    stageRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape backs out of the confirmation first. Otherwise reaching for the
      // usual "never mind" key would do the very thing being confirmed.
      if (isConfirmingEnd) {
        setIsConfirmingEnd(false);
        return;
      }
      requestClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [requestClose, isConfirmingEnd]);

  // Errors stay on screen so the user can read them and retry.
  useEffect(() => {
    if (status !== "ended") return;
    const timer = setTimeout(requestClose, CLOSE_AFTER_END_MS);
    return () => clearTimeout(timer);
  }, [status, requestClose]);

  const transcriptVisible = showTranscript && isTranscriptOpen;
  const isFinished = status === "ended" || status === "error";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        ref={stageRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          "flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-surface shadow-2xl ring-1 ring-brand-900/10 focus-visible:outline-2 focus-visible:outline-brand-500 md:flex-row",
          isLeaving ? "animate-stage-out" : "animate-stage-in",
        )}
      >
        {/* Stage. `min-h-0` so the video yields height to the transcript when
            they are stacked, instead of pushing it off the bottom. */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <AvatarVideo poster={poster} className="h-full w-full" />

          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-5">
            <div className="pointer-events-auto flex items-center gap-2">
              <StatusPill />
            </div>
            <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-brand-950/70 px-3 py-2 ring-1 ring-white/10 backdrop-blur-md">
              <ConnectionQualityDot />
              <span className="text-xs font-medium text-white">{title}</span>
            </div>
          </div>

          {isFinished ? (
            <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-6">
              {error ? (
                <p role="alert" className="text-center text-sm font-medium text-white">
                  {error.message}
                </p>
              ) : null}
              {!error || error.retryable ? (
                <Button size="lg" onClick={() => void startSession()}>
                  {error ? "Try again" : "Start again"}
                </Button>
              ) : null}
            </div>
          ) : (
            <CallControls
              isTranscriptOpen={transcriptVisible}
              onToggleTranscript={() => setIsTranscriptOpen((open) => !open)}
              showTranscriptToggle={showTranscript}
              isConfirmingEnd={isConfirmingEnd}
              onRequestEnd={() => setIsConfirmingEnd(true)}
              onCancelEnd={() => setIsConfirmingEnd(false)}
              onEnd={requestClose}
            />
          )}
        </div>

        {/* Transcript: a column beside the video when there is room, and a
            panel under it when there is not. It used to be `hidden md:flex`,
            which meant the toggle did nothing at all in a 440px-wide embed —
            the button worked, the panel simply could not appear. */}
        {transcriptVisible ? (
          <aside className="flex min-h-0 shrink-0 basis-1/2 flex-col border-t border-brand-100 md:basis-80 md:border-l md:border-t-0 xl:basis-96">
            <TranscriptPanel allowTextInput={allowTextInput} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
