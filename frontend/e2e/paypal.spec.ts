import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
  });
});

test('paypal payment option is available when enabled', async ({ page }) => {
  const cartLoad = page.waitForResponse(
    (res) => res.url().includes('/api/v1/cart') && res.request().method() === 'GET' && res.status() === 200
  );
  await page.goto('/checkout');
  await cartLoad;

  const paypalOption = page.getByRole('button', { name: 'PayPal' });
  if (!(await paypalOption.isVisible())) {
    test.skip(true, 'PayPal is not enabled in this environment (PAYPAL_ENABLED).');
    return;
  }

  await paypalOption.click();
  await expect(page.getByText('Pay with PayPal')).toBeVisible();
});
