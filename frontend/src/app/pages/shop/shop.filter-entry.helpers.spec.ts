import { ShopComponent } from './shop.component';

describe('ShopComponent sidebar search / price / applyFilters (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      cancelFilterDebounce: jasmine.createSpy('cancelFilterDebounce'),
      loadProducts: jasmine.createSpy('loadProducts'),
      scheduleFilterApply: jasmine.createSpy('scheduleFilterApply'),
      normalizePriceRange: jasmine.createSpy('normalizePriceRange'),
      parsePrice: (raw: any) => {
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      },
      filters: { page: 5, search: '', min_price: 10, max_price: 90 },
      priceMinBound: 0,
      priceMaxBound: 100,
      ...overrides,
    });
    return cmp;
  }

  it('applyFilters resets page and loads', () => {
    const cmp = createCmp();
    cmp.applyFilters();
    expect((cmp as any).cancelFilterDebounce).toHaveBeenCalled();
    expect((cmp as any).filters.page).toBe(1);
    expect((cmp as any).loadProducts).toHaveBeenCalled();
  });

  it('onSidebarSearchChange writes search and schedules apply', () => {
    const cmp = createCmp();
    cmp.onSidebarSearchChange('  desk ');
    expect((cmp as any).filters.search).toBe('  desk ');
    expect((cmp as any).scheduleFilterApply).toHaveBeenCalled();
  });

  it('onPriceTextChange parses, normalizes, schedules', () => {
    const cmp = createCmp();
    cmp.onPriceTextChange('min', '12');
    expect((cmp as any).filters.min_price).toBe(12);
    expect((cmp as any).normalizePriceRange).toHaveBeenCalledWith('min');
    expect((cmp as any).scheduleFilterApply).toHaveBeenCalled();
  });
});
