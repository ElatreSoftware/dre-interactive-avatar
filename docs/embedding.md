# Embedding the avatar widget

Put the assistant on your site with one script tag.

```html
<script
  src="https://widget.example.com/embed.js"
  data-embed-key="pk_dre_7f3a91c4"
  async
></script>
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

| Attribute | Required | Description |
|---|---|---|
| `data-embed-key` | yes | Your public embed key. Safe to put in page source. |
| `data-position` | no | `bottom-right` (default), `bottom-left`, `top-right`, `top-left`. |
| `data-user-id` | no | An opaque id of your own, attached to the session. Do not put personal data here — an internal id, not an email address. |

## Controlling it from your own page

```js
window.DreWidget.open();     // same as clicking the button, mic prompt included
window.DreWidget.close();    // ends the call and collapses the widget
window.DreWidget.destroy();  // removes it entirely
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

| What you see | What it means |
|---|---|
| Console: "Framing … violates … frame-ancestors" | Your origin is not on the key's allowlist. Send us the exact origin, scheme and port included. |
| "This page hasn't allowed microphone access" | Your iframe tag is missing `allow="microphone"`. |
| "Microphone access is blocked" | The visitor denied the browser prompt; they can change it in the site settings. |
| The bubble appears but never opens | Check the console for a 403 from the session endpoint — usually a disabled key. |
| Nothing appears at all | Check that the script tag has `data-embed-key`; the loader logs one error and stops. |

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

#### How a line gets freed

Three ways, in order of how quickly they work:

1. **The call ends** — the visitor presses End. The `session_ended` footprint
   closes the row immediately.
2. **The tab closes without ending the call.** The common case: nobody presses
   End, they just close the tab. `pagehide` reports the ending and sends it
   with `sendBeacon`, which survives unload where a `fetch` is cancelled. The
   line is freed at once, same as (1).
3. **Nothing is heard again** — the browser crashed, the lid closed, the
   network went. Nothing can report that, so those rows are reclaimed after
   **ten minutes** without a sign of life.
4. **It is simply too old.** A row older than **an hour** is closed whatever
   its last event said. The quiet check in (3) trusts a stream of events, and
   anything stuck — a page left open in a background tab, a loop that keeps
   reporting — can keep that stream alive indefinitely and hold a line
   forever. Vendor sessions have their own maximum duration well under an
   hour, so an hour-old row is not a call any more. `SESSION_MAX_AGE_MINUTES`
   changes it.

Ten minutes is therefore the longest a customer can be short a line through no
fault of their own. The sweep runs when the next session is requested, so the
next caller triggers the cleanup and is then let through: nobody waits on a
timer, only on their own next attempt.

**With `FOOTPRINTS_ENABLED=false`, only (3) applies.** Endings travel as
footprints, so with telemetry off nothing reports them and every line is held
the full ten minutes. Worse, `lastSeenAt` is only refreshed by arriving
events, so a call lasting longer than ten minutes looks dead while it is still
running. If you set a concurrency limit, leave footprints on.

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
