/**
 * Origin allowlisting.
 *
 * This is the one piece of logic in the embed module that is worth being
 * paranoid about. The obvious implementation — `origin.endsWith(pattern)` —
 * happily matches `https://acme.example.attacker.com` against
 * `acme.example`, which hands an attacker the allowlist. So every comparison
 * here is made on parsed, separated fields: scheme, host and port.
 */

export interface ParsedOrigin {
  protocol: "http:" | "https:";
  hostname: string;
  /** "" means the scheme's default port. */
  port: string;
}

/**
 * Strict by design: a pattern is a scheme, an optional single `*.` wildcard
 * label, a host and an optional port. No paths, no userinfo, no regex.
 */
const PATTERN = /^(https?):\/\/(\*\.)?([a-z0-9.-]+)(?::(\d{1,5}))?$/i;

const DEV_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function parseOrigin(value: string): ParsedOrigin | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Credentials in an origin are a smell and never legitimate here.
  if (url.username || url.password) return null;
  if (!url.hostname) return null;
  return { protocol: url.protocol, hostname: url.hostname.toLowerCase(), port: url.port };
}

interface ParsedPattern extends ParsedOrigin {
  wildcard: boolean;
}

export function parseOriginPattern(pattern: string): ParsedPattern | null {
  const match = PATTERN.exec(pattern.trim());
  if (!match) return null;
  const [, scheme, wildcard, host, port] = match;
  if (!scheme || !host) return null;
  const hostname = host.toLowerCase();
  // A wildcard needs something to anchor to: `*.com` is not an allowlist.
  if (wildcard && !hostname.includes(".")) return null;
  return {
    protocol: `${scheme.toLowerCase()}:` as "http:" | "https:",
    hostname,
    port: port ?? "",
    wildcard: Boolean(wildcard),
  };
}

/** True when `pattern` is syntactically usable as an allowlist entry. */
export function isValidOriginPattern(pattern: string): boolean {
  return parseOriginPattern(pattern) !== null;
}

function hostMatches(origin: ParsedOrigin, pattern: ParsedPattern): boolean {
  if (!pattern.wildcard) return origin.hostname === pattern.hostname;
  // `*.acme.example` covers `a.acme.example` and `a.b.acme.example`, and — as
  // in CSP — does not cover the bare `acme.example`.
  const suffix = `.${pattern.hostname}`;
  return origin.hostname.length > suffix.length && origin.hostname.endsWith(suffix);
}

/**
 * Localhost is allowed while developing so `pnpm dev` is not a config chore.
 *
 * Deliberately an allowlist of two environments rather than `!== "production"`:
 * an unset or misspelled NODE_ENV in a real deployment should not quietly open
 * a hole, and NODE_ENV is unset more often than anyone expects.
 */
export function isDevelopmentOrigin(origin: ParsedOrigin): boolean {
  const env = process.env.NODE_ENV;
  if (env !== "development" && env !== "test") return false;
  return DEV_HOSTS.has(origin.hostname);
}

export function originAllowed(candidate: string, patterns: readonly string[]): boolean {
  const origin = parseOrigin(candidate);
  if (!origin) return false;
  if (isDevelopmentOrigin(origin)) return true;

  for (const raw of patterns) {
    const pattern = parseOriginPattern(raw);
    if (!pattern) continue; // Unparseable entries are rejected at load time.
    if (pattern.protocol !== origin.protocol) continue;
    if (pattern.port !== origin.port) continue;
    if (hostMatches(origin, pattern)) return true;
  }
  return false;
}

/** The serialized origin, normalised — what we store and compare against. */
export function serializeOrigin(origin: ParsedOrigin): string {
  return origin.port
    ? `${origin.protocol}//${origin.hostname}:${origin.port}`
    : `${origin.protocol}//${origin.hostname}`;
}
