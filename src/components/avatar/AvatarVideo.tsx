"use client";

import clsx from "clsx";
import { useEffect, useRef } from "react";
import { useSession } from "@/avatar";
import { Spinner } from "@/components/ui/Spinner";

export interface AvatarVideoProps {
  className?: string;
  poster?: string;
}

/**
 * The avatar stream. `object-cover` fills the stage — the Avatar feed is
 * framed as a portrait, so cropping the edges reads far better than
 * letterboxing a person inside navy bars.
 *
 * On sharpness: the SDK connects with LiveKit adaptive streaming on, which
 * chooses a simulcast layer from the *rendered size* of this element. So the
 * levers that matter are giving it as many CSS pixels as the design allows
 * (see the expanded size in `public/embed.js`) and never handing the
 * compositor a reason to rasterise it at a lower resolution — no blur, no
 * filter and no scaling transform on this element or its ancestors while the
 * call is running.
 */
export function AvatarVideo({ className, poster }: AvatarVideoProps) {
  const { attachElement, status, isStreamReady } = useSession();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    return attachElement(element);
  }, [attachElement]);

  return (
    <div className={clsx("relative isolate overflow-hidden bg-brand-950", className)}>
      <video
        ref={videoRef}
        poster={poster}
        autoPlay
        playsInline
        data-testid="avatar-video"
        data-status={status}
        aria-label="AI avatar video"
        className={clsx(
          "h-full w-full object-cover transition-opacity duration-200 motion-reduce:transition-none",
          isStreamReady ? "opacity-100" : "opacity-0",
        )}
      />

      {!isStreamReady ? (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-4 text-center">
            {status === "connecting" ? <Spinner className="h-7 w-7 text-white/70" /> : null}
            <p className="text-sm font-medium text-white/70">
              {status === "connecting"
                ? "Connecting you now…"
                : status === "ended"
                  ? "Call ended"
                  : status === "error"
                    ? "Couldn't connect"
                    : "Ready when you are"}
            </p>
          </div>
        </div>
      ) : null}

      {/* Keeps the floating control pill legible over a bright video. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-brand-950/70 to-transparent"
      />
    </div>
  );
}
