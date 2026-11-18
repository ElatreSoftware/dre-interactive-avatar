import { expect, test } from "@playwright/test";

/**
 * The service is reachable one way only: embedded, with a key, from an origin
 * that key names. These are the ways in that used to exist and must not.
 */

const KEY = "pk_e2e_allowed";

test("the host's own page answers 401", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.status()).toBe(401);
  await expect(page.getByText(/unauthorized to access/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /start video call/i })).toHaveCount(0);
});

test("the embed document refuses a top-level visit", async ({ page }) => {
  // A public embed key pasted into an address bar: the browser sends
  // Sec-Fetch-Dest: document, and this is not an embed.
  const response = await page.goto(`/embed/${KEY}?o=http%3A%2F%2F127.0.0.1%3A4321`);

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("button", { name: /start video call/i })).toHaveCount(0);
});

test("and still serves the same key inside a frame", async ({ page }) => {
  await page.goto("http://127.0.0.1:4321/host.html");
  await expect(
    page.frameLocator("iframe[title='Avatar assistant']").getByRole("button", {
      name: /start video call/i,
    }),
  ).toBeVisible();
});
