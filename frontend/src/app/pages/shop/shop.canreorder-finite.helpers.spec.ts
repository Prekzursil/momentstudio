import { signal } from '@angular/core';
import { ShopComponent } from './shop.component';

/** Golden WU shop-canreorder-finite — canReorderProducts gate arms. */
describe('ShopComponent canReorderProducts (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      canEditProducts: () => true,
      bulkSelectMode: signal(false),
      productReorderSaving: signal(false),
      loading: signal(false),
      hasError: signal(false),
      filters: { sort: 'recommended' },
      activeLeafCategorySlug: () => 'leaf',
      pageMeta: { total_pages: 1, page: 1, total_items: 3 },
      paginationMode: 'pages',
      products: [{ id: 'a' }, { id: 'b' }],
      ...overrides,
    });
    return cmp;
  }

  it('returns false for edit/bulk/saving/loading/error/sort/leaf/meta gates', () => {
    expect(createCmp({ canEditProducts: () => false }).canReorderProducts()).toBe(false);
    expect(createCmp({ bulkSelectMode: signal(true) }).canReorderProducts()).toBe(false);
    expect(createCmp({ productReorderSaving: signal(true) }).canReorderProducts()).toBe(false);
    expect(createCmp({ loading: signal(true) }).canReorderProducts()).toBe(false);
    expect(createCmp({ hasError: signal(true) }).canReorderProducts()).toBe(false);
    expect(createCmp({ filters: { sort: 'price_asc' } }).canReorderProducts()).toBe(false);
    expect(createCmp({ activeLeafCategorySlug: () => '' }).canReorderProducts()).toBe(false);
    expect(createCmp({ pageMeta: null }).canReorderProducts()).toBe(false);
  });

  it('returns false for non-finite meta or not fully loaded', () => {
    expect(
      createCmp({
        pageMeta: { total_pages: Number.NaN, page: 1, total_items: 2 },
      }).canReorderProducts(),
    ).toBe(false);
    expect(
      createCmp({
        pageMeta: { total_pages: 2, page: 1, total_items: 10 },
        paginationMode: 'pages',
        products: [{ id: 'a' }, { id: 'b' }],
      }).canReorderProducts(),
    ).toBe(false);
  });

  it('returns true when load_more has loaded all and products > 1', () => {
    expect(
      createCmp({
        pageMeta: { total_pages: 2, page: 2, total_items: 2 },
        paginationMode: 'load_more',
        products: [{ id: 'a' }, { id: 'b' }],
      }).canReorderProducts(),
    ).toBe(true);
    expect(
      createCmp({
        pageMeta: { total_pages: 1, page: 1, total_items: 1 },
        products: [{ id: 'a' }],
      }).canReorderProducts(),
    ).toBe(false);
  });
});
