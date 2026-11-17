import { ShopComponent } from './shop.component';

describe('ShopComponent removeChip search/tag + onSearch (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      cancelFilterDebounce: jasmine.createSpy('cancelFilterDebounce'),
      applyFilters: jasmine.createSpy('applyFilters'),
      loadProducts: jasmine.createSpy('loadProducts'),
      priceMinBound: 0,
      priceMaxBound: 1000,
      activeCategorySlug: 'cat',
      activeSubcategorySlug: 'sub',
      categorySelection: 'cat',
      filters: {
        page: 2,
        search: 'oak',
        tags: new Set(['wood', 'sale']),
        min_price: 10,
        max_price: 900,
      },
      ...overrides,
    });
    return cmp;
  }

  it('removeChip search clears search and applyFilters', () => {
    const cmp = createCmp();
    cmp.removeChip({ id: 'search:oak', type: 'search', label: 'oak' } as any);
    expect((cmp as any).cancelFilterDebounce).toHaveBeenCalled();
    expect((cmp as any).filters.page).toBe(1);
    expect((cmp as any).filters.search).toBe('');
    expect((cmp as any).applyFilters).toHaveBeenCalled();
  });

  it('removeChip tag deletes value and applyFilters', () => {
    const cmp = createCmp();
    cmp.removeChip({ id: 'tag:wood', type: 'tag', label: 'Wood', value: 'wood' } as any);
    expect((cmp as any).filters.tags.has('wood')).toBe(false);
    expect((cmp as any).filters.tags.has('sale')).toBe(true);
    expect((cmp as any).applyFilters).toHaveBeenCalled();
  });

  it('onSearch delegates to applyFilters', () => {
    const cmp = createCmp();
    cmp.onSearch();
    expect((cmp as any).applyFilters).toHaveBeenCalled();
  });
});
