import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const OWNER_IDENTIFIER = process.env.E2E_OWNER_IDENTIFIER || 'owner';
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD || 'Password123';

async function loginApi(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/v1/auth/login', {
    data: { identifier: OWNER_IDENTIFIER, password: OWNER_PASSWORD }
  });
  expect(res.ok()).toBeTruthy();
  const payload = await res.json();
  return payload.tokens.access_token as string;
}

async function loginUi(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(OWNER_IDENTIFIER);
  await page.getByRole('textbox', { name: 'Password' }).fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/account(\/overview)?$/);
}

async function seedCartWithFirstProduct(request: APIRequestContext, token: string): Promise<{ name: string } | null> {
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
    test.skip(true, 'No in-stock products available for COD checkout e2e.');
    return null;
  }

  const product = candidates[0];
  const syncRes = await request.post('/api/v1/cart/sync', {
    headers: { Authorization: `Bearer ${token}` },
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
  await page.locator('input[name="region"]').fill('București');
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

test('cart → checkout → COD success', async ({ page, request }) => {
  const token = await loginApi(request);
  const product = await seedCartWithFirstProduct(request, token);
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

  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled();
  await page.getByRole('button', { name: 'Place order' }).click();

  await expect(page).toHaveURL(/\/checkout\/success$/);
  await expect(page.getByRole('heading', { name: 'Thank you for your purchase!' })).toBeVisible();
});

