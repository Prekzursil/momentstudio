import { ShopComponent } from './shop.component';

/** Golden WU shop-results-meta — resultsMetaParams arms. */
describe('ShopComponent resultsMetaParams (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      pageMeta: { total_items: 25, page: 2, limit: 10 },
      filters: { limit: 10 },
      paginationMode: 'pages',
      products: Array.from({ length: 10 }, (_, i) => ({ id: String(i) })),
      ...overrides,
    });
    return cmp;
  }

  it('returns null without meta or with invalid numbers', () => {
    expect(createCmp({ pageMeta: null }).resultsMetaParams()).toBeNull();
    expect(
      createCmp({ pageMeta: { total_items: 10, page: 1, limit: 0 } }).resultsMetaParams(),
    ).toBeNull();
  });

  it('handles empty total and pages mode range', () => {
    expect(
      createCmp({ pageMeta: { total_items: 0, page: 1, limit: 10 } }).resultsMetaParams(),
    ).toEqual({ total: 0, from: 0, to: 0 });
    expect(createCmp().resultsMetaParams()).toEqual({ total: 25, from: 11, to: 20 });
  });

  it('handles load_more shown range', () => {
    expect(
      createCmp({
        paginationMode: 'load_more',
        products: [],
        pageMeta: { total_items: 25, page: 2, limit: 10 },
      }).resultsMetaParams(),
    ).toEqual({ total: 25, from: 0, to: 0 });
    expect(
      createCmp({
        paginationMode: 'load_more',
        products: [{ id: '1' }, { id: '2' }, { id: '3' }],
        pageMeta: { total_items: 25, page: 1, limit: 10 },
      }).resultsMetaParams(),
    ).toEqual({ total: 25, from: 1, to: 3 });
  });
});
