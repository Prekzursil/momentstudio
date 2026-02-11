import { test, expect } from '@playwright/test';

import { loginUi, seedCartWithFirstProduct, uniqueSessionId } from './checkout-helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
    localStorage.setItem('admin.onboarding.v1', JSON.stringify({ completed_at: new Date().toISOString() }));
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

test('guest checkout prompts for email verification', async ({ page, request: apiRequest }) => {
  // This flow only validates that the guest email verification UI is reachable.
  // Avoid depending on a seeded product page to reduce flakiness in CI.
  const sessionId = uniqueSessionId('guest-e2e');
  await page.addInitScript((sid) => {
    localStorage.setItem('cart_session_id', sid);
    localStorage.removeItem('cart_cache');
  }, sessionId);

  const seeded = await seedCartWithFirstProduct(apiRequest, sessionId, {
    skipMessage: 'No in-stock products available for guest checkout e2e.',
  });
  if (!seeded) return;

  const cartLoad = page.waitForResponse(
    (res) => res.url().includes('/api/v1/cart') && res.request().method() === 'GET' && res.status() === 200
  );
  await page.goto('/cart');
  await cartLoad;

  const proceed = page.getByRole('link', { name: 'Proceed to checkout' });
  await expect(proceed).toBeVisible();
  await proceed.click();
  await expect(page).toHaveURL(/\/checkout/);
  const email = `guest-e2e-${Date.now()}@example.com`;
  await page.getByLabel('Email').fill(email);

  const emailRequest = page.waitForResponse((res) =>
    res.url().includes('/api/v1/orders/guest-checkout/email/request')
  );
  const sendLink = page.getByRole('button', { name: 'Send verification link' });
  await expect(sendLink).toBeVisible();
  await sendLink.click();
  const response = await emailRequest;
  expect([200, 204]).toContain(response.status());

  await expect(page.getByText('We sent a verification link to your email. Open it to continue.')).toBeVisible();
});

test('owner can sign in and reach admin dashboard', async ({ page }) => {
  await loginUi(page);

  const viewAdmin = page.getByRole('link', { name: 'View admin' });
  await expect(viewAdmin).toBeVisible();
  // The header link can be present in multiple responsive wrappers; route-access
  // smoke is more stable when we navigate directly after asserting visibility.
  await page.goto('/admin/dashboard');
  await expect
    .poll(() => new URL(page.url()).pathname, {
      message: 'Owner should remain on /admin/dashboard after navigation',
    })
    .toBe('/admin/dashboard');
});
