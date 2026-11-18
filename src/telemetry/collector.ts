import { GRANT_HEADER } from "@/embed/grantHeader";
import {
  FOOTPRINT_VERSION,
  MAX_BATCH_SIZE,
  type FootprintEvent,
  type FootprintPayload,
} from "./schema";

/**
 * The browser half of footprints.
 *
 * Two rules shape everything here:
 *
 * 1. **Never block, never throw.** A footprint is not worth a broken call, so
 *    every failure path ends in a dropped event rather than a surfaced error.
 * 2. **Survive the unload.** The usual way a call ends is the tab closing, and
 *    `session_ended` is the most valuable event we record. A `fetch` is
 *    cancelled on unload; `sendBeacon` is not.
 */

export const DEFAULT_ENDPOINT = "/api/footprints";
const FLUSH_AFTER_MS = 2000;
const MAX_RETRIES = 2;

export interface CollectorOptions {
  sessionKey: string;
  grant?: string;
  endpoint?: string;
  /** Flush when this many events are queued. Defaults to the batch limit. */
  batchSize?: number;
  idleFlushMs?: number;
}

export interface FootprintCollector {
  track: (payload: FootprintPayload) => void;
  /** Send whatever is queued. `beacon` survives page unload; `fetch` does not. */
  flush: (transport?: "fetch" | "beacon") => void;
  /** Stop listening. Flushes what is left, via a beacon. */
  dispose: () => void;
}

function newId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createCollector(options: CollectorOptions): FootprintCollector {
  const {
    sessionKey,
    grant,
    endpoint = DEFAULT_ENDPOINT,
    batchSize = MAX_BATCH_SIZE,
    idleFlushMs = FLUSH_AFTER_MS,
  } = options;

  let queue: FootprintEvent[] = [];
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function clearTimer(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function send(events: FootprintEvent[], transport: "fetch" | "beacon", attempt = 0): void {
    if (transport === "beacon" && typeof navigator !== "undefined" && navigator.sendBeacon) {
      // A beacon carries no headers, so the grant travels in the body. Not in
      // the query string: a credential in a URL ends up in access logs,
      // referrers and anywhere else URLs are written down.
      const blob = new Blob([JSON.stringify({ grant, events })], {
        type: "application/json",
      });
      const accepted = navigator.sendBeacon(endpoint, blob);
      // Refused, usually because the browser's beacon budget is spent. Put
      // them back; the next flush may still get them out.
      if (!accepted) queue = [...events, ...queue].slice(-batchSize * 2);
      return;
    }

    const body = JSON.stringify({ events });
    void fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(grant ? { [GRANT_HEADER]: grant } : {}),
      },
      body,
      // Lets the request outlive the page where `sendBeacon` is unavailable.
      keepalive: true,
    })
      .then((response) => {
        // 4xx is our fault and will not improve on retry; 5xx might.
        if (response.status >= 500 && attempt < MAX_RETRIES) {
          setTimeout(() => send(events, "fetch", attempt + 1), 500 * (attempt + 1));
        }
      })
      .catch(() => {
        if (attempt < MAX_RETRIES) {
          setTimeout(() => send(events, "fetch", attempt + 1), 500 * (attempt + 1));
        }
        // Two attempts and out. Retrying forever turns a flaky network into a
        // memory leak.
      });
  }

  function flush(transport: "fetch" | "beacon" = "fetch"): void {
    clearTimer();
    if (queue.length === 0) return;
    const events = queue;
    queue = [];
    try {
      send(events, transport);
    } catch {
      // Including the case where the page is being torn down around us.
    }
  }

  function track(payload: FootprintPayload): void {
    if (disposed) return;
    queue.push({
      v: FOOTPRINT_VERSION,
      id: newId(),
      seq: seq++,
      sessionKey,
      clientTs: Date.now(),
      ...payload,
    } as FootprintEvent);

    if (queue.length >= batchSize) {
      flush();
      return;
    }
    if (timer === null) timer = setTimeout(() => flush(), idleFlushMs);
  }

  function onHidden(): void {
    // `pagehide` and `visibilitychange` both fire where `beforeunload` does
    // not — bfcache, and mobile Safari in particular.
    if (typeof document !== "undefined" && document.visibilityState === "visible") return;
    flush("beacon");
  }

  function onPageHide(): void {
    flush("beacon");
  }

  if (typeof window !== "undefined") {
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
  }

  return {
    track,
    flush,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (typeof window !== "undefined") {
        document.removeEventListener("visibilitychange", onHidden);
        window.removeEventListener("pagehide", onPageHide);
      }
      clearTimer();
      if (queue.length > 0) {
        const events = queue;
        queue = [];
        send(events, "beacon");
      }
    },
  };
}
