import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { maskLivekitUrl } from "@/lib/livekitUrl";
/**
 * Same-origin endpoint for the browser SDK's session lifecycle calls.
 *
 * The SDK authenticates with the short-lived session token minted by
 * /api/avatar/session, so this route forwards that bearer token as-is and
 * never touches the server API key.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set(["start", "stop", "keep-alive"]);

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ code: 404, message: "Not found." }, { status: 404 });
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return NextResponse.json({ code: 401, message: "Missing session token." }, { status: 401 });
  }

  let apiUrl: string;
  try {
    apiUrl = getServerEnv().LIVEAVATAR_API_URL;
  } catch (error) {
    console.error("[v1/sessions] bad server env:", error);
    return NextResponse.json({ code: 500, message: "The avatar service is not configured." }, { status: 500 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${apiUrl}/v1/sessions/${action}`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      cache: "no-store",
    });
  } catch (error) {
    console.error(`[v1/sessions/${action}] upstream unreachable:`, error);
    return NextResponse.json({ code: 502, message: "Could not reach the avatar service." }, { status: 502 });
  }

  let body = await upstream.text();
  if (action === "start" && upstream.ok) body = maskLivekitUrl(body);

  // The SDK reads `code`, `message` and `data` from this body; only livekit_url is changed.
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
