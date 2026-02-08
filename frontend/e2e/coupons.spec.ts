import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  acceptCheckoutConsents,
  fillShippingAddress,
  loginApi,
  loginUi,
  OWNER_IDENTIFIER,
  seedCartWithFirstProduct,
  uniqueSessionId
} from './checkout-helpers';

async function createCoupon(request: APIRequestContext, token: string): Promise<string> {
  const promotionName = `E2E Coupon ${Date.now()}`;
  const promoRes = await request.post('/api/v1/coupons/admin/promotions', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: promotionName,
      description: 'E2E test promotion',
      discount_type: 'percent',
      percentage_off: 10,
      allow_on_sale_items: true,
      is_active: true,
      is_automatic: false
    }
  });
  expect(promoRes.ok()).toBeTruthy();
  const promo = await promoRes.json();

  const code = `E2E10-${Date.now().toString(36).toUpperCase()}`.slice(0, 40);
  const couponRes = await request.post('/api/v1/coupons/admin/coupons', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      promotion_id: promo.id,
      code,
      visibility: 'public',
      is_active: true,
      per_customer_max_redemptions: 1
    }
  });
  expect(couponRes.ok()).toBeTruthy();
  const coupon = await couponRes.json();
  return coupon.code as string;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
    localStorage.removeItem('cart_cache');
  });
});

test('coupons v2: apply coupon and prevent reuse after redemption', async ({ page, request }) => {
  test.setTimeout(120_000);
  const token = await loginApi(request);
  const code = await createCoupon(request, token);
  const sessionId = uniqueSessionId('e2e-coupons');
  await page.addInitScript((sid) => {
    localStorage.setItem('cart_session_id', sid);
    localStorage.removeItem('cart_cache');
  }, sessionId);
  const product = await seedCartWithFirstProduct(request, sessionId);
  if (!product) return;

  await loginUi(page);

  await page.evaluate(() => localStorage.removeItem('cart_cache'));
  const cartLoad = page.waitForResponse(
    (res) => res.url().includes('/api/v1/cart') && res.request().method() === 'GET' && res.status() === 200
  );
  await page.goto('/cart');
  await cartLoad;
  await expect(page.getByRole('link', { name: 'Proceed to checkout' })).toBeVisible();
  await page.getByRole('link', { name: 'Proceed to checkout' }).click();
  await expect(page).toHaveURL(/\/checkout$/);

  const promoInput = page.locator('input[name="promo"]');
  await expect(promoInput).toBeVisible();
  await promoInput.fill(code);
  await page.getByRole('button', { name: 'Apply' }).first().click();

  await expect(page.getByText(`Promo ${code} applied.`)).toBeVisible();
  await expect(page.locator('aside span.text-emerald-700')).toBeVisible();

  // Complete a COD checkout (redemption happens on order creation for COD).
  const shippingEmail = OWNER_IDENTIFIER.includes('@') ? OWNER_IDENTIFIER : `${OWNER_IDENTIFIER}@example.com`;
  await fillShippingAddress(page, shippingEmail);
  await acceptCheckoutConsents(page);
  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled();
  await page.getByRole('button', { name: 'Place order' }).click();

  await expect(page).toHaveURL(/\/checkout\/success$/);
  await expect(page.getByRole('heading', { name: 'Thank you for your purchase!' })).toBeVisible();

  // Add again and ensure the same coupon cannot be redeemed twice.
  const product2 = await seedCartWithFirstProduct(request, sessionId);
  if (!product2) return;
  await page.evaluate(() => localStorage.removeItem('cart_cache'));
  const cartLoad2 = page.waitForResponse(
    (res) => res.url().includes('/api/v1/cart') && res.request().method() === 'GET' && res.status() === 200
  );
  await page.goto('/cart');
  await cartLoad2;
  await page.getByRole('link', { name: 'Proceed to checkout' }).click();
  await expect(page).toHaveURL(/\/checkout$/);

  await page.locator('input[name="promo"]').fill(code);
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Coupon not eligible')).toBeVisible();
  await expect(page.getByText('You already used this coupon')).toBeVisible();
});

test('coupons v2: guests are prompted to sign in', async ({ page, request }) => {
  const sessionId = uniqueSessionId('guest-e2e');
  await page.addInitScript((sid) => {
    localStorage.setItem('cart_session_id', sid);
  }, sessionId);

  const product = await seedCartWithFirstProduct(request, sessionId);
  if (!product) return;

  const cartLoad = page.waitForResponse(
    (res) => res.url().includes('/api/v1/cart') && res.request().method() === 'GET' && res.status() === 200
  );
  await page.goto('/cart');
  await cartLoad;

  await page.getByRole('link', { name: 'Proceed to checkout' }).click();
  await expect(page).toHaveURL(/\/checkout$/);

  await expect(page.getByText('Sign in to use coupons.')).toBeVisible();
  await expect(page.locator('#checkout-step-3').getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('input[name="promo"]')).toHaveCount(0);
});
