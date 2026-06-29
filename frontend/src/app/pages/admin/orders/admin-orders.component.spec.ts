import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { of, throwError } from 'rxjs';

import { AdminOrdersComponent } from './admin-orders.component';
import {
  AdminOrderListItem,
  AdminOrdersService,
} from '../../../core/admin-orders.service';
import { ToastService } from '../../../core/toast.service';
import { AuthService } from '../../../core/auth.service';
import { AdminFavoritesService } from '../../../core/admin-favorites.service';
import { TAG_COLOR_PALETTE, TAG_COLOR_STORAGE_KEY } from './order-tag-colors';

/**
 * Behavioural spec for the admin orders page. Every test asserts a real
 * observable side-effect: a toast call, a service invocation, a navigation,
 * a signal/field mutation, persisted localStorage state or a returned value.
 */
describe('AdminOrdersComponent', () => {
  let ordersApi: jasmine.SpyObj<AdminOrdersService>;
  let router: jasmine.SpyObj<Router>;
  let toast: jasmine.SpyObj<ToastService>;
  let translate: { instant: jasmine.Spy };
  let auth: { user: jasmine.Spy };
  let favorites: {
    init: jasmine.Spy;
    items: ReturnType<typeof signal<any[]>>;
    loading: ReturnType<typeof signal<boolean>>;
    isFavorite: jasmine.Spy;
    add: jasmine.Spy;
    remove: jasmine.Spy;
  };

  const order = (overrides: Partial<AdminOrderListItem> = {}): AdminOrderListItem => ({
    id: 'order-1',
    reference_code: 'REF-1',
    status: 'paid',
    total_amount: 100,
    currency: 'RON',
    payment_method: 'card',
    created_at: '2026-01-01T00:00:00Z',
    customer_email: 'cust@example.com',
    customer_username: 'cust',
    tags: ['vip'],
    ...overrides,
  });

  const searchResult = (items: AdminOrderListItem[] = []) => ({
    items,
    meta: { page: 1, limit: 20, total_items: items.length, total_pages: 1 } as any,
  });

  const fixtures: ComponentFixture<AdminOrdersComponent>[] = [];

  function make(): AdminOrdersComponent {
    const fixture = TestBed.createComponent(AdminOrdersComponent);
    fixtures.push(fixture);
    return fixture.componentInstance;
  }

  afterEach(() => {
    // Destroying detaches the view so any signal-write-scheduled change
    // detection cannot run (and fail) against the unrendered template.
    while (fixtures.length) fixtures.pop()!.destroy();
  });

  beforeEach(async () => {
    localStorage.clear();
    history.replaceState({}, '');

    ordersApi = jasmine.createSpyObj<AdminOrdersService>('AdminOrdersService', [
      'search',
      'update',
      'resendDeliveryEmail',
      'resendOrderConfirmationEmail',
      'downloadBatchPackingSlips',
      'downloadPickListCsv',
      'downloadPickListPdf',
      'uploadShippingLabel',
      'downloadBatchShippingLabelsZip',
      'downloadExport',
      'listOrderTags',
      'listOrderTagStats',
      'renameOrderTag',
      'addOrderTag',
      'removeOrderTag',
    ]);
    ordersApi.search.and.returnValue(of(searchResult()));
    ordersApi.update.and.returnValue(of({ status: 'paid' } as any));
    ordersApi.resendDeliveryEmail.and.returnValue(of({} as any));
    ordersApi.resendOrderConfirmationEmail.and.returnValue(of({} as any));
    ordersApi.downloadBatchPackingSlips.and.returnValue(of(new Blob(['x'])));
    ordersApi.downloadPickListCsv.and.returnValue(of(new Blob(['x'])));
    ordersApi.downloadPickListPdf.and.returnValue(of(new Blob(['x'])));
    ordersApi.uploadShippingLabel.and.returnValue(of({} as any));
    ordersApi.downloadBatchShippingLabelsZip.and.returnValue(of(new Blob(['x'])));
    ordersApi.downloadExport.and.returnValue(of(new Blob(['x'])));
    ordersApi.listOrderTags.and.returnValue(of(['custom']));
    ordersApi.listOrderTagStats.and.returnValue(of([{ tag: 'vip', count: 3 }]));
    ordersApi.renameOrderTag.and.returnValue(
      of({ from_tag: 'a', to_tag: 'b', updated: 1, merged: 0, total: 1 } as any),
    );
    ordersApi.addOrderTag.and.returnValue(of({} as any));
    ordersApi.removeOrderTag.and.returnValue(of({} as any));

    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));

    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);

    auth = { user: jasmine.createSpy('user').and.returnValue({ id: 'user-1' }) };
    favorites = {
      init: jasmine.createSpy('init'),
      items: signal<any[]>([]),
      loading: signal(false),
      isFavorite: jasmine.createSpy('isFavorite').and.returnValue(false),
      add: jasmine.createSpy('add'),
      remove: jasmine.createSpy('remove'),
    };

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminOrdersComponent],
      providers: [
        { provide: AdminOrdersService, useValue: ordersApi },
        { provide: Router, useValue: router },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: auth },
        { provide: AdminFavoritesService, useValue: favorites },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map() } } },
      ],
    }).compileComponents();

    // Use the real TranslateService from TranslateModule but spy on instant() so
    // tests can assert on returned translation keys and override per-case.
    const translateService = TestBed.inject(TranslateService);
    translate = {
      instant: spyOn(translateService, 'instant').and.callFake((key: string) => key),
    };
  });

  // ---------------------------------------------------------------------------
  // ngOnInit + rendering
  // ---------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('initialises favorites and loads data on init', () => {
      const c = make();
      c.ngOnInit();
      expect(favorites.init).toHaveBeenCalled();
      expect(ordersApi.search).toHaveBeenCalled();
      expect(c.loading()).toBe(false);
    });

    it('applies orders filters from history.state during ngOnInit', () => {
      history.replaceState(
        {
          adminFilterScope: 'orders',
          adminFilters: {
            q: 'abc',
            status: 'paid',
            sla: 'any_overdue',
            fraud: 'queue',
            tag: 'vip',
            fromDate: '2026-01-01',
            toDate: '2026-01-02',
            includeTestOrders: false,
            limit: 50,
          },
        },
        '',
      );
      const c = make();
      c.ngOnInit();
      expect(c.q).toBe('abc');
      expect(c.status).toBe('paid');
      expect(c.limit).toBe(50);
      expect(c.includeTestOrders).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // layout + density + view-mode toggles
  // ---------------------------------------------------------------------------

  describe('layout, density and view toggles', () => {
    it('opens and closes the layout modal', () => {
      const c = make();
      c.openLayoutModal();
      expect(c.layoutModalOpen()).toBe(true);
      c.closeLayoutModal();
      expect(c.layoutModalOpen()).toBe(false);
    });

    it('persists an applied table layout', () => {
      const c = make();
      const layout = { ...c.tableLayout(), density: 'compact' as const };
      c.applyTableLayout(layout);
      expect(c.tableLayout().density).toBe('compact');
      expect(localStorage.getItem((c as any).tableLayoutStorageKey())).toContain('compact');
    });

    it('toggles density both directions and reports matching label keys', () => {
      const c = make();
      // default density is comfortable -> toggling makes it compact
      c.toggleDensity();
      expect(c.tableLayout().density).toBe('compact');
      expect(c.densityToggleLabelKey()).toBe('adminUi.tableLayout.densityToggle.toComfortable');
      c.toggleDensity();
      expect(c.tableLayout().density).toBe('comfortable');
      expect(c.densityToggleLabelKey()).toBe('adminUi.tableLayout.densityToggle.toCompact');
    });

    it('toggles view mode, persists it and reloads', () => {
      const c = make();
      expect(c.viewToggleLabelKey()).toBe('adminUi.orders.viewMode.kanban');
      c.toggleViewMode();
      expect(c.viewMode()).toBe('kanban');
      expect(c.viewToggleLabelKey()).toBe('adminUi.orders.viewMode.table');
      expect(localStorage.getItem((c as any).viewModeStorageKey())).toBe('kanban');
      c.toggleViewMode();
      expect(c.viewMode()).toBe('table');
    });

    it('reads visible column ids, track helpers and cell padding', () => {
      const c = make();
      expect(Array.isArray(c.visibleColumnIds())).toBe(true);
      expect(c.trackColumnId(0, 'status')).toBe('status');
      expect(typeof c.cellPaddingClass()).toBe('string');
      expect(c.trackKanbanStatus(0, 'paid')).toBe('paid');
      expect(c.trackOrderId(0, order())).toBe('order-1');
    });
  });

  // ---------------------------------------------------------------------------
  // kanban columns + drag & drop
  // ---------------------------------------------------------------------------

  describe('kanban', () => {
    it('derives column statuses per status filter', () => {
      const c = make();
      c.status = 'pending';
      expect(c.kanbanColumnStatuses()).toEqual(['pending_payment', 'pending_acceptance']);
      c.status = 'sales';
      expect(c.kanbanColumnStatuses()).toEqual(['paid', 'shipped', 'delivered', 'refunded']);
      c.status = 'all';
      expect(c.kanbanColumnStatuses().length).toBe(7);
      c.status = 'paid';
      expect(c.kanbanColumnStatuses()).toEqual(['paid']);
    });

    it('counts total kanban cards across columns', () => {
      const c = make();
      c.status = 'all';
      c.kanbanItemsByStatus.set({ paid: [order(), order({ id: 'o2' })], shipped: [order({ id: 'o3' })] });
      expect(c.kanbanTotalCards()).toBe(3);
    });

    it('ignores drops while busy', () => {
      const c = make();
      c.kanbanBusy.set(true);
      c.onKanbanDrop({ item: { data: order() } } as any, 'shipped');
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('ignores drops with no order id or status', () => {
      const c = make();
      c.onKanbanDrop({ item: { data: { id: '', status: '' } } } as any, 'shipped');
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('reorders within the same column without calling the API', () => {
      const c = make();
      const a = order({ id: 'a', status: 'paid' });
      const b = order({ id: 'b', status: 'paid' });
      c.kanbanItemsByStatus.set({ paid: [a, b] });
      const ev = { item: { data: a }, previousIndex: 0, currentIndex: 1 } as CdkDragDrop<AdminOrderListItem[]>;
      c.onKanbanDrop(ev, 'paid');
      expect(c.kanbanItemsByStatus()['paid'][0].id).toBe('b');
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('rejects invalid transitions', () => {
      const c = make();
      const a = order({ id: 'a', status: 'paid' });
      c.kanbanItemsByStatus.set({ paid: [a], pending_payment: [] });
      c.onKanbanDrop({ item: { data: a }, previousIndex: 0, currentIndex: 0 } as any, 'pending_payment');
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.kanban.errors.invalidTransition');
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('requires a cancel reason when moving to cancelled', () => {
      const c = make();
      const a = order({ id: 'a', status: 'paid' });
      c.kanbanItemsByStatus.set({ paid: [a], cancelled: [] });
      spyOn(window, 'prompt').and.returnValue('   ');
      c.onKanbanDrop({ item: { data: a }, previousIndex: 0, currentIndex: 0 } as any, 'cancelled');
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.kanban.errors.cancelReasonRequired');
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('moves to cancelled with a reason', () => {
      const c = make();
      const a = order({ id: 'a', status: 'paid' });
      c.kanbanItemsByStatus.set({ paid: [a], cancelled: [] });
      c.kanbanTotalsByStatus.set({ paid: 1, cancelled: 0 });
      spyOn(window, 'prompt').and.returnValue('fraudulent');
      ordersApi.update.and.returnValue(of({ status: 'cancelled' } as any));
      c.onKanbanDrop({ item: { data: a }, previousIndex: 0, currentIndex: 0 } as any, 'cancelled');
      expect(ordersApi.update).toHaveBeenCalledWith('a', {
        status: 'cancelled',
        cancel_reason: 'fraudulent',
      });
      expect(toast.success).toHaveBeenCalledWith('adminUi.orders.kanban.success.updated');
    });

    it('aborts a refund move when not confirmed', () => {
      const c = make();
      const a = order({ id: 'a', status: 'paid' });
      c.kanbanItemsByStatus.set({ paid: [a], refunded: [] });
      spyOn(window, 'confirm').and.returnValue(false);
      c.onKanbanDrop({ item: { data: a }, previousIndex: 0, currentIndex: 0 } as any, 'refunded');
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('falls back to target status when the update response has no status', () => {
      const c = make();
      const a = order({ id: 'a', status: 'paid' });
      c.kanbanItemsByStatus.set({ paid: [a], shipped: [] });
      ordersApi.update.and.returnValue(of(null as any));
      c.onKanbanDrop({ item: { data: a }, previousIndex: 0, currentIndex: 0 } as any, 'shipped');
      expect(a.status).toBe('shipped');
      expect(c.kanbanBusy()).toBe(false);
    });

    it('reverts kanban state on update failure', () => {
      const c = make();
      const a = order({ id: 'a', status: 'paid' });
      const prevItems = { paid: [a], shipped: [] };
      c.kanbanItemsByStatus.set(prevItems);
      c.kanbanTotalsByStatus.set({ paid: 1, shipped: 0 });
      ordersApi.update.and.returnValue(throwError(() => new Error('nope')));
      c.onKanbanDrop({ item: { data: a }, previousIndex: 0, currentIndex: 0 } as any, 'shipped');
      expect(a.status).toBe('paid');
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.kanban.errors.updateFailed');
    });

    it('allows COD pending_acceptance orders to ship directly', () => {
      const c = make();
      const codOrder = order({ id: 'a', status: 'pending_acceptance', payment_method: 'COD' });
      const allowed = (c as any).allowedKanbanTransitions(codOrder);
      expect(allowed).toContain('shipped');
      expect(allowed).toContain('delivered');
    });

    it('returns an empty transition list for terminal states', () => {
      const c = make();
      expect((c as any).allowedKanbanTransitions(order({ status: 'refunded' }))).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // scrollToBulkActions
  // ---------------------------------------------------------------------------

  describe('scrollToBulkActions', () => {
    afterEach(() => {
      const el = document.getElementById('admin-orders-bulk-actions');
      if (el) el.remove();
    });

    it('scrolls and focuses the first focusable element', () => {
      const c = make();
      const el = document.createElement('div');
      el.id = 'admin-orders-bulk-actions';
      const btn = document.createElement('button');
      el.appendChild(btn);
      document.body.appendChild(el);
      const scrollSpy = spyOn(el, 'scrollIntoView');
      const focusSpy = spyOn(btn, 'focus');
      // Run the deferred focus synchronously so we never flush the global task
      // queue (which would trigger an auto-render of the untested template).
      const timeoutSpy = spyOn(window, 'setTimeout').and.callFake(((fn: () => void) => {
        fn();
        return 0;
      }) as unknown as typeof setTimeout);
      c.scrollToBulkActions();
      timeoutSpy.and.callThrough();
      expect(scrollSpy).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
    });

    it('does nothing when the bulk actions element is absent', () => {
      const c = make();
      expect(() => c.scrollToBulkActions()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // filters, presets, saved views
  // ---------------------------------------------------------------------------

  describe('filters and presets', () => {
    it('applies filters resetting page and selection', () => {
      const c = make();
      c.page = 4;
      c.selectedIds.add('x');
      c.selectedPresetId = 'p';
      c.applyFilters();
      expect(c.page).toBe(1);
      expect(c.selectedIds.size).toBe(0);
      expect(ordersApi.search).toHaveBeenCalled();
    });

    it('resets all filters to defaults', () => {
      const c = make();
      c.q = 'x';
      c.status = 'paid';
      c.includeTestOrders = false;
      c.resetFilters();
      expect(c.q).toBe('');
      expect(c.status).toBe('all');
      expect(c.includeTestOrders).toBe(true);
    });

    it('ignores empty or unknown preset ids', () => {
      const c = make();
      c.applyPreset('');
      expect(c.selectedPresetId).toBe('');
      c.applyPreset('missing');
      expect(c.q).toBe('');
    });

    it('applies a known preset', () => {
      const c = make();
      c.presets = [
        {
          id: 'p1',
          name: 'VIP',
          createdAt: '',
          filters: {
            q: 'v',
            status: 'paid',
            sla: 'ship_overdue',
            fraud: 'flagged',
            tag: 'vip',
            fromDate: '2026-01-01',
            toDate: '2026-01-02',
            includeTestOrders: false,
            limit: 30,
          },
        },
      ];
      c.applyPreset('p1');
      expect(c.q).toBe('v');
      expect(c.sla).toBe('ship_overdue');
      expect(c.fraud).toBe('flagged');
      expect(c.limit).toBe(30);
    });

    it('applies a preset that omits sla/fraud (defaults to all)', () => {
      const c = make();
      c.presets = [
        {
          id: 'p2',
          name: 'Old',
          createdAt: '',
          filters: {
            q: '',
            status: 'all',
            sla: undefined as any,
            fraud: undefined as any,
            tag: '',
            fromDate: '',
            toDate: '',
            includeTestOrders: true,
            limit: 20,
          },
        },
      ];
      c.applyPreset('p2');
      expect(c.sla).toBe('all');
      expect(c.fraud).toBe('all');
    });

    it('saves a preset (prompted name) and persists it', () => {
      const c = make();
      spyOn(window, 'prompt').and.returnValue('My preset');
      c.savePreset();
      expect(c.presets.length).toBe(1);
      expect(c.presets[0].name).toBe('My preset');
      expect(localStorage.getItem((c as any).storageKey())).toContain('My preset');
      expect(toast.success).toHaveBeenCalled();
    });

    it('rejects saving a preset without a name', () => {
      const c = make();
      spyOn(window, 'prompt').and.returnValue('   ');
      c.savePreset();
      expect(c.presets.length).toBe(0);
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.presets.errors.nameRequired');
    });

    it('saves a preset using the fallback id when crypto.randomUUID is unavailable', () => {
      const c = make();
      const original = (window as any).crypto;
      Object.defineProperty(window, 'crypto', { value: {}, configurable: true });
      spyOn(window, 'prompt').and.returnValue('Fallback');
      try {
        c.savePreset();
      } finally {
        Object.defineProperty(window, 'crypto', { value: original, configurable: true });
      }
      expect(c.presets[0].id).toContain('-');
    });

    it('deletes the selected preset when confirmed', () => {
      const c = make();
      c.presets = [{ id: 'p1', name: 'A', createdAt: '', filters: {} as any }];
      c.selectedPresetId = 'p1';
      spyOn(window, 'confirm').and.returnValue(true);
      c.deletePreset();
      expect(c.presets.length).toBe(0);
      expect(toast.success).toHaveBeenCalled();
    });

    it('does nothing deleting an unknown preset', () => {
      const c = make();
      c.selectedPresetId = 'nope';
      c.deletePreset();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('aborts preset deletion when not confirmed', () => {
      const c = make();
      c.presets = [{ id: 'p1', name: 'A', createdAt: '', filters: {} as any }];
      c.selectedPresetId = 'p1';
      spyOn(window, 'confirm').and.returnValue(false);
      c.deletePreset();
      expect(c.presets.length).toBe(1);
    });
  });

  describe('saved views', () => {
    it('filters favorites down to order filter views', () => {
      const c = make();
      favorites.items.set([
        { key: 'a', type: 'filter', label: 'L', subtitle: '', url: '', state: { adminFilterScope: 'orders' } },
        { key: 'b', type: 'filter', label: 'L', subtitle: '', url: '', state: { adminFilterScope: 'products' } },
        { key: 'c', type: 'page', label: 'L', subtitle: '', url: '', state: null },
      ]);
      expect(c.savedViews().map((v) => v.key)).toEqual(['a']);
    });

    it('ignores empty saved view keys', () => {
      const c = make();
      c.applySavedView('');
      expect(c.selectedSavedViewKey).toBe('');
    });

    it('ignores saved views without filter state', () => {
      const c = make();
      favorites.items.set([
        { key: 'a', type: 'filter', label: 'L', subtitle: '', url: '', state: { adminFilterScope: 'orders' } },
      ]);
      c.applySavedView('a');
      expect(c.q).toBe('');
    });

    it('applies a saved view with full filters', () => {
      const c = make();
      favorites.items.set([
        {
          key: 'v1',
          type: 'filter',
          label: 'L',
          subtitle: '',
          url: '',
          state: {
            adminFilterScope: 'orders',
            adminFilters: {
              q: 'qq',
              status: 'shipped',
              sla: 'accept_overdue',
              fraud: 'approved',
              tag: 'gift',
              fromDate: '2026-02-01',
              toDate: '2026-02-02',
              includeTestOrders: false,
              limit: 40,
            },
          },
        },
      ]);
      c.applySavedView('v1');
      expect(c.q).toBe('qq');
      expect(c.status).toBe('shipped');
      expect(c.limit).toBe(40);
    });

    it('applies a saved view with a non-numeric limit (defaults to 20)', () => {
      const c = make();
      favorites.items.set([
        {
          key: 'v2',
          type: 'filter',
          label: 'L',
          subtitle: '',
          url: '',
          state: { adminFilterScope: 'orders', adminFilters: { limit: 'oops' } },
        },
      ]);
      c.applySavedView('v2');
      expect(c.limit).toBe(20);
    });

    it('reports whether the current view is pinned', () => {
      const c = make();
      favorites.isFavorite.and.returnValue(true);
      expect(c.isCurrentViewPinned()).toBe(true);
    });

    it('unpins the current view when already pinned', () => {
      const c = make();
      favorites.isFavorite.and.returnValue(true);
      c.selectedSavedViewKey = (c as any).currentViewFavoriteKey();
      c.toggleCurrentViewPin();
      expect(favorites.remove).toHaveBeenCalled();
      expect(c.selectedSavedViewKey).toBe('');
    });

    it('pins the current view with a prompted name', () => {
      const c = make();
      favorites.isFavorite.and.returnValue(false);
      spyOn(window, 'prompt').and.returnValue('Saved view');
      c.toggleCurrentViewPin();
      expect(favorites.add).toHaveBeenCalled();
      expect(c.selectedSavedViewKey).toBe((c as any).currentViewFavoriteKey());
    });

    it('refuses to pin a view without a name', () => {
      const c = make();
      favorites.isFavorite.and.returnValue(false);
      spyOn(window, 'prompt').and.returnValue('  ');
      c.toggleCurrentViewPin();
      expect(favorites.add).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('adminUi.favorites.savedViews.errors.nameRequired');
    });

    it('ignores history state that is not orders-scoped', () => {
      history.replaceState({ adminFilterScope: 'products' }, '');
      const c = make();
      (c as any).maybeApplyFiltersFromState();
      expect(c.q).toBe('');
    });

    it('ignores orders-scoped history state with no filters object', () => {
      history.replaceState({ adminFilterScope: 'orders', adminFilters: null }, '');
      const c = make();
      (c as any).maybeApplyFiltersFromState();
      expect(c.q).toBe('');
    });

    it('keeps the existing limit when history filters omit a numeric limit', () => {
      history.replaceState(
        { adminFilterScope: 'orders', adminFilters: { q: 'h', limit: 'bad' } },
        '',
      );
      const c = make();
      c.limit = 25;
      (c as any).maybeApplyFiltersFromState();
      expect(c.q).toBe('h');
      expect(c.limit).toBe(25);
    });
  });

  // ---------------------------------------------------------------------------
  // selection
  // ---------------------------------------------------------------------------

  describe('selection', () => {
    it('toggles a single selection on and off', () => {
      const c = make();
      c.toggleSelected('a', true);
      expect(c.selectedIds.has('a')).toBe(true);
      c.toggleSelected('a', false);
      expect(c.selectedIds.has('a')).toBe(false);
    });

    it('ignores selection changes while bulk busy', () => {
      const c = make();
      c.bulkBusy = true;
      c.toggleSelected('a', true);
      c.toggleSelectAllOnPage(true);
      expect(c.selectedIds.size).toBe(0);
    });

    it('selects and deselects all on page', () => {
      const c = make();
      c.orders.set([order({ id: 'a' }), order({ id: 'b' })]);
      c.toggleSelectAllOnPage(true);
      expect(c.allSelectedOnPage()).toBe(true);
      expect(c.someSelectedOnPage()).toBe(false);
      c.toggleSelectAllOnPage(false);
      expect(c.selectedIds.size).toBe(0);
    });

    it('reports partial page selection', () => {
      const c = make();
      c.orders.set([order({ id: 'a' }), order({ id: 'b' })]);
      c.selectedIds.add('a');
      expect(c.someSelectedOnPage()).toBe(true);
      expect(c.allSelectedOnPage()).toBe(false);
    });

    it('returns false for selection helpers with no orders', () => {
      const c = make();
      c.orders.set([]);
      expect(c.allSelectedOnPage()).toBe(false);
      expect(c.someSelectedOnPage()).toBe(false);
      c.toggleSelectAllOnPage(true);
      expect(c.selectedIds.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // bulk updates
  // ---------------------------------------------------------------------------

  describe('bulk status/courier update', () => {
    it('does nothing with no selection', () => {
      const c = make();
      c.applyBulkUpdate();
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('errors when no action chosen', () => {
      const c = make();
      c.selectedIds.add('a');
      c.applyBulkUpdate();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.errors.chooseAction');
    });

    it('applies status and clears courier and reports full success', () => {
      const c = make();
      c.selectedIds.add('a');
      c.bulkStatus = 'shipped';
      c.bulkCourier = 'clear';
      c.applyBulkUpdate();
      expect(ordersApi.update).toHaveBeenCalledWith('a', { status: 'shipped', courier: null });
      expect(toast.success).toHaveBeenCalled();
      expect(c.selectedIds.size).toBe(0);
    });

    it('applies a concrete courier and reports a partial failure', () => {
      const c = make();
      c.selectedIds.add('good');
      c.selectedIds.add('bad');
      c.bulkCourier = 'sameday';
      ordersApi.update.and.callFake((id: string) =>
        id === 'bad' ? throwError(() => new Error('x')) : of({} as any),
      );
      c.applyBulkUpdate();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.partial');
      expect(c.selectedIds.has('bad')).toBe(true);
    });
  });

  describe('bulk emails', () => {
    it('does nothing with no selection', () => {
      const c = make();
      c.resendBulkEmails();
      expect(ordersApi.resendDeliveryEmail).not.toHaveBeenCalled();
    });

    it('errors when no email kind is chosen', () => {
      const c = make();
      c.selectedIds.add('a');
      c.resendBulkEmails();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.errors.chooseEmail');
    });

    it('aborts when the note prompt is cancelled', () => {
      const c = make();
      c.selectedIds.add('a');
      c.bulkEmailKind = 'delivery';
      spyOn(window, 'prompt').and.returnValue(null);
      c.resendBulkEmails();
      expect(ordersApi.resendDeliveryEmail).not.toHaveBeenCalled();
    });

    it('sends delivery emails with a note and reports success', () => {
      const c = make();
      c.selectedIds.add('a');
      c.bulkEmailKind = 'delivery';
      spyOn(window, 'prompt').and.returnValue('note');
      c.resendBulkEmails();
      expect(ordersApi.resendDeliveryEmail).toHaveBeenCalledWith('a', 'note');
      expect(toast.success).toHaveBeenCalled();
    });

    it('sends confirmation emails and reports a partial failure', () => {
      const c = make();
      c.selectedIds.add('good');
      c.selectedIds.add('bad');
      c.bulkEmailKind = 'confirmation';
      spyOn(window, 'prompt').and.returnValue('   ');
      ordersApi.resendOrderConfirmationEmail.and.callFake((id: string) =>
        id === 'bad' ? throwError(() => new Error('x')) : of({} as any),
      );
      c.resendBulkEmails();
      expect(ordersApi.resendOrderConfirmationEmail).toHaveBeenCalledWith('good', null);
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.emailsPartial');
    });
  });

  describe('bulk document downloads', () => {
    it('downloads packing slips', () => {
      const c = make();
      c.selectedIds.add('a');
      c.downloadBatchPackingSlips();
      expect(ordersApi.downloadBatchPackingSlips).toHaveBeenCalledWith(['a']);
      expect(toast.success).toHaveBeenCalled();
      expect(c.bulkBusy).toBe(false);
    });

    it('reports packing slip errors', () => {
      const c = make();
      c.selectedIds.add('a');
      ordersApi.downloadBatchPackingSlips.and.returnValue(throwError(() => new Error('x')));
      c.downloadBatchPackingSlips();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.errors.packingSlips');
    });

    it('skips packing slips with no selection', () => {
      const c = make();
      c.downloadBatchPackingSlips();
      expect(ordersApi.downloadBatchPackingSlips).not.toHaveBeenCalled();
    });

    it('downloads pick list csv and handles errors', () => {
      const c = make();
      c.selectedIds.add('a');
      c.downloadPickListCsv();
      expect(ordersApi.downloadPickListCsv).toHaveBeenCalled();
      ordersApi.downloadPickListCsv.and.returnValue(throwError(() => new Error('x')));
      c.selectedIds.add('a');
      c.downloadPickListCsv();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.errors.pickList');
    });

    it('skips pick list csv with no selection', () => {
      const c = make();
      c.downloadPickListCsv();
      expect(ordersApi.downloadPickListCsv).not.toHaveBeenCalled();
    });

    it('downloads pick list pdf and handles errors', () => {
      const c = make();
      c.selectedIds.add('a');
      c.downloadPickListPdf();
      expect(ordersApi.downloadPickListPdf).toHaveBeenCalled();
      ordersApi.downloadPickListPdf.and.returnValue(throwError(() => new Error('x')));
      c.selectedIds.add('a');
      c.downloadPickListPdf();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.errors.pickList');
    });

    it('skips pick list pdf with no selection', () => {
      const c = make();
      c.downloadPickListPdf();
      expect(ordersApi.downloadPickListPdf).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // shipping labels modal
  // ---------------------------------------------------------------------------

  describe('shipping labels', () => {
    it('opens the modal building options from selected orders', () => {
      const c = make();
      c.orders.set([order({ id: 'a', reference_code: 'REF-A' })]);
      c.selectedIds.add('a');
      c.selectedIds.add('b'); // not in orders -> no ref
      c.openShippingLabelsModal();
      expect(c.shippingLabelsModalOpen()).toBe(true);
      expect(c.shippingLabelsOrderOptions.find((o) => o.id === 'a')!.ref).toBe('REF-A');
      expect(c.shippingLabelsOrderOptions.find((o) => o.id === 'b')!.ref).toBe('');
    });

    it('does not open the modal with no selection', () => {
      const c = make();
      c.openShippingLabelsModal();
      expect(c.shippingLabelsModalOpen()).toBe(false);
    });

    it('closes the modal when idle and refuses to close while busy', () => {
      const c = make();
      c.shippingLabelsModalOpen.set(true);
      c.shippingLabelsBusy = true;
      c.closeShippingLabelsModal();
      expect(c.shippingLabelsModalOpen()).toBe(true);
      c.shippingLabelsBusy = false;
      c.closeShippingLabelsModal();
      expect(c.shippingLabelsModalOpen()).toBe(false);
    });

    it('ignores file selection without a target or files', () => {
      const c = make();
      c.onShippingLabelsSelected({ target: null } as any);
      c.onShippingLabelsSelected({ target: {} } as any);
      c.onShippingLabelsSelected({ target: { files: [] } } as any);
      expect(c.shippingLabelsUploads.length).toBe(0);
    });

    it('queues selected files and auto-assigns by reference', () => {
      const c = make();
      c.shippingLabelsOrderOptions = [
        { id: 'a', ref: 'REF-A', shortId: 'aaaaaaaa', label: 'REF-A' },
      ];
      const file = new File(['x'], 'label-REF-A.pdf');
      const input = { files: [file], value: 'keep' };
      c.onShippingLabelsSelected({ target: input } as any);
      expect(c.shippingLabelsUploads.length).toBe(1);
      expect(c.shippingLabelsUploads[0].assignedOrderId).toBe('a');
      expect(input.value).toBe('');
    });

    it('auto-assigns by short id and falls back to null', () => {
      const c = make();
      c.shippingLabelsOrderOptions = [
        { id: 'a', ref: '', shortId: 'short123', label: 's' },
      ];
      expect((c as any).autoAssignShippingLabel(new File(['x'], 'doc-short123.pdf'))).toBe('a');
      expect((c as any).autoAssignShippingLabel(new File(['x'], 'unknown.pdf'))).toBeNull();
    });

    it('skips uploading when busy or with no queue', () => {
      const c = make();
      c.shippingLabelsBusy = true;
      c.uploadAllShippingLabels();
      expect(ordersApi.uploadShippingLabel).not.toHaveBeenCalled();
      c.shippingLabelsBusy = false;
      c.shippingLabelsUploads = [];
      c.uploadAllShippingLabels();
      expect(ordersApi.uploadShippingLabel).not.toHaveBeenCalled();
    });

    it('skips uploading when every item already succeeded', () => {
      const c = make();
      c.shippingLabelsUploads = [
        { file: new File(['x'], 'a.pdf'), assignedOrderId: 'a', status: 'success', error: null },
      ];
      c.uploadAllShippingLabels();
      expect(ordersApi.uploadShippingLabel).not.toHaveBeenCalled();
    });

    it('uploads queued labels, flagging missing order assignments', () => {
      const c = make();
      c.shippingLabelsUploads = [
        { file: new File(['x'], 'a.pdf'), assignedOrderId: 'a', status: 'pending', error: null },
        { file: new File(['x'], 'b.pdf'), assignedOrderId: null, status: 'pending', error: null },
      ];
      c.uploadAllShippingLabels();
      expect(ordersApi.uploadShippingLabel).toHaveBeenCalledWith('a', jasmine.any(File));
      expect(c.shippingLabelsUploads[0].status).toBe('success');
      expect(c.shippingLabelsUploads[1].status).toBe('error');
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.shippingLabelsModal.errors.partial');
    });

    it('reports a clean upload run and surfaces request ids on failure', () => {
      const c = make();
      c.shippingLabelsUploads = [
        { file: new File(['x'], 'a.pdf'), assignedOrderId: 'a', status: 'pending', error: null },
      ];
      c.uploadAllShippingLabels();
      expect(toast.success).toHaveBeenCalledWith(
        'adminUi.orders.shippingLabelsModal.success.uploaded',
      );

      c.shippingLabelsUploads = [
        { file: new File(['x'], 'b.pdf'), assignedOrderId: 'b', status: 'pending', error: null },
      ];
      ordersApi.uploadShippingLabel.and.returnValue(
        throwError(() => new HttpErrorResponse({ error: { request_id: 'req-9' } })),
      );
      c.uploadAllShippingLabels();
      expect(c.shippingLabelsUploads[0].status).toBe('error');
      expect(c.shippingLabelsUploads[0].error).toContain('req-9');
    });

    it('retries a single label upload successfully', () => {
      const c = make();
      c.shippingLabelsUploads = [
        { file: new File(['x'], 'a.pdf'), assignedOrderId: 'a', status: 'error', error: 'x' },
      ];
      c.retryShippingLabelUpload(0);
      expect(c.shippingLabelsUploads[0].status).toBe('success');
      expect(toast.success).toHaveBeenCalled();
    });

    it('ignores retry for missing item or while busy', () => {
      const c = make();
      c.retryShippingLabelUpload(99);
      c.shippingLabelsBusy = true;
      c.shippingLabelsUploads = [
        { file: new File(['x'], 'a.pdf'), assignedOrderId: 'a', status: 'error', error: 'x' },
      ];
      c.retryShippingLabelUpload(0);
      expect(ordersApi.uploadShippingLabel).not.toHaveBeenCalled();
    });

    it('flags retry with no assigned order', () => {
      const c = make();
      c.shippingLabelsUploads = [
        { file: new File(['x'], 'a.pdf'), assignedOrderId: null, status: 'pending', error: null },
      ];
      c.retryShippingLabelUpload(0);
      expect(c.shippingLabelsUploads[0].status).toBe('error');
      expect(ordersApi.uploadShippingLabel).not.toHaveBeenCalled();
    });

    it('reports retry errors with request ids', () => {
      const c = make();
      c.shippingLabelsUploads = [
        { file: new File(['x'], 'a.pdf'), assignedOrderId: 'a', status: 'pending', error: null },
      ];
      ordersApi.uploadShippingLabel.and.returnValue(
        throwError(() => new HttpErrorResponse({ error: { request_id: 'req-7' } })),
      );
      c.retryShippingLabelUpload(0);
      expect(c.shippingLabelsUploads[0].error).toContain('req-7');
      expect(toast.error).toHaveBeenCalled();
    });

    it('downloads a shipping labels zip', () => {
      const c = make();
      c.selectedIds.add('a');
      c.downloadSelectedShippingLabelsZip();
      expect(ordersApi.downloadBatchShippingLabelsZip).toHaveBeenCalledWith(['a']);
      expect(toast.success).toHaveBeenCalled();
    });

    it('skips zip download with no selection or while busy', () => {
      const c = make();
      c.downloadSelectedShippingLabelsZip();
      expect(ordersApi.downloadBatchShippingLabelsZip).not.toHaveBeenCalled();
      c.selectedIds.add('a');
      c.shippingLabelsBusy = true;
      c.downloadSelectedShippingLabelsZip();
      expect(ordersApi.downloadBatchShippingLabelsZip).not.toHaveBeenCalled();
    });

    it('reports missing-label zip errors', () => {
      const c = make();
      c.selectedIds.add('a');
      ordersApi.downloadBatchShippingLabelsZip.and.returnValue(
        throwError(() => ({ error: { detail: { missing_shipping_label_order_ids: ['a'] } } })),
      );
      c.downloadSelectedShippingLabelsZip();
      expect(toast.error).toHaveBeenCalledWith(
        'adminUi.orders.shippingLabelsModal.errors.missingLabels',
      );
    });

    it('reports generic zip errors', () => {
      const c = make();
      c.selectedIds.add('a');
      ordersApi.downloadBatchShippingLabelsZip.and.returnValue(throwError(() => ({})));
      c.downloadSelectedShippingLabelsZip();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.shippingLabelsModal.errors.zipFailed');
    });

    it('maps status to label keys and pill classes', () => {
      const c = make();
      expect(c.shippingLabelStatusLabelKey('uploading')).toBe(
        'adminUi.orders.shippingLabelsModal.status.uploading',
      );
      expect(c.shippingLabelStatusPillClass('success')).toContain('emerald');
      expect(c.shippingLabelStatusPillClass('uploading')).toContain('indigo');
      expect(c.shippingLabelStatusPillClass('error')).toContain('rose');
      expect(c.shippingLabelStatusPillClass('pending')).toContain('slate');
    });

    it('ignores upload patches for out-of-range indices', () => {
      const c = make();
      c.shippingLabelsUploads = [];
      (c as any).updateShippingLabelUpload(5, { status: 'success' });
      expect(c.shippingLabelsUploads.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // navigation + export modal
  // ---------------------------------------------------------------------------

  describe('navigation and export', () => {
    it('navigates to a page and reloads', () => {
      const c = make();
      c.goToPage(3);
      expect(c.page).toBe(3);
      expect(ordersApi.search).toHaveBeenCalled();
    });

    it('opens an order with full nav query params', () => {
      const c = make();
      c.page = 2;
      c.q = ' query ';
      c.status = 'paid';
      c.sla = 'any_overdue';
      c.fraud = 'queue';
      c.tag = ' vip ';
      c.includeTestOrders = false;
      c.fromDate = '2026-01-01';
      c.toDate = '2026-01-02';
      c.open('order-1');
      const params = router.navigate.calls.mostRecent().args[1]!.queryParams as Record<string, unknown>;
      expect(params['nav_q']).toBe('query');
      expect(params['nav_status']).toBe('paid');
      expect(params['nav_include_test']).toBe(0);
      expect(params['nav_from']).toBe('2026-01-01T00:00:00Z');
      expect(params['nav_to']).toBe('2026-01-02T23:59:59Z');
    });

    it('opens an order with minimal nav query params', () => {
      const c = make();
      c.open('order-1');
      const params = router.navigate.calls.mostRecent().args[1]!.queryParams as Record<string, unknown>;
      expect(params['nav_q']).toBeUndefined();
      expect(params['nav_status']).toBeUndefined();
    });

    it('navigates to the exports page', () => {
      const c = make();
      c.openExports();
      expect(router.navigate).toHaveBeenCalledWith(['/admin/orders/exports']);
    });

    it('opens and closes the export modal', () => {
      const c = make();
      c.openExportModal();
      expect(c.exportModalOpen()).toBe(true);
      c.closeExportModal();
      expect(c.exportModalOpen()).toBe(false);
    });

    it('toggles export columns and ignores unknown columns', () => {
      const c = make();
      c.toggleExportColumn('status', true);
      expect(c.exportColumns['status']).toBe(true);
      c.selectedExportTemplateId = 'x';
      c.toggleExportColumn('not-a-column', true);
      expect(c.selectedExportTemplateId).toBe('x');
    });

    it('applies and clears an export template', () => {
      const c = make();
      c.exportTemplates = [{ id: 't1', name: 'T', createdAt: '', columns: ['id', 'status'] }];
      c.applyExportTemplate('t1');
      expect(c.exportColumns['id']).toBe(true);
      expect(c.exportColumns['status']).toBe(true);
      c.applyExportTemplate('');
      expect(c.selectedExportTemplateId).toBe('');
    });

    it('ignores applying an unknown export template id', () => {
      const c = make();
      c.exportTemplates = [];
      c.applyExportTemplate('missing');
      expect(c.selectedExportTemplateId).toBe('missing');
    });

    it('downloads an export with selected columns', () => {
      const c = make();
      c.exportColumns = { id: true, status: false };
      c.exportModalOpen.set(true);
      c.downloadExport();
      expect(ordersApi.downloadExport).toHaveBeenCalledWith(['id']);
      expect(c.exportModalOpen()).toBe(false);
    });

    it('errors downloading an export with no columns', () => {
      const c = make();
      c.exportColumns = {};
      c.downloadExport();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.exportModal.errors.noColumns');
    });

    it('reports export download failures', () => {
      const c = make();
      c.exportColumns = { id: true };
      ordersApi.downloadExport.and.returnValue(throwError(() => new Error('x')));
      c.downloadExport();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.errors.export');
    });

    it('saves an export template', () => {
      const c = make();
      c.exportColumns = { id: true };
      spyOn(window, 'prompt').and.returnValue('My template');
      c.saveExportTemplate();
      expect(c.exportTemplates.length).toBe(1);
      expect(toast.success).toHaveBeenCalled();
    });

    it('errors saving an export template with no columns', () => {
      const c = make();
      c.exportColumns = {};
      c.saveExportTemplate();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.exportModal.errors.noColumns');
    });

    it('errors saving an export template with no name', () => {
      const c = make();
      c.exportColumns = { id: true };
      spyOn(window, 'prompt').and.returnValue('  ');
      c.saveExportTemplate();
      expect(toast.error).toHaveBeenCalledWith(
        'adminUi.orders.exportModal.errors.templateNameRequired',
      );
    });

    it('saves an export template with a fallback id when randomUUID is unavailable', () => {
      const c = make();
      c.exportColumns = { id: true };
      const original = (window as any).crypto;
      Object.defineProperty(window, 'crypto', { value: {}, configurable: true });
      spyOn(window, 'prompt').and.returnValue('T');
      try {
        c.saveExportTemplate();
      } finally {
        Object.defineProperty(window, 'crypto', { value: original, configurable: true });
      }
      expect(c.exportTemplates[0].id).toContain('-');
    });

    it('deletes an export template when confirmed', () => {
      const c = make();
      c.exportTemplates = [{ id: 't1', name: 'T', createdAt: '', columns: ['id'] }];
      c.selectedExportTemplateId = 't1';
      spyOn(window, 'confirm').and.returnValue(true);
      c.deleteExportTemplate();
      expect(c.exportTemplates.length).toBe(0);
      expect(toast.success).toHaveBeenCalled();
    });

    it('ignores deleting an unknown export template', () => {
      const c = make();
      c.selectedExportTemplateId = 'none';
      c.deleteExportTemplate();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('aborts export template deletion when not confirmed', () => {
      const c = make();
      c.exportTemplates = [{ id: 't1', name: 'T', createdAt: '', columns: ['id'] }];
      c.selectedExportTemplateId = 't1';
      spyOn(window, 'confirm').and.returnValue(false);
      c.deleteExportTemplate();
      expect(c.exportTemplates.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // labels, tags and badges
  // ---------------------------------------------------------------------------

  describe('labels, tags and badges', () => {
    it('builds customer labels for every combination', () => {
      const c = make();
      expect(c.customerLabel(order({ customer_email: 'e@x.com', customer_username: 'u' }))).toBe(
        'e@x.com (u)',
      );
      expect(c.customerLabel(order({ customer_email: 'e@x.com', customer_username: '' }))).toBe(
        'e@x.com',
      );
      expect(c.customerLabel(order({ customer_email: '', customer_username: 'u' }))).toBe('u');
      expect(c.customerLabel(order({ customer_email: '', customer_username: '' }))).toBe(
        'adminUi.orders.guest',
      );
    });

    it('returns the raw tag when no translation exists, else the translation', () => {
      const c = make();
      expect(c.tagLabel('vip')).toBe('vip');
      translate.instant.and.callFake((key: string) =>
        key === 'adminUi.orders.tags.vip' ? 'VIP customer' : key,
      );
      expect(c.tagLabel('vip')).toBe('VIP customer');
    });

    it('delegates tag chip and status pill classes', () => {
      const c = make();
      expect(typeof c.tagChipColorClass('vip')).toBe('string');
      expect(typeof c.statusPillClass('paid')).toBe('string');
    });

    it('opens and closes the tag manager', () => {
      const c = make();
      c.openTagManager();
      expect(c.tagManagerOpen()).toBe(true);
      expect(ordersApi.listOrderTagStats).toHaveBeenCalled();
      c.closeTagManager();
      expect(c.tagManagerOpen()).toBe(false);
      expect(c.tagManagerRows().length).toBe(0);
    });

    it('reloads tag manager rows and handles load errors', () => {
      const c = make();
      c.reloadTagManager();
      expect(c.tagManagerRows().length).toBe(1);
      ordersApi.listOrderTagStats.and.returnValue(throwError(() => new Error('x')));
      c.reloadTagManager();
      expect(c.tagManagerError()).toBe('adminUi.orders.tags.errors.load');
    });

    it('handles null tag stats rows', () => {
      const c = make();
      ordersApi.listOrderTagStats.and.returnValue(of(null as any));
      c.reloadTagManager();
      expect(c.tagManagerRows()).toEqual([]);
    });

    it('filters tag manager rows by query', () => {
      const c = make();
      c.tagManagerRows.set([
        { tag: 'vip', count: 1 },
        { tag: 'gift', count: 2 },
      ]);
      c.tagManagerQuery = '';
      expect(c.filteredTagManagerRows().length).toBe(2);
      c.tagManagerQuery = 'vip';
      expect(c.filteredTagManagerRows().map((r) => r.tag)).toEqual(['vip']);
    });

    it('reads and sets tag colors, ignoring invalid input', () => {
      const c = make();
      expect(c.tagColorValue('vip')).toBeDefined();
      c.setTagColor('vip', TAG_COLOR_PALETTE[1]);
      expect(localStorage.getItem(TAG_COLOR_STORAGE_KEY)).toContain(TAG_COLOR_PALETTE[1]);
      c.setTagColor('', TAG_COLOR_PALETTE[1]);
      c.setTagColor('vip', 'not-a-color');
      expect(c.tagColorValue('vip')).toBe(TAG_COLOR_PALETTE[1]);
    });

    it('resets a tag color and ignores empty tags', () => {
      const c = make();
      const defaultColor = c.tagColorValue('vip');
      const overrideColor = TAG_COLOR_PALETTE.find((color) => color !== defaultColor)!;
      c.setTagColor('vip', overrideColor);
      expect(c.tagColorValue('vip')).toBe(overrideColor);
      c.resetTagColor('vip');
      c.resetTagColor('');
      expect(c.tagColorValue('vip')).toBe(defaultColor);
    });

    it('renders an sla overdue badge', () => {
      const c = make();
      const badge = c.slaBadge(
        order({ sla_kind: 'accept', sla_due_at: '2000-01-01T00:00:00Z' }),
      );
      expect(badge).not.toBeNull();
      expect(badge!.className).toContain('rose');
    });

    it('renders an sla due-soon badge', () => {
      const c = make();
      const dueSoon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const badge = c.slaBadge(order({ sla_kind: 'ship', sla_due_at: dueSoon }));
      expect(badge!.className).toContain('amber');
    });

    it('returns null sla badge for missing/invalid/far-future/unknown-kind data', () => {
      const c = make();
      expect(c.slaBadge(order({ sla_kind: '', sla_due_at: '' }))).toBeNull();
      expect(c.slaBadge(order({ sla_kind: 'accept', sla_due_at: 'not-a-date' }))).toBeNull();
      expect(c.slaBadge(order({ sla_kind: 'other', sla_due_at: '2030-01-01T00:00:00Z' }))).toBeNull();
      const far = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      expect(c.slaBadge(order({ sla_kind: 'accept', sla_due_at: far }))).toBeNull();
    });

    it('renders fraud badges across severities', () => {
      const c = make();
      expect(c.fraudBadge(order({ fraud_severity: '' }))).toBeNull();
      expect(c.fraudBadge(order({ fraud_severity: 'high' }))!.className).toContain('rose');
      expect(c.fraudBadge(order({ fraud_severity: 'medium' }))!.className).toContain('amber');
      expect(c.fraudBadge(order({ fraud_severity: 'low' }))!.className).toContain('sky');
      expect(c.fraudBadge(order({ fraud_severity: 'weird' }))!.className).toContain('slate');
    });

    it('uses a translated severity label when available', () => {
      const c = make();
      translate.instant.and.callFake((key: string) =>
        key === 'adminUi.orders.fraudSignals.severity.high' ? 'High risk' : key,
      );
      const badge = c.fraudBadge(order({ fraud_severity: 'high' }));
      expect(badge).not.toBeNull();
    });

    it('formats short durations in minutes, hours and days', () => {
      const c = make();
      expect((c as any).formatDurationShort(30 * 60_000)).toBe('30m');
      expect((c as any).formatDurationShort(3 * 60 * 60_000)).toBe('3h');
      expect((c as any).formatDurationShort(72 * 60 * 60_000)).toBe('3d');
    });
  });

  // ---------------------------------------------------------------------------
  // bulk tags + rename
  // ---------------------------------------------------------------------------

  describe('bulk tags and rename', () => {
    it('does nothing applying bulk tags with no selection', () => {
      const c = make();
      c.applyBulkTags();
      expect(ordersApi.addOrderTag).not.toHaveBeenCalled();
    });

    it('errors applying bulk tags with no add/remove value', () => {
      const c = make();
      c.selectedIds.add('a');
      c.applyBulkTags();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.errors.chooseTagAction');
    });

    it('applies add and remove tags reporting success', () => {
      const c = make();
      c.selectedIds.add('a');
      c.bulkTagAdd = 'vip';
      c.bulkTagRemove = 'test';
      c.applyBulkTags();
      expect(ordersApi.addOrderTag).toHaveBeenCalledWith('a', 'vip');
      expect(ordersApi.removeOrderTag).toHaveBeenCalledWith('a', 'test');
      expect(toast.success).toHaveBeenCalled();
    });

    it('reports partial bulk-tag failures', () => {
      const c = make();
      c.selectedIds.add('a');
      c.bulkTagAdd = 'vip';
      ordersApi.addOrderTag.and.returnValue(throwError(() => new Error('x')));
      c.applyBulkTags();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.partial');
      expect(c.selectedIds.has('a')).toBe(true);
    });

    it('refuses rename without both tags', () => {
      const c = make();
      c.tagRenameFrom = 'a';
      c.tagRenameTo = '';
      c.renameTag();
      expect(c.tagRenameError).toBe('adminUi.orders.tags.errors.renameRequired');
    });

    it('skips rename while busy', () => {
      const c = make();
      c.tagRenameBusy = true;
      c.renameTag();
      expect(ordersApi.renameOrderTag).not.toHaveBeenCalled();
    });

    it('aborts rename when not confirmed', () => {
      const c = make();
      c.tagRenameFrom = 'a';
      c.tagRenameTo = 'b';
      spyOn(window, 'confirm').and.returnValue(false);
      c.renameTag();
      expect(ordersApi.renameOrderTag).not.toHaveBeenCalled();
    });

    it('renames a tag, migrating colour overrides and updating the active filter', () => {
      const c = make();
      c.tag = 'a';
      c.setTagColor('a', TAG_COLOR_PALETTE[3]);
      c.tagRenameFrom = 'a';
      c.tagRenameTo = 'b';
      spyOn(window, 'confirm').and.returnValue(true);
      ordersApi.renameOrderTag.and.returnValue(
        of({ from_tag: 'a', to_tag: 'b', updated: 2, merged: 0, total: 2 } as any),
      );
      c.renameTag();
      expect(c.tag).toBe('b');
      expect(c.tagColorValue('b')).toBe(TAG_COLOR_PALETTE[3]);
      expect(toast.success).toHaveBeenCalled();
      expect(c.tagRenameBusy).toBe(false);
    });

    it('surfaces rename errors from the API', () => {
      const c = make();
      c.tagRenameFrom = 'a';
      c.tagRenameTo = 'b';
      spyOn(window, 'confirm').and.returnValue(true);
      ordersApi.renameOrderTag.and.returnValue(
        throwError(() => ({ error: { detail: 'Boom' } })),
      );
      c.renameTag();
      expect(c.tagRenameError).toBe('Boom');
    });

    it('falls back to a generic rename error message', () => {
      const c = make();
      c.tagRenameFrom = 'a';
      c.tagRenameTo = 'b';
      spyOn(window, 'confirm').and.returnValue(true);
      ordersApi.renameOrderTag.and.returnValue(throwError(() => ({})));
      c.renameTag();
      expect(c.tagRenameError).toBe('adminUi.orders.tags.errors.rename');
    });

    it('refreshes tag options merging server tags', () => {
      const c = make();
      (c as any).refreshTagOptions();
      expect(c.tagOptions()).toContain('custom');
      expect(c.tagOptions()).toContain('vip');
    });

    it('ignores tag option refresh errors', () => {
      const c = make();
      ordersApi.listOrderTags.and.returnValue(throwError(() => new Error('x')));
      expect(() => (c as any).refreshTagOptions()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // data loading
  // ---------------------------------------------------------------------------

  describe('data loading', () => {
    it('loads table data with all filter params applied', () => {
      const c = make();
      c.q = ' query ';
      c.status = 'paid';
      c.sla = 'any_overdue';
      c.fraud = 'queue';
      c.tag = ' vip ';
      c.includeTestOrders = false;
      c.fromDate = '2026-01-01';
      c.toDate = '2026-01-02';
      ordersApi.search.and.returnValue(of(searchResult([order()])));
      (c as any).load();
      const params = ordersApi.search.calls.mostRecent().args[0];
      expect(params.q).toBe('query');
      expect(params.status).toBe('paid');
      expect(params.include_test).toBe(false);
      expect(c.orders().length).toBe(1);
      expect(c.loading()).toBe(false);
    });

    it('reports table load errors', () => {
      const c = make();
      ordersApi.search.and.returnValue(
        throwError(() => new HttpErrorResponse({ error: { request_id: 'r1' } })),
      );
      (c as any).load();
      expect(c.error()).toBe('adminUi.orders.errors.load');
      expect(c.errorRequestId()).toBe('r1');
    });

    it('loads kanban columns and totals', () => {
      const c = make();
      c.viewMode.set('kanban');
      c.status = 'paid';
      ordersApi.search.and.returnValue(of(searchResult([order()])));
      (c as any).load();
      expect(c.kanbanItemsByStatus()['paid'].length).toBe(1);
      expect(c.kanbanTotalsByStatus()['paid']).toBe(1);
      expect(c.loading()).toBe(false);
    });

    it('records the first error when a kanban column fails to load', () => {
      const c = make();
      c.viewMode.set('kanban');
      c.status = 'paid';
      ordersApi.search.and.returnValue(throwError(() => ({ error: { request_id: 'rk' } })));
      (c as any).load();
      expect(c.error()).toBe('adminUi.orders.errors.load');
      expect(c.kanbanItemsByStatus()['paid']).toEqual([]);
    });

    it('falls back to item count when kanban meta has no total', () => {
      const c = make();
      c.viewMode.set('kanban');
      c.status = 'paid';
      ordersApi.search.and.returnValue(
        of({ items: [order()], meta: { page: 1, limit: 20 } as any }),
      );
      (c as any).load();
      expect(c.kanbanTotalsByStatus()['paid']).toBe(1);
    });

    it('loads kanban with optional filter params', () => {
      const c = make();
      c.viewMode.set('kanban');
      c.status = 'paid';
      c.q = 'kq';
      c.tag = 'vip';
      c.sla = 'ship_overdue';
      c.fraud = 'flagged';
      c.includeTestOrders = false;
      c.fromDate = '2026-03-01';
      c.toDate = '2026-03-02';
      (c as any).load();
      const params = ordersApi.search.calls.mostRecent().args[0];
      expect(params.q).toBe('kq');
      expect(params.include_test).toBe(false);
    });

    it('retries the current load', () => {
      const c = make();
      c.retryLoad();
      expect(ordersApi.search).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // storage keys + persistence
  // ---------------------------------------------------------------------------

  describe('storage and persistence', () => {
    it('builds user-scoped storage keys', () => {
      const c = make();
      expect((c as any).storageKey()).toContain('user-1');
      expect((c as any).exportStorageKey()).toContain('user-1');
      expect((c as any).viewModeStorageKey()).toContain('user-1');
    });

    it('falls back to anonymous storage keys when no user', () => {
      const c = make();
      auth.user.and.returnValue(null);
      expect((c as any).storageKey()).toContain('anonymous');
      expect((c as any).exportStorageKey()).toContain('anonymous');
      expect((c as any).viewModeStorageKey()).toContain('anonymous');
    });

    it('loads a persisted view mode, defaulting safely', () => {
      const c = make();
      localStorage.setItem((c as any).viewModeStorageKey(), 'kanban');
      expect((c as any).loadViewMode()).toBe('kanban');
      localStorage.setItem((c as any).viewModeStorageKey(), 'garbage');
      expect((c as any).loadViewMode()).toBe('table');
    });

    it('returns table when reading the view mode throws', () => {
      const c = make();
      spyOn(localStorage, 'getItem').and.throwError('blocked');
      expect((c as any).loadViewMode()).toBe('table');
    });

    it('swallows view mode persistence errors', () => {
      const c = make();
      spyOn(localStorage, 'setItem').and.throwError('blocked');
      expect(() => (c as any).persistViewMode()).not.toThrow();
    });

    it('loads default export columns when nothing is stored', () => {
      const c = make();
      localStorage.removeItem((c as any).exportStorageKey());
      (c as any).loadExportState();
      expect(c.exportColumns['id']).toBe(true);
      expect(c.exportTemplates).toEqual([]);
    });

    it('loads export state including a selected template with columns', () => {
      const c = make();
      localStorage.setItem(
        (c as any).exportStorageKey(),
        JSON.stringify({
          templates: [
            { id: 't1', name: 'T', createdAt: '', columns: ['status'] },
            { notValid: true },
          ],
          selectedTemplateId: 't1',
          columns: ['id'],
        }),
      );
      (c as any).loadExportState();
      expect(c.exportTemplates.length).toBe(1);
      expect(c.exportColumns['status']).toBe(true);
      expect(c.exportColumns['id']).toBe(false);
    });

    it('loads export state with explicit columns when no template selected', () => {
      const c = make();
      localStorage.setItem(
        (c as any).exportStorageKey(),
        JSON.stringify({ templates: [], selectedTemplateId: '', columns: ['currency'] }),
      );
      (c as any).loadExportState();
      expect(c.exportColumns['currency']).toBe(true);
    });

    it('falls back to default export columns when stored columns are empty', () => {
      const c = make();
      localStorage.setItem(
        (c as any).exportStorageKey(),
        JSON.stringify({ templates: [], selectedTemplateId: '', columns: ['unknown-col'] }),
      );
      (c as any).loadExportState();
      expect(c.exportColumns['id']).toBe(true);
    });

    it('keeps a selected template id whose template has no columns', () => {
      const c = make();
      localStorage.setItem(
        (c as any).exportStorageKey(),
        JSON.stringify({
          templates: [{ id: 't1', name: 'T', createdAt: '', columns: [] }],
          selectedTemplateId: 't1',
          columns: ['status'],
        }),
      );
      (c as any).loadExportState();
      expect(c.exportColumns['status']).toBe(true);
    });

    it('recovers from corrupt export state', () => {
      const c = make();
      localStorage.setItem((c as any).exportStorageKey(), 'not json');
      (c as any).loadExportState();
      expect(c.exportColumns['id']).toBe(true);
    });

    it('loads presets parsing valid and invalid filter values', () => {
      const c = make();
      localStorage.setItem(
        (c as any).storageKey(),
        JSON.stringify([
          {
            id: 'p1',
            name: 'Good',
            createdAt: '',
            filters: {
              q: 'x',
              status: 'paid',
              sla: 'any_overdue',
              fraud: 'queue',
              tag: 'vip',
              fromDate: '',
              toDate: '',
              includeTestOrders: false,
              limit: 30,
            },
          },
          {
            id: 'p2',
            name: 'Sloppy',
            createdAt: '',
            filters: { sla: 'bogus', fraud: 'bogus', includeTestOrders: 'yes', limit: 'NaN' },
          },
          { missingNameAndId: true },
        ]),
      );
      const presets = (c as any).loadPresets();
      expect(presets.length).toBe(2);
      expect(presets[0].filters.sla).toBe('any_overdue');
      expect(presets[1].filters.sla).toBe('all');
      expect(presets[1].filters.fraud).toBe('all');
      expect(presets[1].filters.includeTestOrders).toBe(true);
      expect(presets[1].filters.limit).toBe(20);
    });

    it('returns an empty preset list for missing or non-array storage', () => {
      const c = make();
      localStorage.removeItem((c as any).storageKey());
      expect((c as any).loadPresets()).toEqual([]);
      localStorage.setItem((c as any).storageKey(), JSON.stringify({ not: 'array' }));
      expect((c as any).loadPresets()).toEqual([]);
    });

    it('returns an empty preset list when parsing throws', () => {
      const c = make();
      localStorage.setItem((c as any).storageKey(), 'not json');
      expect((c as any).loadPresets()).toEqual([]);
    });

    it('swallows preset and export persistence errors', () => {
      const c = make();
      spyOn(localStorage, 'setItem').and.throwError('blocked');
      expect(() => (c as any).persistPresets()).not.toThrow();
      expect(() => (c as any).persistExportState()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Nullish/default branch coverage: each case drives a specific `??`/`||`
  // fallback or alternate code path that the happy-path tests skip.
  // ---------------------------------------------------------------------------

  describe('default and nullish branches', () => {
    it('ignores a kanban drop whose order status is nullish', () => {
      const c = make();
      c.onKanbanDrop(
        { item: { data: order({ id: 'x', status: undefined as unknown as string }) } } as any,
        'shipped',
      );
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('reorders within a column even when the column array is missing', () => {
      const c = make();
      const a = order({ id: 'a', status: 'paid' });
      c.kanbanItemsByStatus.set({});
      c.onKanbanDrop({ item: { data: a }, previousIndex: 0, currentIndex: 0 } as any, 'paid');
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('treats a cancelled drop with a null prompt as missing a reason', () => {
      const c = make();
      const a = order({ id: 'a', status: 'paid' });
      c.kanbanItemsByStatus.set({ paid: [a], cancelled: [] });
      spyOn(window, 'prompt').and.returnValue(null);
      c.onKanbanDrop({ item: { data: a }, previousIndex: 0, currentIndex: 0 } as any, 'cancelled');
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.kanban.errors.cancelReasonRequired');
    });

    it('transfers between columns even when both arrays are missing', () => {
      const c = make();
      const a = order({ id: 'a', status: 'paid' });
      c.kanbanItemsByStatus.set({});
      c.kanbanTotalsByStatus.set({});
      c.onKanbanDrop({ item: { data: a }, previousIndex: 0, currentIndex: 0 } as any, 'shipped');
      expect(ordersApi.update).toHaveBeenCalledWith('a', {
        status: 'shipped',
        cancel_reason: undefined,
      });
    });

    it('computes transitions for nullish, unknown and unpaid orders', () => {
      const c = make();
      expect(
        (c as any).allowedKanbanTransitions({
          status: undefined,
          payment_method: undefined,
        }),
      ).toEqual([]);
      expect((c as any).allowedKanbanTransitions({ status: 'weird' })).toEqual([]);
      expect(
        (c as any).allowedKanbanTransitions(order({ status: 'paid', payment_method: null })),
      ).toContain('shipped');
    });

    it('ignores applying a saved view key that resolves to no view', () => {
      const c = make();
      favorites.items.set([
        { key: 'present', type: 'filter', label: 'L', subtitle: '', url: '', state: { adminFilterScope: 'orders' } },
      ]);
      c.applySavedView('absent');
      expect(c.q).toBe('');
    });

    it('refuses to pin a view when the prompt is cancelled', () => {
      const c = make();
      favorites.isFavorite.and.returnValue(false);
      spyOn(window, 'prompt').and.returnValue(null);
      c.toggleCurrentViewPin();
      expect(favorites.add).not.toHaveBeenCalled();
    });

    it('applies history filters that omit a query string', () => {
      history.replaceState({ adminFilterScope: 'orders', adminFilters: { status: 'paid' } }, '');
      const c = make();
      (c as any).maybeApplyFiltersFromState();
      expect(c.q).toBe('');
      expect(c.status).toBe('paid');
    });

    it('rejects saving a preset when the prompt is cancelled', () => {
      const c = make();
      spyOn(window, 'prompt').and.returnValue(null);
      c.savePreset();
      expect(c.presets.length).toBe(0);
    });

    it('reports retry upload errors without a request id', () => {
      const c = make();
      c.shippingLabelsUploads = [
        { file: new File(['x'], 'a.pdf'), assignedOrderId: 'a', status: 'pending', error: null },
      ];
      ordersApi.uploadShippingLabel.and.returnValue(throwError(() => new Error('plain')));
      c.retryShippingLabelUpload(0);
      expect(c.shippingLabelsUploads[0].error).toBe(
        'adminUi.orders.shippingLabelsModal.errors.uploadFailed',
      );
    });

    it('auto-assigns nothing for a file with no name', () => {
      const c = make();
      c.shippingLabelsOrderOptions = [{ id: 'a', ref: 'REF', shortId: 's', label: 'l' }];
      expect((c as any).autoAssignShippingLabel({ name: undefined } as unknown as File)).toBeNull();
    });

    it('applies an export template that has no columns', () => {
      const c = make();
      c.exportColumns = { id: true };
      c.exportTemplates = [
        { id: 't1', name: 'T', createdAt: '', columns: undefined as unknown as string[] },
      ];
      c.applyExportTemplate('t1');
      expect(c.exportColumns['id']).toBe(false);
    });

    it('rejects saving an export template when the prompt is cancelled', () => {
      const c = make();
      c.exportColumns = { id: true };
      spyOn(window, 'prompt').and.returnValue(null);
      c.saveExportTemplate();
      expect(c.exportTemplates.length).toBe(0);
    });

    it('labels a guest when email and username are null', () => {
      const c = make();
      expect(
        c.customerLabel(order({ customer_email: null, customer_username: null })),
      ).toBe('adminUi.orders.guest');
    });

    it('filters tag rows whose tag is empty', () => {
      const c = make();
      c.tagManagerRows.set([{ tag: '', count: 0 }]);
      c.tagManagerQuery = 'vip';
      expect(c.filteredTagManagerRows()).toEqual([]);
    });

    it('ignores setting a tag colour to an empty value', () => {
      const c = make();
      const before = c.tagColorValue('vip');
      c.setTagColor('vip', '');
      expect(c.tagColorValue('vip')).toBe(before);
    });

    it('requires a from-tag when renaming', () => {
      const c = make();
      c.tagRenameFrom = '';
      c.tagRenameTo = 'b';
      c.renameTag();
      expect(c.tagRenameError).toBe('adminUi.orders.tags.errors.renameRequired');
    });

    it('renames using the typed tags when the API echoes blank tag names', () => {
      const c = make();
      c.tag = 'a';
      c.tagRenameFrom = 'a';
      c.tagRenameTo = 'b';
      spyOn(window, 'confirm').and.returnValue(true);
      ordersApi.renameOrderTag.and.returnValue(
        of({ from_tag: '', to_tag: '', updated: 1, merged: 0, total: 1 } as any),
      );
      c.renameTag();
      expect(c.tag).toBe('b');
      expect(toast.success).toHaveBeenCalled();
    });

    it('returns a null sla badge when kind and due date are null', () => {
      const c = make();
      expect(c.slaBadge(order({ sla_kind: null, sla_due_at: null }))).toBeNull();
    });

    it('returns a null fraud badge when severity is null', () => {
      const c = make();
      expect(c.fraudBadge(order({ fraud_severity: null }))).toBeNull();
    });

    it('reports partial bulk-tag failures when removal fails', () => {
      const c = make();
      c.selectedIds.add('a');
      c.bulkTagRemove = 'test';
      ordersApi.removeOrderTag.and.returnValue(throwError(() => new Error('x')));
      c.applyBulkTags();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.partial');
    });

    it('treats a kanban column with null items/meta as empty', () => {
      const c = make();
      c.viewMode.set('kanban');
      c.status = 'paid';
      ordersApi.search.and.returnValue(of({ items: null, meta: null } as any));
      (c as any).load();
      expect(c.kanbanItemsByStatus()['paid']).toEqual([]);
      expect(c.kanbanTotalsByStatus()['paid']).toBe(0);
    });

    it('handles a synchronous failure of the kanban stream', () => {
      const c = make();
      c.viewMode.set('kanban');
      c.status = 'paid';
      ordersApi.search.and.callFake(() => {
        throw new Error('synchronous stream failure');
      });
      (c as any).load();
      expect(c.error()).toBe('adminUi.orders.errors.load');
      // A non-HttpErrorResponse carries no extractable request id.
      expect(c.errorRequestId()).toBeNull();
      expect(c.loading()).toBe(false);
    });

    it('loads export state from a malformed-but-parseable payload', () => {
      const c = make();
      localStorage.setItem(
        (c as any).exportStorageKey(),
        JSON.stringify({ templates: 'nope', selectedTemplateId: 123, columns: 'nope' }),
      );
      (c as any).loadExportState();
      expect(c.exportTemplates).toEqual([]);
      expect(c.selectedExportTemplateId).toBe('');
      expect(c.exportColumns['id']).toBe(true);
    });

    it('loads export templates lacking createdAt and columns', () => {
      const c = make();
      localStorage.setItem(
        (c as any).exportStorageKey(),
        JSON.stringify({ templates: [{ id: 't1', name: 'T' }], selectedTemplateId: '', columns: ['id'] }),
      );
      (c as any).loadExportState();
      expect(c.exportTemplates[0].createdAt).toBe('');
      expect(c.exportTemplates[0].columns).toEqual([]);
      expect(c.exportColumns['id']).toBe(true);
    });

    it('loads presets with entirely absent filter fields', () => {
      const c = make();
      localStorage.setItem(
        (c as any).storageKey(),
        JSON.stringify([{ id: 'p1', name: 'Empty', filters: {} }]),
      );
      const presets = (c as any).loadPresets();
      expect(presets[0].createdAt).toBe('');
      expect(presets[0].filters.status).toBe('all');
      expect(presets[0].filters.sla).toBe('all');
      expect(presets[0].filters.fraud).toBe('all');
      expect(presets[0].filters.q).toBe('');
    });
  });
});
