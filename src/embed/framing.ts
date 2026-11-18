/**
 * Was this document asked for by a frame, or typed into an address bar?
 *
 * `Sec-Fetch-Dest` is set by the browser and cannot be changed by script, so
 * for a real browser it is a reliable answer. It is trivially forged by
 * anything that is not a browser — but a scripted caller has no browser to
 * run the widget in, and still has to get past the key, the origin allowlist,
 * the signed grant and the rate limiter to spend anything.
 *
 * What this closes is the easy case: a public embed key pasted into an
 * address bar, which otherwise loads a working, billable call.
 */

/** `iframe` in most browsers; `frame` in the handful that still say that. */
const FRAMED = new Set(["iframe", "frame", "embed", "object"]);

export type FramingVerdict = "framed" | "not-framed" | "unknown";

export function framingFrom(headers: { get(name: string): string | null }): FramingVerdict {
  const dest = headers.get("sec-fetch-dest");
  if (!dest) return "unknown";
  return FRAMED.has(dest.trim().toLowerCase()) ? "framed" : "not-framed";
}

/**
 * Whether to serve the embed document.
 *
 * `unknown` is allowed: every current browser sends the header, so a missing
 * one means something old enough that refusing it would be a worse bug than
 * the one being prevented. The origin allowlist and the grant still apply.
 */
export function mayBeFramed(headers: { get(name: string): string | null }): boolean {
  return framingFrom(headers) !== "not-framed";
}
