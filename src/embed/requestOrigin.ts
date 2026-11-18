/**
 * The origin this request was made to, as the browser saw it.
 *
 * Behind a TLS-terminating proxy — nginx, CloudFront, a load balancer — the
 * application is reached over plain HTTP on localhost, so `request.url` says
 * `http://` while the visitor is on `https://`. Two places compute this
 * origin and compare the results: the first-party page, which signs a grant
 * for itself, and the routes, which check it. Derive them differently and the
 * comparison fails for everyone behind TLS, with a 403 that reads like a
 * configuration mistake.
 *
 * `x-forwarded-*` is only as trustworthy as whatever set it, which is why
 * this is used for one thing: recognising our own first-party page. Customer
 * origins come from the signed grant and the allowlist, never from a header.
 */

/** A chain of proxies appends, so the first entry is the original client's. */
function firstValue(header: string | null): string | null {
  if (!header) return null;
  const first = header.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

export interface HeaderReader {
  get(name: string): string | null;
}

export function originFromHeaders(headers: HeaderReader, fallbackUrl?: string): string | null {
  let fallback: URL | null = null;
  if (fallbackUrl) {
    try {
      fallback = new URL(fallbackUrl);
    } catch {
      fallback = null;
    }
  }

  const proto =
    firstValue(headers.get("x-forwarded-proto")) ??
    fallback?.protocol.replace(/:$/, "") ??
    "https";

  const host =
    firstValue(headers.get("x-forwarded-host")) ?? headers.get("host") ?? fallback?.host ?? null;

  if (!host) return null;
  return `${proto.toLowerCase()}://${host.toLowerCase()}`;
}
