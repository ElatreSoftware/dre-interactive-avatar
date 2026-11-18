# Integrating the avatar widget

## How the pieces fit

```
Browser                         Your Next.js server           Vendors
───────                         ───────────────────           ───────
InteractiveAvatarWidget
  └─ InteractiveAvatarProvider
       └─ liveAvatarTransport  ──POST /api/avatar/session──>  LiveAvatar
            │                      (LIVEAVATAR_API_KEY +      /v1/sessions/token
            │                       secret_id + agent_id)
            │
            └── LiveKit / WebRTC ────────────────────────────> LiveAvatar worker
                 (video + audio, mic up)                            │
                                                                    └──> ElevenLabs agent
                                                                         (STT → LLM → TTS)
```

**LITE mode with the ElevenLabs connector.** LiveAvatar's worker holds the conversation with your
ElevenLabs agent and lip-syncs its audio server-side. The browser keeps one connection and never
bridges audio between the two vendors. That is what makes interruption work without any client-side
audio queue: the agent's own barge-in VAD cuts the avatar off as soon as the user speaks.

## One-time setup

1. **LiveAvatar key** — https://app.liveavatar.com/developers → `LIVEAVATAR_API_KEY`.
2. **ElevenLabs agent** — create one, note its id → `ELEVENLABS_AGENT_ID`.
   In the agent settings set **both**:
   - Voice → TTS output format: **PCM 24000 Hz**
   - Advanced → User input audio format: **PCM 24000 Hz**

   LiveAvatar requires 24 kHz on both sides. A mismatch gives you a connected session with no
   lip sync and no audio, which is a miserable thing to debug.
3. **ElevenLabs key** — must be on a **paid plan** (free-tier keys are rejected by LiveAvatar) with
   the scopes `convai_read`, `user_read`, `voices_read`.
4. **Register the key with LiveAvatar** — once:

```bash
LIVEAVATAR_API_KEY=xxx ELEVENLABS_API_KEY=yyy pnpm register:secret
```

   Put the printed id in `LIVEAVATAR_ELEVENLABS_SECRET_ID`.
5. Copy `.env.example` to `.env.local` and fill it in.

## Using it

```tsx
import { InteractiveAvatarWidget } from "@/components/avatar-widget";
import { InteractiveAvatarProvider } from "@/providers/InteractiveAvatarProvider";

<InteractiveAvatarProvider config={{ avatarId: "your-avatar-id" }}>
  <InteractiveAvatarWidget title="Dre" />
</InteractiveAvatarProvider>;
```

### Provider config

| Option | Default | What it does |
|---|---|---|
| `avatarId` | — | **Required.** The LiveAvatar avatar to render. |
| `sessionEndpoint` | `/api/avatar/session` | Your token-minting route. |
| `isSandbox` | `false` | Use LiveAvatar's free sandbox avatar. |
| `startMuted` | `false` | Join with the mic muted (text-first). |
| `dynamicVariables` | — | Values interpolated into the agent's prompt. |
| `teardownAfterHiddenMs` | `60000` | Drop the session after the tab stays hidden. `0` disables. |

### Widget props

| Prop | Default | What it does |
|---|---|---|
| `title` | `"AI Assistant"` | Panel heading and accessible name. |
| `autoStart` | `true` | Connect as soon as the panel opens. |
| `allowTextInput` | `true` | Show the text composer next to voice. |
| `showTranscript` | `true` | Show the transcript panel beside the avatar, plus its toggle in the call bar. |
| `poster` | — | Still frame shown before the stream arrives. |
| `launcherLabel` | `"Start video call"` | Accessible name for the corner button. |

### Building your own layout

The widget is a composition, not a black box. Every piece is exported and prop-driven:

```tsx
<InteractiveAvatarProvider config={{ avatarId }}>
  <MyLayout>
    <AvatarVideo className="h-[60vh] w-full rounded-2xl" />
    <AvatarStatusBadge status={status} />
    <TranscriptPanel entries={transcript} />
    <AvatarControls allowTextInput={false} />
  </MyLayout>
</InteractiveAvatarProvider>
```

