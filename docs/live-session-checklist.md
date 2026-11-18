# Manual live-session checklist

CI never calls the vendors, so these are the things to confirm by hand against a real session
before shipping. Run `pnpm dev` with a filled-in `.env.local`.

## Connection
- [ ] Panel opens and video appears within ~5s.
- [ ] Status badge goes `Connecting…` → `Listening`.
- [ ] Denying the microphone shows the mic-permission message with a working **Try again**.
- [ ] Connection quality dot reflects a throttled network (DevTools → Network → Slow 3G).

## Conversation
- [ ] Speaking produces a user transcript entry.
- [ ] The avatar replies with audible speech and **lip sync is aligned** (this is the one thing
      that silently breaks when the agent's audio format is not PCM 24000 Hz).
- [ ] Typed messages get a spoken reply.
- [ ] Typing while the avatar is talking makes it hold off (`sendUserActivity`).

## Interruption — the headline feature
- [ ] Speaking over the avatar stops it **within about a second**.
- [ ] Status returns to `Listening` immediately.
- [ ] The transcript entry is marked *interrupted* and shows the **truncated** text — what you
      actually heard, not the full planned reply.
- [ ] The new user turn is answered normally.
- [ ] Interrupting repeatedly in one session stays stable.
- [ ] The **stop button** cuts the avatar off. If it does not, the connector is ignoring
      `avatar.interrupt` server-side — the UI still updates, and barge-in by speaking still works.
      Consider hiding the button in that case.

## Teardown — these cost money if they regress
- [ ] **End conversation** releases the mic (browser indicator goes away).
- [ ] Closing the panel ends the session.
- [ ] Navigating away ends the session (`pagehide`).
- [ ] Backgrounding the tab past the grace period ends it.
- [ ] No session is left running in the LiveAvatar dashboard after any of the above.

## Limits
- [ ] Leaving a session idle for 5 minutes shows the timeout message, not a frozen avatar.
- [ ] Hitting `max_session_duration` shows the time-limit message.
