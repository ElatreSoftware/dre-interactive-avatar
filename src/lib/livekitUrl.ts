/**
 * The proxy's `location /livekit/` forwards to a single fixed LiveKit host, so
 * the browser only ever needs to see "livekit" in place of the real host.
 */
export const MASKED_LIVEKIT_URL = "wss://livekit";

/**
 * Replaces `data.livekit_url` in a session start body. Anything unexpected is
 * returned untouched so the SDK still gets a usable body.
 */
export function maskLivekitUrl(body: string): string {
  let parsed: { data?: { livekit_url?: unknown } | null };
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  const data = parsed.data;
  if (!data || typeof data.livekit_url !== "string") return body;

  // Logged so a host change is visible when the proxy stops matching it.
  console.info(`[v1/sessions/start] LiveKit host: ${data.livekit_url}`);
  data.livekit_url = MASKED_LIVEKIT_URL;
  return JSON.stringify(parsed);
}
