import { test, expect } from '@playwright/test';
import {
  acceptCheckoutConsents,
  fillShippingAddress,
  loginUi,
  OWNER_IDENTIFIER,
  seedCartWithFirstProduct,
  uniqueSessionId
} from './checkout-helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
    localStorage.removeItem('cart_cache');
  });
});

test('cart → checkout → COD success', async ({ page, request }) => {
  test.setTimeout(120_000);
  const sessionId = uniqueSessionId('e2e-cod');
  await page.addInitScript((sid) => {
    localStorage.setItem('cart_session_id', sid);
    localStorage.removeItem('cart_cache');
  }, sessionId);

  const product = await seedCartWithFirstProduct(request, sessionId);
  if (!product) return;

  await loginUi(page);

  const cartLoad = page.waitForResponse(
    (res) => res.url().includes('/api/v1/cart') && res.request().method() === 'GET' && res.status() === 200
  );
  await page.goto('/cart');
  await cartLoad;

  await expect(page.getByText(product.name)).toBeVisible();

  await page.getByRole('link', { name: 'Proceed to checkout' }).click();
  await expect(page).toHaveURL(/\/checkout$/);

  const shippingEmail = OWNER_IDENTIFIER.includes('@') ? OWNER_IDENTIFIER : `${OWNER_IDENTIFIER}@example.com`;
  await fillShippingAddress(page, shippingEmail);

  const codOption = page.getByRole('button', { name: 'Cash on delivery' });
  if (await codOption.isVisible()) {
    await codOption.click();
  }

  const placeOrder = page.getByRole('button', { name: 'Place order' });
  if (await placeOrder.isDisabled()) {
    await acceptCheckoutConsents(page);
  }
  await expect(placeOrder).toBeEnabled();
  await page.getByRole('button', { name: 'Place order' }).click();

  await expect(page).toHaveURL(/\/checkout\/success$/);
  await expect(page.getByRole('heading', { name: 'Thank you for your purchase!' })).toBeVisible();
});

test('checkout recovers when backend returns 400', async ({ page, request }) => {
  test.setTimeout(120_000);
  const sessionId = uniqueSessionId('e2e-cod-fail');
  await page.addInitScript((sid) => {
    localStorage.setItem('lang', 'en');
    localStorage.setItem('cart_session_id', sid);
    localStorage.removeItem('cart_cache');
  }, sessionId);

  const product = await seedCartWithFirstProduct(request, sessionId);
  if (!product) return;

  await loginUi(page);

  const cartLoad = page.waitForResponse(
    (res) => res.url().includes('/api/v1/cart') && res.request().method() === 'GET' && res.status() === 200
  );
  await page.goto('/cart');
  await cartLoad;

  await expect(page.getByText(product.name)).toBeVisible();

  await page.getByRole('link', { name: 'Proceed to checkout' }).click();
  await expect(page).toHaveURL(/\/checkout$/);

  const shippingEmail = OWNER_IDENTIFIER.includes('@') ? OWNER_IDENTIFIER : `${OWNER_IDENTIFIER}@example.com`;
  await fillShippingAddress(page, shippingEmail);

  const codOption = page.getByRole('button', { name: 'Cash on delivery' });
  if (await codOption.isVisible()) {
    await codOption.click();
  }

  const placeOrder = page.getByRole('button', { name: 'Place order' });
  if (await placeOrder.isDisabled()) {
    await acceptCheckoutConsents(page);
  }
  await expect(placeOrder).toBeEnabled();

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
