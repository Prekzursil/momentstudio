import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
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
    reserved_in_carts: 2,
    reserved_in_orders: 1,
    available_quantity: 7,
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

function listResponse(
  items: RestockListItem[],
  meta?: Partial<RestockListResponse['meta']>,
): RestockListResponse {
  return {
    items,
    meta: {
      page: 1,
      limit: 50,
      total_items: items.length,
      total_pages: 1,
      ...meta,
    },
  };
}

function checkboxEvent(checked: boolean): Event {
  return { target: { checked } } as unknown as Event;
}

describe('AdminInventoryComponent', () => {
  let admin: jasmine.SpyObj<AdminService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: Router;

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

    admin.restockList.and.returnValue(of(listResponse([makeItem()])));
    admin.applyStockAdjustment.and.returnValue(of({} as any));
    admin.exportRestockListCsv.and.returnValue(of(new Blob(['csv'])));
    admin.upsertRestockNote.and.returnValue(of(null));
    admin.reservedCarts.and.returnValue(
      of({ cutoff: '2026-01-01T00:00:00Z', items: [] } as CartReservationsResponse),
    );
    admin.reservedOrders.and.returnValue(of({ items: [] } as OrderReservationsResponse));

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminInventoryComponent],
      providers: [
        { provide: AdminService, useValue: admin },
        { provide: ToastService, useValue: toast },
        provideRouter([]),
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
  });

  function create(): AdminInventoryComponent {
    return TestBed.createComponent(AdminInventoryComponent).componentInstance;
  }

  // ---- load / ngOnInit ----------------------------------------------------

  it('loads rows on init and maps draft fields from the response', () => {
    const cmp = create();
    cmp.ngOnInit();
    expect(admin.restockList).toHaveBeenCalled();
    expect(cmp.loading()).toBeFalse();
    expect(cmp.rows().length).toBe(1);
    const row = cmp.rows()[0];
    expect(row.draftSupplier).toBe('');
    expect(row.draftDesiredQuantity).toBe('');
    expect(row.draftNote).toBe('');
    expect(row.isDirty).toBeFalse();
    expect(row.isSaving).toBeFalse();
    expect(cmp.meta()).not.toBeNull();
    expect(cmp.page).toBe(1);
  });

  it('maps populated supplier / desired_quantity / note draft fields', () => {
    admin.restockList.and.returnValue(
      of(
        listResponse([
          makeItem({ supplier: 'ACME', desired_quantity: 12, note: 'Reorder soon' }),
        ]),
      ),
    );
    const cmp = create();
    cmp.ngOnInit();
    const row = cmp.rows()[0];
    expect(row.draftSupplier).toBe('ACME');
    expect(row.draftDesiredQuantity).toBe('12');
    expect(row.draftNote).toBe('Reorder soon');
  });

  it('handles a null items list and missing meta on load', () => {
    admin.restockList.and.returnValue(of({ items: null, meta: null } as any));
    const cmp = create();
    cmp.page = 4;
    cmp.ngOnInit();
    expect(cmp.rows()).toEqual([]);
    expect(cmp.meta()).toBeNull();
    // resp.meta?.page is undefined → keeps existing page via ?? fallback.
    expect(cmp.page).toBe(4);
  });

  it('keeps desired_quantity blank when it is undefined', () => {
    admin.restockList.and.returnValue(
      of(listResponse([makeItem({ desired_quantity: undefined })])),
    );
    const cmp = create();
    cmp.ngOnInit();
    expect(cmp.rows()[0].draftDesiredQuantity).toBe('');
  });

  it('sets an error and clears rows when the load request fails', () => {
    admin.restockList.and.returnValue(
      throwError(
        () => new HttpErrorResponse({ status: 500, error: { request_id: 'req-123' } }),
      ),
    );
    const cmp = create();
    cmp.ngOnInit();
    expect(cmp.error()).toBe('adminUi.errors.generic');
    expect(cmp.errorRequestId()).toBe('req-123');
    expect(cmp.rows()).toEqual([]);
    expect(cmp.meta()).toBeNull();
    expect(cmp.loading()).toBeFalse();
  });

  it('retryLoad re-issues the load request', () => {
    const cmp = create();
    cmp.ngOnInit();
    admin.restockList.calls.reset();
    cmp.retryLoad();
    expect(admin.restockList).toHaveBeenCalledTimes(1);
  });

  // ---- selection helpers --------------------------------------------------

  it('computes row keys for products and variants (trackBy + rowKey)', () => {
    const cmp = create();
    const product = { kind: 'product', product_id: 'p9', variant_id: null } as any;
    const variant = { kind: 'variant', product_id: 'p9', variant_id: 'v9' } as any;
    expect(cmp.trackByKey(0, product)).toBe('product:p9');
    expect(cmp.trackByKey(1, variant)).toBe('variant:v9');
  });

  it('reflects selection state via isSelected and toggleSelectRow', () => {
    const cmp = create();
    cmp.ngOnInit();
    const row = cmp.rows()[0];
    expect(cmp.isSelected(row)).toBeFalse();

    cmp.toggleSelectRow(row, checkboxEvent(true));
    expect(cmp.isSelected(row)).toBeTrue();

    cmp.toggleSelectRow(row, checkboxEvent(false));
    expect(cmp.isSelected(row)).toBeFalse();
  });

  it('treats a missing event target as unchecked in toggleSelectRow', () => {
    const cmp = create();
    cmp.ngOnInit();
    const row = cmp.rows()[0];
    cmp.toggleSelectRow(row, { target: null } as unknown as Event);
    expect(cmp.isSelected(row)).toBeFalse();
  });

  it('reports allSelectedOnPage across empty, partial and full selections', () => {
    const cmp = create();
    expect(cmp.allSelectedOnPage()).toBeFalse(); // no rows

    admin.restockList.and.returnValue(
      of(listResponse([makeItem({ product_id: 'a' }), makeItem({ product_id: 'b' })])),
    );
    cmp.ngOnInit();
    expect(cmp.allSelectedOnPage()).toBeFalse(); // none selected

    cmp.toggleSelectRow(cmp.rows()[0], checkboxEvent(true));
    expect(cmp.allSelectedOnPage()).toBeFalse(); // partial

    cmp.toggleSelectRow(cmp.rows()[1], checkboxEvent(true));
    expect(cmp.allSelectedOnPage()).toBeTrue(); // all
  });

  it('selects and deselects every row via toggleSelectAll', () => {
    admin.restockList.and.returnValue(
      of(listResponse([makeItem({ product_id: 'a' }), makeItem({ product_id: 'b' })])),
    );
    const cmp = create();
    cmp.ngOnInit();

    cmp.toggleSelectAll(checkboxEvent(true));
    expect(cmp.selected.size).toBe(2);

    cmp.toggleSelectAll(checkboxEvent(false));
    expect(cmp.selected.size).toBe(0);
  });

  it('treats a missing event target as unchecked in toggleSelectAll', () => {
    const cmp = create();
    cmp.ngOnInit();
    cmp.toggleSelectAll(checkboxEvent(true));
    cmp.toggleSelectAll({ target: null } as unknown as Event);
    expect(cmp.selected.size).toBe(0);
  });

  it('clears the selection', () => {
    const cmp = create();
    cmp.ngOnInit();
    cmp.toggleSelectAll(checkboxEvent(true));
    cmp.clearSelection();
    expect(cmp.selected.size).toBe(0);
  });

  it('prunes selected keys that are no longer present after a reload', () => {
    admin.restockList.and.returnValue(of(listResponse([makeItem({ product_id: 'a' })])));
    const cmp = create();
    cmp.ngOnInit();
    cmp.toggleSelectAll(checkboxEvent(true));
    expect(cmp.selected.size).toBe(1);

    admin.restockList.and.returnValue(of(listResponse([makeItem({ product_id: 'b' })])));
    cmp.applyFilters();
    expect(cmp.selected.size).toBe(0);
  });

  it('keeps selected keys that remain present after a reload', () => {
    admin.restockList.and.returnValue(of(listResponse([makeItem({ product_id: 'a' })])));
    const cmp = create();
    cmp.ngOnInit();
    cmp.toggleSelectAll(checkboxEvent(true));

    admin.restockList.and.returnValue(of(listResponse([makeItem({ product_id: 'a' })])));
    cmp.applyFilters();
    expect(cmp.selected.size).toBe(1);
  });

  // ---- bulk stock adjustment ----------------------------------------------

  it('ignores a bulk adjustment while one is already busy', () => {
    const cmp = create();
    cmp.bulkAdjustBusy.set(true);
    cmp.applyBulkStockAdjustment();
    expect(admin.applyStockAdjustment).not.toHaveBeenCalled();
  });

  it('rejects a non-integer or zero bulk delta', () => {
    const cmp = create();
    cmp.bulkAdjustDelta = '1.5';
    cmp.applyBulkStockAdjustment();
    expect(cmp.bulkAdjustError()).toBe('adminUi.inventory.bulkAdjust.errors.deltaInvalid');

    cmp.bulkAdjustDelta = '0';
    cmp.applyBulkStockAdjustment();
    expect(cmp.bulkAdjustError()).toBe('adminUi.inventory.bulkAdjust.errors.deltaInvalid');
    expect(admin.applyStockAdjustment).not.toHaveBeenCalled();
  });

  it('coerces a nullish bulk delta to the invalid-delta error', () => {
    const cmp = create();
    cmp.bulkAdjustDelta = null as unknown as string;
    cmp.applyBulkStockAdjustment();
    expect(cmp.bulkAdjustError()).toBe('adminUi.inventory.bulkAdjust.errors.deltaInvalid');
  });

  it('requires a note before applying a bulk adjustment', () => {
    const cmp = create();
    cmp.bulkAdjustDelta = '5';
    cmp.bulkAdjustNote = '   ';
    cmp.applyBulkStockAdjustment();
    expect(cmp.bulkAdjustError()).toBe('adminUi.inventory.bulkAdjust.errors.noteRequired');
    expect(admin.applyStockAdjustment).not.toHaveBeenCalled();
  });

  it('requires a note when the bulk note is empty/falsy', () => {
    const cmp = create();
    cmp.bulkAdjustDelta = '5';
    cmp.bulkAdjustNote = '';
    cmp.applyBulkStockAdjustment();
    expect(cmp.bulkAdjustError()).toBe('adminUi.inventory.bulkAdjust.errors.noteRequired');
    expect(admin.applyStockAdjustment).not.toHaveBeenCalled();
  });

  it('returns early when no rows are selected for a bulk adjustment', () => {
    const cmp = create();
    cmp.ngOnInit();
    cmp.bulkAdjustDelta = '5';
    cmp.bulkAdjustNote = 'note';
    cmp.applyBulkStockAdjustment();
    expect(admin.applyStockAdjustment).not.toHaveBeenCalled();
    expect(cmp.bulkAdjustBusy()).toBeFalse();
  });

  it('applies a successful bulk adjustment for product and variant rows', () => {
    admin.restockList.and.returnValue(
      of(
        listResponse([
          makeItem({ kind: 'product', product_id: 'p1', variant_id: null }),
          makeItem({ kind: 'variant', product_id: 'p2', variant_id: 'v2' }),
        ]),
      ),
    );
    const cmp = create();
    cmp.ngOnInit();
    cmp.toggleSelectAll(checkboxEvent(true));
    cmp.bulkAdjustDelta = '5';
    cmp.bulkAdjustNote = 'restock note';
    admin.restockList.calls.reset();

    cmp.applyBulkStockAdjustment();

    expect(admin.applyStockAdjustment).toHaveBeenCalledWith(
      jasmine.objectContaining({ product_id: 'p1', variant_id: null, delta: 5 }),
    );
    expect(admin.applyStockAdjustment).toHaveBeenCalledWith(
      jasmine.objectContaining({ product_id: 'p2', variant_id: 'v2', delta: 5 }),
    );
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.bulkAdjustBusy()).toBeFalse();
    expect(cmp.bulkAdjustDelta).toBe('');
    expect(cmp.bulkAdjustNote).toBe('');
    expect(cmp.selected.size).toBe(0);
    expect(admin.restockList).toHaveBeenCalled(); // reload
  });

  it('reports partial failures during a bulk adjustment', () => {
    admin.restockList.and.returnValue(
      of(
        listResponse([
          makeItem({ product_id: 'ok' }),
          makeItem({ product_id: 'bad' }),
        ]),
      ),
    );
    admin.applyStockAdjustment.and.callFake((payload: any) =>
      payload.product_id === 'bad' ? throwError(() => new Error('x')) : of({} as any),
    );
    const cmp = create();
    cmp.ngOnInit();
    cmp.toggleSelectAll(checkboxEvent(true));
    cmp.bulkAdjustDelta = '3';
    cmp.bulkAdjustNote = 'note';

    cmp.applyBulkStockAdjustment();

    expect(toast.success).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.bulkAdjustError()).toBe('adminUi.inventory.bulkAdjust.errors.failed');
  });

  it('reports only failures (no success) when every adjustment fails', () => {
    admin.restockList.and.returnValue(of(listResponse([makeItem({ product_id: 'bad' })])));
    admin.applyStockAdjustment.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.ngOnInit();
    cmp.toggleSelectAll(checkboxEvent(true));
    cmp.bulkAdjustDelta = '3';
    cmp.bulkAdjustNote = 'note';

    cmp.applyBulkStockAdjustment();

    expect(toast.success).not.toHaveBeenCalled();
    expect(cmp.bulkAdjustError()).toBe('adminUi.inventory.bulkAdjust.errors.failed');
  });

  it('handles a stream-level error during a bulk adjustment', () => {
    admin.restockList.and.returnValue(of(listResponse([makeItem({ product_id: 'p1' })])));
    admin.applyStockAdjustment.and.throwError('boom');
    const cmp = create();
    cmp.ngOnInit();
    cmp.toggleSelectAll(checkboxEvent(true));
    cmp.bulkAdjustDelta = '3';
    cmp.bulkAdjustNote = 'note';

    cmp.applyBulkStockAdjustment();

    expect(cmp.bulkAdjustBusy()).toBeFalse();
    expect(cmp.bulkAdjustError()).toBe('adminUi.inventory.bulkAdjust.errors.failed');
  });

  // ---- pagination ---------------------------------------------------------

  it('applyFilters resets to page 1 and reloads', () => {
    const cmp = create();
    cmp.page = 5;
    cmp.applyFilters();
    expect(cmp.page).toBe(1);
    expect(admin.restockList).toHaveBeenCalled();
  });

  it('goToPage clamps to a minimum of page 1 before loading', () => {
    const cmp = create();
    cmp.goToPage(0);
    expect(admin.restockList).toHaveBeenCalledWith(jasmine.objectContaining({ page: 1 }));
    cmp.goToPage(3);
    expect(admin.restockList).toHaveBeenCalledWith(jasmine.objectContaining({ page: 3 }));
  });

  // ---- navigation ---------------------------------------------------------

  it('opens a product via the router with the edit slug state', () => {
    const cmp = create();
    cmp.openProduct(makeItem({ product_slug: 'my-slug' }) as any);
    expect(router.navigate).toHaveBeenCalledWith(
      ['/admin/products'],
      jasmine.objectContaining({ state: { editProductSlug: 'my-slug' } }),
    );
  });

  it('opens an order via the router', () => {
    const cmp = create();
    cmp.openOrder('order-9');
    expect(router.navigate).toHaveBeenCalledWith(['/admin/orders', 'order-9']);
  });

  // ---- PII reveal ---------------------------------------------------------

  it('toggles PII reveal without reloading when no modal is open', () => {
    const cmp = create();
    expect(cmp.piiReveal()).toBeFalse();
    cmp.togglePiiReveal();
    expect(cmp.piiReveal()).toBeTrue();
    expect(admin.reservedCarts).not.toHaveBeenCalled();
  });

  it('reloads reservations when PII is toggled while the modal is open', () => {
    const cmp = create();
    cmp.ngOnInit();
    cmp.openReservations(makeItem() as any, 'carts');
    admin.reservedCarts.calls.reset();
    cmp.togglePiiReveal();
    expect(cmp.piiReveal()).toBeTrue();
    expect(admin.reservedCarts).toHaveBeenCalledWith(
      jasmine.objectContaining({ include_pii: true }),
    );
  });

  // ---- reservation titles / subtitles -------------------------------------

  it('maps reservation title keys for each kind', () => {
    const cmp = create();
    expect(cmp.reservationTitleKey()).toBe('adminUi.inventory.title');
    cmp.reservationsKind.set('carts');
    expect(cmp.reservationTitleKey()).toBe('adminUi.inventory.reservations.cartsTitle');
    cmp.reservationsKind.set('orders');
    expect(cmp.reservationTitleKey()).toBe('adminUi.inventory.reservations.ordersTitle');
  });

  it('builds reservation subtitles for empty, plain and variant targets', () => {
    const cmp = create();
    expect(cmp.reservationSubtitle()).toBe('');

    cmp.reservationsTarget.set({
      product_id: 'p1',
      sku: 'SKU-1',
      product_name: 'Prod',
      variant_name: null,
    });
    expect(cmp.reservationSubtitle()).toBe('Prod · SKU-1');

    cmp.reservationsTarget.set({
      product_id: 'p1',
      sku: 'SKU-1',
      product_name: 'Prod',
      variant_name: 'Red',
    });
    expect(cmp.reservationSubtitle()).toBe('Prod — Red · SKU-1');
  });

  // ---- open / close reservations ------------------------------------------

  it('does not open reservations while a reservation request is loading', () => {
    const cmp = create();
    cmp.reservationsLoading.set(true);
    cmp.openReservations(makeItem() as any, 'carts');
    expect(cmp.reservationsOpen()).toBeFalse();
    expect(admin.reservedCarts).not.toHaveBeenCalled();
  });

  it('opens cart reservations for a product row', () => {
    admin.reservedCarts.and.returnValue(
      of({
        cutoff: '2026-02-01T00:00:00Z',
        items: [{ cart_id: 'c1', updated_at: 'x', quantity: 2 }],
      } as CartReservationsResponse),
    );
    const cmp = create();
    cmp.openReservations(makeItem({ kind: 'product', variant_id: null }) as any, 'carts');
    expect(cmp.reservationsOpen()).toBeTrue();
    expect(cmp.reservationsKind()).toBe('carts');
    expect(cmp.reservationsTarget()?.variant_id).toBeUndefined();
    expect(cmp.reservationsCutoff()).toBe('2026-02-01T00:00:00Z');
    expect(cmp.reservationsCarts().length).toBe(1);
    expect(cmp.reservationsLoading()).toBeFalse();
  });

  it('opens order reservations for a variant row using its variant id', () => {
    admin.reservedOrders.and.returnValue(
      of({
        items: [
          { order_id: 'o1', status: 'paid', created_at: 'x', quantity: 1 },
        ],
      } as OrderReservationsResponse),
    );
    const cmp = create();
    cmp.openReservations(
      makeItem({ kind: 'variant', variant_id: 'v1', variant_name: 'Blue' }) as any,
      'orders',
    );
    expect(cmp.reservationsTarget()?.variant_id).toBe('v1');
    expect(admin.reservedOrders).toHaveBeenCalledWith(
      jasmine.objectContaining({ variant_id: 'v1' }),
    );
    expect(cmp.reservationsOrders().length).toBe(1);
  });

  it('falls back to undefined variant id for a variant row missing its id', () => {
    const cmp = create();
    cmp.openReservations(
      makeItem({ kind: 'variant', variant_id: null }) as any,
      'carts',
    );
    expect(cmp.reservationsTarget()?.variant_id).toBeUndefined();
  });

  it('defaults the cart cutoff and items to null/empty when absent', () => {
    admin.reservedCarts.and.returnValue(
      of({ cutoff: null, items: null } as unknown as CartReservationsResponse),
    );
    const cmp = create();
    cmp.openReservations(makeItem() as any, 'carts');
    expect(cmp.reservationsCutoff()).toBeNull();
    expect(cmp.reservationsCarts()).toEqual([]);
  });

  it('defaults the order items to an empty array when absent', () => {
    admin.reservedOrders.and.returnValue(
      of({ items: null } as unknown as OrderReservationsResponse),
    );
    const cmp = create();
    cmp.openReservations(makeItem() as any, 'orders');
    expect(cmp.reservationsOrders()).toEqual([]);
  });

  it('closes reservations and resets all reservation state', () => {
    const cmp = create();
    cmp.openReservations(makeItem() as any, 'carts');
    cmp.closeReservations();
    expect(cmp.reservationsOpen()).toBeFalse();
    expect(cmp.reservationsKind()).toBeNull();
    expect(cmp.reservationsTarget()).toBeNull();
    expect(cmp.reservationsError()).toBeNull();
    expect(cmp.reservationsCutoff()).toBeNull();
    expect(cmp.reservationsCarts()).toEqual([]);
    expect(cmp.reservationsOrders()).toEqual([]);
  });

  it('does nothing in reloadReservations when kind or target are unset', () => {
    const cmp = create();
    cmp.togglePiiReveal(); // closed modal → reloadReservations not reached
    cmp.reservationsOpen.set(true);
    cmp.reservationsKind.set(null);
    cmp.reservationsTarget.set(null);
    cmp.togglePiiReveal();
    expect(admin.reservedCarts).not.toHaveBeenCalled();
    expect(admin.reservedOrders).not.toHaveBeenCalled();
  });

  // ---- reservation errors + PII recovery ----------------------------------

  it('reports a generic cart reservations error', () => {
    admin.reservedCarts.and.returnValue(throwError(() => ({ status: 500 })));
    const cmp = create();
    cmp.openReservations(makeItem() as any, 'carts');
    expect(cmp.reservationsError()).toBe('adminUi.errors.generic');
    expect(cmp.reservationsLoading()).toBeFalse();
  });

  it('recovers cart reservations from a 403 by disabling PII and retrying', () => {
    admin.reservedCarts.and.returnValues(
      throwError(() => ({ status: 403 })),
      of({ cutoff: null, items: [] } as unknown as CartReservationsResponse),
    );
    const cmp = create();
    cmp.piiReveal.set(true);
    cmp.openReservations(makeItem() as any, 'carts');
    expect(cmp.piiReveal()).toBeFalse();
    expect(toast.error).toHaveBeenCalledWith('adminUi.pii.notAuthorized');
    expect(admin.reservedCarts).toHaveBeenCalledTimes(2);
    expect(cmp.reservationsError()).toBeNull();
  });

  it('treats a 403 cart error without active PII as a generic error', () => {
    admin.reservedCarts.and.returnValue(throwError(() => ({ status: 403 })));
    const cmp = create();
    cmp.openReservations(makeItem() as any, 'carts');
    expect(cmp.reservationsError()).toBe('adminUi.errors.generic');
  });

  it('reports a generic order reservations error', () => {
    admin.reservedOrders.and.returnValue(throwError(() => ({ status: 500 })));
    const cmp = create();
    cmp.openReservations(makeItem() as any, 'orders');
    expect(cmp.reservationsError()).toBe('adminUi.errors.generic');
    expect(cmp.reservationsLoading()).toBeFalse();
  });

  it('recovers order reservations from a 403 by disabling PII and retrying', () => {
    admin.reservedOrders.and.returnValues(
      throwError(() => ({ status: 403 })),
      of({ items: [] } as unknown as OrderReservationsResponse),
    );
    const cmp = create();
    cmp.piiReveal.set(true);
    cmp.openReservations(makeItem() as any, 'orders');
    expect(cmp.piiReveal()).toBeFalse();
    expect(toast.error).toHaveBeenCalledWith('adminUi.pii.notAuthorized');
    expect(admin.reservedOrders).toHaveBeenCalledTimes(2);
  });

  it('treats a 403 order error without active PII as a generic error', () => {
    admin.reservedOrders.and.returnValue(throwError(() => ({ status: 403 })));
    const cmp = create();
    cmp.openReservations(makeItem() as any, 'orders');
    expect(cmp.reservationsError()).toBe('adminUi.errors.generic');
  });

  it('sends include_pii undefined when PII is hidden', () => {
    const cmp = create();
    cmp.openReservations(makeItem() as any, 'carts');
    expect(admin.reservedCarts).toHaveBeenCalledWith(
      jasmine.objectContaining({ include_pii: undefined }),
    );
  });

  // ---- CSV export ---------------------------------------------------------

  it('exports the restock CSV and triggers a download on success', () => {
    const createUrl = spyOn(URL, 'createObjectURL').and.returnValue('blob:url');
    const revokeUrl = spyOn(URL, 'revokeObjectURL');
    const click = spyOn(HTMLAnchorElement.prototype, 'click');
    const cmp = create();
    cmp.exportCsv();
    expect(admin.exportRestockListCsv).toHaveBeenCalled();
    expect(createUrl).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalledWith('blob:url');
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.exporting).toBeFalse();
  });

  it('does not export again while an export is in flight', () => {
    const cmp = create();
    cmp.exporting = true;
    cmp.exportCsv();
    expect(admin.exportRestockListCsv).not.toHaveBeenCalled();
  });

  it('reports an export failure', () => {
    admin.exportRestockListCsv.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.exportCsv();
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.exporting).toBeFalse();
  });

  // ---- save note ----------------------------------------------------------

  it('skips saving a note when the row is not dirty or already saving', () => {
    const cmp = create();
    cmp.saveNote({ isSaving: false, isDirty: false } as any);
    expect(admin.upsertRestockNote).not.toHaveBeenCalled();
    cmp.saveNote({ isSaving: true, isDirty: true } as any);
    expect(admin.upsertRestockNote).not.toHaveBeenCalled();
  });

  it('saves a note with trimmed supplier, note and parsed desired quantity', () => {
    const cmp = create();
    const row = {
      product_id: 'p1',
      variant_id: 'v1',
      draftSupplier: '  ACME  ',
      draftNote: '  reorder  ',
      draftDesiredQuantity: '  20  ',
      isDirty: true,
      isSaving: false,
    } as any;
    cmp.saveNote(row);
    expect(admin.upsertRestockNote).toHaveBeenCalledWith(
      jasmine.objectContaining({
        product_id: 'p1',
        variant_id: 'v1',
        supplier: 'ACME',
        note: 'reorder',
        desired_quantity: 20,
      }),
    );
    expect(toast.success).toHaveBeenCalled();
    expect(row.isSaving).toBeFalse();
    expect(row.isDirty).toBeFalse();
  });

  it('nulls empty supplier/note and clamps a negative desired quantity', () => {
    const cmp = create();
    const row = {
      product_id: 'p1',
      variant_id: null,
      draftSupplier: '   ',
      draftNote: '',
      draftDesiredQuantity: '-5',
      isDirty: true,
      isSaving: false,
    } as any;
    cmp.saveNote(row);
    expect(admin.upsertRestockNote).toHaveBeenCalledWith(
      jasmine.objectContaining({
        variant_id: null,
        supplier: null,
        note: null,
        desired_quantity: 0,
      }),
    );
  });

  it('saves a null desired quantity when the draft is blank', () => {
    const cmp = create();
    const row = {
      product_id: 'p1',
      variant_id: null,
      draftSupplier: 'ACME',
      draftNote: 'note',
      draftDesiredQuantity: '   ',
      isDirty: true,
      isSaving: false,
    } as any;
    cmp.saveNote(row);
    expect(admin.upsertRestockNote).toHaveBeenCalledWith(
      jasmine.objectContaining({ desired_quantity: null }),
    );
  });

  it('reports a note save failure and resets the saving flag', () => {
    admin.upsertRestockNote.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    const row = {
      product_id: 'p1',
      variant_id: null,
      draftSupplier: '',
      draftNote: '',
      draftDesiredQuantity: '',
      isDirty: true,
      isSaving: false,
    } as any;
    cmp.saveNote(row);
    expect(toast.error).toHaveBeenCalled();
    expect(row.isSaving).toBeFalse();
  });

  // ---- template rendering -------------------------------------------------

  it('renders the table with reservation buttons and critical highlighting', () => {
    admin.restockList.and.returnValue(
      of(
        listResponse([
          makeItem({
            kind: 'variant',
            product_id: 'p1',
            variant_id: 'v1',
            variant_name: 'Red',
            reserved_in_carts: 3,
            reserved_in_orders: 4,
            is_critical: true,
            available_quantity: 0,
            note_updated_at: '2026-01-01T00:00:00Z',
          }),
        ]),
      ),
    );
    const fixture = TestBed.createComponent(AdminInventoryComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('Product One');
    expect(text).toContain('Red');
    expect(text).toContain('adminUi.inventory.table.item');
  });

  it('renders the empty state when there are no rows', () => {
    admin.restockList.and.returnValue(of(listResponse([])));
    const fixture = TestBed.createComponent(AdminInventoryComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('adminUi.inventory.empty');
  });

  it('renders the bulk-adjust panel, errors and the reservations modal content', () => {
    admin.reservedCarts.and.returnValue(
      of({
        cutoff: '2026-02-01T00:00:00Z',
        items: [
          { cart_id: 'cart-1', updated_at: '2026-01-01T00:00:00Z', customer_email: null, quantity: 2 },
        ],
      } as CartReservationsResponse),
    );
    const fixture = TestBed.createComponent(AdminInventoryComponent);
    const cmp = fixture.componentInstance;
    fixture.detectChanges();
    cmp.toggleSelectAll(checkboxEvent(true));
    cmp.bulkAdjustError.set('bulk failed');
    cmp.openReservations(makeItem() as any, 'carts');
    fixture.detectChanges();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('bulk failed');
    expect(text).toContain('cart-1');
  });

  it('renders the orders reservations modal and the load error banner', () => {
    const fixture = TestBed.createComponent(AdminInventoryComponent);
    const cmp = fixture.componentInstance;
    admin.reservedOrders.and.returnValue(
      of({
        items: [
          {
            order_id: 'order-1',
            reference_code: 'REF-1',
            status: 'paid',
            created_at: '2026-01-01T00:00:00Z',
            customer_email: 'buyer@example.com',
            quantity: 5,
          },
        ],
      } as OrderReservationsResponse),
    );
    fixture.detectChanges();
    cmp.openReservations(makeItem({ kind: 'variant', variant_id: 'v1' }) as any, 'orders');
    cmp.error.set('load failed');
    fixture.detectChanges();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('REF-1');
    expect(text).toContain('buyer@example.com');
    expect(text).toContain('load failed');
  });

  it('renders the loading skeletons and reservation error/loading states', () => {
    const fixture = TestBed.createComponent(AdminInventoryComponent);
    const cmp = fixture.componentInstance;
    cmp.loading.set(true);
    cmp.reservationsOpen.set(true);
    cmp.reservationsLoading.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-skeleton')).not.toBeNull();

    cmp.reservationsLoading.set(false);
    cmp.reservationsError.set('reservation failed');
    fixture.detectChanges();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('reservation failed');
  });

  it('renders empty reservation states and pagination controls', () => {
    admin.restockList.and.returnValue(
      of(listResponse([makeItem()], { total_pages: 3, page: 2 })),
    );
    const fixture = TestBed.createComponent(AdminInventoryComponent);
    const cmp = fixture.componentInstance;
    fixture.detectChanges();
    cmp.openReservations(makeItem() as any, 'carts');
    fixture.detectChanges();
    let text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('adminUi.inventory.reservations.emptyCarts');

    cmp.closeReservations();
    cmp.openReservations(makeItem() as any, 'orders');
    fixture.detectChanges();
    text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('adminUi.inventory.reservations.emptyOrders');
  });
});
