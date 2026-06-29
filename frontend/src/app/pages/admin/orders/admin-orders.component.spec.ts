import { HttpErrorResponse } from '@angular/common/http';
import { fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import {
  AdminOrderListItem,
  AdminOrderListResponse,
  AdminOrdersService,
} from '../../../core/admin-orders.service';
import { AuthService } from '../../../core/auth.service';
import { AdminFavoritesService } from '../../../core/admin-favorites.service';
import { ToastService } from '../../../core/toast.service';
import { TAG_COLOR_STORAGE_KEY } from './order-tag-colors';
import { AdminOrdersComponent } from './admin-orders.component';

type Spy<T> = jasmine.SpyObj<T>;

function makeOrder(overrides: Partial<AdminOrderListItem> = {}): AdminOrderListItem {
  return {
    id: 'order-1',
    reference_code: 'REF-1',
    status: 'paid',
    total_amount: 100,
    currency: 'RON',
    payment_method: 'card',
    created_at: '2026-01-01T00:00:00Z',
    customer_email: 'a@b.com',
    customer_username: 'alice',
    tags: [],
    ...overrides,
  };
}

function listResponse(
  items: AdminOrderListItem[],
  meta: Partial<AdminOrderListResponse['meta']> = {},
): AdminOrderListResponse {
  return {
    items,
    meta: {
      total_items: items.length,
      total_pages: 1,
      page: 1,
      limit: 20,
      ...meta,
    },
  };
}

describe('AdminOrdersComponent', () => {
  let ordersApi: Spy<AdminOrdersService>;
  let router: Spy<Router>;
  let toast: Spy<ToastService>;
  let translate: Spy<TranslateService>;
  let auth: Spy<AuthService>;
  let favorites: Spy<AdminFavoritesService>;
  let comp: AdminOrdersComponent;
  // Controlled stand-in for history.state. Chrome 149 silently drops
  // history.replaceState() once its navigation throttle trips (which it does
  // mid-suite after thousands of calls), so reading the real history.state is
  // non-deterministic across specs. We shadow history.state with a configurable
  // own getter we fully control and remove it in afterEach so no global state
  // leaks to sibling specs.
  let historyState: unknown = {};

  beforeEach(() => {
    localStorage.clear();
    historyState = {};
    Object.defineProperty(window.history, 'state', {
      configurable: true,
      get: () => historyState,
    });
    // Sibling specs (e.g. admin-products) install a throwing stub as an OWN
    // `randomUUID` property on the shared global `crypto` instance and fail to
    // remove it (their getOwnPropertyDescriptor-based restore is a no-op because
    // randomUUID is inherited from Crypto.prototype, so it has no own
    // descriptor). Drop any such leaked override so this cluster's id-generating
    // paths use the genuine platform crypto.randomUUID().
    Reflect.deleteProperty(crypto, 'randomUUID');

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
      'addOrderTag',
      'removeOrderTag',
      'renameOrderTag',
      'listOrderTags',
    ]);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    translate = jasmine.createSpyObj<TranslateService>('TranslateService', ['instant']);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['user']);
    favorites = jasmine.createSpyObj<AdminFavoritesService>('AdminFavoritesService', [
      'init',
      'isFavorite',
      'remove',
      'add',
      'items',
    ]);

    ordersApi.search.and.returnValue(of(listResponse([makeOrder()])));
    ordersApi.update.and.returnValue(of({ status: 'paid' } as any));
    ordersApi.resendDeliveryEmail.and.returnValue(of({} as any));
    ordersApi.resendOrderConfirmationEmail.and.returnValue(of({} as any));
    ordersApi.downloadBatchPackingSlips.and.returnValue(of(new Blob(['x'])));
    ordersApi.downloadPickListCsv.and.returnValue(of(new Blob(['x'])));
    ordersApi.downloadPickListPdf.and.returnValue(of(new Blob(['x'])));
    ordersApi.uploadShippingLabel.and.returnValue(of({} as any));
    ordersApi.downloadBatchShippingLabelsZip.and.returnValue(of(new Blob(['x'])));
    ordersApi.downloadExport.and.returnValue(of(new Blob(['x'])));
    ordersApi.listOrderTagStats.and.returnValue(of([{ tag: 'vip', count: 2 }]));
    ordersApi.addOrderTag.and.returnValue(of({} as any));
    ordersApi.removeOrderTag.and.returnValue(of({} as any));
    ordersApi.renameOrderTag.and.returnValue(
      of({ from_tag: 'old', to_tag: 'new', updated: 1, merged: 0, total: 1 }),
    );
    ordersApi.listOrderTags.and.returnValue(of(['gift', 'vip']));
    router.navigate.and.returnValue(Promise.resolve(true));
    translate.instant.and.callFake((key: string | string[]) => key as string);
    auth.user.and.returnValue({ id: 'user-1' } as any);
    favorites.items.and.returnValue([]);
    favorites.isFavorite.and.returnValue(false);

    comp = new AdminOrdersComponent(ordersApi, router, toast, translate, auth, favorites);
  });

  afterEach(() => {
    // Remove the own history.state getter so the real platform accessor is
    // restored for other specs.
    Reflect.deleteProperty(window.history, 'state');
  });

  it('ngOnInit primes state and loads orders', () => {
    comp.ngOnInit();
    expect(favorites.init).toHaveBeenCalled();
    expect(ordersApi.search).toHaveBeenCalled();
    expect(comp.orders().length).toBe(1);
    expect(comp.loading()).toBeFalse();
  });

  describe('layout + density + view mode', () => {
    it('opens and closes the layout modal', () => {
      comp.openLayoutModal();
      expect(comp.layoutModalOpen()).toBeTrue();
      comp.closeLayoutModal();
      expect(comp.layoutModalOpen()).toBeFalse();
    });

    it('applies a table layout and persists it', () => {
      const layout = { ...comp.tableLayout(), hidden: ['status'] };
      comp.applyTableLayout(layout as any);
      expect(comp.tableLayout().hidden).toContain('status');
    });

    it('toggles density both directions and exposes labels', () => {
      comp.applyTableLayout({ ...comp.tableLayout(), density: 'compact' } as any);
      expect(comp.densityToggleLabelKey()).toBe('adminUi.tableLayout.densityToggle.toComfortable');
      comp.toggleDensity();
      expect(comp.tableLayout().density).toBe('comfortable');
      expect(comp.densityToggleLabelKey()).toBe('adminUi.tableLayout.densityToggle.toCompact');
      comp.toggleDensity();
      expect(comp.tableLayout().density).toBe('compact');
      expect(comp.cellPaddingClass()).toEqual(jasmine.any(String));
    });

    it('toggles between table and kanban view modes', () => {
      expect(comp.viewToggleLabelKey()).toBe('adminUi.orders.viewMode.kanban');
      comp.toggleViewMode();
      expect(comp.viewMode()).toBe('kanban');
      expect(comp.viewToggleLabelKey()).toBe('adminUi.orders.viewMode.table');
      expect(localStorage.getItem('admin.orders.view.v1:user-1')).toBe('kanban');
      comp.toggleViewMode();
      expect(comp.viewMode()).toBe('table');
    });
  });

  describe('kanban columns', () => {
    it('returns statuses per current status filter', () => {
      comp.status = 'pending';
      expect(comp.kanbanColumnStatuses()).toEqual(['pending_payment', 'pending_acceptance']);
      comp.status = 'sales';
      expect(comp.kanbanColumnStatuses()).toEqual(['paid', 'shipped', 'delivered', 'refunded']);
      comp.status = 'all';
      expect(comp.kanbanColumnStatuses().length).toBe(7);
      comp.status = 'shipped';
      expect(comp.kanbanColumnStatuses()).toEqual(['shipped']);
    });

    it('tracks status and counts cards', () => {
      expect(comp.trackKanbanStatus(0, 'paid')).toBe('paid');
      comp.status = 'shipped';
      comp.kanbanItemsByStatus.set({ shipped: [makeOrder(), makeOrder()] });
      expect(comp.kanbanTotalCards()).toBe(2);
      comp.kanbanItemsByStatus.set({});
      expect(comp.kanbanTotalCards()).toBe(0);
    });
  });

  describe('onKanbanDrop', () => {
    function dropEvent(order: any, previousIndex = 0, currentIndex = 0): any {
      return { item: { data: order }, previousIndex, currentIndex };
    }

    it('ignores drops while busy', () => {
      comp.kanbanBusy.set(true);
      comp.onKanbanDrop(dropEvent(makeOrder()), 'shipped');
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('ignores drops with no order id or status', () => {
      comp.onKanbanDrop(dropEvent({ id: '', status: '' }), 'shipped');
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('reorders within the same column', () => {
      const a = makeOrder({ id: 'a', status: 'paid' });
      const b = makeOrder({ id: 'b', status: 'paid' });
      comp.kanbanItemsByStatus.set({ paid: [a, b] });
      comp.onKanbanDrop(dropEvent(a, 0, 1), 'paid' as any);
      expect(comp.kanbanItemsByStatus()['paid'][0].id).toBe('b');
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('rejects an invalid transition', () => {
      const order = makeOrder({ id: 'a', status: 'delivered' });
      comp.onKanbanDrop(dropEvent(order), 'paid' as any);
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.kanban.errors.invalidTransition');
    });

    it('requires a cancel reason when cancelling', () => {
      spyOn(window, 'prompt').and.returnValue('   ');
      const order = makeOrder({ id: 'a', status: 'paid' });
      comp.onKanbanDrop(dropEvent(order), 'cancelled' as any);
      expect(toast.error).toHaveBeenCalledWith(
        'adminUi.orders.kanban.errors.cancelReasonRequired',
      );
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('aborts a refund when not confirmed', () => {
      spyOn(window, 'confirm').and.returnValue(false);
      const order = makeOrder({ id: 'a', status: 'paid' });
      comp.kanbanItemsByStatus.set({ paid: [order], refunded: [] });
      comp.onKanbanDrop(dropEvent(order), 'refunded' as any);
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('moves a card and persists the new status on success', () => {
      spyOn(window, 'prompt').and.returnValue('fraud');
      const order = makeOrder({ id: 'a', status: 'paid' });
      comp.kanbanItemsByStatus.set({ paid: [order], cancelled: [] });
      comp.kanbanTotalsByStatus.set({ paid: 1, cancelled: 0 });
      ordersApi.update.and.returnValue(of({ status: 'cancelled' } as any));
      comp.onKanbanDrop(dropEvent(order), 'cancelled' as any);
      expect(ordersApi.update).toHaveBeenCalledWith('a', {
        status: 'cancelled',
        cancel_reason: 'fraud',
      });
      expect(comp.kanbanItemsByStatus()['cancelled'].length).toBe(1);
      expect(toast.success).toHaveBeenCalledWith('adminUi.orders.kanban.success.updated');
      expect(comp.kanbanBusy()).toBeFalse();
    });

    it('falls back to target status when the API omits status', () => {
      const order = makeOrder({ id: 'a', status: 'paid' });
      comp.kanbanItemsByStatus.set({ paid: [order], shipped: [] });
      ordersApi.update.and.returnValue(of({} as any));
      comp.onKanbanDrop(dropEvent(order), 'shipped' as any);
      expect(order.status).toBe('shipped');
    });

    it('rolls back on API error', () => {
      const order = makeOrder({ id: 'a', status: 'paid' });
      const prevItems = { paid: [order], shipped: [] };
      comp.kanbanItemsByStatus.set(prevItems);
      comp.kanbanTotalsByStatus.set({ paid: 1, shipped: 0 });
      ordersApi.update.and.returnValue(throwError(() => new Error('boom')));
      comp.onKanbanDrop(dropEvent(order), 'shipped' as any);
      expect(order.status).toBe('paid');
      expect(comp.kanbanItemsByStatus()).toBe(prevItems);
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.kanban.errors.updateFailed');
    });

    it('allows COD pending_acceptance to ship directly', () => {
      const order = makeOrder({ id: 'a', status: 'pending_acceptance', payment_method: 'COD' });
      comp.kanbanItemsByStatus.set({ pending_acceptance: [order], shipped: [] });
      comp.onKanbanDrop(dropEvent(order), 'shipped' as any);
      expect(ordersApi.update).toHaveBeenCalled();
    });
  });

  describe('scrollToBulkActions', () => {
    afterEach(() => {
      document.getElementById('admin-orders-bulk-actions')?.remove();
    });

    it('returns when the element is missing', () => {
      expect(() => comp.scrollToBulkActions()).not.toThrow();
    });

    it('scrolls to and focuses the bulk actions region', fakeAsync(() => {
      const region = document.createElement('div');
      region.id = 'admin-orders-bulk-actions';
      const btn = document.createElement('button');
      region.appendChild(btn);
      document.body.appendChild(region);
      spyOn(region, 'scrollIntoView');
      const focusSpy = spyOn(btn, 'focus');
      comp.scrollToBulkActions();
      tick(1);
      expect(region.scrollIntoView).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
    }));

    it('scrolls without focusing when the region has no focusable child', fakeAsync(() => {
      const region = document.createElement('div');
      region.id = 'admin-orders-bulk-actions';
      document.body.appendChild(region);
      spyOn(region, 'scrollIntoView');
      comp.scrollToBulkActions();
      tick(1);
      expect(region.scrollIntoView).toHaveBeenCalled();
    }));
  });

  describe('columns + filters', () => {
    it('exposes visible columns and track helpers', () => {
      expect(comp.visibleColumnIds()).toContain('reference');
      expect(comp.trackColumnId(0, 'status')).toBe('status');
    });

    it('applyFilters resets paging and reloads', () => {
      comp.page = 5;
      comp.selectedIds.add('x');
      comp.applyFilters();
      expect(comp.page).toBe(1);
      expect(comp.selectedIds.size).toBe(0);
      expect(ordersApi.search).toHaveBeenCalled();
    });

    it('resetFilters clears all filters', () => {
      comp.q = 'abc';
      comp.status = 'paid';
      comp.includeTestOrders = false;
      comp.resetFilters();
      expect(comp.q).toBe('');
      expect(comp.status).toBe('all');
      expect(comp.includeTestOrders).toBeTrue();
    });
  });

  describe('presets', () => {
    function preset(id: string, extra: any = {}): any {
      return {
        id,
        name: `name-${id}`,
        createdAt: '2026-01-01',
        filters: {
          q: 'qq',
          status: 'paid',
          sla: 'any_overdue',
          fraud: 'queue',
          tag: 't',
          fromDate: '2026-01-01',
          toDate: '2026-02-01',
          includeTestOrders: false,
          limit: 50,
          ...extra,
        },
      };
    }

    it('applyPreset ignores empty and unknown ids', () => {
      comp.applyPreset('');
      comp.applyPreset('missing');
      expect(comp.q).toBe('');
    });

    it('applyPreset applies a stored preset', () => {
      comp.presets = [preset('p1')];
      comp.applyPreset('p1');
      expect(comp.q).toBe('qq');
      expect(comp.status).toBe('paid');
      expect(comp.limit).toBe(50);
    });

    it('applyPreset defaults sla/fraud when absent', () => {
      comp.presets = [preset('p2', { sla: undefined, fraud: undefined })];
      comp.applyPreset('p2');
      expect(comp.sla).toBe('all');
      expect(comp.fraud).toBe('all');
    });

    it('savePreset requires a name', () => {
      spyOn(window, 'prompt').and.returnValue('   ');
      comp.savePreset();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.presets.errors.nameRequired');
    });

    it('savePreset stores a preset with a crypto id', () => {
      spyOn(window, 'prompt').and.returnValue('Saved view');
      comp.savePreset();
      expect(comp.presets.length).toBe(1);
      expect(comp.presets[0].name).toBe('Saved view');
      // The id must come from crypto.randomUUID() (RFC 4122 shape), not the
      // `${Date.now()}-${Math.random()}` fallback branch.
      expect(comp.presets[0].id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(toast.success).toHaveBeenCalledWith('adminUi.orders.presets.success.saved');
      expect(localStorage.getItem('admin.orders.filters.v1:user-1')).toBeTruthy();
    });

    it('savePreset falls back when crypto.randomUUID is unavailable', () => {
      spyOn(window, 'prompt').and.returnValue('No crypto');
      const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
      try {
        Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
        comp.savePreset();
      } finally {
        if (desc) Object.defineProperty(globalThis, 'crypto', desc);
      }
      expect(comp.presets.length).toBe(1);
    });

    it('deletePreset handles missing, declined and confirmed deletes', () => {
      comp.deletePreset();
      comp.presets = [preset('p1')];
      comp.selectedPresetId = 'p1';
      const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
      comp.deletePreset();
      expect(comp.presets.length).toBe(1);
      confirmSpy.and.returnValue(true);
      comp.deletePreset();
      expect(comp.presets.length).toBe(0);
      expect(toast.success).toHaveBeenCalledWith('adminUi.orders.presets.success.deleted');
    });
  });

  describe('saved views', () => {
    it('lists saved filter views for orders scope', () => {
      favorites.items.and.returnValue([
        { key: 'k1', type: 'filter', label: 'L', state: { adminFilterScope: 'orders' } } as any,
        { key: 'k2', type: 'filter', label: 'L', state: { adminFilterScope: 'other' } } as any,
        { key: 'k3', type: 'page', label: 'L' } as any,
      ]);
      expect(comp.savedViews().map((v) => v.key)).toEqual(['k1']);
    });

    it('applySavedView ignores empty key and invalid views', () => {
      comp.applySavedView('');
      favorites.items.and.returnValue([
        { key: 'k1', type: 'filter', state: { adminFilterScope: 'orders' } } as any,
      ]);
      comp.applySavedView('k1');
      expect(comp.q).toBe('');
    });

    it('applySavedView applies stored filters', () => {
      favorites.items.and.returnValue([
        {
          key: 'k1',
          type: 'filter',
          state: {
            adminFilterScope: 'orders',
            adminFilters: {
              q: 'hello',
              status: 'shipped',
              sla: 'ship_overdue',
              fraud: 'flagged',
              tag: 'vip',
              fromDate: '2026-01-01',
              toDate: '2026-02-01',
              includeTestOrders: false,
              limit: 75,
            },
          },
        } as any,
      ]);
      comp.applySavedView('k1');
      expect(comp.q).toBe('hello');
      expect(comp.status).toBe('shipped');
      expect(comp.limit).toBe(75);
    });

    it('applySavedView defaults limit when invalid', () => {
      favorites.items.and.returnValue([
        {
          key: 'k1',
          type: 'filter',
          state: { adminFilterScope: 'orders', adminFilters: { limit: 'nope' } },
        } as any,
      ]);
      comp.applySavedView('k1');
      expect(comp.limit).toBe(20);
    });

    it('toggleCurrentViewPin removes an existing pin', () => {
      favorites.isFavorite.and.returnValue(true);
      comp.selectedSavedViewKey = comp['currentViewFavoriteKey']();
      comp.toggleCurrentViewPin();
      expect(favorites.remove).toHaveBeenCalled();
      expect(comp.selectedSavedViewKey).toBe('');
    });

    it('toggleCurrentViewPin requires a name when adding', () => {
      spyOn(window, 'prompt').and.returnValue('  ');
      comp.toggleCurrentViewPin();
      expect(toast.error).toHaveBeenCalledWith(
        'adminUi.favorites.savedViews.errors.nameRequired',
      );
      expect(favorites.add).not.toHaveBeenCalled();
    });

    it('toggleCurrentViewPin adds a new pinned view', () => {
      spyOn(window, 'prompt').and.returnValue('My view');
      comp.toggleCurrentViewPin();
      expect(favorites.add).toHaveBeenCalled();
      expect(comp.isCurrentViewPinned()).toBeFalse();
    });
  });

  describe('maybeApplyFiltersFromState', () => {
    it('ignores non-orders scopes', () => {
      historyState = { adminFilterScope: 'other' };
      comp['maybeApplyFiltersFromState']();
      expect(comp.q).toBe('');
    });

    it('ignores missing filters', () => {
      historyState = { adminFilterScope: 'orders' };
      comp['maybeApplyFiltersFromState']();
      expect(comp.q).toBe('');
    });

    it('applies filters from navigation state', () => {
      historyState = {
        adminFilterScope: 'orders',
        adminFilters: {
          q: 'state-q',
          status: 'delivered',
          sla: 'accept_overdue',
          fraud: 'approved',
          tag: 'gift',
          fromDate: '2026-03-01',
          toDate: '2026-04-01',
          includeTestOrders: false,
          limit: 33,
        },
      };
      comp['maybeApplyFiltersFromState']();
      expect(comp.q).toBe('state-q');
      expect(comp.status).toBe('delivered');
      expect(comp.limit).toBe(33);
      expect(comp.selectedSavedViewKey).toBe(comp['currentViewFavoriteKey']());
    });

    it('keeps current limit when state limit invalid', () => {
      comp.limit = 99;
      historyState = { adminFilterScope: 'orders', adminFilters: { limit: 'bad' } };
      comp['maybeApplyFiltersFromState']();
      expect(comp.limit).toBe(99);
    });
  });

  describe('selection', () => {
    it('toggleSelected adds and removes ids', () => {
      comp.toggleSelected('a', true);
      expect(comp.selectedIds.has('a')).toBeTrue();
      comp.toggleSelected('a', false);
      expect(comp.selectedIds.has('a')).toBeFalse();
    });

    it('toggleSelected is blocked while bulk busy', () => {
      comp.bulkBusy = true;
      comp.toggleSelected('a', true);
      expect(comp.selectedIds.size).toBe(0);
    });

    it('toggleSelectAllOnPage selects and deselects the page', () => {
      comp.orders.set([makeOrder({ id: '1' }), makeOrder({ id: '2' })]);
      comp.toggleSelectAllOnPage(true);
      expect(comp.allSelectedOnPage()).toBeTrue();
      expect(comp.someSelectedOnPage()).toBeFalse();
      comp.toggleSelectAllOnPage(false);
      expect(comp.selectedIds.size).toBe(0);
    });

    it('toggleSelectAllOnPage no-ops when busy or empty', () => {
      comp.bulkBusy = true;
      comp.orders.set([makeOrder()]);
      comp.toggleSelectAllOnPage(true);
      expect(comp.selectedIds.size).toBe(0);
      comp.bulkBusy = false;
      comp.orders.set([]);
      comp.toggleSelectAllOnPage(true);
      expect(comp.selectedIds.size).toBe(0);
      expect(comp.allSelectedOnPage()).toBeFalse();
      expect(comp.someSelectedOnPage()).toBeFalse();
    });

    it('someSelectedOnPage is true with a partial selection', () => {
      comp.orders.set([makeOrder({ id: '1' }), makeOrder({ id: '2' })]);
      comp.selectedIds.add('1');
      expect(comp.someSelectedOnPage()).toBeTrue();
    });
  });

  describe('applyBulkUpdate', () => {
    beforeEach(() => {
      comp.selectedIds = new Set(['o1', 'o2']);
    });

    it('returns with no selection', () => {
      comp.selectedIds.clear();
      comp.applyBulkUpdate();
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('requires an action', () => {
      comp.applyBulkUpdate();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.errors.chooseAction');
    });

    it('applies status to all selected and clears on success', () => {
      comp.bulkStatus = 'shipped';
      comp.applyBulkUpdate();
      expect(ordersApi.update).toHaveBeenCalledWith('o1', { status: 'shipped' });
      expect(comp.selectedIds.size).toBe(0);
      expect(toast.success).toHaveBeenCalled();
    });

    it('clears the courier when set to clear', () => {
      comp.bulkCourier = 'clear';
      comp.applyBulkUpdate();
      expect(ordersApi.update).toHaveBeenCalledWith('o1', { courier: null });
    });

    it('sets a specific courier and reports partial failures', () => {
      comp.bulkCourier = 'sameday';
      ordersApi.update.and.callFake((id: string) =>
        id === 'o2' ? throwError(() => new Error('x')) : of({} as any),
      );
      comp.applyBulkUpdate();
      expect(comp.selectedIds.has('o2')).toBeTrue();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.partial');
    });
  });

  describe('resendBulkEmails', () => {
    beforeEach(() => {
      comp.selectedIds = new Set(['o1']);
    });

    it('returns with no selection', () => {
      comp.selectedIds.clear();
      comp.resendBulkEmails();
      expect(ordersApi.resendDeliveryEmail).not.toHaveBeenCalled();
    });

    it('requires an email kind', () => {
      comp.resendBulkEmails();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.errors.chooseEmail');
    });

    it('aborts when the note prompt is cancelled', () => {
      comp.bulkEmailKind = 'confirmation';
      spyOn(window, 'prompt').and.returnValue(null);
      comp.resendBulkEmails();
      expect(ordersApi.resendOrderConfirmationEmail).not.toHaveBeenCalled();
    });

    it('sends delivery emails with a trimmed note', () => {
      comp.bulkEmailKind = 'delivery';
      spyOn(window, 'prompt').and.returnValue('  hi  ');
      comp.resendBulkEmails();
      expect(ordersApi.resendDeliveryEmail).toHaveBeenCalledWith('o1', 'hi');
      expect(toast.success).toHaveBeenCalled();
    });

    it('sends confirmation emails and reports partial failures', () => {
      comp.selectedIds = new Set(['o1', 'o2']);
      comp.bulkEmailKind = 'confirmation';
      spyOn(window, 'prompt').and.returnValue('');
      ordersApi.resendOrderConfirmationEmail.and.callFake((id: string) =>
        id === 'o2' ? throwError(() => new Error('x')) : of({} as any),
      );
      comp.resendBulkEmails();
      expect(ordersApi.resendOrderConfirmationEmail).toHaveBeenCalledWith('o1', null);
      expect(comp.selectedIds.has('o2')).toBeTrue();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.emailsPartial');
    });
  });

  describe('document downloads', () => {
    beforeEach(() => {
      comp.selectedIds = new Set(['o1']);
    });

    it('downloadBatchPackingSlips returns without a selection', () => {
      comp.selectedIds.clear();
      comp.downloadBatchPackingSlips();
      expect(ordersApi.downloadBatchPackingSlips).not.toHaveBeenCalled();
    });

    it('downloadBatchPackingSlips succeeds and errors', () => {
      comp.downloadBatchPackingSlips();
      expect(toast.success).toHaveBeenCalledWith('adminUi.orders.bulk.packingSlipsReady');
      ordersApi.downloadBatchPackingSlips.and.returnValue(throwError(() => new Error('x')));
      comp.downloadBatchPackingSlips();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.errors.packingSlips');
    });

    it('downloadPickListCsv succeeds and errors', () => {
      comp.downloadPickListCsv();
      expect(toast.success).toHaveBeenCalledWith('adminUi.orders.bulk.pickListReady');
      ordersApi.downloadPickListCsv.and.returnValue(throwError(() => new Error('x')));
      comp.downloadPickListCsv();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.errors.pickList');
    });

    it('downloadPickListCsv returns without a selection', () => {
      comp.selectedIds.clear();
      comp.downloadPickListCsv();
      expect(ordersApi.downloadPickListCsv).not.toHaveBeenCalled();
    });

    it('downloadPickListPdf succeeds and errors', () => {
      comp.downloadPickListPdf();
      expect(toast.success).toHaveBeenCalledWith('adminUi.orders.bulk.pickListReady');
      ordersApi.downloadPickListPdf.and.returnValue(throwError(() => new Error('x')));
      comp.downloadPickListPdf();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.errors.pickList');
    });

    it('downloadPickListPdf returns without a selection', () => {
      comp.selectedIds.clear();
      comp.downloadPickListPdf();
      expect(ordersApi.downloadPickListPdf).not.toHaveBeenCalled();
    });
  });

  describe('shipping labels modal', () => {
    function makeFile(name: string): File {
      return new File(['data'], name, { type: 'application/pdf' });
    }

    beforeEach(() => {
      comp.orders.set([
        makeOrder({ id: 'order-abcdef12', reference_code: 'REF-100' }),
        makeOrder({ id: 'order-zzz', reference_code: '' }),
      ]);
      comp.selectedIds = new Set(['order-abcdef12', 'order-zzz']);
    });

    it('opens with built order options', () => {
      comp.openShippingLabelsModal();
      expect(comp.shippingLabelsModalOpen()).toBeTrue();
      expect(comp.shippingLabelsOrderOptions.length).toBe(2);
      expect(comp.shippingLabelsOrderOptions[0].label).toContain('REF-100');
      expect(comp.shippingLabelsOrderOptions[1].label).toBe('order-zz');
    });

    it('does not open without a selection', () => {
      comp.selectedIds.clear();
      comp.openShippingLabelsModal();
      expect(comp.shippingLabelsModalOpen()).toBeFalse();
    });

    it('closes the modal unless busy', () => {
      comp.openShippingLabelsModal();
      comp.shippingLabelsBusy = true;
      comp.closeShippingLabelsModal();
      expect(comp.shippingLabelsModalOpen()).toBeTrue();
      comp.shippingLabelsBusy = false;
      comp.closeShippingLabelsModal();
      expect(comp.shippingLabelsModalOpen()).toBeFalse();
    });

    it('auto-assigns selected files by reference then short id', () => {
      comp.openShippingLabelsModal();
      const input: any = { files: [makeFile('REF-100-label.pdf'), makeFile('order-ab.pdf')], value: 'x' };
      comp.onShippingLabelsSelected({ target: input } as any);
      expect(comp.shippingLabelsUploads.length).toBe(2);
      expect(comp.shippingLabelsUploads[0].assignedOrderId).toBe('order-abcdef12');
      expect(comp.shippingLabelsUploads[1].assignedOrderId).toBe('order-abcdef12');
      expect(input.value).toBe('');
    });

    it('ignores selection events without files', () => {
      comp.onShippingLabelsSelected({ target: { files: null } } as any);
      expect(comp.shippingLabelsUploads.length).toBe(0);
      comp.onShippingLabelsSelected({ target: null } as any);
      expect(comp.shippingLabelsUploads.length).toBe(0);
    });

    it('uploadAllShippingLabels uploads pending items and reports success', () => {
      comp.shippingLabelsUploads = [
        { file: makeFile('a.pdf'), assignedOrderId: 'order-abcdef12', status: 'pending', error: null },
      ];
      comp.uploadAllShippingLabels();
      expect(ordersApi.uploadShippingLabel).toHaveBeenCalled();
      expect(comp.shippingLabelsUploads[0].status).toBe('success');
      expect(toast.success).toHaveBeenCalledWith(
        'adminUi.orders.shippingLabelsModal.success.uploaded',
      );
    });

    it('uploadAllShippingLabels flags missing orders and upload failures', () => {
      const errResponse = new HttpErrorResponse({ error: { request_id: 'req-9' } });
      comp.shippingLabelsUploads = [
        { file: makeFile('a.pdf'), assignedOrderId: '  ', status: 'pending', error: null },
        { file: makeFile('b.pdf'), assignedOrderId: 'order-zzz', status: 'pending', error: null },
      ];
      ordersApi.uploadShippingLabel.and.returnValue(throwError(() => errResponse));
      comp.uploadAllShippingLabels();
      expect(comp.shippingLabelsUploads[0].status).toBe('error');
      expect(comp.shippingLabelsUploads[1].status).toBe('error');
      expect(comp.shippingLabelsUploads[1].error).toContain('req-9');
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.shippingLabelsModal.errors.partial');
    });

    it('uploadAllShippingLabels no-ops when busy, empty or all done', () => {
      comp.shippingLabelsBusy = true;
      comp.uploadAllShippingLabels();
      comp.shippingLabelsBusy = false;
      comp.shippingLabelsUploads = [];
      comp.uploadAllShippingLabels();
      comp.shippingLabelsUploads = [
        { file: makeFile('a.pdf'), assignedOrderId: 'order-zzz', status: 'success', error: null },
      ];
      comp.uploadAllShippingLabels();
      expect(ordersApi.uploadShippingLabel).not.toHaveBeenCalled();
    });

    it('retryShippingLabelUpload retries a single item', () => {
      comp.shippingLabelsUploads = [
        { file: makeFile('a.pdf'), assignedOrderId: 'order-zzz', status: 'error', error: 'x' },
      ];
      comp.retryShippingLabelUpload(0);
      expect(comp.shippingLabelsUploads[0].status).toBe('success');
      expect(toast.success).toHaveBeenCalled();
    });

    it('retryShippingLabelUpload guards missing item, busy and missing order', () => {
      comp.retryShippingLabelUpload(99);
      comp.shippingLabelsUploads = [
        { file: makeFile('a.pdf'), assignedOrderId: '', status: 'pending', error: null },
      ];
      comp.retryShippingLabelUpload(0);
      expect(comp.shippingLabelsUploads[0].status).toBe('error');
      expect(ordersApi.uploadShippingLabel).not.toHaveBeenCalled();
    });

    it('retryShippingLabelUpload surfaces an upload error with request id', () => {
      comp.shippingLabelsUploads = [
        { file: makeFile('a.pdf'), assignedOrderId: 'order-zzz', status: 'pending', error: null },
      ];
      ordersApi.uploadShippingLabel.and.returnValue(
        throwError(() => new HttpErrorResponse({ error: { request_id: 'req-1' } })),
      );
      comp.retryShippingLabelUpload(0);
      expect(comp.shippingLabelsUploads[0].status).toBe('error');
      expect(comp.shippingLabelsUploads[0].error).toContain('req-1');
      expect(toast.error).toHaveBeenCalled();
    });

    it('downloadSelectedShippingLabelsZip downloads on success', () => {
      comp.downloadSelectedShippingLabelsZip();
      expect(toast.success).toHaveBeenCalledWith(
        'adminUi.orders.shippingLabelsModal.success.zipReady',
      );
    });

    it('downloadSelectedShippingLabelsZip reports missing labels', () => {
      ordersApi.downloadBatchShippingLabelsZip.and.returnValue(
        throwError(() => ({ error: { detail: { missing_shipping_label_order_ids: ['a', 'b'] } } })),
      );
      comp.downloadSelectedShippingLabelsZip();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.shippingLabelsModal.errors.missingLabels');
    });

    it('downloadSelectedShippingLabelsZip reports a generic failure', () => {
      ordersApi.downloadBatchShippingLabelsZip.and.returnValue(throwError(() => ({})));
      comp.downloadSelectedShippingLabelsZip();
      expect(toast.error).toHaveBeenCalledWith(
        'adminUi.orders.shippingLabelsModal.errors.zipFailed',
      );
    });

    it('downloadSelectedShippingLabelsZip no-ops without selection or while busy', () => {
      comp.selectedIds.clear();
      comp.downloadSelectedShippingLabelsZip();
      comp.selectedIds = new Set(['order-zzz']);
      comp.shippingLabelsBusy = true;
      comp.downloadSelectedShippingLabelsZip();
      expect(ordersApi.downloadBatchShippingLabelsZip).not.toHaveBeenCalled();
    });

    it('maps status labels and pill classes', () => {
      expect(comp.shippingLabelStatusLabelKey('success')).toBe(
        'adminUi.orders.shippingLabelsModal.status.success',
      );
      expect(comp.shippingLabelStatusPillClass('success')).toContain('emerald');
      expect(comp.shippingLabelStatusPillClass('uploading')).toContain('indigo');
      expect(comp.shippingLabelStatusPillClass('error')).toContain('rose');
      expect(comp.shippingLabelStatusPillClass('pending')).toContain('slate');
    });

    it('updateShippingLabelUpload ignores an out-of-range index', () => {
      comp.shippingLabelsUploads = [];
      comp['updateShippingLabelUpload'](5, { status: 'success' });
      expect(comp.shippingLabelsUploads.length).toBe(0);
    });

    it('autoAssignShippingLabel returns null when nothing matches', () => {
      comp.shippingLabelsOrderOptions = comp['buildShippingLabelsOrderOptions']();
      expect(comp['autoAssignShippingLabel'](makeFile('unmatched.pdf'))).toBeNull();
    });
  });

  describe('navigation + paging', () => {
    it('goToPage updates page and reloads', () => {
      comp.goToPage(3);
      expect(comp.page).toBe(3);
      expect(ordersApi.search).toHaveBeenCalled();
    });

    it('trackOrderId returns the order id', () => {
      expect(comp.trackOrderId(0, makeOrder({ id: 'x' }))).toBe('x');
    });

    it('open builds query params from active filters', () => {
      comp.page = 2;
      comp.q = ' search ';
      comp.status = 'paid';
      comp.sla = 'any_overdue';
      comp.fraud = 'queue';
      comp.tag = ' vip ';
      comp.includeTestOrders = false;
      comp.fromDate = '2026-01-01';
      comp.toDate = '2026-02-01';
      comp.open('order-9');
      const args = router.navigate.calls.mostRecent().args;
      expect(args[0]).toEqual(['/admin/orders', 'order-9']);
      const qp = (args[1] as any).queryParams;
      expect(qp.nav_q).toBe('search');
      expect(qp.nav_status).toBe('paid');
      expect(qp.nav_include_test).toBe(0);
      expect(qp.nav_from).toBe('2026-01-01T00:00:00Z');
    });

    it('open omits optional params when defaults are used', () => {
      comp.open('order-1');
      const qp = (router.navigate.calls.mostRecent().args[1] as any).queryParams;
      expect(qp.nav_q).toBeUndefined();
      expect(qp.nav_status).toBeUndefined();
    });

    it('openExports navigates to the exports page', () => {
      comp.openExports();
      expect(router.navigate).toHaveBeenCalledWith(['/admin/orders/exports']);
    });
  });

  describe('export modal', () => {
    it('opens and closes the export modal', () => {
      comp.openExportModal();
      expect(comp.exportModalOpen()).toBeTrue();
      comp.closeExportModal();
      expect(comp.exportModalOpen()).toBeFalse();
    });

    it('toggleExportColumn ignores unknown columns and toggles known ones', () => {
      comp.toggleExportColumn('not-a-column', true);
      expect(comp.exportColumns['not-a-column']).toBeUndefined();
      comp.toggleExportColumn('status', true);
      expect(comp.exportColumns['status']).toBeTrue();
      expect(comp.selectedExportTemplateId).toBe('');
    });

    it('applyExportTemplate clears selection and applies a template', () => {
      comp.applyExportTemplate('');
      comp.exportTemplates = [
        { id: 't1', name: 'T', createdAt: '', columns: ['status', 'currency', 'bogus'] },
      ];
      comp.applyExportTemplate('missing');
      comp.applyExportTemplate('t1');
      expect(comp.exportColumns['status']).toBeTrue();
      expect(comp.exportColumns['currency']).toBeTrue();
      expect(comp.exportColumns['id']).toBeFalse();
    });

    it('downloadExport requires columns', () => {
      comp.exportColumns = {};
      comp.downloadExport();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.exportModal.errors.noColumns');
    });

    it('downloadExport downloads and closes on success', () => {
      comp.exportColumns = { status: true };
      comp.openExportModal();
      comp.downloadExport();
      expect(ordersApi.downloadExport).toHaveBeenCalledWith(['status']);
      expect(comp.exportModalOpen()).toBeFalse();
    });

    it('downloadExport surfaces errors', () => {
      comp.exportColumns = { status: true };
      ordersApi.downloadExport.and.returnValue(throwError(() => new Error('x')));
      comp.downloadExport();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.errors.export');
    });

    it('saveExportTemplate requires columns and a name', () => {
      comp.exportColumns = {};
      comp.saveExportTemplate();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.exportModal.errors.noColumns');
      comp.exportColumns = { status: true };
      const promptSpy = spyOn(window, 'prompt').and.returnValue('  ');
      comp.saveExportTemplate();
      expect(toast.error).toHaveBeenCalledWith(
        'adminUi.orders.exportModal.errors.templateNameRequired',
      );
      promptSpy.and.returnValue('Template A');
      comp.saveExportTemplate();
      expect(comp.exportTemplates.length).toBe(1);
      expect(toast.success).toHaveBeenCalledWith('adminUi.orders.exportModal.success.saved');
    });

    it('saveExportTemplate falls back when crypto.randomUUID is unavailable', () => {
      comp.exportColumns = { status: true };
      spyOn(window, 'prompt').and.returnValue('Template B');
      const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
      try {
        Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
        comp.saveExportTemplate();
      } finally {
        if (desc) Object.defineProperty(globalThis, 'crypto', desc);
      }
      expect(comp.exportTemplates.length).toBe(1);
    });

    it('deleteExportTemplate handles missing, declined and confirmed deletes', () => {
      comp.deleteExportTemplate();
      comp.exportTemplates = [{ id: 't1', name: 'T', createdAt: '', columns: ['status'] }];
      comp.selectedExportTemplateId = 't1';
      const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
      comp.deleteExportTemplate();
      expect(comp.exportTemplates.length).toBe(1);
      confirmSpy.and.returnValue(true);
      comp.deleteExportTemplate();
      expect(comp.exportTemplates.length).toBe(0);
      expect(toast.success).toHaveBeenCalledWith('adminUi.orders.exportModal.success.deleted');
    });
  });

  describe('labels + tags rendering', () => {
    it('customerLabel covers all combinations', () => {
      expect(comp.customerLabel(makeOrder({ customer_email: 'e@x', customer_username: 'u' }))).toBe(
        'e@x (u)',
      );
      expect(comp.customerLabel(makeOrder({ customer_email: 'e@x', customer_username: '' }))).toBe(
        'e@x',
      );
      expect(comp.customerLabel(makeOrder({ customer_email: '', customer_username: 'u' }))).toBe(
        'u',
      );
      expect(comp.customerLabel(makeOrder({ customer_email: '', customer_username: '' }))).toBe(
        'adminUi.orders.guest',
      );
    });

    it('tagLabel returns the raw tag when no translation exists', () => {
      expect(comp.tagLabel('vip')).toBe('vip');
      translate.instant.and.callFake((key: string | string[]) =>
        key === 'adminUi.orders.tags.vip' ? 'VIP Customer' : (key as string),
      );
      expect(comp.tagLabel('vip')).toBe('VIP Customer');
    });

    it('tagChipColorClass and tagColorValue resolve colors', () => {
      expect(comp.tagChipColorClass('vip')).toContain('violet');
      expect(comp.tagColorValue('vip')).toBe('violet');
    });
  });

  describe('tag manager', () => {
    it('opens and reloads tag stats', () => {
      comp.openTagManager();
      expect(comp.tagManagerOpen()).toBeTrue();
      expect(comp.tagManagerRows().length).toBe(1);
      expect(comp.tagManagerLoading()).toBeFalse();
    });

    it('reloadTagManager handles null rows and errors', () => {
      ordersApi.listOrderTagStats.and.returnValue(of(null as any));
      comp.reloadTagManager();
      expect(comp.tagManagerRows()).toEqual([]);
      ordersApi.listOrderTagStats.and.returnValue(throwError(() => new Error('x')));
      comp.reloadTagManager();
      expect(comp.tagManagerError()).toBe('adminUi.orders.tags.errors.load');
    });

    it('closeTagManager resets state', () => {
      comp.openTagManager();
      comp.closeTagManager();
      expect(comp.tagManagerOpen()).toBeFalse();
      expect(comp.tagManagerRows()).toEqual([]);
    });

    it('filteredTagManagerRows filters by query', () => {
      comp.tagManagerRows.set([
        { tag: 'vip', count: 1 },
        { tag: 'gift', count: 2 },
      ]);
      comp.tagManagerQuery = '';
      expect(comp.filteredTagManagerRows().length).toBe(2);
      comp.tagManagerQuery = 'gif';
      expect(comp.filteredTagManagerRows().map((r) => r.tag)).toEqual(['gift']);
    });

    it('setTagColor validates and persists overrides', () => {
      comp.setTagColor('', 'rose');
      comp.setTagColor('vip', 'not-a-color');
      expect(localStorage.getItem(TAG_COLOR_STORAGE_KEY)).toBeNull();
      comp.setTagColor('vip', 'rose');
      expect(comp.tagColorValue('vip')).toBe('rose');
      expect(localStorage.getItem(TAG_COLOR_STORAGE_KEY)).toContain('rose');
    });

    it('resetTagColor validates and removes overrides', () => {
      comp.setTagColor('vip', 'rose');
      comp.resetTagColor('');
      expect(comp.tagColorValue('vip')).toBe('rose');
      comp.resetTagColor('vip');
      expect(comp.tagColorValue('vip')).toBe('violet');
    });
  });

  describe('applyBulkTags', () => {
    beforeEach(() => {
      comp.selectedIds = new Set(['o1']);
    });

    it('returns without a selection', () => {
      comp.selectedIds.clear();
      comp.applyBulkTags();
      expect(ordersApi.addOrderTag).not.toHaveBeenCalled();
    });

    it('requires a tag action', () => {
      comp.applyBulkTags();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.errors.chooseTagAction');
    });

    it('adds and removes tags successfully', () => {
      comp.bulkTagAdd = 'vip';
      comp.bulkTagRemove = 'gift';
      comp.applyBulkTags();
      expect(ordersApi.removeOrderTag).toHaveBeenCalledWith('o1', 'gift');
      expect(ordersApi.addOrderTag).toHaveBeenCalledWith('o1', 'vip');
      expect(toast.success).toHaveBeenCalled();
      expect(comp.bulkTagAdd).toBe('');
    });

    it('reports partial failures', () => {
      comp.selectedIds = new Set(['o1', 'o2']);
      comp.bulkTagAdd = 'vip';
      ordersApi.addOrderTag.and.callFake((id: string) =>
        id === 'o2' ? throwError(() => new Error('x')) : of({} as any),
      );
      comp.applyBulkTags();
      expect(comp.selectedIds.has('o2')).toBeTrue();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.partial');
    });
  });

  describe('renameTag', () => {
    it('does nothing while busy', () => {
      comp.tagRenameBusy = true;
      comp.renameTag();
      expect(ordersApi.renameOrderTag).not.toHaveBeenCalled();
    });

    it('requires both from and to tags', () => {
      comp.tagRenameFrom = 'a';
      comp.tagRenameTo = '';
      comp.renameTag();
      expect(comp.tagRenameError).toBe('adminUi.orders.tags.errors.renameRequired');
    });

    it('aborts when not confirmed', () => {
      comp.tagRenameFrom = 'old';
      comp.tagRenameTo = 'new';
      spyOn(window, 'confirm').and.returnValue(false);
      comp.renameTag();
      expect(ordersApi.renameOrderTag).not.toHaveBeenCalled();
    });

    it('renames a tag and migrates color + active filter', () => {
      comp.tagRenameFrom = 'old';
      comp.tagRenameTo = 'new';
      comp.tag = 'old';
      comp.setTagColor('old', 'rose');
      spyOn(window, 'confirm').and.returnValue(true);
      ordersApi.renameOrderTag.and.returnValue(
        of({ from_tag: 'old', to_tag: 'new', updated: 1, merged: 0, total: 4 }),
      );
      comp.renameTag();
      expect(comp.tag).toBe('new');
      expect(comp.tagColorValue('new')).toBe('rose');
      expect(toast.success).toHaveBeenCalledWith('adminUi.orders.tags.renamed');
      expect(comp.tagRenameBusy).toBeFalse();
    });

    it('surfaces a rename error detail', () => {
      comp.tagRenameFrom = 'old';
      comp.tagRenameTo = 'new';
      spyOn(window, 'confirm').and.returnValue(true);
      ordersApi.renameOrderTag.and.returnValue(
        throwError(() => ({ error: { detail: 'already exists' } })),
      );
      comp.renameTag();
      expect(comp.tagRenameError).toBe('already exists');
    });

    it('falls back to a generic rename error', () => {
      comp.tagRenameFrom = 'old';
      comp.tagRenameTo = 'new';
      spyOn(window, 'confirm').and.returnValue(true);
      ordersApi.renameOrderTag.and.returnValue(throwError(() => ({})));
      comp.renameTag();
      expect(comp.tagRenameError).toBe('adminUi.orders.tags.errors.rename');
    });
  });

  describe('refreshTagOptions', () => {
    it('merges and sorts API tags', () => {
      ordersApi.listOrderTags.and.returnValue(of(['zeta', 'alpha']));
      comp['refreshTagOptions']();
      const opts = comp.tagOptions();
      expect(opts).toContain('alpha');
      expect(opts).toContain('zeta');
      expect(opts.indexOf('alpha')).toBeLessThan(opts.indexOf('zeta'));
    });

    it('ignores API errors', () => {
      ordersApi.listOrderTags.and.returnValue(throwError(() => new Error('x')));
      expect(() => comp['refreshTagOptions']()).not.toThrow();
    });
  });

  describe('badges', () => {
    it('statusPillClass delegates to the helper', () => {
      expect(comp.statusPillClass('paid')).toEqual(jasmine.any(String));
    });

    it('slaBadge returns null for missing or invalid data', () => {
      expect(comp.slaBadge(makeOrder({ sla_kind: '', sla_due_at: '2026-01-01T00:00:00Z' }))).toBeNull();
      expect(comp.slaBadge(makeOrder({ sla_kind: 'accept', sla_due_at: '' }))).toBeNull();
      expect(
        comp.slaBadge(makeOrder({ sla_kind: 'accept', sla_due_at: 'not-a-date' })),
      ).toBeNull();
      expect(
        comp.slaBadge(makeOrder({ sla_kind: 'other', sla_due_at: '2026-01-01T00:00:00Z' })),
      ).toBeNull();
    });

    it('slaBadge flags overdue accept SLAs', () => {
      const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const badge = comp.slaBadge(makeOrder({ sla_kind: 'accept', sla_due_at: past }));
      expect(badge?.className).toContain('rose');
    });

    it('slaBadge flags ship SLAs due soon', () => {
      const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const badge = comp.slaBadge(makeOrder({ sla_kind: 'ship', sla_due_at: soon }));
      expect(badge?.className).toContain('amber');
    });

    it('slaBadge returns null when far in the future', () => {
      const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      expect(comp.slaBadge(makeOrder({ sla_kind: 'accept', sla_due_at: future }))).toBeNull();
    });

    it('fraudBadge returns null without severity', () => {
      expect(comp.fraudBadge(makeOrder({ fraud_severity: '' }))).toBeNull();
    });

    it('fraudBadge styles each severity', () => {
      expect(comp.fraudBadge(makeOrder({ fraud_severity: 'high' }))?.className).toContain('rose');
      expect(comp.fraudBadge(makeOrder({ fraud_severity: 'medium' }))?.className).toContain('amber');
      expect(comp.fraudBadge(makeOrder({ fraud_severity: 'low' }))?.className).toContain('sky');
      expect(comp.fraudBadge(makeOrder({ fraud_severity: 'unknown' }))?.className).toContain('slate');
    });

    it('fraudBadge uses a translated severity label when available', () => {
      translate.instant.and.callFake((key: string | string[]) =>
        key === 'adminUi.orders.fraudSignals.severity.high' ? 'High risk' : (key as string),
      );
      const badge = comp.fraudBadge(makeOrder({ fraud_severity: 'high' }));
      expect(badge).not.toBeNull();
    });

    it('formatDurationShort formats minutes, hours and days', () => {
      expect(comp['formatDurationShort'](30 * 60_000)).toBe('30m');
      expect(comp['formatDurationShort'](5 * 60 * 60_000)).toBe('5h');
      expect(comp['formatDurationShort'](72 * 60 * 60_000)).toBe('3d');
    });
  });

  describe('load (table + kanban)', () => {
    it('load sends all active filters', () => {
      comp.q = ' query ';
      comp.status = 'paid';
      comp.sla = 'any_overdue';
      comp.fraud = 'queue';
      comp.tag = ' vip ';
      comp.includeTestOrders = false;
      comp.fromDate = '2026-01-01';
      comp.toDate = '2026-02-01';
      comp['load']();
      const params = ordersApi.search.calls.mostRecent().args[0];
      expect(params.q).toBe('query');
      expect(params.status).toBe('paid');
      expect(params.include_test).toBeFalse();
      expect(params.from).toBe('2026-01-01T00:00:00Z');
    });

    it('load surfaces an error', () => {
      ordersApi.search.and.returnValue(
        throwError(() => new HttpErrorResponse({ error: { request_id: 'req-7' } })),
      );
      comp['load']();
      expect(comp.error()).toBe('adminUi.orders.errors.load');
      expect(comp.errorRequestId()).toBe('req-7');
    });

    it('loadKanban groups results and totals', () => {
      comp.viewMode.set('kanban');
      comp.status = 'pending';
      ordersApi.search.and.callFake((params: any) => {
        if (params.status === 'pending_payment') {
          return of(listResponse([makeOrder({ id: 'p1', status: 'pending_payment' })], { total_items: 5 }));
        }
        return of({ items: undefined, meta: undefined } as any);
      });
      comp.retryLoad();
      expect(comp.kanbanItemsByStatus()['pending_payment'].length).toBe(1);
      expect(comp.kanbanTotalsByStatus()['pending_payment']).toBe(5);
      expect(comp.kanbanItemsByStatus()['pending_acceptance']).toEqual([]);
      expect(comp.kanbanTotalsByStatus()['pending_acceptance']).toBe(0);
      expect(comp.loading()).toBeFalse();
    });

    it('loadKanban records the first column error', () => {
      comp.viewMode.set('kanban');
      comp.status = 'shipped';
      ordersApi.search.and.returnValue(
        throwError(() => new HttpErrorResponse({ error: { request_id: 'req-k' } })),
      );
      comp.retryLoad();
      expect(comp.kanbanItemsByStatus()['shipped']).toEqual([]);
      expect(comp.error()).toBe('adminUi.orders.errors.load');
      expect(comp.errorRequestId()).toBe('req-k');
    });

    it('loadKanban handles a stream-level error', () => {
      comp.viewMode.set('kanban');
      comp.status = 'shipped';
      ordersApi.search.and.throwError('sync boom');
      comp.retryLoad();
      expect(comp.error()).toBe('adminUi.orders.errors.load');
      expect(comp.loading()).toBeFalse();
    });
  });

  describe('storage helpers', () => {
    it('uses an anonymous suffix when there is no user', () => {
      auth.user.and.returnValue(null as any);
      comp.toggleViewMode();
      expect(localStorage.getItem('admin.orders.view.v1:anonymous')).toBe('kanban');
    });

    it('loadViewMode reads persisted values and falls back', () => {
      localStorage.setItem('admin.orders.view.v1:user-1', 'kanban');
      expect(comp['loadViewMode']()).toBe('kanban');
      localStorage.setItem('admin.orders.view.v1:user-1', 'bogus');
      expect(comp['loadViewMode']()).toBe('table');
    });

    it('loadViewMode falls back when storage throws', () => {
      spyOn(localStorage, 'getItem').and.throwError('blocked');
      expect(comp['loadViewMode']()).toBe('table');
    });

    it('persistViewMode swallows storage errors', () => {
      spyOn(localStorage, 'setItem').and.throwError('blocked');
      expect(() => comp['persistViewMode']()).not.toThrow();
    });

    it('loadExportState seeds defaults when nothing is stored', () => {
      comp['loadExportState']();
      expect(comp.exportColumns['id']).toBeTrue();
      expect(comp.exportColumns['payment_method']).toBeFalse();
    });

    it('loadExportState hydrates templates and selected template columns', () => {
      localStorage.setItem(
        'admin.orders.export.v1:user-1',
        JSON.stringify({
          templates: [
            { id: 't1', name: 'T1', createdAt: 'now', columns: ['status', 'currency'] },
            { bad: true },
          ],
          selectedTemplateId: 't1',
          columns: ['id'],
        }),
      );
      comp['loadExportState']();
      expect(comp.exportTemplates.length).toBe(1);
      expect(comp.exportColumns['status']).toBeTrue();
      expect(comp.exportColumns['id']).toBeFalse();
    });

    it('loadExportState falls back to defaults when stored columns are empty', () => {
      localStorage.setItem(
        'admin.orders.export.v1:user-1',
        JSON.stringify({ templates: 'nope', selectedTemplateId: 5, columns: ['unknown'] }),
      );
      comp['loadExportState']();
      expect(comp.exportTemplates).toEqual([]);
      expect(comp.exportColumns['id']).toBeTrue();
    });

    it('loadExportState recovers from malformed JSON', () => {
      localStorage.setItem('admin.orders.export.v1:user-1', '{not json');
      comp['loadExportState']();
      expect(comp.exportColumns['id']).toBeTrue();
    });

    it('loadPresets parses valid and rejects invalid payloads', () => {
      localStorage.setItem('admin.orders.filters.v1:user-1', 'null');
      expect(comp['loadPresets']()).toEqual([]);
      localStorage.setItem('admin.orders.filters.v1:user-1', '{not json');
      expect(comp['loadPresets']()).toEqual([]);
      localStorage.setItem(
        'admin.orders.filters.v1:user-1',
        JSON.stringify([
          {
            id: 'p1',
            name: 'P1',
            filters: { sla: 'ship_overdue', fraud: 'denied', includeTestOrders: 'x', limit: 'y' },
          },
          { bad: true },
        ]),
      );
      const presets = comp['loadPresets']();
      expect(presets.length).toBe(1);
      expect(presets[0].filters.sla).toBe('ship_overdue');
      expect(presets[0].filters.includeTestOrders).toBeTrue();
      expect(presets[0].filters.limit).toBe(20);
    });

    it('loadPresets coerces invalid sla/fraud to all', () => {
      localStorage.setItem(
        'admin.orders.filters.v1:user-1',
        JSON.stringify([
          { id: 'p1', name: 'P1', filters: { sla: 'weird', fraud: 'weird', limit: 40 } },
        ]),
      );
      const presets = comp['loadPresets']();
      expect(presets[0].filters.sla).toBe('all');
      expect(presets[0].filters.fraud).toBe('all');
      expect(presets[0].filters.limit).toBe(40);
    });

    it('loadPresets returns [] when nothing is stored', () => {
      expect(comp['loadPresets']()).toEqual([]);
    });

    it('persistPresets and persistExportState swallow storage errors', () => {
      spyOn(localStorage, 'setItem').and.throwError('blocked');
      expect(() => comp['persistPresets']()).not.toThrow();
      expect(() => comp['persistExportState']()).not.toThrow();
    });

    it('builds storage keys with an anonymous suffix for missing users', () => {
      auth.user.and.returnValue(null as any);
      expect(comp['storageKey']()).toBe('admin.orders.filters.v1:anonymous');
      expect(comp['exportStorageKey']()).toBe('admin.orders.export.v1:anonymous');
      expect(comp['tableLayoutStorageKey']()).toContain('anonymous');
    });
  });

  describe('branch + edge coverage', () => {
    function dropEvent(order: any, previousIndex = 0, currentIndex = 0): any {
      return { item: { data: order }, previousIndex, currentIndex };
    }

    it('onKanbanDrop bails when the dragged order has no status', () => {
      comp.onKanbanDrop(dropEvent({ id: 'a' }), 'shipped');
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('onKanbanDrop reorders when the source column is not yet tracked', () => {
      const order = makeOrder({ id: 'a', status: 'paid' });
      comp.kanbanItemsByStatus.set({});
      comp.onKanbanDrop(dropEvent(order, 0, 0), 'paid' as any);
      expect(comp.kanbanItemsByStatus()['paid']).toEqual([]);
      expect(ordersApi.update).not.toHaveBeenCalled();
    });

    it('onKanbanDrop requires a cancel reason when prompt is dismissed', () => {
      spyOn(window, 'prompt').and.returnValue(null);
      const order = makeOrder({ id: 'a', status: 'paid' });
      comp.onKanbanDrop(dropEvent(order), 'cancelled' as any);
      expect(toast.error).toHaveBeenCalledWith(
        'adminUi.orders.kanban.errors.cancelReasonRequired',
      );
    });

    it('onKanbanDrop moves a card even when columns are untracked', () => {
      const order = makeOrder({ id: 'a', status: 'paid' });
      comp.kanbanItemsByStatus.set({});
      comp.kanbanTotalsByStatus.set({});
      ordersApi.update.and.returnValue(of({ status: 'shipped' } as any));
      comp.onKanbanDrop(dropEvent(order), 'shipped' as any);
      expect(ordersApi.update).toHaveBeenCalled();
    });

    it('allowedKanbanTransitions handles orders with no status or payment method', () => {
      expect(comp['allowedKanbanTransitions']({} as any)).toEqual([]);
    });

    it('applySavedView returns when the view key is unknown', () => {
      favorites.items.and.returnValue([
        { key: 'other', type: 'filter', state: { adminFilterScope: 'orders' } } as any,
      ]);
      comp.applySavedView('missing');
      expect(comp.q).toBe('');
    });

    it('toggleCurrentViewPin requires a name when prompt is dismissed', () => {
      spyOn(window, 'prompt').and.returnValue(null);
      comp.toggleCurrentViewPin();
      expect(favorites.add).not.toHaveBeenCalled();
    });

    it('savePreset aborts when the prompt is dismissed', () => {
      spyOn(window, 'prompt').and.returnValue(null);
      comp.savePreset();
      expect(comp.presets.length).toBe(0);
    });

    it('saveExportTemplate aborts when the prompt is dismissed', () => {
      comp.exportColumns = { status: true };
      spyOn(window, 'prompt').and.returnValue(null);
      comp.saveExportTemplate();
      expect(comp.exportTemplates.length).toBe(0);
    });

    it('uploadAllShippingLabels treats a null assigned order as missing', () => {
      comp.shippingLabelsUploads = [
        { file: new File(['a'], 'a.pdf'), assignedOrderId: null, status: 'pending', error: null },
      ];
      comp.uploadAllShippingLabels();
      expect(comp.shippingLabelsUploads[0].status).toBe('error');
      expect(ordersApi.uploadShippingLabel).not.toHaveBeenCalled();
    });

    it('retryShippingLabelUpload treats a null assigned order as missing', () => {
      comp.shippingLabelsUploads = [
        { file: new File(['a'], 'a.pdf'), assignedOrderId: null, status: 'pending', error: null },
      ];
      comp.retryShippingLabelUpload(0);
      expect(comp.shippingLabelsUploads[0].status).toBe('error');
      expect(ordersApi.uploadShippingLabel).not.toHaveBeenCalled();
    });

    it('retryShippingLabelUpload error without a request id has no suffix', () => {
      comp.shippingLabelsUploads = [
        { file: new File(['a'], 'a.pdf'), assignedOrderId: 'o1', status: 'pending', error: null },
      ];
      ordersApi.uploadShippingLabel.and.returnValue(throwError(() => new Error('plain')));
      comp.retryShippingLabelUpload(0);
      expect(comp.shippingLabelsUploads[0].error).toBe(
        'adminUi.orders.shippingLabelsModal.errors.uploadFailed',
      );
    });

    it('autoAssignShippingLabel tolerates a file without a name', () => {
      comp.shippingLabelsOrderOptions = [{ id: 'o1', ref: 'REF', shortId: 'short', label: 'L' }];
      expect(comp['autoAssignShippingLabel']({} as any)).toBeNull();
    });

    it('buildShippingLabelsOrderOptions handles ids not present on the page', () => {
      comp.orders.set([]);
      comp.selectedIds = new Set(['ghost-id-1234']);
      const options = comp['buildShippingLabelsOrderOptions']();
      expect(options[0].ref).toBe('');
      expect(options[0].label).toBe('ghost-id');
    });

    it('applyExportTemplate tolerates a template without columns', () => {
      comp.exportTemplates = [{ id: 't1', name: 'T', createdAt: '', columns: undefined as any }];
      comp.applyExportTemplate('t1');
      expect(comp.exportColumns['status']).toBeFalse();
    });

    it('customerLabel falls back to guest for null fields', () => {
      expect(
        comp.customerLabel(makeOrder({ customer_email: null, customer_username: null })),
      ).toBe('adminUi.orders.guest');
    });

    it('filteredTagManagerRows tolerates empty tag rows while filtering', () => {
      comp.tagManagerRows.set([{ tag: '', count: 0 }]);
      comp.tagManagerQuery = 'zzz';
      expect(comp.filteredTagManagerRows()).toEqual([]);
    });

    it('setTagColor ignores a blank color value', () => {
      comp.setTagColor('vip', '');
      expect(localStorage.getItem(TAG_COLOR_STORAGE_KEY)).toBeNull();
    });

    it('applyBulkTags reports a removal failure', () => {
      comp.selectedIds = new Set(['o1']);
      comp.bulkTagRemove = 'gift';
      ordersApi.removeOrderTag.and.returnValue(throwError(() => new Error('x')));
      comp.applyBulkTags();
      expect(comp.selectedIds.has('o1')).toBeTrue();
      expect(toast.error).toHaveBeenCalledWith('adminUi.orders.bulk.partial');
    });

    it('renameTag requires a non-empty from tag', () => {
      comp.tagRenameFrom = '';
      comp.tagRenameTo = 'b';
      comp.renameTag();
      expect(comp.tagRenameError).toBe('adminUi.orders.tags.errors.renameRequired');
    });

    it('renameTag succeeds without color migration when the API echoes blanks', () => {
      comp.tagRenameFrom = 'old';
      comp.tagRenameTo = 'new';
      spyOn(window, 'confirm').and.returnValue(true);
      ordersApi.renameOrderTag.and.returnValue(
        of({ from_tag: '', to_tag: '', updated: 1, merged: 0, total: 2 }),
      );
      comp.renameTag();
      expect(toast.success).toHaveBeenCalledWith('adminUi.orders.tags.renamed');
    });

    it('slaBadge tolerates undefined kind and due fields', () => {
      expect(comp.slaBadge(makeOrder({ sla_kind: 'accept' }))).toBeNull();
      expect(comp.slaBadge(makeOrder({ sla_due_at: '2026-01-01T00:00:00Z' }))).toBeNull();
    });

    it('fraudBadge tolerates an undefined severity', () => {
      expect(comp.fraudBadge(makeOrder())).toBeNull();
    });

    it('loadKanban forwards every active filter', () => {
      comp.viewMode.set('kanban');
      comp.status = 'shipped';
      comp.q = ' query ';
      comp.tag = ' vip ';
      comp.sla = 'any_overdue';
      comp.fraud = 'queue';
      comp.includeTestOrders = false;
      comp.fromDate = '2026-01-01';
      comp.toDate = '2026-02-01';
      comp.retryLoad();
      const params = ordersApi.search.calls.mostRecent().args[0];
      expect(params.q).toBe('query');
      expect(params.tag).toBe('vip');
      expect(params.sla).toBe('any_overdue');
      expect(params.fraud).toBe('queue');
      expect(params.include_test).toBeFalse();
      expect(params.from).toBe('2026-01-01T00:00:00Z');
      expect(params.to).toBe('2026-02-01T23:59:59Z');
    });

    it('loadExportState maps templates with missing createdAt and columns', () => {
      localStorage.setItem(
        'admin.orders.export.v1:user-1',
        JSON.stringify({
          templates: [{ id: 't2', name: 'T2' }],
          selectedTemplateId: '',
          columns: 'not-an-array',
        }),
      );
      comp['loadExportState']();
      expect(comp.exportTemplates[0].createdAt).toBe('');
      expect(comp.exportTemplates[0].columns).toEqual([]);
      expect(comp.exportColumns['id']).toBeTrue();
    });

    it('loadPresets coerces every sla and fraud literal', () => {
      localStorage.setItem(
        'admin.orders.filters.v1:user-1',
        JSON.stringify([
          { id: 'a', name: 'A', filters: { sla: 'any_overdue', fraud: 'queue', includeTestOrders: false } },
          { id: 'b', name: 'B', filters: { sla: 'accept_overdue', fraud: 'flagged' } },
          { id: 'c', name: 'C', filters: { sla: 'ship_overdue', fraud: 'approved' } },
        ]),
      );
      const presets = comp['loadPresets']();
      expect(presets.map((p) => p.filters.sla)).toEqual([
        'any_overdue',
        'accept_overdue',
        'ship_overdue',
      ]);
      expect(presets.map((p) => p.filters.fraud)).toEqual(['queue', 'flagged', 'approved']);
      expect(presets[0].filters.includeTestOrders).toBeFalse();
    });

    it('loadPresets defaults sla and fraud when the fields are absent', () => {
      localStorage.setItem(
        'admin.orders.filters.v1:user-1',
        JSON.stringify([{ id: 'a', name: 'A', filters: { q: 'only-q' } }]),
      );
      const presets = comp['loadPresets']();
      expect(presets[0].filters.sla).toBe('all');
      expect(presets[0].filters.fraud).toBe('all');
    });
  });
});
