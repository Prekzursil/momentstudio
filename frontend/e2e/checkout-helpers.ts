import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export const OWNER_IDENTIFIER = process.env.E2E_OWNER_IDENTIFIER || 'owner';

function ownerPassword(): string {
  const password = process.env.E2E_OWNER_PASSWORD;
  if (password) return password;
  throw new Error(
    'E2E_OWNER_PASSWORD is required to run checkout Playwright tests. Set it to the owner password used by `bootstrap-owner`.'
  );
}

export function uniqueSessionId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function waitForConsentCheckboxReady(page: Page, checkbox: Locator, checkboxIndex: number): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await checkbox.isChecked()) return;
    if (await checkbox.isEnabled()) return;
    await page.waitForTimeout(250);
  }

  throw new Error(`Consent checkbox ${checkboxIndex} stayed disabled for too long.`);
}

async function acceptConsentIfNeeded(page: Page, checkboxIndex: number): Promise<void> {
  const checkbox = page.locator('#checkout-step-4 input[type="checkbox"]').nth(checkboxIndex);
  await waitForConsentCheckboxReady(page, checkbox, checkboxIndex);
  if (await checkbox.isChecked()) return;
  if (!(await checkbox.isEnabled())) {
    throw new Error(`Consent checkbox ${checkboxIndex} is disabled but not checked.`);
  }

  const slug = checkboxIndex === 0 ? 'terms-and-conditions' : 'privacy-policy';
  const contentResponse = page
    .waitForResponse((res) => res.url().includes(`/api/v1/content/pages/${slug}`) && res.status() === 200, {
      timeout: 10_000
    })
    .catch(() => null);
  await checkbox.click();
  await contentResponse;

  const dialog = page.locator('div[role="dialog"][aria-modal="true"]').last();
  const acceptButton = dialog.getByRole('button', { name: 'Accept' });
  await expect(acceptButton).toBeVisible();
  if (await acceptButton.isDisabled()) {
    const body = dialog.locator('div.overflow-y-auto').first();
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll'));
    });
    await expect(acceptButton).toBeEnabled();
  }
  await acceptButton.click();
  await expect(dialog).toBeHidden();
  await expect(checkbox).toBeChecked();
}

export async function acceptCheckoutConsents(page: Page): Promise<void> {
  await acceptConsentIfNeeded(page, 0);
  await acceptConsentIfNeeded(page, 1);
}

export async function loginUi(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(OWNER_IDENTIFIER);
  await page.getByRole('textbox', { name: 'Password' }).fill(ownerPassword());
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/account(\/overview)?$/);
}

export async function loginApi(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/v1/auth/login', {
    data: { identifier: OWNER_IDENTIFIER, password: ownerPassword() }
  });
  expect(res.ok()).toBeTruthy();
  const payload = await res.json();
  return payload.tokens.access_token as string;
}

export async function seedCartWithFirstProduct(
  request: APIRequestContext,
  sessionId: string,
  options: { skipMessage?: string } = {}
): Promise<{ name: string } | null> {
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
    test.skip(true, options.skipMessage ?? 'No in-stock products available for checkout e2e.');
    return null;
  }

  const product = candidates[0];
  // Use a per-test session cart to avoid cross-test cart races (CI runs tests in parallel).
  // Authenticated pages will still pick up this session cart if no user cart exists.
  const syncRes = await request.post('/api/v1/cart/sync', {
    headers: { 'X-Session-Id': sessionId },
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

export async function fillShippingAddress(page: Page, email: string): Promise<void> {
  await page.locator('input[name="name"]').fill('E2E Tester');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="line1"]').fill('Strada Test 1');
  await page.locator('input[name="city"]').fill('București');
  // RO uses a county select, but the field name stays `region`.
  const regionSelect = page.locator('select[name="region"]');
  if (await regionSelect.isVisible()) {
    await regionSelect.selectOption({ label: 'București' });
  } else {
    await page.locator('input[name="region"]').fill('București');
  }
  await page.locator('input[name="postal"]').fill('010000');

  const phoneInput = page.locator('input[name="shippingPhoneNational"]');
  if (await phoneInput.isVisible()) {
    await phoneInput.fill('712345678');
  }
}

