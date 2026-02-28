import { AdminOrdersComponent } from './admin-orders.component';

type SignalLike<T> = (() => T) & { set: (next: T) => void };

type Harness = {
  component: any;
  toast: jasmine.SpyObj<any>;
  favorites: {
    items: () => any[];
    isFavorite: jasmine.Spy;
    add: jasmine.Spy;
    remove: jasmine.Spy;
  };
};

function mockSignal<T>(initial: T): SignalLike<T> {
  let value = initial;
  const fn = (() => value) as SignalLike<T>;
  fn.set = (next: T) => {
    value = next;
  };
  return fn;
}

function createHarness(): Harness {
  const component = Object.create(AdminOrdersComponent.prototype);
  const toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
  const favorites = {
    items: () => [] as any[],
    isFavorite: jasmine.createSpy('isFavorite').and.returnValue(false),
    add: jasmine.createSpy('add'),
    remove: jasmine.createSpy('remove'),
  };

  component.layoutModalOpen = mockSignal(false);
  component.tableLayout = mockSignal({ density: 'compact' });
  component.viewMode = mockSignal('table');
  component.kanbanItemsByStatus = mockSignal<Record<string, any[]>>({});
  component.kanbanTotalsByStatus = mockSignal<Record<string, number>>({});
  component.shippingLabelsModalOpen = mockSignal(false);
  component.tagManagerOpen = mockSignal(false);
  component.tagManagerError = mockSignal<string | null>(null);
  component.tagManagerRows = mockSignal<any[]>([]);
  component.tagManagerLoading = mockSignal(false);
  component.tagOptions = mockSignal<string[]>([]);
  component.loading = mockSignal(false);
  component.error = mockSignal<string | null>(null);
  component.errorRequestId = mockSignal<string | null>(null);
  component.orders = mockSignal<any[]>([]);
  component.meta = mockSignal<any>(null);

  component.status = 'all';
  component.sla = 'all';
  component.fraud = 'all';
  component.selectedIds = new Set<string>();
  component.shippingLabelsBusy = false;
  component.shippingLabelsUploads = [];
  component.shippingLabelsOrderOptions = [];
  component.tagColorOverrides = {};
  component.tagColorPalette = ['slate', 'emerald', 'sky', 'rose', 'amber'];
  component.tableColumns = [];
  component.q = '';
  component.tag = '';
  component.fromDate = '';
  component.toDate = '';
  component.includeTestOrders = true;
  component.page = 1;
  component.limit = 20;

  component.auth = { user: () => ({ id: 'admin-1' }) };
  component.translate = {
    instant: (key: string, params?: Record<string, unknown>) => {
      if (params && 'severity' in params) return `label:${String(params['severity'])}`;
      return key;
    },
  };
  component.toast = toast;
  component.favorites = favorites;

  component.ordersApi = jasmine.createSpyObj('AdminOrdersService', [
    'search',
    'update',
    'listOrderTagStats',
    'listOrderTags',
    'uploadShippingLabel',
    'downloadBatchShippingLabelsZip',
  ]);

  component.persistViewMode = jasmine.createSpy('persistViewMode');
  component.load = jasmine.createSpy('load');
  component.clearSelection = jasmine.createSpy('clearSelection').and.callFake(() => {
    component.selectedIds.clear();
  });

  return { component, toast, favorites };
}

describe('AdminOrdersComponent layout and view helpers', () => {
  it('opens/closes layout modal and toggles density', () => {
    const { component } = createHarness();
    spyOn(component, 'applyTableLayout').and.callFake(() => undefined);

    component.openLayoutModal();
    expect(component.layoutModalOpen()).toBeTrue();

    component.closeLayoutModal();
    expect(component.layoutModalOpen()).toBeFalse();

    component.toggleDensity();
    expect(component.applyTableLayout).toHaveBeenCalledWith(jasmine.objectContaining({ density: 'comfortable' }));
  });

  it('returns density/view labels and toggles view mode', () => {
    const { component } = createHarness();

    expect(component.densityToggleLabelKey()).toContain('toComfortable');
    component.tableLayout.set({ density: 'comfortable' });
    expect(component.densityToggleLabelKey()).toContain('toCompact');

    expect(component.viewToggleLabelKey()).toContain('kanban');
    component.toggleViewMode();

    expect(component.viewMode()).toBe('kanban');
    expect(component.persistViewMode).toHaveBeenCalled();
    expect(component.clearSelection).toHaveBeenCalled();
    expect(component.load).toHaveBeenCalled();
  });
});

describe('AdminOrdersComponent kanban helpers', () => {
  it('computes kanban column statuses by active filter', () => {
    const { component } = createHarness();

    component.status = 'pending';
    expect(component.kanbanColumnStatuses()).toEqual(['pending_payment', 'pending_acceptance']);

    component.status = 'sales';
    expect(component.kanbanColumnStatuses()).toEqual(['paid', 'shipped', 'delivered', 'refunded']);

    component.status = 'all';
    expect(component.kanbanColumnStatuses()).toContain('cancelled');

    component.status = 'shipped';
    expect(component.kanbanColumnStatuses()).toEqual(['shipped']);
  });

  it('counts kanban cards and tracks status identity', () => {
    const { component } = createHarness();
    component.status = 'pending';
    component.kanbanItemsByStatus.set({
      pending_payment: [{ id: 'o1' }],
      pending_acceptance: [{ id: 'o2' }, { id: 'o3' }],
    });

    expect(component.trackKanbanStatus(0, 'pending_payment')).toBe('pending_payment');
    expect(component.kanbanTotalCards()).toBe(3);
  });
});

