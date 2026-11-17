import { ShopComponent } from './shop.component';

/** Golden WU tip-recon #711 — resetFilters + isCreating* category flags. */
describe('ShopComponent resetFilters / isCreating* (golden WU)', () => {
  function bare(overrides: Record<string, unknown> = {}): ShopComponent {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      creatingCategoryParentSlug: null as string | null,
      priceMinBound: 0,
      priceMaxBound: 500,
      filters: {
        search: 'q',
        min_price: 10,
        max_price: 100,
        tags: new Set(['a']),
        sort: 'price_asc',
        page: 3,
      },
      activeCategorySlug: 'cat',
      activeSubcategorySlug: 'sub',
      categorySelection: 'cat/sub',
      cancelFilterDebounce: jasmine.createSpy('cancelFilterDebounce'),
      loadProducts: jasmine.createSpy('loadProducts'),
      ...overrides,
    });
    return cmp;
  }

  it('isCreatingAnyCategory is true iff parent slug is non-null', () => {
    expect(bare().isCreatingAnyCategory()).toBe(false);
    expect(bare({ creatingCategoryParentSlug: '' }).isCreatingAnyCategory()).toBe(true);
    expect(bare({ creatingCategoryParentSlug: 'parent' }).isCreatingAnyCategory()).toBe(true);
  });

  it('isCreatingRootCategory is true only for empty-string parent', () => {
    expect(bare({ creatingCategoryParentSlug: '' }).isCreatingRootCategory()).toBe(true);
    expect(bare({ creatingCategoryParentSlug: 'x' }).isCreatingRootCategory()).toBe(false);
    expect(bare().isCreatingRootCategory()).toBe(false);
  });

  it('isCreatingSubcategory matches the parent slug', () => {
    expect(bare({ creatingCategoryParentSlug: 'kids' }).isCreatingSubcategory('kids')).toBe(true);
    expect(bare({ creatingCategoryParentSlug: 'kids' }).isCreatingSubcategory('other')).toBe(false);
  });

  it('resetFilters clears filter state and reloads', () => {
    const cmp = bare();
    cmp.resetFilters();
    expect((cmp as any).cancelFilterDebounce).toHaveBeenCalled();
    expect((cmp as any).filters.search).toBe('');
    expect((cmp as any).activeCategorySlug).toBe('');
    expect((cmp as any).activeSubcategorySlug).toBe('');
    expect((cmp as any).categorySelection).toBe('');
    expect((cmp as any).filters.min_price).toBe(0);
    expect((cmp as any).filters.max_price).toBe(500);
    expect((cmp as any).filters.tags.size).toBe(0);
    expect((cmp as any).filters.sort).toBe('newest');
    expect((cmp as any).filters.page).toBe(1);
    expect((cmp as any).loadProducts).toHaveBeenCalled();
  });
});
