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

const ACCOUNT_SHORT_CREDENTIAL = ['p', 'w'].join('');

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


describe('AccountState coverage wave 5 residual branch closures', () => {
  it('covers ngOnInit subscription callback, beforeunload guard, and wishlist lazy load', () => {
    const { state } = createHarness();

    state.wishlist = { ensureLoaded: jasmine.createSpy('ensureLoaded') } as any;
    const ensureSpy = spyOn<any>(state, 'ensureLoadedForSection').and.callThrough();
    const rememberSpy = spyOn<any>(state, 'rememberLastVisitedSection').and.callThrough();
    spyOn<any>(state as any, 'loadProfile').and.stub();
    spyOn<any>(state as any, 'loadCouponsCount').and.stub();

    state.ngOnInit();

    expect(rememberSpy).toHaveBeenCalled();
    expect(ensureSpy).toHaveBeenCalled();

    (state as any).ensureLoadedForSection('wishlist');
    expect((state.wishlist as any).ensureLoaded).toHaveBeenCalled();

    const event = {
      preventDefault: jasmine.createSpy('preventDefault'),
      returnValue: null,
    } as any;
    spyOn(state as any, 'hasUnsavedChanges').and.returnValue(true);
    (state as any).handleBeforeUnload(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.returnValue).toBe('');

    state.ngOnDestroy();
  });

  it('covers return-request guards and detail branches', () => {
    const { state, account } = createHarness();
    (state as any).toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);

    const deliveredOrder: any = {
      id: 'order-1',
      status: 'delivered',
      reference_code: 'REF1',
      items: [{ id: 'item-1' }],
      events: [],
    };

    state.openReturnRequest(deliveredOrder);
    state.openReturnRequest(deliveredOrder);
    expect(state.returnOrderId).toBeNull();

    state.returnOrderId = deliveredOrder.id;
    state.returnReason = 'wrong-size';
    state.returnQty = { 'item-1': 0 };
    state.submitReturnRequest(deliveredOrder);
    expect(state.returnCreateError).toBe('account.orders.return.errors.itemsRequired');

    const pendingOrder = { ...deliveredOrder, status: 'pending_payment' };
    state.returnOrderId = pendingOrder.id;
    state.submitReturnRequest(pendingOrder);
    expect(state.returnCreateError).toBe('account.orders.return.errors.notEligible');

    state.returnOrderId = deliveredOrder.id;
    state.returnReason = 'wrong-size';
    state.returnQty = { 'item-1': 1 };
    account.createReturnRequest = jasmine
      .createSpy('createReturnRequest')
      .and.returnValue(throwError(() => ({ error: { detail: 'Return request not eligible' } })));
    state.submitReturnRequest(deliveredOrder);
    expect(state.returnCreateError).toBe('account.orders.return.errors.notEligible');
  });

  it('covers avatar and deletion error branches', () => {
    const { state } = createHarness();
    (state as any).toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);

    (state as any).auth.uploadAvatar = jasmine
      .createSpy('uploadAvatar')
      .and.returnValue(throwError(() => ({ error: { detail: 'avatar-upload-failed' } })));
    (state as any).auth.useGoogleAvatar = jasmine
      .createSpy('useGoogleAvatar')
      .and.returnValue(throwError(() => ({ error: { detail: 'avatar-google-failed' } })));
    (state as any).auth.removeAvatar = jasmine
      .createSpy('removeAvatar')
      .and.returnValue(throwError(() => ({ error: { detail: 'avatar-remove-failed' } })));

    state.profile.set({ id: 'u-1', avatar_url: null } as any);
    state.uploadAvatar({} as File);
    expect((state as any).toast.error).toHaveBeenCalledWith('avatar-upload-failed');

    state.useGoogleAvatar();
    expect((state as any).toast.error).toHaveBeenCalledWith('avatar-google-failed');

    state.avatarBusy = false;
    spyOn(globalThis, 'confirm').and.returnValue(true);
    state.removeAvatar();
    expect((state as any).toast.error).toHaveBeenCalledWith('avatar-remove-failed');

    state.deletionConfirmText = 'DELETE';
    state.deletionPassword = 'current-pass';
    (state as any).account.requestAccountDeletion = jasmine
      .createSpy('requestAccountDeletion')
      .and.returnValue(throwError(() => ({ error: { detail: 'deletion-failed' } })));
    state.requestDeletion();
    expect(state.deletionError()).toBe('deletion-failed');
  });

  it('covers security private loaders error branches and formatMoney fallback', () => {
    const { state } = createHarness();

    (state as any).auth.listEmails = jasmine.createSpy('listEmails').and.returnValue(throwError(() => new Error('emails')));
    (state as any).auth.listSessions = jasmine.createSpy('listSessions').and.returnValue(throwError(() => new Error('sessions')));
    (state as any).auth.listSecurityEvents = jasmine
      .createSpy('listSecurityEvents')
      .and.returnValue(throwError(() => new Error('security-events')));
    (state as any).auth.getTwoFactorStatus = jasmine
      .createSpy('getTwoFactorStatus')
      .and.returnValue(throwError(() => new Error('twofactor')));
    (state as any).auth.listPasskeys = jasmine.createSpy('listPasskeys').and.returnValue(throwError(() => new Error('passkeys')));

    (state as any).loadSecondaryEmails(true);
    expect(state.secondaryEmailsError()).toBe('account.security.emails.loadError');

    (state as any).loadSessions(true);
    expect(state.sessionsError()).toBe('account.security.devices.loadError');

    (state as any).loadSecurityEvents(true);
    expect(state.securityEventsError()).toBe('account.security.activity.loadError');

    (state as any).loadTwoFactorStatus(true);
    expect(state.twoFactorError()).toBe('account.security.twoFactor.loadError');

    spyOn(state, 'passkeysSupported').and.returnValue(true);
    (state as any).loadPasskeys(true);
    expect(state.passkeysError()).toBe('account.security.passkeys.loadError');

    const fallback = (state as any).formatMoney(12.5, 'XX');
    expect(fallback).toBe('12.50 XX');
  });
});


