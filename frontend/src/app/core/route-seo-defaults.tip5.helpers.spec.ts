import { resolveRouteSeoDescription } from './route-seo-defaults';

/** Golden WU tip orphan — resolveRouteSeoDescription. */
describe('resolveRouteSeoDescription (golden WU tip5)', () => {
  it('uses the first valid candidate or route fallback', () => {
    expect(resolveRouteSeoDescription('shop', 'en', '  Custom shop copy  ')).toBe('Custom shop copy');
    expect(resolveRouteSeoDescription('shop', 'en', 'shop.title.key')).toContain('Browse handmade');
  });
});
