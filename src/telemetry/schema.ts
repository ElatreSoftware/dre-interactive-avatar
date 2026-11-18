import { z } from "zod";

/**
 * The footprint schema — the single source of truth for what a session
 * records. Types are inferred from it so the browser and the server can never
 * drift apart.
 *
 * Versioned from the start: these files are append-only and will outlive
 * several shapes of this union, so a reader must be able to tell which shape
 * it is looking at.
 */

export const FOOTPRINT_VERSION = 1;

/** Text is capped before it reaches disk; see `redact.ts`. */
export const MAX_TEXT_LENGTH = 2000;

const sender = z.enum(["user", "avatar"]);

const sessionEndReason = z.enum([
  "client",
  "page_hidden",
  "mic_denied",
  "token_failed",
  "session_start_failed",
  "no_credits",
  "idle_timeout",
  "max_duration",
  "avatar_unavailable",
  "agent_hung_up",
  "connection_lost",
  "unknown",
]);

/** Emitted once per session, carrying everything we know about the embed. */
const embedContext = z.object({
  type: z.literal("widget_loaded"),
  referrer: z.string().max(500).optional(),
  locale: z.string().max(35).optional(),
  timezone: z.string().max(60).optional(),
  viewport: z.object({ width: z.number().int(), height: z.number().int() }).optional(),
  deviceClass: z.enum(["desktop", "tablet", "mobile"]).optional(),
  /** An opaque id the embedder attached. Never interpreted, never parsed. */
  userId: z.string().max(200).optional(),
});

const simpleLifecycle = z.object({
  type: z.enum([
    "widget_opened",
    "widget_closed",
    "mic_requested",
    "mic_granted",
    "session_requested",
    "stream_ready",
    "avatar_speak_started",
    "avatar_speak_ended",
    "user_speak_started",
    "user_speak_ended",
    "interruption",
  ]),
});

const micRefused = z.object({
  type: z.literal("mic_refused"),
  reason: z.enum(["denied", "unavailable", "blocked_by_embedder"]),
});

const sessionStarted = z.object({
  type: z.literal("session_started"),
  avatarSessionId: z.string().max(200).optional(),
});

const sessionEnded = z.object({
  type: z.literal("session_ended"),
  reason: sessionEndReason,
  durationMs: z.number().int().nonnegative(),
  turns: z.number().int().nonnegative(),
  interruptions: z.number().int().nonnegative(),
});

const muteToggled = z.object({ type: z.literal("mute_toggled"), isMuted: z.boolean() });

const connectionQuality = z.object({
  type: z.literal("connection_quality_changed"),
  quality: z.enum(["unknown", "good", "bad"]),
});

const transcriptTurn = z.object({
  type: z.literal("transcript_turn"),
  sender,
  text: z.string().max(MAX_TEXT_LENGTH),
  isTyped: z.boolean(),
  wasInterrupted: z.boolean(),
  charCount: z.number().int().nonnegative(),
});

const errorEvent = z.object({
  type: z.literal("error"),
  code: z.string().max(60),
  message: z.string().max(300),
});

export const footprintPayload = z.discriminatedUnion("type", [
  embedContext,
  simpleLifecycle,
  micRefused,
  sessionStarted,
  sessionEnded,
  muteToggled,
  connectionQuality,
  transcriptTurn,
  errorEvent,
]);

export type FootprintPayload = z.infer<typeof footprintPayload>;
export type FootprintType = FootprintPayload["type"];

/** What the browser sends. Everything here is a claim until the server checks it. */
export const footprintEvent = z.intersection(
  z.object({
    v: z.literal(FOOTPRINT_VERSION),
    /** Client-generated; makes a replayed batch identifiable. */
    id: z.string().min(8).max(64),
    /** Monotonic within a widget session, so a late beacon still orders. */
    seq: z.number().int().nonnegative(),
    /** Ours, from widget load — before any vendor session exists. */
    sessionKey: z.string().min(8).max(64),
    clientTs: z.number().int().nonnegative(),
  }),
  footprintPayload,
);

export type FootprintEvent = z.infer<typeof footprintEvent>;

export const MAX_BATCH_SIZE = 50;

export const footprintBatch = z.object({
  events: z.array(footprintEvent).min(1).max(MAX_BATCH_SIZE),
});

export type FootprintBatch = z.infer<typeof footprintBatch>;

/**
 * What the server adds, and what it will not take the client's word for.
 * These names deliberately differ from the client's (`receivedAt` vs
 * `clientTs`) so a reader is never in doubt about which clock a timestamp came
 * from.
 */
export interface ServerStamp {
  receivedAt: number;
  embedKey: string;
  parentOrigin: string;
  ipHash: string;
  userAgent: string;
}

export type StoredFootprint = FootprintEvent & ServerStamp;
