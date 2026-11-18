"use client";

import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: the button shows an icon, so it needs an accessible name. */
  label: string;
  active?: boolean;
  tone?: "neutral" | "danger" | "onDark";
  children: ReactNode;
}

export function IconButton({
  label,
  active,
  tone = "neutral",
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={clsx(
        "inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        "disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
        tone === "danger"
          ? "bg-rose-600 text-white hover:bg-rose-700"
          : tone === "onDark"
            ? active
              ? "bg-white text-brand-950 hover:bg-white/90"
              : "bg-white/10 text-white hover:bg-white/20"
            : active
              ? "bg-brand-950 text-white hover:bg-brand-800"
              : "bg-brand-50 text-brand-800 ring-1 ring-brand-200 hover:bg-brand-100",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
