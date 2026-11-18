"use client";

import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
  /** React 19 passes refs straight through props; no forwardRef needed. */
  ref?: Ref<HTMLButtonElement>;
}

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-950 text-white hover:bg-brand-800 focus-visible:outline-brand-500",
  secondary:
    "bg-brand-50 text-brand-950 ring-1 ring-brand-200 hover:bg-brand-100 focus-visible:outline-brand-500",
  danger: "bg-rose-600 text-white hover:bg-rose-700 focus-visible:outline-rose-500",
  ghost: "bg-transparent text-brand-700 hover:bg-brand-50 focus-visible:outline-brand-500",
};

const SIZES: Record<Size, string> = {
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium",
        "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
