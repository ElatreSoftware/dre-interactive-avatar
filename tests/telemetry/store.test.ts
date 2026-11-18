import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ prisma: (await import("../support/fakePrisma")).prisma }));

import { createDatabaseSink } from "@/telemetry/store";
import { FOOTPRINT_VERSION, type StoredFootprint } from "@/telemetry/schema";
import { db, failOnce, resetDb } from "../support/fakePrisma";

function record(overrides: Partial<StoredFootprint> = {}): StoredFootprint {
  return {
    v: FOOTPRINT_VERSION,
    id: "id-12345678",
    seq: 0,
    sessionKey: "session-1",
    clientTs: Date.parse("2026-03-04T09:59:59Z"),
    type: "widget_opened",
    receivedAt: Date.parse("2026-03-04T10:00:00Z"),
    embedKey: "pk_test",
    parentOrigin: "https://acme.example",
    ipHash: "abc123",
    userAgent: "test",
    ...overrides,
  } as StoredFootprint;
}

beforeEach(() => resetDb());
afterEach(() => vi.restoreAllMocks());

describe("createDatabaseSink", () => {
  it("stores the envelope as columns", async () => {
    await createDatabaseSink().write([record()]);

    expect(db.footprints[0]).toMatchObject({
      eventId: "id-12345678",
      seq: 0,
      sessionKey: "session-1",
      type: "widget_opened",
      embedKeyValue: "pk_test",
      parentOrigin: "https://acme.example",
      ipHash: "abc123",
    });
    expect(db.footprints[0]!.receivedAt).toBeInstanceOf(Date);
  });

  it("keeps the event's own fields in the payload, and the envelope out of it", async () => {
    await createDatabaseSink().write([
      record({
        type: "transcript_turn",
        sender: "user",
        text: "Hello",
        isTyped: false,
        wasInterrupted: false,
        charCount: 5,
      } as Partial<StoredFootprint>),
    ]);

    const { payload } = db.footprints[0]!;
    expect(payload).toEqual({
      sender: "user",
      text: "Hello",
      isTyped: false,
      wasInterrupted: false,
      charCount: 5,
    });
    // Stored once, as a column — not duplicated into the JSON.
    expect(payload).not.toHaveProperty("sessionKey");
    expect(payload).not.toHaveProperty("ipHash");
  });

  it("promotes the vendor session id to its own column", async () => {
    await createDatabaseSink().write([
      record({ type: "session_started", avatarSessionId: "sess-9" } as Partial<StoredFootprint>),
    ]);
    expect(db.footprints[0]!.avatarSessionId).toBe("sess-9");
  });

  it("leaves that column empty for every other event", async () => {
    await createDatabaseSink().write([record()]);
    expect(db.footprints[0]!.avatarSessionId).toBeNull();
  });

  it("ignores a replayed batch rather than duplicating it", async () => {
    const sink = createDatabaseSink();
    // A beacon can be delivered twice; the event id is unique.
    await sink.write([record()]);
    await sink.write([record()]);
    expect(db.footprints).toHaveLength(1);
  });

  it("writes a batch in one call", async () => {
    await createDatabaseSink().write([
      record({ id: "id-1aaaaaaa", seq: 0 }),
      record({ id: "id-2aaaaaaa", seq: 1 }),
      record({ id: "id-3aaaaaaa", seq: 2 }),
    ]);
    expect(db.footprints.map((row) => row.seq)).toEqual([0, 1, 2]);
  });

  it("does nothing with an empty batch", async () => {
    await createDatabaseSink().write([]);
    expect(db.footprints).toHaveLength(0);
  });

  it("never rejects, whatever the database does", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    failOnce(new Error("connection refused"));

    // Telemetry must never become the caller's problem.
    await expect(createDatabaseSink().write([record()])).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it("keeps a hostile string intact and harmless", async () => {
    const text = 'line one\nline two"}\n{"forged": true';
    await createDatabaseSink().write([
      record({
        type: "transcript_turn",
        sender: "user",
        text,
        isTyped: false,
        wasInterrupted: false,
        charCount: text.length,
      } as Partial<StoredFootprint>),
    ]);

    // A parameterised insert into a JSON column: there is no line to forge.
    expect(db.footprints[0]!.payload.text).toBe(text);
    expect(db.footprints).toHaveLength(1);
  });
});
