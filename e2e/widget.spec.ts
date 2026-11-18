import { expect, test } from "@playwright/test";

/**
 * The SDK decodes the session token before it does anything with it, so the
 * stub has to be shaped like a JWT. It never reaches a vendor: the route that
 * would use it is stubbed too.
 */
const E2E_SESSION_TOKEN =
  "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJzZXNzaW9uX2lkIjogImUyZSIsICJleHAiOiA0MTAyNDQ0ODAwfQ.signature";

/**
 * Smoke only. The session route is stubbed so CI never spends vendor credits;
 * live behaviour (lip sync, real barge-in latency) is the manual checklist in
 * docs/live-session-checklist.md.
 */
test("the corner button opens a centred avatar stage", async ({ page }) => {
  await page.route("**/api/avatar/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessionId: "e2e", sessionToken: E2E_SESSION_TOKEN }),
    }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: /start video call/i }).click();

  const stage = page.getByRole("dialog", { name: "Dr E" });
  await expect(stage).toBeVisible();
  await expect(stage).toHaveAttribute("aria-modal", "true");
  // Subtitles are off until asked for.
  await page.getByRole("button", { name: /show subtitles/i }).click();
  await expect(page.getByRole("region", { name: /transcript/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /end conversation/i })).toBeVisible();
  await expect(page.getByLabel(/type a message/i)).toBeVisible();
});
