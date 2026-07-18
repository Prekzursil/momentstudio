import { applyThemeSsr, STYLE_ELEMENT_ID } from './theme-head';
import { THEMEABLE_STOREFRONT_ROUTES, isThemeableRoute } from './render-mode';
import {
  getThemeTokens,
  invalidateThemeCache,
  type ThemeFetchDeps,
  type ThemeSourceConfig,
} from './theme-source';

const BASE_CONFIG: ThemeSourceConfig = {
  apiBaseUrl: '/api/v1',
  timeoutMs: 2000,
  cacheTtlMs: 30_000,
  killSwitch: false,
};

/** A fetch stub that returns the given published-theme doc as `GET /theme`. */
function fetchReturning(tokens: Record<string, string>): typeof fetch {
  return (() =>
    Promise.resolve(new Response(JSON.stringify({ tokens }), { status: 200 }))) as typeof fetch;
}

function depsWith(fetchImpl: typeof fetch): ThemeFetchDeps {
  return { fetchImpl, now: () => 0 };
}

describe('THEMEABLE_STOREFRONT_ROUTES', () => {
  it('is a frozen list that includes the storefront home', () => {
    expect(Object.isFrozen(THEMEABLE_STOREFRONT_ROUTES)).toBe(true);
    expect(THEMEABLE_STOREFRONT_ROUTES).toContain('/');
  });
});

describe('isThemeableRoute', () => {
  it('classifies the public storefront routes as themeable', () => {
    for (const route of THEMEABLE_STOREFRONT_ROUTES) {
      expect(isThemeableRoute(route)).toBe(true);
    }
  });

  it('classifies admin/account (and their subpaths) as NOT themeable', () => {
    expect(isThemeableRoute('/admin')).toBe(false);
    expect(isThemeableRoute('/admin/theme')).toBe(false);
    expect(isThemeableRoute('/account')).toBe(false);
    expect(isThemeableRoute('/account/orders')).toBe(false);
  });

  it('ignores the query string and hash when classifying', () => {
    expect(isThemeableRoute('/shop?category=rings')).toBe(true);
    expect(isThemeableRoute('/#top')).toBe(true);
    expect(isThemeableRoute('/admin?tab=1')).toBe(false);
    expect(isThemeableRoute('/shop?a=1#frag')).toBe(true);
  });
});

// The request-time render proof: reproduce the EXACT pipeline server.ts runs in
// its per-request middleware (getThemeTokens -> applyThemeSsr) for a themeable
// route, and assert the response is themed request-time — the injected
// hash-pinned <style> + the matching report-only CSP — never a build-time bake.
describe('request-time SSR themed render (server.ts pipeline)', () => {
  beforeEach(() => invalidateThemeCache());
  afterEach(() => invalidateThemeCache());

  const SSR_HTML = '<!DOCTYPE html><html><head><base href="/"></head><body>store</body></html>';

  it('injects the published theme <style> into <head> for a themeable route', async () => {
    const route = '/';
    expect(isThemeableRoute(route)).toBe(true);

    const doc = await getThemeTokens(
      BASE_CONFIG,
      depsWith(fetchReturning({ '--background': '10 20 30', '--accent': '79 70 229' })),
    );
    const themed = await applyThemeSsr(SSR_HTML, doc);

    // Themed at request time: the published values ride the one permitted
    // <style id="ms-theme"> block, and the CSP pins that exact block.
    expect(themed.html).toContain(`<style id="${STYLE_ELEMENT_ID}">`);
    expect(themed.html).toContain('--background: 10 20 30;');
    expect(themed.html).toContain('--accent: 79 70 229;');
    // No-FOUC: the themed :root lands as the first child of <head>.
    const headOpen = themed.html.indexOf('<head>');
    const styleAt = themed.html.indexOf(`<style id="${STYLE_ELEMENT_ID}">`);
    const baseAt = themed.html.indexOf('<base');
    expect(styleAt).toBeGreaterThan(headOpen);
    expect(styleAt).toBeLessThan(baseAt);
    // The report-only CSP carries a style-src hash matching the emitted block.
    expect(themed.cspHeader).toContain("style-src 'sha256-");
    expect(themed.cspHeader).toContain("base-uri 'self'");
  });

  it('degrades a themeable route to compiled defaults on a backend blip (never unstyled/500)', async () => {
    const doc = await getThemeTokens(
      BASE_CONFIG,
      depsWith((() => Promise.reject(new Error('backend down'))) as typeof fetch),
    );
    const themed = await applyThemeSsr(SSR_HTML, doc);
    // Still themed — with the known-safe compiled defaults, not blank.
    expect(themed.html).toContain(`<style id="${STYLE_ELEMENT_ID}">`);
    expect(themed.html).toContain('--background: 255 255 255;');
  });
});
