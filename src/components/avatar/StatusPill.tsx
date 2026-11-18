"use client";

import clsx from "clsx";
import { useSession, useVoiceChat, type SessionStatus } from "@/avatar";

const COPY: Record<SessionStatus, { label: string; dot: string }> = {
  idle: { label: "Ready", dot: "bg-white/50" },
  connecting: { label: "Connecting", dot: "bg-amber-400 animate-pulse motion-reduce:animate-none" },
  listening: { label: "Listening", dot: "bg-emerald-400" },
  speaking: { label: "Speaking", dot: "bg-sky-400 animate-pulse motion-reduce:animate-none" },
  ended: { label: "Call ended", dot: "bg-white/50" },
  error: { label: "Problem", dot: "bg-rose-400" },
};

/**
 * Announced politely rather than assertively: status flips on every turn, and
 * an assertive region would interrupt the screen reader constantly.
 */
export function StatusPill({ className }: { className?: string }) {
  const { status } = useSession();
  const { isUserTalking } = useVoiceChat();

  // What the user is doing beats what the avatar is doing.
  const effective = isUserTalking && status !== "connecting" ? "listening" : status;
  const { label, dot } = COPY[effective];

  return (
    <p
      role="status"
      aria-live="polite"
      data-status={status}
      className={clsx(
        "inline-flex items-center gap-2 rounded-full bg-brand-950/70 px-3 py-1.5 text-xs font-medium text-white shadow-sm ring-1 ring-white/10 backdrop-blur-md",
        className,
      )}
    >
      <span aria-hidden className={clsx("h-1.5 w-1.5 rounded-full", dot)} />
      {isUserTalking ? "Listening to you" : label}
    </p>
  );
}
