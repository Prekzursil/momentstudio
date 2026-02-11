import { test, expect, type Locator, type Page } from '@playwright/test';
import { uniqueSessionId } from './checkout-helpers';

const OWNER_IDENTIFIER = process.env.E2E_OWNER_IDENTIFIER || 'owner';
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD;

async function tabUntilFocused(page: Page, target: Locator, maxTabs = 20): Promise<void> {
  for (let attempt = 0; attempt < maxTabs; attempt += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Could not focus target with keyboard after ${maxTabs} tabs.`);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
    localStorage.setItem('admin.onboarding.v1', JSON.stringify({ completed_at: new Date().toISOString() }));
  });
});

test('shopper keyboard smoke: login form + legal modal focus loop', async ({ page }) => {
  await page.goto('/login');
  const emailInput = page.getByLabel('Email or username');
  const passwordInput = page.getByRole('textbox', { name: 'Password' });
  const loginButton = page.getByRole('button', { name: 'Login' });

  await expect(emailInput).toBeVisible();
  await emailInput.focus();
  await tabUntilFocused(page, passwordInput, 4);
  await tabUntilFocused(page, loginButton, 20);
  await expect(loginButton).toBeFocused();

  await page.goto('/register');
  const unique = uniqueSessionId('e2e-register').replaceAll(/[^a-z0-9]/gi, '').slice(0, 16);
  const username = `e2e_${unique}`.slice(0, 25);
  const email = `e2e_${unique}@example.com`;
  const password = uniqueSessionId('e2e-pass').slice(0, 24);

  await page.locator('input[name="displayName"]').fill('E2E Tester');
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirm"]').fill(password);
  await page.getByRole('button', { name: 'Next' }).click();

  await page.locator('input[name="firstName"]').fill('E2E');
  await page.locator('input[name="lastName"]').fill('Tester');
  await page.locator('input[name="dateOfBirth"]').fill('2000-01-01');
  await page.locator('input[name="phoneNational"]').fill('723204204');

  const captchaFrame = page.locator('iframe[src*="turnstile"]');
  if (await captchaFrame.isVisible().catch(() => false)) {
    test.skip(true, 'CAPTCHA is enabled; skipping registration legal-modal keyboard smoke.');
    return;
  }

  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByText('This field is required.').first()).toBeVisible();

  const termsCheckbox = page.locator('input[name="acceptTerms"]');
  await expect(termsCheckbox).toBeVisible();
  await termsCheckbox.click();

  const dialog = page.locator('div[role="dialog"][aria-modal="true"]').last();
  const firstClose = dialog.getByRole('button', { name: 'Close' }).first();
  const accept = dialog.getByRole('button', { name: 'Accept' });
  const body = dialog.locator('div.overflow-y-auto').first();
  await expect(dialog).toBeVisible();
  await expect(accept).toBeVisible();

  if (await accept.isDisabled()) {
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll'));
    });
    await expect(accept).toBeEnabled();
  }

  await accept.focus();
  await page.keyboard.press('Tab');
  await expect(firstClose).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(accept).toBeFocused();

  await accept.click();
  await expect(dialog).toBeHidden();
  await expect(termsCheckbox).toBeChecked();
});

test('admin keyboard smoke: route heading focus + filters reachable by tab', async ({ page }) => {
  test.skip(!OWNER_PASSWORD, 'Set E2E_OWNER_PASSWORD to run admin keyboard smoke.');

  await page.goto('/login');
  await page.getByLabel('Email or username').fill(OWNER_IDENTIFIER);
  await page.getByRole('textbox', { name: 'Password' }).fill(OWNER_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/account(\/overview)?$/);

  await page.goto('/admin/orders');
  const heading = page.locator('[data-route-heading="true"]').first();
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();

  const searchInput = page.getByLabel('Search orders');
  await expect(searchInput).toBeVisible();
  await tabUntilFocused(page, searchInput, 24);
  await expect(searchInput).toBeFocused();
});
