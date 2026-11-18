import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", async () => ({ prisma: (await import("../support/fakePrisma")).prisma }));

import { proxy } from "@/proxy";
import { INTERNAL_EMBED_KEY, resetRegistryCache } from "@/embed/registry";
import { failOnce, resetDb, seedKey } from "../support/fakePrisma";

async function csp(path: string): Promise<string> {
  const response = await proxy(new NextRequest(`https://widget.example${path}`));
  return response.headers.get("content-security-policy") ?? "";
}

beforeEach(() => {
  resetDb();
  resetRegistryCache();
  seedKey({ allowedOrigins: ["https://acme.example", "https://*.acme.example"] });
  seedKey({ key: "pk_dre_off", name: "Disabled", enabled: false, allowedOrigins: ["https://off.example"] });
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  resetDb();
  resetRegistryCache();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("frame-ancestors", () => {
  it("names a known key's allowed origins", async () => {
    await expect(csp("/embed/pk_dre_7f3a91c4")).resolves.toBe(
      "frame-ancestors https://acme.example https://*.acme.example",
    );
  });

  it.each([
    ["unknown", "/embed/pk_nope"],
    ["disabled", "/embed/pk_dre_off"],
    ["missing", "/embed/"],
  ])("refuses framing for a %s key", async (_label, path) => {
    await expect(csp(path)).resolves.toBe("frame-ancestors 'none'");
  });

  it("lets the first-party page frame itself", async () => {
    await expect(csp(`/embed/${INTERNAL_EMBED_KEY}`)).resolves.toBe("frame-ancestors 'self'");
  });

  it("never sets X-Frame-Options, which cannot express an allowlist", async () => {
    const response = await proxy(new NextRequest("https://widget.example/embed/pk_dre_7f3a91c4"));
    expect(response.headers.get("x-frame-options")).toBeNull();
  });

  it("fails closed when the database is unreachable", async () => {
    failOnce(new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(csp("/embed/pk_dre_7f3a91c4")).resolves.toBe("frame-ancestors 'none'");
  });

  it("never widens to a wildcard", async () => {
    for (const path of ["/embed/pk_dre_7f3a91c4", "/embed/pk_nope", "/embed/x"]) {
      await expect(csp(path)).resolves.not.toContain("frame-ancestors *");
    }
  });

  it("adds localhost only outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await expect(csp("/embed/pk_dre_7f3a91c4")).resolves.toContain("http://localhost:*");
  });
});
