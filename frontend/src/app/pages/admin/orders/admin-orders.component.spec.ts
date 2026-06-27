import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { AdminOrdersComponent } from './admin-orders.component';
import { TAG_COLOR_STORAGE_KEY } from './order-tag-colors';
import {
  AdminOrderListItem,
  AdminOrderListResponse,
  AdminOrdersService,
} from '../../../core/admin-orders.service';

type Spy<T> = jasmine.SpyObj<T>;

function withoutCryptoRandomUUID(fn: () => void): void {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true });
  try {
    fn();
  } finally {
    if (desc) {
      Object.defineProperty(globalThis, 'crypto', desc);
    } else {
      delete (globalThis as { crypto?: Crypto }).crypto;
    }
  }
}

function makeOrder(partial: Partial<AdminOrderListItem> = {}): AdminOrderListItem {
  return {
    id: 'order-1234567890',
    reference_code: 'REF-001',
    status: 'paid',
    total_amount: 100,
    currency: 'RON',
    payment_method: 'card',
    created_at: '2026-01-01T00:00:00Z',
    customer_email: 'cust@example.com',
    customer_username: 'cust',
    tags: ['vip'],
    ...partial,
  };
}

function listResponse(items: AdminOrderListItem[]): AdminOrderListResponse {
  return {
    items,
    meta: { total_items: items.length, total_pages: 1, page: 1, limit: 20 },
  };
}

