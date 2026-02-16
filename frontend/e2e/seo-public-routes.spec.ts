import { expect, test } from '@playwright/test';

const PUBLIC_ROBOTS = 'index,follow,max-image-preview:large';

type SeoSnapshot = {
  title: string;
  description: string;
  robots: string;
  canonicalCount: number;
  canonicalHref: string;
  h1Count: number;
  h1Texts: string[];
};

function snapshotSeo(page): Promise<SeoSnapshot> {
  return page.evaluate(() => {
    const canonicalLinks = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]'));
    const canonicalHref = canonicalLinks[0]?.href || '';
    const robots = document.querySelector<HTMLMetaElement>("meta[name='robots']")?.content?.trim() || '';
    const description = document.querySelector<HTMLMetaElement>("meta[name='description']")?.content?.trim() || '';
    const h1s = Array.from(document.querySelectorAll('h1'));
    const h1Texts = h1s.map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    return {
      title: (document.title || '').trim(),
      description,
      robots,
      canonicalCount: canonicalLinks.length,
      canonicalHref,
      h1Count: h1s.length,
      h1Texts,
    };
  });
}

async function assertPublicRouteSeo(page, route: string, expectedPathname: string): Promise<void> {
  await page.goto(route);
  await page.waitForLoadState('networkidle');

  await expect
    .poll(async () => {
      const robots = await page.locator("meta[name='robots']").getAttribute('content');
      return (robots || '').trim();
    })
    .toBe(PUBLIC_ROBOTS);

  const seo = await snapshotSeo(page);
  expect(seo.title.length).toBeGreaterThan(5);
  expect(seo.description.length).toBeGreaterThan(20);
  expect(seo.canonicalCount).toBe(1);
  expect(seo.h1Count).toBe(1);
  expect(seo.h1Texts.length).toBeGreaterThan(0);

  const currentOrigin = new URL(page.url()).origin;
  const canonical = new URL(seo.canonicalHref, currentOrigin);
  expect(canonical.origin).toBe(currentOrigin);
  expect(canonical.pathname).toBe(expectedPathname);
  // Canonical policy: clean EN URLs (no `?lang=en`), RO keeps `?lang=ro`.
  expect(canonical.searchParams.get('lang')).toBeNull();
  expect(canonical.searchParams.get('q')).toBeNull();
  expect(canonical.searchParams.get('sort')).toBeNull();
}

async function firstPublishedProductSlug(page): Promise<string | null> {
  const response = await page.request.get('/api/v1/catalog/products?limit=1&sort=newest');
  if (!response.ok()) return null;
  const payload = await response.json();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const first = items[0];
  const slug = typeof first?.slug === 'string' ? first.slug.trim() : '';
  return slug || null;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en');
    localStorage.setItem('admin.onboarding.v1', JSON.stringify({ completed_at: new Date().toISOString() }));
  });
});

test('public routes expose valid SEO head metadata', async ({ page }) => {
  await assertPublicRouteSeo(page, '/?lang=en', '/');
  await assertPublicRouteSeo(page, '/shop?lang=en', '/shop');
  await assertPublicRouteSeo(page, '/blog?lang=en', '/blog');

  const slug = await firstPublishedProductSlug(page);
  test.skip(!slug, 'No published product is available for SEO crawl guard.');
  await assertPublicRouteSeo(page, `/products/${slug}?lang=en`, `/products/${slug}`);
});
