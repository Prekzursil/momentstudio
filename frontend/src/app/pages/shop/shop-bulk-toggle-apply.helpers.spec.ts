import { signal } from '@angular/core';
import { ShopComponent } from './shop.component';

describe('ShopComponent bulk toggle/apply gates (golden WU #738 sidecar)', () => {
  function make(overrides: Record<string, unknown> = {}): any {
    const proto = Object.create(ShopComponent.prototype);
    Object.assign(
      proto,
      {
        bulkSelectMode: signal(true),
        bulkSaving: signal(false),
        bulkSelectedProductIds: signal(new Set<string>()),
        bulkStatus: '',
        bulkCategoryId: '',
        bulkFeatured: '',
        bulkEditError: '',
        products: [],
        translate: { instant: (k: string) => k },
        toast: { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') },
        admin: { bulkUpdateProducts: jasmine.createSpy('bulkUpdateProducts') },
        canEditProducts: () => true,
      },
      overrides,
    );
    return proto;
  }

  function checkboxEvent(checked: boolean): Event {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    const ev = new Event('change', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'target', { value: input });
    return ev;
  }

  describe('toggleBulkSelected', () => {
    it('no-ops when bulkSelectMode is off or bulkSaving is true', () => {
      const off = make({ bulkSelectMode: signal(false) });
      off.toggleBulkSelected(checkboxEvent(true), 'p1');
      expect(off.bulkSelectedProductIds().size).toBe(0);

      const saving = make({ bulkSaving: signal(true) });
      saving.toggleBulkSelected(checkboxEvent(true), 'p1');
      expect(saving.bulkSelectedProductIds().size).toBe(0);
    });

    it('adds on check and removes on uncheck while mode is active', () => {
      const c = make();
      c.toggleBulkSelected(checkboxEvent(true), 'p1');
      expect(c.bulkSelectedProductIds().has('p1')).toBe(true);
      c.toggleBulkSelected(checkboxEvent(false), 'p1');
      expect(c.bulkSelectedProductIds().has('p1')).toBe(false);
    });
  });

  describe('applyBulkProductEdits gates', () => {
    it('early-returns for permission/mode/saving/selection/pending gates', () => {
      const noPerm = make({ canEditProducts: () => false, bulkStatus: 'draft' });
      noPerm.bulkSelectedProductIds.set(new Set(['p1']));
      noPerm.applyBulkProductEdits();
      expect(noPerm.admin.bulkUpdateProducts).not.toHaveBeenCalled();

      const noMode = make({ bulkSelectMode: signal(false), bulkStatus: 'draft' });
      noMode.bulkSelectedProductIds.set(new Set(['p1']));
      noMode.applyBulkProductEdits();
      expect(noMode.admin.bulkUpdateProducts).not.toHaveBeenCalled();

      const saving = make({ bulkSaving: signal(true), bulkStatus: 'draft' });
      saving.bulkSelectedProductIds.set(new Set(['p1']));
      saving.applyBulkProductEdits();
      expect(saving.admin.bulkUpdateProducts).not.toHaveBeenCalled();

      const empty = make({ bulkStatus: 'draft' });
      empty.applyBulkProductEdits();
      expect(empty.bulkEditError).toBe('adminUi.storefront.products.bulkNoSelection');
      expect(empty.admin.bulkUpdateProducts).not.toHaveBeenCalled();

      const noPending = make();
      noPending.bulkSelectedProductIds.set(new Set(['p1']));
      noPending.applyBulkProductEdits();
      expect(noPending.bulkEditError).toBe('adminUi.storefront.products.bulkNoChanges');
      expect(noPending.admin.bulkUpdateProducts).not.toHaveBeenCalled();
    });
  });

  describe('bulkHasPendingEdits', () => {
    it('is true when any bulk field is non-blank', () => {
      expect(make().bulkHasPendingEdits()).toBe(false);
      expect(make({ bulkStatus: ' draft ' }).bulkHasPendingEdits()).toBe(true);
      expect(make({ bulkCategoryId: 'c1' }).bulkHasPendingEdits()).toBe(true);
      expect(make({ bulkFeatured: 'true' }).bulkHasPendingEdits()).toBe(true);
    });
  });
});
