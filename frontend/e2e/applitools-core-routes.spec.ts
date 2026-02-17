import { test, type Page } from '@playwright/test';
import { BatchInfo, Configuration, Eyes, Target } from '@applitools/eyes-playwright';

const CORE_ROUTES: Array<{ name: string; path: string }> = [
  { name: 'Storefront Home EN', path: '/?lang=en' },
  { name: 'Storefront Shop EN', path: '/shop?lang=en' },
  { name: 'Storefront Blog EN', path: '/blog?lang=en' },
  { name: 'Storefront About EN', path: '/about?lang=en' },
  { name: 'Storefront Contact EN', path: '/contact?lang=en' },
];

function buildEyesConfiguration(): Configuration {
  const configuration = new Configuration();
  configuration.setApiKey(process.env.APPLITOOLS_API_KEY || '');
  configuration.setAppName('momentstudio');
  configuration.setBatch(new BatchInfo(process.env.APPLITOOLS_BATCH_NAME || 'GitHub CI'));
  configuration.setMatchLevel('Strict');
  return configuration;
}

async function stabilizePage(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
    localStorage.setItem('analytics.opt_in.v1', '0');
  });
}

async function captureRoute(eyes: Eyes, page: Page, routeName: string, path: string): Promise<void> {
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
  await eyes.check(routeName, Target.window().fully());
}

async function firstPublishedProductSlug(page: Page): Promise<string | null> {
  const response = await page.request.get('/api/v1/catalog/products?limit=1&sort=newest');
  if (!response.ok()) return null;
  const payload = await response.json();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const slug = typeof items[0]?.slug === 'string' ? items[0].slug.trim() : '';
  return slug || null;
}

test('capture core storefront routes with Applitools Eyes', async ({ page }, testInfo) => {
  test.skip(!process.env.APPLITOOLS_API_KEY, 'APPLITOOLS_API_KEY is required for Applitools runs');

  const eyes = new Eyes();
  eyes.setConfiguration(buildEyesConfiguration());

  await stabilizePage(page);
  await eyes.open(page, 'momentstudio-storefront', testInfo.title, { width: 1440, height: 900 });

  try {
    for (const route of CORE_ROUTES) {
      await captureRoute(eyes, page, route.name, route.path);
    }

    const productSlug = await firstPublishedProductSlug(page);
    if (productSlug) {
      await captureRoute(eyes, page, 'Storefront Product EN', `/products/${productSlug}?lang=en`);
    }

    await eyes.close(false);
  } finally {
    await eyes.abortIfNotClosed();
  }
});
