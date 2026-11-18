/**
 * The host ↔ iframe message protocol.
 *
 * `postMessage` is a hole in the same-origin policy that anything on the page
 * can shout through, so every message is tagged with a source and a version,
 * is shape-checked before use, and is sent to an explicit origin — never `"*"`.
 */

export const PROTOCOL_VERSION = 1;
export const HOST_SOURCE = "dre-host";
export const WIDGET_SOURCE = "dre-widget";

/**
 * How much room the widget needs. The host owns the pixels; we own the intent.
 *
 * `notice` exists because a refused microphone prints a message beside the
 * launcher, and an 88px frame would slice it in half.
 */
export type WidgetLayout = "collapsed" | "notice" | "expanded";

export type HostMessage =
  | {
      source: typeof HOST_SOURCE;
      v: number;
      type: "hello";
      userId?: string;
      /** The host page's viewport — ours is the size of the frame it gave us. */
      viewport?: { width: number; height: number };
    }
  | { source: typeof HOST_SOURCE; v: number; type: "open" }
  | { source: typeof HOST_SOURCE; v: number; type: "close" };

export type WidgetMessage =
  | { source: typeof WIDGET_SOURCE; v: number; type: "ready" }
  | { source: typeof WIDGET_SOURCE; v: number; type: "resize"; layout: WidgetLayout }
  | { source: typeof WIDGET_SOURCE; v: number; type: "opened" }
  | { source: typeof WIDGET_SOURCE; v: number; type: "closed" }
  | { source: typeof WIDGET_SOURCE; v: number; type: "error"; message: string };

function hasEnvelope(value: unknown, source: string): value is { type: string; v: number } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.source === source &&
    record.v === PROTOCOL_VERSION &&
    typeof record.type === "string"
  );
}

const HOST_TYPES = new Set(["hello", "open", "close"]);
const WIDGET_TYPES = new Set(["ready", "resize", "opened", "closed", "error"]);

export function isHostMessage(value: unknown): value is HostMessage {
  return hasEnvelope(value, HOST_SOURCE) && HOST_TYPES.has(value.type);
}

export function isWidgetMessage(value: unknown): value is WidgetMessage {
  return hasEnvelope(value, WIDGET_SOURCE) && WIDGET_TYPES.has(value.type);
}

export function widgetMessage<T extends WidgetMessage["type"]>(
  type: T,
  extra: Omit<Extract<WidgetMessage, { type: T }>, "source" | "v" | "type"> = {} as never,
): WidgetMessage {
  return { source: WIDGET_SOURCE, v: PROTOCOL_VERSION, type, ...extra } as WidgetMessage;
}
