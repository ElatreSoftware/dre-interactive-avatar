import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { MAX_PER_CRON, reconcileSessions } from "@/embed/reconcile";

/**
 * The reconcile, on a clock.
 *
 * Call this once a minute from cron:
 *
 *   * * * * * curl -fsS -X POST https://your-host/api/cron/reconcile \
 *     -H "authorization: Bearer $CRON_SECRET" >/dev/null
 *
 * It asks LiveAvatar about every open call and closes the ones that have
 * actually ended, recording the vendor's own reason. A minute is a safe
 * cadence precisely *because* it asks: it closes on fact, not on silence. A
 * one-minute silence timeout would be a different thing entirely and would
 * hang up live calls between heartbeats.
 *
 * Running it more often than the work takes is harmless but pointless — the
 * runs would overlap, each asking the vendor about the same rows.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Constant time: a fast-exit compare leaks the secret a byte at a time. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Accepts the secret as a bearer token or a bare header, because cron
 * runners differ and neither form is harder to get right than the other.
 */
function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? request.headers.get("x-cron-secret") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;
  return provided.length > 0 && secretMatches(provided.trim(), expected);
}

async function run(request: Request) {
  if (!process.env.CRON_SECRET) {
    // Ours to fix, and worth shouting about: an endpoint that frees lines
    // must not be open, so without a secret it does nothing at all.
    console.error("[cron] CRON_SECRET is not set; refusing to run. See docs/embedding.md.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }

  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(requested) && requested > 0 ? requested : MAX_PER_CRON;

  try {
    const summary = await reconcileSessions(Date.now(), { limit });
    console.log({
      timeStamp: Date.now(),
      ...summary
    })
    return NextResponse.json(
      { ok: true, ...summary },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[cron] reconcile failed:", error);
    // A non-2xx so a cron runner's own alerting notices, rather than the job
    // quietly "succeeding" every minute while nothing is being closed.
    return NextResponse.json({ error: "Reconcile failed." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return run(request);
}

/** Some cron runners only issue GETs. Same work, same authorization. */
export async function GET(request: Request) {
  return run(request);
}
