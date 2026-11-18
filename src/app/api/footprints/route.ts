import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { GRANT_HEADER, verifyGrant } from "@/embed/grant";
import { linkSession, releaseSession, touchSession } from "@/embed/concurrency";
import { createRateLimiter } from "@/embed/rateLimit";
import { embedOriginAllowed, findEmbedKey } from "@/embed/registry";
import { getGrantSecret } from "@/lib/env";
import { getFootprintSink } from "@/telemetry/store";
import { sweepIfDue } from "@/telemetry/retention";
import { keepTranscripts, redact } from "@/telemetry/redact";
import { footprintEvent, MAX_BATCH_SIZE, type StoredFootprint } from "@/telemetry/schema";

/**
 * Footprint ingest.
 *
 * This endpoint is public by construction — it has to be reachable from a
 * browser on a customer's page. That is exactly why the cheap refusals come
 * first: an append-only endpoint that anyone can reach, with no grant check,
 * no size cap and no rate limit, is a disk-filling primitive with a REST API.
 *
 * Order matters: grant, size, rate limit, parse, redact, stamp, write.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generous next to the session limiter: these cost disk, not vendor credits. */
const ingestLimiter = createRateLimiter({ capacity: 60, refillPerSecond: 1 });

const MAX_BODY_BYTES = 64 * 1024;

/** Exported for tests, which would otherwise leak budget between cases. */
export function resetIngestLimiter(): void {
  ingestLimiter.reset();
}

let warnedAboutSalt = false;

function hashIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() ?? "";
  const salt = process.env.IP_HASH_SALT ?? "";

  if (!salt && !warnedAboutSalt) {
    warnedAboutSalt = true;
    // Once per process: an unsalted hash of an IPv4 address is an IPv4
    // address to anyone willing to spend an afternoon on the space, so this
    // should be visible in the logs rather than silently fine.
    console.warn(
      "[footprints] IP_HASH_SALT is not set; visitor IP hashes are reversible. " +
        "See docs/footprints.md.",
    );
  }
  // Salted: an unsalted hash of an IP address is an IP address to anyone
  // willing to spend an afternoon on the v4 space.
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 16);
}

/**
 * Keeps the concurrent-session count honest.
 *
 * `session_started` is the only event carrying both ids, so it is what ties a
 * widget session to the minted one; after that any event is a sign of life,
 * and `session_ended` frees the slot.
 */
async function trackLiveness(stored: StoredFootprint[]): Promise<void> {
  const sessionKeys = new Set<string>();

  for (const event of stored) {
    if (event.type === "session_started" && typeof event.avatarSessionId === "string") {
      await linkSession(event.avatarSessionId, event.sessionKey);
    }
    if (event.type === "session_ended") {
      await releaseSession(event.sessionKey);
      sessionKeys.delete(event.sessionKey);
      continue;
    }
    sessionKeys.add(event.sessionKey);
  }

  for (const sessionKey of sessionKeys) await touchSession(sessionKey);
}

export async function POST(request: Request) {
  if (process.env.FOOTPRINTS_ENABLED === "false") {
    return new NextResponse(null, { status: 204 });
  }

  let secret: string;
  try {
    secret = getGrantSecret();
  } catch {
    // Misconfiguration is ours. Say nothing, drop the events.
    return new NextResponse(null, { status: 204 });
  }

  // Checked before reading the body, so an oversized payload is refused
  // rather than buffered.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const payload = parsed as { events?: unknown; grant?: unknown };

  // A `sendBeacon` carries no headers, so a beacon's grant arrives in the
  // body. It is the same signed value either way, verified the same way — the
  // only difference is which part of the request it travelled in.
  const presented =
    request.headers.get(GRANT_HEADER) ??
    (typeof payload.grant === "string" ? payload.grant : null);

  const grant = verifyGrant(presented, secret);
  if (!grant.ok) return NextResponse.json({ error: "Invalid grant." }, { status: 403 });

  const record = await findEmbedKey(grant.payload.embedKey);
  if (!record) return NextResponse.json({ error: "Invalid grant." }, { status: 403 });

  if (!embedOriginAllowed(record, grant.payload.parentOrigin)) {
    return NextResponse.json({ error: "Origin is not allowed." }, { status: 403 });
  }

  const ipHash = hashIp(request);
  if (!ingestLimiter.take(`${record.key}:${ipHash}`)) {
    return NextResponse.json({ error: "Too many events." }, { status: 429 });
  }

  const events = payload.events;
  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  if (events.length > MAX_BATCH_SIZE) {
    return NextResponse.json({ error: "Too many events in one batch." }, { status: 413 });
  }

  const receivedAt = Date.now();
  const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 300);
  const transcripts = keepTranscripts();

  const stored: StoredFootprint[] = [];
  for (const candidate of events) {
    // Validated one at a time on purpose: a single malformed event should drop
    // itself, not take a whole session's batch with it.
    const result = footprintEvent.safeParse(candidate);
    if (!result.success) continue;

    const redacted = redact(result.data, { keepTranscripts: transcripts });
    if (!redacted) continue;

    stored.push({
      ...redacted,
      receivedAt,
      embedKey: record.key,
      // From the grant, never from the body: the client does not get to say
      // which customer or which page it is.
      parentOrigin: grant.payload.parentOrigin,
      ipHash,
      userAgent,
    });
  }

  if (stored.length > 0) {
    await getFootprintSink().write(stored);
    await trackLiveness(stored);
  }

  // Retention runs from here rather than from a scheduled job: nothing to
  // install, and nothing to forget to install. It is not awaited.
  sweepIfDue();

  // Nothing to say, and a beacon could not read it anyway.
  return new NextResponse(null, { status: 204 });
}
