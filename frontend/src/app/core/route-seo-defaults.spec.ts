import { appConfig } from './app-config';
import { resolveRouteSeoDescription } from './route-seo-defaults';

describe('resolveRouteSeoDescription', () => {
  let originalSiteName: unknown;

  beforeEach(() => {
    originalSiteName = (appConfig as unknown as Record<string, unknown>)['siteName'];
  });

  afterEach(() => {
    (appConfig as unknown as Record<string, unknown>)['siteName'] = originalSiteName;
  });

  it('returns the first usable candidate', () => {
    expect(resolveRouteSeoDescription('home', 'en', '   ', 'Real description')).toBe(
      'Real description',
    );
  });

  it('collapses whitespace in candidates', () => {
    expect(resolveRouteSeoDescription('home', 'en', '  multi   space\ntext  ')).toBe(
      'multi space text',
    );
  });

  it('ignores non-string/number/boolean candidates', () => {
    expect(resolveRouteSeoDescription('shop', 'en', {}, [], null, undefined, 'kept')).toBe('kept');
  });

  it('accepts number and boolean candidates', () => {
    expect(resolveRouteSeoDescription('shop', 'en', 42)).toBe('42');
    expect(resolveRouteSeoDescription('shop', 'en', '', true)).toBe('true');
  });

  it('ignores unresolved translation keys', () => {
    expect(resolveRouteSeoDescription('blog', 'en', 'seo.home.description')).toContain('practical');
  });

  it('falls back to the route default when no candidate is usable', () => {
    (appConfig as unknown as Record<string, unknown>)['siteName'] = 'Acme';
    expect(resolveRouteSeoDescription('home', 'en')).toContain('Acme');
    expect(resolveRouteSeoDescription('home', 'ro')).toContain('Acme');
  });

  it('uses the default brand when siteName is whitespace only', () => {
    (appConfig as unknown as Record<string, unknown>)['siteName'] = '   ';
    expect(resolveRouteSeoDescription('about', 'en')).toContain('momentstudio');
  });

  it('uses the default brand when siteName is falsy', () => {
    (appConfig as unknown as Record<string, unknown>)['siteName'] = '';
    expect(resolveRouteSeoDescription('about', 'en')).toContain('momentstudio');
    (appConfig as unknown as Record<string, unknown>)['siteName'] = undefined;
    expect(resolveRouteSeoDescription('about', 'ro')).toContain('momentstudio');
  });

  it('provides fallbacks for every route key in both languages', () => {
    const routes = [
      'home',
      'shop',
      'blog',
      'blog_post',
      'page',
      'product',
      'about',
      'contact',
    ] as const;
    for (const route of routes) {
      expect(resolveRouteSeoDescription(route, 'en').length).toBeGreaterThan(0);
      expect(resolveRouteSeoDescription(route, 'ro').length).toBeGreaterThan(0);
    }
  });
});
