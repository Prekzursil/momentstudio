import { expect, test } from "@chromatic-com/playwright";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("lang", "en");
    localStorage.setItem("admin.onboarding.v1", JSON.stringify({ completed_at: new Date().toISOString() }));
  });
});

test("login screen renders", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/login$/);
  await expect(page).toHaveTitle(/momentstudio/i);
  await expect(page.getByRole("navigation", { name: "Header controls" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});
