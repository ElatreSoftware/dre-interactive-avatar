import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ prisma: (await import("../support/fakePrisma")).prisma }));

import { GRANT_HEADER, signGrant } from "@/embed/grant";
import { sessionRateLimiter } from "@/embed/rateLimit";
import { INTERNAL_EMBED_KEY, resetRegistryCache } from "@/embed/registry";
import { resetServerEnvCache } from "@/lib/env";
import { db, resetDb, seedActiveSession, seedKey } from "../support/fakePrisma";

const GRANT_SECRET = "a-test-grant-secret-at-least-32-characters";
const SELF_ORIGIN = "http://localhost";
const PARENT_ORIGIN = "https://acme.example";

const CUSTOMER_KEY = {
  key: "pk_dre_7f3a91c4",
  name: "Acme Corp",
  enabled: true,
  avatarId: "avatar-acme",
  allowedOrigins: ["https://acme.example"],
  dynamicVariables: { brand: "Acme" },
};

const VALID_ENV = {
  EMBED_GRANT_SECRET: GRANT_SECRET,
  LIVEAVATAR_API_KEY: "la-secret-key",
  LIVEAVATAR_ELEVENLABS_SECRET_ID: "secret-uuid",
  ELEVENLABS_AGENT_ID: "agent_123",
  LIVEAVATAR_API_URL: "https://api.liveavatar.com",
  LIVEAVATAR_DEFAULT_AVATAR_ID: "avatar-default",
};

/** The first-party page's grant; every pre-existing test is one of these. */
function internalGrant(): string {
  return signGrant({ embedKey: INTERNAL_EMBED_KEY, parentOrigin: SELF_ORIGIN }, GRANT_SECRET);
}

