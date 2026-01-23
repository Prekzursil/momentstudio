import { test, expect, type Page } from '@playwright/test';

const OWNER_IDENTIFIER = process.env.E2E_OWNER_IDENTIFIER || 'owner';
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD || 'Password123';

async function loginAsOwner(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(OWNER_IDENTIFIER);
  await page.getByRole('textbox', { name: 'Password' }).fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/account(\/overview)?$/);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
  });
});

test('owner can update About page via CMS and audit log records it', async ({ page }) => {
  await loginAsOwner(page);

  const marker = `E2E Our story ${Date.now()}`;

  // The admin UI loads EN then RO and only updates the textbox once both complete.
  // If we type too early, the RO fetch can overwrite our edits (flake on CI).
  const aboutLoadEn = page.waitForResponse((resp) => {
    if (!resp.url().includes('/content/admin/page.about?lang=en')) return false;
    if (resp.request().method() !== 'GET') return false;
    return [200, 404].includes(resp.status());
  });
  const aboutLoadRo = page.waitForResponse((resp) => {
    if (!resp.url().includes('/content/admin/page.about?lang=ro')) return false;
    if (resp.request().method() !== 'GET') return false;
    return [200, 404].includes(resp.status());
  });
  await Promise.all([aboutLoadEn, aboutLoadRo, page.goto('/admin/content/pages')]);

  const aboutField = page.getByRole('textbox', { name: 'Our story (About)' });
  await expect(aboutField).toBeVisible();
  await aboutField.fill(marker);
  await expect(aboutField).toHaveValue(marker);

  const saveAboutResponse = page.waitForResponse((resp) => {
    if (!resp.url().includes('/content/admin/page.about')) return false;
    if (![200, 201].includes(resp.status())) return false;
    return ['PATCH', 'POST'].includes(resp.request().method());
  });
  await Promise.all([saveAboutResponse, page.getByRole('button', { name: 'Save about' }).click()]);
  const saved = await (await saveAboutResponse).json();
  expect(String(saved?.body_markdown || '')).toContain(marker);

  const publicAboutResponse = page.waitForResponse((resp) => {
    if (!resp.url().includes('/content/pages/about')) return false;
    if (resp.request().method() !== 'GET') return false;
    return resp.status() === 200;
  });
  await Promise.all([publicAboutResponse, page.goto('/about')]);
  await expect(page.getByText(marker)).toBeVisible({ timeout: 30_000 });

  await page.goto('/admin/dashboard');
  await page.getByLabel('Entity').selectOption('content');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('page.about').first()).toBeVisible();
});

test('owner can toggle homepage sections via CMS', async ({ page }) => {
  await loginAsOwner(page);

  await page.goto('/admin/content/home');
  const sectionsPanel = page.locator('section', { has: page.getByRole('heading', { name: 'Homepage sections order' }) });
  await expect(sectionsPanel).toBeVisible();

  const featuredRow = sectionsPanel
    .locator('div[draggable="true"]')
    .filter({ has: page.locator('span', { hasText: /^Featured products$/ }) })
    .first();
  await expect(featuredRow).toBeVisible();

  const saveSections = async (): Promise<void> => {
    const saveSectionsResponse = page.waitForResponse((resp) => {
      if (!resp.url().includes('/content/admin/home.sections')) return false;
      if (![200, 201].includes(resp.status())) return false;
      return ['PATCH', 'POST'].includes(resp.request().method());
    });
    await Promise.all([saveSectionsResponse, sectionsPanel.getByRole('button', { name: 'Save' }).click()]);
  };

  const checkbox = featuredRow.locator('input[type="checkbox"]').first();
  if (!(await checkbox.isChecked())) {
    await checkbox.check();
    await saveSections();
  }

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Featured pieces' })).toBeVisible();

  await page.goto('/admin/content/home');
  await expect(sectionsPanel).toBeVisible();
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
  await saveSections();

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Featured pieces' })).not.toBeVisible();
});

test('owner can create a published blog post from CMS', async ({ page }) => {
  await loginAsOwner(page);

  const now = Date.now();
  const slug = `e2e-post-${now}`;
  const title = `E2E post ${now}`;

  await page.goto('/admin/content/blog');
  await page.getByRole('button', { name: 'New post' }).click();
  await expect(page.getByText('Create blog post')).toBeVisible();

  await page.getByLabel('Status').selectOption('published');
  await page.getByLabel('Title').fill(title);

  const editorRoot = page.locator('app-rich-editor .toastui-editor-defaultUI').first();
  await expect(editorRoot).toBeVisible();
  const editorBody = editorRoot.locator('.ProseMirror:visible').first();
  await expect(editorBody).toBeVisible();
  await editorBody.fill(`Hello from Playwright. ${title}`);

  const createPostResponse = page.waitForResponse((resp) => {
    if (!resp.url().includes(`/content/admin/blog.${slug}`)) return false;
    if (![200, 201].includes(resp.status())) return false;
    return ['PATCH', 'POST'].includes(resp.request().method());
  });
  await Promise.all([createPostResponse, page.getByRole('button', { name: 'Create post' }).click()]);

  await page.goto(`/blog/${slug}`);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
});
