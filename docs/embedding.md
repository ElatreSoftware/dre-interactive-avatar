# Embedding the avatar widget

Put the assistant on your site with one script tag.

```html
<script src="https://widget.example.com/embed.js" data-embed-key="pk_dre_7f3a91c4" async></script>
```

That is the whole integration. A small round button appears in the corner;
clicking it asks for the microphone and then opens the call.

## There is only one way in

The widget runs embedded, with a key, on an origin that key names. Nothing
else works, by design:

- **The host's own page** answers **401** with a short message. It is served
  from `src/proxy.ts` rather than a page, because a page cannot set a status
  code, and a 200 saying "unauthorized" misleads every monitor and crawler
  that reads one.
- **Opening `/embed/<key>` in a tab** is refused with a 404. The browser sends
  `Sec-Fetch-Dest: document` for a top-level navigation and `iframe` for a
  frame, and that header cannot be set by script. A public embed key pasted
  into an address bar used to load a working, billable call.

That second check is a real gate for browsers and a speed bump for everything
else: a scripted caller can send any header it likes, but it has no browser to
run a call in, and still has to get past the key, the allowlist, the signed
grant and the rate limiter to spend anything.

## Requirements

**Your page must be served over HTTPS.** Browsers refuse microphone access to
insecure pages, and no attribute or setting works around it. `http://localhost`
is exempt while you develop.

**Your origin must be on your key's allowlist.** Tell us every origin you will
embed from — production, staging, preview domains — and we add them. A page on
an origin we have not been told about cannot display the widget at all; the
browser blocks it, and your console will show a `frame-ancestors` violation.

## Script tag attributes

| Attribute        | Required | Description                                                                                                              |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `data-embed-key` | yes      | Your public embed key. Safe to put in page source.                                                                       |
| `data-position`  | no       | `bottom-right` (default), `bottom-left`, `top-right`, `top-left`.                                                        |
| `data-user-id`   | no       | An opaque id of your own, attached to the session. Do not put personal data here — an internal id, not an email address. |

## Controlling it from your own page

```js
window.DreWidget.open(); // same as clicking the button, mic prompt included
window.DreWidget.close(); // ends the call and collapses the widget
window.DreWidget.destroy(); // removes it entirely
```

`open()` is safe to call before the widget has finished loading; the request is
queued and runs as soon as it is ready.

## Writing the iframe yourself

Supported, but there is one thing that is easy to get wrong and hard to
diagnose:

```html
<iframe
  src="https://widget.example.com/embed/pk_dre_7f3a91c4?o=https%3A%2F%2Fyour-site.example"
  allow="microphone; autoplay; clipboard-write"
></iframe>
```

**Without `allow="microphone"` the call cannot work.** A cross-origin frame has
no microphone unless the embedding page grants it, and the resulting failure
looks exactly like the visitor clicking "Block". The widget detects this case
and says "This page hasn't allowed microphone access for the assistant" rather
than blaming them — but the fix is on your side, in that attribute.

You also become responsible for sizing the frame. The widget posts a `resize`
message when the call opens and closes; ignoring it means the call stage is
clipped to the size of the bubble. This is what `embed.js` exists to handle.

## Troubleshooting

| What you see                                    | What it means                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Console: "Framing … violates … frame-ancestors" | Your origin is not on the key's allowlist. Send us the exact origin, scheme and port included. |
| "This page hasn't allowed microphone access"    | Your iframe tag is missing `allow="microphone"`.                                               |
| "Microphone access is blocked"                  | The visitor denied the browser prompt; they can change it in the site settings.                |
| The bubble appears but never opens              | Check the console for a 403 from the session endpoint — usually a disabled key.                |
| Nothing appears at all                          | Check that the script tag has `data-embed-key`; the loader logs one error and stops.           |

---

# Operating the service

Notes for whoever runs the widget host, not for customers.

## The key registry

Keys live in the `EmbedKey` table. There is no configuration file.

### Issuing a key

```bash
pnpm embed:key -- \
  --name "Acme Corp" \
  --origin https://acme.example \
  --origin "https://*.acme.example" \
  --var brand=Acme
```

Generates the key, validates each origin with the server's own matcher
(imported, not reimplemented, so the two cannot disagree), writes the row and
prints the script tag to send the customer. `--dry-run` shows what it would
create; `--avatar` overrides the default avatar id.

