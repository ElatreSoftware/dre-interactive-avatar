# Interactive Avatar Widget

A reusable Next.js + TypeScript widget for a **full-screen video call with a talking avatar you
can interrupt**. Video comes from **HeyGen LiveAvatar**; the conversation (STT → LLM → TTS) comes
from an **ElevenLabs agent**.

## Quick start

```bash
pnpm install
cp .env.example .env         # then fill it in — see docs/integration.md
pnpm db:migrate              # create the tables on whatever DATABASE_URL points at
pnpm dev
```

`DATABASE_URL` points at the shared development server. `pnpm db:up` starts a
local Postgres from `docker-compose.yml` instead, for working offline — point
`DATABASE_URL` at it if you do.

```tsx
<AvatarProvider config={{ avatarId: "your-avatar-id" }}>
  <InteractiveAvatar title="Dr E" />
</AvatarProvider>
```

That is the whole integration.

## How it works

**LiveAvatar LITE mode with the built-in ElevenLabs connector.** Your server mints a session token
carrying the agent config; LiveAvatar's worker talks to your ElevenLabs agent and lip-syncs its
audio server-side. The browser holds one WebRTC connection and bridges no audio — which is why
barge-in works with no client-side audio queue. See [docs/integration.md](docs/integration.md).

## The hooks

`src/liveavatar/` follows the layout of the official SDK demo's `src/liveavatar` folder: a context
provider holding the session, with focused hooks on top. Nothing outside this folder imports the
vendor SDK.

| Hook | Gives you |
|---|---|
| `useSession()` | `status`, `isStreamReady`, `connectionQuality`, `error`, `startSession`, `stopSession`, `attachElement`, `keepAlive` |
| `useVoiceChat()` | `isMuted`, `isUserTalking`, `isAvatarTalking`, `mute`, `unmute`, `toggleMute`, `setDevice` |
| `useTextChat()` | `sendMessage`, `sendContextualUpdate`, `notifyUserActivity` |
| `useAvatarActions()` | `interrupt`, `startListening`, `stopListening` |
| `useChatHistory()` | the `LiveAvatarMessage[]` transcript |
| `useMicrophoneDevices()` | `devices`, `selectedDeviceId`, `selectDevice` |

Three deliberate departures from the reference demo, all of them bug fixes:

1. The demo builds a session on every render (`useRef(new LiveAvatarSession(...))`). We build one
   lazily, once per connect.
2. Only its chat-history effect unsubscribes, so StrictMode double-subscribes the rest. Every
   effect here cleans up.
3. On disconnect it calls `removeAllListeners()`, which silently kills transcripts on reconnect.
   We create a fresh session per connect instead.

And one behaviour fix: **typed messages appear in the transcript.** A typed message produces no
transcription event, so a UI that waits for one will answer it but never show it. `sendMessage`
appends it locally.

## Structure

| Path | What lives there |
|---|---|
| `src/avatar/` | Session layer: provider + hooks. **The only place the vendor SDK is imported.** |
| `src/avatar/chatHistory.ts` | Transcript as a pure reducer — streaming, interruption, audio-tag stripping |
| `src/avatar/events.ts` | Vendor payloads → typed events (pure) |
| `src/components/avatar/` | Presentational components, each reading the session through hooks |
| `src/app/api/avatar/session/` | Token minting; the only place secrets are used |
| `src/embed/` | Embedding: key registry, origin matching, grants, host↔iframe protocol |
| `src/app/embed/[embedKey]/` | The embeddable document customers frame |
| `src/proxy.ts` | Per-key `frame-ancestors` — who may frame the widget |
| `public/embed.js` | The loader customers paste into their page |
| `src/telemetry/` | Session footprints: schema, collector, store, retention. Nothing in `src/avatar/` imports it |
| `prisma/schema.prisma` | Embed keys and footprints. The only place anything is stored |
| `src/lib/db.ts` | The Prisma client singleton |
| `certs/` | AWS RDS CA bundle, for verified TLS to a managed database |

## Commands

```bash
pnpm dev         pnpm build        pnpm start
pnpm test        pnpm typecheck    pnpm lint
pnpm e2e         pnpm register:secret
pnpm footprints:prune              pnpm footprints:tail
pnpm footprints:check              pnpm embed:key
pnpm db:up       pnpm db:migrate   pnpm db:studio   pnpm embed:keys
```

## Docs

- [Integration guide](docs/integration.md) — setup, props, hooks, interruption, theming
- [Embedding guide](docs/embedding.md) — the script tag, embed keys, origin allowlists, operating the service
- [Footprints](docs/footprints.md) — what each session records, jq recipes, retention and privacy
- [Live-session checklist](docs/live-session-checklist.md) — what to verify by hand
- [SPEC.md](SPEC.md) · [tasks/plan.md](tasks/plan.md)
- [SPEC-embed.md](SPEC-embed.md) · [tasks/plan-embed.md](tasks/plan-embed.md) · [CAPABILITY-MAP.md](CAPABILITY-MAP.md)
