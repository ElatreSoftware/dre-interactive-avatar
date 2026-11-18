import { describe, expect, it } from "vitest";
import { framingFrom, mayBeFramed } from "@/embed/framing";

function headers(dest?: string) {
  return { get: (name: string) => (name.toLowerCase() === "sec-fetch-dest" ? (dest ?? null) : null) };
}

describe("framingFrom", () => {
  it.each(["iframe", "frame", "embed", "object", "IFRAME", " iframe "])(
    "reads %s as framed",
    (dest) => {
      expect(framingFrom(headers(dest))).toBe("framed");
    },
  );

  it.each(["document", "empty", "script", "image"])("reads %s as not framed", (dest) => {
    expect(framingFrom(headers(dest))).toBe("not-framed");
  });

  it("says so when the browser did not tell us", () => {
    expect(framingFrom(headers())).toBe("unknown");
  });
});

describe("mayBeFramed", () => {
  it("serves a framed request", () => {
    expect(mayBeFramed(headers("iframe"))).toBe(true);
  });

  it("refuses a top-level navigation", () => {
    // A public embed key pasted into an address bar.
    expect(mayBeFramed(headers("document"))).toBe(false);
  });

  it("serves a request from a browser too old to say", () => {
    // Refusing these would break more than it protects; the key, the origin
    // allowlist and the grant all still apply.
    expect(mayBeFramed(headers())).toBe(true);
  });
});
