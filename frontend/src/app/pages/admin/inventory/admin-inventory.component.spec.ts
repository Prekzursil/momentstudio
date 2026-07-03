import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import {
  AdminService,
  CartReservationsResponse,
  OrderReservationsResponse,
  RestockListItem,
  RestockListResponse,
  StockAdjustment,
} from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';
import { AdminInventoryComponent } from './admin-inventory.component';

type RestockRow = RestockListItem & {
  draftSupplier: string;
  draftDesiredQuantity: string;
  draftNote: string;
  isDirty: boolean;
  isSaving: boolean;
};

function makeItem(overrides: Partial<RestockListItem> = {}): RestockListItem {
  return {
    kind: 'product',
    product_id: 'p1',
    variant_id: null,
    sku: 'SKU1',
    product_slug: 'slug-1',
    product_name: 'Product One',
    variant_name: null,
    stock_quantity: 10,
    reserved_in_carts: 0,
    reserved_in_orders: 0,
    available_quantity: 10,
    threshold: 5,
    is_critical: false,
    restock_at: null,
    supplier: null,
    desired_quantity: null,
    note: null,
    note_updated_at: null,
    ...overrides,
  };
}

function makeRow(overrides: Partial<RestockRow> = {}): RestockRow {
  return {
    ...makeItem(overrides),
    draftSupplier: '',
    draftDesiredQuantity: '',
    draftNote: '',
    isDirty: false,
    isSaving: false,
    ...overrides,
  };
}

function makeResp(
  items: RestockListItem[],
  meta?: RestockListResponse['meta'],
): RestockListResponse {
  return {
    items,
    meta: meta ?? { page: 1, limit: 50, total_items: items.length, total_pages: 1 },
  };
}

function checkboxEvent(checked: boolean): Event {
  return { target: { checked } } as unknown as Event;
}

