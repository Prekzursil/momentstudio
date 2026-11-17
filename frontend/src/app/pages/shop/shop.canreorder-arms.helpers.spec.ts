import { ShopComponent } from './shop.component';

describe('ShopComponent canReorderProducts bulk/leaf/singleton arms (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      canEditProducts: () => true,
      bulkSelectMode: () => false,
      productReorderSaving: () => false,
      loading: () => false,
      hasError: () => false,
      filters: { sort: 'recommended' },
      activeLeafCategorySlug: () => 'leaf',
      pageMeta: { total_pages: 1, page: 1, total_items: 3 },
      paginationMode: 'pages',
      products: [{ id: 'a' }, { id: 'b' }],
      ...overrides,
    });
    return cmp;
  }

  it('blocks bulk select, missing leaf, and singleton catalogs', () => {
    expect(createCmp({ bulkSelectMode: () => true }).canReorderProducts()).toBe(false);
    expect(createCmp({ activeLeafCategorySlug: () => '' }).canReorderProducts()).toBe(false);
    expect(createCmp({ products: [{ id: 'only' }] }).canReorderProducts()).toBe(false);
  });
});
