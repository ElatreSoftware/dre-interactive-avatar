import { defineConfig } from "@playwright/test";

// Playwright does not read .env, and the e2e database URL is derived from it.
try {
  process.loadEnvFile(".env");
} catch {
  // Not fatal: every value below has a working local default.
}

/**
 * Two fixture origins exist so the embedding tests can observe real
 * cross-origin behaviour: `127.0.0.1:4321` is on the test key's allowlist,
 * `127.0.0.1:4322` is not.
 */
const ALLOWED_FIXTURE_ORIGIN = "http://127.0.0.1:4321";

/**
 * Not 3000: a dev server already sitting there would be reused, and it would
 * not have the test registry — which fails as a 404 inside an iframe, roughly
 * the least legible failure available.
 */
const APP_ORIGIN = "http://localhost:3100";

/**
 * Its own database on the same server, seeded by e2e/global-setup.mjs, which
 * refuses to run against the application's own database. The tests create and
 * wipe rows, so that separation is the only thing between a test run and an
 * incident.
 */
function e2eDatabaseUrl(): string {
  const base = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set; the end-to-end tests need a database.");
  const url = new URL(base);
  const name = url.pathname.replace(/^\//, "");
  url.pathname = `/${name.endsWith("_e2e") ? name : `${name}_e2e`}`;
  return url.toString();
}

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.mjs",
  // The widget asks for the microphone before opening, so grant it up front.
  use: {
    baseURL: APP_ORIGIN,
    // Granting the permission is not enough: a headless browser has no audio
    // input device, so `getUserMedia` fails with NotFoundError and the widget
    // correctly refuses to open. The fake device gives it something to find.
    permissions: ["microphone"],
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
  },
  webServer: [
    {
      command: "pnpm build && pnpm start --port 3100",
      url: APP_ORIGIN,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        DATABASE_URL: e2eDatabaseUrl(),
        EMBED_GRANT_SECRET: "e2e-grant-secret-at-least-32-characters-long",
        IP_HASH_SALT: "e2e-salt",
      },
    },
    {
      command: "node e2e/embed/serve.mjs 4321",
      url: `${ALLOWED_FIXTURE_ORIGIN}/host.html`,
      reuseExistingServer: !process.env.CI,
      env: { WIDGET_ORIGIN: APP_ORIGIN },
    },
    {
      command: "node e2e/embed/serve.mjs 4322",
      url: "http://127.0.0.1:4322/denied.html",
      reuseExistingServer: !process.env.CI,
      env: { WIDGET_ORIGIN: APP_ORIGIN },
    },
  ],
});