describe('AdminInventoryComponent', () => {
  let admin: jasmine.SpyObj<AdminService>;
  let toast: jasmine.SpyObj<ToastService>;
  let translate: jasmine.SpyObj<TranslateService>;
  let router: jasmine.SpyObj<Router>;
  let component: AdminInventoryComponent;

  beforeEach(() => {
    admin = jasmine.createSpyObj<AdminService>('AdminService', [
      'restockList',
      'exportRestockListCsv',
      'reservedCarts',
      'reservedOrders',
      'upsertRestockNote',
      'applyStockAdjustment',
    ]);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    translate = jasmine.createSpyObj<TranslateService>('TranslateService', ['instant']);
    translate.instant.and.callFake((key: string | string[]) => key as string);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));

    admin.restockList.and.returnValue(of(makeResp([])));

    component = new AdminInventoryComponent(admin, toast, translate, router);
  });

  describe('initialisation and load', () => {
    it('loads on ngOnInit and maps items into editable rows', () => {
      admin.restockList.and.returnValue(
        of(
          makeResp(
            [
              makeItem({
                supplier: 'ACME',
                desired_quantity: 12,
                note: 'restock soon',
              }),
            ],
            { page: 2, limit: 50, total_items: 1, total_pages: 3 },
          ),
        ),
      );

      component.ngOnInit();

      expect(admin.restockList).toHaveBeenCalledWith({
        page: 1,
        limit: 50,
        include_variants: true,
        default_threshold: 5,
      });
      const rows = component.rows();
      expect(rows.length).toBe(1);
      expect(rows[0].draftSupplier).toBe('ACME');
      expect(rows[0].draftDesiredQuantity).toBe('12');
      expect(rows[0].draftNote).toBe('restock soon');
      expect(rows[0].isDirty).toBe(false);
      expect(component.meta()?.total_pages).toBe(3);
      expect(component.page).toBe(2);
      expect(component.loading()).toBe(false);
    });

    it('defaults missing fields to empty drafts (null/undefined desired quantity)', () => {
      admin.restockList.and.returnValue(
        of(
          makeResp([
            makeItem({ product_id: 'a', supplier: null, desired_quantity: null, note: null }),
            makeItem({ product_id: 'b', desired_quantity: undefined as unknown as null }),
          ]),
        ),
      );

      component.ngOnInit();

      const rows = component.rows();
      expect(rows[0].draftSupplier).toBe('');
      expect(rows[0].draftDesiredQuantity).toBe('');
      expect(rows[0].draftNote).toBe('');
      expect(rows[1].draftDesiredQuantity).toBe('');
    });

    it('falls back to empty list and current page when response omits items and meta', () => {
      component.page = 4;
      admin.restockList.and.returnValue(
        of({ items: undefined, meta: undefined } as unknown as RestockListResponse),
      );

      component.ngOnInit();

      expect(component.rows()).toEqual([]);
      expect(component.meta()).toBeNull();
      expect(component.page).toBe(4);
    });

    it('surfaces a generic error and request id when load fails', () => {
      const err = new HttpErrorResponse({
        status: 500,
        headers: new HttpHeaders({ 'X-Request-ID': 'req-123' }),
      });
      admin.restockList.and.returnValue(throwError(() => err));

      component.ngOnInit();

      expect(component.error()).toBe('adminUi.errors.generic');
      expect(component.errorRequestId()).toBe('req-123');
      expect(component.rows()).toEqual([]);
      expect(component.meta()).toBeNull();
      expect(component.loading()).toBe(false);
    });

    it('retryLoad triggers another load', () => {
      component.retryLoad();
      expect(admin.restockList).toHaveBeenCalled();
    });

    it('applyFilters resets to first page and reloads', () => {
      component.page = 7;
      component.applyFilters();
      expect(component.page).toBe(1);
      expect(admin.restockList).toHaveBeenCalled();
    });

    it('goToPage clamps the requested page to a minimum of 1 before loading', () => {
      component.goToPage(0);
      expect(admin.restockList.calls.mostRecent().args[0].page).toBe(1);
      component.goToPage(5);
      expect(admin.restockList.calls.mostRecent().args[0].page).toBe(5);
    });
  });

  describe('row keys and selection', () => {
    it('builds track keys from variant id when present and product id otherwise', () => {
      const variantRow = makeRow({ kind: 'variant', variant_id: 'v9', product_id: 'p1' });
      const productRow = makeRow({ kind: 'product', variant_id: null, product_id: 'p1' });
      expect(component.trackByKey(0, variantRow)).toBe('variant:v9');
      expect(component.trackByKey(1, productRow)).toBe('product:p1');
    });

    it('reports selection state per row', () => {
      const row = makeRow({ product_id: 'p1' });
      expect(component.isSelected(row)).toBe(false);
      component.toggleSelectRow(row, checkboxEvent(true));
      expect(component.isSelected(row)).toBe(true);
      component.toggleSelectRow(row, checkboxEvent(false));
      expect(component.isSelected(row)).toBe(false);
    });

    it('treats a null event target as unchecked', () => {
      const row = makeRow({ product_id: 'p1' });
      component.toggleSelectRow(row, { target: null } as unknown as Event);
      expect(component.isSelected(row)).toBe(false);
    });

    it('allSelectedOnPage reflects whether every visible row is selected', () => {
      expect(component.allSelectedOnPage()).toBe(false);

      const a = makeRow({ product_id: 'a' });
      const b = makeRow({ product_id: 'b' });
      component.rows.set([a, b]);
      expect(component.allSelectedOnPage()).toBe(false);

      component.toggleSelectRow(a, checkboxEvent(true));
      expect(component.allSelectedOnPage()).toBe(false);

      component.toggleSelectRow(b, checkboxEvent(true));
      expect(component.allSelectedOnPage()).toBe(true);
    });

    it('toggleSelectAll selects and clears all rows; null target clears', () => {
      const a = makeRow({ product_id: 'a' });
      const b = makeRow({ product_id: 'b' });
      component.rows.set([a, b]);

      component.toggleSelectAll(checkboxEvent(true));
      expect(component.selected.size).toBe(2);

      component.toggleSelectAll(checkboxEvent(false));
      expect(component.selected.size).toBe(0);

      component.toggleSelectAll(checkboxEvent(true));
      component.toggleSelectAll({ target: null } as unknown as Event);
      expect(component.selected.size).toBe(0);
    });

    it('clearSelection empties the selection set', () => {
      const a = makeRow({ product_id: 'a' });
      component.rows.set([a]);
      component.toggleSelectRow(a, checkboxEvent(true));
      component.clearSelection();
      expect(component.selected.size).toBe(0);
    });

    it('prunes selections for rows no longer present after a reload', () => {
      const first = makeRow({ product_id: 'gone' });
      component.rows.set([first]);
      component.toggleSelectRow(first, checkboxEvent(true));
      expect(component.selected.size).toBe(1);

      admin.restockList.and.returnValue(of(makeResp([makeItem({ product_id: 'kept' })])));
      component.retryLoad();

      expect(component.selected.size).toBe(0);
    });
  });

  describe('bulk stock adjustment', () => {
    beforeEach(() => {
      component.rows.set([
        makeRow({ kind: 'product', product_id: 'p1', variant_id: null }),
        makeRow({ kind: 'variant', product_id: 'p2', variant_id: 'v2' }),
      ]);
      component.selected.add('product:p1');
      component.selected.add('variant:v2');
    });

    it('ignores re-entry while busy', () => {
      component.bulkAdjustBusy.set(true);
      component.applyBulkStockAdjustment();
      expect(admin.applyStockAdjustment).not.toHaveBeenCalled();
    });

    it('rejects a non-integer or zero delta', () => {
      component.bulkAdjustDelta = '1.5';
      component.bulkAdjustNote = 'note';
      component.applyBulkStockAdjustment();
      expect(component.bulkAdjustError()).toBe('adminUi.inventory.bulkAdjust.errors.deltaInvalid');

      component.bulkAdjustDelta = '0';
      component.applyBulkStockAdjustment();
      expect(component.bulkAdjustError()).toBe('adminUi.inventory.bulkAdjust.errors.deltaInvalid');
      expect(admin.applyStockAdjustment).not.toHaveBeenCalled();
    });

    it('treats a nullish delta as invalid', () => {
      component.bulkAdjustDelta = undefined as unknown as string;
      component.bulkAdjustNote = 'note';
      component.applyBulkStockAdjustment();
      expect(component.bulkAdjustError()).toBe('adminUi.inventory.bulkAdjust.errors.deltaInvalid');
      expect(admin.applyStockAdjustment).not.toHaveBeenCalled();
    });

    it('requires a note (whitespace-only rejected)', () => {
      component.bulkAdjustDelta = '5';
      component.bulkAdjustNote = '   ';
      component.applyBulkStockAdjustment();
      expect(component.bulkAdjustError()).toBe('adminUi.inventory.bulkAdjust.errors.noteRequired');
      expect(admin.applyStockAdjustment).not.toHaveBeenCalled();
    });

    it('requires a note (empty string rejected)', () => {
      component.bulkAdjustDelta = '5';
      component.bulkAdjustNote = '';
      component.applyBulkStockAdjustment();
      expect(component.bulkAdjustError()).toBe('adminUi.inventory.bulkAdjust.errors.noteRequired');
      expect(admin.applyStockAdjustment).not.toHaveBeenCalled();
    });

    it('does nothing when no selected rows remain', () => {
      component.selected.clear();
      component.bulkAdjustDelta = '5';
      component.bulkAdjustNote = 'note';
      component.applyBulkStockAdjustment();
      expect(admin.applyStockAdjustment).not.toHaveBeenCalled();
      expect(component.bulkAdjustBusy()).toBe(false);
    });

    it('applies adjustments to every selected row and reloads on success', () => {
      component.bulkAdjustDelta = '5';
      component.bulkAdjustNote = 'restock';
      component.bulkAdjustReason = 'restock';
      admin.applyStockAdjustment.and.returnValue(of({} as unknown as StockAdjustment));

      component.applyBulkStockAdjustment();

      expect(admin.applyStockAdjustment).toHaveBeenCalledTimes(2);
      expect(admin.applyStockAdjustment).toHaveBeenCalledWith({
        product_id: 'p1',
        variant_id: null,
        delta: 5,
        reason: 'restock',
        note: 'restock',
      });
      expect(admin.applyStockAdjustment).toHaveBeenCalledWith({
        product_id: 'p2',
        variant_id: 'v2',
        delta: 5,
        reason: 'restock',
        note: 'restock',
      });
      expect(toast.success).toHaveBeenCalledWith('adminUi.inventory.bulkAdjust.success.applied');
      expect(component.bulkAdjustBusy()).toBe(false);
      expect(component.bulkAdjustDelta).toBe('');
      expect(component.selected.size).toBe(0);
      expect(admin.restockList).toHaveBeenCalled();
    });

    it('reports a partial failure when an adjustment errors', () => {
      component.bulkAdjustDelta = '-3';
      component.bulkAdjustNote = 'shrinkage';
      let call = 0;
      admin.applyStockAdjustment.and.callFake(() => {
        call += 1;
        return call === 1
          ? of({} as unknown as StockAdjustment)
          : throwError(() => new Error('boom'));
      });

      component.applyBulkStockAdjustment();

      expect(toast.success).toHaveBeenCalled();
      expect(component.bulkAdjustError()).toBe('adminUi.inventory.bulkAdjust.errors.failed');
      expect(toast.error).toHaveBeenCalledWith('adminUi.inventory.bulkAdjust.errors.failed');
      expect(component.bulkAdjustBusy()).toBe(false);
    });

    it('handles an unexpected stream error from the adjustment call', () => {
      component.bulkAdjustDelta = '5';
      component.bulkAdjustNote = 'note';
      admin.applyStockAdjustment.and.throwError(new Error('sync failure'));

      component.applyBulkStockAdjustment();

      expect(component.bulkAdjustBusy()).toBe(false);
      expect(component.bulkAdjustError()).toBe('adminUi.inventory.bulkAdjust.errors.failed');
    });
  });

  describe('navigation helpers', () => {
    it('openProduct navigates to products with the slug in router state', () => {
      component.openProduct(makeRow({ product_slug: 'my-slug' }));
      expect(router.navigate).toHaveBeenCalledWith(['/admin/products'], {
        state: { editProductSlug: 'my-slug' },
      });
    });

    it('openOrder navigates to the order detail route', () => {
      component.openOrder('order-9');
      expect(router.navigate).toHaveBeenCalledWith(['/admin/orders', 'order-9']);
    });
  });

  describe('export CSV', () => {
    it('ignores re-entry while already exporting', () => {
      component.exporting = true;
      component.exportCsv();
      expect(admin.exportRestockListCsv).not.toHaveBeenCalled();
    });

    it('downloads the CSV blob on success', () => {
      const blob = new Blob(['csv']);
      admin.exportRestockListCsv.and.returnValue(of(blob));
      const anchor = document.createElement('a');
      const clickSpy = spyOn(anchor, 'click');
      spyOn(document, 'createElement').and.returnValue(anchor);
      spyOn(URL, 'createObjectURL').and.returnValue('blob:url');
      const revokeSpy = spyOn(URL, 'revokeObjectURL');

      component.exportCsv();

      expect(admin.exportRestockListCsv).toHaveBeenCalledWith({
        include_variants: true,
        default_threshold: 5,
      });
      expect(anchor.download).toBe('restock-list.csv');
      expect(clickSpy).toHaveBeenCalled();
      expect(revokeSpy).toHaveBeenCalledWith('blob:url');
      expect(toast.success).toHaveBeenCalledWith('adminUi.inventory.exportReady');
      expect(component.exporting).toBe(false);
    });

    it('reports an error toast when the export fails', () => {
      admin.exportRestockListCsv.and.returnValue(throwError(() => new Error('nope')));
      component.exportCsv();
      expect(toast.error).toHaveBeenCalledWith('adminUi.inventory.errors.export');
      expect(component.exporting).toBe(false);
    });
  });

  describe('saveNote', () => {
    it('ignores rows that are saving or not dirty', () => {
      component.saveNote(makeRow({ isSaving: true, isDirty: true }));
      component.saveNote(makeRow({ isSaving: false, isDirty: false }));
      expect(admin.upsertRestockNote).not.toHaveBeenCalled();
    });

    it('saves trimmed values with a clamped desired quantity and reloads', () => {
      admin.upsertRestockNote.and.returnValue(of(null));
      const row = makeRow({
        product_id: 'p1',
        variant_id: 'v1',
        isDirty: true,
        draftSupplier: '  ACME  ',
        draftNote: '  hello  ',
        draftDesiredQuantity: ' -4 ',
      });

      component.saveNote(row);

      expect(admin.upsertRestockNote).toHaveBeenCalledWith({
        product_id: 'p1',
        variant_id: 'v1',
        supplier: 'ACME',
        desired_quantity: 0,
        note: 'hello',
      });
      expect(toast.success).toHaveBeenCalledWith('adminUi.inventory.success.noteSaved');
      expect(row.isSaving).toBe(false);
      expect(row.isDirty).toBe(false);
      expect(admin.restockList).toHaveBeenCalled();
    });

    it('nulls out empty supplier, note and quantity', () => {
      admin.upsertRestockNote.and.returnValue(of(null));
      const row = makeRow({
        product_id: 'p1',
        variant_id: null,
        isDirty: true,
        draftSupplier: '   ',
        draftNote: '   ',
        draftDesiredQuantity: '   ',
      });

      component.saveNote(row);

      expect(admin.upsertRestockNote).toHaveBeenCalledWith({
        product_id: 'p1',
        variant_id: null,
        supplier: null,
        desired_quantity: null,
        note: null,
      });
    });

    it('keeps the row editable and toasts on save failure', () => {
      admin.upsertRestockNote.and.returnValue(throwError(() => new Error('fail')));
      const row = makeRow({ isDirty: true, draftDesiredQuantity: '8' });

      component.saveNote(row);

      expect(toast.error).toHaveBeenCalledWith('adminUi.inventory.errors.noteSave');
      expect(row.isSaving).toBe(false);
    });
  });

  describe('reservation modal metadata', () => {
    it('reservationTitleKey reflects the active kind', () => {
      expect(component.reservationTitleKey()).toBe('adminUi.inventory.title');
      component.reservationsKind.set('carts');
      expect(component.reservationTitleKey()).toBe('adminUi.inventory.reservations.cartsTitle');
      component.reservationsKind.set('orders');
      expect(component.reservationTitleKey()).toBe('adminUi.inventory.reservations.ordersTitle');
    });

    it('reservationSubtitle composes target details', () => {
      expect(component.reservationSubtitle()).toBe('');

      component.reservationsTarget.set({
        product_id: 'p1',
        sku: 'SKU1',
        product_name: 'Product One',
        variant_name: 'Red',
      });
      expect(component.reservationSubtitle()).toBe('Product One — Red · SKU1');

      component.reservationsTarget.set({
        product_id: 'p1',
        sku: 'SKU1',
        product_name: 'Product One',
        variant_name: null,
      });
      expect(component.reservationSubtitle()).toBe('Product One · SKU1');
    });

    it('closeReservations resets all modal state', () => {
      component.reservationsOpen.set(true);
      component.reservationsKind.set('carts');
      component.reservationsTarget.set({
        product_id: 'p1',
        sku: 'SKU1',
        product_name: 'X',
      });
      component.reservationsError.set('err');
      component.reservationsCutoff.set('2026-01-01');
      component.reservationsCarts.set([{ cart_id: 'c', updated_at: 'u', quantity: 1 }]);
      component.reservationsOrders.set([
        { order_id: 'o', status: 'paid', created_at: 'c', quantity: 1 },
      ]);

      component.closeReservations();

      expect(component.reservationsOpen()).toBe(false);
      expect(component.reservationsKind()).toBeNull();
      expect(component.reservationsTarget()).toBeNull();
      expect(component.reservationsError()).toBeNull();
      expect(component.reservationsCutoff()).toBeNull();
      expect(component.reservationsCarts()).toEqual([]);
      expect(component.reservationsOrders()).toEqual([]);
    });
  });

  describe('openReservations and PII reveal', () => {
    it('ignores opening while reservations are loading', () => {
      component.reservationsLoading.set(true);
      component.openReservations(makeRow(), 'carts');
      expect(admin.reservedCarts).not.toHaveBeenCalled();
    });

    it('opens cart reservations for a product and loads them', () => {
      admin.reservedCarts.and.returnValue(
        of({ cutoff: '2026-02-01', items: [{ cart_id: 'c1', updated_at: 'u', quantity: 3 }] }),
      );

      component.openReservations(makeRow({ kind: 'product', product_id: 'p1' }), 'carts');

      expect(component.reservationsOpen()).toBe(true);
      expect(component.reservationsKind()).toBe('carts');
      expect(component.reservationsTarget()?.variant_id).toBeUndefined();
      expect(admin.reservedCarts).toHaveBeenCalledWith({
        product_id: 'p1',
        variant_id: undefined,
        include_pii: undefined,
      });
      expect(component.reservationsCutoff()).toBe('2026-02-01');
      expect(component.reservationsCarts().length).toBe(1);
      expect(component.reservationsLoading()).toBe(false);
    });

    it('opens order reservations for a variant row', () => {
      admin.reservedOrders.and.returnValue(of({ items: [] }));

      component.openReservations(
        makeRow({ kind: 'variant', product_id: 'p1', variant_id: 'v1', variant_name: 'Big' }),
        'orders',
      );

      expect(component.reservationsTarget()?.variant_id).toBe('v1');
      expect(component.reservationsTarget()?.variant_name).toBe('Big');
      expect(admin.reservedOrders).toHaveBeenCalledWith({
        product_id: 'p1',
        variant_id: 'v1',
        include_pii: undefined,
      });
      expect(component.reservationsOrders()).toEqual([]);
    });

    it('falls back to undefined variant id for a variant row missing its id', () => {
      admin.reservedCarts.and.returnValue(of({ cutoff: '2026-02-01', items: [] }));

      component.openReservations(
        makeRow({ kind: 'variant', product_id: 'p1', variant_id: null }),
        'carts',
      );

      expect(component.reservationsTarget()?.variant_id).toBeUndefined();
      expect(admin.reservedCarts).toHaveBeenCalledWith({
        product_id: 'p1',
        variant_id: undefined,
        include_pii: undefined,
      });
    });

    it('togglePiiReveal flips the flag without reloading when modal closed', () => {
      component.togglePiiReveal();
      expect(component.piiReveal()).toBe(true);
      expect(admin.reservedCarts).not.toHaveBeenCalled();
    });

    it('togglePiiReveal reloads open reservations with PII included', () => {
      admin.reservedOrders.and.returnValue(of({ items: [] }));
      component.reservationsOpen.set(true);
      component.reservationsKind.set('orders');
      component.reservationsTarget.set({ product_id: 'p1', sku: 'SKU1', product_name: 'X' });

      component.togglePiiReveal();

      expect(component.piiReveal()).toBe(true);
      expect(admin.reservedOrders).toHaveBeenCalledWith({
        product_id: 'p1',
        variant_id: undefined,
        include_pii: true,
      });
    });
  });

  describe('reloadReservations branches', () => {
    it('returns early when kind or target are missing', () => {
      (component as unknown as { reloadReservations(): void }).reloadReservations();
      expect(admin.reservedCarts).not.toHaveBeenCalled();
      expect(admin.reservedOrders).not.toHaveBeenCalled();
    });

    it('falls back to null cutoff and empty items on cart success', () => {
      admin.reservedCarts.and.returnValue(
        of({ cutoff: '', items: undefined } as unknown as CartReservationsResponse),
      );
      component.openReservations(makeRow(), 'carts');
      expect(component.reservationsCutoff()).toBeNull();
      expect(component.reservationsCarts()).toEqual([]);
    });

    it('retries carts without PII after a 403 when PII was revealed', () => {
      component.piiReveal.set(true);
      let call = 0;
      admin.reservedCarts.and.callFake(() => {
        call += 1;
        return call === 1
          ? throwError(() => ({ status: 403 }))
          : of({ cutoff: null, items: undefined } as unknown as CartReservationsResponse);
      });

      component.openReservations(makeRow({ product_id: 'p1' }), 'carts');

      expect(component.piiReveal()).toBe(false);
      expect(toast.error).toHaveBeenCalledWith('adminUi.pii.notAuthorized');
      expect(admin.reservedCarts).toHaveBeenCalledTimes(2);
      expect(component.reservationsCarts()).toEqual([]);
      expect(component.reservationsLoading()).toBe(false);
    });

    it('shows a generic cart error for a 403 when PII was not revealed', () => {
      admin.reservedCarts.and.returnValue(throwError(() => ({ status: 403 })));
      component.openReservations(makeRow(), 'carts');
      expect(component.reservationsError()).toBe('adminUi.errors.generic');
      expect(component.reservationsLoading()).toBe(false);
    });

    it('shows a generic cart error for non-403 failures', () => {
      admin.reservedCarts.and.returnValue(throwError(() => ({ status: 500 })));
      component.openReservations(makeRow(), 'carts');
      expect(component.reservationsError()).toBe('adminUi.errors.generic');
    });

    it('loads order reservations on success', () => {
      admin.reservedOrders.and.returnValue(
        of({ items: [{ order_id: 'o1', status: 'paid', created_at: 'c', quantity: 2 }] }),
      );
      component.openReservations(makeRow(), 'orders');
      expect(component.reservationsOrders().length).toBe(1);
      expect(component.reservationsLoading()).toBe(false);
    });

    it('retries orders without PII after a 403 when PII was revealed', () => {
      component.piiReveal.set(true);
      let call = 0;
      admin.reservedOrders.and.callFake(() => {
        call += 1;
        return call === 1
          ? throwError(() => ({ status: 403 }))
          : of({ items: undefined } as unknown as OrderReservationsResponse);
      });

      component.openReservations(makeRow(), 'orders');

      expect(component.piiReveal()).toBe(false);
      expect(admin.reservedOrders).toHaveBeenCalledTimes(2);
      expect(component.reservationsOrders()).toEqual([]);
    });

    it('shows a generic order error when the failure has no status', () => {
      admin.reservedOrders.and.returnValue(throwError(() => null));
      component.openReservations(makeRow(), 'orders');
      expect(component.reservationsError()).toBe('adminUi.errors.generic');
      expect(component.reservationsLoading()).toBe(false);
    });
  });
});
