import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const OWNER_IDENTIFIER = process.env.E2E_OWNER_IDENTIFIER || 'owner';
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD || 'Password123';

async function acceptConsentIfNeeded(page: Page, checkboxIndex: number): Promise<void> {
  const checkbox = page.locator('#checkout-step-4 input[type="checkbox"]').nth(checkboxIndex);
  if (await checkbox.isChecked()) return;
  if (!(await checkbox.isEnabled())) {
    throw new Error(`Consent checkbox ${checkboxIndex} is disabled but not checked.`);
  }

  await checkbox.click();

  const dialog = page.locator('div[role="dialog"][aria-modal="true"]').last();
  const acceptButton = dialog.getByRole('button', { name: 'Accept' });
  await expect(acceptButton).toBeDisabled();

  const body = dialog.locator('div.overflow-y-auto').first();
  await body.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event('scroll'));
  });

  await expect(acceptButton).toBeEnabled();
  await acceptButton.click();
  await expect(dialog).toBeHidden();
  await expect(checkbox).toBeChecked();
}

async function acceptCheckoutConsents(page: Page): Promise<void> {
  await acceptConsentIfNeeded(page, 0);
  await acceptConsentIfNeeded(page, 1);
}

async function loginUi(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(OWNER_IDENTIFIER);
  await page.getByRole('textbox', { name: 'Password' }).fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/account(\/overview)?$/);
}

async function loginApi(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/v1/auth/login', {
    data: { identifier: OWNER_IDENTIFIER, password: OWNER_PASSWORD }
  });
  expect(res.ok()).toBeTruthy();
  const payload = await res.json();
  return payload.tokens.access_token as string;
}

async function seedCartWithFirstProduct(
  request: APIRequestContext,
  sessionId: string
): Promise<{ name: string } | null> {
  const listRes = await request.get('/api/v1/catalog/products?sort=newest&page=1&limit=25');
  expect(listRes.ok()).toBeTruthy();
  const listPayload = (await listRes.json()) as any;

  const items = Array.isArray(listPayload?.items) ? listPayload.items : [];
  const candidates = items
    .filter((p: any) => typeof p?.id === 'string' && p.id.length > 0)
    .filter((p: any) => {
      const stock = typeof p?.stock_quantity === 'number' ? p.stock_quantity : 0;
      return stock > 0 || !!p?.allow_backorder;
    });

  if (!candidates.length) {
    test.skip(true, 'No in-stock products available for Stripe checkout e2e.');
    return null;
  }

  const product = candidates[0];
  const syncRes = await request.post('/api/v1/cart/sync', {
    headers: { 'X-Session-Id': sessionId },
    data: {
      items: [
        {
          product_id: product.id,
          variant_id: null,
          quantity: 1
        }
      ]
    }
  });
  expect(syncRes.ok()).toBeTruthy();
  return { name: String(product?.name ?? '').trim() || 'Item' };
}

async function fillShippingAddress(page: Page, email: string): Promise<void> {
  await page.locator('input[name="name"]').fill('E2E Tester');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="line1"]').fill('Strada Test 1');
  await page.locator('input[name="city"]').fill('București');
  const regionSelect = page.locator('select[name="region"]');
  if (await regionSelect.isVisible()) {
    await regionSelect.selectOption({ label: 'București' });
  } else {
    await page.locator('input[name="region"]').fill('București');
  }
  await page.locator('input[name="postal"]').fill('010000');

  const phoneInput = page.locator('input[name="shippingPhoneNational"]');
  if (await phoneInput.isVisible()) {
    await phoneInput.fill('712345678');
  }
}

async function fetchOrderStatus(request: APIRequestContext, token: string, orderId: string): Promise<string> {
  const res = await request.get(`/api/v1/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok()).toBeTruthy();
  const payload = (await res.json()) as any;
  return String(payload?.status ?? '');
}

async function setSessionCart(page: Page, sessionId: string): Promise<void> {
  await page.evaluate((sid) => {
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

async function startStripeCheckout(
  page: Page,
  request: APIRequestContext
): Promise<{ orderId: string } | null> {
  const sessionId = `e2e-stripe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await setSessionCart(page, sessionId);
  const product = await seedCartWithFirstProduct(request, sessionId);
  if (!product) return null;

  await openCartAndCheckout(page, product.name);

  const shippingEmail = OWNER_IDENTIFIER.includes('@') ? OWNER_IDENTIFIER : `${OWNER_IDENTIFIER}@example.com`;
  await fillShippingAddress(page, shippingEmail);

  await page.getByRole('button', { name: 'Stripe' }).click();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
  await acceptCheckoutConsents(page);
  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled();

  const checkoutResPromise = page.waitForResponse(
    (res) => res.url().includes('/api/v1/orders/checkout') && res.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Place order' }).click();
  const checkoutRes = await checkoutResPromise;
  expect(checkoutRes.ok()).toBeTruthy();
  const payload = (await checkoutRes.json()) as any;
  const orderId = String(payload?.order_id ?? '');
  expect(orderId).toBeTruthy();

  await expect(page).toHaveURL(/\/checkout\/mock\/stripe/);
  return { orderId };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
    localStorage.removeItem('cart_cache');
  });
});

test('stripe checkout (mock): success', async ({ page, request }) => {
  const token = await loginApi(request);
  const sessionId = `e2e-stripe-success-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await setSessionCart(page, sessionId);
  const product = await seedCartWithFirstProduct(request, sessionId);
  if (!product) return;

  await loginUi(page);
  await openCartAndCheckout(page, product.name);

  const shippingEmail = OWNER_IDENTIFIER.includes('@') ? OWNER_IDENTIFIER : `${OWNER_IDENTIFIER}@example.com`;
  await fillShippingAddress(page, shippingEmail);
  await page.getByRole('button', { name: 'Stripe' }).click();

  await acceptCheckoutConsents(page);
  const checkoutResPromise = page.waitForResponse(
    (res) => res.url().includes('/api/v1/orders/checkout') && res.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Place order' }).click();
  const checkoutRes = await checkoutResPromise;
  expect(checkoutRes.ok()).toBeTruthy();
  const checkoutPayload = (await checkoutRes.json()) as any;
  const orderId = String(checkoutPayload?.order_id ?? '');
  expect(orderId).toBeTruthy();

  await expect(page).toHaveURL(/\/checkout\/mock\/stripe/);
  await page.getByRole('button', { name: 'Simulate success' }).click();

  await expect(page).toHaveURL(/\/checkout\/success$/);
  await expect(page.getByRole('heading', { name: 'Thank you for your purchase!' })).toBeVisible();

  const status = await fetchOrderStatus(request, token, orderId);
  expect(status).toBe('pending_acceptance');
});

test('stripe checkout (mock): decline + cancel', async ({ page, request }) => {
  const token = await loginApi(request);
  await loginUi(page);

  const decline = await startStripeCheckout(page, request);
  if (!decline) return;
  await page.getByRole('button', { name: 'Simulate decline' }).click();
  await expect(page.getByText('Payment declined')).toBeVisible();
  expect(await fetchOrderStatus(request, token, decline.orderId)).toBe('pending_payment');

  const cancel = await startStripeCheckout(page, request);
  if (!cancel) return;
  await page.getByRole('button', { name: 'Cancel payment' }).click();
  await expect(page.getByRole('heading', { name: 'Stripe checkout cancelled' })).toBeVisible();
  expect(await fetchOrderStatus(request, token, cancel.orderId)).toBe('pending_payment');
});

