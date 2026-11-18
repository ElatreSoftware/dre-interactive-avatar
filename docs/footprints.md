# Session footprints

Every session writes a trail of events to the `Footprint` table. Rows are
written once and deleted by retention; nothing updates them.

```bash
pnpm footprints:tail                                  # the last 100 events
pnpm footprints:tail -- --session 9f3a1c              # one visitor's session
pnpm footprints:tail -- --embed-key pk_dre_... --limit 500
pnpm db:studio                                        # or browse it
```

## What is recorded

Each line is an event, plus an envelope, plus what the server stamped on it.

### The envelope — on every line

| Field | Source | Meaning |
|---|---|---|
| `v` | client | Schema version. Currently `1`. |
| `id` | client | Unique per event. |
| `seq` | client | Order within one widget session; survives out-of-order delivery. |
| `sessionKey` | client | One widget session, from page load. Exists before any avatar session does. |
| `clientTs` | client | The browser's clock. |
| `receivedAt` | **server** | Ours. Use this one for anything that matters. |
| `embedKey` | **server** | Which customer. From the grant, never the body. |
| `parentOrigin` | **server** | Which page. From the grant, never the body. |
| `ipHash` | **server** | Salted SHA-256 of the visitor's IP, truncated. The raw address is never written. |
| `userAgent` | **server** | As sent, capped at 300 characters. |

The split is deliberate: anything a browser can lie about is stamped again by
the server, under a different name, so a reader is never in doubt about which
side a value came from.

### Lifecycle

| `type` | Extra fields | When |
|---|---|---|
| `widget_loaded` | `referrer`, `locale`, `timezone`, `viewport`, `deviceClass`, `userId` | Once, as the widget starts |
| `widget_opened` / `widget_closed` | — | The call stage opened or closed |
| `mic_granted` | — | Permission given |
| `mic_refused` | `reason`: `denied` \| `unavailable` \| `blocked_by_embedder` | Permission not given — the three reasons have three different fixes |
| `session_requested` | — | A token was asked for |
| `session_started` | `avatarSessionId` | The vendor session connected |
| `stream_ready` | — | Video and audio are flowing |
| `user_speak_started` / `user_speak_ended` | — | Turn-taking |
| `avatar_speak_started` / `avatar_speak_ended` | — | Turn-taking |
| `interruption` | — | The visitor talked over the avatar |
| `mute_toggled` | `isMuted` | |
| `connection_quality_changed` | `quality` | |
| `session_ended` | `reason`, `durationMs`, `turns`, `interruptions` | The call ended, for any reason |
| `error` | `code`, `message` | A session-level failure |

`session_ended` is the summary line: if you read one event per call, read this
one.

### Conversation

`transcript_turn` — `sender`, `text`, `isTyped`, `wasInterrupted`, `charCount`.

Only finished turns are recorded, not the streaming chunks. `text` has audio
tags (`[slow]`) already stripped and is capped at 2,000 characters;
`charCount` is the true length, so a truncated turn is still visible as a long
one. With `FOOTPRINT_TRANSCRIPTS=false` the turn is still recorded — sender,
timing, length — with `text` empty.

## Reading them

The envelope is columns and the event's own fields are JSON, so filter on
columns and reach into `payload` for the rest.

```sql
-- Every session that ended badly today
select "receivedAt", "parentOrigin", payload
from "Footprint"
where type = 'session_ended'
  and payload->>'reason' <> 'client'
  and "receivedAt" > now() - interval '1 day';

-- Median call length, in seconds
select percentile_cont(0.5) within group (
  order by (payload->>'durationMs')::int
) / 1000.0 as median_seconds
from "Footprint" where type = 'session_ended';

-- Sessions per customer
select "embedKeyValue", count(*)
from "Footprint" where type = 'session_started'
group by 1 order by 2 desc;

-- How often people talk over the avatar
select avg((payload->>'interruptions')::int)
from "Footprint" where type = 'session_ended';

-- One conversation, in order
select payload->>'sender' as who, payload->>'text' as said
from "Footprint"
where "sessionKey" = '9f3a…' and type = 'transcript_turn'
order by seq;

-- Why microphones are failing. If blocked_by_embedder shows up, that
-- customer's iframe tag is missing allow="microphone".
select "parentOrigin", payload->>'reason' as reason, count(*)
from "Footprint" where type = 'mic_refused'
group by 1, 2 order by 3 desc;
```

`psql "$DATABASE_URL"` for these, or `pnpm db:studio` to click around.

