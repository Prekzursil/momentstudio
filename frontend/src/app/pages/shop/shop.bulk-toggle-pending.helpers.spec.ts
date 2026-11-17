import { signal } from '@angular/core';
import { ShopComponent } from './shop.component';

describe('ShopComponent toggleBulkSelectMode / bulkHasPendingEdits (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      canEditProducts: () => true,
      bulkSelectMode: signal(false),
      bulkEditError: 'x',
      bulkStatus: '',
      bulkCategoryId: '',
      bulkFeatured: '',
      resetBulkEdits: jasmine.createSpy('resetBulkEdits'),
      clearBulkSelection: jasmine.createSpy('clearBulkSelection'),
      ...overrides,
    });
    return cmp;
  }

  it('toggleBulkSelectMode no-ops without edit permission', () => {
    const cmp = createCmp({ canEditProducts: () => false });
    cmp.toggleBulkSelectMode();
    expect((cmp as any).bulkSelectMode()).toBe(false);
  });

  it('toggleBulkSelectMode enables and clears error; disable resets selection', () => {
    const cmp = createCmp();
    cmp.toggleBulkSelectMode();
    expect((cmp as any).bulkSelectMode()).toBe(true);
    expect((cmp as any).bulkEditError).toBe('');
    cmp.toggleBulkSelectMode();
    expect((cmp as any).bulkSelectMode()).toBe(false);
    expect((cmp as any).resetBulkEdits).toHaveBeenCalled();
    expect((cmp as any).clearBulkSelection).toHaveBeenCalled();
  });

  it('bulkHasPendingEdits is true when any bulk field set', () => {
    expect(createCmp().bulkHasPendingEdits()).toBe(false);
    expect(createCmp({ bulkStatus: ' active ' }).bulkHasPendingEdits()).toBe(true);
    expect(createCmp({ bulkCategoryId: 'c1' }).bulkHasPendingEdits()).toBe(true);
    expect(createCmp({ bulkFeatured: 'true' }).bulkHasPendingEdits()).toBe(true);
  });
});