describe('AdminOrdersComponent selection helpers', () => {
  it('toggles single and page-wide selection', () => {
    const { component } = createHarness();
    component.orders.set([{ id: 'o1' }, { id: 'o2' }]);

    component.toggleSelected('o1', true);
    expect(component.selectedIds.has('o1')).toBeTrue();

    component.toggleSelected('o1', false);
    expect(component.selectedIds.has('o1')).toBeFalse();

    component.toggleSelectAllOnPage(true);
    expect(component.selectedIds.has('o1')).toBeTrue();
    expect(component.selectedIds.has('o2')).toBeTrue();

    component.toggleSelectAllOnPage(false);
    expect(component.selectedIds.size).toBe(0);
  });

  it('reports all/some selected and clears selected ids', () => {
    const { component } = createHarness();
    component.orders.set([{ id: 'o1' }, { id: 'o2' }]);

    component.selectedIds = new Set(['o1']);
    expect(component.someSelectedOnPage()).toBeTrue();
    expect(component.allSelectedOnPage()).toBeFalse();

    component.selectedIds = new Set(['o1', 'o2']);
    expect(component.allSelectedOnPage()).toBeTrue();

    component.clearSelection = AdminOrdersComponent.prototype.clearSelection;
    component.clearSelection();
    expect(component.selectedIds.size).toBe(0);
  });
});

describe('AdminOrdersComponent storage and preset coercion helpers', () => {
  it('builds scoped storage keys with user id fallback', () => {
    const { component } = createHarness();

    expect(component.storageKey()).toBe('admin.orders.filters.v1:admin-1');
    expect(component.exportStorageKey()).toBe('admin.orders.export.v1:admin-1');
    expect(component.viewModeStorageKey()).toBe('admin.orders.view.v1:admin-1');

    component.auth = { user: () => ({ id: '' }) };
    expect(component.storageKey()).toContain('anonymous');
  });

  it('coerces preset filter primitives safely', () => {
    const { component } = createHarness();

    const preset = component.coercePreset({
      id: 42,
      name: null,
      createdAt: undefined,
      filters: {
        q: 12,
        status: 'paid',
        sla: 'invalid',
        fraud: 'invalid',
        includeTestOrders: 'yes',
        limit: '100',
      },
    });

    expect(preset.id).toBe('42');
    expect(preset.name).toBe('');
    expect(preset.filters.q).toBe('12');
    expect(preset.filters.sla).toBe('all');
    expect(preset.filters.fraud).toBe('all');
    expect(preset.filters.includeTestOrders).toBeTrue();
    expect(preset.filters.limit).toBe(20);
  });
});

describe('AdminOrdersComponent shipping label utilities', () => {
  it('returns status labels/classes and auto-assigns by ref/short id', () => {
    const { component } = createHarness();
    component.shippingLabelsOrderOptions = [
      { id: 'order-a', ref: 'REF-100', shortId: 'aaa111bb', label: 'A' },
      { id: 'order-b', ref: '', shortId: 'bbb222cc', label: 'B' },
    ];

    expect(component.shippingLabelStatusLabelKey('pending')).toContain('pending');
    expect(component.shippingLabelStatusPillClass('error')).toContain('rose');

    const refFile = new File(['x'], 'shipping-ref-100.pdf');
    const shortFile = new File(['x'], 'label-bbb222cc.png');

    expect(component.autoAssignShippingLabel(refFile)).toBe('order-a');
    expect(component.autoAssignShippingLabel(shortFile)).toBe('order-b');
  });

  it('builds order options and updates upload rows in place', () => {
    const { component } = createHarness();
    component.orders.set([{ id: 'abc12345', reference_code: 'REF-1' }]);
    component.selectedIds = new Set(['abc12345']);
    component.shippingLabelsUploads = [{ file: new File(['x'], 'x.pdf'), assignedOrderId: null, status: 'pending', error: null }];

    const options = component.buildShippingLabelsOrderOptions();
    expect(options[0]).toEqual(jasmine.objectContaining({ id: 'abc12345', shortId: 'abc12345' }));

    component.updateShippingLabelUpload(0, { status: 'success' });
    expect(component.shippingLabelsUploads[0].status).toBe('success');
  });
});

describe('AdminOrdersComponent display badge helpers', () => {
  it('renders customer and tag labels with translation fallback', () => {
    const { component } = createHarness();
    const order = { customer_email: 'a@b.c', customer_username: 'ana' };

    expect(component.customerLabel(order)).toContain('a@b.c');
    expect(component.tagLabel('vip')).toBe('vip');
  });

  it('computes fraud and SLA badges', () => {
    const { component } = createHarness();
    spyOn(Date, 'now').and.returnValue(Date.parse('2026-02-27T00:00:00Z'));

    const fraud = component.fraudBadge({ fraud_severity: 'high' });
    expect(fraud?.className).toContain('rose');

    const overdueSla = component.slaBadge({ sla_kind: 'accept', sla_due_at: '2026-02-26T23:00:00Z' });
    expect(overdueSla?.label).toContain('overdue');

    const futureSla = component.slaBadge({ sla_kind: 'ship', sla_due_at: '2026-03-01T00:00:00Z' });
    expect(futureSla).toBeNull();
  });
});
