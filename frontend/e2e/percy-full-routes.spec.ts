import { test, type Page } from '@playwright/test';
import percySnapshot from '@percy/playwright';

const FULL_ROUTES: Array<{ name: string; path: string }> = [
  { name: 'Storefront Home EN Full', path: '/?lang=en' },
  { name: 'Storefront Home RO Full', path: '/?lang=ro' },
  { name: 'Storefront Shop EN Full', path: '/shop?lang=en' },
  { name: 'Storefront Shop RO Full', path: '/shop?lang=ro' },
  { name: 'Storefront Blog EN Full', path: '/blog?lang=en' },
  { name: 'Storefront Blog RO Full', path: '/blog?lang=ro' },
  { name: 'Storefront About EN Full', path: '/about?lang=en' },
  { name: 'Storefront Contact EN Full', path: '/contact?lang=en' },
  { name: 'Storefront Error EN Full', path: '/error?lang=en' },
];

async function stabilizePage(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
    localStorage.setItem('analytics.opt_in.v1', '0');
  });
}

async function captureRoute(page: Page, name: string, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'networkidle' });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    `,
  });
  await page.waitForTimeout(250);
  await percySnapshot(page, name, {
    widths: [375, 1280],
    minHeight: 900,
  });
}

async function firstPublishedSlug(page: Page, endpoint: string): Promise<string | null> {
  const response = await page.request.get(endpoint);
  if (!response.ok()) return null;
  const payload = await response.json();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const slug = typeof items[0]?.slug === 'string' ? items[0].slug.trim() : '';
  return slug || null;
}

test('capture expanded storefront route set', async ({ page }) => {
  await stabilizePage(page);
  for (const route of FULL_ROUTES) {
    await captureRoute(page, route.name, route.path);
  }

  const productSlug = await firstPublishedSlug(page, '/api/v1/catalog/products?limit=1&sort=newest');
  if (productSlug) {
    await captureRoute(page, 'Storefront Product EN Full', `/products/${productSlug}?lang=en`);
  }

  const blogSlug = await firstPublishedSlug(page, '/api/v1/content/blog.posts?limit=1&lang=en');
  if (blogSlug) {
    await captureRoute(page, 'Storefront Blog Post EN Full', `/blog/${blogSlug}?lang=en`);
  }
});
