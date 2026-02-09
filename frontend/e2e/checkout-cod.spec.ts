import { test, expect } from '@playwright/test';
import {
  OWNER_IDENTIFIER,
  openCheckoutWithSeededCart,
  prepareCodCheckout
} from './checkout-helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
    localStorage.removeItem('cart_cache');
  });
});

test('cart → checkout → COD success', async ({ page, request }) => {
  test.setTimeout(120_000);
  const seeded = await openCheckoutWithSeededCart(page, request, 'e2e-cod');
  if (!seeded) return;

  const shippingEmail = OWNER_IDENTIFIER.includes('@') ? OWNER_IDENTIFIER : `${OWNER_IDENTIFIER}@example.com`;
  const placeOrder = await prepareCodCheckout(page, shippingEmail);
  await placeOrder.click();

  await expect(page).toHaveURL(/\/checkout\/success$/);
  await expect(page.getByRole('heading', { name: 'Thank you for your purchase!' })).toBeVisible();
});

test('checkout recovers when backend returns 400', async ({ page, request }) => {
  test.setTimeout(120_000);
  const seeded = await openCheckoutWithSeededCart(page, request, 'e2e-cod-fail');
  if (!seeded) return;

  const shippingEmail = OWNER_IDENTIFIER.includes('@') ? OWNER_IDENTIFIER : `${OWNER_IDENTIFIER}@example.com`;
  const placeOrder = await prepareCodCheckout(page, shippingEmail);

  await page.route('**/api/v1/orders/checkout', async (route) => {
    await route.fulfill({
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ detail: 'Insufficient stock', code: null })
    });
  });

  await placeOrder.click();

  const errorCard = page.locator('#checkout-global-error');
  await expect(errorCard).toBeVisible();
  await expect(errorCard).toContainText('Insufficient stock');

  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Placing order...' })).toHaveCount(0);
});