### Studio against a managed database

Prisma Studio cannot complete TLS to RDS with a custom CA. It loads nothing
and reports "Could not load schema metadata", which reads like a permissions
problem and is not one — the same database answers every catalog query
perfectly through the application's connection, and the same Studio works
against the local Postgres.

The CLI tools all work against it (`pnpm embed:keys`, `pnpm footprints:tail`,
`pnpm footprints:check`, `psql "$DATABASE_URL"`), so reach for those first.

`PRISMA_DATABASE_URL` overrides the URL for Prisma's own CLI only — Studio and
migrate — while the application keeps using `DATABASE_URL`. That is the hook
for pointing Studio somewhere it can connect.

Prisma documents `sslaccept=accept_invalid_certs` for this, which makes Studio
connect by not checking the certificate at all. It is a real option for a
development database and it is your call — but it is certificate verification
off, over the public internet, so it is not something to leave in `.env` by
habit.

## Privacy and retention

**These files contain what people said.** That carries obligations, and they
do not only fall on you:

- **Retention is 90 days by default, and the service enforces it itself.** The
  sweep runs from the ingest path, at most once an hour per process. There is
  no cron job to install and none to forget. `pnpm footprints:prune` is for
  catching up after a quiet spell or shortening the window by hand.
- **Every embedding customer has to tell their own visitors.** They are
  recording their users' conversations on their own page; you are the
  processor, not the one with the relationship. Give them wording.
- **IPs are hashed with a salt**, never stored raw. Rotating `IP_HASH_SALT`
  breaks correlation across the rotation, which is the point of having one.
- **`FOOTPRINT_TRANSCRIPTS=false`** keeps everything except the words. If you
  are unsure whether you should be keeping transcripts, this is the setting
  that lets you stop without losing the operational data.
- Nothing is written to disk, so there is no file to leak into a backup or a
  repository by accident.

## Operating

```
DATABASE_URL=                    # `pnpm db:up` starts a local Postgres
FOOTPRINTS_ENABLED=true          # false records nothing
FOOTPRINTS_RETENTION_DAYS=90     # enforced by the service, no cron
FOOTPRINT_TRANSCRIPTS=true
IP_HASH_SALT=                    # openssl rand -hex 16
```

### Checking the configuration

```bash
pnpm footprints:check
```

Verifies the secrets are set, that the database answers, and — the part that
actually catches things — that nothing is sitting past the retention window.
Rows older than the policy mean the sweep is failing or nothing has arrived in
a long time. Exits non-zero, so it belongs in your deploy pipeline.

### How it is protected

The ingest endpoint is public by construction: a browser on a customer's page
has to reach it. So the cheap refusals come first, before a single byte is
written — an unauthenticated append-only endpoint is a disk-filling primitive
with a REST API.

1. **A valid embed grant**, the same one the session route requires. A
   `sendBeacon` carries no headers, so a beacon's grant travels in the body
   rather than the query string — a credential in a URL ends up in access logs.
2. **Size caps** — 64 KB per request, 50 events per batch, checked against
   `content-length` before the body is read.
3. **Rate limiting** per key and hashed IP.
4. **Validation**, one event at a time: a single malformed event drops itself
   rather than taking the batch with it.
5. **Redaction** — text capped, control characters stripped.

Payloads are written as parameterised JSON, so there is no line for a
transcript to forge and no string for it to escape. There is still a test with
a hostile string, because "it cannot happen" is how it happens.

### What the browser does

Events are queued and flushed when any of: 50 queued, 2 seconds idle, the call
ends, or the page goes away.

That last one is the hard one, and it is why `session_ended` exists as its own
event. Calls end by the tab closing. `beforeunload` does not fire on bfcache or
mobile Safari, and a `fetch` is cancelled during unload — so the collector
listens for `pagehide` and `visibilitychange`, and sends with `sendBeacon`,
which survives. A failed flush retries twice and then drops: a footprint is not
worth a broken call.

## Test database

`pnpm e2e` uses a database of its own on the same server, named after the
application's with `_e2e` appended — `avatar_dre` becomes `avatar_dre_e2e`. It
is created on the first run.

The setup **refuses to run against the application's own database**. The tests
create keys and delete footprints; the separation is the only thing between a
test run and an incident, so it is enforced in code rather than left to
whoever edits `.env` next. `E2E_DATABASE_URL` overrides the whole thing when
the tests belong somewhere else entirely.
