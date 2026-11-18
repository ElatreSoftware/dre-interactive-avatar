# Spec: LiveAvatar × ElevenLabs Video Avatar Chat Widget

Status: **DRAFT — awaiting approval.** No code until approved.

## Assumptions I'm making

1. Greenfield — `/Users/elatreagency/dre-video-avatar` is empty and not a git repo. We create a fresh Next.js 15 (App Router) + React 19 + TypeScript project here.
2. You have (or will obtain) a **HeyGen LiveAvatar API key** (app.liveavatar.com/developers), an **avatar_id**, an **ElevenLabs API key on a paid plan** (free-tier keys are rejected by LiveAvatar) with scopes `convai_read`, `user_read`, `voices_read`, and an **ElevenLabs agent_id**.
3. The ElevenLabs agent's TTS output format and user input audio format are both set to **PCM 24000 Hz** (LiveAvatar requirement).
4. **Architecture: LiveAvatar LITE mode with the built-in ElevenLabs connector.** LiveAvatar's server connects to your ElevenLabs agent directly; agent audio drives lip-sync server-side. The browser never forwards audio between the two services. See "Key architectural decision" below — this differs from the "video from LiveAvatar, agent from ElevenLabs, wired in the client" framing in the request, and it is the only path both vendors document.
5. The widget is an **embeddable floating chat-style panel** (launcher bubble → expanding panel with avatar video + transcript + mic/mute/end controls), not a full-page experience.
6. Deployment target is Vercel/Node; secrets live in server-side env vars and never reach the browser.
7. Styling: Tailwind CSS v4. No component library (shadcn etc.) unless you want one.
8. Scope is the widget + a demo page. No auth, no persistence, no multi-tenancy, no analytics.

→ **Correct any of these now, or I proceed with them.**

## Objective

Build a reusable, embeddable React/TypeScript widget that gives a web page a **talking video avatar you can converse with**. The user clicks a launcher, grants mic access, and speaks; an ElevenLabs agent handles STT → LLM → TTS; a HeyGen LiveAvatar renders a lip-synced video stream of that speech. The user can **interrupt the avatar mid-sentence** (barge-in) and the avatar stops and listens.

Users: (a) end users on a marketing/support page talking to the avatar; (b) developers on this team dropping `<InteractiveAvatarWidget />` into any Next.js app with one provider and a few props.

Success = a developer can add the widget to a page in under 10 lines, and an end user can hold an interruptible spoken conversation with a visible avatar.

## Key architectural decision (please confirm)

The request describes wiring video from LiveAvatar to an agent from ElevenLabs. There are two ways to do that:

| | **A. LITE + ElevenLabs connector (recommended)** | **B. Client-side audio bridge** |
|---|---|---|
| Wiring | Server: LiveAvatar session token carries `elevenlabs_agent_config` (`secret_id` + `agent_id`). LiveAvatar's worker talks to ElevenLabs. | Browser runs `@elevenlabs/client` over WebSocket, intercepts base64 PCM `audio` events, pushes them to LiveAvatar via `repeatAudio()`. |
| SDK surface | `ElevenLabsAgentSession` from `@heygen/liveavatar-web-sdk` — purpose-built for this. | `LiveAvatarSession` + raw WS LITE session (`ws_url`). |
| Interruption | ElevenLabs barge-in VAD, server-side; surfaced as `elevenlabs_agent_event` → `interruption`. Avatar stops automatically. | We must hand-implement: catch `interruption`, flush our audio queue, call `session.interrupt()`. |
| Mic / audio | Handled by LiveAvatar's voice chat (LiveKit). One WebRTC connection. | Two audio pipelines to keep in sync; SDK chunking is Base64-length-sliced (not byte-accurate), a known rough edge. |
| Documented | Yes, by both vendors. | Not documented as a combination; `repeatAudio` requires a `ws_url` the ElevenLabs connector does not return. |
| Cost | 1 LiveAvatar credit/min + ElevenLabs usage. | Same. |

**I recommend A.** It is the only path where the SDK's `ElevenLabsAgentSession` class, `sendUserMessage`, `sendContextualUpdate`, `sendUserActivity`, `sendClientToolResult` and the `elevenlabs_agent_event` passthrough all work as shipped, and interruption is handled for us. B exists only if you need the agent audio in the browser for another reason (e.g. your own captions renderer or a non-HeyGen fallback). The component structure below keeps the transport behind a `AvatarTransport` interface so B can be added later without touching the UI.

## Tech Stack

