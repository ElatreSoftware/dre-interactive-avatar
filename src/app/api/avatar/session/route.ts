import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkConcurrency, claimSession } from "@/embed/concurrency";
import { GRANT_HEADER, verifyGrant } from "@/embed/grant";
import { sessionRateLimiter } from "@/embed/rateLimit";
import { requestOrigin } from "@/embed/requestOrigin";
import { embedOriginAllowed, findEmbedKey, type EmbedKeyRecord } from "@/embed/registry";
import { getGrantSecret, getServerEnv } from "@/lib/env";

/**
 * Mints a short-lived LiveAvatar session token.
 *
 * This is the only place the LiveAvatar API key and the ElevenLabs secret id
 * are used. The browser receives a session id and a session token and nothing
 * else — never a vendor key, and never upstream error text.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  avatarId: z.string().min(1).optional(),
  isSandbox: z.boolean().optional(),
  embedKey: z.string().min(1).optional(),
  dynamicVariables: z.record(z.string(), z.string()).optional(),
});

/**
 * Who is asking, established from the signed grant rather than from the body.
 *
 * Minting a session spends vendor credits, so the caller does not get to
 * describe itself: the key, the avatar and the prompt variables all come from
 * the registry entry the grant names.
 */
interface Caller {
  record: EmbedKeyRecord;
  parentOrigin: string;
}

async function authorize(request: Request): Promise<Caller | null> {
  let secret: string;
  try {
    secret = getGrantSecret();
  } catch (error) {
    console.error("[avatar/session] missing grant secret:", error);
    return null;
  }

  const result = verifyGrant(request.headers.get(GRANT_HEADER), secret);
  if (!result.ok) {
    console.warn(`[avatar/session] refused a session: grant ${result.reason}`);
    return null;
  }

  const record = await findEmbedKey(result.payload.embedKey);
  if (!record) return null;

  // From the forwarded headers, not `request.url`: behind TLS termination
  // those disagree, and this is compared against an origin the page derived
  // the same way.
  const selfOrigin = requestOrigin(request) ?? undefined;
  // Re-checked here, not just when the grant was issued, so removing an origin
  // from the allowlist takes effect inside the grant's lifetime.
  if (!embedOriginAllowed(record, result.payload.parentOrigin, selfOrigin)) {
    console.warn(`[avatar/session] refused a session: origin ${result.payload.parentOrigin}`);
    return null;
  }

  return { record, parentOrigin: result.payload.parentOrigin };
}

/** Rate-limit bucket: the customer and the caller, never the raw address. */
function bucketFor(request: Request, caller: Caller): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() ?? "";
  const hashed = createHash("sha256").update(ip).digest("hex").slice(0, 16);
  return `${caller.record.key}:${hashed}`;
}

/** Only the fields we actually rely on; LiveAvatar may add more. */
const upstreamSchema = z.object({
  code: z.number().optional(),
  message: z.string().optional(),
  data: z
    .object({ session_id: z.string(), session_token: z.string() })
    .nullable()
    .optional(),
});

/**
 * Upstream text can name internal services and quota details, so it is never
 * sent to the browser in production. In development it is included under
 * `detail`, because the useful part of a LiveAvatar 4xx is usually an
 * actionable configuration message ("agent has TTS output format pcm_16000,
 * but pcm_24000 is required") and hunting it down in server logs is a waste
 * of everyone's afternoon.
 */
function fail(status: number, message: string, detail?: unknown) {
  const isDev = process.env.NODE_ENV !== "production";
  return NextResponse.json(
    isDev && detail !== undefined ? { error: message, detail } : { error: message },
    { status },
  );
}

export async function POST(request: Request) {
  let env;
  try {
    env = getServerEnv();
  } catch (error) {
    // Misconfiguration is ours, not the caller's. Log it; tell them nothing.
    console.error("[avatar/session] bad server env:", error);
    return fail(500, "The avatar service is not configured.");
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return fail(400, "Invalid request body.");
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return fail(400, "Invalid request body.");

  const caller = await authorize(request);
  if (!caller) return fail(403, "This page is not allowed to start a session.");

  if (!sessionRateLimiter.take(bucketFor(request, caller))) {
    return fail(429, "Too many sessions started. Wait a moment and try again.");
  }

  // Before the mint, not after: the vendor charges for a session whether or
  // not we then decide we did not want it.
  const concurrency = await checkConcurrency(caller.record);
  if (!concurrency.ok) {
    console.warn(
      `[avatar/session] ${caller.record.key} is at its concurrent limit ` +
        `(${concurrency.active}/${concurrency.limit})`,
    );
    return fail(429, "All available lines are busy. Try again in a moment.");
  }

  // The registry wins over the body for everything that costs money or shapes
  // the conversation. The internal key has no avatar of its own, so the
  // first-party page may still name one.
  const avatarId = caller.record.internal
    ? (caller.record.avatarId || parsed.data.avatarId || env.LIVEAVATAR_DEFAULT_AVATAR_ID)
    : caller.record.avatarId;
  if (!avatarId) return fail(400, "No avatar id supplied or configured.");

  const dynamicVariables = caller.record.internal
    ? parsed.data.dynamicVariables
    : caller.record.dynamicVariables;

  let upstream: Response;
  try {
    upstream = await fetch(`${env.LIVEAVATAR_API_URL}/v1/sessions/token`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-KEY": env.LIVEAVATAR_API_KEY },
      body: JSON.stringify({
        // LITE mode: LiveAvatar's worker connects to the ElevenLabs agent
        // itself and lip-syncs its audio. The browser bridges nothing.
        mode: "LITE",
        avatar_id: avatarId,
        is_sandbox: parsed.data.isSandbox ?? false,
        "video_settings": {
          "quality": "high",
          "encoding": "H264"
        },
        elevenlabs_agent_config: {
          secret_id: env.LIVEAVATAR_ELEVENLABS_SECRET_ID,
          agent_id: env.ELEVENLABS_AGENT_ID,
          ...(dynamicVariables ? { dynamic_variables: dynamicVariables } : {}),
        },
      }),
      cache: "no-store",
    });
  } catch (error) {
    console.error("[avatar/session] upstream unreachable:", error);
    return fail(502, "Could not reach the avatar service.");
  }

  const raw: unknown = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    // A 4xx here is almost always setup, not a transient fault: a wrong avatar
    // id, the sandbox flag on a non-sandbox avatar, or an ElevenLabs agent
    // whose audio format is not PCM 24000 Hz.
    const isConfigError = upstream.status >= 400 && upstream.status < 500;
    console.error(
      isConfigError
        ? "[avatar/session] LiveAvatar rejected the session (check your configuration):"
        : "[avatar/session] upstream error",
      upstream.status,
      JSON.stringify(raw),
    );
    return fail(
      502,
      isConfigError
        ? "The avatar is not configured correctly."
        : "Could not start an avatar session.",
      raw,
    );
  }

  const result = upstreamSchema.safeParse(raw);
  if (!result.success || !result.data.data) {
    console.error("[avatar/session] unexpected upstream shape:", JSON.stringify(raw));
    return fail(502, "Could not start an avatar session.", raw);
  }

  await claimSession(caller.record.key, result.data.data.session_id);

  return NextResponse.json(
    {
      sessionId: result.data.data.session_id,
      sessionToken: result.data.data.session_token,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
