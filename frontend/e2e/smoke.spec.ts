import { test, expect } from '@playwright/test';

const OWNER_IDENTIFIER = process.env.E2E_OWNER_IDENTIFIER || 'owner';
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD || 'Password123';

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
  const sessionId = `guest-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.addInitScript((sid) => {
    localStorage.setItem('cart_session_id', sid);
    localStorage.removeItem('cart_cache');
  }, sessionId);

  const listRes = await apiRequest.get('/api/v1/catalog/products?sort=newest&page=1&limit=25');
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
    test.skip(true, 'No in-stock products available for guest checkout e2e.');
    return;
  }

  const product = candidates[0];
  const syncRes = await apiRequest.post('/api/v1/cart/sync', {
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

  const proceed = page.getByRole('link', { name: 'Proceed to checkout' });
  await expect(proceed).toBeVisible();
  await proceed.click();
  await expect(page).toHaveURL(/\/checkout/);
  const email = `guest-e2e-${Date.now()}@example.com`;
  await page.getByLabel('Email').fill(email);

  const emailRequest = page.waitForResponse((res) =>
    res.url().includes('/api/v1/orders/guest-checkout/email/request')
  );
  await page.getByRole('button', { name: 'Send code' }).click();
  const response = await emailRequest;
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

  await expect(page).toHaveURL(/\/admin\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Admin dashboard' })).toBeVisible();
});
