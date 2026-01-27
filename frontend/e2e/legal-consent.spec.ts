import { test, expect, type Page } from '@playwright/test';

async function acceptLegalModal(page: Page): Promise<void> {
  const dialog = page.locator('div[role="dialog"][aria-modal="true"]').last();
  const acceptButton = dialog.getByRole('button', { name: 'Accept' });
  await expect(acceptButton).toBeDisabled();

  const body = dialog.locator('div.overflow-y-auto').first();
  await body.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event('scroll'));
  });

  await expect(acceptButton).toBeEnabled();
  await acceptButton.click();
  await expect(dialog).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
  });
});

test('registration requires reading legal docs in a scroll-to-accept modal', async ({ page }) => {
  await page.goto('/register');

  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const username = `e2e_${unique}`.slice(0, 25);
  const email = `e2e_${unique}@example.com`;

  await page.locator('input[name="displayName"]').fill('E2E Tester');
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill('secret123');
  await page.locator('input[name="confirm"]').fill('secret123');
  await page.getByRole('button', { name: 'Next' }).click();

  await page.locator('input[name="firstName"]').fill('E2E');
  await page.locator('input[name="lastName"]').fill('Tester');
  await page.locator('input[name="dateOfBirth"]').fill('2000-01-01');
  await page.locator('input[name="phoneNational"]').fill('723204204');

  const captchaFrame = page.locator('iframe[src*="turnstile"]');
  if (await captchaFrame.isVisible().catch(() => false)) {
    test.skip(true, 'CAPTCHA is enabled; skipping registration consent e2e.');
    return;
  }

  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByText('This field is required.')).toBeVisible();

  const termsResponse = page.waitForResponse(
    (res) => res.url().includes('/api/v1/content/pages/terms-and-conditions') && res.status() === 200
  );
  await page.locator('input[name="acceptTerms"]').click();
  await termsResponse;
  await acceptLegalModal(page);
  await expect(page.locator('input[name="acceptTerms"]')).toBeChecked();

  const privacyResponse = page.waitForResponse(
    (res) => res.url().includes('/api/v1/content/pages/privacy-policy') && res.status() === 200
  );
  await page.locator('input[name="acceptPrivacy"]').click();
  await privacyResponse;
  await acceptLegalModal(page);
  await expect(page.locator('input[name="acceptPrivacy"]')).toBeChecked();
});

