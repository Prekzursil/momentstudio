import { ShopComponent } from './shop.component';

/** Golden WU shop-removechip — removeChip type arms. */
describe('ShopComponent removeChip (golden WU)', () => {
  function createCmp() {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      cancelFilterDebounce: jasmine.createSpy('cancelFilterDebounce'),
      loadProducts: jasmine.createSpy('loadProducts'),
      applyFilters: jasmine.createSpy('applyFilters'),
      activeCategorySlug: 'cameras',
      activeSubcategorySlug: 'dslr',
      categorySelection: 'cameras',
      priceMinBound: 0,
      priceMaxBound: 1000,
      filters: {
        page: 3,
        min_price: 10,
        max_price: 900,
        search: 'q',
        tags: new Set(['new']),
      },
    });
    return cmp;
  }

  it('category clears category+sub and reloads', () => {
    const cmp = createCmp();
    cmp.removeChip({ id: 'c', type: 'category', label: 'Cameras' } as any);
    expect((cmp as any).activeCategorySlug).toBe('');
    expect((cmp as any).activeSubcategorySlug).toBe('');
    expect((cmp as any).categorySelection).toBe('');
    expect((cmp as any).filters.page).toBe(1);
    expect((cmp as any).loadProducts).toHaveBeenCalled();
  });

  it('subcategory/price/search/tag arms', () => {
    const sub = createCmp();
    sub.removeChip({ id: 's', type: 'subcategory', label: 'DSLR' } as any);
    expect((sub as any).activeSubcategorySlug).toBe('');
    expect((sub as any).loadProducts).toHaveBeenCalled();

    const price = createCmp();
    price.removeChip({ id: 'p', type: 'price', label: '10-900' } as any);
    expect((price as any).filters.min_price).toBe(0);
    expect((price as any).filters.max_price).toBe(1000);
    expect((price as any).applyFilters).toHaveBeenCalled();

    const search = createCmp();
    search.removeChip({ id: 'q', type: 'search', label: 'q' } as any);
    expect((search as any).filters.search).toBe('');
    expect((search as any).applyFilters).toHaveBeenCalled();

    const tag = createCmp();
    tag.removeChip({ id: 't', type: 'tag', label: 'New', value: 'new' } as any);
    expect((tag as any).filters.tags.has('new')).toBe(false);
    expect((tag as any).applyFilters).toHaveBeenCalled();
  });
});
