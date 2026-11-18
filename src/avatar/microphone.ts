/**
 * Ask for the microphone before the call starts.
 *
 * The SDK acquires its own track when the session connects, but if we leave the
 * prompt until then the user watches a stage open, spin, and fail — the browser
 * prompt lands behind a UI that is already pretending to connect. Asking first
 * means permission is settled before anything opens, so the stage only ever
 * appears for a call that can actually work.
 *
 * The track we open here is released immediately; we want the permission, not
 * the stream.
 */
export type MicrophonePermission =
  | "granted"
  | "denied"
  | "unavailable"
  | "blocked_by_embedder";

/**
 * A cross-origin iframe has no microphone unless the *parent* page grants it
 * with `allow="microphone"`. When it has not, `getUserMedia` rejects with
 * `NotAllowedError` — indistinguishable from the visitor clicking "Block", and
 * the two have completely different fixes. Permissions Policy knows the
 * difference, so we ask it first.
 */
function isBlockedByEmbedder(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  if (window.parent === window) return false; // Not framed; nobody to blame but us.

  const policy = (document as Document & { featurePolicy?: { allowsFeature(f: string): boolean } })
    .featurePolicy;
  if (!policy?.allowsFeature) return false; // Can't tell: say nothing rather than mislead.
  return !policy.allowsFeature("microphone");
}

export async function requestMicrophoneAccess(): Promise<MicrophonePermission> {
  if (isBlockedByEmbedder()) return "blocked_by_embedder";

  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) return "unavailable";

  try {
    const stream = await media.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return "granted";
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    // NotFoundError means there is no microphone at all, which is not a refusal
    // — but it is equally fatal for a voice call, so it is reported as such.
    if (name === "NotAllowedError" || name === "SecurityError") return "denied";
    return "unavailable";
  }
}
