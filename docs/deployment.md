# Deploying

The widget is a Next.js server, not a folder of static files. Something has to
run `next start`; nginx sits in front of it.

## Before anything else: move it out of the web root

The files are currently at `/usr/share/nginx/html/dre-interactive-avatar`.
**That is a public directory.** If nginx serves it statically — and serving
`/usr/share/nginx/html` statically is what that path is for — then every file
under it is a URL, including:

```
https://your-host/dre-interactive-avatar/.env
```

That one file holds the LiveAvatar API key, the ElevenLabs agent id, the embed
grant secret, the IP hash salt and the database password. Check it before you
do anything else:

```bash
curl -i https://your-host/dre-interactive-avatar/.env
```

A `200` with your secrets in the body means they are already public: rotate
every one of them, then move the application somewhere nginx does not serve,
for example `/srv/dre-interactive-avatar` or `/home/ubuntu/apps/…`. A `404`
means you are probably fine, but the application still does not belong under a
web root — nothing stops the next person adding a `location /` that serves it.

Nothing below assumes a particular path. Use one outside the web root.

## Requirements

- **Node 20 or newer** (built and tested on 24). `node -v`
- npm or pnpm. Both work; the repository ships a `pnpm-lock.yaml`, so pnpm
  gives you reproducible installs and npm resolves fresh.
- Network access to the database and to `api.liveavatar.com`.

## Install

```bash
cd /srv/dre-interactive-avatar
rm -rf node_modules package-lock.json   # only if an earlier attempt left them
npm i
```

The avatar SDK is **not** installed from a registry — it is committed at
`vendor/liveavatar-web-sdk/` and resolved by alias. Make sure `vendor/` is in
whatever you copied across. You do **not** need to copy anything into
`node_modules` by hand; if a previous attempt left an `@elatre` directory
there, delete it. See `vendor/README.md`.

## Configure

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored and must
never be served; see the warning above.

Generate the two secrets **per environment** — do not reuse the ones from a
laptop:

```bash
openssl rand -hex 32   # EMBED_GRANT_SECRET
openssl rand -hex 16   # IP_HASH_SALT
```

`EMBED_GRANT_SECRET` is required in production and the application refuses to
start without it. A missing `IP_HASH_SALT` logs a warning and makes visitor IP
hashes reversible.

`DATABASE_URL` must be quoted — it contains `&`, which breaks any shell that
sources the file. For a managed database over the public internet, keep
`sslmode=verify-full` and the CA bundle:

```
DATABASE_URL="postgresql://user:pass@host:5432/db?schema=public&sslmode=verify-full&sslrootcert=./certs/rds-global-bundle.pem"
```

That path is relative to the working directory, so start the service from the
application directory.

## Migrate, build, run

```bash
npx prisma migrate deploy   # creates or updates the tables
npm run build
npm start                   # next start, port 3000 by default
```

`migrate deploy` applies pending migrations and never resets anything —
unlike `migrate dev`, which is for laptops.

Run it under systemd so it survives a reboot:

```ini
# /etc/systemd/system/dre-avatar.service
[Unit]
Description=Dr. E interactive avatar
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/srv/dre-interactive-avatar
Environment=NODE_ENV=production
EnvironmentFile=/srv/dre-interactive-avatar/.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dre-avatar
sudo systemctl status dre-avatar
```

**`NODE_ENV=production` matters for more than speed.** It turns off the
development allowance that lets any `localhost` origin embed the widget. A
staging box left in development mode will happily frame for anyone.

## nginx

nginx proxies to the Next server. It does not serve the application directory.

```nginx
server {
  listen 443 ssl http2;
  server_name widget.example.com;

  # HTTPS is not optional: browsers refuse microphone access to insecure
  # pages, so a call cannot work over http.
  ssl_certificate     /etc/letsencrypt/live/widget.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/widget.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    # The ingest route hashes the first address in this header. Without it
    # every visitor shares one hash and the rate limiter treats the whole
    # internet as a single caller.
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade           $http_upgrade;
    proxy_set_header Connection        "upgrade";
  }
}
```

Do not add `X-Frame-Options` here. The application sets
`Content-Security-Policy: frame-ancestors` per embed key, and an
`X-Frame-Options` header from nginx overrides that and blocks every customer.

## Issue a key for the real site

```bash
npm run embed:key -- \
  --name "Acme Corp" \
  --origin https://acme.example \
  --origin "https://*.acme.example" \
  --max-concurrent 5
```

Origins must be the exact scheme, host and port the customer embeds from.
`https://acme.example` and `http://acme.example` are different origins, as are
`localhost` and `127.0.0.1`.

Key changes take effect within thirty seconds without a restart. **Changes to
`.env` need a restart** — the process reads it once at start-up.

## Check it works

```bash
curl -sI "https://widget.example.com/embed/<key>?o=https%3A%2F%2Facme.example" | head -3
curl -s -o /dev/null -w "%{http_code}\n" https://widget.example.com/embed.js
npm run footprints:check
npm run embed:keys
```

The first should be `200` with a `frame-ancestors` header naming that
customer's origins. A `404` with `frame-ancestors 'none'` means the key is
unknown to *this* database — the most common cause is the server reading a
different `DATABASE_URL` than the one you added the key to.

## Things that will catch you out

| Symptom | Cause |
|---|---|
| `EUNSUPPORTEDPROTOCOL … link:` on `npm i` | An old `package.json`. The SDK has no dependency entry any more; copy the current one across. |
| 404 and `frame-ancestors 'none'` for a key you just made | The running server is reading a different database, or was started before the key existed and has a stale cache (wait thirty seconds). |
| Widget loads, call never starts | Check the server log for `[avatar/session]`. A 4xx from LiveAvatar is nearly always configuration: wrong avatar id, or an ElevenLabs agent that is not PCM 24000 Hz. |
| "This page hasn't allowed microphone access" | The embedding page's iframe tag is missing `allow="microphone"`. Our loader sets it; a hand-written tag may not. |
| Everything works locally, nothing works in production | `NODE_ENV` is not `production`, so the localhost allowance is masking a missing origin — or the reverse, and a real origin was never added. |
| `{"error":"This page is not allowed to start a session."}` on your own domain | The first-party page signs a grant for its own origin and the session route checks it. Both now derive that origin from the forwarded headers and compare host and port only, so a proxy that does or does not set `x-forwarded-proto` works either way. If you still see it, the host the page saw and the host the route saw genuinely differ — check `proxy_set_header Host $host`. |
