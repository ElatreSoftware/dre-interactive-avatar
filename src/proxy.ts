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
  matcher: ["/", "/embed/:path*"],
};

/**
 * The host's own page is not a way in.
 *
 * Answered here rather than by a page because a page cannot set a status
 * code, and a 200 saying "unauthorized" is a lie to everything that reads
 * status codes — monitors, crawlers, the next engineer's `curl`.
 */
const UNAUTHORIZED_BODY = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>401 Unauthorized</title>
    <style>
      body { font: 16px/1.6 system-ui, sans-serif; margin: 0; min-height: 100dvh;
             display: grid; place-items: center; background: #09053a; color: #fff; }
      main { max-width: 36ch; padding: 32px; text-align: center; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5em; }
      p { margin: 0; opacity: 0.7; font-size: 0.95rem; }
    </style>
  </head>
  <body>
    <main>
      <h1 style="font-size: 1.5rem; font-weight: bold;"> Sorry, You are unauthorized to access this page</h1>
    </main>
  </body>
</html>
`;

function unauthorized(): NextResponse {
  return new NextResponse(UNAUTHORIZED_BODY, {
    status: 401,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // Nothing here is framable either.
      "content-security-policy": "frame-ancestors 'none'",
    },
  });
}

const DEV_ANCESTORS = ["http://localhost:*", "http://127.0.0.1:*"];

async function frameAncestors(embedKey: string | undefined): Promise<string> {
  const record = embedKey ? await findEmbedKey(embedKey) : null;
  // Unknown, disabled, or a malformed registry: framable nowhere. Failing
  // closed is the only safe direction here.
  if (!record) return "'none'";

  const origins = record.allowedOrigins.filter(isValidOriginPattern);
  if (process.env.NODE_ENV !== "production") origins.push(...DEV_ANCESTORS);

  return origins.length > 0 ? origins.join(" ") : "'none'";
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (request.nextUrl.pathname === "/") return unauthorized();

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
