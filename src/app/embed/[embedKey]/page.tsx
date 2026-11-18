import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { signGrant } from "@/embed/grant";
import { embedOriginAllowed, findEmbedKey } from "@/embed/registry";
import { parseOrigin, serializeOrigin } from "@/embed/originMatch";
import { getGrantSecret } from "@/lib/env";
import { EmbedWidget } from "./EmbedWidget";

/**
 * The embeddable document.
 *
 * Framing is controlled by the `frame-ancestors` header that middleware sets
 * for this path — that is the enforcement, applied by the browser. What
 * happens here is issuing the grant that `/api/avatar/session` will demand,
 * which ties a session to a key *and* the origin that framed it.
 */

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ embedKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The loader passes `?o=<parent origin>`; `Referer` is the fallback. */
function resolveParentOrigin(claimed: string | undefined, referer: string | null): string | null {
  const fromClaim = claimed ? parseOrigin(claimed) : null;
  if (fromClaim) return serializeOrigin(fromClaim);
  const fromReferer = referer ? parseOrigin(referer) : null;
  return fromReferer ? serializeOrigin(fromReferer) : null;
}

export default async function EmbedPage({ params, searchParams }: PageProps) {
  const { embedKey } = await params;
  const record = await findEmbedKey(embedKey);
  if (!record) notFound();

  const query = await searchParams;
  const headerList = await headers();

  const claimed = typeof query.o === "string" ? query.o : undefined;
  const host = headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  const selfOrigin = host ? `${proto}://${host}` : undefined;

  // Opened directly rather than framed: treat our own origin as the parent, so
  // `/embed/<key>` is debuggable in a browser tab.
  const parentOrigin = resolveParentOrigin(claimed, headerList.get("referer")) ?? selfOrigin;
  if (!parentOrigin) notFound();

  // Belt to the middleware's braces. A mismatch here means the claim and the
  // allowlist disagree, and the claim loses.
  if (!embedOriginAllowed(record, parentOrigin, selfOrigin)) notFound();

  const grant = signGrant({ embedKey: record.key, parentOrigin }, getGrantSecret());

  return (
    <EmbedWidget
      embedKey={record.key}
      grant={grant}
      avatarId={record.avatarId}
      parentOrigin={parentOrigin}
      dynamicVariables={record.dynamicVariables}
      name={record.name}
    />
  );
}
