import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

/**
 * Footprints end to end: a real browser, a real cross-origin embed, and the
 * file the server actually wrote.
 */

const ALLOWED_HOST = "http://127.0.0.1:4321/host.html";

/** The test database — see the note in e2e/global-setup.mjs. */
function e2eDatabaseUrl(): string {
  const base = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL || "";
  const url = new URL(base);
  const name = url.pathname.replace(/^\//, "");
  url.pathname = `/${name.endsWith("_e2e") ? name : `${name}_e2e`}`;
  return url.toString();
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: e2eDatabaseUrl() }),
});

test.afterAll(() => prisma.$disconnect());

const E2E_SESSION_TOKEN =
  "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJzZXNzaW9uX2lkIjogImUyZSIsICJleHAiOiA0MTAyNDQ0ODAwfQ.signature";

async function readFootprints(): Promise<Record<string, unknown>[]> {
  const rows = await prisma.footprint.findMany({ orderBy: { id: "asc" } });
  return rows.map((row) => ({
    ...(row.payload as Record<string, unknown>),
    type: row.type,
    sessionKey: row.sessionKey,
    embedKey: row.embedKeyValue,
    parentOrigin: row.parentOrigin,
    ipHash: row.ipHash,
    receivedAt: row.receivedAt.getTime(),
  }));
}

async function stubSession(page: Page): Promise<void> {
  await page.route("**/api/avatar/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessionId: "e2e", sessionToken: E2E_SESSION_TOKEN }),
    }),
  );
}

test.beforeEach(async () => {
  await prisma.footprint.deleteMany({});
});

test("a session leaves a readable trail attributed to the right customer", async ({ page }) => {
  await stubSession(page);
  await page.goto(ALLOWED_HOST);

  const widget = page.frameLocator("iframe[title='Avatar assistant']");
  await widget.getByRole("button", { name: /start video call/i }).click();
  await expect(widget.getByRole("dialog", { name: "Acme Corp" })).toBeVisible();
  await page.keyboard.press("Escape");

  // The call ends with an immediate flush, so this should not need long.
  await expect.poll(async () => (await readFootprints()).length, { timeout: 15_000 }).toBeGreaterThan(0);

  const events = await readFootprints();
  const types = events.map((event) => event.type);

  expect(types).toContain("widget_loaded");
  expect(types).toContain("widget_opened");
  expect(types).toContain("mic_granted");

  for (const event of events) {
    expect(event.embedKey).toBe("pk_e2e_allowed");
    expect(event.parentOrigin).toBe("http://127.0.0.1:4321");
    expect(event.receivedAt).toBeTruthy();
    expect(String(event.ipHash)).toMatch(/^[0-9a-f]{16}$/);
  }

  // The host's own viewport, not the 96px frame it gave us.
  const loaded = events.find((event) => event.type === "widget_loaded");
  expect(loaded).toMatchObject({ userId: "customer-42", deviceClass: "desktop" });
});

test("every row carries the envelope a reader needs", async ({ page }) => {
  await stubSession(page);
  await page.goto(ALLOWED_HOST);
  await page.frameLocator("iframe[title='Avatar assistant']")
    .getByRole("button", { name: /start video call/i })
    .click();

  await expect.poll(async () => (await readFootprints()).length, { timeout: 15_000 }).toBeGreaterThan(0);

  const rows = await prisma.footprint.findMany();
  for (const row of rows) {
    expect(row.eventId).toBeTruthy();
    expect(row.sessionKey).toBeTruthy();
    expect(row.receivedAt).toBeInstanceOf(Date);
    expect(row.payload).not.toBeNull();
  }
});

test("the ingest endpoint refuses an unsigned caller", async ({ request }) => {
  const response = await request.post("/api/footprints", {
    data: { events: [{ v: 1, id: "id-1234567", seq: 0, sessionKey: "k", clientTs: 1, type: "widget_opened" }] },
  });
  expect(response.status()).toBe(403);
});
