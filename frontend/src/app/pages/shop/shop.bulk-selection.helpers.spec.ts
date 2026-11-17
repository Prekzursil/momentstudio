import { signal } from '@angular/core';
import { ShopComponent } from './shop.component';

/** Golden WU shop-bulk-selection — clear / isSelected / selectAll on page. */
describe('ShopComponent bulk selection helpers (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      bulkSelectMode: signal(true),
      bulkSelectedProductIds: signal(new Set<string>()),
      products: [{ id: 'a' }, { id: 'b' }, { id: null }, {}],
      ...overrides,
    });
    return cmp;
  }

  it('clearBulkSelection empties the set', () => {
    const cmp = createCmp({ bulkSelectedProductIds: signal(new Set(['a', 'b'])) });
    cmp.clearBulkSelection();
    expect((cmp as any).bulkSelectedProductIds().size).toBe(0);
  });

  it('bulkIsSelected reports membership', () => {
    const cmp = createCmp({ bulkSelectedProductIds: signal(new Set(['x'])) });
    expect(cmp.bulkIsSelected('x')).toBe(true);
    expect(cmp.bulkIsSelected('y')).toBe(false);
  });

  it('selectAllProductsOnPage no-ops without mode or products', () => {
    const off = createCmp({ bulkSelectMode: signal(false) });
    off.selectAllProductsOnPage();
    expect((off as any).bulkSelectedProductIds().size).toBe(0);

    const empty = createCmp({ products: [] });
    empty.selectAllProductsOnPage();
    expect((empty as any).bulkSelectedProductIds().size).toBe(0);
  });

  it('selectAllProductsOnPage adds product ids with truthy id', () => {
    const cmp = createCmp();
    cmp.selectAllProductsOnPage();
    expect([...(cmp as any).bulkSelectedProductIds()].sort()).toEqual(['a', 'b']);
  });
});