describe('AdminOrdersComponent', () => {
  let ordersApi: Spy<AdminOrdersService>;
  let router: { navigate: jasmine.Spy };
  let toast: { success: jasmine.Spy; error: jasmine.Spy; info: jasmine.Spy };
  let translate: { instant: jasmine.Spy };
  let auth: { user: jasmine.Spy };
  let favorites: {
    init: jasmine.Spy;
    items: jasmine.Spy;
    loading: jasmine.Spy;
    isFavorite: jasmine.Spy;
    add: jasmine.Spy;
    remove: jasmine.Spy;
  };
  let component: AdminOrdersComponent;

  beforeEach(() => {
    localStorage.clear();

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
      'listOrderTagStats',
      'renameOrderTag',
      'addOrderTag',
      'removeOrderTag',
      'listOrderTags',
    ]);

    ordersApi.search.and.returnValue(of(listResponse([])));
    ordersApi.update.and.returnValue(of({ status: 'paid' } as any));
    ordersApi.resendDeliveryEmail.and.returnValue(of({} as any));
    ordersApi.resendOrderConfirmationEmail.and.returnValue(of({} as any));
    ordersApi.downloadBatchPackingSlips.and.returnValue(of(new Blob()));
    ordersApi.downloadPickListCsv.and.returnValue(of(new Blob()));
    ordersApi.downloadPickListPdf.and.returnValue(of(new Blob()));
    ordersApi.uploadShippingLabel.and.returnValue(of({} as any));
    ordersApi.downloadBatchShippingLabelsZip.and.returnValue(of(new Blob()));
    ordersApi.downloadExport.and.returnValue(of(new Blob()));
    ordersApi.listOrderTagStats.and.returnValue(of([]));
    ordersApi.renameOrderTag.and.returnValue(
      of({ from_tag: 'old', to_tag: 'new', updated: 1, merged: 0, total: 1 }),
    );
    ordersApi.addOrderTag.and.returnValue(of({} as any));
    ordersApi.removeOrderTag.and.returnValue(of({} as any));
    ordersApi.listOrderTags.and.returnValue(of([]));

    router = { navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)) };
    toast = {
      success: jasmine.createSpy('success'),
      error: jasmine.createSpy('error'),
      info: jasmine.createSpy('info'),
    };
    translate = { instant: jasmine.createSpy('instant').and.callFake((key: string) => key) };
    auth = { user: jasmine.createSpy('user').and.returnValue({ id: 'user-1' }) };
    favorites = {
      init: jasmine.createSpy('init'),
      items: jasmine.createSpy('items').and.returnValue([]),
      loading: jasmine.createSpy('loading').and.returnValue(false),
      isFavorite: jasmine.createSpy('isFavorite').and.returnValue(false),
      add: jasmine.createSpy('add'),
      remove: jasmine.createSpy('remove'),
    };

    component = new AdminOrdersComponent(
      ordersApi,
      router as any,
      toast as any,
      translate as any,
      auth as any,
      favorites as any,
    );
  });

  describe('ngOnInit', () => {
    it('initializes state and loads orders', () => {
      ordersApi.search.and.returnValue(of(listResponse([makeOrder()])));
      component.ngOnInit();
      expect(favorites.init).toHaveBeenCalled();
      expect(ordersApi.search).toHaveBeenCalled();
      expect(component.orders().length).toBe(1);
      expect(component.loading()).toBeFalse();
    });
  });

  describe('layout modal', () => {
    it('opens and closes the layout modal', () => {
      component.openLayoutModal();
      expect(component.layoutModalOpen()).toBeTrue();
      component.closeLayoutModal();
      expect(component.layoutModalOpen()).toBeFalse();
    });

    it('applies a table layout and persists it', () => {
      const layout = { ...component.tableLayout(), density: 'compact' as const };
      component.applyTableLayout(layout);
      expect(component.tableLayout().density).toBe('compact');
    });

    it('toggles density both ways and reports the toggle label', () => {
      component.applyTableLayout({ ...component.tableLayout(), density: 'comfortable' });
      component.toggleDensity();
      expect(component.tableLayout().density).toBe('compact');
      expect(component.densityToggleLabelKey()).toBe(
        'adminUi.tableLayout.densityToggle.toComfortable',
      );
      component.toggleDensity();
      expect(component.tableLayout().density).toBe('comfortable');
      expect(component.densityToggleLabelKey()).toBe('adminUi.tableLayout.densityToggle.toCompact');
    });

    it('exposes visible column ids, track helpers and cell padding', () => {
      expect(component.visibleColumnIds().length).toBeGreaterThan(0);
      expect(component.trackColumnId(0, 'reference')).toBe('reference');
      expect(typeof component.cellPaddingClass()).toBe('string');
    });
  });

  describe('view mode', () => {
    it('reports toggle label for table and kanban', () => {
      component.viewMode.set('table');
      expect(component.viewToggleLabelKey()).toBe('adminUi.orders.viewMode.kanban');
      component.viewMode.set('kanban');
      expect(component.viewToggleLabelKey()).toBe('adminUi.orders.viewMode.table');
    });

    it('toggles view mode from table to kanban and reloads', () => {
      component.viewMode.set('table');
      component.toggleViewMode();
      expect(component.viewMode()).toBe('kanban');
      // kanban load issues a search per column status
      expect(ordersApi.search).toHaveBeenCalled();
    });

    it('toggles view mode from kanban back to table', () => {
      component.viewMode.set('kanban');
      component.toggleViewMode();
      expect(component.viewMode()).toBe('table');
    });

    it('loads view mode from storage including invalid value fallback', () => {
      localStorage.setItem('admin.orders.view.v1:user-1', 'kanban');
      component.ngOnInit();
      expect(component.viewMode()).toBe('kanban');
    });

    it('falls back to table when persisted view mode is invalid', () => {
      localStorage.setItem('admin.orders.view.v1:user-1', 'garbage');
      component.ngOnInit();
      expect(component.viewMode()).toBe('table');
    });

    it('returns table view mode when localStorage read throws', () => {
      spyOn(localStorage, 'getItem').and.throwError('boom');
      component.ngOnInit();
      expect(component.viewMode()).toBe('table');
    });

    it('swallows persist errors when writing view mode', () => {
      spyOn(localStorage, 'setItem').and.throwError('boom');
      component.viewMode.set('table');
      expect(() => component.toggleViewMode()).not.toThrow();
    });
  });

  describe('kanban columns', () => {
    it('computes column statuses for each filter', () => {
      component.status = 'pending';
      expect(component.kanbanColumnStatuses()).toEqual(['pending_payment', 'pending_acceptance']);
      component.status = 'sales';
      expect(component.kanbanColumnStatuses()).toEqual([
        'paid',
        'shipped',
        'delivered',
        'refunded',
      ]);
      component.status = 'all';
      expect(component.kanbanColumnStatuses().length).toBe(7);
      component.status = 'shipped';
      expect(component.kanbanColumnStatuses()).toEqual(['shipped']);
    });

    it('tracks kanban status and counts cards', () => {
      component.status = 'shipped';
      component.kanbanItemsByStatus.set({ shipped: [makeOrder()] });
      expect(component.trackKanbanStatus(0, 'shipped')).toBe('shipped');
      expect(component.kanbanTotalCards()).toBe(1);
    });

    it('counts zero cards when a column has no items', () => {
      component.status = 'shipped';
      component.kanbanItemsByStatus.set({});
      expect(component.kanbanTotalCards()).toBe(0);
    });
  });

  describe('onKanbanDrop', () => {
    function drop(prev: number, curr: number, order: AdminOrderListItem) {
      return { item: { data: order }, previousIndex: prev, currentIndex: curr } as any;
    }

    it('ignores drops while busy', () => {
      component.kanbanBusy.set(true);
      component.onKanbanDrop(drop(0, 0, makeOrder()), 'shipped');
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('ignores drops with missing order id or status', () => {
      component.onKanbanDrop(drop(0, 0, { id: '', status: '' } as any), 'shipped');
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('ignores drops when the order status is nullish', () => {
      component.onKanbanDrop(drop(0, 0, { id: 'a', status: null } as any), 'shipped');
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('reorders within a column that is missing from the map', () => {
      const order = makeOrder({ id: 'a', status: 'paid' });
      component.kanbanItemsByStatus.set({});
      component.onKanbanDrop(drop(0, 0, order), 'paid');
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('requires a cancel reason when the prompt is dismissed', () => {
      spyOn(window, 'prompt').and.returnValue(null);
      const order = makeOrder({ id: 'a', status: 'paid' });
      component.kanbanItemsByStatus.set({ paid: [order], cancelled: [] });
      component.onKanbanDrop(drop(0, 0, order), 'cancelled');
      expect(toast.error).toHaveBeenCalled();
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('transfers between columns missing from the map', () => {
      ordersApi.update.and.returnValue(of({ status: 'shipped' } as any));
      const order = makeOrder({ id: 'a', status: 'paid' });
      component.kanbanItemsByStatus.set({});
      component.onKanbanDrop(drop(0, 0, order), 'shipped');
      expect(ordersApi.update).toHaveBeenCalled();
    });

    it('reorders within the same column', () => {
      const a = makeOrder({ id: 'a', status: 'paid' });
      const b = makeOrder({ id: 'b', status: 'paid' });
      component.kanbanItemsByStatus.set({ paid: [a, b] });
      component.onKanbanDrop(drop(0, 1, a), 'paid');
      expect(component.kanbanItemsByStatus()['paid'].map((o) => o.id)).toEqual(['b', 'a']);
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('rejects invalid transitions', () => {
      const order = makeOrder({ id: 'a', status: 'delivered', payment_method: 'card' });
      component.kanbanItemsByStatus.set({ delivered: [order], paid: [] });
      component.onKanbanDrop(drop(0, 0, order), 'paid');
      expect(toast.error).toHaveBeenCalled();
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('allows extra COD transitions from pending_acceptance', () => {
      const order = makeOrder({ id: 'a', status: 'pending_acceptance', payment_method: 'COD' });
      component.kanbanItemsByStatus.set({ pending_acceptance: [order], shipped: [] });
      component.onKanbanDrop(drop(0, 0, order), 'shipped');
      expect(ordersApi.update).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalled();
    });

    it('requires a cancel reason for cancellation', () => {
      spyOn(window, 'prompt').and.returnValue('   ');
      const order = makeOrder({ id: 'a', status: 'paid' });
      component.kanbanItemsByStatus.set({ paid: [order], cancelled: [] });
      component.onKanbanDrop(drop(0, 0, order), 'cancelled');
      expect(toast.error).toHaveBeenCalled();
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('cancels with a provided reason', () => {
      spyOn(window, 'prompt').and.returnValue('fraud');
      const order = makeOrder({ id: 'a', status: 'paid' });
      component.kanbanItemsByStatus.set({ paid: [order], cancelled: [] });
      component.onKanbanDrop(drop(0, 0, order), 'cancelled');
      expect(ordersApi.update).toHaveBeenCalledWith('a', {
        status: 'cancelled',
        cancel_reason: 'fraud',
      });
    });

    it('aborts a refund when not confirmed', () => {
      spyOn(window, 'confirm').and.returnValue(false);
      const order = makeOrder({ id: 'a', status: 'paid' });
      component.kanbanItemsByStatus.set({ paid: [order], refunded: [] });
      component.onKanbanDrop(drop(0, 0, order), 'refunded');
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('processes a confirmed refund and uses the returned status', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      ordersApi.update.and.returnValue(of({ status: 'refunded' } as any));
      const order = makeOrder({ id: 'a', status: 'paid' });
      component.kanbanItemsByStatus.set({ paid: [order], refunded: [] });
      component.kanbanTotalsByStatus.set({ paid: 1, refunded: 0 });
      component.onKanbanDrop(drop(0, 0, order), 'refunded');
      expect(order.status).toBe('refunded');
      expect(toast.success).toHaveBeenCalled();
    });

    it('falls back to target status when the response omits a status', () => {
      ordersApi.update.and.returnValue(of({} as any));
      const order = makeOrder({ id: 'a', status: 'paid' });
      component.kanbanItemsByStatus.set({ paid: [order], shipped: [] });
      component.onKanbanDrop(drop(0, 0, order), 'shipped');
      expect(order.status).toBe('shipped');
    });

    it('rolls back on update error', () => {
      ordersApi.update.and.returnValue(throwError(() => new Error('fail')));
      const order = makeOrder({ id: 'a', status: 'paid' });
      component.kanbanItemsByStatus.set({ paid: [order], shipped: [] });
      const before = component.kanbanItemsByStatus();
      component.onKanbanDrop(drop(0, 0, order), 'shipped');
      expect(order.status).toBe('paid');
      expect(component.kanbanItemsByStatus()).toBe(before);
      expect(toast.error).toHaveBeenCalled();
    });

    it('uses default totals when source/target totals are absent', () => {
      ordersApi.update.and.returnValue(of({ status: 'shipped' } as any));
      const order = makeOrder({ id: 'a', status: 'paid' });
      component.kanbanItemsByStatus.set({ paid: [order], shipped: [] });
      component.kanbanTotalsByStatus.set({});
      component.onKanbanDrop(drop(0, 0, order), 'shipped');
      const totals = component.kanbanTotalsByStatus();
      expect(totals['shipped']).toBeGreaterThanOrEqual(1);
      expect(totals['paid']).toBeGreaterThanOrEqual(0);
    });
  });

  describe('allowedKanbanTransitions', () => {
    it('returns an empty list for an order without status or payment method', () => {
      const result = component['allowedKanbanTransitions']({ id: 'a' } as any);
      expect(result).toEqual([]);
    });
  });

  describe('scrollToBulkActions', () => {
    afterEach(() => {
      const el = document.getElementById('admin-orders-bulk-actions');
      if (el) el.remove();
    });

    it('does nothing when the bulk actions element is missing', () => {
      expect(() => component.scrollToBulkActions()).not.toThrow();
    });

    it('scrolls and focuses the first focusable child', fakeAsync(() => {
      const el = document.createElement('div');
      el.id = 'admin-orders-bulk-actions';
      const button = document.createElement('button');
      el.appendChild(button);
      document.body.appendChild(el);
      el.scrollIntoView = jasmine.createSpy('scrollIntoView');
      const focusSpy = spyOn(button, 'focus');
      component.scrollToBulkActions();
      tick(0);
      expect(el.scrollIntoView).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
    }));
  });

  describe('filters', () => {
    it('applyFilters resets paging and reloads', () => {
      component.page = 5;
      component.selectedPresetId = 'p1';
      component.applyFilters();
      expect(component.page).toBe(1);
      expect(component.selectedPresetId).toBe('');
      expect(ordersApi.search).toHaveBeenCalled();
    });

    it('resetFilters clears all filters', () => {
      component.q = 'x';
      component.status = 'paid';
      component.includeTestOrders = false;
      component.resetFilters();
      expect(component.q).toBe('');
      expect(component.status).toBe('all');
      expect(component.includeTestOrders).toBeTrue();
    });
  });

  describe('presets', () => {
    it('applyPreset ignores empty id and missing presets', () => {
      component.applyPreset('');
      expect(component.selectedPresetId).toBe('');
      component.applyPreset('does-not-exist');
      expect(ordersApi.search).not.toHaveBeenCalled();
    });

    it('applyPreset applies stored filters', () => {
      component.presets = [
        {
          id: 'p1',
          name: 'Preset',
          createdAt: 'now',
          filters: {
            q: 'abc',
            status: 'paid',
            sla: 'any_overdue',
            fraud: 'queue',
            tag: 'vip',
            fromDate: '2026-01-01',
            toDate: '2026-02-01',
            includeTestOrders: false,
            limit: 50,
          },
        },
      ];
      component.applyPreset('p1');
      expect(component.q).toBe('abc');
      expect(component.limit).toBe(50);
      expect(ordersApi.search).toHaveBeenCalled();
    });

    it('applyPreset falls back to defaults for missing sla/fraud', () => {
      component.presets = [
        {
          id: 'p2',
          name: 'Preset2',
          createdAt: 'now',
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
      component.applyPreset('p2');
      expect(component.sla).toBe('all');
      expect(component.fraud).toBe('all');
    });

    it('savePreset requires a name', () => {
      spyOn(window, 'prompt').and.returnValue(null);
      component.savePreset();
      expect(toast.error).toHaveBeenCalled();
      expect(component.presets.length).toBe(0);
    });

    it('savePreset stores a preset using crypto uuid', () => {
      spyOn(window, 'prompt').and.returnValue('My Preset');
      component.savePreset();
      expect(component.presets.length).toBe(1);
      expect(component.presets[0].name).toBe('My Preset');
      expect(toast.success).toHaveBeenCalled();
    });

    it('savePreset falls back to a generated id without crypto.randomUUID', () => {
      spyOn(window, 'prompt').and.returnValue('No Crypto Preset');
      withoutCryptoRandomUUID(() => component.savePreset());
      expect(component.presets.length).toBe(1);
      expect(component.presets[0].id).toContain('-');
    });

    it('deletePreset ignores unknown selection and respects confirm cancel', () => {
      component.deletePreset();
      component.presets = [
        { id: 'p1', name: 'P', createdAt: 'now', filters: component['currentViewFilters']() },
      ];
      component.selectedPresetId = 'p1';
      spyOn(window, 'confirm').and.returnValue(false);
      component.deletePreset();
      expect(component.presets.length).toBe(1);
    });

    it('deletePreset removes a confirmed preset', () => {
      component.presets = [
        { id: 'p1', name: 'P', createdAt: 'now', filters: component['currentViewFilters']() },
      ];
      component.selectedPresetId = 'p1';
      spyOn(window, 'confirm').and.returnValue(true);
      component.deletePreset();
      expect(component.presets.length).toBe(0);
      expect(toast.success).toHaveBeenCalled();
    });

    it('loadPresets reads, sanitizes and returns persisted presets', () => {
      localStorage.setItem(
        'admin.orders.filters.v1:user-1',
        JSON.stringify([
          {
            id: 'p1',
            name: 'Valid',
            createdAt: 'now',
            filters: {
              q: 'q',
              status: 'paid',
              sla: 'ship_overdue',
              fraud: 'denied',
              tag: 't',
              fromDate: 'a',
              toDate: 'b',
              includeTestOrders: false,
              limit: 99,
            },
          },
          { id: 5, name: 'invalid-id' },
          {
            id: 'p2',
            name: 'Defaults',
            filters: { sla: 'weird', fraud: 'weird', limit: 'nope', includeTestOrders: 'nope' },
          },
          { id: 'p3', name: 'Empty', filters: {} },
        ]),
      );
      component.ngOnInit();
      expect(component.presets.length).toBe(3);
      expect(component.presets[0].filters.limit).toBe(99);
      expect(component.presets[1].filters.sla).toBe('all');
      expect(component.presets[1].filters.fraud).toBe('all');
      expect(component.presets[1].filters.limit).toBe(20);
      expect(component.presets[1].filters.includeTestOrders).toBeTrue();
      expect(component.presets[2].filters.sla).toBe('all');
      expect(component.presets[2].filters.fraud).toBe('all');
    });

    it('loadPresets returns empty for missing, non-array, and throwing storage', () => {
      component.ngOnInit();
      expect(component.presets).toEqual([]);

      localStorage.setItem('admin.orders.filters.v1:user-1', JSON.stringify({ not: 'array' }));
      component.ngOnInit();
      expect(component.presets).toEqual([]);

      localStorage.setItem('admin.orders.filters.v1:user-1', 'not-json');
      component.ngOnInit();
      expect(component.presets).toEqual([]);
    });

    it('persistPresets swallows storage errors', () => {
      spyOn(localStorage, 'setItem').and.throwError('boom');
      spyOn(window, 'prompt').and.returnValue('X');
      expect(() => component.savePreset()).not.toThrow();
    });

    it('uses anonymous storage key when no user id', () => {
      auth.user.and.returnValue(null);
      spyOn(window, 'prompt').and.returnValue('Anon');
      component.savePreset();
      expect(localStorage.getItem('admin.orders.filters.v1:anonymous')).toBeTruthy();
    });

    it('uses anonymous keys for export/view storage without a user', () => {
      auth.user.and.returnValue(null);
      component.ngOnInit();
      component.toggleExportColumn('status', true);
      component.viewMode.set('kanban');
      component['persistViewMode']();
      expect(localStorage.getItem('admin.orders.export.v1:anonymous')).toBeTruthy();
      expect(localStorage.getItem('admin.orders.view.v1:anonymous')).toBe('kanban');
    });
  });

  describe('saved views', () => {
    it('returns only order-scoped filter favorites', () => {
      favorites.items.and.returnValue([
        { key: 'a', type: 'filter', label: 'A', state: { adminFilterScope: 'orders' } },
        { key: 'b', type: 'filter', label: 'B', state: { adminFilterScope: 'products' } },
        { key: 'c', type: 'link', label: 'C', state: {} },
      ]);
      expect(component.savedViews().map((v) => v.key)).toEqual(['a']);
    });

    it('applySavedView ignores empty key and invalid filters', () => {
      component.applySavedView('');
      expect(ordersApi.search).not.toHaveBeenCalled();

      favorites.items.and.returnValue([
        { key: 'a', type: 'filter', label: 'A', state: { adminFilterScope: 'orders' } },
      ]);
      component.applySavedView('a');
      expect(ordersApi.search).not.toHaveBeenCalled();
    });

    it('applySavedView ignores a key with no matching view', () => {
      favorites.items.and.returnValue([
        { key: 'other', type: 'filter', label: 'O', state: { adminFilterScope: 'orders' } },
      ]);
      component.applySavedView('missing');
      expect(ordersApi.search).not.toHaveBeenCalled();
    });

    it('applySavedView applies stored filters', () => {
      favorites.items.and.returnValue([
        {
          key: 'a',
          type: 'filter',
          label: 'A',
          state: {
            adminFilterScope: 'orders',
            adminFilters: {
              q: 'qq',
              status: 'shipped',
              sla: 'accept_overdue',
              fraud: 'flagged',
              tag: 'gift',
              fromDate: 'f',
              toDate: 't',
              includeTestOrders: false,
              limit: 75,
            },
          },
        },
      ]);
      component.applySavedView('a');
      expect(component.q).toBe('qq');
      expect(component.limit).toBe(75);
      expect(ordersApi.search).toHaveBeenCalled();
    });

    it('applySavedView uses default limit when invalid', () => {
      favorites.items.and.returnValue([
        {
          key: 'a',
          type: 'filter',
          label: 'A',
          state: { adminFilterScope: 'orders', adminFilters: { limit: 'bad' } },
        },
      ]);
      component.applySavedView('a');
      expect(component.limit).toBe(20);
    });

    it('isCurrentViewPinned proxies favorites', () => {
      favorites.isFavorite.and.returnValue(true);
      expect(component.isCurrentViewPinned()).toBeTrue();
    });

    it('toggleCurrentViewPin removes an existing favorite', () => {
      favorites.isFavorite.and.returnValue(true);
      component.selectedSavedViewKey = component['currentViewFavoriteKey']();
      component.toggleCurrentViewPin();
      expect(favorites.remove).toHaveBeenCalled();
      expect(component.selectedSavedViewKey).toBe('');
    });

    it('toggleCurrentViewPin requires a name when adding', () => {
      favorites.isFavorite.and.returnValue(false);
      spyOn(window, 'prompt').and.returnValue(null);
      component.toggleCurrentViewPin();
      expect(toast.error).toHaveBeenCalled();
      expect(favorites.add).not.toHaveBeenCalled();
    });

    it('toggleCurrentViewPin adds a named favorite', () => {
      favorites.isFavorite.and.returnValue(false);
      spyOn(window, 'prompt').and.returnValue('Saved View');
      component.toggleCurrentViewPin();
      expect(favorites.add).toHaveBeenCalled();
      expect(component.selectedSavedViewKey).toBeTruthy();
    });
  });

  describe('maybeApplyFiltersFromState', () => {
    it('ignores non-order scopes', () => {
      spyOnProperty(history, 'state', 'get').and.returnValue({ adminFilterScope: 'products' });
      component.ngOnInit();
      expect(component.q).toBe('');
    });

    it('ignores invalid filters payload', () => {
      spyOnProperty(history, 'state', 'get').and.returnValue({
        adminFilterScope: 'orders',
        adminFilters: 'nope',
      });
      component.ngOnInit();
      expect(component.q).toBe('');
    });

    it('applies filters from navigation state', () => {
      spyOnProperty(history, 'state', 'get').and.returnValue({
        adminFilterScope: 'orders',
        adminFilters: {
          q: 'state-q',
          status: 'paid',
          sla: 'any_overdue',
          fraud: 'queue',
          tag: 'vip',
          fromDate: 'x',
          toDate: 'y',
          includeTestOrders: false,
          limit: 42,
        },
      });
      component.ngOnInit();
      expect(component.q).toBe('state-q');
      expect(component.limit).toBe(42);
    });

    it('keeps current limit when state limit is invalid', () => {
      component.limit = 33;
      spyOnProperty(history, 'state', 'get').and.returnValue({
        adminFilterScope: 'orders',
        adminFilters: { q: 'z', limit: 'bad' },
      });
      component.ngOnInit();
      expect(component.limit).toBe(33);
    });

    it('applies defaults for an empty filters payload', () => {
      spyOnProperty(history, 'state', 'get').and.returnValue({
        adminFilterScope: 'orders',
        adminFilters: {},
      });
      component.ngOnInit();
      expect(component.q).toBe('');
      expect(component.status).toBe('all');
      expect(component.includeTestOrders).toBeTrue();
    });
  });

  describe('selection', () => {
    it('toggleSelected adds and removes ids unless busy', () => {
      component.toggleSelected('a', true);
      expect(component.selectedIds.has('a')).toBeTrue();
      component.toggleSelected('a', false);
      expect(component.selectedIds.has('a')).toBeFalse();
      component.bulkBusy = true;
      component.toggleSelected('b', true);
      expect(component.selectedIds.has('b')).toBeFalse();
    });

    it('toggleSelectAllOnPage selects and deselects current page', () => {
      component.orders.set([makeOrder({ id: 'a' }), makeOrder({ id: 'b' })]);
      component.toggleSelectAllOnPage(true);
      expect(component.selectedIds.size).toBe(2);
      component.toggleSelectAllOnPage(false);
      expect(component.selectedIds.size).toBe(0);
    });

    it('toggleSelectAllOnPage ignores busy and empty pages', () => {
      component.bulkBusy = true;
      component.orders.set([makeOrder({ id: 'a' })]);
      component.toggleSelectAllOnPage(true);
      expect(component.selectedIds.size).toBe(0);

      component.bulkBusy = false;
      component.orders.set([]);
      component.toggleSelectAllOnPage(true);
      expect(component.selectedIds.size).toBe(0);
    });

    it('allSelectedOnPage and someSelectedOnPage reflect selection', () => {
      component.orders.set([makeOrder({ id: 'a' }), makeOrder({ id: 'b' })]);
      expect(component.allSelectedOnPage()).toBeFalse();
      expect(component.someSelectedOnPage()).toBeFalse();
      component.selectedIds.add('a');
      expect(component.someSelectedOnPage()).toBeTrue();
      component.selectedIds.add('b');
      expect(component.allSelectedOnPage()).toBeTrue();
      expect(component.someSelectedOnPage()).toBeFalse();
    });

    it('someSelectedOnPage is false with no orders', () => {
      component.orders.set([]);
      expect(component.someSelectedOnPage()).toBeFalse();
    });
  });

  describe('applyBulkUpdate', () => {
    beforeEach(() => {
      component.orders.set([makeOrder({ id: 'a' }), makeOrder({ id: 'b' })]);
    });

    it('does nothing without a selection', () => {
      component.applyBulkUpdate();
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('requires a status or courier action', () => {
      component.selectedIds = new Set(['a']);
      component.bulkStatus = '';
      component.bulkCourier = '';
      component.applyBulkUpdate();
      expect(toast.error).toHaveBeenCalled();
    });

    it('clears courier when set to clear', () => {
      component.selectedIds = new Set(['a']);
      component.bulkCourier = 'clear';
      component.applyBulkUpdate();
      expect(ordersApi.update).toHaveBeenCalledWith('a', { courier: null });
      expect(toast.success).toHaveBeenCalled();
    });

    it('applies status and courier to all selected', () => {
      component.selectedIds = new Set(['a', 'b']);
      component.bulkStatus = 'shipped';
      component.bulkCourier = 'sameday';
      component.applyBulkUpdate();
      expect(ordersApi.update).toHaveBeenCalledTimes(2);
      expect(component.selectedIds.size).toBe(0);
    });

    it('reports partial failures and keeps failed ids selected', () => {
      ordersApi.update.and.callFake((id: string) =>
        id === 'a' ? of({} as any) : throwError(() => new Error('x')),
      );
      component.selectedIds = new Set(['a', 'b']);
      component.bulkStatus = 'shipped';
      component.applyBulkUpdate();
      expect(toast.error).toHaveBeenCalled();
      expect(component.selectedIds.has('b')).toBeTrue();
    });
  });

  describe('resendBulkEmails', () => {
    beforeEach(() => {
      component.selectedIds = new Set(['a', 'b']);
    });

    it('does nothing without a selection', () => {
      component.selectedIds = new Set();
      component.resendBulkEmails();
      expect(ordersApi.resendDeliveryEmail).not.toHaveBeenCalled();
    });

    it('requires an email kind', () => {
      component.bulkEmailKind = '';
      component.resendBulkEmails();
      expect(toast.error).toHaveBeenCalled();
    });

    it('aborts when the note prompt is cancelled', () => {
      component.bulkEmailKind = 'confirmation';
      spyOn(window, 'prompt').and.returnValue(null);
      component.resendBulkEmails();
      expect(ordersApi.resendOrderConfirmationEmail).not.toHaveBeenCalled();
    });

    it('sends confirmation emails with a trimmed note', () => {
      component.bulkEmailKind = 'confirmation';
      spyOn(window, 'prompt').and.returnValue('  hello  ');
      component.resendBulkEmails();
      expect(ordersApi.resendOrderConfirmationEmail).toHaveBeenCalledWith('a', 'hello');
      expect(toast.success).toHaveBeenCalled();
    });

    it('sends delivery emails and treats blank note as null', () => {
      component.bulkEmailKind = 'delivery';
      spyOn(window, 'prompt').and.returnValue('   ');
      component.resendBulkEmails();
      expect(ordersApi.resendDeliveryEmail).toHaveBeenCalledWith('a', null);
    });

    it('reports partial email failures', () => {
      component.bulkEmailKind = 'delivery';
      spyOn(window, 'prompt').and.returnValue('note');
      ordersApi.resendDeliveryEmail.and.callFake((id: string) =>
        id === 'a' ? of({} as any) : throwError(() => new Error('x')),
      );
      component.resendBulkEmails();
      expect(toast.error).toHaveBeenCalled();
      expect(component.selectedIds.has('b')).toBeTrue();
    });
  });

  describe('document downloads', () => {
    beforeEach(() => {
      component.selectedIds = new Set(['a']);
      spyOn(URL, 'createObjectURL').and.returnValue('blob:url');
      spyOn(URL, 'revokeObjectURL');
      spyOn(HTMLAnchorElement.prototype, 'click');
    });

    it('downloadBatchPackingSlips success and error', () => {
      component.downloadBatchPackingSlips();
      expect(toast.success).toHaveBeenCalled();
      expect(component.bulkBusy).toBeFalse();

      ordersApi.downloadBatchPackingSlips.and.returnValue(throwError(() => new Error('x')));
      component.downloadBatchPackingSlips();
      expect(toast.error).toHaveBeenCalled();
    });

    it('downloadBatchPackingSlips needs a selection', () => {
      component.selectedIds = new Set();
      component.downloadBatchPackingSlips();
      expect(ordersApi.downloadBatchPackingSlips).not.toHaveBeenCalled();
    });

    it('downloadPickListCsv success and error', () => {
      component.downloadPickListCsv();
      expect(toast.success).toHaveBeenCalled();
      ordersApi.downloadPickListCsv.and.returnValue(throwError(() => new Error('x')));
      component.downloadPickListCsv();
      expect(toast.error).toHaveBeenCalled();
    });

    it('downloadPickListCsv needs a selection', () => {
      component.selectedIds = new Set();
      component.downloadPickListCsv();
      expect(ordersApi.downloadPickListCsv).not.toHaveBeenCalled();
    });

    it('downloadPickListPdf success and error', () => {
      component.downloadPickListPdf();
      expect(toast.success).toHaveBeenCalled();
      ordersApi.downloadPickListPdf.and.returnValue(throwError(() => new Error('x')));
      component.downloadPickListPdf();
      expect(toast.error).toHaveBeenCalled();
    });

    it('downloadPickListPdf needs a selection', () => {
      component.selectedIds = new Set();
      component.downloadPickListPdf();
      expect(ordersApi.downloadPickListPdf).not.toHaveBeenCalled();
    });
  });

  describe('shipping labels modal', () => {
    beforeEach(() => {
      component.orders.set([makeOrder({ id: 'order-aaaa1111', reference_code: 'REF-AAA' })]);
      component.selectedIds = new Set(['order-aaaa1111']);
    });

    it('openShippingLabelsModal needs a selection', () => {
      component.selectedIds = new Set();
      component.openShippingLabelsModal();
      expect(component.shippingLabelsModalOpen()).toBeFalse();
    });

    it('opens and builds order options', () => {
      component.openShippingLabelsModal();
      expect(component.shippingLabelsModalOpen()).toBeTrue();
      expect(component.shippingLabelsOrderOptions.length).toBe(1);
      expect(component.shippingLabelsOrderOptions[0].label).toContain('REF-AAA');
    });

    it('builds a short-id-only label when reference is missing', () => {
      component.orders.set([makeOrder({ id: 'order-bbbb2222', reference_code: '' })]);
      component.selectedIds = new Set(['order-bbbb2222']);
      component.openShippingLabelsModal();
      expect(component.shippingLabelsOrderOptions[0].label).toBe('order-bb');
    });

    it('closeShippingLabelsModal respects busy state', () => {
      component.openShippingLabelsModal();
      component.shippingLabelsBusy = true;
      component.closeShippingLabelsModal();
      expect(component.shippingLabelsModalOpen()).toBeTrue();
      component.shippingLabelsBusy = false;
      component.closeShippingLabelsModal();
      expect(component.shippingLabelsModalOpen()).toBeFalse();
    });

    it('onShippingLabelsSelected ignores empty file lists', () => {
      component.onShippingLabelsSelected({ target: { files: null } } as any);
      expect(component.shippingLabelsUploads.length).toBe(0);
      component.onShippingLabelsSelected({ target: { files: [] } } as any);
      expect(component.shippingLabelsUploads.length).toBe(0);
    });

    it('onShippingLabelsSelected auto-assigns by reference', () => {
      component.openShippingLabelsModal();
      const file = new File(['x'], 'label-ref-aaa.pdf', { type: 'application/pdf' });
      const input = { files: [file], value: 'something' } as any;
      component.onShippingLabelsSelected({ target: input } as any);
      expect(component.shippingLabelsUploads.length).toBe(1);
      expect(component.shippingLabelsUploads[0].assignedOrderId).toBe('order-aaaa1111');
      expect(input.value).toBe('');
    });

    it('autoAssign matches by short id and returns null otherwise', () => {
      component.openShippingLabelsModal();
      const byShort = new File(['x'], 'doc-order-aa.pdf');
      component.onShippingLabelsSelected({ target: { files: [byShort] } } as any);
      expect(component.shippingLabelsUploads[0].assignedOrderId).toBe('order-aaaa1111');

      component.shippingLabelsUploads = [];
      const noMatch = new File(['x'], 'random.pdf');
      component.onShippingLabelsSelected({ target: { files: [noMatch] } } as any);
      expect(component.shippingLabelsUploads[0].assignedOrderId).toBeNull();
    });

    it('uploadAllShippingLabels ignores busy and empty queues', () => {
      component.shippingLabelsBusy = true;
      component.uploadAllShippingLabels();
      expect(ordersApi.uploadShippingLabel).not.toHaveBeenCalled();
      component.shippingLabelsBusy = false;
      component.shippingLabelsUploads = [];
      component.uploadAllShippingLabels();
      expect(ordersApi.uploadShippingLabel).not.toHaveBeenCalled();
    });

    it('uploadAllShippingLabels skips when all already succeeded', () => {
      component.shippingLabelsUploads = [
        { file: new File(['x'], 'a.pdf'), assignedOrderId: 'order-aaaa1111', status: 'success' },
      ];
      component.uploadAllShippingLabels();
      expect(ordersApi.uploadShippingLabel).not.toHaveBeenCalled();
    });

    it('uploadAllShippingLabels flags missing order assignment', () => {
      component.shippingLabelsUploads = [
        { file: new File(['x'], 'a.pdf'), assignedOrderId: null, status: 'pending' },
      ];
      component.uploadAllShippingLabels();
      expect(component.shippingLabelsUploads[0].status).toBe('error');
      expect(toast.error).toHaveBeenCalled();
    });

    it('uploadAllShippingLabels uploads successfully', () => {
      component.shippingLabelsUploads = [
        { file: new File(['x'], 'a.pdf'), assignedOrderId: 'order-aaaa1111', status: 'pending' },
      ];
      component.uploadAllShippingLabels();
      expect(component.shippingLabelsUploads[0].status).toBe('success');
      expect(toast.success).toHaveBeenCalled();
    });

    it('uploadAllShippingLabels reports upload failures with request id', () => {
      ordersApi.uploadShippingLabel.and.returnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 500,
              headers: new HttpHeaders({ 'x-request-id': 'req-1' }),
            }),
        ),
      );
      component.shippingLabelsUploads = [
        { file: new File(['x'], 'a.pdf'), assignedOrderId: 'order-aaaa1111', status: 'pending' },
      ];
      component.uploadAllShippingLabels();
      expect(component.shippingLabelsUploads[0].status).toBe('error');
      expect(toast.error).toHaveBeenCalled();
    });

    it('retryShippingLabelUpload guards missing item and busy state', () => {
      component.retryShippingLabelUpload(99);
      expect(ordersApi.uploadShippingLabel).not.toHaveBeenCalled();
      component.shippingLabelsUploads = [
        { file: new File(['x'], 'a.pdf'), assignedOrderId: 'order-aaaa1111', status: 'error' },
      ];
      component.shippingLabelsBusy = true;
      component.retryShippingLabelUpload(0);
      expect(ordersApi.uploadShippingLabel).not.toHaveBeenCalled();
    });

    it('retryShippingLabelUpload flags missing order', () => {
      component.shippingLabelsUploads = [
        { file: new File(['x'], 'a.pdf'), assignedOrderId: null, status: 'error' },
      ];
      component.retryShippingLabelUpload(0);
      expect(component.shippingLabelsUploads[0].status).toBe('error');
      expect(ordersApi.uploadShippingLabel).not.toHaveBeenCalled();
    });

    it('retryShippingLabelUpload succeeds', () => {
      component.shippingLabelsUploads = [
        { file: new File(['x'], 'a.pdf'), assignedOrderId: 'order-aaaa1111', status: 'error' },
      ];
      component.retryShippingLabelUpload(0);
      expect(component.shippingLabelsUploads[0].status).toBe('success');
      expect(toast.success).toHaveBeenCalled();
    });

    it('retryShippingLabelUpload reports failure with request id', () => {
      ordersApi.uploadShippingLabel.and.returnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 500,
              headers: new HttpHeaders({ 'x-request-id': 'req-2' }),
            }),
        ),
      );
      component.shippingLabelsUploads = [
        { file: new File(['x'], 'a.pdf'), assignedOrderId: 'order-aaaa1111', status: 'error' },
      ];
      component.retryShippingLabelUpload(0);
      expect(component.shippingLabelsUploads[0].status).toBe('error');
      expect(toast.error).toHaveBeenCalled();
    });

    it('retryShippingLabelUpload reports failure without request id', () => {
      ordersApi.uploadShippingLabel.and.returnValue(throwError(() => ({})));
      component.shippingLabelsUploads = [
        { file: new File(['x'], 'a.pdf'), assignedOrderId: 'order-aaaa1111', status: 'error' },
      ];
      component.retryShippingLabelUpload(0);
      expect(component.shippingLabelsUploads[0].status).toBe('error');
    });

    it('autoAssignShippingLabel returns null for a file without a name', () => {
      component.openShippingLabelsModal();
      expect(component['autoAssignShippingLabel']({} as any)).toBeNull();
    });

    it('buildShippingLabelsOrderOptions handles ids without a loaded order', () => {
      component.orders.set([]);
      component.selectedIds = new Set(['order-cccc3333']);
      component.openShippingLabelsModal();
      expect(component.shippingLabelsOrderOptions[0].label).toBe('order-cc');
      expect(component.shippingLabelsOrderOptions[0].ref).toBe('');
    });

    it('updateShippingLabelUpload ignores out-of-range indexes', () => {
      component.shippingLabelsUploads = [];
      component['updateShippingLabelUpload'](5, { status: 'success' });
      expect(component.shippingLabelsUploads.length).toBe(0);
    });

    it('downloadSelectedShippingLabelsZip guards selection and busy', () => {
      component.selectedIds = new Set();
      component.downloadSelectedShippingLabelsZip();
      expect(ordersApi.downloadBatchShippingLabelsZip).not.toHaveBeenCalled();
      component.selectedIds = new Set(['order-aaaa1111']);
      component.shippingLabelsBusy = true;
      component.downloadSelectedShippingLabelsZip();
      expect(ordersApi.downloadBatchShippingLabelsZip).not.toHaveBeenCalled();
    });

    it('downloadSelectedShippingLabelsZip succeeds', () => {
      spyOn(URL, 'createObjectURL').and.returnValue('blob:url');
      spyOn(URL, 'revokeObjectURL');
      spyOn(HTMLAnchorElement.prototype, 'click');
      component.downloadSelectedShippingLabelsZip();
      expect(toast.success).toHaveBeenCalled();
      expect(component.shippingLabelsBusy).toBeFalse();
    });

    it('downloadSelectedShippingLabelsZip reports missing labels', () => {
      ordersApi.downloadBatchShippingLabelsZip.and.returnValue(
        throwError(() => ({ error: { detail: { missing_shipping_label_order_ids: ['x', 'y'] } } })),
      );
      component.downloadSelectedShippingLabelsZip();
      expect(toast.error).toHaveBeenCalledWith(
        'adminUi.orders.shippingLabelsModal.errors.missingLabels',
      );
    });

    it('downloadSelectedShippingLabelsZip reports generic failure', () => {
      ordersApi.downloadBatchShippingLabelsZip.and.returnValue(throwError(() => ({ error: {} })));
      component.downloadSelectedShippingLabelsZip();
      expect(toast.error).toHaveBeenCalledWith(
        'adminUi.orders.shippingLabelsModal.errors.zipFailed',
      );
    });

    it('exposes status label keys and pill classes', () => {
      expect(component.shippingLabelStatusLabelKey('success')).toContain('success');
      expect(component.shippingLabelStatusPillClass('success')).toContain('emerald');
      expect(component.shippingLabelStatusPillClass('uploading')).toContain('indigo');
      expect(component.shippingLabelStatusPillClass('error')).toContain('rose');
      expect(component.shippingLabelStatusPillClass('pending')).toContain('slate');
    });
  });

  describe('navigation and paging', () => {
    it('goToPage updates the page and reloads', () => {
      component.goToPage(3);
      expect(component.page).toBe(3);
      expect(ordersApi.search).toHaveBeenCalled();
    });

    it('trackOrderId returns the order id', () => {
      expect(component.trackOrderId(0, makeOrder({ id: 'z' }))).toBe('z');
    });

    it('open builds query params from active filters', () => {
      component.q = ' search ';
      component.status = 'paid';
      component.sla = 'any_overdue';
      component.fraud = 'queue';
      component.tag = ' vip ';
      component.includeTestOrders = false;
      component.fromDate = '2026-01-01';
      component.toDate = '2026-02-01';
      component.open('order-xyz');
      const [route, extras] = router.navigate.calls.mostRecent().args;
      expect(route).toEqual(['/admin/orders', 'order-xyz']);
      expect(extras.queryParams.nav_q).toBe('search');
      expect(extras.queryParams.nav_status).toBe('paid');
      expect(extras.queryParams.nav_include_test).toBe(0);
      expect(extras.queryParams.nav_from).toBe('2026-01-01T00:00:00Z');
    });

    it('open omits optional params when filters are default', () => {
      component.open('order-xyz');
      const extras = router.navigate.calls.mostRecent().args[1];
      expect(extras.queryParams.nav_q).toBeUndefined();
      expect(extras.queryParams.nav_status).toBeUndefined();
    });

    it('openExports navigates to the exports page', () => {
      component.openExports();
      expect(router.navigate).toHaveBeenCalledWith(['/admin/orders/exports']);
    });
  });

  describe('export modal', () => {
    it('opens and closes the export modal', () => {
      component.openExportModal();
      expect(component.exportModalOpen()).toBeTrue();
      component.closeExportModal();
      expect(component.exportModalOpen()).toBeFalse();
    });

    it('toggleExportColumn ignores unknown columns and toggles known ones', () => {
      component.toggleExportColumn('unknown-column', true);
      expect(component.exportColumns['unknown-column']).toBeUndefined();
      component.toggleExportColumn('status', true);
      expect(component.exportColumns['status']).toBeTrue();
      expect(component.selectedExportTemplateId).toBe('');
    });

    it('applyExportTemplate clears columns when empty selection', () => {
      component.applyExportTemplate('');
      expect(component.selectedExportTemplateId).toBe('');
    });

    it('applyExportTemplate ignores unknown template id', () => {
      component.exportTemplates = [];
      component.applyExportTemplate('missing');
      expect(component.selectedExportTemplateId).toBe('missing');
    });

    it('applyExportTemplate applies template columns', () => {
      component.exportTemplates = [
        { id: 't1', name: 'T', createdAt: 'now', columns: ['status', 'currency', 'bogus'] },
      ];
      component.applyExportTemplate('t1');
      expect(component.exportColumns['status']).toBeTrue();
      expect(component.exportColumns['currency']).toBeTrue();
      expect(component.exportColumns['id']).toBeFalse();
    });

    it('applyExportTemplate tolerates a template without columns', () => {
      component.exportTemplates = [
        { id: 't9', name: 'NoCols', createdAt: 'now', columns: undefined as any },
      ];
      component.applyExportTemplate('t9');
      expect(component.selectedExportTemplateId).toBe('t9');
      expect(component.exportColumns['status']).toBeFalse();
    });

    it('downloadExport requires at least one column', () => {
      component.exportColumns = {};
      component.downloadExport();
      expect(toast.error).toHaveBeenCalled();
      expect(ordersApi.downloadExport).not.toHaveBeenCalled();
    });

    it('downloadExport downloads and closes modal on success', () => {
      spyOn(URL, 'createObjectURL').and.returnValue('blob:url');
      spyOn(URL, 'revokeObjectURL');
      spyOn(HTMLAnchorElement.prototype, 'click');
      component.exportColumns = { status: true };
      component.exportModalOpen.set(true);
      component.downloadExport();
      expect(ordersApi.downloadExport).toHaveBeenCalledWith(['status']);
      expect(component.exportModalOpen()).toBeFalse();
    });

    it('downloadExport reports errors', () => {
      ordersApi.downloadExport.and.returnValue(throwError(() => new Error('x')));
      component.exportColumns = { status: true };
      component.downloadExport();
      expect(toast.error).toHaveBeenCalled();
    });

    it('saveExportTemplate requires columns', () => {
      component.exportColumns = {};
      component.saveExportTemplate();
      expect(toast.error).toHaveBeenCalled();
    });

    it('saveExportTemplate requires a name', () => {
      component.exportColumns = { status: true };
      spyOn(window, 'prompt').and.returnValue(null);
      component.saveExportTemplate();
      expect(toast.error).toHaveBeenCalled();
    });

    it('saveExportTemplate stores a template (crypto id)', () => {
      component.exportColumns = { status: true };
      spyOn(window, 'prompt').and.returnValue('Template A');
      component.saveExportTemplate();
      expect(component.exportTemplates.length).toBe(1);
      expect(toast.success).toHaveBeenCalled();
    });

    it('saveExportTemplate falls back to generated id without crypto.randomUUID', () => {
      component.exportColumns = { status: true };
      spyOn(window, 'prompt').and.returnValue('Template B');
      withoutCryptoRandomUUID(() => component.saveExportTemplate());
      expect(component.exportTemplates[0].id).toContain('-');
    });

    it('deleteExportTemplate ignores unknown and respects cancel', () => {
      component.deleteExportTemplate();
      component.exportTemplates = [{ id: 't1', name: 'T', createdAt: 'now', columns: ['status'] }];
      component.selectedExportTemplateId = 't1';
      spyOn(window, 'confirm').and.returnValue(false);
      component.deleteExportTemplate();
      expect(component.exportTemplates.length).toBe(1);
    });

    it('deleteExportTemplate removes a confirmed template', () => {
      component.exportTemplates = [{ id: 't1', name: 'T', createdAt: 'now', columns: ['status'] }];
      component.selectedExportTemplateId = 't1';
      spyOn(window, 'confirm').and.returnValue(true);
      component.deleteExportTemplate();
      expect(component.exportTemplates.length).toBe(0);
      expect(toast.success).toHaveBeenCalled();
    });
  });

  describe('loadExportState', () => {
    it('applies defaults when no stored state', () => {
      component.ngOnInit();
      expect(component.exportColumns['id']).toBeTrue();
      expect(component.exportColumns['payment_method']).toBeFalse();
    });

    it('hydrates templates and columns from storage', () => {
      localStorage.setItem(
        'admin.orders.export.v1:user-1',
        JSON.stringify({
          templates: [
            { id: 't1', name: 'T', createdAt: 'now', columns: ['status'] },
            { id: 5, name: 'bad' },
            { id: 't2', name: 'NoCols' },
          ],
          selectedTemplateId: 't1',
          columns: ['currency'],
        }),
      );
      component.ngOnInit();
      expect(component.exportTemplates.length).toBe(2);
      // selected template columns take precedence over stored columns
      expect(component.exportColumns['status']).toBeTrue();
      expect(component.exportColumns['currency']).toBeFalse();
    });

    it('uses stored columns when selected template has none', () => {
      localStorage.setItem(
        'admin.orders.export.v1:user-1',
        JSON.stringify({
          templates: [{ id: 't2', name: 'NoCols', columns: [] }],
          selectedTemplateId: 't2',
          columns: ['currency', '  ', 'not-a-col'],
        }),
      );
      component.ngOnInit();
      expect(component.exportColumns['currency']).toBeTrue();
    });

    it('falls back to default columns when none are valid', () => {
      localStorage.setItem(
        'admin.orders.export.v1:user-1',
        JSON.stringify({ templates: [], selectedTemplateId: '', columns: ['nope'] }),
      );
      component.ngOnInit();
      expect(component.exportColumns['id']).toBeTrue();
    });

    it('handles non-array templates/columns and missing selectedTemplateId', () => {
      localStorage.setItem(
        'admin.orders.export.v1:user-1',
        JSON.stringify({ templates: 'x', selectedTemplateId: 5, columns: 'y' }),
      );
      component.ngOnInit();
      expect(component.exportTemplates).toEqual([]);
      expect(component.selectedExportTemplateId).toBe('');
    });

    it('falls back to defaults when stored state is invalid json', () => {
      localStorage.setItem('admin.orders.export.v1:user-1', 'not-json');
      component.ngOnInit();
      expect(component.exportColumns['id']).toBeTrue();
    });

    it('persistExportState swallows storage errors', () => {
      spyOn(localStorage, 'setItem').and.throwError('boom');
      expect(() => component.toggleExportColumn('status', true)).not.toThrow();
    });
  });

  describe('labels and helpers', () => {
    it('customerLabel handles all combinations', () => {
      expect(
        component.customerLabel(makeOrder({ customer_email: 'e', customer_username: 'u' })),
      ).toBe('e (u)');
      expect(
        component.customerLabel(makeOrder({ customer_email: 'e', customer_username: '' })),
      ).toBe('e');
      expect(
        component.customerLabel(makeOrder({ customer_email: '', customer_username: 'u' })),
      ).toBe('u');
      expect(
        component.customerLabel(makeOrder({ customer_email: '', customer_username: '' })),
      ).toBe('adminUi.orders.guest');
      expect(
        component.customerLabel(makeOrder({ customer_email: null, customer_username: null })),
      ).toBe('adminUi.orders.guest');
    });

    it('tagLabel returns raw tag when untranslated and translation otherwise', () => {
      expect(component.tagLabel('vip')).toBe('vip');
      translate.instant.and.callFake((key: string) =>
        key === 'adminUi.orders.tags.vip' ? 'VIP' : key,
      );
      expect(component.tagLabel('vip')).toBe('VIP');
    });

    it('tagChipColorClass returns a class string', () => {
      expect(component.tagChipColorClass('vip')).toContain('violet');
    });

    it('statusPillClass delegates to the helper', () => {
      expect(typeof component.statusPillClass('paid')).toBe('string');
    });
  });

  describe('tag manager', () => {
    it('openTagManager resets state and reloads', () => {
      ordersApi.listOrderTagStats.and.returnValue(of([{ tag: 'vip', count: 3 }]));
      component.openTagManager();
      expect(component.tagManagerOpen()).toBeTrue();
      expect(component.tagManagerRows().length).toBe(1);
      expect(component.tagManagerLoading()).toBeFalse();
    });

    it('reloadTagManager handles load errors', () => {
      ordersApi.listOrderTagStats.and.returnValue(throwError(() => new Error('x')));
      component.reloadTagManager();
      expect(component.tagManagerError()).toBe('adminUi.orders.tags.errors.load');
      expect(component.tagManagerLoading()).toBeFalse();
    });

    it('reloadTagManager defaults to empty rows when null returned', () => {
      ordersApi.listOrderTagStats.and.returnValue(of(null as any));
      component.reloadTagManager();
      expect(component.tagManagerRows()).toEqual([]);
    });

    it('closeTagManager clears state', () => {
      component.tagManagerOpen.set(true);
      component.tagManagerRows.set([{ tag: 'vip', count: 1 }]);
      component.tagManagerQuery = 'x';
      component.closeTagManager();
      expect(component.tagManagerOpen()).toBeFalse();
      expect(component.tagManagerRows()).toEqual([]);
      expect(component.tagManagerQuery).toBe('');
    });

    it('filteredTagManagerRows filters by tag or label', () => {
      component.tagManagerRows.set([
        { tag: 'vip', count: 1 },
        { tag: 'gift', count: 2 },
        { tag: '', count: 0 } as any,
      ]);
      component.tagManagerQuery = '';
      expect(component.filteredTagManagerRows().length).toBe(3);
      component.tagManagerQuery = 'vip';
      expect(component.filteredTagManagerRows().map((r) => r.tag)).toEqual(['vip']);
    });

    it('tagColorValue returns a palette color', () => {
      expect(component.tagColorValue('vip')).toBe('violet');
    });

    it('setTagColor ignores invalid tags or colors and stores valid ones', () => {
      component.setTagColor('', 'rose');
      component.setTagColor('vip', 'not-a-color');
      component.setTagColor('vip', '');
      expect(localStorage.getItem(TAG_COLOR_STORAGE_KEY)).toBeNull();
      component.setTagColor('vip', 'rose');
      expect(component.tagColorValue('vip')).toBe('rose');
    });

    it('resetTagColor ignores invalid tags and clears overrides', () => {
      component.setTagColor('vip', 'rose');
      component.resetTagColor('');
      expect(component.tagColorValue('vip')).toBe('rose');
      component.resetTagColor('vip');
      expect(component.tagColorValue('vip')).toBe('violet');
    });
  });

  describe('applyBulkTags', () => {
    beforeEach(() => {
      component.selectedIds = new Set(['a', 'b']);
    });

    it('does nothing without a selection', () => {
      component.selectedIds = new Set();
      component.applyBulkTags();
      expect(ordersApi.addOrderTag).not.toHaveBeenCalled();
    });

    it('requires at least one tag action', () => {
      component.bulkTagAdd = '   ';
      component.bulkTagRemove = '';
      component.applyBulkTags();
      expect(toast.error).toHaveBeenCalled();
    });

    it('adds and removes tags for all selected orders', () => {
      component.bulkTagAdd = 'vip';
      component.bulkTagRemove = 'old';
      component.applyBulkTags();
      expect(ordersApi.removeOrderTag).toHaveBeenCalled();
      expect(ordersApi.addOrderTag).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalled();
      expect(component.selectedIds.size).toBe(0);
    });

    it('reports partial failures and keeps failed ids', () => {
      component.bulkTagAdd = 'vip';
      ordersApi.addOrderTag.and.callFake((id: string) =>
        id === 'a' ? of({} as any) : throwError(() => new Error('x')),
      );
      component.applyBulkTags();
      expect(toast.error).toHaveBeenCalled();
      expect(component.selectedIds.has('b')).toBeTrue();
    });

    it('counts a removal failure as a failed order', () => {
      component.bulkTagRemove = 'old';
      ordersApi.removeOrderTag.and.returnValue(throwError(() => new Error('x')));
      component.applyBulkTags();
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('renameTag', () => {
    it('ignores rename while busy', () => {
      component.tagRenameBusy = true;
      component.renameTag();
      expect(ordersApi.renameOrderTag).not.toHaveBeenCalled();
    });

    it('requires both from and to tags', () => {
      component.tagRenameFrom = '';
      component.tagRenameTo = 'new';
      component.renameTag();
      expect(component.tagRenameError).toBe('adminUi.orders.tags.errors.renameRequired');
    });

    it('requires a destination tag', () => {
      component.tagRenameFrom = 'old';
      component.tagRenameTo = '';
      component.renameTag();
      expect(component.tagRenameError).toBe('adminUi.orders.tags.errors.renameRequired');
    });

    it('aborts when not confirmed', () => {
      component.tagRenameFrom = 'old';
      component.tagRenameTo = 'new';
      spyOn(window, 'confirm').and.returnValue(false);
      component.renameTag();
      expect(ordersApi.renameOrderTag).not.toHaveBeenCalled();
    });

    it('renames a tag, migrating color override and active tag filter', () => {
      component.setTagColor('old', 'rose');
      component.tag = 'old';
      component.tagRenameFrom = 'old';
      component.tagRenameTo = 'new';
      spyOn(window, 'confirm').and.returnValue(true);
      ordersApi.renameOrderTag.and.returnValue(
        of({ from_tag: 'old', to_tag: 'new', updated: 2, merged: 0, total: 2 }),
      );
      component.renameTag();
      expect(component.tag).toBe('new');
      expect(component.tagColorValue('new')).toBe('rose');
      expect(component.tagRenameBusy).toBeFalse();
      expect(toast.success).toHaveBeenCalled();
    });

    it('keeps existing destination color when present', () => {
      component.setTagColor('old', 'rose');
      component.setTagColor('new', 'teal');
      component.tagRenameFrom = 'old';
      component.tagRenameTo = 'new';
      spyOn(window, 'confirm').and.returnValue(true);
      ordersApi.renameOrderTag.and.returnValue(
        of({ from_tag: 'old', to_tag: 'new', updated: 1, merged: 1, total: 2 }),
      );
      component.renameTag();
      expect(component.tagColorValue('new')).toBe('teal');
    });

    it('falls back to source/dest tags when response omits them', () => {
      component.tagRenameFrom = 'old';
      component.tagRenameTo = 'new';
      spyOn(window, 'confirm').and.returnValue(true);
      ordersApi.renameOrderTag.and.returnValue(
        of({ from_tag: '', to_tag: '', updated: 0, merged: 0, total: 0 }),
      );
      component.renameTag();
      expect(toast.success).toHaveBeenCalled();
    });

    it('shows a detailed error message on failure', () => {
      component.tagRenameFrom = 'old';
      component.tagRenameTo = 'new';
      spyOn(window, 'confirm').and.returnValue(true);
      ordersApi.renameOrderTag.and.returnValue(
        throwError(() => ({ error: { detail: 'Already exists' } })),
      );
      component.renameTag();
      expect(component.tagRenameError).toBe('Already exists');
      // The error callback does not fire `complete`, so the busy flag remains set.
      expect(component.tagRenameBusy).toBeTrue();
    });

    it('falls back to a generic error message', () => {
      component.tagRenameFrom = 'old';
      component.tagRenameTo = 'new';
      spyOn(window, 'confirm').and.returnValue(true);
      ordersApi.renameOrderTag.and.returnValue(throwError(() => ({})));
      component.renameTag();
      expect(component.tagRenameError).toBe('adminUi.orders.tags.errors.rename');
    });
  });

  describe('refreshTagOptions', () => {
    it('merges and sorts loaded tags', () => {
      ordersApi.listOrderTags.and.returnValue(of(['zeta', 'alpha']));
      component.ngOnInit();
      const opts = component.tagOptions();
      expect(opts).toContain('zeta');
      expect(opts).toContain('alpha');
      expect(opts.indexOf('alpha')).toBeLessThan(opts.indexOf('zeta'));
    });

    it('ignores tag option load errors', () => {
      ordersApi.listOrderTags.and.returnValue(throwError(() => new Error('x')));
      expect(() => component.ngOnInit()).not.toThrow();
    });
  });

  describe('slaBadge', () => {
    it('returns null when kind or due date is missing', () => {
      expect(component.slaBadge(makeOrder({ sla_kind: null, sla_due_at: null }))).toBeNull();
    });

    it('returns null for unparseable due dates', () => {
      expect(
        component.slaBadge(makeOrder({ sla_kind: 'accept', sla_due_at: 'not-a-date' })),
      ).toBeNull();
    });

    it('returns null for unknown sla kinds', () => {
      expect(
        component.slaBadge(makeOrder({ sla_kind: 'mystery', sla_due_at: '2026-01-01T00:00:00Z' })),
      ).toBeNull();
    });

    it('returns an overdue badge for accept kind', () => {
      const badge = component.slaBadge(
        makeOrder({ sla_kind: 'accept', sla_due_at: '2000-01-01T00:00:00Z' }),
      );
      expect(badge?.className).toContain('rose');
    });

    it('returns a due-soon badge for ship kind', () => {
      const due = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const badge = component.slaBadge(makeOrder({ sla_kind: 'ship', sla_due_at: due }));
      expect(badge?.className).toContain('amber');
    });

    it('returns null when due far in the future', () => {
      const due = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      expect(component.slaBadge(makeOrder({ sla_kind: 'accept', sla_due_at: due }))).toBeNull();
    });
  });

  describe('fraudBadge', () => {
    it('returns null without a severity', () => {
      expect(component.fraudBadge(makeOrder({ fraud_severity: null }))).toBeNull();
    });

    it('formats high/medium/low/other severities', () => {
      expect(component.fraudBadge(makeOrder({ fraud_severity: 'high' }))?.className).toContain(
        'rose',
      );
      expect(component.fraudBadge(makeOrder({ fraud_severity: 'medium' }))?.className).toContain(
        'amber',
      );
      expect(component.fraudBadge(makeOrder({ fraud_severity: 'low' }))?.className).toContain(
        'sky',
      );
      expect(component.fraudBadge(makeOrder({ fraud_severity: 'unknown' }))?.className).toContain(
        'slate',
      );
    });

    it('uses translated severity when available', () => {
      translate.instant.and.callFake((key: string) =>
        key === 'adminUi.orders.fraudSignals.severity.high' ? 'High' : key,
      );
      const badge = component.fraudBadge(makeOrder({ fraud_severity: 'high' }));
      expect(badge).not.toBeNull();
    });
  });

  describe('formatDurationShort (via slaBadge)', () => {
    it('formats minutes, hours and days', () => {
      const mins = component.slaBadge(
        makeOrder({
          sla_kind: 'accept',
          sla_due_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        }),
      );
      expect(mins?.label).toBeDefined();
      const hours = component.slaBadge(
        makeOrder({
          sla_kind: 'accept',
          sla_due_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        }),
      );
      expect(hours?.label).toBeDefined();
      const days = component.slaBadge(
        makeOrder({
          sla_kind: 'accept',
          sla_due_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      );
      expect(days?.label).toBeDefined();
    });
  });

  describe('load (table)', () => {
    it('builds search params from all active filters and applies the result', () => {
      ordersApi.search.and.returnValue(of(listResponse([makeOrder()])));
      component.q = ' x ';
      component.status = 'paid';
      component.sla = 'any_overdue';
      component.fraud = 'queue';
      component.tag = ' vip ';
      component.includeTestOrders = false;
      component.fromDate = '2026-01-01';
      component.toDate = '2026-02-01';
      component.applyFilters();
      const params = ordersApi.search.calls.mostRecent().args[0];
      expect(params.q).toBe('x');
      expect(params.status).toBe('paid');
      expect(params.include_test).toBeFalse();
      expect(params.from).toBe('2026-01-01T00:00:00Z');
      expect(component.orders().length).toBe(1);
    });

    it('records load errors with a request id', () => {
      ordersApi.search.and.returnValue(
        throwError(() => ({
          headers: { get: (h: string) => (h === 'x-request-id' ? 'r-1' : null) },
        })),
      );
      component.applyFilters();
      expect(component.error()).toBe('adminUi.orders.errors.load');
      expect(component.loading()).toBeFalse();
    });

    it('retryLoad triggers a reload', () => {
      component.retryLoad();
      expect(ordersApi.search).toHaveBeenCalled();
    });
  });

  describe('loadKanban', () => {
    it('aggregates per-status results and totals', () => {
      component.viewMode.set('kanban');
      component.status = 'shipped';
      ordersApi.search.and.returnValue(of(listResponse([makeOrder({ status: 'shipped' })])));
      component.retryLoad();
      expect(component.kanbanItemsByStatus()['shipped'].length).toBe(1);
      expect(component.kanbanTotalsByStatus()['shipped']).toBe(1);
      expect(component.loading()).toBeFalse();
    });

    it('uses item length when meta totals are missing', () => {
      component.viewMode.set('kanban');
      component.status = 'shipped';
      ordersApi.search.and.returnValue(of({ items: [makeOrder()], meta: null } as any));
      component.retryLoad();
      expect(component.kanbanTotalsByStatus()['shipped']).toBe(1);
    });

    it('captures the first column error', () => {
      component.viewMode.set('kanban');
      component.status = 'shipped';
      ordersApi.search.and.returnValue(
        throwError(() => ({
          headers: { get: (h: string) => (h === 'x-request-id' ? 'r-2' : null) },
        })),
      );
      component.retryLoad();
      expect(component.kanbanItemsByStatus()['shipped']).toEqual([]);
      expect(component.error()).toBe('adminUi.orders.errors.load');
    });

    it('defaults to empty items and zero totals when the response omits items', () => {
      component.viewMode.set('kanban');
      component.status = 'shipped';
      ordersApi.search.and.returnValue(of({ items: null, meta: null } as any));
      component.retryLoad();
      expect(component.kanbanItemsByStatus()['shipped']).toEqual([]);
      expect(component.kanbanTotalsByStatus()['shipped']).toBe(0);
    });

    it('handles a synchronous failure of the search stream', () => {
      component.viewMode.set('kanban');
      component.status = 'shipped';
      ordersApi.search.and.callFake(() => {
        throw new Error('sync-boom');
      });
      component.retryLoad();
      expect(component.error()).toBe('adminUi.orders.errors.load');
      expect(component.loading()).toBeFalse();
    });

    it('includes optional kanban filters in the search params', () => {
      component.viewMode.set('kanban');
      component.status = 'shipped';
      component.q = ' kq ';
      component.tag = ' kt ';
      component.sla = 'ship_overdue';
      component.fraud = 'approved';
      component.includeTestOrders = false;
      component.fromDate = '2026-03-01';
      component.toDate = '2026-04-01';
      ordersApi.search.and.returnValue(of(listResponse([])));
      component.retryLoad();
      const params = ordersApi.search.calls.mostRecent().args[0];
      expect(params.q).toBe('kq');
      expect(params.tag).toBe('kt');
      expect(params.from).toBe('2026-03-01T00:00:00Z');
    });
  });
});
