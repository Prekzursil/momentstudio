import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
  });
});

test('shop shows seeded products', async ({ page }) => {
  await page.goto('/shop');
  await expect(page.locator('app-product-card').first()).toBeVisible();
});

test('guest checkout prompts for email verification', async ({ page }) => {
  await page.goto('/shop');
  await page.locator('app-product-card a').first().click();
  await page.getByRole('button', { name: 'Add to cart' }).click();

  await page.goto('/checkout');
  await page.getByLabel('Email').fill('guest-e2e@example.com');
  await page.getByRole('button', { name: 'Send code' }).click();

  await expect(page.getByPlaceholder('Enter verification token')).toBeVisible();
});

test('owner can sign in and reach admin dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill('owner');
  await page.getByLabel('Password').fill('Password123');
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page).toHaveURL(/\/account$/);

  const viewAdmin = page.getByRole('link', { name: 'View admin' });
  await expect(viewAdmin).toBeVisible();
  await viewAdmin.click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Admin dashboard' })).toBeVisible();
});
