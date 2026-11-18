import { describe, expect, it } from "vitest";
import { signGrant, verifyGrant } from "@/embed/grant";

const SECRET = "a-test-secret-at-least-32-characters-long";
const NOW = 1_700_000_000_000;

function grant(overrides: Partial<{ embedKey: string; parentOrigin: string }> = {}): string {
  return signGrant(
    { embedKey: "pk_dre_7f3a91c4", parentOrigin: "https://acme.example", ...overrides },
    SECRET,
    60_000,
    NOW,
  );
}

describe("signGrant / verifyGrant", () => {
  it("round-trips", () => {
    const result = verifyGrant(grant(), SECRET, NOW);
    expect(result).toEqual({
      ok: true,
      payload: {
        embedKey: "pk_dre_7f3a91c4",
        parentOrigin: "https://acme.example",
        exp: NOW + 60_000,
      },
    });
  });

  it("rejects a tampered payload", () => {
    const token = grant();
    const [, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        embedKey: "pk_dre_7f3a91c4",
        parentOrigin: "https://attacker.example",
        exp: NOW + 60_000,
      }),
    ).toString("base64url");
    expect(verifyGrant(`${forged}.${signature}`, SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a tampered signature", () => {
    const [payload] = grant().split(".");
    expect(verifyGrant(`${payload}.not-the-signature`, SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a grant signed with a different secret", () => {
    expect(verifyGrant(grant(), `${SECRET}-other`, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects an unsigned payload", () => {
    const [payload] = grant().split(".");
    expect(verifyGrant(payload!, SECRET, NOW).ok).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
    ["no separator", "abcdef"],
    ["trailing separator", "abcdef."],
    ["leading separator", ".abcdef"],
  ])("rejects a %s token as malformed", (_label, token) => {
    expect(verifyGrant(token, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a correctly signed token whose payload is not a grant", () => {
    // Signed by us, so the signature passes — the shape check is what catches it.
    const token = signGrant(
      { embedKey: "k", parentOrigin: "https://a.example" },
      SECRET,
      60_000,
      NOW,
    );
    const [, signature] = token.split(".");
    const encoded = Buffer.from(JSON.stringify(["not", "an", "object"])).toString("base64url");
    const resigned = verifyGrant(`${encoded}.${signature}`, SECRET, NOW);
    expect(resigned.ok).toBe(false);
  });

  it("expires exactly at its expiry, not a millisecond later", () => {
    const token = grant();
    expect(verifyGrant(token, SECRET, NOW + 59_999).ok).toBe(true);
    expect(verifyGrant(token, SECRET, NOW + 60_000)).toEqual({ ok: false, reason: "expired" });
  });

  it("produces URL-safe tokens", () => {
    expect(grant({ parentOrigin: "https://a.example?x=1&y=2" })).toMatch(/^[A-Za-z0-9_.-]+$/);
  });
});
