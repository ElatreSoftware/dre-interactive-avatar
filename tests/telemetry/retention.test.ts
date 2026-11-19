import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ prisma: (await import("../support/fakePrisma")).prisma }));

import {
  DEFAULT_RETENTION_DAYS,
  pruneFootprints,
  resetSweepState,
  retentionCutoff,
  retentionDays,
  sweepIfDue,
} from "@/telemetry/retention";
import { db, failOnce, resetDb } from "../support/fakePrisma";

const NOW = Date.parse("2026-06-01T12:00:00Z");
const DAY = 86_400_000;

function footprintAgedDays(days: number, id: string) {
  db.footprints.push({
    v: 1,
    eventId: id,
    seq: 0,
    sessionKey: "s",
    avatarSessionId: null,
    type: "widget_opened",
    payload: {},
    clientTs: new Date(NOW - days * DAY),
    receivedAt: new Date(NOW - days * DAY),
    embedKeyValue: "pk_test",
    parentOrigin: "https://acme.example",
    ipHash: "abc",
    userAgent: "test",
  });
}

beforeEach(() => {
  resetDb();
  resetSweepState();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("retentionDays", () => {
  it("defaults to 90", () => {
    expect(retentionDays()).toBe(DEFAULT_RETENTION_DAYS);
  });

  it("takes the configured value", () => {
    vi.stubEnv("FOOTPRINTS_RETENTION_DAYS", "30");
    expect(retentionDays()).toBe(30);
  });

  it.each([["nonsense", "soon"], ["zero", "0"], ["negative", "-5"]])(
    "falls back to the default for a %s value",
    (_label, value) => {
      vi.stubEnv("FOOTPRINTS_RETENTION_DAYS", value);
      expect(retentionDays()).toBe(DEFAULT_RETENTION_DAYS);
    },
  );
});

describe("retentionCutoff", () => {
  it("is the configured number of days back", () => {
    vi.stubEnv("FOOTPRINTS_RETENTION_DAYS", "30");
    expect(retentionCutoff(NOW).toISOString()).toBe(new Date(NOW - 30 * DAY).toISOString());
  });
});

describe("pruneFootprints", () => {
  it("deletes what is past the window and keeps the rest", async () => {
    footprintAgedDays(120, "old-1");
    footprintAgedDays(91, "old-2");
    footprintAgedDays(89, "recent-1");
    footprintAgedDays(0, "recent-2");

    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(pruneFootprints(NOW)).resolves.toBe(2);
    expect(db.footprints.map((row) => row.eventId)).toEqual(["recent-1", "recent-2"]);
  });

  it("deletes nothing when nothing is old", async () => {
    footprintAgedDays(1, "recent");
    await expect(pruneFootprints(NOW)).resolves.toBe(0);
    expect(db.footprints).toHaveLength(1);
  });

  it("honours a shortened window immediately", async () => {
    vi.stubEnv("FOOTPRINTS_RETENTION_DAYS", "7");
    footprintAgedDays(30, "old");
    footprintAgedDays(1, "recent");

    vi.spyOn(console, "warn").mockImplementation(() => {});
    await pruneFootprints(NOW);
    expect(db.footprints.map((row) => row.eventId)).toEqual(["recent"]);
  });
});

describe("sweepIfDue", () => {
  /**
   * Retention runs from the ingest path rather than a cron job, so the
   * throttle is what stops every request turning into a DELETE.
   */
  it("sweeps on the first call", async () => {
    footprintAgedDays(120, "old");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    sweepIfDue(NOW);
    await vi.waitFor(() => expect(db.footprints).toHaveLength(0));
  });

  it("does not sweep again straight away", async () => {
    const deleteMany = vi.spyOn(
      (await import("../support/fakePrisma")).prisma.footprint,
      "deleteMany",
    );

    sweepIfDue(NOW);
    await vi.waitFor(() => expect(deleteMany).toHaveBeenCalledTimes(1));

    sweepIfDue(NOW + 60_000);
    sweepIfDue(NOW + 10 * 60_000);
    expect(deleteMany).toHaveBeenCalledTimes(1);
  });

  it("sweeps again after an hour", async () => {
    const deleteMany = vi.spyOn(
      (await import("../support/fakePrisma")).prisma.footprint,
      "deleteMany",
    );

    sweepIfDue(NOW);
    await vi.waitFor(() => expect(deleteMany).toHaveBeenCalledTimes(1));

    // Retried until it takes: the first sweep's promise chain may not have
    // settled yet, and a sweep already in flight is skipped rather than queued.
    await vi.waitFor(() => {
      sweepIfDue(NOW + 61 * 60_000);
      expect(deleteMany).toHaveBeenCalledTimes(2);
    });
  });

  it("retries at the next opportunity when a sweep fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    failOnce(new Error("connection refused"));

    sweepIfDue(NOW);
    await vi.waitFor(() => expect(error).toHaveBeenCalled());

    // Not an hour's wait after a failure: the next request tries again.
    const deleteMany = vi.spyOn(
      (await import("../support/fakePrisma")).prisma.footprint,
      "deleteMany",
    );
    sweepIfDue(NOW + 1000);
    await vi.waitFor(() => expect(deleteMany).toHaveBeenCalled());
  });

  it("never throws at the caller", () => {
    failOnce(new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => sweepIfDue(NOW)).not.toThrow();
  });
});

describe("closed call records", () => {
  function sessionClosedDaysAgo(days: number | null, id: string) {
    db.activeSessions.push({
      avatarSessionId: id,
      sessionKey: `widget-${id}`,
      embedKeyValue: "pk_test",
      startedAt: new Date(NOW - (days ?? 0) * DAY),
      lastSeenAt: new Date(NOW - (days ?? 0) * DAY),
      endReason: null,
      deletedAt: days === null ? null : new Date(NOW - days * DAY),
    });
  }

  it("goes on the same clock as the footprints", async () => {
    sessionClosedDaysAgo(120, "old");
    sessionClosedDaysAgo(10, "recent");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await pruneFootprints(NOW);
    expect(db.activeSessions.map((row) => row.avatarSessionId)).toEqual(["recent"]);
  });

  it("never removes a call that is still running, however long it has run", async () => {
    // Null `deletedAt` means live. A marathon call is not an expired record.
    sessionClosedDaysAgo(null, "still-going");
    db.activeSessions[0]!.startedAt = new Date(NOW - 365 * DAY);

    await pruneFootprints(NOW);
    expect(db.activeSessions).toHaveLength(1);
  });

  it("counts them in what it reports removing", async () => {
    sessionClosedDaysAgo(120, "old");
    footprintAgedDays(120, "old-event");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(pruneFootprints(NOW)).resolves.toBe(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("closed call"));
  });
});