- Next.js 15 (App Router, Turbopack), React 19, TypeScript 5 (strict)
- `@heygen/liveavatar-web-sdk` ^0.0.20 (pulls `livekit-client` 2.15.7)
- `@elevenlabs/react` — **only if we also need a client-side ElevenLabs connection** (option B, or client tools). Under option A it is not required; I'll omit it unless you say otherwise.
- Tailwind CSS v4, `clsx`
- Zod (env + API payload validation)
- Vitest + React Testing Library; Playwright for one smoke e2e
- ESLint (next/core-web-vitals) + Prettier

Note: the LiveAvatar SDK is at **0.0.20** — pre-1.0, and parts of its API are only documented in the shipped bundle. We pin exact versions and wrap it behind our own interface.

## Commands

```
Install:   pnpm install
Dev:       pnpm dev
Build:     pnpm build
Start:     pnpm start
Test:      pnpm test            # vitest run
Test watch:pnpm test:watch
Coverage:  pnpm test -- --coverage
E2E:       pnpm e2e             # playwright test
Lint:      pnpm lint            # next lint
Lint fix:  pnpm lint -- --fix
Types:     pnpm typecheck       # tsc --noEmit
Format:    pnpm format          # prettier --write .
```

## Project Structure

```
src/
  app/
    layout.tsx
    page.tsx                       → demo page mounting the widget
    api/
      avatar/session/route.ts      → POST: mint LiveAvatar session token (server-only secrets)
      avatar/secret/route.ts       → POST: one-time registration of the ElevenLabs key → secret_id
  components/
    avatar-widget/
      InteractiveAvatarWidget.tsx  → public entry; composes everything
      AvatarLauncher.tsx           → floating bubble
      AvatarPanel.tsx              → expanding chat panel shell
      AvatarVideo.tsx              → <video>, attach(), poster/idle state
      AvatarControls.tsx           → mic mute, volume, end call
      AvatarStatusBadge.tsx        → connecting / listening / speaking / error
      TranscriptList.tsx           → scrolling transcript
      TranscriptBubble.tsx         → single user/avatar message
      ConnectionQualityDot.tsx
    ui/                            → Button, IconButton, Spinner, VisuallyHidden
  providers/
    InteractiveAvatarProvider.tsx  → context provider; owns session lifecycle
    useInteractiveAvatar.ts        → consumer hook (throws outside provider)
  lib/
    avatar/
      transport.ts                 → AvatarTransport interface (A/B seam)
      liveAvatarTransport.ts       → ElevenLabsAgentSession implementation
      events.ts                    → SDK event names → typed app events
      reducer.ts                   → pure state machine (status, transcript, speaking)
    api/sessionClient.ts           → fetch wrapper for /api/avatar/session
    env.ts                         → zod-validated server env
    logger.ts
  types/
    avatar.ts                      → AvatarStatus, TranscriptEntry, AvatarError, config types
tests/                             → unit tests mirroring src/
e2e/                               → playwright specs
docs/                              → integration notes, env setup
```

## Code Style

Named exports, function components, props typed inline-or-interface, no default exports except Next.js route/page files. Side effects live in the provider; components are presentational and take props.

```tsx
// src/components/avatar-widget/AvatarVideo.tsx
import { useEffect, useRef } from "react";
import { useInteractiveAvatar } from "@/providers/useInteractiveAvatar";
import type { AvatarStatus } from "@/types/avatar";

interface AvatarVideoProps {
  className?: string;
  poster?: string;
}

export function AvatarVideo({ className, poster }: AvatarVideoProps) {
  const { attachVideo, status } = useInteractiveAvatar();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    return attachVideo(videoRef.current); // returns a detach cleanup
  }, [attachVideo]);

  return (
    <video
      ref={videoRef}
      poster={poster}
      autoPlay
      playsInline
      aria-label="AI avatar video"
      data-status={status satisfies AvatarStatus}
      className={className}
    />
  );
}
```