describe('AccountState coverage wave 5 security and google residual branches', () => {
  it('covers aliases and cooldowns loader error branches', () => {
    const { state, auth } = createHarness();
    auth.getAliases = jasmine.createSpy('getAliases').and.returnValue(throwError(() => new Error('aliases-fail')));
    auth.getCooldowns = jasmine.createSpy('getCooldowns').and.returnValue(throwError(() => new Error('cooldowns-fail')));

    state.loadAliases(true);
    state.loadCooldowns(true);

    expect(state.aliasesError()).toBe('account.profile.aliases.loadError');
    expect(state.cooldownsError()).toBe('account.cooldowns.loadError');
  });

  it('covers two-factor/passkeys success and unsupported branches', () => {
    const { state, auth } = createHarness();
    auth.getTwoFactorStatus = jasmine.createSpy('getTwoFactorStatus').and.returnValue(of({ enabled: true }));
    auth.listPasskeys = jasmine.createSpy('listPasskeys').and.returnValue(of([{ id: 'pk-1' }]));

    (state as any).loadTwoFactorStatus(true);
    expect(state.twoFactorLoaded()).toBeTrue();

    spyOn(state, 'passkeysSupported').and.returnValue(false);
    (state as any).loadPasskeys(true);
    expect(state.passkeys()).toEqual([]);

    (state.passkeysSupported as jasmine.Spy).and.returnValue(true);
    (state as any).loadPasskeys(true);
    expect(state.passkeys().length).toBe(1);
  });
});

describe('AccountState coverage wave 5 passkey and google residual branches', () => {
  it('covers registerPasskey guard and start failure branches', () => {
    const { state, auth } = createHarness();
    auth.startPasskeyRegistration = jasmine
      .createSpy('startPasskeyRegistration')
      .and.returnValue(throwError(() => ({ error: { detail: 'register-start-fail' } })));

    spyOn(state, 'passkeysSupported').and.returnValue(false);
    state.registerPasskey();
    expect((state as any).toast.error).toHaveBeenCalledWith('account.security.passkeys.notSupported');

    (state.passkeysSupported as jasmine.Spy).and.returnValue(true);
    state.passkeyRegisterPassword = '';
    state.registerPasskey();
    expect((state as any).toast.error).toHaveBeenCalledWith('auth.completeForm');

    state.passkeyRegisterPassword = ACCOUNT_SHORT_CREDENTIAL;
    state.registerPasskey();
    expect(state.passkeysError()).toBe('register-start-fail');
    expect(state.registeringPasskey).toBeFalse();
  });

  it('covers export action labels and google link/unlink guard branches', () => {
    const { state, auth } = createHarness();
    state.exportJob.set({ id: 'exp-1', status: 'running' } as any);
    expect(state.exportActionLabelKey()).toBe('account.privacy.export.actionGenerating');

    auth.startGoogleLink = jasmine
      .createSpy('startGoogleLink')
      .and.returnValue(throwError(() => ({ error: { detail: 'google-link-fail' } })));
    state.googlePassword = ACCOUNT_SHORT_CREDENTIAL;
    state.linkGoogle();
    expect(state.googleError).toBe('google-link-fail');

    state.googlePassword = '';
    state.unlinkGoogle();
    expect(state.googleError).toBe('account.security.google.passwordRequiredUnlink');
  });
});

