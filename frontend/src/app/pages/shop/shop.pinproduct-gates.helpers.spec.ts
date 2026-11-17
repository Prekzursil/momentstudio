import { signal } from '@angular/core';
import { ShopComponent } from './shop.component';

/** Golden WU shop-pinproduct-gates — pinProductToTop early returns. */
describe('ShopComponent pinProductToTop gates (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      canReorderProducts: () => true,
      productReorderSaving: signal(false),
      products: [{ id: 'a' }, { id: 'b' }],
      reorderProducts: jasmine.createSpy('reorderProducts').and.returnValue(true),
      admin: { bulkUpdateProducts: jasmine.createSpy('bulkUpdateProducts') },
      ...overrides,
    });
    return cmp;
  }

  it('returns early when cannot reorder, saving, blank, or already first', () => {
    const blocked = createCmp({ canReorderProducts: () => false });
    blocked.pinProductToTop('b');
    expect((blocked as any).reorderProducts).not.toHaveBeenCalled();

    const saving = createCmp({ productReorderSaving: signal(true) });
    saving.pinProductToTop('b');
    expect((saving as any).reorderProducts).not.toHaveBeenCalled();

    const blank = createCmp();
    blank.pinProductToTop('  ');
    expect((blank as any).reorderProducts).not.toHaveBeenCalled();

    const first = createCmp();
    first.pinProductToTop('a');
    expect((first as any).reorderProducts).not.toHaveBeenCalled();
  });
});