Conventions: `PascalCase.tsx` components, `camelCase.ts` modules, `use*` hooks, `is/has` booleans, `handle*` local handlers / `on*` props. Discriminated unions over boolean soup for state. No `any`; `unknown` + a type guard at every SDK boundary (the SDK's own types are incomplete at 0.0.20). Tailwind utilities in JSX; no CSS modules.

## Testing Strategy

- **Vitest + RTL**, tests in `tests/` mirroring `src/`.
- **Pure logic first:** `lib/avatar/reducer.ts` and `lib/avatar/events.ts` are plain functions and get full branch coverage — every SDK event → state transition, including interruption mid-utterance, disconnect reasons, and out-of-order `avatar.speak_ended`.
- **Components:** rendered against a `FakeAvatarTransport` implementing `AvatarTransport`. No network, no LiveKit, no mic. Assert status rendering, control wiring, transcript ordering, a11y roles/labels.
- **Route handlers:** tested with mocked `fetch`; assert no secret ever appears in the response body, and that upstream failures map to 5xx without leaking upstream text.
- **E2E (Playwright, 1 spec):** demo page loads, launcher opens the panel, widget reaches `connecting` with a stubbed session route. Real vendor calls are not in CI.
- **Coverage bar:** ≥90% on `src/lib/**`, ≥70% overall. Manual live-session checklist in `docs/` for the things CI cannot assert (lip sync, real barge-in latency, reconnect).

## Boundaries

**Always**
- Keep `LIVEAVATAR_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_SECRET_ID` server-side only; the browser receives a short-lived `session_token` and nothing else.
- Validate every env var and every API payload with zod at the boundary.
- Wrap all SDK access in `lib/avatar/*`; components and the provider never import `@heygen/liveavatar-web-sdk` directly.
- Run `pnpm typecheck && pnpm lint && pnpm test` before declaring a task done.
- Tear the session down on unmount, on `visibilitychange` → hidden beyond a grace period, and on `pagehide`; LITE sessions idle out at 5 minutes and bill per minute until stopped.
- Keyboard-reachable controls, visible focus, `aria-live` on status, `prefers-reduced-motion` respected.

**Ask first**
- Adding any dependency beyond those listed.
- Switching to option B (client-side audio bridge), or adding `@elevenlabs/react`.
- Anything that spends vendor credits from CI or from an automated test.
- Changing the public prop surface of `<InteractiveAvatarWidget />` after it is agreed.
- Enabling `autoKeepAlive` (it extends billed session time).

**Never**
- Commit API keys, `.env.local`, or a session token; `.env.example` holds placeholder names only.
- Call LiveAvatar or ElevenLabs REST endpoints from client code with a long-lived key.
- Silence a failing test, `@ts-ignore` an SDK type gap (write a type guard instead), or leave a `catch {}` empty.
- Log transcripts or audio anywhere but the browser console in dev.

## Success Criteria

1. `pnpm dev` → demo page; clicking the launcher opens the panel and, within ~5 s, shows live avatar video with `status === "connected"`.
2. Speaking into the mic produces a user transcript entry, then the avatar speaks the agent's reply with lip-synced video.
3. **Interruption:** speaking while the avatar is talking stops avatar speech within ~1 s, status returns to `listening`, the truncated reply is reflected in the transcript (via `agent_response_correction`), and the new user turn is answered. Verified manually against a live session and unit-tested at the reducer level.
4. Ending the call (button or unmount) calls stop, releases the mic, and emits `session.disconnected` with `CLIENT_INITIATED`; no orphaned billed session.
5. A developer integrates with:
   ```tsx
   <InteractiveAvatarProvider config={{ avatarId, sessionEndpoint: "/api/avatar/session" }}>
     <InteractiveAvatarWidget />
   </InteractiveAvatarProvider>
   ```
6. No secret is reachable from the browser (verified by a test asserting the route response shape, and by grepping the client bundle for key names).
7. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all pass clean; coverage bars met.
8. Errors (mic denied, token mint failure, avatar unavailable, no credits, idle timeout, max duration) each render a specific, non-technical message with a retry where retry makes sense.

## Open Questions

1. **Option A or B?** (see table). I recommend A.
2. Do you have the LiveAvatar key, avatar_id, ElevenLabs paid key and agent_id now, or should I build against a sandbox avatar (`is_sandbox: true`) and stub routes?
3. Should the ElevenLabs key → `secret_id` registration be a one-time script in `scripts/` rather than an API route? (An API route that registers a secret is a footgun if ever exposed.)
4. Is the floating-launcher chat widget the right shape, or do you want an inline/embedded panel, or both via a `variant` prop?
5. Text input alongside voice? `ElevenLabsAgentSession.sendUserMessage(text)` makes it cheap, and it also gives us `sendUserActivity()` to stop the agent talking over someone who is typing.
6. Does the widget need to be publishable as a standalone npm package / `<script>` embed later? That changes whether we build it as a workspace package from day one.
7. Any branding — avatar size, theme, light/dark, copy?
