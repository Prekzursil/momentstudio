import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
  });
});

test('PayPal return/cancel routes render (smoke)', async ({ page }) => {
  await page.goto('/checkout/paypal/return');
  await expect(page.getByText('Missing PayPal return token.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to checkout' })).toBeVisible();

  await page.goto('/checkout/paypal/return?token=EC-FAKE123&PayerID=FAKE');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 35000 });
  await expect(page.getByText(/Confirming your PayPal payment/i)).not.toBeVisible();

  await page.goto('/checkout/paypal/cancel');
  await expect(page.getByRole('heading', { name: 'PayPal checkout cancelled' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to checkout' })).toBeVisible();
});

test('Stripe return/cancel routes render (smoke)', async ({ page }) => {
  await page.goto('/checkout/stripe/return');
  await expect(page.getByText('Missing Stripe session id.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to checkout' })).toBeVisible();

  await page.goto('/checkout/stripe/cancel');
  await expect(page.getByRole('heading', { name: 'Stripe checkout cancelled' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to checkout' })).toBeVisible();
});

test('Netopia return route renders actionable errors (smoke)', async ({ page }) => {
  await page.goto('/checkout/netopia/return');
  await expect(page.getByText('Missing Netopia order id.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to checkout' })).toBeVisible();

  await page.goto('/checkout/netopia/return?order_id=fake-order');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 35000 });
  await expect(page.getByText(/Confirming your Netopia payment/i)).not.toBeVisible();
});
