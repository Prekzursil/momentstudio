import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import {
  AdminService,
  CartReservationsResponse,
  OrderReservationsResponse,
  RestockListItem,
  RestockListResponse,
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
    sku: 'SKU-1',
    product_slug: 'slug-1',
    product_name: 'Product One',
    variant_name: null,
    stock_quantity: 10,
    reserved_in_carts: 0,
    reserved_in_orders: 0,
    available_quantity: 10,
    threshold: 5,
    is_critical: false,
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
  } as RestockRow;
}

function emptyResponse(): RestockListResponse {
  return {
    items: [],
    meta: { page: 1, limit: 50, total_items: 0, total_pages: 1 },
  };
}

describe('AdminInventoryComponent', () => {
  let admin: jasmine.SpyObj<AdminService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: jasmine.SpyObj<Router>;

  beforeEach(async () => {
    admin = jasmine.createSpyObj<AdminService>('AdminService', [
      'restockList',
      'applyStockAdjustment',
      'exportRestockListCsv',
      'upsertRestockNote',
      'reservedCarts',
      'reservedOrders',
    ]);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);

    admin.restockList.and.returnValue(of(emptyResponse()));
    admin.applyStockAdjustment.and.returnValue(of({} as any));
    admin.exportRestockListCsv.and.returnValue(of(new Blob()));
    admin.upsertRestockNote.and.returnValue(of(null));
    admin.reservedCarts.and.returnValue(
      of({ cutoff: '2026-01-01T00:00:00Z', items: [] } as CartReservationsResponse),
    );
    admin.reservedOrders.and.returnValue(of({ items: [] } as OrderReservationsResponse));
    router.navigate.and.returnValue(Promise.resolve(true));

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminInventoryComponent],
      providers: [
        { provide: AdminService, useValue: admin },
        { provide: ToastService, useValue: toast },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();
  });

  function create(): AdminInventoryComponent {
    return TestBed.createComponent(AdminInventoryComponent).componentInstance;
  }

  it('loads the restock list on init', () => {
    const cmp = create();
    cmp.ngOnInit();
    expect(admin.restockList).toHaveBeenCalled();
    expect(cmp.loading()).toBeFalse();
  });

  it('maps loaded items into editable rows, preserving and defaulting draft fields', () => {
    admin.restockList.and.returnValue(
      of({
        items: [
          makeItem({
            product_id: 'a',
            supplier: 'ACME',
            note: 'restock soon',
            desired_quantity: 12,
            note_updated_at: '2026-02-01T00:00:00Z',
          }),
          makeItem({ product_id: 'b', supplier: null, note: null, desired_quantity: null }),
          makeItem({ product_id: 'c', desired_quantity: undefined }),
        ],
        meta: { page: 3, limit: 50, total_items: 3, total_pages: 5 },
      } as RestockListResponse),
    );
    const cmp = create();
    cmp.retryLoad();
    const rows = cmp.rows();
    expect(rows.length).toBe(3);
    expect(rows[0].draftSupplier).toBe('ACME');
    expect(rows[0].draftDesiredQuantity).toBe('12');
    expect(rows[0].draftNote).toBe('restock soon');
    expect(rows[1].draftSupplier).toBe('');
    expect(rows[1].draftDesiredQuantity).toBe('');
    expect(rows[2].draftDesiredQuantity).toBe('');
    expect(cmp.meta()?.total_pages).toBe(5);
    expect(cmp.page).toBe(3);
  });

  it('defaults null items/meta payloads and keeps the current page', () => {
    admin.restockList.and.returnValue(of({ items: null, meta: null } as any));
    const cmp = create();
    cmp.page = 7;
    cmp.retryLoad();
    expect(cmp.rows()).toEqual([]);
    expect(cmp.meta()).toBeNull();
    expect(cmp.page).toBe(7);
    expect(cmp.loading()).toBeFalse();
  });

  it('records a translated error and request id when loading fails', () => {
    admin.restockList.and.returnValue(throwError(() => ({ headers: { get: () => 'req-123' } })));
    const cmp = create();
    cmp.retryLoad();
    expect(cmp.error()).toBeTruthy();
    expect(cmp.rows()).toEqual([]);
    expect(cmp.meta()).toBeNull();
    expect(cmp.loading()).toBeFalse();
  });

  it('derives stable track/selection keys for variant and product rows', () => {
    const cmp = create();
    const variant = makeRow({ kind: 'variant', product_id: 'p', variant_id: 'v1' });
    const product = makeRow({ kind: 'product', product_id: 'p', variant_id: null });
    expect(cmp.trackByKey(0, variant)).toBe('variant:v1');
    expect(cmp.trackByKey(0, product)).toBe('product:p');
  });

  it('reflects selection state and select-all across the page', () => {
    const cmp = create();
    const a = makeRow({ product_id: 'a' });
    const b = makeRow({ product_id: 'b' });
    cmp.rows.set([a, b]);
    expect(cmp.allSelectedOnPage()).toBeFalse();
    expect(cmp.isSelected(a)).toBeFalse();

    cmp.toggleSelectRow(a, { target: { checked: true } } as unknown as Event);
    expect(cmp.isSelected(a)).toBeTrue();
    expect(cmp.allSelectedOnPage()).toBeFalse();

    cmp.toggleSelectRow(b, { target: { checked: true } } as unknown as Event);
    expect(cmp.allSelectedOnPage()).toBeTrue();

    cmp.toggleSelectRow(a, { target: { checked: false } } as unknown as Event);
    expect(cmp.isSelected(a)).toBeFalse();

    cmp.toggleSelectRow(b, {} as Event); // no target -> unchecked
    expect(cmp.isSelected(b)).toBeFalse();
  });

  it('reports no full-page selection when there are no rows', () => {
    const cmp = create();
    cmp.rows.set([]);
    expect(cmp.allSelectedOnPage()).toBeFalse();
  });

  it('selects and clears every row on the page', () => {
    const cmp = create();
    const a = makeRow({ product_id: 'a' });
    const b = makeRow({ product_id: 'b' });
    cmp.rows.set([a, b]);

    cmp.toggleSelectAll({ target: { checked: true } } as unknown as Event);
    expect(cmp.allSelectedOnPage()).toBeTrue();

    cmp.toggleSelectAll({ target: { checked: false } } as unknown as Event);
    expect(cmp.isSelected(a)).toBeFalse();
    expect(cmp.isSelected(b)).toBeFalse();

    cmp.selected.add((cmp as any).rowKey(a));
    cmp.clearSelection();
    expect(cmp.selected.size).toBe(0);

    cmp.toggleSelectAll({} as Event); // no target -> treated as unchecked
    expect(cmp.selected.size).toBe(0);
  });

  it('prunes selection keys that are absent from the freshly loaded rows', () => {
    admin.restockList.and.returnValue(
      of({
        items: [makeItem({ product_id: 'present' })],
        meta: emptyResponse().meta,
      } as RestockListResponse),
    );
    const cmp = create();
    cmp.selected.add('product:present');
    cmp.selected.add('product:gone');
    cmp.retryLoad();
    expect(cmp.selected.has('product:present')).toBeTrue();
    expect(cmp.selected.has('product:gone')).toBeFalse();
  });

  it('ignores a bulk adjustment while one is already in flight', () => {
    const cmp = create();
    cmp.bulkAdjustBusy.set(true);
    cmp.applyBulkStockAdjustment();
    expect(admin.applyStockAdjustment).not.toHaveBeenCalled();
  });

  it('rejects a non-integer bulk delta', () => {
    const cmp = create();
    cmp.bulkAdjustDelta = '1.5';
    cmp.applyBulkStockAdjustment();
    expect(cmp.bulkAdjustError()).toBeTruthy();
    expect(admin.applyStockAdjustment).not.toHaveBeenCalled();
  });

  it('rejects a zero bulk delta, including a null delta value', () => {
    const cmp = create();
    cmp.bulkAdjustDelta = '0';
    cmp.applyBulkStockAdjustment();
    expect(cmp.bulkAdjustError()).toBeTruthy();

    cmp.bulkAdjustError.set(null);
    cmp.bulkAdjustDelta = null as unknown as string;
    cmp.applyBulkStockAdjustment();
    expect(cmp.bulkAdjustError()).toBeTruthy();
    expect(admin.applyStockAdjustment).not.toHaveBeenCalled();
  });

  it('requires a note for a bulk adjustment', () => {
    const cmp = create();
    cmp.bulkAdjustDelta = '5';
    cmp.bulkAdjustNote = '';
    cmp.applyBulkStockAdjustment();
    expect(cmp.bulkAdjustError()).toBeTruthy();
    expect(admin.applyStockAdjustment).not.toHaveBeenCalled();

    // whitespace-only note (truthy string) still resolves to an empty note
    cmp.bulkAdjustError.set(null);
    cmp.bulkAdjustNote = '   ';
    cmp.applyBulkStockAdjustment();
    expect(cmp.bulkAdjustError()).toBeTruthy();
    expect(admin.applyStockAdjustment).not.toHaveBeenCalled();
  });

  it('does nothing when a valid bulk adjustment has no selected rows', () => {
    const cmp = create();
    cmp.rows.set([makeRow({ product_id: 'a' })]);
    cmp.bulkAdjustDelta = '5';
    cmp.bulkAdjustNote = 'note';
    cmp.applyBulkStockAdjustment();
    expect(admin.applyStockAdjustment).not.toHaveBeenCalled();
    expect(cmp.bulkAdjustBusy()).toBeFalse();
  });

  it('applies a bulk adjustment across selected variant and product rows', () => {
    const variant = makeRow({ kind: 'variant', product_id: 'p', variant_id: 'v1' });
    const product = makeRow({ kind: 'product', product_id: 'q', variant_id: null });
    const cmp = create();
    cmp.rows.set([variant, product]);
    cmp.selected.add((cmp as any).rowKey(variant));
    cmp.selected.add((cmp as any).rowKey(product));
    cmp.bulkAdjustDelta = '5';
    cmp.bulkAdjustNote = 'bulk note';
    cmp.bulkAdjustReason = 'restock';

    cmp.applyBulkStockAdjustment();

    expect(admin.applyStockAdjustment).toHaveBeenCalledTimes(2);
    expect(admin.applyStockAdjustment).toHaveBeenCalledWith(
      jasmine.objectContaining({ product_id: 'p', variant_id: 'v1', delta: 5, reason: 'restock' }),
    );
    expect(admin.applyStockAdjustment).toHaveBeenCalledWith(
      jasmine.objectContaining({ product_id: 'q', variant_id: null }),
    );
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.bulkAdjustBusy()).toBeFalse();
    expect(cmp.bulkAdjustDelta).toBe('');
    expect(cmp.bulkAdjustNote).toBe('');
    expect(cmp.selected.size).toBe(0);
    // load() re-invoked after success
    expect(admin.restockList).toHaveBeenCalled();
  });

  it('flags failures when every bulk adjustment request errors', () => {
    admin.applyStockAdjustment.and.returnValue(throwError(() => new Error('boom')));
    const row = makeRow({ product_id: 'a' });
    const cmp = create();
    cmp.rows.set([row]);
    cmp.selected.add((cmp as any).rowKey(row));
    cmp.bulkAdjustDelta = '3';
    cmp.bulkAdjustNote = 'note';

    cmp.applyBulkStockAdjustment();

    expect(toast.error).toHaveBeenCalled();
    expect(cmp.bulkAdjustError()).toBeTruthy();
    expect(cmp.bulkAdjustBusy()).toBeFalse();
  });

  it('handles a hard failure of the bulk adjustment stream', () => {
    admin.applyStockAdjustment.and.throwError(new Error('synchronous explosion'));
    const row = makeRow({ product_id: 'a' });
    const cmp = create();
    cmp.rows.set([row]);
    cmp.selected.add((cmp as any).rowKey(row));
    cmp.bulkAdjustDelta = '3';
    cmp.bulkAdjustNote = 'note';

    cmp.applyBulkStockAdjustment();

    expect(cmp.bulkAdjustBusy()).toBeFalse();
    expect(cmp.bulkAdjustError()).toBeTruthy();
  });

  it('resets to page one when filters are applied', () => {
    const cmp = create();
    cmp.page = 4;
    cmp.applyFilters();
    expect(cmp.page).toBe(1);
    expect(admin.restockList).toHaveBeenCalled();
  });

  it('clamps page navigation to a minimum of one and reloads the clamped page', () => {
    const cmp = create();
    admin.restockList.calls.reset();
    cmp.goToPage(0);
    expect(admin.restockList).toHaveBeenCalledWith(jasmine.objectContaining({ page: 1 }));
    cmp.goToPage(3);
    expect(admin.restockList).toHaveBeenCalledWith(jasmine.objectContaining({ page: 3 }));
  });

  it('navigates to the product editor with the slug in router state', () => {
    const cmp = create();
    cmp.openProduct(makeRow({ product_slug: 'cool-slug' }));
    expect(router.navigate).toHaveBeenCalledWith(
      ['/admin/products'],
      { state: { editProductSlug: 'cool-slug' } },
    );
  });

  it('navigates to an order detail', () => {
    const cmp = create();
    cmp.openOrder('order-9');
    expect(router.navigate).toHaveBeenCalledWith(['/admin/orders', 'order-9']);
  });

  it('toggles PII reveal without reloading when no reservations are open', () => {
    const cmp = create();
    expect(cmp.piiReveal()).toBeFalse();
    cmp.togglePiiReveal();
    expect(cmp.piiReveal()).toBeTrue();
    expect(admin.reservedCarts).not.toHaveBeenCalled();
  });

  it('reloads open reservations with PII when toggled on', () => {
    const cmp = create();
    cmp.openReservations(makeRow({ product_id: 'p' }), 'carts');
    admin.reservedCarts.calls.reset();
    cmp.togglePiiReveal();
    expect(cmp.piiReveal()).toBeTrue();
    expect(admin.reservedCarts).toHaveBeenCalledWith(
      jasmine.objectContaining({ include_pii: true }),
    );
  });

  it('maps the reservation kind to a title key', () => {
    const cmp = create();
    cmp.reservationsKind.set('carts');
    expect(cmp.reservationTitleKey()).toBe('adminUi.inventory.reservations.cartsTitle');
    cmp.reservationsKind.set('orders');
    expect(cmp.reservationTitleKey()).toBe('adminUi.inventory.reservations.ordersTitle');
    cmp.reservationsKind.set(null);
    expect(cmp.reservationTitleKey()).toBe('adminUi.inventory.title');
  });

  it('builds the reservation subtitle from the active target', () => {
    const cmp = create();
    expect(cmp.reservationSubtitle()).toBe('');

    cmp.reservationsTarget.set({
      product_id: 'p',
      sku: 'SKU-9',
      product_name: 'Widget',
      variant_name: 'Large',
    });
    expect(cmp.reservationSubtitle()).toBe('Widget — Large · SKU-9');

    cmp.reservationsTarget.set({
      product_id: 'p',
      sku: 'SKU-9',
      product_name: 'Widget',
      variant_name: null,
    });
    expect(cmp.reservationSubtitle()).toBe('Widget · SKU-9');
  });

  it('ignores opening reservations while a reservation request is loading', () => {
    const cmp = create();
    cmp.reservationsLoading.set(true);
    cmp.openReservations(makeRow(), 'carts');
    expect(cmp.reservationsOpen()).toBeFalse();
    expect(admin.reservedCarts).not.toHaveBeenCalled();
  });

  it('opens cart reservations for a variant row and stores the variant id', () => {
    admin.reservedCarts.and.returnValue(
      of({
        cutoff: '2026-03-01T00:00:00Z',
        items: [{ cart_id: 'c1', updated_at: '2026-03-01T00:00:00Z', quantity: 2 }],
      } as CartReservationsResponse),
    );
    const cmp = create();
    cmp.openReservations(
      makeRow({ kind: 'variant', product_id: 'p', variant_id: 'v9', variant_name: 'Blue' }),
      'carts',
    );
    expect(cmp.reservationsOpen()).toBeTrue();
    expect(cmp.reservationsKind()).toBe('carts');
    expect(cmp.reservationsTarget()?.variant_id).toBe('v9');
    expect(cmp.reservationsCutoff()).toBe('2026-03-01T00:00:00Z');
    expect(cmp.reservationsCarts().length).toBe(1);
    expect(cmp.reservationsLoading()).toBeFalse();
  });

  it('treats a variant row without a variant id, and product rows, as having no variant', () => {
    const cmp = create();
    cmp.openReservations(
      makeRow({ kind: 'variant', product_id: 'p', variant_id: null }),
      'carts',
    );
    expect(cmp.reservationsTarget()?.variant_id).toBeUndefined();

    cmp.closeReservations();
    cmp.openReservations(makeRow({ kind: 'product', product_id: 'q' }), 'carts');
    expect(cmp.reservationsTarget()?.variant_id).toBeUndefined();
  });

  it('defaults empty cart reservation payloads', () => {
    admin.reservedCarts.and.returnValue(of({ cutoff: null, items: null } as any));
    const cmp = create();
    cmp.openReservations(makeRow(), 'carts');
    expect(cmp.reservationsCutoff()).toBeNull();
    expect(cmp.reservationsCarts()).toEqual([]);
  });

  it('drops PII and retries when a cart reservation request is forbidden', () => {
    admin.reservedCarts.and.returnValues(
      throwError(() => ({ status: 403 })),
      of({ cutoff: null, items: [] } as any),
    );
    const cmp = create();
    cmp.piiReveal.set(true);
    cmp.openReservations(makeRow(), 'carts');
    expect(cmp.piiReveal()).toBeFalse();
    expect(toast.error).toHaveBeenCalled();
    expect(admin.reservedCarts).toHaveBeenCalledTimes(2);
    expect(cmp.reservationsLoading()).toBeFalse();
  });

  it('surfaces a generic error for a non-forbidden cart reservation failure', () => {
    admin.reservedCarts.and.returnValue(throwError(() => ({ status: 500 })));
    const cmp = create();
    cmp.openReservations(makeRow(), 'carts');
    expect(cmp.reservationsError()).toBeTruthy();
    expect(cmp.reservationsLoading()).toBeFalse();
  });

  it('opens order reservations and defaults empty payloads', () => {
    admin.reservedOrders.and.returnValue(
      of({
        items: [
          {
            order_id: 'o1',
            status: 'paid',
            created_at: '2026-03-01T00:00:00Z',
            quantity: 1,
          },
        ],
      } as OrderReservationsResponse),
    );
    const cmp = create();
    cmp.openReservations(makeRow(), 'orders');
    expect(cmp.reservationsOrders().length).toBe(1);

    admin.reservedOrders.and.returnValue(of({ items: null } as any));
    cmp.openReservations(makeRow(), 'orders');
    expect(cmp.reservationsOrders()).toEqual([]);
  });

  it('drops PII and retries when an order reservation request is forbidden', () => {
    admin.reservedOrders.and.returnValues(
      throwError(() => ({ status: 403 })),
      of({ items: [] } as OrderReservationsResponse),
    );
    const cmp = create();
    cmp.piiReveal.set(true);
    cmp.openReservations(makeRow(), 'orders');
    expect(cmp.piiReveal()).toBeFalse();
    expect(admin.reservedOrders).toHaveBeenCalledTimes(2);
    expect(cmp.reservationsLoading()).toBeFalse();
  });

  it('surfaces a generic error for a non-forbidden order reservation failure', () => {
    admin.reservedOrders.and.returnValue(throwError(() => ({ status: 500 })));
    const cmp = create();
    cmp.openReservations(makeRow(), 'orders');
    expect(cmp.reservationsError()).toBeTruthy();
    expect(cmp.reservationsLoading()).toBeFalse();
  });

  it('does nothing when reloading reservations without a kind or a target', () => {
    const cmp = create();
    cmp.closeReservations();
    (cmp as any).reloadReservations();
    expect(admin.reservedCarts).not.toHaveBeenCalled();

    cmp.reservationsKind.set('carts');
    cmp.reservationsTarget.set(null);
    (cmp as any).reloadReservations();
    expect(admin.reservedCarts).not.toHaveBeenCalled();
  });

  it('closes reservations and resets all reservation state', () => {
    const cmp = create();
    cmp.openReservations(makeRow(), 'carts');
    cmp.reservationsError.set('boom');
    cmp.closeReservations();
    expect(cmp.reservationsOpen()).toBeFalse();
    expect(cmp.reservationsKind()).toBeNull();
    expect(cmp.reservationsTarget()).toBeNull();
    expect(cmp.reservationsError()).toBeNull();
    expect(cmp.reservationsCutoff()).toBeNull();
    expect(cmp.reservationsCarts()).toEqual([]);
    expect(cmp.reservationsOrders()).toEqual([]);
  });

  it('ignores an export while one is already running', () => {
    const cmp = create();
    cmp.exporting = true;
    cmp.exportCsv();
    expect(admin.exportRestockListCsv).not.toHaveBeenCalled();
  });

  it('exports the restock CSV and triggers a download', () => {
    const cmp = create();
    const createObjSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    const revokeSpy = spyOn(URL, 'revokeObjectURL');
    const clickSpy = spyOn(HTMLAnchorElement.prototype, 'click');
    cmp.exportCsv();
    expect(admin.exportRestockListCsv).toHaveBeenCalled();
    expect(createObjSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.exporting).toBeFalse();
  });

  it('reports an export failure', () => {
    admin.exportRestockListCsv.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.exportCsv();
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.exporting).toBeFalse();
  });

  it('skips saving a note when the row is not dirty or already saving', () => {
    const cmp = create();
    cmp.saveNote(makeRow({ isDirty: false }));
    expect(admin.upsertRestockNote).not.toHaveBeenCalled();

    cmp.saveNote(makeRow({ isDirty: true, isSaving: true }));
    expect(admin.upsertRestockNote).not.toHaveBeenCalled();
  });

  it('saves a populated restock note and clamps the desired quantity', () => {
    const cmp = create();
    const row = makeRow({
      product_id: 'p',
      variant_id: 'v1',
      isDirty: true,
      draftSupplier: '  ACME  ',
      draftDesiredQuantity: ' -4 ',
      draftNote: '  hello  ',
    });
    cmp.saveNote(row);
    expect(admin.upsertRestockNote).toHaveBeenCalledWith({
      product_id: 'p',
      variant_id: 'v1',
      supplier: 'ACME',
      desired_quantity: 0,
      note: 'hello',
    });
    expect(toast.success).toHaveBeenCalled();
    expect(row.isSaving).toBeFalse();
    expect(row.isDirty).toBeFalse();
  });

  it('saves an empty restock note as null fields', () => {
    const cmp = create();
    const row = makeRow({
      product_id: 'p',
      variant_id: null,
      isDirty: true,
      draftSupplier: '   ',
      draftDesiredQuantity: '   ',
      draftNote: '   ',
    });
    cmp.saveNote(row);
    expect(admin.upsertRestockNote).toHaveBeenCalledWith({
      product_id: 'p',
      variant_id: null,
      supplier: null,
      desired_quantity: null,
      note: null,
    });
  });

  it('reports a note save failure and clears the saving flag', () => {
    admin.upsertRestockNote.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    const row = makeRow({ isDirty: true, draftDesiredQuantity: '5' });
    cmp.saveNote(row);
    expect(toast.error).toHaveBeenCalled();
    expect(row.isSaving).toBeFalse();
  });
});
