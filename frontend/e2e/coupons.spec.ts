import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

const OWNER_IDENTIFIER = process.env.E2E_OWNER_IDENTIFIER || 'owner';
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD || 'Password123';

async function waitForConsentCheckboxReady(page: Page, checkbox: Locator, checkboxIndex: number): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await checkbox.isChecked()) return;
    if (await checkbox.isEnabled()) return;
    await page.waitForTimeout(250);
  }

  throw new Error(`Consent checkbox ${checkboxIndex} stayed disabled for too long.`);
}

async function acceptConsentIfNeeded(page: Page, checkboxIndex: number): Promise<void> {
  const checkbox = page.locator('#checkout-step-4 input[type="checkbox"]').nth(checkboxIndex);
  await waitForConsentCheckboxReady(page, checkbox, checkboxIndex);
  if (await checkbox.isChecked()) return;
  if (!(await checkbox.isEnabled())) {
    throw new Error(`Consent checkbox ${checkboxIndex} is disabled but not checked.`);
  }

  await checkbox.click();

  const dialog = page.locator('div[role="dialog"][aria-modal="true"]').last();
  const acceptButton = dialog.getByRole('button', { name: 'Accept' });
  await expect(acceptButton).toBeVisible();

  if (await acceptButton.isDisabled()) {
    const body = dialog.locator('div.overflow-y-auto').first();
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll'));
    });

    await expect(acceptButton).toBeEnabled();
  }
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

async function syncCartWithFirstProduct(request: APIRequestContext, sessionId: string): Promise<void> {
  const listRes = await request.get('/api/v1/catalog/products?sort=newest&page=1&limit=25');
  expect(listRes.ok()).toBeTruthy();
  const listPayload = (await listRes.json()) as any;

  const items = Array.isArray(listPayload?.items) ? listPayload.items : [];
  const candidates = items
    .filter((p: any) => typeof p?.id === 'string' && p.id.length > 0)
    .filter((p: any) => {
      const stock = typeof p?.stock_quantity === 'number' ? p.stock_quantity : 0;
      return stock > 0 || !!p?.allow_backorder;
    })
    .slice(0, 10);

  if (!candidates.length) {
    test.skip(true, 'No in-stock products available for coupon e2e.');
    return;
  }

  const product = candidates[0];
  // Use a per-test session cart to avoid cross-test cart races (CI runs tests in parallel).
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
}

async function fillShippingAddress(page: Page, email: string): Promise<void> {
  await page.locator('input[name="name"]').fill('E2E Tester');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="line1"]').fill('Strada Test 1');
  await page.locator('input[name="city"]').fill('București');
  // RO uses a county select, but the field name stays `region`.
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
  const sessionId = `e2e-coupons-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.addInitScript((sid) => {
    localStorage.setItem('cart_session_id', sid);
    localStorage.removeItem('cart_cache');
  }, sessionId);
  await syncCartWithFirstProduct(request, sessionId);

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
  await syncCartWithFirstProduct(request, sessionId);
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
  const sessionId = `guest-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.addInitScript((sid) => {
    localStorage.setItem('cart_session_id', sid);
  }, sessionId);

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
    test.skip(true, 'No in-stock products available for guest coupon restriction e2e.');
    return;
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
