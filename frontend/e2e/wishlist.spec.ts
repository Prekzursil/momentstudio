import { test, expect, type Page } from '@playwright/test';

const OWNER_IDENTIFIER = process.env.E2E_OWNER_IDENTIFIER || 'owner';
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD || 'Password123';

async function loginAsOwner(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(OWNER_IDENTIFIER);
  await page.getByLabel('Password').fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/account(\/overview)?$/);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
  });
});

test('wishlist add/remove persists across account wishlist', async ({ page }) => {
  await loginAsOwner(page);

  await page.goto('/shop');
  await expect(page.locator('app-header').getByRole('link', { name: 'Sign in' })).toBeHidden({ timeout: 20_000 });
  const productCard = page.locator('app-product-card').first();
  const emptyState = page.getByText('No products found');
  const errorState = page.getByText('We hit a snag loading products.');

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await errorState.isVisible()) {
      throw new Error('Shop failed to load products.');
    }
    if (await productCard.isVisible()) {
      break;
    }
    if (await emptyState.isVisible()) {
      test.skip(true, 'No products available to wishlist.');
      return;
    }
    await page.waitForTimeout(250);
  }

  await expect(productCard).toBeVisible();

  const productName = (await productCard.locator('a.font-semibold').first().innerText()).trim();
  expect(productName).not.toBe('');

  const wishlistButton = productCard.locator('button[aria-pressed]').first();
  await expect(wishlistButton).toBeVisible();

  // Ensure a consistent starting state.
  if ((await wishlistButton.getAttribute('aria-pressed')) === 'true') {
    const remove = page.waitForResponse((res) => {
      if (!res.url().includes('/api/v1/wishlist/')) return false;
      return res.request().method() === 'DELETE' && [200, 204].includes(res.status());
    });
    await wishlistButton.click();
    await remove;
  }

  const add = page.waitForResponse((res) => {
    if (!res.url().includes('/api/v1/wishlist/')) return false;
    return res.request().method() === 'POST' && [200, 201].includes(res.status());
  });
  await wishlistButton.click();
  await add;

  await page.goto('/account/wishlist');
  await expect(page.getByRole('heading', { name: 'My wishlist' })).toBeVisible();

  const wishlistedCard = page.locator('app-product-card', { has: page.getByRole('link', { name: productName }) }).first();
  await expect(wishlistedCard).toBeVisible();

  const removeFromWishlistButton = wishlistedCard.locator('button[aria-pressed]').first();
  await expect(removeFromWishlistButton).toBeVisible();

  const removeFromWishlist = page.waitForResponse((res) => {
    if (!res.url().includes('/api/v1/wishlist/')) return false;
    return res.request().method() === 'DELETE' && [200, 204].includes(res.status());
  });
  await removeFromWishlistButton.click();
  await removeFromWishlist;

  await expect(page.getByRole('link', { name: productName })).not.toBeVisible();
});
