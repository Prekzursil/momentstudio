import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
  });
});

test('shop shows seeded products', async ({ page }) => {
  await page.goto('/shop');
  await expect(page.locator('app-product-card').first()).toBeVisible();
});

test('guest checkout prompts for email verification', async ({ page }) => {
  // This flow only validates that the guest email verification UI is reachable.
  // Avoid depending on a seeded product page to reduce flakiness in CI.
  const sync = page.waitForResponse((res) => res.url().includes('/api/v1/cart/sync'));
  await page.goto('/checkout');
  await sync;
  const email = `guest-e2e-${Date.now()}@example.com`;
  await page.getByLabel('Email').fill(email);

  const request = page.waitForResponse((res) => res.url().includes('/api/v1/orders/guest-checkout/email/request'));
  await page.getByRole('button', { name: 'Send code' }).click();
  const response = await request;
  expect([200, 204]).toContain(response.status());

  await expect(page.locator('input[name="guestEmailToken"]')).toBeVisible();
});

test('owner can sign in and reach admin dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill('owner');
  await page.getByLabel('Password').fill('Password123');
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page).toHaveURL(/\/account$/);

  const viewAdmin = page.getByRole('link', { name: 'View admin' });
  await expect(viewAdmin).toBeVisible();
  await viewAdmin.click();

  await expect(page).toHaveURL(/\/admin(\/orders)?$/);
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
});
