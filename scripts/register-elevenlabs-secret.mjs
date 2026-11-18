#!/usr/bin/env node
/**
 * One-time setup: hand your ElevenLabs API key to LiveAvatar and get back a
 * `secret_id` to put in LIVEAVATAR_ELEVENLABS_SECRET_ID.
 *
 * This is a script rather than an API route on purpose. An HTTP endpoint that
 * registers a provider secret is a liability if it is ever reachable; you only
 * need to do this once per key.
 *
 *   LIVEAVATAR_API_KEY=... ELEVENLABS_API_KEY=... node scripts/register-elevenlabs-secret.mjs
 *
 * The ElevenLabs key must be on a PAID plan (free-tier keys are rejected) and
 * carry the scopes: convai_read, user_read, voices_read.
 */

const apiUrl = process.env.LIVEAVATAR_API_URL ?? "https://api.liveavatar.com";
const liveAvatarKey = process.env.LIVEAVATAR_API_KEY;
const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
const secretName = process.env.SECRET_NAME ?? "elevenlabs-agent-key";

if (!liveAvatarKey || !elevenLabsKey) {
  console.error("Set LIVEAVATAR_API_KEY and ELEVENLABS_API_KEY, then re-run.");
  process.exit(1);
}

const response = await fetch(`${apiUrl}/v1/secrets`, {
  method: "POST",
  headers: { "content-type": "application/json", "X-Api-Key": liveAvatarKey },
  body: JSON.stringify({
    secret_type: "ELEVENLABS_API_KEY",
    secret_value: elevenLabsKey,
    secret_name: secretName,
  }),
});

const body = await response.json().catch(() => null);

if (!response.ok) {
  console.error(`Registration failed (${response.status}):`, body);
  process.exit(1);
}

const secretId = body?.data?.secret_id ?? body?.secret_id;
if (!secretId) {
  console.error("No secret_id in the response. Full body:", body);
  process.exit(1);
}

console.warn("\nSecret registered. Add this to .env.local:\n");
console.warn(`LIVEAVATAR_ELEVENLABS_SECRET_ID=${secretId}\n`);
