# Implementation Plan — LiveAvatar × ElevenLabs Avatar Widget

Approved spec: [SPEC.md](../SPEC.md). Architecture: **Option A** — LiveAvatar LITE mode with the
built-in ElevenLabs connector. The browser holds one LiveKit/WebRTC session; LiveAvatar's worker
talks to the ElevenLabs agent server-side.

## Component dependency graph

```
env.ts ─┬─> api/avatar/session/route.ts ─┐
        └─> scripts/register-secret.ts   │
                                         ▼
types/avatar.ts ──> lib/avatar/transport.ts (interface)
                         │        │
                         │        └──> lib/avatar/fakeTransport.ts (tests)
                         ▼
                 lib/avatar/events.ts  (SDK event -> AvatarEvent, type guards)
                         ▼
                 lib/avatar/reducer.ts (pure state machine)
                         ▼
                 lib/avatar/liveAvatarTransport.ts (SDK adapter)
                         ▼
             providers/InteractiveAvatarProvider.tsx
                         ▼
   components/avatar-widget/* ──> app/page.tsx (demo)
```

Everything above `liveAvatarTransport.ts` is pure and testable without the SDK, a network, or a mic.
That is deliberate: the SDK is 0.0.20 and parts of its surface are only documented in the shipped
bundle, so all of it is wrapped and all of it is type-guarded at the boundary.

## Build order and rationale

1. **Scaffold** (Next 16 App Router, React 19, TS, Tailwind v4, Vitest, Playwright, ESLint/Prettier).
   Nothing else can be verified until `pnpm typecheck && pnpm test` runs.
2. **Types + env + transport interface.** Fixes the contract every later layer codes against.
   `AvatarTransport` is the seam that keeps Option B (client-side audio bridge) possible later.
3. **Pure core: `events.ts` + `reducer.ts`.** Written test-first. This is where interruption
   actually lives, so it gets the most coverage.
4. **Server routes.** `/api/avatar/session` mints the short-lived session token. Secret registration
   is a one-time **script**, not a route (open question 3 in the spec — an endpoint that registers a
   provider secret is a footgun if ever exposed).
5. **SDK adapter.** `liveAvatarTransport.ts` implements `AvatarTransport` over
   `ElevenLabsAgentSession`. Isolated so a vendor bump touches one file.
6. **Provider.** Owns lifecycle: mint token → start → attach → teardown. Dispatches into the reducer.
7. **Components.** Presentational, prop-driven, tested against the fake transport.
8. **Demo page, docs, env example.**
9. **Verification sweep:** typecheck, lint, unit, build, e2e smoke.

## Parallel vs sequential

- Sequential spine: 1 → 2 → 3 → 5 → 6 → 7.
- Can run alongside: server routes (4) are independent of the pure core; the UI primitives in
  `components/ui/` and the docs (8) depend on nothing.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| SDK 0.0.20 is pre-1.0; `.d.ts` for `LiveAvatarSession` is incomplete | Pin the exact version. Wrap in `AvatarTransport`. Type-guard every event payload; never trust a field exists. |
| Avatar commands for the ElevenLabs connector are not fully documented (e.g. whether `avatar.interrupt` is honoured) | Rely on ElevenLabs' server-side barge-in as the primary interrupt path. Expose `interrupt()` as a best-effort secondary and never let it throw into the UI. |
| `attach()` attaches the remote **audio** track as well as video | Single `<video>` element carries both — that is correct here, since LiveAvatar is the only audio source in Option A. Expose `volume`/`mute` on the element rather than detaching tracks. |
| Sessions bill per minute and idle out at 5 min | Teardown on unmount, `pagehide`, and prolonged `visibilitychange: hidden`. `autoKeepAlive` stays off. |
| Live vendor calls in CI would burn credits | No vendor network in unit or e2e tests; the session route is stubbed. Live checks are a manual checklist in `docs/`. |
| Interruption is only truly verifiable against a live session | Reducer-level unit tests for every ordering; manual checklist for latency and lip-sync. |

## Verification checkpoints

- After 3: `pnpm test` green with full branch coverage on the reducer, no UI yet.
- After 5: `pnpm typecheck` green with the real SDK types resolved.
- After 7: `pnpm test` green including component tests; `pnpm build` succeeds.
- After 9: all gates green; manual live-session checklist handed over.
