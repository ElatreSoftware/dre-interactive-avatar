import { expect, test, type Page } from "@playwright/test";

/**
 * The SDK decodes the session token before it does anything with it, so the
 * stub has to be shaped like a JWT. It never reaches a vendor: the route that
 * would use it is stubbed too.
 */
const E2E_SESSION_TOKEN =
  "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJzZXNzaW9uX2lkIjogImUyZSIsICJleHAiOiA0MTAyNDQ0ODAwfQ.signature";

/**
 * The cross-origin story: a customer's page, one script tag, a real iframe.
 * The session route is stubbed throughout so CI never spends vendor credits.
 */

const ALLOWED_HOST = "http://127.0.0.1:4321/host.html";
const DENIED_HOST = "http://127.0.0.1:4322/denied.html";

async function stubSession(page: Page): Promise<void> {
  // Page-level routing covers the iframe as well as the top document.
  await page.route("**/api/avatar/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessionId: "e2e", sessionToken: E2E_SESSION_TOKEN }),
    }),
  );
}

function widgetFrame(page: Page) {
  return page.frameLocator("iframe[title='Avatar assistant']");
}

test.describe("an allowed origin", () => {
  test.beforeEach(async ({ page }) => {
    await stubSession(page);
    await page.goto(ALLOWED_HOST);
  });

  test("mounts the widget from one script tag", async ({ page }) => {
    const iframe = page.locator("iframe[title='Avatar assistant']");
    await expect(iframe).toBeAttached();

    // Without this attribute the call cannot get a microphone at all.
    await expect(iframe).toHaveAttribute("allow", /microphone/);
    await expect(widgetFrame(page).getByRole("button", { name: /start video call/i })).toBeVisible();
  });

  test("grows out of the bubble when the call opens, and shrinks back", async ({ page }) => {
    const iframe = page.locator("iframe[title='Avatar assistant']");
    const collapsed = await iframe.boundingBox();
    expect(collapsed?.height).toBeLessThan(200);

    await widgetFrame(page).getByRole("button", { name: /start video call/i }).click();
    await expect(widgetFrame(page).getByRole("dialog", { name: "Acme Corp" })).toBeVisible();

    await expect
      .poll(async () => (await iframe.boundingBox())?.height ?? 0)
      .toBeGreaterThan(collapsed!.height + 200);

    // Escape rather than the end-call prompt: the stubbed session dies after
    // a second or two, which swaps the controls out from under a two-step
    // interaction. The prompt itself is covered by the component tests.
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => (await iframe.boundingBox())?.height ?? 0)
      .toBeLessThan(200);
  });

  test("shows the transcript inside the narrow frame", async ({ page }) => {
    const widget = widgetFrame(page);
    await widget.getByRole("button", { name: /start video call/i }).click();

    // Off by default, so it is asked for.
    await expect(widget.getByRole("region", { name: /transcript/i })).toBeHidden();

    // `force` skips the stability check. The stubbed session fails and
    // retries, so the controls shift under Playwright's "has it stopped
    // moving yet" heuristic — the button is there and clickable, and this
    // test is about where the transcript renders, not about animation.
    await widget.getByRole("button", { name: /show subtitles/i }).click({ force: true });

    // The frame is ~440px wide. The transcript used to be `hidden md:flex`,
    // so here — the only place it actually matters — it could never appear.
    await expect(widget.getByRole("region", { name: /transcript/i })).toBeVisible();
    await expect(widget.getByLabel(/type a message/i)).toBeVisible();

    // Toggling is covered by the component tests. It is deliberately not
    // exercised here: the stubbed session dies after a few seconds, which
    // swaps the controls out for the "start again" state mid-click.
  });

  test("opens from the host page's own button", async ({ page }) => {
    await page.getByRole("button", { name: "Talk to us" }).click();
    await expect(widgetFrame(page).getByRole("dialog", { name: "Acme Corp" })).toBeVisible();
  });
});

test.describe("an origin that is not on the allowlist", () => {
  test("is refused by the browser, and starts no session", async ({ page }) => {
    let sessionRequested = false;
    await page.route("**/api/avatar/session", (route) => {
      sessionRequested = true;
      return route.abort();
    });

    await page.goto(DENIED_HOST);
    const iframe = page.locator("iframe[title='Avatar assistant']");
    await expect(iframe).toBeAttached();

    // The element exists — the loader always adds it — but `frame-ancestors`
    // stops the document inside it from rendering.
    await expect(
      page.frameLocator("iframe[title='Avatar assistant']").getByRole("button"),
    ).toHaveCount(0);
    expect(sessionRequested).toBe(false);
  });
});

test.describe("the session route", () => {
  test("refuses to mint a session without a grant", async ({ request }) => {
    const response = await request.post("/api/avatar/session", {
      data: { avatarId: "e2e-avatar" },
    });
    expect(response.status()).toBe(403);
  });
});
