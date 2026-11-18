"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isHostMessage,
  widgetMessage,
  type WidgetLayout,
  type WidgetMessage,
} from "./protocol";

/**
 * What the host page can ask for.
 *
 * These arrive as calls rather than as state: an open request is an event from
 * an external system, and routing it through state and an effect would make
 * React re-render its way to an action it could simply have taken.
 */
export interface HostHandlers {
  onOpenRequest?: () => void;
  onCloseRequest?: () => void;
}

export interface HostBridge {
  /** The origin that framed us, learned from `event.origin` — browser-set, unforgeable. */
  parentOrigin: string | null;
  /** An opaque id the embedder attached to this visitor, if any. */
  userId: string | null;
  /** The host page's viewport, which only the host can measure for us. */
  hostViewport: { width: number; height: number } | null;
  /** Tell the host how much room the widget needs. */
  reportLayout: (layout: WidgetLayout) => void;
  /** Tell the host the call opened or closed, for its own analytics. */
  reportOpen: (isOpen: boolean) => void;
  /** Report a failure the host may want to log. */
  reportError: (message: string) => void;
}

/**
 * The iframe half of the bridge.
 *
 * The parent origin is taken from `event.origin` rather than from anything in
 * the message body: the browser sets it, and no script can lie about it. Every
 * reply then goes back to exactly that origin.
 */
export function useHostBridge(
  knownParentOrigin?: string,
  handlers: HostHandlers = {},
): HostBridge {
  const [parentOrigin, setParentOrigin] = useState<string | null>(knownParentOrigin ?? null);
  const [userId, setUserId] = useState<string | null>(null);
  const [hostViewport, setHostViewport] = useState<{ width: number; height: number } | null>(null);
  const originRef = useRef<string | null>(knownParentOrigin ?? null);

  // Held in a ref so the listener is registered once and still calls the
  // latest handlers.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const post = useCallback((message: WidgetMessage) => {
    const target = originRef.current;
    if (!target || typeof window === "undefined" || window.parent === window) return;
    window.parent.postMessage(message, target);
  }, []);

  useEffect(() => {
    function handle(event: MessageEvent) {
      if (event.source !== window.parent) return;
      if (!isHostMessage(event.data)) return;

      switch (event.data.type) {
        case "hello": {
          originRef.current = event.origin;
          setParentOrigin(event.origin);
          if (typeof event.data.userId === "string") setUserId(event.data.userId);
          const viewport = event.data.viewport;
          if (
            viewport &&
            typeof viewport.width === "number" &&
            typeof viewport.height === "number"
          ) {
            setHostViewport({ width: viewport.width, height: viewport.height });
          }
          // Deliberately *not* answered with `ready`. The host greets again
          // whenever it hears `ready`, so replying here would be an infinite
          // exchange of pleasantries. `ready` is announced once, on mount.
          break;
        }
        case "open":
          handlersRef.current.onOpenRequest?.();
          break;
        case "close":
          handlersRef.current.onCloseRequest?.();
          break;
      }
    }

    window.addEventListener("message", handle);

    // Announce ourselves rather than waiting to be spoken to: the frame's
    // `load` event fires before React mounts this listener, so the host's
    // first hello is usually said to nobody. Hearing this, it says it again.
    const known = originRef.current;
    if (known && window.parent !== window) {
      window.parent.postMessage(widgetMessage("ready"), known);
    }

    return () => window.removeEventListener("message", handle);
  }, []);

  const reportLayout = useCallback(
    (layout: WidgetLayout) => post(widgetMessage("resize", { layout })),
    [post],
  );

  const reportOpen = useCallback(
    (isOpen: boolean) => post(widgetMessage(isOpen ? "opened" : "closed")),
    [post],
  );

  const reportError = useCallback(
    (message: string) => post(widgetMessage("error", { message })),
    [post],
  );

  return { parentOrigin, userId, hostViewport, reportLayout, reportOpen, reportError };
}
