import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ prisma: (await import("../support/fakePrisma")).prisma }));

import { GRANT_HEADER, signGrant } from "@/embed/grant";
import { resetRegistryCache } from "@/embed/registry";
import { resetServerEnvCache } from "@/lib/env";
import { resetFootprintSink } from "@/telemetry/store";
import { resetSweepState } from "@/telemetry/retention";
import { FOOTPRINT_VERSION } from "@/telemetry/schema";
import { db, resetDb, seedActiveSession, seedKey } from "../support/fakePrisma";

const GRANT_SECRET = "a-test-grant-secret-at-least-32-characters";
const SELF_ORIGIN = "http://localhost";
const PARENT_ORIGIN = "https://acme.example";

function grant(overrides: { embedKey?: string; parentOrigin?: string } = {}): string {
  return signGrant(
    { embedKey: "pk_dre_7f3a91c4", parentOrigin: PARENT_ORIGIN, ...overrides },
    GRANT_SECRET,
  );
}

function event(payload: Record<string, unknown> = {}, seq = 0) {
  return {
    v: FOOTPRINT_VERSION,
    id: `id-${seq}000000`,
    seq,
    sessionKey: "session-key-1",
    clientTs: 1_700_000_000_000,
    type: "widget_opened",
    ...payload,
  };
}

function post(body: unknown, token: string | null = grant(), headers: Record<string, string> = {}) {
  const serialized = JSON.stringify(body);
  return new Request(`${SELF_ORIGIN}/api/footprints`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(serialized.length),
      "x-forwarded-for": "203.0.113.9",
      "user-agent": "test-agent",
      ...(token ? { [GRANT_HEADER]: token } : {}),
      ...headers,
    },
    body: serialized,
  });
}

async function importRoute() {
  const route = await import("@/app/api/footprints/route");
  route.resetIngestLimiter();
  return route;
}

/** The rows as the route stored them, flattened back into event shape. */
async function storedLines(): Promise<Record<string, unknown>[]> {
  return db.footprints.map((row) => ({
    ...row.payload,
    v: row.v,
    id: row.eventId,
    seq: row.seq,
    sessionKey: row.sessionKey,
    type: row.type,
    clientTs: row.clientTs.getTime(),
    receivedAt: row.receivedAt.getTime(),
    embedKey: row.embedKeyValue,
    parentOrigin: row.parentOrigin,
    ipHash: row.ipHash,
    userAgent: row.userAgent,
  }));
}

beforeEach(() => {
  resetDb();
  resetServerEnvCache();
  resetRegistryCache();
  resetFootprintSink();
  resetSweepState();
  seedKey({ allowedOrigins: [PARENT_ORIGIN] });
  vi.stubEnv("EMBED_GRANT_SECRET", GRANT_SECRET);
  vi.stubEnv("IP_HASH_SALT", "test-salt");
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetDb();
  resetServerEnvCache();
  resetRegistryCache();
  resetFootprintSink();
  resetSweepState();
});

