"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AvatarLifecycleEvent, AvatarMessage } from "@/avatar";
import { createCollector, type FootprintCollector } from "./collector";
import { MAX_TEXT_LENGTH, type FootprintPayload } from "./schema";

/**
 * Binds a session to a collector.
 *
 * Everything here is derived rather than tracked twice: duration comes from
 * the moment the session was requested, turn and interruption counts from the
 * events as they pass. A `session_ended` footprint can then summarise the call
 * without the rest of the app keeping a tally for it.
 */

/**
 * How often a live call says it is still there.
 *
 * Short enough that the concurrency sweep can use a small window, long enough
 * that an hour-long call costs sixty rows rather than six hundred.
 */
function heartbeatMs(): number {
  const configured = Number(process.env.NEXT_PUBLIC_FOOTPRINT_HEARTBEAT_SECONDS);
  return Number.isFinite(configured) && configured >= 10 ? configured * 1000 : 60_000;
}

export interface UseFootprintsOptions {
  sessionKey: string;
  grant?: string;
  endpoint?: string;
  enabled?: boolean;
  userId?: string | null;
  /** The host page's viewport, where the widget is framed and cannot measure it. */
  viewport?: { width: number; height: number } | null;
  /**
   * Whether the embedder's identity is settled.
   *
   * `widget_loaded` carries the user id, which arrives over the host
   * handshake a moment after mount. This gates *that one event* — not the
   * collector, which runs from the start so a visitor who clicks within the
   * first 300ms is still recorded.
   */
  identitySettled?: boolean;
}

export interface Footprints {
  /** Give to `AvatarProvider`'s `onEvent`. */
  onEvent: (event: AvatarLifecycleEvent) => void;
  /** Record something the session layer does not know about. */
  track: (payload: FootprintPayload) => void;
  /** Call when the transcript changes; finalised turns are recorded once each. */
  onMessages: (messages: readonly AvatarMessage[]) => void;
  /** Send whatever is queued now, rather than waiting for the idle timer. */
  flush: () => void;
}

function deviceClass(width: number): "desktop" | "tablet" | "mobile" {
  if (width < 640) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

function describeEmbed(
  userId?: string | null,
  hostViewport?: { width: number; height: number } | null,
): FootprintPayload {
  // The host's measurement when we have it. Our own `window` is the frame the
  // host gave us — 96 pixels of it — which would class every visitor as a phone.
  const viewport =
    hostViewport ??
    (typeof window === "undefined"
      ? undefined
      : { width: window.innerWidth, height: window.innerHeight });

  return {
    type: "widget_loaded",
    ...(document.referrer ? { referrer: document.referrer } : {}),
    ...(navigator.language ? { locale: navigator.language } : {}),
    ...(viewport ? { viewport, deviceClass: deviceClass(viewport.width) } : {}),
    ...(userId ? { userId } : {}),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** Does nothing, so a caller never has to branch on whether footprints are on. */
const NOOP_COLLECTOR: FootprintCollector = {
  track: () => {},
  flush: () => {},
  dispose: () => {},
};

export function useFootprints(options: UseFootprintsOptions): Footprints {
  const {
    sessionKey,
    grant,
    endpoint,
    enabled = true,
    userId,
    viewport,
    identitySettled = true,
  } = options;

  const collectorRef = useRef<FootprintCollector>(NOOP_COLLECTOR);
  const startedAt = useRef<number | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const turns = useRef(0);
  const interruptions = useRef(0);
  const recorded = useRef(new Set<string>());
  const described = useRef(false);

  // The identity values are read when `widget_loaded` is finally sent, so a
  // late-arriving user id does not tear down and rebuild the collector —
  // which would duplicate that event and drop whatever was queued.
  const identity = useRef({ userId, viewport });
  useEffect(() => {
    identity.current = { userId, viewport };
  }, [userId, viewport]);

  useEffect(() => {
    if (!enabled) return;
    const collector = createCollector({ sessionKey, grant, endpoint });
    collectorRef.current = collector;

    return () => {
      collector.dispose();
      collectorRef.current = NOOP_COLLECTOR;
      described.current = false;
      if (heartbeat.current) clearInterval(heartbeat.current);
      heartbeat.current = null;
    };
  }, [enabled, sessionKey, grant, endpoint]);

  useEffect(() => {
    if (!enabled || described.current || !identitySettled) return;
    described.current = true;
    collectorRef.current.track(
      describeEmbed(identity.current.userId, identity.current.viewport),
    );
  }, [enabled, identitySettled]);

  const track = useCallback((payload: FootprintPayload) => {
    collectorRef.current.track(payload);
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (!heartbeat.current) return;
    clearInterval(heartbeat.current);
    heartbeat.current = null;
  }, []);

  const startHeartbeat = useCallback(() => {
    stopHeartbeat();
    // Started from an event handler rather than an effect: it follows the
    // call, not a render.
    heartbeat.current = setInterval(() => {
      collectorRef.current.track({ type: "heartbeat" });
    }, heartbeatMs());
  }, [stopHeartbeat]);

  const onEvent = useCallback(
    (event: AvatarLifecycleEvent) => {
      switch (event.type) {
        case "session_requested":
          startedAt.current = Date.now();
          turns.current = 0;
          interruptions.current = 0;
          recorded.current.clear();
          track({ type: "session_requested" });
          return;

        case "session_started":
          track({
            type: "session_started",
            ...(event.sessionId ? { avatarSessionId: event.sessionId } : {}),
          });
          startHeartbeat();
          return;

        case "session_ended":
          stopHeartbeat();
          track({
            type: "session_ended",
            reason: event.reason,
            durationMs: startedAt.current ? Date.now() - startedAt.current : 0,
            turns: turns.current,
            interruptions: interruptions.current,
          });
          startedAt.current = null;
          // Sent as a beacon, not a fetch. The commonest way a call ends is
          // the tab closing, and a fetch started during unload is cancelled —
          // which would lose the one event that frees the customer's line.
          // A beacon works just as well on a page that is staying put.
          collectorRef.current.flush("beacon");
          return;

        case "interruption":
          interruptions.current += 1;
          track({ type: "interruption" });
          return;

        case "error":
          track({ type: "error", code: event.error.code, message: event.error.message });
          return;

        case "mute_toggled":
          track({ type: "mute_toggled", isMuted: event.isMuted });
          return;

        case "connection_quality_changed":
          track({ type: "connection_quality_changed", quality: event.quality });
          return;

        default:
          track({ type: event.type });
      }
    },
    [track, startHeartbeat, stopHeartbeat],
  );

  const onMessages = useCallback(
    (messages: readonly AvatarMessage[]) => {
      for (const message of messages) {
        // Only finished turns: chunk-level records would be ~50× the volume
        // and say nothing extra.
        if (message.isPartial) continue;
        if (recorded.current.has(message.id)) continue;
        recorded.current.add(message.id);
        turns.current += 1;

        track({
          type: "transcript_turn",
          sender: message.sender,
          // Truncated here as well as on the server: an over-long turn would
          // otherwise fail validation and be dropped entirely, losing the
          // record of a turn that did happen. `charCount` keeps the true size.
          text: message.message.slice(0, MAX_TEXT_LENGTH),
          isTyped: message.isTyped ?? false,
          wasInterrupted: message.wasInterrupted ?? false,
          charCount: message.message.length,
        });
      }
    },
    [track],
  );

  const flush = useCallback(() => collectorRef.current.flush(), []);

  return useMemo(
    () => ({ onEvent, track, onMessages, flush }),
    [onEvent, track, onMessages, flush],
  );
}
