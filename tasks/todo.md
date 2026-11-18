# Tasks

- [x] T1: Scaffold Next.js 16 + React 19 + TS + Tailwind v4 + Vitest + ESLint/Prettier
  - Acceptance: `pnpm dev` serves a page; `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all pass on an empty suite
  - Verify: run all four commands
  - Files: package.json, tsconfig.json, next.config.ts, postcss.config.mjs, vitest.config.ts, eslint.config.mjs, .prettierrc, src/app/{layout,page}.tsx, src/app/globals.css

- [x] T2: Domain types, env validation, transport interface
  - Acceptance: `AvatarStatus`, `TranscriptEntry`, `AvatarError`, `AvatarEvent`, `AvatarTransport`, zod-validated server env
  - Verify: `pnpm typecheck`
  - Files: src/types/avatar.ts, src/lib/env.ts, src/lib/avatar/transport.ts

- [x] T3: Event mapping + reducer (test-first)
  - Acceptance: every SDK event maps to a typed `AvatarEvent` or is ignored; reducer covers connect, transcripts, speak start/end, interruption, correction, disconnect reasons, out-of-order events
  - Verify: `pnpm test` with >=90% branch coverage on these two files
  - Files: src/lib/avatar/events.ts, src/lib/avatar/reducer.ts, tests/lib/avatar/{events,reducer}.test.ts

- [x] T4: Session token route + secret registration script
  - Acceptance: POST /api/avatar/session returns `{ sessionId, sessionToken }` only; upstream failures map to 5xx with no upstream text leaked; script registers the ElevenLabs key and prints a secret_id
  - Verify: `pnpm test` route tests with mocked fetch
  - Files: src/app/api/avatar/session/route.ts, src/lib/api/sessionClient.ts, scripts/register-elevenlabs-secret.mjs, tests/app/api/session.test.ts

- [x] T5: LiveAvatar SDK adapter
  - Acceptance: `createLiveAvatarTransport()` implements `AvatarTransport` over `ElevenLabsAgentSession`; no SDK import anywhere else in src/
  - Verify: `pnpm typecheck`; `grep -r liveavatar-web-sdk src/` returns exactly one file
  - Files: src/lib/avatar/liveAvatarTransport.ts

- [x] T6: InteractiveAvatarProvider + useInteractiveAvatar
  - Acceptance: provider mints a token, starts the session, exposes `attachVideo` returning a cleanup, and tears down on unmount/pagehide/hidden; hook throws a clear error outside the provider
  - Verify: `pnpm test` provider tests against the fake transport
  - Files: src/providers/InteractiveAvatarProvider.tsx, src/providers/useInteractiveAvatar.ts, src/lib/avatar/fakeTransport.ts, tests/providers/provider.test.tsx

- [x] T7: Widget components
  - Acceptance: launcher, panel, video, controls, status badge, transcript render correctly for every status; keyboard reachable; `aria-live` status; reduced-motion respected
  - Verify: `pnpm test` component tests
  - Files: src/components/avatar-widget/*.tsx, src/components/ui/*.tsx, tests/components/*

- [x] T8: Demo page, docs, .env.example
  - Acceptance: demo page mounts the widget with <10 lines of integration code; docs cover env setup and the manual live-session checklist
  - Verify: `pnpm build`; read docs
  - Files: src/app/page.tsx, docs/integration.md, docs/live-session-checklist.md, .env.example, README.md

- [x] T9: Verification sweep
  - Acceptance: typecheck, lint, test (coverage bars met), build all green
  - Verify: run them
  - Files: none