The hooks are listed in the [README](../README.md#the-hooks). Each reads the session from
`LiveAvatarProvider`, so components stay presentational.

## How interruption works

Three things happen when a user talks over the avatar:

1. **ElevenLabs' VAD detects barge-in** and stops generating. This is server-side; nothing in the
   browser triggers it.
2. An **`interruption`** event arrives through LiveAvatar's `elevenlabs_agent_event` passthrough.
   We mark the avatar's current transcript entry as cut off and go back to `listening`.
3. An **`agent_response_correction`** follows with `corrected_agent_response` — the text that was
   *actually* spoken before the cut. We replace the optimistic text with it, so the transcript
   matches what the user heard rather than what the model had planned to say.

There is no `onInterruption` callback in either SDK; the passthrough is the only signal. The
mapping lives in [`src/lib/avatar/events.ts`](../src/lib/avatar/events.ts) and the state machine in
[`src/lib/avatar/reducer.ts`](../src/lib/avatar/reducer.ts), both fully unit-tested.

The **stop button** is a separate, manual path (`session.interrupt()`). LiveAvatar does not document
`avatar.interrupt` for the ElevenLabs connector, so treat it as best-effort — the UI updates
optimistically either way. Speaking is the reliable way to interrupt.

## Swapping the transport

`AvatarTransport` in `src/lib/avatar/transport.ts` is the seam. If you ever need the agent's audio
in the browser (custom captions, a non-HeyGen fallback), write a second class implementing
`AvatarTransport` (alongside `LiveAvatarTransport`) that runs `@elevenlabs/client` over WebSocket
and pumps base64 PCM into `LiveAvatarSession.repeatAudio()`, and pass its factory as
`transportFactory`. No component changes. Be warned: that path needs a `ws_url` the
ElevenLabs connector does not return, so it means two separate sessions and a hand-rolled audio
queue — and the SDK's own chunker slices Base64 by character count, not bytes, so its "1 second"
chunks are really about 0.75s.

## Cost and teardown

LITE sessions bill **1 credit/minute** and idle out after **5 minutes**. The provider stops the
session on unmount, on `pagehide`, and after the tab stays hidden past `teardownAfterHiddenMs`.
`autoKeepAlive` is deliberately **off** — turning it on extends a billed session indefinitely.

## Troubleshooting

The session route returns a generic 502 on purpose — upstream text can name internal services and
quota details. **In development it also includes a `detail` field** carrying LiveAvatar's actual
message, which is usually the whole answer. In production only the generic message is sent.

| What you see | Cause | Fix |
|---|---|---|
| `"This avatar is not supported in sandbox mode"` | `isSandbox: true` with a real avatar id | Drop `isSandbox`. It is only for LiveAvatar's free sandbox avatars. |
| `"...has TTS output audio format 'pcm_16000', but 'pcm_24000' is required"` | The ElevenLabs agent is at the default 16 kHz | In the ElevenLabs dashboard → your agent → **Voice → TTS output format → PCM 24000 Hz**. Also set **Advanced → User input audio format → PCM 24000 Hz**. |
| 502 with no `detail` | The upstream was unreachable | Check `LIVEAVATAR_API_URL` and your network. |
| 500 `"not configured"` | A missing env var | Compare `.env.local` against `.env.example`. |
| Connects, but no audio and no lip sync | Input audio format is not 24 kHz | Set **User input audio format** to PCM 24000 Hz too. |

To check your configuration without going through the browser:

```bash
curl -s -X POST https://api.liveavatar.com/v1/sessions/token \
  -H "X-API-KEY: $LIVEAVATAR_API_KEY" -H 'content-type: application/json' \
  -d "{\"mode\":\"LITE\",\"avatar_id\":\"$NEXT_PUBLIC_AVATAR_ID\",\"elevenlabs_agent_config\":{\"secret_id\":\"$LIVEAVATAR_ELEVENLABS_SECRET_ID\",\"agent_id\":\"$ELEVENLABS_AGENT_ID\"}}"
```

A `code: 1000` with a `session_token` means your wiring is correct.

## Theming

The palette lives in `src/app/globals.css` as Tailwind v4 `@theme` tokens. `--color-brand-950`
(`#09053A`) is the anchor; `brand-50` through `brand-900` are tints of it used for surfaces,
borders and muted text, so the UI reads as one family rather than navy pasted onto grey. To
rebrand, change the brand scale and `--color-canvas` — no component edits needed.

Layout: the stage is a centred modal (`AvatarStage`) that locks background scrolling while open.
The avatar uses `object-contain` on a `brand-950` backdrop rather than `object-cover`, because
cropping a person's face to fill a box looks worse than letterboxing around it. The transcript is
its own labelled `<section>` beside the video on wide screens and below it on narrow ones.

## Transcript details

Two things the transcript does that are easy to get wrong:

**Typed messages.** A message you type produces no `user_transcript` event — only speech does. A UI
that waits for one will see the agent answer a message it never displayed. `useTextChat().sendMessage`
appends it to the history itself, flagged `isTyped`, and the reducer de-duplicates if the agent
later echoes the same text back.

**Audio tags.** ElevenLabs agents emit inline delivery directives for the TTS engine —
`[slow]`, `[excited]`, `[whispers]`, `[strong french accent]`. They are instructions, not speech,
and must never appear on screen. `stripAudioTags` removes them from avatar text only, and is
deliberately conservative: a bracketed phrase is treated as a tag only if it is at most four words
with no sentence punctuation, so genuine prose like `[see the attached form]` survives. The raw text
is kept on each message as `rawMessage`.

Because avatar chunks stream in as deltas, a tag can arrive split across two chunks (`"[sl"` then
`"ow]"`). The reducer accumulates the **raw** text and re-strips each time, and hides a trailing
unterminated bracket, so a half-written tag never flashes on screen.

## Ending the call

There is one way out: the red end-call button. It asks first, with two
answers — **Keep talking**, which is focused, and **End call**, which stops the
session and animates the stage back into the corner it came from.

Escape backs out of the prompt rather than closing the call; reaching for
"never mind" must not do the thing being confirmed. With the prompt closed,
Escape leaves the call, the same as answering **End call**.

Under `prefers-reduced-motion: reduce` the exit animation is skipped entirely
rather than merely shortened.

## Opening the call

The widget is a small round button fixed to the bottom-right corner. Clicking it:

1. **Asks for the microphone first** (`requestMicrophoneAccess`), before anything opens. The track
   it opens is stopped immediately — we want the permission, not the stream, so the browser's
   recording indicator does not come on early.
2. On refusal, shows a short notice beside the button and stops. No stage opens and **no session
   token is minted**, so a call that could never work costs nothing.
3. On success, opens the stage, which animates out of the bottom-right corner, and connects.

Asking up front matters: if you leave the prompt to the SDK, the stage opens, spins, and dies while
the browser prompt sits unanswered behind a UI that is already pretending to connect.

`requestMicrophoneAccess()` is exported if you want to gate something else on it. It returns
`"granted"`, `"denied"` (refused, or an insecure origin) or `"unavailable"` (no microphone, or a
browser with no media API).
