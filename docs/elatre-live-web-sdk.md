# Switching to `@elatre/live-web-sdk`

The app currently uses `@heygen/liveavatar-web-sdk@0.0.20`. A rebranded copy of
that SDK lives in `packages/live-web-sdk` as `@elatre/live-web-sdk`. It is not
installed. This document covers how to switch to it, and what else is needed if
the vendor's name must not appear in the browser's network traffic either.

## What the Elatre package already does

- Same public API as the vendor SDK (`ElevenLabsAgentSession`, `SessionEvent`,
  `AgentEventsEnum`, and so on), so app code only changes its import path.
- Default API base URL is empty, which means same origin. It calls
  `/v1/sessions/start`, `/v1/sessions/stop` and `/v1/sessions/keep-alive` on
  the site that serves the page. `SessionConfig.apiUrl` still overrides this.
- No vendor names in `lib/` or `dist/`. Internal classes are renamed
  (`LiveAvatarSession` is `LiveSession`), and source maps and tests are left out.
- The two LiveKit participant IDs the vendor's servers use are stored
  base64-encoded and decoded at runtime. They must stay byte-for-byte the same
  or the SDK will not find the avatar's video tracks.
- `LICENSE` keeps the upstream MIT copyright line ("Portions copyright (c)
  HeyGen"). MIT requires it. Do not remove it. It is not part of the
  JavaScript the browser downloads.

The same-origin proxy it needs already exists:
`src/app/v1/sessions/[action]/route.ts`. It accepts only `start`, `stop` and
`keep-alive`, forwards the browser's bearer session token to
`LIVEAVATAR_API_URL`, and returns the upstream body unchanged. It is unused
while the vendor SDK is installed.

## Step 1: switch the dependency

1. In `package.json`, replace
   `"@heygen/liveavatar-web-sdk": "0.0.20"` with
   `"@elatre/live-web-sdk": "workspace:*"`.
2. Replace the import path `@heygen/liveavatar-web-sdk` with
   `@elatre/live-web-sdk` in:
   - `src/avatar/context.tsx`
   - `tests/components/avatar.test.tsx`
   - `tests/avatar/hooks.test.tsx`
   - `tests/avatar/hooksExtra.test.tsx`
3. Run `pnpm install` (outside any sandbox, since it rebuilds `node_modules`),
   then `pnpm typecheck`, `pnpm test`, `pnpm lint`.
4. Restart `pnpm dev` and start a real session. Confirm in the Network tab that
   `POST /v1/sessions/start` goes to your own origin and returns 200, and that
   the avatar video appears.

To check the bundle: run `pnpm build`, then
`rg -il "heygen|live.?avatar" .next/static .next/server/app/*.html`.
It should print nothing.

## Step 2 (optional): hide the video connection address

After step 1, the bundle is clean, but a live session still shows the vendor in
the Network tab. The session start response contains a `livekit_url` such as
`wss://heygen-xxxxxxxx.livekit.cloud`, and the SDK opens a WebSocket to
`<livekit_url>/rtc?access_token=...`. That hostname is HeyGen's project on
LiveKit Cloud and is decided by their servers, not by the SDK.

To hide it, put a WebSocket proxy on your own domain:

1. Pick a public address, e.g. `wss://<your-domain>/rtc`.
2. Run a proxy that forwards WebSocket upgrades (and the plain HTTPS
   `/rtc/validate` request LiveKit makes on connection failure) from that
   address to the real `livekit_url` host, preserving the path and query
   string. Options:
   - **nginx or Caddy** in front of the app. Requires a host you control.
   - **A custom Node server** (`server.ts` wrapping Next with a proxy on the
     `upgrade` event). Requires a VPS, Docker or similar; it does not run on
     Vercel.
   - **A Cloudflare Worker** on your domain that forwards the upgrade.

   A Next.js route handler cannot do this: route handlers do not support
   WebSocket upgrades.
3. The real host differs per project, not per session, but read it from each
   start response rather than hard-coding it. The simplest design: the proxy
   route in `src/app/v1/sessions/[action]/route.ts` rewrites
   `data.livekit_url` in the `start` response to your public address and
   passes the original host to the WebSocket proxy (for example as a signed
   query parameter or a short-lived server-side lookup keyed by room).
4. Verify in the Network tab that the `/rtc` WebSocket now goes to your domain.

The access token in the URL is a LiveKit JWT. Its payload holds the room id,
permissions and an `iss` key id. It contains no brand name and needs no change.

## What cannot be hidden

- **WebRTC media and relay servers.** Audio and video travel over WebRTC to
  LiveKit's media and TURN servers. Their hostnames and IPs appear in
  `chrome://webrtc-internals` and in ICE candidates, and may carry the same
  project prefix. Hiding those means running your own TURN servers and passing
  them via `SessionConfig.rtcConfig.iceServers`, which forces all media through
  your infrastructure and adds latency and bandwidth cost.
- **Participant names.** The vendor's server joins the room as `heygen` and
  `liveavatar-agent-<session id>`. Anyone inspecting LiveKit signaling messages
  will see them. Only the vendor can change these.
- **Server-side names.** `LIVEAVATAR_*` environment variables, `src/lib/env.ts`
  and `src/app/api/...` mention the vendor, but none of it is sent to the
  browser.

## Updating the Elatre package

`scripts/vendor-live-web-sdk.mjs` regenerates `packages/live-web-sdk` from an
installed upstream SDK:

```sh
node scripts/vendor-live-web-sdk.mjs node_modules/@heygen/liveavatar-web-sdk
```

It overwrites `lib/` and `dist/` (not `package.json` or `LICENSE`) and fails
if any vendor name survives. After an upstream upgrade, check that its renames
still match: the script replaces specific constants (`API_URL`, the participant
IDs) by exact text, so a changed upstream line will make the check fail rather
than silently ship the old value.
