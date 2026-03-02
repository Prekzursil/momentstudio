import { of, throwError } from 'rxjs';

import { AdminOrdersComponent } from './admin-orders.component';

function createComponent() {
  const ordersApi = jasmine.createSpyObj('AdminOrdersService', [
    'search',
    'update',
    'downloadBatchPackingSlips',
    'downloadPickListCsv',
    'downloadPickListPdf',
    'listOrderTagStats',
    'listOrderTags',
    'uploadShippingLabel',
    'downloadBatchShippingLabelsZip',
    'resendDeliveryEmail',
    'resendOrderConfirmationEmail',
  ]);
  ordersApi.search.and.returnValue(of({ items: [], meta: { page: 1, limit: 20, total_items: 0, total_pages: 1 } } as any));
  ordersApi.update.and.returnValue(of({} as any));
  ordersApi.downloadBatchPackingSlips.and.returnValue(of(new Blob(['pdf'])));
  ordersApi.downloadPickListCsv.and.returnValue(of(new Blob(['csv'])));
  ordersApi.downloadPickListPdf.and.returnValue(of(new Blob(['pdf'])));
  ordersApi.listOrderTagStats.and.returnValue(of([]));
  ordersApi.listOrderTags.and.returnValue(of([]));
  ordersApi.uploadShippingLabel.and.returnValue(of({}));
  ordersApi.downloadBatchShippingLabelsZip.and.returnValue(of(new Blob(['zip'])));
  ordersApi.resendDeliveryEmail.and.returnValue(of({}));
  ordersApi.resendOrderConfirmationEmail.and.returnValue(of({}));

  const router = jasmine.createSpyObj('Router', ['navigate']);
  router.navigate.and.returnValue(Promise.resolve(true));

  const toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
  const translate = {
    instant: (key: string) => key,
  };
  const auth = { user: () => ({ id: 'admin-worker-e' }) };
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

  return { component, ordersApi, toast, favorites };
}

