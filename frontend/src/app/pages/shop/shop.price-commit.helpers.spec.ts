import { ShopComponent } from './shop.component';

/** Golden WU shop-price-commit — onPriceTextChange / onPriceCommit helpers. */
describe('ShopComponent price text/commit helpers (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(ShopComponent.prototype) as any;
    cmp.parsePrice = jasmine.createSpy('parsePrice').and.callFake((raw: unknown) => {
      if (raw === null || raw === undefined) return undefined;
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
      if (typeof raw !== 'string') return undefined;
      const str = String(raw).trim();
      if (!str) return undefined;
      const n = Number(str);
      return Number.isFinite(n) ? n : undefined;
    });
    cmp.normalizePriceRange = jasmine.createSpy('normalizePriceRange');
    cmp.scheduleFilterApply = jasmine.createSpy('scheduleFilterApply');
    cmp.applyFilters = jasmine.createSpy('applyFilters');
    cmp.priceMinBound = 0;
    cmp.priceMaxBound = 1000;
    cmp.filters = { min_price: 0, max_price: 1000, page: 1 };
    Object.assign(cmp, overrides);
    return cmp as ShopComponent;
  }

  it('onPriceTextChange updates min/max, normalizes, and schedules apply', () => {
    const cmp = createCmp() as any;
    ShopComponent.prototype.onPriceTextChange.call(cmp, 'min', '10');
    expect(cmp.filters.min_price).toBe(10);
    expect(cmp.normalizePriceRange).toHaveBeenCalledWith('min');
    expect(cmp.scheduleFilterApply).toHaveBeenCalled();

    ShopComponent.prototype.onPriceTextChange.call(cmp, 'max', '99');
    expect(cmp.filters.max_price).toBe(99);
  });

  it('onPriceTextChange falls back to bounds when parse fails', () => {
    const cmp = createCmp() as any;
    ShopComponent.prototype.onPriceTextChange.call(cmp, 'min', 'nope');
    expect(cmp.filters.min_price).toBe(0);
    ShopComponent.prototype.onPriceTextChange.call(cmp, 'max', '');
    expect(cmp.filters.max_price).toBe(1000);
  });

  it('onPriceCommit normalizes then applyFilters', () => {
    const cmp = createCmp() as any;
    ShopComponent.prototype.onPriceCommit.call(cmp, 'max');
    expect(cmp.normalizePriceRange).toHaveBeenCalledWith('max');
    expect(cmp.applyFilters).toHaveBeenCalled();
  });
});
