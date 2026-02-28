import { of, throwError } from 'rxjs';

import { AdminOrdersComponent } from './admin-orders.component';

describe('AdminOrdersComponent coverage helpers', () => {
  function createComponent() {
    const ordersApi = jasmine.createSpyObj('AdminOrdersService', [
      'update',
      'search',
      'downloadBatchPackingSlips',
      'downloadPickListCsv',
      'downloadPickListPdf',
      'listOrderTagStats',
      'listOrderTags',
      'uploadShippingLabel',
      'downloadBatchShippingLabelsZip',
      'downloadExport',
      'addOrderTag',
      'removeOrderTag',
      'renameOrderTag',
      'resendDeliveryEmail',
      'resendOrderConfirmationEmail'
    ]);

    ordersApi.update.and.returnValue(of({}));
    ordersApi.search.and.returnValue(
      of({
        items: [],
        meta: { page: 1, limit: 20, total_items: 0, total_pages: 0 }
      } as any)
    );
    ordersApi.listOrderTagStats.and.returnValue(of([]));
    ordersApi.listOrderTags.and.returnValue(of([]));
    ordersApi.uploadShippingLabel.and.returnValue(of({}));
    ordersApi.downloadBatchShippingLabelsZip.and.returnValue(of(new Blob(['ok'])));
    ordersApi.downloadExport.and.returnValue(of(new Blob(['ok'])));
    ordersApi.addOrderTag.and.returnValue(of({}));
    ordersApi.removeOrderTag.and.returnValue(of({}));
    ordersApi.renameOrderTag.and.returnValue(of({ from_tag: 'vip', to_tag: 'priority', total: 2 }));
    ordersApi.resendDeliveryEmail.and.returnValue(of({}));
    ordersApi.resendOrderConfirmationEmail.and.returnValue(of({}));

    const router = jasmine.createSpyObj('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));

    const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);

    const translate = {
      instant: (key: string) => key
    };

    const auth = {
      user: jasmine.createSpy('user').and.returnValue({ id: 'admin-1' })
    };

    const favorites = jasmine.createSpyObj('AdminFavoritesService', ['init', 'items', 'isFavorite', 'remove', 'add']);
    favorites.items.and.returnValue([]);
    favorites.isFavorite.and.returnValue(false);

    const component = new AdminOrdersComponent(
      ordersApi as any,
      router as any,
      toast as any,
      translate as any,
      auth as any,
      favorites as any
    );

    return { component, ordersApi, router, toast, favorites };
  }

  function makeOrder(id: string, status: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      status,
      reference_code: `REF-${id}`,
      customer_email: 'customer@example.com',
      customer_username: 'alice',
      payment_method: 'card',
      ...overrides
    } as any;
  }

  it('toggles density and view mode labels while persisting the selected mode', () => {
    const { component } = createComponent();

    const applyTableLayout = spyOn(component, 'applyTableLayout').and.callThrough();
    component.toggleDensity();
    expect(applyTableLayout).toHaveBeenCalled();

    component.tableLayout.set({ ...component.tableLayout(), density: 'compact' } as any);
    expect(component.densityToggleLabelKey()).toBe('adminUi.tableLayout.densityToggle.toComfortable');

    component.viewMode.set('table');
    expect(component.viewToggleLabelKey()).toBe('adminUi.orders.viewMode.kanban');

    const persistViewMode = spyOn<any>(component, 'persistViewMode').and.stub();
    const clearSelection = spyOn(component, 'clearSelection').and.callThrough();
    const load = spyOn<any>(component, 'load').and.stub();

    component.toggleViewMode();

    expect(component.viewMode()).toBe('kanban');
    expect(persistViewMode).toHaveBeenCalled();
    expect(clearSelection).toHaveBeenCalled();
    expect(load).toHaveBeenCalled();
  });

  it('computes kanban column sets and aggregate kanban card totals', () => {
    const { component } = createComponent();

    component.status = 'pending';
    expect(component.kanbanColumnStatuses()).toEqual(['pending_payment', 'pending_acceptance']);

    component.status = 'sales';
    expect(component.kanbanColumnStatuses()).toEqual(['paid', 'shipped', 'delivered', 'refunded']);

    component.status = 'all';
    expect(component.kanbanColumnStatuses()).toEqual([
      'pending_payment',
      'pending_acceptance',
      'paid',
      'shipped',
      'delivered',
      'cancelled',
      'refunded'
    ]);

    component.kanbanItemsByStatus.set({
      pending_payment: [makeOrder('1', 'pending_payment')],
      pending_acceptance: [makeOrder('2', 'pending_acceptance'), makeOrder('3', 'pending_acceptance')],
      paid: []
    });

    component.status = 'pending';
    expect(component.kanbanTotalCards()).toBe(3);
  });

  it('handles kanban drop reordering, transition validation, and prompt guards', () => {
    const { component, ordersApi, toast } = createComponent();

    const first = makeOrder('o1', 'paid');
    const second = makeOrder('o2', 'paid');
    component.kanbanItemsByStatus.set({ paid: [first, second] });

    const sameColumnEvent = {
      item: { data: second },
      previousIndex: 1,
      currentIndex: 0
    } as any;

    component.onKanbanDrop(sameColumnEvent, 'paid');

    expect(component.kanbanItemsByStatus()['paid'].map((o: any) => o.id)).toEqual(['o2', 'o1']);
    expect(ordersApi.update).not.toHaveBeenCalled();

    const invalidOrder = makeOrder('o3', 'delivered');
    component.onKanbanDrop({ item: { data: invalidOrder }, previousIndex: 0, currentIndex: 0 } as any, 'pending_payment');
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.kanban.errors.invalidTransition');

    const pendingOrder = makeOrder('o4', 'pending_payment');
    spyOn(window, 'prompt').and.returnValue('   ');
    component.onKanbanDrop({ item: { data: pendingOrder }, previousIndex: 0, currentIndex: 0 } as any, 'cancelled');
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.kanban.errors.cancelReasonRequired');

    const paidOrder = makeOrder('o5', 'paid');
    spyOn(window, 'confirm').and.returnValue(false);
    component.onKanbanDrop({ item: { data: paidOrder }, previousIndex: 0, currentIndex: 0 } as any, 'refunded');
    expect(ordersApi.update).not.toHaveBeenCalledWith('o5', jasmine.anything());
  });

  it('persists kanban changes on success and rolls back on update error', () => {
    const { component, ordersApi, toast } = createComponent();

    const order = makeOrder('order-1', 'paid');
    component.kanbanItemsByStatus.set({ paid: [order], shipped: [] });
    component.kanbanTotalsByStatus.set({ paid: 1, shipped: 0 });

    ordersApi.update.and.returnValue(of({ status: 'shipped' }));

    component.onKanbanDrop(
      {
        item: { data: order },
        previousIndex: 0,
        currentIndex: 0
      } as any,
      'shipped'
    );

    expect(ordersApi.update).toHaveBeenCalledWith('order-1', { status: 'shipped', cancel_reason: undefined });
    expect(order.status).toBe('shipped');
    expect(component.kanbanBusy()).toBeFalse();
    expect(toast.success).toHaveBeenCalledWith('adminUi.orders.kanban.success.updated');

    const rollbackOrder = makeOrder('order-2', 'paid');
    component.kanbanItemsByStatus.set({ paid: [rollbackOrder], shipped: [] });
    component.kanbanTotalsByStatus.set({ paid: 1, shipped: 0 });

    ordersApi.update.and.returnValue(throwError(() => new Error('boom')));

    component.onKanbanDrop(
      {
        item: { data: rollbackOrder },
        previousIndex: 0,
        currentIndex: 0
      } as any,
      'shipped'
    );

    expect(rollbackOrder.status).toBe('paid');
    expect(component.kanbanItemsByStatus()['paid'].map((o: any) => o.id)).toEqual(['order-2']);
    expect(component.kanbanItemsByStatus()['shipped'].length).toBe(0);
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.kanban.errors.updateFailed');
  });

  it('applies presets and saved filter views into current filter state', () => {
    const { component, favorites } = createComponent();

    component.presets = [
      {
        id: 'preset-1',
        name: 'Priority',
        createdAt: '2026-01-01',
        filters: {
          q: 'john',
          status: 'paid',
          sla: 'ship_overdue',
          fraud: 'queue',
          tag: 'vip',
          fromDate: '2026-01-01',
          toDate: '2026-01-31',
          includeTestOrders: false,
          limit: 30
        }
      }
    ] as any;

    const load = spyOn<any>(component, 'load').and.stub();
    const clearSelection = spyOn(component, 'clearSelection').and.callThrough();

    component.applyPreset('preset-1');

    expect(component.q).toBe('john');
    expect(component.status).toBe('paid');
    expect(component.sla).toBe('ship_overdue');
    expect(component.fraud).toBe('queue');
    expect(component.tag).toBe('vip');
    expect(component.limit).toBe(30);
    expect(component.page).toBe(1);
    expect(clearSelection).toHaveBeenCalled();
    expect(load).toHaveBeenCalled();

    favorites.items.and.returnValue([
      {
        key: 'saved-1',
        type: 'filter',
        state: {
          adminFilterScope: 'orders',
          adminFilters: {
            q: 'doe',
            status: 'shipped',
            sla: 'accept_overdue',
            fraud: 'approved',
            tag: 'gift',
            fromDate: '2026-02-01',
            toDate: '2026-02-02',
            includeTestOrders: false,
            limit: 15
          }
        }
      }
    ] as any);

    component.applySavedView('saved-1');

    expect(component.selectedSavedViewKey).toBe('saved-1');
    expect(component.q).toBe('doe');
    expect(component.status).toBe('shipped');
    expect(component.sla).toBe('accept_overdue');
    expect(component.fraud).toBe('approved');
    expect(component.limit).toBe(15);
  });

  it('manages selection helpers and bulk update success/partial-failure branches', () => {
    const { component, ordersApi, toast } = createComponent();

    component.orders.set([
      makeOrder('a', 'paid'),
      makeOrder('b', 'paid')
    ] as any);

    component.toggleSelectAllOnPage(true);
    expect(component.allSelectedOnPage()).toBeTrue();
    expect(component.someSelectedOnPage()).toBeFalse();

    component.toggleSelected('a', false);
    expect(component.allSelectedOnPage()).toBeFalse();
    expect(component.someSelectedOnPage()).toBeTrue();

    component.clearSelection();
    component.applyBulkUpdate();
    expect(ordersApi.update).not.toHaveBeenCalled();

    component.selectedIds = new Set(['a']);
    component.bulkStatus = '';
    component.bulkCourier = '';
    component.applyBulkUpdate();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.errors.chooseAction');

    const load = spyOn<any>(component, 'load').and.stub();

    component.selectedIds = new Set(['a', 'b']);
    component.bulkStatus = 'paid';
    ordersApi.update.and.returnValue(of({}));

    component.applyBulkUpdate();

    expect(ordersApi.update).toHaveBeenCalledTimes(2);
    expect(component.selectedIds.size).toBe(0);
    expect(component.bulkStatus).toBe('');
    expect(component.bulkCourier).toBe('');
    expect(component.bulkEmailKind).toBe('');
    expect(load).toHaveBeenCalled();

    ordersApi.update.and.callFake((id: string) =>
      id === 'a' ? throwError(() => new Error('fail')) : of({})
    );

    component.selectedIds = new Set(['a', 'b']);
    component.bulkCourier = 'sameday';
    component.applyBulkUpdate();

    expect(component.selectedIds.has('a')).toBeTrue();
    expect(component.selectedIds.has('b')).toBeFalse();
    const lastErrorCall = toast.error.calls.mostRecent();
    expect(lastErrorCall).toBeDefined();
    expect(lastErrorCall.args[0]).toBe('adminUi.orders.bulk.partial');
  });

  it('builds detail navigation query params and shipping-label helper assignments', () => {
    const { component, router } = createComponent();

    component.page = 3;
    component.limit = 40;
    component.q = '  jane  ';
    component.status = 'paid';
    component.sla = 'accept_overdue';
    component.fraud = 'queue';
    component.tag = 'vip';
    component.includeTestOrders = false;
    component.fromDate = '2026-02-01';
    component.toDate = '2026-02-10';

    component.open('order-123');

    const queryParams = router.navigate.calls.mostRecent().args[1].queryParams as Record<string, unknown>;
    expect(router.navigate).toHaveBeenCalledWith(['/admin/orders', 'order-123'], jasmine.any(Object));
    expect(queryParams['nav']).toBe(1);
    expect(queryParams['nav_page']).toBe(3);
    expect(queryParams['nav_limit']).toBe(40);
    expect(queryParams['nav_q']).toBe('jane');
    expect(queryParams['nav_status']).toBe('paid');
    expect(queryParams['nav_sla']).toBe('accept_overdue');
    expect(queryParams['nav_fraud']).toBe('queue');
    expect(queryParams['nav_tag']).toBe('vip');
    expect(queryParams['nav_include_test']).toBe(0);
    expect(queryParams['nav_from']).toBe('2026-02-01T00:00:00Z');
    expect(queryParams['nav_to']).toBe('2026-02-10T23:59:59Z');

    component.orders.set([
      makeOrder('abcde12345', 'paid', { reference_code: 'REF-ABC' }),
      makeOrder('fghij98765', 'paid', { reference_code: 'REF-XYZ' })
    ] as any);
    component.selectedIds = new Set(['abcde12345', 'fghij98765']);

    const options = (component as any).buildShippingLabelsOrderOptions();
    expect(options[0]).toEqual(
      jasmine.objectContaining({
        id: 'abcde12345',
        ref: 'REF-ABC',
        shortId: 'abcde123',
        label: 'REF-ABC (abcde123)'
      })
    );

    component.shippingLabelsOrderOptions = options;

    const fileByRef = new File(['x'], 'shipment-ref-abc.pdf', { type: 'application/pdf' });
    const fileByShortId = new File(['x'], 'label-fghij987.png', { type: 'image/png' });

    expect((component as any).autoAssignShippingLabel(fileByRef)).toBe('abcde12345');
    expect((component as any).autoAssignShippingLabel(fileByShortId)).toBe('fghij98765');
    expect((component as any).autoAssignShippingLabel(new File(['x'], 'random.txt'))).toBeNull();

    expect(component.shippingLabelStatusPillClass('success')).toContain('emerald');
    expect(component.shippingLabelStatusPillClass('uploading')).toContain('indigo');
    expect(component.shippingLabelStatusPillClass('error')).toContain('rose');
    expect(component.shippingLabelStatusPillClass('pending')).toContain('slate');
  });

  it('computes SLA/fraud badges and view mode loading fallbacks', () => {
    const { component } = createComponent();

    spyOn(Date, 'now').and.returnValue(Date.parse('2026-02-28T12:00:00Z'));

    const overdue = component.slaBadge(
      makeOrder('o1', 'paid', {
        sla_kind: 'accept',
        sla_due_at: '2026-02-28T11:00:00Z'
      })
    );
    expect(overdue?.className).toContain('rose');

    const dueSoon = component.slaBadge(
      makeOrder('o2', 'paid', {
        sla_kind: 'ship',
        sla_due_at: '2026-02-28T13:00:00Z'
      })
    );
    expect(dueSoon?.className).toContain('amber');

    expect(component.slaBadge(makeOrder('o3', 'paid', { sla_kind: 'unknown', sla_due_at: '2026-02-28T13:00:00Z' }))).toBeNull();

    expect(component.fraudBadge(makeOrder('o4', 'paid', { fraud_severity: 'high' }))?.className).toContain('rose');
    expect(component.fraudBadge(makeOrder('o5', 'paid', { fraud_severity: 'medium' }))?.className).toContain('amber');
    expect(component.fraudBadge(makeOrder('o6', 'paid', { fraud_severity: 'low' }))?.className).toContain('sky');
    expect(component.fraudBadge(makeOrder('o7', 'paid', { fraud_severity: 'other' }))?.className).toContain('slate');

    const getItemSpy = spyOn(localStorage, 'getItem').and.returnValue('kanban');
    expect((component as any).loadViewMode()).toBe('kanban');

    getItemSpy.and.returnValue('invalid');
    expect((component as any).loadViewMode()).toBe('table');

    getItemSpy.and.throwError('storage unavailable');
    expect((component as any).loadViewMode()).toBe('table');
  });
});