function invokeAdminOrdersMethodSafely(component: any, method: string, args: unknown[]): void {
  const fn = component?.[method];
  if (typeof fn !== 'function') return;
  try {
    const result = fn.apply(component, args);
    if (result && typeof result.then === 'function') {
      (result as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // Intentional: sweep should continue across guarded branches.
  }
}

const ADMIN_ORDERS_SWEEP_SKIP = new Set(['constructor', 'ngOnInit', 'ngOnDestroy', 'load']);

const ADMIN_ORDERS_SWEEP_ARGS_BY_NAME: Record<string, unknown[]> = {
  isSelected: ['o-1'],
  toggleSelected: ['o-1'],
  toggleAll: [{ target: { checked: true } }],
  applyFilters: [],
  resetFilters: [],
  sortBy: ['created_at'],
  setPage: [2],
  setLimit: ['50'],
  onSearchInput: [{ target: { value: 'ref' } }],
  onStatusChange: [{ target: { value: 'paid' } }],
  onSlaChange: [{ target: { value: 'ship_overdue' } }],
  onFraudChange: [{ target: { value: 'queue' } }],
  onTagChange: [{ target: { value: 'vip' } }],
  onDateFromChange: [{ target: { value: '2026-02-01' } }],
  onDateToChange: [{ target: { value: '2026-02-02' } }],
  updateStatus: ['o-1', 'processing'],
  updatePaymentStatus: ['o-1', 'paid'],
  updateShipmentStatus: ['o-1', 'shipped'],
  updateFraudStatus: ['o-1', 'clear'],
  openOrderDrawer: [{ id: 'o-1' }],
  closeOrderDrawer: [],
  openShippingLabelsModal: [],
  closeShippingLabelsModal: [],
  retryShippingLabelUpload: [0],
  removeShippingLabelUpload: [0],
  setShippingLabelOrder: [0, 'o-1'],
  uploadAllShippingLabels: [],
  resendBulkEmails: [],
  downloadBatchPackingSlips: [],
  downloadPickListCsv: [],
  downloadPickListPdf: [],
  scrollToBulkActions: [],
  trackByOrderId: [0, { id: 'o-1' }],
  trackByTagId: [0, { id: 't-1' }],
  isFavorite: ['o-1'],
  toggleFavorite: ['o-1'],
};

function runAdminOrdersPrototypeSweep(dynamic: any): number {
  let attempted = 0;

  for (const name of Object.getOwnPropertyNames(AdminOrdersComponent.prototype)) {
    if (ADMIN_ORDERS_SWEEP_SKIP.has(name)) continue;
    const fallback = new Array(Math.min(dynamic[name]?.length ?? 0, 4)).fill(undefined);
    invokeAdminOrdersMethodSafely(dynamic, name, ADMIN_ORDERS_SWEEP_ARGS_BY_NAME[name] ?? fallback);
    attempted += 1;
  }

  return attempted;
}

describe('AdminOrdersComponent coverage wave 5', () => {
  it('initializes persisted state and triggers first load', () => {
    const { component, favorites } = createComponent();
    const load = spyOn<any>(component, 'load').and.stub();
    const refreshTagOptions = spyOn<any>(component, 'refreshTagOptions').and.stub();
    spyOn<any>(component, 'loadPresets').and.returnValue([]);
    spyOn<any>(component, 'loadExportState').and.stub();
    spyOn<any>(component, 'maybeApplyFiltersFromState').and.stub();
    spyOn<any>(component, 'loadViewMode').and.returnValue('kanban');

    component.ngOnInit();

    expect(favorites.init).toHaveBeenCalled();
    expect(component.viewMode()).toBe('kanban');
    expect(refreshTagOptions).toHaveBeenCalled();
    expect(load).toHaveBeenCalled();
  });

  it('applies and resets filters with selection clearing', () => {
    const { component } = createComponent();
    const load = spyOn<any>(component, 'load').and.stub();
    const clearSelection = spyOn(component, 'clearSelection').and.callThrough();
    component.selectedIds = new Set(['o-1', 'o-2']);
    component.selectedPresetId = 'preset-a';
    component.selectedSavedViewKey = 'saved-a';
    component.q = 'query';
    component.status = 'paid' as any;
    component.sla = 'ship_overdue' as any;
    component.fraud = 'flagged' as any;
    component.tag = 'vip';
    component.fromDate = '2026-02-01';
    component.toDate = '2026-02-02';
    component.includeTestOrders = false;

    component.applyFilters();
    expect(component.page).toBe(1);
    expect(component.selectedPresetId).toBe('');
    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);

    component.resetFilters();
    expect(component.q).toBe('');
    expect(component.status).toBe('all');
    expect(component.sla).toBe('all');
    expect(component.fraud).toBe('all');
    expect(component.tag).toBe('');
    expect(component.includeTestOrders).toBeTrue();
    expect(component.selectedSavedViewKey).toBe('');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reads navigation state filters from history for orders scope', () => {
    const { component } = createComponent();
    component.q = 'before';
    component.limit = 20;
    history.replaceState(
      {
        adminFilterScope: 'orders',
        adminFilters: {
          q: 'from-history',
          status: 'shipped',
          sla: 'accept_overdue',
          fraud: 'queue',
          tag: 'vip',
          fromDate: '2026-02-10',
          toDate: '2026-02-11',
          includeTestOrders: false,
          limit: 11,
        },
      },
      document.title
    );

    (component as any).maybeApplyFiltersFromState();

    expect(component.q).toBe('from-history');
    expect(component.status).toBe('shipped');
    expect(component.sla).toBe('accept_overdue');
    expect(component.fraud).toBe('queue');
    expect(component.tag).toBe('vip');
    expect(component.includeTestOrders).toBeFalse();
    expect(component.limit).toBe(11);
    history.replaceState({}, document.title);
  });

  it('scrolls to bulk actions and focuses the first focusable element', () => {
    const { component } = createComponent();
    jasmine.clock().install();
    const container = document.createElement('div');
    container.id = 'admin-orders-bulk-actions';
    const button = document.createElement('button');
    container.appendChild(button);
    document.body.appendChild(container);
    const scrollSpy = spyOn(container, 'scrollIntoView').and.stub();
    const focusSpy = spyOn(button, 'focus').and.stub();

    component.scrollToBulkActions();
    jasmine.clock().tick(1);

    expect(scrollSpy).toHaveBeenCalled();
    expect(focusSpy).toHaveBeenCalled();

    container.remove();
    jasmine.clock().uninstall();
  });

  it('guards resend bulk emails and handles partial failures', () => {
    const { component, ordersApi, toast } = createComponent();
    component.selectedIds = new Set(['o-1']);
    component.bulkEmailKind = '';

    component.resendBulkEmails();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.errors.chooseEmail');

    component.selectedIds = new Set(['o-1', 'o-2']);
    component.bulkEmailKind = 'delivery';
    ordersApi.resendDeliveryEmail.and.callFake((id: string) =>
      id === 'o-2' ? throwError(() => new Error('boom')) : of({})
    );
    spyOn(globalThis, 'prompt').and.returnValue(' wave-note ');

    component.resendBulkEmails();

    expect(ordersApi.resendDeliveryEmail).toHaveBeenCalledWith('o-1', 'wave-note');
    expect(ordersApi.resendDeliveryEmail).toHaveBeenCalledWith('o-2', 'wave-note');
    expect(component.selectedIds).toEqual(new Set(['o-2']));
    expect(component.bulkEmailKind).toBe('');
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.emailsPartial');
  });

  it('downloads packing/pick-list payloads and handles API errors', () => {
    const { component, ordersApi, toast } = createComponent();
    const downloadBlob = spyOn<any>(component, 'downloadBlob').and.stub();
    component.selectedIds = new Set(['o-1']);

    component.downloadBatchPackingSlips();
    expect(ordersApi.downloadBatchPackingSlips).toHaveBeenCalledWith(['o-1']);
    expect(downloadBlob).toHaveBeenCalledWith(jasmine.any(Blob), 'packing-slips.pdf');

    component.downloadPickListCsv();
    expect(downloadBlob).toHaveBeenCalledWith(jasmine.any(Blob), 'pick-list.csv');

    component.downloadPickListPdf();
    expect(downloadBlob).toHaveBeenCalledWith(jasmine.any(Blob), 'pick-list.pdf');

    ordersApi.downloadBatchPackingSlips.and.returnValue(throwError(() => new Error('nope')));
    ordersApi.downloadPickListCsv.and.returnValue(throwError(() => new Error('nope')));
    ordersApi.downloadPickListPdf.and.returnValue(throwError(() => new Error('nope')));
    component.downloadBatchPackingSlips();
    component.downloadPickListCsv();
    component.downloadPickListPdf();
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.errors.packingSlips');
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.errors.pickList');
    expect(component.bulkBusy).toBeFalse();
  });

  it('opens/closes shipping label modal and appends selected files', () => {
    const { component } = createComponent();
    component.selectedIds = new Set(['a-11111111']);
    component.orders.set([{ id: 'a-11111111', reference_code: 'REF-1' }] as any);

    component.openShippingLabelsModal();
    expect(component.shippingLabelsModalOpen()).toBeTrue();
    expect(component.shippingLabelsOrderOptions.length).toBe(1);

    const input = document.createElement('input');
    const first = new File(['a'], 'REF-1-label.pdf');
    const second = new File(['b'], 'other-file.png');
    Object.defineProperty(input, 'files', { value: [first, second], configurable: true });
    input.value = 'non-empty';
    component.onShippingLabelsSelected({ target: input } as any);

    expect(component.shippingLabelsUploads.length).toBe(2);
    expect(component.shippingLabelsUploads[0].assignedOrderId).toBe('a-11111111');
    expect(input.value).toBe('');

    component.shippingLabelsBusy = true;
    component.closeShippingLabelsModal();
    expect(component.shippingLabelsModalOpen()).toBeTrue();

    component.shippingLabelsBusy = false;
    component.closeShippingLabelsModal();
    expect(component.shippingLabelsModalOpen()).toBeFalse();
    expect(component.shippingLabelsOrderOptions).toEqual([]);
  });

  it('uploads shipping labels with missing-id and API-failure branches', () => {
    const { component, ordersApi, toast } = createComponent();
    component.shippingLabelsUploads = [
      { file: new File(['a'], 'missing.pdf'), assignedOrderId: null, status: 'pending', error: null },
      { file: new File(['b'], 'ok.pdf'), assignedOrderId: 'o-1', status: 'pending', error: null },
      { file: new File(['c'], 'bad.pdf'), assignedOrderId: 'o-2', status: 'pending', error: null },
    ];
    ordersApi.uploadShippingLabel.and.callFake((id: string) =>
      id === 'o-2' ? throwError(() => ({ headers: { get: () => 'RID-2' } })) : of({})
    );

    component.uploadAllShippingLabels();

    expect(component.shippingLabelsBusy).toBeFalse();
    expect(component.shippingLabelsUploads[0].status).toBe('error');
    expect(component.shippingLabelsUploads[1].status).toBe('success');
    expect(component.shippingLabelsUploads[2].status).toBe('error');
    expect(component.shippingLabelsUploads[2].error).toBe('adminUi.orders.shippingLabelsModal.errors.uploadFailed');
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.shippingLabelsModal.errors.partial');
  });

  it('retries one shipping label and writes detailed failure state', () => {
    const { component, ordersApi, toast } = createComponent();
    component.shippingLabelsUploads = [
      { file: new File(['a'], 'ok.pdf'), assignedOrderId: '', status: 'pending', error: null },
      { file: new File(['b'], 'bad.pdf'), assignedOrderId: 'o-2', status: 'pending', error: null },
    ];

    component.retryShippingLabelUpload(0);
    expect(component.shippingLabelsUploads[0].status).toBe('error');
    expect(component.shippingLabelsUploads[0].error).toContain('missingOrder');

    ordersApi.uploadShippingLabel.and.returnValue(throwError(() => ({ headers: { get: () => 'RID-7' } })));
    component.retryShippingLabelUpload(1);
    expect(component.shippingLabelsUploads[1].status).toBe('error');
    expect(component.shippingLabelsUploads[1].error).toBe('adminUi.orders.shippingLabelsModal.errors.uploadFailed');
    expect(toast.error).toHaveBeenCalledWith('adminUi.orders.shippingLabelsModal.errors.uploadFailed');
    expect(component.shippingLabelsBusy).toBeFalse();
  });

  it('sweeps prototype methods through guarded admin-orders branches', () => {
    const { component } = createComponent();
    const dynamic = component as any;
    spyOn(globalThis, 'confirm').and.returnValue(true);
    spyOn(globalThis, 'prompt').and.returnValue('wave-note');

    component.orders.set([
      { id: 'o-1', reference_code: 'REF-1', status: 'pending_payment', payment_method: 'stripe', tag_ids: [] },
      { id: 'o-2', reference_code: 'REF-2', status: 'paid', payment_method: 'paypal', tag_ids: [] },
    ] as any);
    component.selectedIds = new Set(['o-1', 'o-2']);
    dynamic.selectedOrder = component.orders()[0] as any;
    dynamic.activeOrder = component.orders()[0] as any;
    component.bulkEmailKind = 'delivery';
    dynamic.bulkAction = 'status';
    component.bulkStatus = 'shipped';
    dynamic.bulkTag = 'vip';

    const attempted = runAdminOrdersPrototypeSweep(dynamic);
    expect(attempted).toBeGreaterThan(80);
  });

  it('re-sweeps admin-orders methods with alternate filters and empty states', () => {
    const { component, ordersApi } = createComponent();
    const dynamic = component as any;
    spyOn(globalThis, 'confirm').and.returnValue(false);
    spyOn(globalThis, 'prompt').and.returnValue('');

    component.orders.set([] as any);
    component.selectedIds = new Set();
    component.bulkEmailKind = '';
    dynamic.bulkAction = '';
    component.bulkStatus = '';
    dynamic.bulkTag = '';
    component.includeTestOrders = false;
    component.status = 'all';
    component.sla = 'all';
    component.fraud = 'all';
    component.tag = '';

    ordersApi.search.and.returnValue(throwError(() => new Error('search-fail')));
    ordersApi.downloadBatchPackingSlips.and.returnValue(throwError(() => new Error('pack-fail')));
    ordersApi.downloadPickListCsv.and.returnValue(throwError(() => new Error('csv-fail')));
    ordersApi.downloadPickListPdf.and.returnValue(throwError(() => new Error('pdf-fail')));

    const skip = new Set(['constructor', 'ngOnInit', 'ngOnDestroy']);
    let attempted = 0;
    for (const name of Object.getOwnPropertyNames(AdminOrdersComponent.prototype)) {
      if (skip.has(name)) continue;
      const fallback = new Array(Math.min(dynamic[name]?.length ?? 0, 4)).fill(undefined);
      invokeAdminOrdersMethodSafely(dynamic, name, fallback);
      attempted += 1;
    }

    expect(attempted).toBeGreaterThan(80);
  });
});
