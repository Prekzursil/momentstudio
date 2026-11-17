import { ShopComponent } from './shop.component';

/** Golden WU shop-filterchips — filterChips arms. */
describe('ShopComponent filterChips (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    const cats = new Map<string, { name: string; slug: string }>([
      ['cameras', { name: 'Cameras', slug: 'cameras' }],
      ['dslr', { name: 'DSLR', slug: 'dslr' }],
    ]);
    Object.assign(cmp as any, {
      activeCategorySlug: '',
      activeSubcategorySlug: '',
      categoriesBySlug: cats,
      priceMinBound: 0,
      priceMaxBound: 1000,
      filters: { min_price: 0, max_price: 1000, search: '', tags: new Set<string>() },
      allTags: [{ slug: 'new', name: 'New' }],
      translate: {
        instant: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k),
      },
      ...overrides,
    });
    return cmp;
  }

  it('emits sale category chip and named category chip', () => {
    expect(
      createCmp({ activeCategorySlug: 'sale' })
        .filterChips()
        .map((c) => c.id),
    ).toEqual(['category:sale']);
    expect(createCmp({ activeCategorySlug: 'cameras' }).filterChips()[0].label).toBe('Cameras');
  });

  it('emits subcategory, price, search, and tag chips', () => {
    const cmp = createCmp({
      activeCategorySlug: 'cameras',
      activeSubcategorySlug: 'dslr',
      filters: { min_price: 10, max_price: 900, search: ' lens ', tags: new Set(['new']) },
    });
    const ids = cmp.filterChips().map((c) => c.id);
    expect(ids).toContain('subcategory:dslr');
    expect(ids).toContain('price:10-900');
    expect(ids).toContain('search:lens');
    expect(ids).toContain('tag:new');
  });
});
