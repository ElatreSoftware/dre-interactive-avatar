import { describe, expect, it } from "vitest";
import {
  isValidOriginPattern,
  originAllowed,
  parseOrigin,
  parseOriginPattern,
  serializeOrigin,
} from "@/embed/originMatch";

/**
 * The hostile cases come first on purpose. A permissive matcher here undoes
 * the entire allowlist, and every one of these passes a naive `endsWith`.
 */
describe("originAllowed — hostile input", () => {
  const allow = ["https://acme.example", "https://*.acme.example"];

  it.each([
    ["suffix smuggling", "https://acme.example.attacker.com"],
    ["prefix smuggling", "https://notacme.example"],
    ["wildcard suffix smuggling", "https://evil.acme.example.attacker.com"],
    ["downgraded scheme", "http://acme.example"],
    ["unexpected port", "https://acme.example:8443"],
    ["credentials", "https://user:pw@acme.example"],
    ["non-http scheme", "javascript:alert(1)"],
    ["not a URL at all", "acme.example"],
    ["empty", ""],
  ])("rejects %s", (_label, candidate) => {
    expect(originAllowed(candidate, allow)).toBe(false);
  });

  it("does not let the bare domain through a wildcard alone", () => {
    expect(originAllowed("https://acme.example", ["https://*.acme.example"])).toBe(false);
  });

  it("ignores unparseable allowlist entries rather than widening", () => {
    expect(originAllowed("https://acme.example", ["*", "https://", "acme.example"])).toBe(false);
  });
});

describe("originAllowed — legitimate input", () => {
  const allow = ["https://acme.example", "https://*.acme.example", "http://shop.test:8080"];

  it.each([
    ["exact host", "https://acme.example"],
    ["exact host with a path", "https://acme.example/checkout?a=1"],
    ["single subdomain", "https://www.acme.example"],
    ["nested subdomain", "https://eu.shop.acme.example"],
    ["explicit port match", "http://shop.test:8080"],
    ["uppercase host", "https://ACME.example"],
  ])("accepts %s", (_label, candidate) => {
    expect(originAllowed(candidate, allow)).toBe(true);
  });
});

describe("pattern parsing", () => {
  it.each([
    "https://acme.example",
    "https://*.acme.example",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ])("accepts %s", (pattern) => {
    expect(isValidOriginPattern(pattern)).toBe(true);
  });

  it.each([
    "https://*.com",
    "*.acme.example",
    "https://acme.example/path",
    "ftp://acme.example",
    "https://acme.example:notaport",
    "",
  ])("rejects %s", (pattern) => {
    expect(isValidOriginPattern(pattern)).toBe(false);
  });

  it("separates the wildcard from the host it anchors to", () => {
    expect(parseOriginPattern("https://*.acme.example")).toEqual({
      protocol: "https:",
      hostname: "acme.example",
      port: "",
      wildcard: true,
    });
  });
});

describe("parseOrigin / serializeOrigin", () => {
  it("normalises to a bare origin", () => {
    const origin = parseOrigin("https://Acme.Example/some/path#x");
    expect(origin).not.toBeNull();
    expect(serializeOrigin(origin!)).toBe("https://acme.example");
  });

  it("keeps a non-default port", () => {
    expect(serializeOrigin(parseOrigin("http://shop.test:8080")!)).toBe("http://shop.test:8080");
  });
});
