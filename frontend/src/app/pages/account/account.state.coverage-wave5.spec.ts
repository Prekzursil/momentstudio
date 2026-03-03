import { NavigationEnd } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { AccountState } from './account.state';
type Harness = {
  state: AccountState;
  auth: jasmine.SpyObj<any>;
  account: jasmine.SpyObj<any>;
  tickets: jasmine.SpyObj<any>;
};


beforeAll(() => {
  TestBed.configureTestingModule({});
});


function createRouterAndRoute() {
  const router = jasmine.createSpyObj('Router', ['navigateByUrl']);
  (router as any).events = of(new NavigationEnd(1, '/account/orders', '/account/orders'));
  const route = {
    snapshot: {
      queryParamMap: { get: () => null },
      queryParams: {},
      data: {},
      params: {},
    },
    queryParams: of({}),
    data: of({}),
    params: of({}),
  } as any;
  return { router, route };
}

function createServiceSpies() {
  const toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);
  const auth = jasmine.createSpyObj('AuthService', ['isAuthenticated']);
  auth.isAuthenticated.and.returnValue(true);

  const account = jasmine.createSpyObj('AccountService', ['getOrdersPage', 'getAddresses']);
  account.getOrdersPage.and.returnValue(
    of({
      items: [{ id: 'o-1', status: 'pending', updated_at: '2026-03-03T00:00:00Z' }],
      meta: { total_items: 1, total_pages: 3, page: 2, limit: 5 },
    }),
  );
  account.getAddresses.and.returnValue(of([{ id: 'a-1', line1: 'Street', city: 'Bucharest' }]));

  const tickets = jasmine.createSpyObj('TicketsService', ['listMine']);
  tickets.listMine.and.returnValue(
    of([
      { id: 't-1', updated_at: '2026-03-02T00:00:00Z' },
      { id: 't-2', updated_at: '2026-03-03T00:00:00Z' },
    ]),
  );

  return { toast, auth, account, tickets };
}

function createHarness(): Harness {
  const { router, route } = createRouterAndRoute();
  const { toast, auth, account, tickets } = createServiceSpies();

  const state = TestBed.runInInjectionContext(
    () =>
      new AccountState(
        toast as any,
        auth as any,
        account as any,
        jasmine.createSpyObj('BlogService', ['listMyComments']) as any,
        jasmine.createSpyObj('CartStore', ['clear']) as any,
        router as any,
        route,
        jasmine.createSpyObj('ApiService', ['patch']) as any,
        jasmine.createSpyObj('WishlistService', ['listMine']) as any,
        Object.assign(jasmine.createSpyObj('NotificationsService', ['refreshUnreadCount', 'unreadCount']), {
          unreadCount: jasmine.createSpy('unreadCount').and.returnValue(2),
        }) as any,
        tickets as any,
        Object.assign(jasmine.createSpyObj('CouponsService', ['listMine']), {
          listMine: jasmine.createSpy().and.returnValue(of([])),
        }) as any,
        Object.assign(jasmine.createSpyObj('ThemeService', ['mode', 'setMode']), {
          mode: jasmine.createSpy().and.returnValue('system'),
        }) as any,
        { language: () => 'en', setLanguage: () => undefined } as any,
        { instant: (key: string) => key, currentLang: 'en' } as any,
        Object.assign(jasmine.createSpyObj('GoogleLinkPendingService', ['getPending', 'clear']), {
          getPending: jasmine.createSpy().and.returnValue(null),
        }) as any,
      ),
  );

  return { state, auth, account, tickets };
}

describe('AccountState coverage wave 5 loaders', () => {
  it('covers loadOrders success, default-query latest order, and paging helpers', () => {
    const { state, account } = createHarness();
    state.page = 2;
    state.ordersQuery = ' ring ';
    state.orderFilter = 'pending';

    state.loadOrders();

    expect(account.getOrdersPage).toHaveBeenCalledWith(
      jasmine.objectContaining({ q: 'ring', status: 'pending', page: 2, limit: 5 }),
    );
    expect(state.orders().length).toBe(1);
    expect(state.totalPages).toBe(3);

    state.ordersQuery = '';
    state.orderFilter = '';
    state.ordersFrom = '';
    state.ordersTo = '';
    state.page = 1;
    state.loadOrders(true);
    expect(state.latestOrder()?.id).toBe('o-1');

    state.totalPages = 3;
    state.page = 1;
    state.nextPage();
    expect(state.page).toBe(2);
    state.prevPage();
    expect(state.page).toBe(1);
  });
});

describe('AccountState coverage wave 5 loaders: orders guards', () => {
  it('covers loadOrders guards plus invalid-range and generic error mapping', () => {
    const { state, auth, account } = createHarness();

    auth.isAuthenticated.and.returnValue(false);
    state.loadOrders();
    expect(account.getOrdersPage).not.toHaveBeenCalled();

    auth.isAuthenticated.and.returnValue(true);
    state.ordersLoading.set(true);
    state.loadOrders();
    expect(account.getOrdersPage).not.toHaveBeenCalled();

    state.ordersLoading.set(false);
    account.getOrdersPage.and.returnValue(throwError(() => ({ error: { detail: 'Invalid date range' } })));
    state.loadOrders(true);
    expect(state.ordersError()).toBe('account.orders.invalidDateRange');

    account.getOrdersPage.and.returnValue(throwError(() => ({ error: { detail: 'Other' } })));
    state.loadOrders(true);
    expect(state.ordersError()).toBe('account.orders.loadError');

    state.ordersFrom = '2026-03-03';
    state.ordersTo = '2026-03-01';
    state.applyOrderFilters();
    expect(state.ordersError()).toBe('account.orders.invalidDateRange');
  });
});

describe('AccountState coverage wave 5 loaders: address and tickets', () => {
  it('covers loadAddresses/loadTickets success and failure branches', () => {
    const { state, account, tickets } = createHarness();

    state.loadAddresses();
    expect(state.addresses().length).toBe(1);
    expect(state.addressesLoaded()).toBeTrue();

    account.getAddresses.and.returnValue(throwError(() => new Error('boom')));
    state.loadAddresses(true);
    expect(state.addressesError()).toBe('account.addresses.loadError');

    state.loadTickets();
    expect(state.tickets().map((it: any) => it.id)).toEqual(['t-2', 't-1']);
    expect(state.ticketsLoaded()).toBeTrue();

    tickets.listMine.and.returnValue(throwError(() => new Error('ticket-fail')));
    state.loadTickets(true);
    expect(state.tickets()).toEqual([]);
    expect(state.ticketsError()).toBe('account.overview.support.loadError');
  });
});