describe("POST /api/footprints", () => {
  it("stores a valid batch and says nothing back", async () => {
    const { POST } = await importRoute();
    const response = await POST(post({ events: [event(), event({}, 1)] }));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(await storedLines()).toHaveLength(2);
  });

  it("stamps server truth over anything the client claims", async () => {
    const { POST } = await importRoute();
    await POST(
      post({
        events: [
          event({ parentOrigin: "https://attacker.example", embedKey: "pk_someone_else" }),
        ],
      }),
    );

    const [stored] = await storedLines();
    expect(stored).toMatchObject({
      parentOrigin: PARENT_ORIGIN,
      embedKey: "pk_dre_7f3a91c4",
      userAgent: "test-agent",
    });
    expect(stored!.ipHash).toMatch(/^[0-9a-f]{16}$/);
    expect(stored!.receivedAt).toBeGreaterThan(1_700_000_000_000);
  });

  it("does not store the raw IP address anywhere", async () => {
    const { POST } = await importRoute();
    await POST(post({ events: [event()] }));
    const [stored] = await storedLines();
    expect(JSON.stringify(stored)).not.toContain("203.0.113.9");
  });

  it.each([
    ["no grant", null],
    ["a malformed grant", "nonsense"],
    [
      "a grant for an unknown key",
      signGrant({ embedKey: "pk_unknown", parentOrigin: PARENT_ORIGIN }, GRANT_SECRET),
    ],
  ])("refuses %s and writes nothing", async (_label, token) => {
    const { POST } = await importRoute();
    const response = await POST(post({ events: [event()] }, token));
    expect(response.status).toBe(403);
    expect(await storedLines()).toHaveLength(0);
  });

  it("refuses a grant whose origin is not on the allowlist", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { POST } = await importRoute();
    const response = await POST(
      post({ events: [event()] }, grant({ parentOrigin: "https://elsewhere.example" })),
    );
    expect(response.status).toBe(403);
    expect(await storedLines()).toHaveLength(0);
  });

  it("drops one malformed event and keeps the rest of the batch", async () => {
    const { POST } = await importRoute();
    await POST(
      post({
        events: [
          event({}, 0),
          { v: FOOTPRINT_VERSION, type: "nonsense" },
          event({}, 2),
        ],
      }),
    );

    const stored = await storedLines();
    expect(stored.map((line) => line.seq)).toEqual([0, 2]);
  });

  it.each([
    ["a batch over the limit", { events: Array.from({ length: 51 }, (_, i) => event({}, i)) }, 413],
    ["an empty batch", { events: [] }, 400],
    ["a body that is not a batch", { nope: true }, 400],
  ])("refuses %s", async (_label, body, status) => {
    const { POST } = await importRoute();
    expect((await POST(post(body))).status).toBe(status);
    expect(await storedLines()).toHaveLength(0);
  });

  it("refuses an oversized body before reading it", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      post({ events: [event()] }, grant(), { "content-length": String(200 * 1024) }),
    );
    expect(response.status).toBe(413);
  });

  it("refuses a body that is not JSON", async () => {
    const { POST } = await importRoute();
    const request = new Request(`${SELF_ORIGIN}/api/footprints`, {
      method: "POST",
      headers: { [GRANT_HEADER]: grant() },
      body: "{not json",
    });
    expect((await POST(request)).status).toBe(400);
  });

  it("rate-limits a caller sending events in a loop", async () => {
    const { POST } = await importRoute();
    const statuses: number[] = [];
    for (let i = 0; i < 62; i += 1) {
      statuses.push((await POST(post({ events: [event({}, i)] }))).status);
    }
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
  });

  it("keeps transcripts out of the file when they are switched off", async () => {
    vi.stubEnv("FOOTPRINT_TRANSCRIPTS", "false");
    const { POST } = await importRoute();
    await POST(
      post({
        events: [
          event({
            type: "transcript_turn",
            sender: "user",
            text: "something private",
            isTyped: false,
            wasInterrupted: false,
            charCount: 17,
          }),
        ],
      }),
    );

    const [stored] = await storedLines();
    expect(stored).toMatchObject({ type: "transcript_turn", text: "", charCount: 17 });
    expect(JSON.stringify(stored)).not.toContain("something private");
  });

  it("writes nothing at all when footprints are disabled", async () => {
    vi.stubEnv("FOOTPRINTS_ENABLED", "false");
    const { POST } = await importRoute();
    expect((await POST(post({ events: [event()] }))).status).toBe(204);
    expect(await storedLines()).toHaveLength(0);
  });
});

