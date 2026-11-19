import { z } from "zod";
import { getServerEnv } from "@/lib/env";

/**
 * What LiveAvatar says about a session.
 *
 * LiveAvatar has no webhooks — there is nothing to register, and no delivery
 * to wait for. I checked their OpenAPI document rather than assuming: it
 * declares no `webhooks` object and mentions none anywhere. What it does have
 * is `GET /v1/sessions/{id}`, which is authoritative in the way a browser can
 * never be: it knows a call ended even when the tab that started it was
 * force-quit, lost power or never came back.
 *
 * The response is a union. A running session carries no ending; an ended one
 * adds `end_at` and `end_reason`. That presence *is* the signal — there is no
 * status field to read.
 */

const sessionSchema = z.object({
  data: z
    .object({
      id: z.string(),
      end_at: z.string().nullish(),
      end_reason: z.string().nullish(),
    })
    .nullish(),
});

/**
 * LiveAvatar returns naive timestamps — `2026-11-18T14:36:47`, with no zone.
 * JavaScript reads a bare date-time as *local* time, so on a server that is
 * not on UTC this would record an ending hours out, and on a machine ahead of
 * UTC it would record one in the future. The vendor's clock is UTC, so say so
 * explicitly. Verified against live responses from `GET /v1/sessions`.
 */
function parseVendorTime(value: string): Date {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
  return new Date(hasZone ? value : `${value}Z`);
}

export type VendorSessionState =
  | { state: "live" }
  | { state: "ended"; endedAt: Date; reason: string }
  | { state: "gone" }
  /** Unreachable, refused, or a shape we do not recognise. Decides nothing. */
  | { state: "unknown" };

/**
 * Asks the vendor whether one session is over.
 *
 * Never throws, and never guesses. An error is `unknown`, not `ended`: a
 * blip at LiveAvatar must not cut off calls that are still running, so the
 * only thing that closes a line here is the vendor actually saying so.
 */
export async function fetchVendorSessionState(
  avatarSessionId: string,
  signal?: AbortSignal,
): Promise<VendorSessionState> {
  let env;
  try {
    env = getServerEnv();
  } catch {
    return { state: "unknown" };
  }

  let response: Response;
  try {
    response = await fetch(
      `${env.LIVEAVATAR_API_URL}/v1/sessions/${encodeURIComponent(avatarSessionId)}`,
      { headers: { "X-API-KEY": env.LIVEAVATAR_API_KEY }, cache: "no-store", signal },
    );
  } catch {
    return { state: "unknown" };
  }

  const parsed = sessionSchema.safeParse(await response.json().catch(() => null));

  if (!response.ok) {
    // A session the vendor has never heard of, or has forgotten. LiveAvatar
    // answers that with `400` and a null body — *not* a 404, which is why
    // this reads the body rather than the status alone. It is certainly not
    // running, so the line should not stay held for it.
    const notFound = response.status === 400 || response.status === 404;
    if (notFound && parsed.success && parsed.data.data === null) return { state: "gone" };
    return { state: "unknown" };
  }

  if (!parsed.success || !parsed.data.data) return { state: "unknown" };

  const { end_at, end_reason } = parsed.data.data;
  if (!end_at) return { state: "live" };

  const endedAt = parseVendorTime(end_at);
  return {
    state: "ended",
    // A malformed date still means ended; only the timestamp is in doubt.
    endedAt: Number.isNaN(endedAt.getTime()) ? new Date() : endedAt,
    reason: end_reason ?? "UNKNOWN",
  };
}
