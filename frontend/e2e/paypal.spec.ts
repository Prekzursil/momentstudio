import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
  });
});

test('paypal payment option is available when enabled', async ({ page }) => {
  test.skip(process.env.E2E_PAYPAL !== '1', 'Set E2E_PAYPAL=1 to enable PayPal UI checks.');

  const sync = page.waitForResponse((res) => res.url().includes('/api/v1/cart/sync'));
  await page.goto('/checkout');
  await sync;

  const paypalOption = page.getByRole('button', { name: 'PayPal' });
  if (!(await paypalOption.isVisible())) {
    test.skip(true, 'PayPal is not enabled in this environment (PAYPAL_ENABLED).');
    return;
  }

  await paypalOption.click();
  await expect(page.getByText('Pay with PayPal')).toBeVisible();
});