describe("a beacon's grant travels in the body", () => {
  it("is accepted when there is no header to carry it", async () => {
    const { POST } = await importRoute();
    const body = JSON.stringify({ grant: grant(), events: [event()] });
    const request = new Request(`${SELF_ORIGIN}/api/footprints`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    expect((await POST(request)).status).toBe(204);
    expect(await storedLines()).toHaveLength(1);
  });

  it("is still verified, not merely present", async () => {
    const { POST } = await importRoute();
    const body = JSON.stringify({ grant: "forged", events: [event()] });
    const request = new Request(`${SELF_ORIGIN}/api/footprints`, {
      method: "POST",
      body,
    });

    expect((await POST(request)).status).toBe(403);
    expect(await storedLines()).toHaveLength(0);
  });

  it("never becomes a stored field", async () => {
    const { POST } = await importRoute();
    const token = grant();
    await POST(
      new Request(`${SELF_ORIGIN}/api/footprints`, {
        method: "POST",
        body: JSON.stringify({ grant: token, events: [event()] }),
      }),
    );

    const [stored] = await storedLines();
    expect(JSON.stringify(stored)).not.toContain(token);
  });
});

describe("the IP hash salt", () => {
  it("warns in the logs when it is missing, rather than quietly hashing unsalted", async () => {
    vi.stubEnv("IP_HASH_SALT", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { POST } = await importRoute();
    await POST(post({ events: [event()] }));

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("IP_HASH_SALT"));
  });

  it("changes the hash, so rotating it breaks correlation", async () => {
    const { POST } = await importRoute();
    await POST(post({ events: [event()] }));
    const [first] = await storedLines();

    vi.stubEnv("IP_HASH_SALT", "a-different-salt");
    const { POST: POST2 } = await importRoute();
    await POST2(post({ events: [event({}, 1)] }));

    const stored = await storedLines();
    const second = stored.find((line) => line.seq === 1);
    expect(second!.ipHash).not.toBe(first!.ipHash);
  });
});

describe("keeping the concurrent-session count honest", () => {
  function footprint(type: string, payload: Record<string, unknown> = {}, seq = 0) {
    return event({ type, ...payload }, seq);
  }

  it("ties a widget session to the minted one when the call starts", async () => {
    seedActiveSession({ avatarSessionId: "vendor-1", embedKeyValue: "pk_dre_7f3a91c4" });

    const { POST } = await importRoute();
    await POST(post({ events: [footprint("session_started", { avatarSessionId: "vendor-1" })] }));

    expect(db.activeSessions[0]!.sessionKey).toBe("session-key-1");
  });

  it("closes the slot when the call ends, keeping the record", async () => {
    seedActiveSession({
      avatarSessionId: "vendor-1",
      sessionKey: "session-key-1",
      embedKeyValue: "pk_dre_7f3a91c4",
    });

    const { POST } = await importRoute();
    await POST(
      post({
        events: [
          footprint("session_ended", {
            reason: "client",
            durationMs: 1000,
            turns: 1,
            interruptions: 0,
          }),
        ],
      }),
    );

    expect(db.activeSessions).toHaveLength(1);
    expect(db.activeSessions[0]!.deletedAt).toBeInstanceOf(Date);
  });

  it("counts an ordinary event as a sign of life", async () => {
    const row = seedActiveSession({
      avatarSessionId: "vendor-1",
      sessionKey: "session-key-1",
      embedKeyValue: "pk_dre_7f3a91c4",
      lastSeenAt: new Date(Date.now() - 60_000),
    });
    const before = row.lastSeenAt.getTime();

    const { POST } = await importRoute();
    await POST(post({ events: [footprint("avatar_speak_started")] }));

    expect(db.activeSessions[0]!.lastSeenAt.getTime()).toBeGreaterThan(before);
  });

  it("does not resurrect a slot it just closed", async () => {
    seedActiveSession({
      avatarSessionId: "vendor-1",
      sessionKey: "session-key-1",
      embedKeyValue: "pk_dre_7f3a91c4",
    });

    const { POST } = await importRoute();
    // A batch typically ends with the call ending; the earlier events in it
    // must not re-touch the row after it has gone.
    await POST(
      post({
        events: [
          footprint("avatar_speak_ended", {}, 0),
          footprint(
            "session_ended",
            { reason: "client", durationMs: 10, turns: 0, interruptions: 0 },
            1,
          ),
        ],
      }),
    );

    // The earlier events in the batch must not re-open it.
    expect(db.activeSessions[0]!.deletedAt).toBeInstanceOf(Date);
  });
});
