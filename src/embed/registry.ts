import { prisma } from "@/lib/db";
import { originAllowed } from "./originMatch";

/**
 * The embed key registry, read from the database.
 *
 * Embed keys are *public* — they ship in the customer's page source. They say
 * who an embed claims to be; the origin allowlist is what makes the claim
 * worth anything.
 *
 * Cached briefly rather than per request: the key is looked up on the embed
 * document, on every session mint and on every footprint batch, and those are
 * the same handful of rows. The TTL is also why adding or disabling a key now
 * takes effect on its own — within thirty seconds — instead of needing a
 * restart, which is what the file-backed version demanded.
 */

export const INTERNAL_EMBED_KEY = "internal_self";

const CACHE_TTL_MS = 30_000;

export interface EmbedKeyRecord {
  key: string;
  name: string;
  enabled: boolean;
  avatarId: string;
  allowedOrigins: string[];
  dynamicVariables?: Record<string, string>;
  /** When the key stops working. Null means never. */
  expiresAt: Date | null;
  /** Calls allowed at once. Null means no limit. */
  maxConcurrentSessions: number | null;
  /** True for the reserved key our own first-party page uses. */
  internal: boolean;
}

interface Cache {
  loadedAt: number;
  byKey: Map<string, EmbedKeyRecord>;
}

let cache: Cache | null = null;
let inFlight: Promise<Cache> | null = null;

/**
 * The reserved key our own `/` page embeds with, so the session route has one
 * authorisation path instead of an "embedded" branch and a "not embedded"
 * branch. It is not a customer, so it is not a row.
 */
function internalRecord(): EmbedKeyRecord {
  return {
    key: INTERNAL_EMBED_KEY,
    name: "First-party page",
    enabled: true,
    avatarId: process.env.NEXT_PUBLIC_AVATAR_ID ?? "",
    allowedOrigins: [],
    expiresAt: null,
    maxConcurrentSessions: null,
    internal: true,
  };
}

function toRecord(row: {
  key: string;
  name: string;
  enabled: boolean;
  avatarId: string;
  allowedOrigins: string[];
  dynamicVariables: unknown;
  expiresAt: Date | null;
  maxConcurrentSessions: number | null;
}): EmbedKeyRecord {
  const variables =
    row.dynamicVariables && typeof row.dynamicVariables === "object"
      ? (row.dynamicVariables as Record<string, string>)
      : undefined;

  return {
    key: row.key,
    name: row.name,
    enabled: row.enabled,
    avatarId: row.avatarId,
    allowedOrigins: row.allowedOrigins,
    ...(variables ? { dynamicVariables: variables } : {}),
    expiresAt: row.expiresAt,
    maxConcurrentSessions: row.maxConcurrentSessions,
    internal: false,
  };
}

async function load(): Promise<Cache> {
  const rows = await prisma.embedKey.findMany({ where: { enabled: true } });

  const byKey = new Map<string, EmbedKeyRecord>();
  for (const row of rows) byKey.set(row.key, toRecord(row));
  byKey.set(INTERNAL_EMBED_KEY, internalRecord());

  return { loadedAt: Date.now(), byKey };
}

async function getCache(): Promise<Cache> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;

  // Concurrent requests share one refresh rather than each opening their own.
  inFlight ??= load()
    .then((fresh) => {
      cache = fresh;
      return fresh;
    })
    .finally(() => {
      inFlight = null;
    });

  try {
    return await inFlight;
  } catch (error) {
    // A database blip should not take embedding down with it: serve the stale
    // cache if we have one, and fail closed only when we have nothing.
    console.error("[embed] could not load the key registry:", error);
    if (cache) return cache;
    return { loadedAt: 0, byKey: new Map([[INTERNAL_EMBED_KEY, internalRecord()]]) };
  }
}

/** True when the key has passed its expiry date. */
export function hasExpired(record: EmbedKeyRecord, now: number = Date.now()): boolean {
  return record.expiresAt !== null && record.expiresAt.getTime() <= now;
}

/** The record for a usable key, or `null` for unknown, disabled or expired. */
export async function findEmbedKey(key: string | undefined | null): Promise<EmbedKeyRecord | null> {
  if (!key) return null;
  const { byKey } = await getCache();
  const record = byKey.get(key);
  if (!record || !record.enabled) return null;
  // Checked here rather than in the query: a key cached a moment before its
  // expiry must not keep working until the cache happens to refresh.
  if (hasExpired(record)) return null;
  return record;
}

/**
 * Whether `origin` may embed `record`.
 *
 * The internal key trusts `selfOrigin` — the origin this very request arrived
 * at — because our own page is served from it and nothing else is.
 */
export function embedOriginAllowed(
  record: EmbedKeyRecord,
  origin: string,
  selfOrigin?: string,
): boolean {
  if (record.internal) return Boolean(selfOrigin) && origin === selfOrigin;
  return originAllowed(origin, record.allowedOrigins);
}

/** Test helper, and what a key change calls to take effect immediately. */
export function resetRegistryCache(): void {
  cache = null;
  inFlight = null;
}
