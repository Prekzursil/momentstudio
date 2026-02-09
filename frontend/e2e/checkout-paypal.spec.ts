import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  acceptCheckoutConsents,
  fillShippingAddress,
  loginApi,
  loginUi,
  OWNER_IDENTIFIER,
  seedCartWithFirstProduct,
  uniqueSessionId
} from './checkout-helpers';

async function fetchOrderStatus(request: APIRequestContext, token: string, orderId: string): Promise<string> {
  const res = await request.get(`/api/v1/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok()).toBeTruthy();
  const payload = (await res.json()) as any;
  return String(payload?.status ?? '');
}

async function readPayPalPendingOrderId(page: Page): Promise<string> {
  const raw = await page.evaluate(() => localStorage.getItem('checkout_paypal_pending'));
  expect(raw).toBeTruthy();
  const parsed = JSON.parse(String(raw)) as any;
  const orderId = String(parsed?.order_id ?? '');
  expect(orderId).toBeTruthy();
  return orderId;
}

async function setSessionCart(page: Page, sessionId: string): Promise<void> {
  await page.addInitScript((sid) => {
    localStorage.setItem('cart_session_id', sid);
    localStorage.removeItem('cart_cache');
  }, sessionId);
}

async function openCartAndCheckout(page: Page, productName: string): Promise<void> {
  const cartLoad = page.waitForResponse(
    (res) => res.url().includes('/api/v1/cart') && res.request().method() === 'GET' && res.status() === 200
  );
  await page.goto('/cart');
  await cartLoad;
  await expect(page.getByText(productName)).toBeVisible();
  await page.getByRole('link', { name: 'Proceed to checkout' }).click();
  await expect(page).toHaveURL(/\/checkout$/);
}

async function startPayPalCheckout(
  page: Page,
  request: APIRequestContext
): Promise<{ orderId: string } | null> {
  const sessionId = uniqueSessionId('e2e-paypal');
  await setSessionCart(page, sessionId);
  const product = await seedCartWithFirstProduct(request, sessionId);
  if (!product) return null;

  await openCartAndCheckout(page, product.name);

  const paypalButton = page.getByRole('button', { name: 'PayPal' });
  if (!(await paypalButton.isVisible()) || (await paypalButton.isDisabled())) {
    test.skip(true, 'PayPal is not enabled/available in this environment.');
    return null;
  }

  const shippingEmail = OWNER_IDENTIFIER.includes('@') ? OWNER_IDENTIFIER : `${OWNER_IDENTIFIER}@example.com`;
  await fillShippingAddress(page, shippingEmail);

  await paypalButton.click();
  await acceptCheckoutConsents(page);
  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled();

  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page).toHaveURL(/\/checkout\/mock\/paypal/);
  const orderId = await readPayPalPendingOrderId(page);
  return { orderId };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
    localStorage.removeItem('cart_cache');
  });
});

test('paypal checkout (mock): success', async ({ page, request }) => {
  test.setTimeout(120_000);
  const token = await loginApi(request);
  await loginUi(page);
  const checkout = await startPayPalCheckout(page, request);
  if (!checkout) return;
  await page.getByRole('button', { name: 'Simulate success' }).click();

  await expect(page).toHaveURL(/\/checkout\/success$/);
  await expect(page.getByRole('heading', { name: 'Thank you for your purchase!' })).toBeVisible();

  const status = await fetchOrderStatus(request, token, checkout.orderId);
  expect(status).toBe('pending_acceptance');
});

test('paypal checkout (mock): decline + cancel', async ({ page, request }) => {
  test.setTimeout(120_000);
  const token = await loginApi(request);
  await loginUi(page);

  const decline = await startPayPalCheckout(page, request);
  if (!decline) return;
  await page.getByRole('button', { name: 'Simulate decline' }).click();
  await expect(page.getByText('Payment declined')).toBeVisible();
  expect(await fetchOrderStatus(request, token, decline.orderId)).toBe('pending_payment');

  const cancel = await startPayPalCheckout(page, request);
  if (!cancel) return;
  await page.getByRole('button', { name: 'Cancel payment' }).click();
  await expect(page.getByRole('heading', { name: 'PayPal checkout cancelled' })).toBeVisible();
  expect(await fetchOrderStatus(request, token, cancel.orderId)).toBe('pending_payment');
});
