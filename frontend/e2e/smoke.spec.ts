import { test, expect } from '@playwright/test';

const OWNER_IDENTIFIER = process.env.E2E_OWNER_IDENTIFIER || 'owner';
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD || 'Password123';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
  });
});

test('shop loads (products grid or empty state)', async ({ page }) => {
  await page.goto('/shop');
  const productCard = page.locator('app-product-card').first();
  const emptyState = page.getByText('No products found');
  const errorState = page.getByText('We hit a snag loading products.');

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await errorState.isVisible()) {
      throw new Error('Shop failed to load products.');
    }
    if (await productCard.isVisible()) {
      await expect(productCard).toBeVisible();
      return;
    }
    if (await emptyState.isVisible()) {
      await expect(emptyState).toBeVisible();
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error('Timed out waiting for shop to render products or empty state.');
});

test('guest checkout prompts for email verification', async ({ page }) => {
  // This flow only validates that the guest email verification UI is reachable.
  // Avoid depending on a seeded product page to reduce flakiness in CI.
  const cartLoad = page.waitForResponse(
    (res) => res.url().includes('/api/v1/cart') && res.request().method() === 'GET' && res.status() === 200
  );
  await page.goto('/checkout');
  await cartLoad;
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
  await page.getByLabel('Email or username').fill(OWNER_IDENTIFIER);
  await page.getByRole('textbox', { name: 'Password' }).fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page).toHaveURL(/\/account(\/overview)?$/);

  const viewAdmin = page.getByRole('link', { name: 'View admin' });
  await expect(viewAdmin).toBeVisible();
  await viewAdmin.click();

  await expect(page).toHaveURL(/\/admin(\/orders)?$/);
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
});
