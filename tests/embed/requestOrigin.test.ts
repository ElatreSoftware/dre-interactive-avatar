import { describe, expect, it } from "vitest";
import { originFromHeaders } from "@/embed/requestOrigin";

function headers(values: Record<string, string>) {
  return {
    get: (name: string) => values[name.toLowerCase()] ?? null,
  };
}

describe("originFromHeaders", () => {
  /**
   * The case this exists for: nginx terminates TLS and talks to the app over
   * plain HTTP, so `request.url` says http while the visitor is on https.
   * The page and the routes both derive the origin, then compare the two.
   */
  it("believes the forwarded protocol over the local one", () => {
    expect(
      originFromHeaders(
        headers({ host: "avatar.dr-e.com", "x-forwarded-proto": "https" }),
        "http://avatar.dr-e.com/api/avatar/session",
      ),
    ).toBe("https://avatar.dr-e.com");
  });

  it("agrees with itself whether called with a URL or without", () => {
    const sent = headers({ host: "avatar.dr-e.com", "x-forwarded-proto": "https" });
    // The page has only headers; the route also has request.url. Both must
    // produce the same string or the grant check fails for everyone.
    expect(originFromHeaders(sent)).toBe(
      originFromHeaders(sent, "http://avatar.dr-e.com/api/avatar/session"),
    );
  });

  it("takes the first entry when proxies have appended to each other", () => {
    expect(
      originFromHeaders(headers({ host: "a.example", "x-forwarded-proto": "https, http" })),
    ).toBe("https://a.example");
  });

  it("prefers a forwarded host, which a CDN rewrites", () => {
    expect(
      originFromHeaders(
        headers({
          host: "origin.internal",
          "x-forwarded-host": "avatar.dr-e.com",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://avatar.dr-e.com");
  });

  it("falls back to the request's own URL with no proxy in front", () => {
    expect(originFromHeaders(headers({}), "http://localhost:3000/api/x")).toBe(
      "http://localhost:3000",
    );
  });

  it("keeps a port", () => {
    expect(originFromHeaders(headers({ host: "localhost:3150" }), "http://localhost:3150/")).toBe(
      "http://localhost:3150",
    );
  });

  it("lowercases, because origins compare as strings", () => {
    expect(
      originFromHeaders(headers({ host: "Avatar.DR-E.com", "x-forwarded-proto": "HTTPS" })),
    ).toBe("https://avatar.dr-e.com");
  });

  it("returns null when there is no host to be had", () => {
    expect(originFromHeaders(headers({}))).toBeNull();
    expect(originFromHeaders(headers({}), "not a url")).toBeNull();
  });

  it("ignores an empty forwarded header rather than trusting it", () => {
    expect(
      originFromHeaders(headers({ host: "a.example", "x-forwarded-proto": "" }), "http://a.example/"),
    ).toBe("http://a.example");
  });
});

