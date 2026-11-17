import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { ShopComponent } from './shop.component';

/** Golden WU shop-bulk-apply-success — applyBulkProductEdits success/error arms. */
describe('ShopComponent applyBulkProductEdits success/error (golden WU)', () => {
  function createCmp(overrides: Record<string, unknown> = {}) {
    const cmp = Object.create(ShopComponent.prototype) as ShopComponent;
    Object.assign(cmp as any, {
      bulkSelectMode: signal(true),
      bulkSaving: signal(false),
      bulkSelectedProductIds: signal(new Set<string>(['p1'])),
      bulkStatus: 'active',
      bulkCategoryId: '',
      bulkFeatured: '',
      bulkEditError: '',
      products: [{ id: 'p1', status: 'draft', is_featured: false }],
      translate: { instant: (k: string) => k },
      toast: { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') },
      admin: {
        bulkUpdateProducts: jasmine.createSpy('bulkUpdateProducts').and.returnValue(of({})),
      },
      canEditProducts: () => true,
      ...overrides,
    });
    return cmp;
  }

  it('applies updates, toasts success, resets edits, and clears selection', () => {
    const cmp = createCmp();
    cmp.applyBulkProductEdits();
    expect((cmp as any).admin.bulkUpdateProducts).toHaveBeenCalled();
    expect((cmp as any).toast.success).toHaveBeenCalledWith('adminUi.products.bulk.success');
    expect((cmp as any).bulkStatus).toBe('');
    expect((cmp as any).bulkSelectedProductIds().size).toBe(0);
    expect((cmp as any).products[0].status).toBe('active');
    expect((cmp as any).bulkSaving()).toBe(false);
  });

  it('toasts error and clears bulkSaving on failure', () => {
    const cmp = createCmp({
      admin: {
        bulkUpdateProducts: jasmine
          .createSpy('bulkUpdateProducts')
          .and.returnValue(throwError(() => new Error('x'))),
      },
    });
    cmp.applyBulkProductEdits();
    expect((cmp as any).toast.error).toHaveBeenCalledWith('adminUi.products.bulk.error');
    expect((cmp as any).bulkSaving()).toBe(false);
  });

  it('sets bulkEditError when selection empty or no pending edits', () => {
    const empty = createCmp({ bulkSelectedProductIds: signal(new Set()) });
    empty.applyBulkProductEdits();
    expect((empty as any).bulkEditError).toBe('adminUi.storefront.products.bulkNoSelection');

    const noPending = createCmp({ bulkStatus: '' });
    noPending.applyBulkProductEdits();
    expect((noPending as any).bulkEditError).toBe('adminUi.storefront.products.bulkNoChanges');
  });
});
