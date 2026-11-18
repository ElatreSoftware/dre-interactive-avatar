import { randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * Server-only configuration. Importing this from a client component is a build
 * error by design — these values must never reach the browser.
 */
const serverEnvSchema = z.object({
  LIVEAVATAR_API_KEY: z.string().min(1, "LIVEAVATAR_API_KEY is required"),
  /**
   * The id LiveAvatar gave you when you registered your ElevenLabs API key.
   * Obtain it once with `pnpm register:secret`.
   */
  LIVEAVATAR_ELEVENLABS_SECRET_ID: z.string().min(1, "LIVEAVATAR_ELEVENLABS_SECRET_ID is required"),
  ELEVENLABS_AGENT_ID: z.string().min(1, "ELEVENLABS_AGENT_ID is required"),
  LIVEAVATAR_API_URL: z.string().url().default("https://api.liveavatar.com"),
  LIVEAVATAR_DEFAULT_AVATAR_ID: z.string().optional(),
  /**
   * Signs the short-lived embed grant. Optional in the schema so an existing
   * development setup keeps starting; `getGrantSecret()` is where the
   * production requirement is enforced.
   */
  EMBED_GRANT_SECRET: z
    .string()
    .min(32, "EMBED_GRANT_SECRET must be at least 32 characters")
    .optional(),
  /** Footprints. All optional: the widget works with telemetry switched off. */
  FOOTPRINTS_ENABLED: z.enum(["true", "false"]).optional(),
  FOOTPRINTS_DIR: z.string().optional(),
  FOOTPRINTS_RETENTION_DAYS: z.coerce.number().int().positive().optional(),
  FOOTPRINT_TRANSCRIPTS: z.enum(["true", "false"]).optional(),
  IP_HASH_SALT: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/**
 * Validated once per process. Throws a message naming every missing variable,
 * rather than failing later with an opaque 401 from the vendor.
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid server environment. Check: ${missing}. See .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

let developmentSecret: string | null = null;

/**
 * The secret used to sign embed grants.
 *
 * In production this must be configured: a predictable signing key means
 * anyone can mint a grant for any origin, which is the whole point of the
 * grant. While developing, a random per-process secret is generated instead,
 * so `pnpm dev` works out of the box. Restarting invalidates outstanding
 * grants, which is harmless — they live ten minutes.
 */
export function getGrantSecret(): string {
  // Read directly rather than through `getServerEnv()`: signing a grant has
  // nothing to do with the vendor keys, and a page that only needs a grant
  // should not fail because an unrelated variable is missing.
  const configured = process.env.EMBED_GRANT_SECRET;
  if (configured) {
    if (configured.length < 32) {
      throw new Error("EMBED_GRANT_SECRET must be at least 32 characters. See .env.example.");
    }
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("EMBED_GRANT_SECRET is required in production. See .env.example.");
  }

  if (!developmentSecret) {
    developmentSecret = randomBytes(32).toString("hex");
    console.warn(
      "[env] EMBED_GRANT_SECRET is not set; using a random development secret. " +
        "Embed grants will not survive a restart.",
    );
  }
  return developmentSecret;
}

/** Test helper: forget the memoised env. */
export function resetServerEnvCache(): void {
  cached = null;
  developmentSecret = null;
}
