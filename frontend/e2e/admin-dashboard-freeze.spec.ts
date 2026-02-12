import { expect, test } from '@playwright/test';

import { loginUi } from './checkout-helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
    localStorage.setItem('admin.onboarding.v1', JSON.stringify({ completed_at: new Date().toISOString() }));
  });
});

test('admin dashboard stays responsive after View admin navigation', async ({ page }) => {
  await loginUi(page);

  const viewAdmin = page.getByRole('link', { name: 'View admin' }).first();
  await expect(viewAdmin).toBeVisible();
  await viewAdmin.click();

  await expect(page).toHaveURL(/\/admin\/dashboard/);
  await expect(page.locator('app-admin-layout')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('app-admin-dashboard')).toBeVisible({ timeout: 15_000 });

  await page.waitForTimeout(10_000);

  const probe = await Promise.race([
    page.evaluate(() => ({
      href: location.href,
      readyState: document.readyState,
      hasLayout: Boolean(document.querySelector('app-admin-layout')),
      hasDashboard: Boolean(document.querySelector('app-admin-dashboard')),
      bodyTextLength: document.body?.innerText?.length ?? 0
    })),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('admin main-thread lock detected')), 2_000);
    })
  ]);

  expect(probe.hasLayout).toBe(true);
  expect(probe.hasDashboard).toBe(true);
  expect(probe.bodyTextLength).toBeGreaterThan(400);
});