```bash
pnpm embed:keys                          # list: origins, expiry, live calls
pnpm embed:keys -- --disable pk_dre_...  # turn one off
pnpm embed:keys -- --enable  pk_dre_...
pnpm embed:keys -- --key pk_dre_... --expires 2027-06-30
pnpm embed:keys -- --key pk_dre_... --expires never
pnpm embed:keys -- --key pk_dre_... --max-concurrent 5   # 0 removes the limit
```

### Expiry

`--expires` sets the date a key stops working; without one it never expires.
It is checked on every lookup rather than when keys are loaded, so a key
expires on time instead of whenever the cache next refreshes. An expired key
behaves exactly like an unknown one: the widget will not frame, and no session
is minted. `pnpm footprints:check` warns a week ahead, because an expiry
nobody noticed looks identical to a broken widget from the customer's side.

### Concurrent calls

`--max-concurrent` caps how many calls a customer may have running at once.
Sessions cost vendor credits, so this is a spend control as much as a fairness
one. The check runs **before** the session is minted, because the vendor bills
for one whether or not we then decide we did not want it. A caller at the
limit gets a 429 and "All available lines are busy."

Live calls are tracked in the `ActiveSession` table, written when a session is
minted — not derived from footprints, so the limit still holds with telemetry
switched off. A slot is released when the call reports that it ended.

#### How a line is held, and how it comes back

A live call **says it is still there once a minute**. That heartbeat is the
whole mechanism: `lastSeenAt` means "this call exists", not "somebody spoke
recently" — two people sitting in silence produce no other events at all.

A line comes back six ways:

|                                                                                 | When                                                                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| The visitor presses **End**                                                     | at once                                                                                                |
| They **close the tab**                                                          | at once — reported on `pagehide`, sent by beacon                                                       |
| The **vendor ends the session** (its own duration limit) and the tab is open    | at once                                                                                                |
| **LiveAvatar says the call is over** — whatever the browser did or failed to do | within `SESSION_RECONCILE_SECONDS`, default **60**, and immediately when the next session is requested |
| **Nothing is ever heard again** — crash, lid closed, power, network             | after `SESSION_STALE_MINUTES`, default **3**                                                           |
| A row is **older than `SESSION_MAX_AGE_MINUTES`** (default 60)                  | at that age, whatever it last said                                                                     |

The fourth is the authoritative one, and worth being precise about, because it
is the only one that does not depend on our own guesswork. Everything else is
inferred from this side: the browser reporting its own ending (which a crashed
tab never does), or a timeout, which is a guess wearing a confident expression.
LiveAvatar is the only party that actually knows, and
`GET /v1/sessions/{id}` is how it is asked.

**There is no webhook, and that is not for want of looking.** LiveAvatar
publishes none — its OpenAPI document declares no `webhooks` object and does
not mention the word. HeyGen's API does have webhooks, and its catalog lists
`live_avatar.success` / `live_avatar.fail`, but those do not fire for
LiveAvatar sessions; it is a separate product. We tried it. So the state is
pulled rather than pushed, and that is a property of the vendor, not a
shortcut taken here.

An ended session is recognised by `end_at` appearing on the response, and the
reason it carries — `USER_CLOSED`, `IDLE_TIMEOUT`, `NO_CREDITS`,
`MAX_DURATION_REACHED`, and so on — is kept on the row in `endReason`. Rows
closed from our side are marked `client` or `stale` instead, so it is always
possible to tell what actually released a line from what we assumed.

##### Running it

The reconcile needs a clock. Point cron at it once a minute:

```
* * * * * curl -fsS -X POST https://your-host/api/cron/reconcile \
  -H "authorization: Bearer $CRON_SECRET" >/dev/null
```

It answers `{"ok":true,"checked":N,"closed":N}`, and a non-2xx on failure, so
your cron runner's own alerting notices a job that has quietly stopped
working. `CRON_SECRET` is required — without it the endpoint refuses to run
rather than standing open, because anything that frees lines is also a way to
hang up calls. `GET` works too, for runners that only issue those.

A minute is safe _because the endpoint asks the vendor_. A one-minute silence
timeout would be a different thing and a dangerous one: the heartbeat is 60
seconds, so a healthy call is routinely 60–90 seconds past its last beat, and
that rule would hang up live conversations. This closes on fact instead, which
is why the cadence can be as tight as you like.

The only other place a reconcile runs is the session-mint path, awaited, for
keys that have a concurrency limit — that is the one moment the count has to
be exactly right, and it is scoped to the single customer asking.

Two deliberate refusals in it:

