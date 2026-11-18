import { NextResponse, type NextRequest } from "next/server";
import { findEmbedKey } from "@/embed/registry";
import { isValidOriginPattern } from "@/embed/originMatch";

/**
 * Per-key `frame-ancestors`.
 *
 * This is the enforcement boundary for embedding: the browser refuses to
 * render the document inside any page not named here, and nothing on the
 * attacker's side can opt out of it.
 *
 * `X-Frame-Options` is deliberately absent. It has no allowlist form —
 * `ALLOW-FROM` was removed from every engine — so setting it would either
 * break legitimate embedders (`DENY`/`SAMEORIGIN`) or say nothing.
 *
 * Next 16's proxy always runs on Node, which is what lets the key registry be
 * read from disk here. `EMBED_KEYS_JSON` remains as an alternative source if
 * that ever stops being true.
 */
export const config = {
  matcher: "/embed/:path*",
};

const DEV_ANCESTORS = ["http://localhost:*", "http://127.0.0.1:*"];

async function frameAncestors(embedKey: string | undefined): Promise<string> {
  const record = embedKey ? await findEmbedKey(embedKey) : null;
  // Unknown, disabled, or a malformed registry: framable nowhere. Failing
  // closed is the only safe direction here.
  if (!record) return "'none'";

  const origins = record.allowedOrigins.filter(isValidOriginPattern);
  if (record.internal) origins.push("'self'");
  if (process.env.NODE_ENV !== "production") origins.push(...DEV_ANCESTORS);

  return origins.length > 0 ? origins.join(" ") : "'none'";
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next();

  // "/embed/<key>" — segments[0] is "" because the path has a leading slash.
  const embedKey = request.nextUrl.pathname.split("/")[2];

  let ancestors: string;
  try {
    ancestors = await frameAncestors(embedKey);
  } catch (error) {
    console.error("[proxy] embed registry unreadable:", error);
    ancestors = "'none'";
  }

  response.headers.set("Content-Security-Policy", `frame-ancestors ${ancestors}`);
  return response;
}
