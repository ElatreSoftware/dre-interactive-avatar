import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The embed grant.
 *
 * A short-lived, signed statement that says: *this embed key was served to a
 * document framed by this origin*. It is issued only by `/embed/[embedKey]`,
 * which the browser will only render inside an allowed parent (see the
 * `frame-ancestors` middleware), and it is required to mint a session.
 *
 * What it is worth, precisely: `frame-ancestors` is the enforcement — it is
 * applied by the browser and cannot be forged. The grant adds that a *scraped
 * embed key on its own is useless*. To get one you have to actually be framed
 * on an allowed origin, and what you get expires in minutes.
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export interface GrantPayload {
  /** The embed key this grant was issued for. */
  embedKey: string;
  /** The parent origin the embed document was framed by. */
  parentOrigin: string;
  /** Expiry, epoch milliseconds. */
  exp: number;
}

export type GrantFailure = "malformed" | "bad_signature" | "expired";

export type GrantResult =
  | { ok: true; payload: GrantPayload }
  | { ok: false; reason: GrantFailure };

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function signGrant(
  input: Omit<GrantPayload, "exp">,
  secret: string,
  ttlMs: number = DEFAULT_TTL_MS,
  now: number = Date.now(),
): string {
  const payload: GrantPayload = { ...input, exp: now + ttlMs };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

/**
 * Compares signatures in constant time. A fast-exit comparison here leaks the
 * signature one byte at a time to anyone willing to measure.
 */
function signatureMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyGrant(
  token: string | null | undefined,
  secret: string,
  now: number = Date.now(),
): GrantResult {
  if (!token) return { ok: false, reason: "malformed" };

  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    return { ok: false, reason: "malformed" };
  }

  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  // Signature before shape: never parse attacker-controlled JSON we have not
  // authenticated.
  if (!signatureMatches(sign(encoded, secret), signature)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as GrantPayload).embedKey !== "string" ||
    typeof (payload as GrantPayload).parentOrigin !== "string" ||
    typeof (payload as GrantPayload).exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }

  const grant = payload as GrantPayload;
  if (grant.exp <= now) return { ok: false, reason: "expired" };

  return { ok: true, payload: grant };
}

export { GRANT_HEADER } from "./grantHeader";
