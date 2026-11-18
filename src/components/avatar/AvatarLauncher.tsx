"use client";

import clsx from "clsx";
import { Spinner } from "@/components/ui/Spinner";
import { VideoIcon } from "@/components/ui/icons";

export interface AvatarLauncherProps {
  onClick: () => void;
  label?: string;
  isBusy?: boolean;
  /** Shown above the button when permission was refused. */
  notice?: string | null;
  className?: string;
}

/**
 * A small round button in the corner. It stays out of the way until wanted —
 * the call itself takes over the screen.
 */
export function AvatarLauncher({
  onClick,
  label = "Start video call",
  isBusy = false,
  notice,
  className,
}: AvatarLauncherProps) {
  return (
    <div className={clsx("fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2", className)}>
      {notice ? (
        <p
          role="alert"
          className="max-w-[16rem] rounded-2xl bg-surface px-3 py-2 text-xs font-medium text-brand-800 shadow-lg ring-1 ring-brand-100"
        >
          {notice}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        aria-busy={isBusy || undefined}
        disabled={isBusy}
        className="group inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand-950 text-white shadow-xl shadow-brand-950/25 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-wait motion-reduce:transition-none motion-reduce:hover:scale-100"
      >
        {isBusy ? <Spinner className="h-5 w-5" /> : <VideoIcon />}
      </button>
    </div>
  );
}