The last two rows only wait because nothing is alive to report. The sweep runs
when the next session is requested, so the blocked caller is the one who clears
it and is then let through — nobody waits on a background timer, only on their
own next attempt.

Note that that wait is measured from the **last heartbeat**, not from when the
tab closed. At the default settings it is at most three minutes — and in
practice the reconcile usually gets there first.

#### Settings

```
SESSION_STALE_MINUTES=3                       # floored at 2, see below
NEXT_PUBLIC_FOOTPRINT_HEARTBEAT_SECONDS=60
SESSION_MAX_AGE_MINUTES=60                    # a little above the vendor's session limit
SESSION_RECONCILE_SECONDS=60                  # how often LiveAvatar is asked
SESSION_RECONCILE_GRACE_SECONDS=120           # don't ask about a session this new
```

`SESSION_STALE_MINUTES` is floored at two minutes in code. Below two
heartbeats, a live call loses its line between beats and a second caller gets
in while the first is still talking — a worse failure than waiting.

If your vendor sessions are ten minutes, set `SESSION_MAX_AGE_MINUTES=12`. The
default hour is sized for long calls you do not have.

#### When a line is stuck

```bash
pnpm embed:keys                                   # shows live-vs-limit per key
pnpm embed:keys -- --key pk_dre_... --free-lines  # closes every open row for that key
```

`--free-lines` is for the call where a customer says every line is busy and
nobody is on one. It cuts off anything genuinely still running, so check the
live count first.

**Limits need footprints.** The heartbeat that holds a line and the ending
that frees it are both footprint events. With `FOOTPRINTS_ENABLED=false` a
limit holds every line for the full quiet window, and a call longer than that
window loses its line mid-conversation. `pnpm footprints:check` fails if you
configure both.

**No restart.** Keys are cached for thirty seconds, so issuing, changing or
disabling one takes effect on its own within that window. If the database is
briefly unreachable the last known keys keep working; with nothing cached it
fails closed, and the first-party page keeps running because it needs no row.

**`localhost` and `127.0.0.1` are different origins**, as are `http` and
`https`, and two ports on the same host. A browser compares them as strings;
so does this. Serving a page at `http://localhost:5500` when the key lists
`http://127.0.0.1:5500` gets a 404, and the server log says which origin was
refused and what is allowed.

Origin patterns are exact, with one optional leading `*.` label.
`https://*.acme.example` covers `www.acme.example` and `eu.shop.acme.example`,
and — as in CSP — does not cover the bare `acme.example`. Scheme and port are
part of the comparison: `https://acme.example` does not match
`http://acme.example` or `https://acme.example:8443`.

Revoking access is `pnpm embed:keys -- --disable <key>`, or removing the
origin. Both take effect within thirty seconds for new sessions, and within ten
minutes for a page already open — the grant is re-checked against the live
allowlist on every renewal and every session mint.

## How embedding is secured

Three layers, each doing a different job:

1. **`frame-ancestors`** (`src/proxy.ts`) — set per key on the embed document.
   The browser refuses to render it inside any page not named there. This is
   the enforcement: it is applied by something the attacker does not control.
2. **The embed grant** (`src/embed/grant.ts`) — a short-lived HMAC statement
   that this key was served to a document framed by this origin. Required to
   mint a session. An embed key is public and a scraped one is useless on its
   own: a grant can only be obtained by genuinely being framed on an allowed
   origin, and it expires in ten minutes. Renewal needs an existing authentic
   grant no more than a day old, so the chain of custody holds.
3. **Rate limiting** (`src/embed/rateLimit.ts`) — per key and hashed IP, in
   process. Sessions cost vendor credits; five per minute per caller.

The session route takes the avatar id and prompt variables from the registry,
never from the request body. A caller does not get to describe itself.

## Environment

```
DATABASE_URL=          # where keys and footprints live; `pnpm db:up` starts a local one
EMBED_GRANT_SECRET=    # required in production; openssl rand -hex 32
```

Without `EMBED_GRANT_SECRET` in development a random one is generated per
process, with a warning. Restarting invalidates outstanding grants, which is
harmless — they live ten minutes. In production a missing secret is a startup
error, because a predictable signing key would let anyone mint a grant for any
origin.

## Testing

`pnpm e2e` runs the cross-origin tests. They serve fixture pages on
`127.0.0.1:4321` (allowlisted) and `127.0.0.1:4322` (not), with the app on port
3100 so a dev server on 3000 is never silently reused. No vendor credits are
spent: the session route is stubbed.
