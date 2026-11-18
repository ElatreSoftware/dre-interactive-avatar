"use client";

import clsx from "clsx";
import { useSession, type ConnectionQualityLevel } from "@/avatar";

const COPY: Record<ConnectionQualityLevel, { label: string; className: string }> = {
  unknown: { label: "Connection quality unknown", className: "bg-brand-200" },
  good: { label: "Connection is good", className: "bg-emerald-500" },
  bad: { label: "Connection is poor", className: "bg-amber-500" },
};

export function ConnectionQualityDot() {
  const { connectionQuality } = useSession();
  const { label, className } = COPY[connectionQuality];
  return (
    <span title={label} data-quality={connectionQuality} className="inline-flex items-center">
      <span aria-hidden className={clsx("h-2 w-2 rounded-full", className)} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