function post(body: unknown = {}, grant: string | null = internalGrant()) {
  return new Request(`${SELF_ORIGIN}/api/avatar/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(grant ? { [GRANT_HEADER]: grant } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function importRoute() {
  return import("@/app/api/avatar/session/route");
}

beforeEach(() => {
  resetServerEnvCache();
  resetRegistryCache();
  sessionRateLimiter.reset();
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  resetDb();
  seedKey({
    key: CUSTOMER_KEY.key,
    name: CUSTOMER_KEY.name,
    avatarId: CUSTOMER_KEY.avatarId,
    allowedOrigins: CUSTOMER_KEY.allowedOrigins,
    dynamicVariables: CUSTOMER_KEY.dynamicVariables,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetDb();
  resetServerEnvCache();
  resetRegistryCache();
  sessionRateLimiter.reset();
});

/**
 * A fresh Response per call: a body can only be read once, so a shared
 * instance makes the second call of any test fail for the wrong reason.
 */
function mockUpstream(status: number, payload: unknown) {
  vi.mocked(fetch).mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

describe("POST /api/avatar/session", () => {
  it("returns only the session id and token", async () => {
    mockUpstream(200, {
      code: 100,
      message: "ok",
      data: { session_id: "sess-1", session_token: "tok-1", internal_debug: "leak me" },
    });
    const { POST } = await importRoute();

    const response = await POST(post({ avatarId: "avatar-1" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessionId: "sess-1", sessionToken: "tok-1" });
  });

  it("never returns a secret in the body", async () => {
    mockUpstream(200, { data: { session_id: "s", session_token: "t" } });
    const { POST } = await importRoute();

    const text = await (await POST(post({ avatarId: "a" }))).text();
    expect(text).not.toContain(VALID_ENV.LIVEAVATAR_API_KEY);
    expect(text).not.toContain(VALID_ENV.LIVEAVATAR_ELEVENLABS_SECRET_ID);
    expect(text).not.toContain(VALID_ENV.ELEVENLABS_AGENT_ID);
  });

  it("sends a LITE-mode payload wired to the ElevenLabs agent", async () => {
    mockUpstream(200, { data: { session_id: "s", session_token: "t" } });
    const { POST } = await importRoute();

    await POST(post({ avatarId: "avatar-9", isSandbox: true, dynamicVariables: { name: "Dre" } }));

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.liveavatar.com/v1/sessions/token");
    expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe(VALID_ENV.LIVEAVATAR_API_KEY);
    expect(JSON.parse(init.body as string)).toEqual({
      mode: "LITE",
      avatar_id: "avatar-9",
      is_sandbox: true,
      // Asks the vendor for the best stream it will give us; the layer the
      // browser actually receives is still chosen by adaptive streaming.
      video_settings: { quality: "high", encoding: "H264" },
      elevenlabs_agent_config: {
        secret_id: VALID_ENV.LIVEAVATAR_ELEVENLABS_SECRET_ID,
        agent_id: VALID_ENV.ELEVENLABS_AGENT_ID,
        dynamic_variables: { name: "Dre" },
      },
    });
  });

  it("falls back to the configured default avatar", async () => {
    mockUpstream(200, { data: { session_id: "s", session_token: "t" } });
    const { POST } = await importRoute();

    await POST(post({}));
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).avatar_id).toBe("avatar-default");
  });

  it("400s when no avatar id is available anywhere", async () => {
    vi.stubEnv("LIVEAVATAR_DEFAULT_AVATAR_ID", "");
    resetServerEnvCache();
    const { POST } = await importRoute();

    const response = await POST(post({}));
    expect(response.status).toBe(400);
  });

  it("400s on a malformed body", async () => {
    const { POST } = await importRoute();
    const bad = new Request("http://localhost/api/avatar/session", {
      method: "POST",
      body: "{not json",
    });
    expect((await POST(bad)).status).toBe(400);
    expect((await POST(post({ avatarId: 42 }))).status).toBe(400);
  });

  it("never forwards upstream error text in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mockUpstream(402, { message: "insufficient credits on account acct_internal_8832" });
    const { POST } = await importRoute();

    const response = await POST(post({ avatarId: "a" }));
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).not.toContain("acct_internal_8832");
    expect(body).not.toContain("detail");
  });

  it("includes the upstream detail in development, where it is the actual clue", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mockUpstream(400, {
      message:
        "ElevenLabs agent has TTS output audio format 'pcm_16000', but 'pcm_24000' is required.",
    });
    const { POST } = await importRoute();

    const response = await POST(post({ avatarId: "a" }));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toMatch(/not configured correctly/i);
    expect(JSON.stringify(body.detail)).toContain("pcm_24000");
  });

  it("502s when the upstream shape is unexpected", async () => {
    mockUpstream(200, { code: 100, data: null });
    const { POST } = await importRoute();
    expect((await POST(post({ avatarId: "a" }))).status).toBe(502);
  });

  it("502s when the upstream is unreachable", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));
    const { POST } = await importRoute();

    const response = await POST(post({ avatarId: "a" }));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("ECONNREFUSED");
  });

  it("500s with a generic message when the server env is incomplete", async () => {
    vi.stubEnv("LIVEAVATAR_API_KEY", "");
    resetServerEnvCache();
    const { POST } = await importRoute();

    const response = await POST(post({ avatarId: "a" }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("LIVEAVATAR_API_KEY");
  });
});

describe("the embed grant gate", () => {
  function customerGrant(origin = "https://acme.example"): string {
    return signGrant({ embedKey: CUSTOMER_KEY.key, parentOrigin: origin }, GRANT_SECRET);
  }

  function okUpstream() {
    mockUpstream(200, {
      code: 100,
      message: "ok",
      data: { session_id: "sess-1", session_token: "tok-1" },
    });
  }

  it("mints a session for a customer embedded on an allowed origin", async () => {
    okUpstream();
    const { POST } = await importRoute();
    const response = await POST(post({}, customerGrant()));
    expect(response.status).toBe(200);
  });

  it("uses the registry's avatar, not the one the caller asked for", async () => {
    okUpstream();
    const { POST } = await importRoute();
    await POST(post({ avatarId: "avatar-someone-elses" }, customerGrant()));

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(body.avatar_id).toBe("avatar-acme");
  });

  it("uses the registry's prompt variables, not the caller's", async () => {
    okUpstream();
    const { POST } = await importRoute();
    await POST(post({ dynamicVariables: { brand: "Attacker" } }, customerGrant()));

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(body.elevenlabs_agent_config.dynamic_variables).toEqual({ brand: "Acme" });
  });

  it.each([
    ["no grant at all", null],
    ["a malformed grant", "not-a-grant"],
    ["a grant signed with the wrong secret", signGrant({ embedKey: "pk_dre_7f3a91c4", parentOrigin: "https://acme.example" }, "a-different-secret-of-sufficient-length")],
    ["a grant for an unknown key", signGrant({ embedKey: "pk_unknown", parentOrigin: "https://acme.example" }, GRANT_SECRET)],
  ])("refuses %s", async (_label, grant) => {
    const { POST } = await importRoute();
    const response = await POST(post({}, grant));
    expect(response.status).toBe(403);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("refuses an expired grant", async () => {
    const expired = signGrant(
      { embedKey: CUSTOMER_KEY.key, parentOrigin: "https://acme.example" },
      GRANT_SECRET,
      1000,
      Date.now() - 60_000,
    );
    const { POST } = await importRoute();
    expect((await POST(post({}, expired))).status).toBe(403);
  });

  it("refuses a grant whose origin has since left the allowlist", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { POST } = await importRoute();
    const response = await POST(post({}, customerGrant("https://former-customer.example")));
    expect(response.status).toBe(403);
  });

  it("ties the internal key to this very origin", async () => {
    const elsewhere = signGrant(
      { embedKey: INTERNAL_EMBED_KEY, parentOrigin: "https://somewhere-else.example" },
      GRANT_SECRET,
    );
    const { POST } = await importRoute();
    expect((await POST(post({}, elsewhere))).status).toBe(403);
  });

  it("leaks nothing about why it refused", async () => {
    const { POST } = await importRoute();
    const body = await (await POST(post({}, "not-a-grant"))).text();
    expect(body).not.toMatch(/signature|expired|malformed|registry/i);
  });

  it("stops a caller from burning credits in a loop", async () => {
    okUpstream();
    const { POST } = await importRoute();

    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      statuses.push((await POST(post({}, customerGrant()))).status);
    }
    expect(statuses.filter((status) => status === 200)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(2);
  });
});

describe("key expiry", () => {
  function customerGrant(): string {
    return signGrant({ embedKey: CUSTOMER_KEY.key, parentOrigin: PARENT_ORIGIN }, GRANT_SECRET);
  }

  it("refuses an expired key, and spends nothing", async () => {
    resetDb();
    seedKey({ ...CUSTOMER_KEY, expiresAt: new Date(Date.now() - 1000) });

    const { POST } = await importRoute();
    const response = await POST(post({}, customerGrant()));

    expect(response.status).toBe(403);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("still serves a key that expires tomorrow", async () => {
    resetDb();
    seedKey({ ...CUSTOMER_KEY, expiresAt: new Date(Date.now() + 86_400_000) });
    mockUpstream(200, {
      code: 100,
      message: "ok",
      data: { session_id: "sess-1", session_token: "tok-1" },
    });

    const { POST } = await importRoute();
    expect((await POST(post({}, customerGrant()))).status).toBe(200);
  });
});

describe("concurrent call limits", () => {
  function customerGrant(): string {
    return signGrant({ embedKey: CUSTOMER_KEY.key, parentOrigin: PARENT_ORIGIN }, GRANT_SECRET);
  }

  function okUpstream() {
    mockUpstream(200, {
      code: 100,
      message: "ok",
      data: { session_id: `sess-${Math.random()}`, session_token: "tok-1" },
    });
  }

  beforeEach(() => {
    resetDb();
    seedKey({ ...CUSTOMER_KEY, maxConcurrentSessions: 2 });
  });

  it("refuses once the customer is at their limit, before paying for it", async () => {
    seedActiveSession({ avatarSessionId: "a", embedKeyValue: CUSTOMER_KEY.key });
    seedActiveSession({ avatarSessionId: "b", embedKeyValue: CUSTOMER_KEY.key });
    okUpstream();

    const { POST } = await importRoute();
    const response = await POST(post({}, customerGrant()));

    expect(response.status).toBe(429);
    // The point of checking first: the vendor bills for a minted session
    // whether or not we then decide we did not want it.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("allows a call below the limit and records the slot", async () => {
    mockUpstream(200, {
      code: 100,
      message: "ok",
      data: { session_id: "sess-live", session_token: "tok-1" },
    });

    const { POST } = await importRoute();
    expect((await POST(post({}, customerGrant()))).status).toBe(200);
    expect(db.activeSessions.map((row) => row.avatarSessionId)).toEqual(["sess-live"]);
  });

  it("does not count another customer's calls", async () => {
    seedActiveSession({ avatarSessionId: "a", embedKeyValue: "pk_someone_else" });
    seedActiveSession({ avatarSessionId: "b", embedKeyValue: "pk_someone_else" });
    okUpstream();

    const { POST } = await importRoute();
    expect((await POST(post({}, customerGrant()))).status).toBe(200);
  });

  it("frees a slot that has gone quiet", async () => {
    const longAgo = new Date(Date.now() - 20 * 60_000);
    seedActiveSession({ avatarSessionId: "ghost-1", embedKeyValue: CUSTOMER_KEY.key, lastSeenAt: longAgo });
    seedActiveSession({ avatarSessionId: "ghost-2", embedKeyValue: CUSTOMER_KEY.key, lastSeenAt: longAgo });
    okUpstream();

    const { POST } = await importRoute();
    expect((await POST(post({}, customerGrant()))).status).toBe(200);
  });

  it("leaves an unlimited key alone", async () => {
    resetDb();
    seedKey({ ...CUSTOMER_KEY, maxConcurrentSessions: null });
    for (let i = 0; i < 5; i += 1) {
      seedActiveSession({ avatarSessionId: `s${i}`, embedKeyValue: CUSTOMER_KEY.key });
    }
    okUpstream();

    const { POST } = await importRoute();
    expect((await POST(post({}, customerGrant()))).status).toBe(200);
  });

  it("says nothing about other customers when it refuses", async () => {
    seedActiveSession({ avatarSessionId: "a", embedKeyValue: CUSTOMER_KEY.key });
    seedActiveSession({ avatarSessionId: "b", embedKeyValue: CUSTOMER_KEY.key });

    const { POST } = await importRoute();
    const body = await (await POST(post({}, customerGrant()))).text();
    expect(body).not.toMatch(/pk_|limit|concurrent/i);
  });
});

describe("behind a TLS-terminating proxy", () => {
  /**
   * The first-party page signs a grant for its own origin, and this route
   * checks it. nginx talks to the app over plain HTTP, so `request.url` says
   * `http://` while the page saw `https://`. Deriving the two differently
   * made every first-party call fail with "This page is not allowed to start
   * a session" the moment the app went behind TLS.
   */
  function proxiedRequest(grant: string): Request {
    return new Request("http://127.0.0.1:3000/api/avatar/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "avatar.dr-e.com",
        "x-forwarded-proto": "https",
        [GRANT_HEADER]: grant,
      },
      body: "{}",
    });
  }

  it("accepts the first-party page's own grant", async () => {
    mockUpstream(200, {
      code: 100,
      message: "ok",
      data: { session_id: "sess-1", session_token: "tok-1" },
    });

    const grant = signGrant(
      { embedKey: INTERNAL_EMBED_KEY, parentOrigin: "https://avatar.dr-e.com" },
      GRANT_SECRET,
    );

    expect((await (await importRoute()).POST(proxiedRequest(grant))).status).toBe(200);
  });

  it("still refuses a grant for somewhere else entirely", async () => {
    const grant = signGrant(
      { embedKey: INTERNAL_EMBED_KEY, parentOrigin: "https://attacker.example" },
      GRANT_SECRET,
    );

    expect((await (await importRoute()).POST(proxiedRequest(grant))).status).toBe(403);
  });
});
