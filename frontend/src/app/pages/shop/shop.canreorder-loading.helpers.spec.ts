import { ShopComponent } from './shop.component';

describe('ShopComponent canReorderProducts saving/loading/load_more (golden WU)', () => {
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

  it('blocks while saving or loading and when load_more not fully loaded', () => {
    expect(createCmp({ productReorderSaving: () => true }).canReorderProducts()).toBe(false);
    expect(createCmp({ loading: () => true }).canReorderProducts()).toBe(false);
    expect(
      createCmp({
        paginationMode: 'load_more',
        pageMeta: { total_pages: 3, page: 1, total_items: 30 },
        products: [{ id: 'a' }, { id: 'b' }],
      }).canReorderProducts(),
    ).toBe(false);
    expect(
      createCmp({
        paginationMode: 'load_more',
        pageMeta: { total_pages: 2, page: 2, total_items: 2 },
        products: [{ id: 'a' }, { id: 'b' }],
      }).canReorderProducts(),
    ).toBe(true);
  });
});
