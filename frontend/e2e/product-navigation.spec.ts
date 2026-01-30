import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
  });
});

test('product details load on first click', async ({ page, request: apiRequest }) => {
  const listRes = await apiRequest.get('/api/v1/catalog/products?sort=newest&page=1&limit=25');
  expect(listRes.ok()).toBeTruthy();
  const listPayload = (await listRes.json()) as any;

  const items = Array.isArray(listPayload?.items) ? listPayload.items : [];
  const product = items.find((p: any) => typeof p?.slug === 'string' && p.slug.length > 0 && typeof p?.name === 'string' && p.name.length > 0);
  if (!product) {
    test.skip(true, 'No products available for product navigation e2e.');
    return;
  }

  const slug = String(product.slug);
  const name = String(product.name);

  await page.goto('/shop');
  const link = page.locator(`a[href="/products/${slug}"]`).first();
  await expect(link).toBeVisible();
  const productApiPath = `/api/v1/catalog/products/${slug}`;
  const productRequest = page.waitForRequest((req) => req.url().includes(productApiPath));
  const productResponse = page.waitForResponse((res) => res.url().includes(productApiPath));
  await link.click();

  await expect(page).toHaveURL(new RegExp(`/products/${slug}(\\?.*)?$`));
  await productRequest;
  const res = await productResponse;
  expect(res.ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name })).toBeVisible();
});
