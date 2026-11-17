import { ShopComponent } from './shop.component';

describe('ShopComponent canReorderProducts edit/sort/happy gates (golden WU)', () => {
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

  it('requires canEditProducts and recommended sort', () => {
    expect(createCmp({ canEditProducts: () => false }).canReorderProducts()).toBe(false);
    expect(createCmp({ filters: { sort: 'price_asc' } }).canReorderProducts()).toBe(false);
    expect(createCmp().canReorderProducts()).toBe(true);
  });
});
