import { ShopComponent } from './shop.component';

describe('ShopComponent filterChips search/tag/max-only (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      activeCategorySlug: '',
      activeSubcategorySlug: '',
      priceMinBound: 0,
      priceMaxBound: 500,
      filters: { min_price: 0, max_price: 500, search: '', tags: new Set<string>() },
      categoriesBySlug: new Map(),
      allTags: [{ slug: 'wood', name: 'Wood' }],
      translate: { instant: (k: string, p?: any) => (p ? `${k}:${JSON.stringify(p)}` : k) },
      ...overrides,
    });
    return cmp;
  }

  it('emits search chip when search trimmed non-empty', () => {
    const cmp = createCmp({
      filters: { min_price: 0, max_price: 500, search: '  oak ', tags: new Set() },
    });
    const chips = cmp.filterChips();
    expect(chips.some((c) => c.type === 'search')).toBe(true);
  });

  it('emits tag chips from filters.tags', () => {
    const cmp = createCmp({
      filters: { min_price: 0, max_price: 500, search: '', tags: new Set(['wood']) },
    });
    expect(cmp.filterChips()).toEqual([
      jasmine.objectContaining({ type: 'tag', value: 'wood', label: 'Wood' }),
    ]);
  });

  it('emits price chip for max-only bound change', () => {
    const cmp = createCmp({
      filters: { min_price: 0, max_price: 200, search: '', tags: new Set() },
    });
    expect(cmp.filterChips().some((c) => c.type === 'price')).toBe(true);
  });
});
