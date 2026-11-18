import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { signGrant } from "@/embed/grant";
import { mayBeFramed } from "@/embed/framing";
import { embedOriginAllowed, findEmbedKey } from "@/embed/registry";
import { parseOrigin, serializeOrigin } from "@/embed/originMatch";
import { originFromHeaders } from "@/embed/requestOrigin";
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

  // Opened in a tab rather than embedded. A public key pasted into an address
  // bar would otherwise load a working call that someone pays for.
  if (!mayBeFramed(headerList)) notFound();

  const claimed = typeof query.o === "string" ? query.o : undefined;
  const selfOrigin = originFromHeaders(headerList) ?? undefined;

  // Opened directly rather than framed: treat our own origin as the parent, so
  // `/embed/<key>` is debuggable in a browser tab.
  const parentOrigin = resolveParentOrigin(claimed, headerList.get("referer")) ?? selfOrigin;
  if (!parentOrigin) notFound();

  // Belt to the proxy's braces. A mismatch here means the claim and the
  // allowlist disagree, and the claim loses.
  if (!embedOriginAllowed(record, parentOrigin)) {
    // The response is a bare 404 on purpose — an unknown key and a wrong
    // origin must look identical from outside. The log is where the answer
    // lives, because "404" on its own has cost real debugging time, and
    // http://localhost:5500 and http://127.0.0.1:5500 are different origins.
    console.warn(
      `[embed] ${record.key} refused "${parentOrigin}": allowed are ` +
        `${record.allowedOrigins.join(", ") || "(none)"}`,
    );
    notFound();
  }

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
