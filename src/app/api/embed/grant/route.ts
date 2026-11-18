import { NextResponse } from "next/server";
import { GRANT_HEADER, signGrant, verifyGrant } from "@/embed/grant";
import { requestOrigin } from "@/embed/requestOrigin";
import { embedOriginAllowed, findEmbedKey } from "@/embed/registry";
import { getGrantSecret } from "@/lib/env";

/**
 * Renews an embed grant.
 *
 * A grant lives ten minutes, but a widget can sit unopened on a page for
 * hours. Rather than issue long-lived grants — which is what a stolen one
 * would want — renewal requires an existing grant whose *signature* is still
 * valid, even if it has expired, within a day of issue.
 *
 * The chain of custody is the point: a first grant can only be obtained by
 * genuinely being framed on an allowed origin, and renewal never changes the
 * origin or the key, only the clock.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How long after expiry a grant may still be exchanged for a fresh one. */
const RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  let secret: string;
  try {
    secret = getGrantSecret();
  } catch (error) {
    console.error("[embed/grant] missing signing secret:", error);
    return NextResponse.json({ error: "Embedding is not configured." }, { status: 500 });
  }

  const presented = request.headers.get(GRANT_HEADER);
  // Verified against a point in the past, so an expired-but-authentic grant
  // still parses and we can judge its age ourselves.
  const result = verifyGrant(presented, secret, 0);
  if (!result.ok) {
    return NextResponse.json({ error: "Invalid grant." }, { status: 403 });
  }

  const { embedKey, parentOrigin, exp } = result.payload;
  if (Date.now() > exp + RENEWAL_WINDOW_MS) {
    return NextResponse.json({ error: "Grant is too old to renew." }, { status: 403 });
  }

  const record = await findEmbedKey(embedKey);
  if (!record) {
    return NextResponse.json({ error: "Invalid grant." }, { status: 403 });
  }

  // Re-checked on every renewal, so revoking an origin takes effect within the
  // grant's lifetime rather than at the next page load.
  // From the forwarded headers, not `request.url`: behind TLS termination
  // those disagree, and this is compared against an origin the page derived
  // the same way.
  const selfOrigin = requestOrigin(request) ?? undefined;
  if (!embedOriginAllowed(record, parentOrigin, selfOrigin)) {
    return NextResponse.json({ error: "Origin is not allowed." }, { status: 403 });
  }

  return NextResponse.json(
    { grant: signGrant({ embedKey, parentOrigin }, secret) },
    { headers: { "cache-control": "no-store" } },
  );
}
