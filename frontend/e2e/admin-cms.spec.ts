import { test, expect, type Page } from '@playwright/test';

async function loginAsOwner(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill('owner');
  await page.getByLabel('Password').fill('Password123');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/account$/);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
  });
});

test('owner can update About page via CMS and audit log records it', async ({ page }) => {
  await loginAsOwner(page);

  const marker = `E2E Our story ${Date.now()}`;

  await page.goto('/admin/content/pages');
  const aboutField = page.getByLabel('Our story (About)');
  await expect(aboutField).toBeVisible();
  // Wait for the CMS content to finish loading so it doesn't overwrite our edits.
  await expect(aboutField).not.toHaveValue('');
  await aboutField.fill(marker);
  await page.getByRole('button', { name: 'Save about' }).click();
  await expect(page.getByText('Content saved.')).toBeVisible();

  await page.goto('/about');
  await expect(page.getByText(marker)).toBeVisible();

  await page.goto('/admin/dashboard');
  await page.getByLabel('Entity').selectOption('content');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('page.about')).toBeVisible();
});

test('owner can toggle homepage sections via CMS', async ({ page }) => {
  await loginAsOwner(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Why this starter' })).toBeVisible();

  await page.goto('/admin/content/home');
  const sectionsPanel = page.locator('section', { has: page.getByRole('heading', { name: 'Homepage sections order' }) });
  await expect(sectionsPanel).toBeVisible();

  const whyRow = sectionsPanel
    .locator('div[draggable="true"]')
    .filter({ has: page.locator('span', { hasText: /^why$/ }) })
    .first();
  await expect(whyRow).toBeVisible();

  const checkbox = whyRow.locator('input[type="checkbox"]').first();
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();

  await sectionsPanel.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Sections order saved.')).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Why this starter' })).not.toBeVisible();
});

test('owner can create a published blog post from CMS', async ({ page }) => {
  await loginAsOwner(page);

  const slug = `e2e-post-${Date.now()}`;
  const title = `E2E post ${Date.now()}`;

  await page.goto('/admin/content/blog');
  await page.getByRole('button', { name: 'New post' }).click();
  await expect(page.getByText('Create blog post')).toBeVisible();

  await page.getByLabel('Slug').fill(slug);
  await page.getByLabel('Status').selectOption('published');
  await page.getByLabel('Title').fill(title);

  // Use the plain Markdown editor in CI to avoid rich-editor visibility flakiness.
  const richToggle = page.getByRole('checkbox', { name: 'Rich editor' });
  await expect(richToggle).toBeVisible();
  await richToggle.uncheck();

  const bodyTextarea = page.locator('textarea[rows="10"]').first();
  await expect(bodyTextarea).toBeVisible();
  await bodyTextarea.fill(`Hello from Playwright. ${title}`);

  await page.getByRole('button', { name: 'Create post' }).click();
  await expect(page.getByText('Blog post created')).toBeVisible();

  await page.goto(`/blog/${slug}`);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
});
