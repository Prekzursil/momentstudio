import { Component, signal, WritableSignal } from '@angular/core';
import { TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';

import { AccountState } from './account.state';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { AccountService } from '../../core/account.service';
import { BlogService } from '../../core/blog.service';
import { CartStore } from '../../core/cart.store';
import { LanguageService } from '../../core/language.service';
import { NotificationsService } from '../../core/notifications.service';
import { CouponsService } from '../../core/coupons.service';
import { GoogleLinkPendingService } from '../../core/google-link-pending.service';
import { ThemeService } from '../../core/theme.service';
import { ToastService } from '../../core/toast.service';
import { TicketsService } from '../../core/tickets.service';
import { WishlistService } from '../../core/wishlist.service';

// Minimal concrete host so the abstract @Directive() base can be instantiated by
// Angular DI (mirrors how AccountComponent extends AccountState) while keeping an
// empty template so no DOM/template logic interferes with the state under test.
@Component({ selector: 'app-account-state-host', standalone: true, template: '' })
class HostComponent extends AccountState {
  constructor(
    toast: ToastService,
    auth: AuthService,
    account: AccountService,
    blog: BlogService,
    cart: CartStore,
    router: Router,
    route: ActivatedRoute,
    api: ApiService,
    wishlist: WishlistService,
    notifications: NotificationsService,
    tickets: TicketsService,
    coupons: CouponsService,
    googleLinkPendingService: GoogleLinkPendingService,
    theme: ThemeService,
    lang: LanguageService,
    translate: TranslateService,
  ) {
    super(
      toast,
      auth,
      account,
      blog,
      cart,
      router,
      route,
      api,
      wishlist,
      notifications,
      tickets,
      coupons,
      theme,
      lang,
      translate,
      googleLinkPendingService,
    );
  }
}

const PROFILE_FULL: any = {
  id: 'u1',
  email: 'user@example.com',
  role: 'customer',
  name: 'User',
  username: 'user1',
  name_tag: 42,
  first_name: 'First',
  middle_name: 'Mid',
  last_name: 'Last',
  date_of_birth: '1990-01-01',
  phone: '+40723204204',
  avatar_url: 'http://x/a.png',
  email_verified: true,
  preferred_language: 'en',
  notify_blog_comments: true,
  notify_blog_comment_replies: true,
  notify_marketing: true,
  google_sub: 'g1',
  google_email: 'g@example.com',
  google_picture_url: 'http://x/g.png',
  updated_at: '2000-01-02T00:00:00+00:00',
};

const PROFILE_MIN: any = {
  id: 'u2',
  email: 'min@example.com',
  role: 'customer',
  preferred_language: 'ro',
};

function makeOrder(overrides: any = {}): any {
  return {
    id: 'o1',
    reference_code: 'REF1',
    status: 'delivered',
    total_amount: 20,
    currency: 'RON',
    tracking_number: 'TRK1',
    payment_method: 'stripe',
    courier: 'sameday',
    delivery_type: 'home',
    created_at: '2000-01-03T00:00:00+00:00',
    updated_at: '2000-01-03T00:00:00+00:00',
    events: [],
    items: [{ id: 'i1', product_id: 'p1', variant_id: 'v1', quantity: 2 }],
    ...overrides,
  };
}

function makeAddress(overrides: any = {}): any {
  return {
    id: 'a1',
    label: 'home',
    line1: '123 Main',
    line2: null,
    city: 'Bucharest',
    region: 'IF',
    postal_code: '010203',
    country: 'RO',
    phone: null,
    is_default_shipping: true,
    is_default_billing: false,
    ...overrides,
  };
}

function setClipboard(impl: any): void {
  Object.defineProperty(navigator, 'clipboard', { value: impl, configurable: true });
}

// Errored observables never fire `complete`, so the busy/guard flags the source
// resets only in `complete` stay set. Tests that exercise consecutive error
// branches reset those guards between invocations to mirror a fresh user action.
function resetBusy(s: any): void {
  s.reorderingOrderId = null;
  s.reorderingOrderItemId = null;
  s.requestingCancel = false;
  s.creatingReturn = false;
  s.downloadingReceiptId = null;
  s.sharingReceiptId = null;
  s.revokingReceiptId = null;
  s.avatarBusy = false;
  s.requestingDeletion = false;
  s.cancellingDeletion = false;
  s.exportingData = false;
  s.removingPasskeyId = null;
  s.registeringPasskey = false;
  s.startingTwoFactor = false;
  s.enablingTwoFactor = false;
  s.regeneratingTwoFactorCodes = false;
  s.disablingTwoFactor = false;
  s.revokingOtherSessions = false;
  s.makingPrimaryEmail = false;
  s.addingSecondaryEmail = false;
  s.verifyingSecondaryEmail = false;
  s.removingSecondaryEmail = false;
  s.googleBusy = false;
}

describe('AccountState', () => {
  let toast: jasmine.SpyObj<ToastService>;
  let auth: jasmine.SpyObj<AuthService>;
  let account: jasmine.SpyObj<AccountService>;
  let blog: jasmine.SpyObj<BlogService>;
  let cart: jasmine.SpyObj<CartStore>;
  let api: jasmine.SpyObj<ApiService>;
  let coupons: jasmine.SpyObj<CouponsService>;
  let translate: jasmine.SpyObj<TranslateService>;
  let googlePending: jasmine.SpyObj<GoogleLinkPendingService>;
  let wishlist: any;
  let notifications: any;
  let tickets: jasmine.SpyObj<TicketsService>;
  let theme: any;
  let lang: any;
  let routerEvents: Subject<any>;
  let router: any;
  let route: any;
  let prefSig: WritableSignal<any>;
  let translations: Record<string, string>;
  let queryComplete: string | null;
  let pendingLink: any;

  let created: AccountState | null;

  function build(): HostComponent {
    const fixture = TestBed.createComponent(HostComponent);
    created = fixture.componentInstance;
    return fixture.componentInstance;
  }

  beforeEach(() => {
    localStorage.clear();
    translations = {};
    queryComplete = null;
    pendingLink = null;
    created = null;

    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);

    auth = jasmine.createSpyObj<AuthService>('AuthService', [
      'isAuthenticated',
      'isAdmin',
      'requestEmailVerification',
      'uploadAvatar',
      'useGoogleAvatar',
      'removeAvatar',
      'refresh',
      'logout',
      'updateUsername',
      'updateProfile',
      'getAliases',
      'getCooldowns',
      'updateNotificationPreferences',
      'listEmails',
      'listSessions',
      'listSecurityEvents',
      'getTwoFactorStatus',
      'listPasskeys',
      'startPasskeyRegistration',
      'completePasskeyRegistration',
      'deletePasskey',
      'startTwoFactorSetup',
      'enableTwoFactor',
      'regenerateTwoFactorRecoveryCodes',
      'disableTwoFactor',
      'loadCurrentUser',
      'revokeOtherSessions',
      'addSecondaryEmail',
      'requestSecondaryEmailVerification',
      'confirmSecondaryEmailVerification',
      'deleteSecondaryEmail',
      'makeSecondaryEmailPrimary',
      'completeGoogleLink',
      'startGoogleLink',
      'unlinkGoogle',
    ]);
    auth.isAuthenticated.and.returnValue(true);
    auth.isAdmin.and.returnValue(false);
    auth.requestEmailVerification.and.returnValue(of({ detail: 'ok' } as any));
    auth.uploadAvatar.and.returnValue(of(PROFILE_FULL));
    auth.useGoogleAvatar.and.returnValue(of(PROFILE_FULL));
    auth.removeAvatar.and.returnValue(of(PROFILE_FULL));
    auth.refresh.and.returnValue(of({ access: 'a', refresh: 'r' } as any));
    auth.logout.and.returnValue(of(void 0));
    auth.updateUsername.and.returnValue(of(PROFILE_FULL));
    auth.updateProfile.and.returnValue(of(PROFILE_FULL));
    auth.getAliases.and.returnValue(of({ usernames: [], display_names: [] } as any));
    auth.getCooldowns.and.returnValue(
      of({ username: null, display_name: null, email: null } as any),
    );
    auth.updateNotificationPreferences.and.returnValue(of(PROFILE_FULL));
    auth.listEmails.and.returnValue(
      of({ primary_email: 'user@example.com', primary_verified: true, secondary_emails: [] } as any),
    );
    auth.listSessions.and.returnValue(of([]));
    auth.listSecurityEvents.and.returnValue(of([]));
    auth.getTwoFactorStatus.and.returnValue(of({ enabled: false } as any));
    auth.listPasskeys.and.returnValue(of([]));
    auth.startPasskeyRegistration.and.returnValue(
      of({ options: { challenge: '', user: { id: '' } }, registration_token: 'rt' } as any),
    );
    auth.completePasskeyRegistration.and.returnValue(of({ id: 'pk1' } as any));
    auth.deletePasskey.and.returnValue(of(void 0));
    auth.startTwoFactorSetup.and.returnValue(of({ secret: 'S', otpauth_url: '' } as any));
    auth.enableTwoFactor.and.returnValue(of({ recovery_codes: ['c1', 'c2'] } as any));
    auth.regenerateTwoFactorRecoveryCodes.and.returnValue(of({ recovery_codes: ['c3'] } as any));
    auth.disableTwoFactor.and.returnValue(of({ enabled: false } as any));
    auth.loadCurrentUser.and.returnValue(of(PROFILE_FULL));
    auth.revokeOtherSessions.and.returnValue(of({ revoked: 2 } as any));
    auth.addSecondaryEmail.and.returnValue(of({ id: 'se1', email: 'b@example.com' } as any));
    auth.requestSecondaryEmailVerification.and.returnValue(of({ detail: 'ok' } as any));
    auth.confirmSecondaryEmailVerification.and.returnValue(
      of({ id: 'se1', verified_at: null } as any),
    );
    auth.deleteSecondaryEmail.and.returnValue(of(void 0));
    auth.makeSecondaryEmailPrimary.and.returnValue(of(PROFILE_FULL));
    auth.completeGoogleLink.and.returnValue(of(PROFILE_FULL));
    auth.startGoogleLink.and.returnValue(of() as any);
    auth.unlinkGoogle.and.returnValue(of(PROFILE_FULL));

    account = jasmine.createSpyObj<AccountService>('AccountService', [
      'getProfile',
      'getOrdersPage',
      'getAddresses',
      'reorderOrder',
      'createReturnRequest',
      'requestOrderCancellation',
      'downloadReceipt',
      'shareReceipt',
      'revokeReceiptShare',
      'createAddress',
      'updateAddress',
      'deleteAddress',
      'getDeletionStatus',
      'requestAccountDeletion',
      'cancelAccountDeletion',
      'getLatestExportJob',
      'getExportJob',
      'startExportJob',
      'downloadExportJob',
    ]);
    account.getProfile.and.returnValue(of(PROFILE_FULL));
    account.getOrdersPage.and.returnValue(
      of({
        items: [makeOrder()],
        meta: { total_items: 1, total_pages: 1, page: 1, limit: 5, pending_count: 0 },
      } as any),
    );
    account.getAddresses.and.returnValue(of([makeAddress()]));
    account.reorderOrder.and.returnValue(of({}));
    account.createReturnRequest.and.returnValue(of({} as any));
    account.requestOrderCancellation.and.returnValue(of(makeOrder({ status: 'cancelled' })));
    account.downloadReceipt.and.returnValue(of(new Blob(['pdf'])));
    account.shareReceipt.and.returnValue(
      of({ receipt_url: 'http://x/r', expires_at: new Date(Date.now() + 3600_000).toISOString() } as any),
    );
    account.revokeReceiptShare.and.returnValue(of({} as any));
    account.createAddress.and.returnValue(of(makeAddress({ id: 'a2', is_default_shipping: false })));
    account.updateAddress.and.returnValue(of(makeAddress()));
    account.deleteAddress.and.returnValue(of(void 0));
    account.getDeletionStatus.and.returnValue(
      of({ requested_at: null, scheduled_for: null, deleted_at: null, cooldown_hours: 24 }),
    );
    account.requestAccountDeletion.and.returnValue(
      of({ requested_at: 'now', scheduled_for: 'later', deleted_at: null, cooldown_hours: 24 }),
    );
    account.cancelAccountDeletion.and.returnValue(
      of({ requested_at: null, scheduled_for: null, deleted_at: null, cooldown_hours: 24 }),
    );
    account.getLatestExportJob.and.returnValue(of({ id: 'j1', status: 'succeeded' } as any));
    account.getExportJob.and.returnValue(of({ id: 'j1', status: 'succeeded' } as any));
    account.startExportJob.and.returnValue(of({ id: 'j1', status: 'pending' } as any));
    account.downloadExportJob.and.returnValue(of(new Blob(['json'])));

    blog = jasmine.createSpyObj<BlogService>('BlogService', ['listMyComments']);
    blog.listMyComments.and.returnValue(
      of({ items: [], meta: { total_items: 0, total_pages: 2, page: 1, limit: 10 } }),
    );

    cart = jasmine.createSpyObj<CartStore>('CartStore', ['loadFromBackend']);

    api = jasmine.createSpyObj<ApiService>('ApiService', ['post', 'get', 'delete']);
    api.post.and.returnValue(of({}));

    coupons = jasmine.createSpyObj<CouponsService>('CouponsService', ['myCoupons']);
    coupons.myCoupons.and.returnValue(of([]));

    tickets = jasmine.createSpyObj<TicketsService>('TicketsService', ['listMine']);
    tickets.listMine.and.returnValue(of([]));

    translate = jasmine.createSpyObj<TranslateService>('TranslateService', ['instant']);
    translate.instant.and.callFake((key: any) => translations[key] ?? key);

    googlePending = jasmine.createSpyObj<GoogleLinkPendingService>('GoogleLinkPendingService', [
      'getPending',
      'clear',
    ]);
    googlePending.getPending.and.callFake(() => pendingLink);

    wishlist = {
      ensureLoaded: jasmine.createSpy('ensureLoaded'),
      isLoaded: jasmine.createSpy('isLoaded').and.returnValue(true),
      items: jasmine.createSpy('items').and.returnValue([]),
      clear: jasmine.createSpy('clear'),
    };

    notifications = {
      unreadCount: jasmine.createSpy('unreadCount').and.returnValue(0),
      refreshUnreadCount: jasmine.createSpy('refreshUnreadCount'),
    };

    prefSig = signal<any>('system');
    theme = {
      preference: jasmine.createSpy('preference').and.callFake(() => prefSig),
      setPreference: jasmine.createSpy('setPreference'),
    };

    lang = {
      language: signal('en'),
      setLanguage: jasmine.createSpy('setLanguage'),
    };

    routerEvents = new Subject<any>();
    router = {
      events: routerEvents.asObservable(),
      url: '/account/overview',
      navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)),
      navigateByUrl: jasmine.createSpy('navigateByUrl').and.returnValue(Promise.resolve(true)),
    };

    route = {
      snapshot: { queryParamMap: { get: (k: string) => (k === 'complete' ? queryComplete : null) } },
    };

    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: auth },
        { provide: AccountService, useValue: account },
        { provide: BlogService, useValue: blog },
        { provide: CartStore, useValue: cart },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: route },
        { provide: ApiService, useValue: api },
        { provide: WishlistService, useValue: wishlist },
        { provide: NotificationsService, useValue: notifications },
        { provide: TicketsService, useValue: tickets },
        { provide: CouponsService, useValue: coupons },
        { provide: GoogleLinkPendingService, useValue: googlePending },
        { provide: ThemeService, useValue: theme },
        { provide: LanguageService, useValue: lang },
        { provide: TranslateService, useValue: translate },
      ],
    });
  });

  afterEach(() => {
    if (created) {
      created.ngOnDestroy();
      created = null;
    }
  });

  // ---- constructor / lifecycle -------------------------------------------------

  it('runs the phone-countries effect on change detection', () => {
    const fixture = TestBed.createComponent(HostComponent);
    created = fixture.componentInstance;
    queryComplete = null;
    router.url = '/account/profile';
    fixture.detectChanges(); // triggers effect + ngOnInit
    expect(created.phoneCountries.length).toBeGreaterThan(0);
    expect(account.getProfile).toHaveBeenCalled();
    expect(notifications.refreshUnreadCount).toHaveBeenCalled();
  });

  it('ngOnInit on account root navigates to remembered section (force completion → profile)', () => {
    const s = build();
    queryComplete = '1';
    router.url = '/account';
    s.ngOnInit();
    expect(router.navigate).toHaveBeenCalledWith(
      ['profile'],
      jasmine.objectContaining({ replaceUrl: true }),
    );
  });

  it('ngOnInit on account root maps a password remembered section to overview', () => {
    const s = build();
    queryComplete = null;
    router.url = '/account';
    spyOn(s as any, 'lastVisitedSection').and.returnValue('password');
    s.ngOnInit();
    expect(router.navigate).toHaveBeenCalledWith(['overview'], jasmine.anything());
  });

  it('ngOnInit on a deep url remembers and loads that section, reacts to NavigationEnd', () => {
    const s = build();
    router.url = '/account/orders';
    s.ngOnInit();
    expect(account.getOrdersPage).toHaveBeenCalled();
    routerEvents.next(new NavigationEnd(1, '/account/addresses', '/account/addresses'));
    expect(account.getAddresses).toHaveBeenCalled();
    expect(localStorage.getItem('account.lastSection')).toBe('addresses');
  });

  it('ngOnInit picks up a pending google link context', () => {
    pendingLink = { code: 'c', state: 'st' };
    const s = build();
    router.url = '/account/security';
    s.ngOnInit();
    expect(s.googleLinkPending).toBeTrue();
  });

  it('retryAccountLoad reloads profile and current section', () => {
    const s = build();
    router.url = '/account/overview';
    s.retryAccountLoad();
    expect(account.getProfile).toHaveBeenCalled();
  });

  // ---- url helpers -------------------------------------------------------------

  it('activeSectionFromUrl / isAccountRootUrl / navigationSection cover edge cases', () => {
    const s = build() as any;
    expect(s.activeSectionFromUrl('')).toBe('overview');
    expect(s.activeSectionFromUrl('/shop/list')).toBe('overview');
    expect(s.activeSectionFromUrl('/account')).toBe('overview');
    expect(s.activeSectionFromUrl('/account/orders?x=1#y')).toBe('orders');
    expect(s.isAccountRootUrl('/shop')).toBeFalse();
    expect(s.isAccountRootUrl('/account')).toBeTrue();
    expect(s.isAccountRootUrl('/account/orders')).toBeFalse();
    router.url = '/account/password';
    expect(s.navigationSection()).toBe('security');
    router.url = '/account/orders';
    expect(s.navigationSection()).toBe('orders');
  });

  it('navigateToSection ignores empty/password and routes others', () => {
    const s = build();
    s.navigateToSection('');
    s.navigateToSection('password');
    expect(router.navigate).not.toHaveBeenCalled();
    s.navigateToSection('overview');
    expect(router.navigate).toHaveBeenCalledWith(['overview'], jasmine.anything());
    s.navigateToSection('orders');
    expect(router.navigate).toHaveBeenCalledWith(['orders'], jasmine.anything());
  });

  it('lastVisitedSection validates storage and handles errors', () => {
    const s = build() as any;
    localStorage.setItem('account.lastSection', 'orders');
    expect(s.lastVisitedSection()).toBe('orders');
    localStorage.setItem('account.lastSection', 'nope');
    expect(s.lastVisitedSection()).toBe('overview');
    spyOn(localStorage, 'getItem').and.throwError('boom');
    expect(s.lastVisitedSection()).toBe('overview');
  });

  it('rememberLastVisitedSection skips password and survives storage errors', () => {
    const s = build() as any;
    s.rememberLastVisitedSection('password');
    expect(localStorage.getItem('account.lastSection')).toBeNull();
    s.rememberLastVisitedSection('orders');
    expect(localStorage.getItem('account.lastSection')).toBe('orders');
    spyOn(localStorage, 'setItem').and.throwError('boom');
    expect(() => s.rememberLastVisitedSection('profile')).not.toThrow();
  });

  it('ensureLoadedForSection dispatches per section', () => {
    const s = build() as any;
    s.ensureLoadedForSection('profile');
    s.ensureLoadedForSection('orders');
    s.ensureLoadedForSection('addresses');
    s.ensureLoadedForSection('wishlist');
    s.ensureLoadedForSection('coupons');
    s.ensureLoadedForSection('notifications');
    s.ensureLoadedForSection('password');
    s.ensureLoadedForSection('security');
    expect(auth.getTwoFactorStatus).toHaveBeenCalled();
    // comments: first load (no meta), then skip when meta present
    s.ensureLoadedForSection('comments');
    expect(blog.listMyComments).toHaveBeenCalledTimes(1);
    s.ensureLoadedForSection('comments');
    expect(blog.listMyComments).toHaveBeenCalledTimes(1);
    // privacy: first loads deletion status, then skips when present
    s.ensureLoadedForSection('privacy');
    expect(account.getDeletionStatus).toHaveBeenCalledTimes(1);
    s.ensureLoadedForSection('privacy');
    expect(account.getDeletionStatus).toHaveBeenCalledTimes(1);
    s.ensureLoadedForSection('overview');
    expect(tickets.listMine).toHaveBeenCalled();
  });

  // ---- counts / coupons --------------------------------------------------------

  it('unreadNotificationsCount and pendingOrdersCount', () => {
    const s = build();
    notifications.unreadCount.and.returnValue(3);
    expect(s.unreadNotificationsCount()).toBe(3);
    expect(s.pendingOrdersCount()).toBe(0);
    (s as any).ordersMeta.set({ pending_count: 5 } as any);
    expect(s.pendingOrdersCount()).toBe(5);
  });

  it('loadCouponsCount filters available coupons and guards re-entry', () => {
    const s = build();
    const future = new Date(Date.now() + 86400_000).toISOString();
    const past = new Date(Date.now() - 86400_000).toISOString();
    coupons.myCoupons.and.returnValue(
      of([
        { is_active: true, promotion: { is_active: true }, starts_at: past, ends_at: future },
        { is_active: false },
        { is_active: true, promotion: { is_active: false } },
        { is_active: true, starts_at: future },
        { is_active: true, ends_at: past },
        { is_active: true },
        null,
      ] as any),
    );
    s.loadCouponsCount();
    expect(s.couponsCount()).toBe(2);
    expect(s.couponsCountLoaded()).toBeTrue();
    // guard: already loaded
    s.loadCouponsCount();
    expect(coupons.myCoupons).toHaveBeenCalledTimes(1);
    // guard: loading in flight
    (s as any).couponsCountLoaded.set(false);
    (s as any).couponsCountLoading.set(true);
    s.loadCouponsCount();
    expect(coupons.myCoupons).toHaveBeenCalledTimes(1);
  });

  it('loadCouponsCount returns early when unauthenticated', () => {
    const s = build();
    auth.isAuthenticated.and.returnValue(false);
    s.loadCouponsCount();
    expect(coupons.myCoupons).not.toHaveBeenCalled();
  });

  it('loadCouponsCount handles error', () => {
    const s = build();
    coupons.myCoupons.and.returnValue(throwError(() => new Error('x')));
    resetBusy(s);
    s.loadCouponsCount(true);
    expect(s.couponsCount()).toBe(0);
    expect(s.couponsCountLoaded()).toBeTrue();
  });

  // ---- profile load ------------------------------------------------------------

  it('loadProfile populates state from a full profile', () => {
    const s = build() as any;
    s.loadProfile();
    expect(s.profile()).toEqual(PROFILE_FULL);
    expect(s.profilePhoneCountry).toBe('RO');
    expect(s.emailVerified()).toBeTrue();
    // re-entry guards
    s.loadProfile();
    expect(account.getProfile).toHaveBeenCalledTimes(1);
    s.loading.set(true);
    s.profileLoaded = false;
    s.loadProfile();
    expect(account.getProfile).toHaveBeenCalledTimes(1);
  });

  it('loadProfile handles a minimal profile and null theme preference', () => {
    const s = build() as any;
    prefSig.set(null);
    account.getProfile.and.returnValue(of(PROFILE_MIN));
    s.loadProfile();
    expect(s.profileLanguage).toBe('ro');
    expect(s.profilePhoneCountry).toBe('RO');
    expect(s.profileThemePreference).toBe('system');
  });

  it('loadProfile handles error and unauthenticated', () => {
    const s = build() as any;
    auth.isAuthenticated.and.returnValue(false);
    s.loadProfile();
    expect(account.getProfile).not.toHaveBeenCalled();
    auth.isAuthenticated.and.returnValue(true);
    account.getProfile.and.returnValue(throwError(() => new Error('x')));
    resetBusy(s);
    s.loadProfile();
    expect(s.error()).toBe('account.loadError');
  });

  // ---- orders ------------------------------------------------------------------

  it('loadOrders loads default query and sets latest order', () => {
    const s = build() as any;
    s.loadOrders();
    expect(s.orders().length).toBe(1);
    expect(s.latestOrder()).not.toBeNull();
    // guards
    s.loadOrders();
    expect(account.getOrdersPage).toHaveBeenCalledTimes(1);
    s.ordersLoaded.set(false);
    s.ordersLoading.set(true);
    s.loadOrders();
    expect(account.getOrdersPage).toHaveBeenCalledTimes(1);
  });

  it('loadOrders with filters does not overwrite latest order', () => {
    const s = build() as any;
    s.ordersQuery = 'shirt';
    s.orderFilter = 'shipped';
    s.ordersFrom = '2020-01-01';
    s.ordersTo = '2020-12-31';
    s.page = 2;
    account.getOrdersPage.and.returnValue(
      of({ items: [makeOrder()], meta: { total_pages: 3, pending_count: 1 } } as any),
    );
    s.loadOrders(true);
    expect(s.latestOrder()).toBeNull();
    expect(s.totalPages).toBe(3);
  });

  it('loadOrders unauthenticated returns', () => {
    const s = build() as any;
    auth.isAuthenticated.and.returnValue(false);
    s.loadOrders();
    expect(account.getOrdersPage).not.toHaveBeenCalled();
  });

  it('loadOrders error maps invalid date range and generic errors', () => {
    const s = build() as any;
    account.getOrdersPage.and.returnValue(
      throwError(() => ({ error: { detail: 'Invalid date range' } })),
    );
    s.loadOrders(true);
    expect(s.ordersError()).toBe('account.orders.invalidDateRange');
    account.getOrdersPage.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.loadOrders(true);
    expect(s.ordersError()).toBe('account.orders.loadError');
  });

  it('order filters: active flag, clear, apply with invalid range, paging', () => {
    const s = build() as any;
    expect(s.ordersFiltersActive()).toBeFalse();
    s.orderFilter = 'shipped';
    expect(s.ordersFiltersActive()).toBeTrue();
    s.ordersFrom = '2021-02-01';
    s.ordersTo = '2021-01-01';
    s.applyOrderFilters();
    expect(s.ordersError()).toBe('account.orders.invalidDateRange');
    s.ordersFrom = '';
    s.ordersTo = '';
    s.filterOrders();
    expect(account.getOrdersPage).toHaveBeenCalled();
    s.clearOrderFilters();
    expect(s.orderFilter).toBe('');
    expect(s.pagedOrders()).toEqual(s.orders());
    // paging (response advertises 5 pages so page index is retained)
    account.getOrdersPage.and.returnValue(
      of({ items: [makeOrder()], meta: { total_pages: 5, pending_count: 0 } } as any),
    );
    s.totalPages = 5;
    s.page = 1;
    s.nextPage();
    expect(s.page).toBe(2);
    s.prevPage();
    expect(s.page).toBe(1);
    s.prevPage();
    expect(s.page).toBe(1);
    s.page = 5;
    s.nextPage();
    expect(s.page).toBe(5);
  });

  // ---- addresses load ----------------------------------------------------------

  it('loadAddresses success, guards, error, unauthenticated', () => {
    const s = build() as any;
    s.loadAddresses();
    expect(s.addresses().length).toBe(1);
    s.loadAddresses();
    expect(account.getAddresses).toHaveBeenCalledTimes(1);
    s.addressesLoaded.set(false);
    s.addressesLoading.set(true);
    s.loadAddresses();
    expect(account.getAddresses).toHaveBeenCalledTimes(1);
    s.addressesLoading.set(false);
    account.getAddresses.and.returnValue(throwError(() => new Error('x')));
    resetBusy(s);
    s.loadAddresses(true);
    expect(s.addressesError()).toBe('account.addresses.loadError');
    auth.isAuthenticated.and.returnValue(false);
    s.loadAddresses(true);
  });

  // ---- tickets -----------------------------------------------------------------

  it('loadTickets sorts, guards, errors, unauthenticated', () => {
    const s = build() as any;
    tickets.listMine.and.returnValue(
      of([
        { id: 't1', status: 'open', updated_at: '2020-01-01' },
        { id: 't2', status: 'resolved', updated_at: '2021-01-01' },
      ] as any),
    );
    s.loadTickets();
    expect(s.tickets()[0].id).toBe('t2');
    s.loadTickets();
    expect(tickets.listMine).toHaveBeenCalledTimes(1);
    s.ticketsLoaded.set(false);
    s.ticketsLoading.set(true);
    s.loadTickets();
    expect(tickets.listMine).toHaveBeenCalledTimes(1);
    s.ticketsLoading.set(false);
    tickets.listMine.and.returnValue(of('not-array' as any));
    s.loadTickets(true);
    expect(s.tickets()).toEqual([]);
    tickets.listMine.and.returnValue(throwError(() => new Error('x')));
    resetBusy(s);
    s.loadTickets(true);
    expect(s.ticketsError()).toBe('account.overview.support.loadError');
    auth.isAuthenticated.and.returnValue(false);
    s.loadTickets(true);
  });

  // ---- order presentation helpers ---------------------------------------------

  it('orderStatusChipClass / trackingUrl / trackingStatusLabel', () => {
    const s = build();
    expect(typeof s.orderStatusChipClass('shipped')).toBe('string');
    expect(s.trackingUrl('  ')).toBe('');
    expect(s.trackingUrl('ABC 1')).toContain('nums=ABC%201');
    expect(s.trackingStatusLabel(makeOrder({ tracking_number: '' }))).toBeNull();
    expect(s.trackingStatusLabel(makeOrder({ status: 'delivered' }))).toBe(
      'account.orders.trackingStatus.delivered',
    );
    expect(s.trackingStatusLabel(makeOrder({ status: 'shipped' }))).toBe(
      'account.orders.trackingStatus.inTransit',
    );
    expect(s.trackingStatusLabel(makeOrder({ status: 'processing' }))).toBeNull();
  });

  it('paymentMethodLabel covers all methods and translation presence', () => {
    const s = build();
    translations['adminUi.orders.paymentStripe'] = 'Stripe Pay';
    expect(s.paymentMethodLabel(makeOrder({ payment_method: 'stripe' }))).toBe('Stripe Pay');
    expect(s.paymentMethodLabel(makeOrder({ payment_method: 'paypal' }))).toBe('PAYPAL');
    expect(s.paymentMethodLabel(makeOrder({ payment_method: 'cod' }))).toBe('COD');
    expect(s.paymentMethodLabel(makeOrder({ payment_method: 'netopia' }))).toBe('NETOPIA');
    expect(s.paymentMethodLabel(makeOrder({ payment_method: 'other' }))).toBe('OTHER');
    expect(s.paymentMethodLabel(makeOrder({ payment_method: '' }))).toBe('—');
  });

  it('deliveryLabel and lockerLabel variants', () => {
    const s = build();
    expect(s.deliveryLabel(makeOrder({ courier: 'sameday', delivery_type: 'home' }))).toContain(
      'Sameday',
    );
    expect(s.deliveryLabel(makeOrder({ courier: 'fan_courier', delivery_type: 'locker' }))).toContain(
      'Fan Courier',
    );
    expect(s.deliveryLabel(makeOrder({ courier: 'dpd', delivery_type: 'custom' }))).toContain('dpd');
    expect(s.deliveryLabel(makeOrder({ courier: '', delivery_type: '' }))).toBe('—');
    expect(s.lockerLabel(makeOrder({ delivery_type: 'home' }))).toBeNull();
    expect(s.lockerLabel(makeOrder({ delivery_type: 'locker', locker_name: 'L', locker_address: 'A' }))).toBe(
      'L — A',
    );
    expect(
      s.lockerLabel(makeOrder({ delivery_type: 'locker', locker_name: '', locker_address: '' })),
    ).toBeNull();
  });

  it('manualRefundRequired across branches', () => {
    const s = build();
    expect(s.manualRefundRequired(makeOrder({ status: 'delivered' }))).toBeFalse();
    expect(
      s.manualRefundRequired(makeOrder({ status: 'cancelled', payment_method: 'cod' })),
    ).toBeFalse();
    expect(
      s.manualRefundRequired(makeOrder({ status: 'cancelled', payment_method: 'stripe', events: [] })),
    ).toBeFalse();
    expect(
      s.manualRefundRequired(
        makeOrder({
          status: 'cancelled',
          payment_method: 'stripe',
          events: [{ event: 'payment_captured' }, { event: 'payment_refunded' }],
        }),
      ),
    ).toBeFalse();
    expect(
      s.manualRefundRequired(
        makeOrder({
          status: 'cancelled',
          payment_method: 'stripe',
          events: [{ event: 'payment_captured' }],
        }),
      ),
    ).toBeTrue();
    expect(
      s.manualRefundRequired(makeOrder({ status: 'cancelled', payment_method: 'stripe', events: null })),
    ).toBeFalse();
  });

  // ---- reorder -----------------------------------------------------------------

  it('reorder success and guard and error', () => {
    const s = build();
    s.reorder(makeOrder());
    expect(cart.loadFromBackend).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/cart');
    expect(s.reorderingOrderId).toBeNull();
    s.reorderingOrderId = 'busy';
    s.reorder(makeOrder());
    expect(account.reorderOrder).toHaveBeenCalledTimes(1);
    s.reorderingOrderId = null;
    account.reorderOrder.and.returnValue(throwError(() => ({ error: { detail: 'nope' } })));
    resetBusy(s);
    s.reorder(makeOrder());
    expect(toast.error).toHaveBeenCalledWith('nope');
    account.reorderOrder.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.reorder(makeOrder());
    expect(toast.error).toHaveBeenCalledWith('account.orders.reorderError');
  });

  it('reorderItem success, guard, error', () => {
    const s = build();
    const order = makeOrder();
    s.reorderItem(order, order.items[0]);
    expect(api.post).toHaveBeenCalledWith('/cart/items', {
      product_id: 'p1',
      variant_id: 'v1',
      quantity: 1,
    });
    expect(s.reorderingOrderItemId).toBeNull();
    s.reorderingOrderItemId = 'busy';
    s.reorderItem(order, order.items[0]);
    expect(api.post).toHaveBeenCalledTimes(1);
    s.reorderingOrderItemId = null;
    api.post.and.returnValue(throwError(() => ({ error: { detail: 'bad' } })));
    resetBusy(s);
    s.reorderItem(order, order.items[0]);
    expect(toast.error).toHaveBeenCalledWith('bad');
    api.post.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.reorderItem(order, order.items[0]);
    expect(toast.error).toHaveBeenCalledWith('account.orders.reorderError');
  });

  // ---- cancel request ----------------------------------------------------------

  it('cancel request lifecycle', () => {
    const s = build();
    const order = makeOrder({ status: 'paid', reference_code: 'C1' });
    expect(s.hasCancelRequested(order)).toBeFalse();
    expect(s.canRequestCancel(order)).toBeTrue();
    // not eligible toast
    s.openCancelRequest(makeOrder({ status: 'delivered' }));
    expect(toast.error).toHaveBeenCalledWith('account.orders.cancel.errors.notEligible');
    // open then toggle closed
    s.openCancelRequest(order);
    expect(s.cancelOrderId).toBe('o1');
    s.openCancelRequest(order);
    expect(s.cancelOrderId).toBeNull();
    // submit guard: requesting
    s.openCancelRequest(order);
    s.requestingCancel = true;
    s.submitCancelRequest(order);
    expect(account.requestOrderCancellation).not.toHaveBeenCalled();
    s.requestingCancel = false;
    // submit guard: mismatched id
    s.submitCancelRequest(makeOrder({ id: 'other', status: 'paid' }));
    // submit guard: not eligible
    s.cancelOrderId = order.id;
    s.submitCancelRequest(makeOrder({ id: 'o1', status: 'delivered' }));
    expect(s.cancelRequestError).toBe('account.orders.cancel.errors.notEligible');
    // reason required
    s.cancelOrderId = order.id;
    s.cancelReason = '';
    s.submitCancelRequest(order);
    expect(s.cancelRequestError).toBe('account.orders.cancel.errors.reasonRequired');
    // confirm declined
    s.cancelReason = 'changed mind';
    spyOn(window, 'confirm').and.returnValue(false);
    s.submitCancelRequest(order);
    expect(account.requestOrderCancellation).not.toHaveBeenCalled();
  });

  it('submitCancelRequest success and error variants', () => {
    const order = makeOrder({ status: 'paid' });
    spyOn(window, 'confirm').and.returnValue(true);
    const s = build();
    s.openCancelRequest(order);
    s.cancelReason = 'reason';
    s.submitCancelRequest(order);
    expect((s as any).cancelRequestedOrderIds.has('o1')).toBeTrue();
    expect(toast.success).toHaveBeenCalledWith('account.orders.cancel.success');

    const errCases: Array<[string, string]> = [
      ['Cancel request already exists', 'account.orders.cancel.errors.alreadyRequested'],
      ['Cancel request not eligible', 'account.orders.cancel.errors.notEligible'],
      ['Cancel reason is required', 'account.orders.cancel.errors.reasonRequired'],
      ['something else', 'account.orders.cancel.errors.create'],
    ];
    for (const [detail, key] of errCases) {
      const o = makeOrder({ id: 'x' + detail, status: 'paid' });
      account.requestOrderCancellation.and.returnValue(throwError(() => ({ error: { detail } })));
      resetBusy(s);
      s.openCancelRequest(o);
      s.cancelReason = 'r';
      s.submitCancelRequest(o);
      expect(s.cancelRequestError).toBe(key);
    }
  });

  it('hasCancelRequested true via events', () => {
    const s = build();
    expect(
      s.hasCancelRequested(makeOrder({ events: [{ event: 'cancel_requested' }] })),
    ).toBeTrue();
  });

  // ---- return request ----------------------------------------------------------

  it('return request lifecycle and validation', () => {
    const s = build();
    const order = makeOrder({ status: 'delivered' });
    expect(s.hasReturnRequested(order)).toBeFalse();
    expect(s.canRequestReturn(order)).toBeTrue();
    // not eligible
    s.openReturnRequest(makeOrder({ status: 'paid' }));
    expect(toast.error).toHaveBeenCalledWith('account.orders.return.errors.notEligible');
    // open then toggle
    s.openReturnRequest(order);
    expect(s.returnOrderId).toBe('o1');
    s.openReturnRequest(order);
    expect(s.returnOrderId).toBeNull();
    // submit guards
    s.creatingReturn = true;
    s.submitReturnRequest(order);
    s.creatingReturn = false;
    s.submitReturnRequest(makeOrder({ id: 'mismatch', status: 'delivered' }));
    s.returnOrderId = order.id;
    s.submitReturnRequest(makeOrder({ id: 'o1', status: 'paid' }));
    expect(s.returnCreateError).toBe('account.orders.return.errors.notEligible');
    // reason required
    s.returnOrderId = order.id;
    s.returnReason = '';
    s.returnQty = { i1: 1 };
    s.submitReturnRequest(order);
    expect(s.returnCreateError).toBe('account.orders.return.errors.reasonRequired');
    // invalid quantity (> available)
    s.returnOrderId = order.id;
    s.returnReason = 'broken';
    s.returnQty = { i1: 99 };
    s.submitReturnRequest(order);
    expect(s.returnCreateError).toBe('account.orders.return.errors.invalidQuantity');
    // items required (all zero / NaN)
    s.returnOrderId = order.id;
    s.returnReason = 'broken';
    s.returnQty = { i1: 0 };
    s.submitReturnRequest(order);
    expect(s.returnCreateError).toBe('account.orders.return.errors.itemsRequired');
  });

  it('submitReturnRequest success and error mapping', () => {
    const order = makeOrder({ status: 'delivered' });
    const s = build();
    s.openReturnRequest(order);
    s.returnReason = 'broken';
    s.returnCustomerMessage = '';
    s.returnQty = { i1: 1 };
    s.submitReturnRequest(order);
    expect((s as any).returnRequestedOrderIds.has('o1')).toBeTrue();
    expect(toast.success).toHaveBeenCalledWith('account.orders.return.success');

    const cases: Array<[string, string]> = [
      ['Return request already exists', 'account.orders.return.errors.alreadyExists'],
      ['Return request not eligible', 'account.orders.return.errors.notEligible'],
      ['boom', 'account.orders.return.errors.create'],
    ];
    for (const [detail, key] of cases) {
      account.createReturnRequest.and.returnValue(throwError(() => ({ error: { detail } })));
      resetBusy(s);
      const o = makeOrder({ id: 'r' + detail, status: 'delivered' });
      s.openReturnRequest(o);
      s.returnReason = 'r';
      s.returnCustomerMessage = 'note';
      s.returnQty = { i1: 1 };
      s.submitReturnRequest(o);
      expect(s.returnCreateError).toBe(key);
    }
  });

  // ---- receipts ----------------------------------------------------------------

  it('downloadReceipt success, guard, error', () => {
    const s = build();
    const order = makeOrder();
    const click = jasmine.createSpy('click');
    const fakeA: any = { click, remove: jasmine.createSpy('remove'), set href(v: string) {}, set download(v: string) {}, set rel(v: string) {} };
    spyOn(document, 'createElement').and.returnValue(fakeA);
    spyOn(document.body, 'appendChild').and.returnValue(fakeA);
    spyOn(window.URL, 'createObjectURL').and.returnValue('blob:1');
    spyOn(window.URL, 'revokeObjectURL');
    s.downloadReceipt(order);
    expect(click).toHaveBeenCalled();
    expect(s.downloadingReceiptId).toBeNull();
    // guard
    s.downloadingReceiptId = 'busy';
    s.downloadReceipt(order);
    expect(account.downloadReceipt).toHaveBeenCalledTimes(1);
    s.downloadingReceiptId = null;
    account.downloadReceipt.and.returnValue(throwError(() => ({ error: { detail: 'derr' } })));
    resetBusy(s);
    s.downloadReceipt(order);
    expect(toast.error).toHaveBeenCalledWith('derr');
    account.downloadReceipt.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.downloadReceipt(order);
    expect(toast.error).toHaveBeenCalledWith('account.orders.receiptDownloadError');
  });

  it('copyReceiptLink: generate error, reuses fresh url, regenerates expired', async () => {
    const s = build() as any;
    const order = makeOrder();
    setClipboard({ writeText: jasmine.createSpy('w').and.returnValue(Promise.resolve()) });
    // no existing share → generate error path
    s.copyReceiptLink(order);
    expect(toast.error).toHaveBeenCalledWith('account.orders.receiptGenerateError');
    // fresh url present → copy directly
    s.receiptShares.set({
      o1: { receipt_url: 'http://x/r', expires_at: new Date(Date.now() + 3600_000).toISOString() },
    });
    await s.copyReceiptLink(order);
    // expired → triggers shareReceipt
    s.receiptShares.set({
      o1: { receipt_url: 'http://x/r', expires_at: new Date(Date.now() - 1000).toISOString() },
    });
    s.copyReceiptLink(order);
    expect(account.shareReceipt).toHaveBeenCalled();
  });

  it('shareReceipt reuses unexpired token, generates new, guards, errors', () => {
    const s = build() as any;
    const order = makeOrder();
    setClipboard({ writeText: jasmine.createSpy('w').and.returnValue(Promise.resolve()) });
    // existing fresh token → copy path, no API
    s.receiptShares.set({
      o1: { receipt_url: 'http://x/r', expires_at: new Date(Date.now() + 3600_000).toISOString() },
    });
    s.shareReceipt(order);
    expect(account.shareReceipt).not.toHaveBeenCalled();
    // generate new
    s.receiptShares.set({});
    s.shareReceipt(order);
    expect(account.shareReceipt).toHaveBeenCalled();
    // guard while sharing
    s.sharingReceiptId = 'busy';
    s.shareReceipt(order);
    s.sharingReceiptId = null;
    // error
    account.shareReceipt.and.returnValue(throwError(() => ({ error: { detail: 'serr' } })));
    resetBusy(s);
    s.receiptShares.set({});
    s.shareReceipt(order);
    expect(toast.error).toHaveBeenCalledWith('serr');
    account.shareReceipt.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.shareReceipt(order);
    expect(toast.error).toHaveBeenCalledWith('account.orders.receiptGenerateError');
  });

  it('revokeReceiptShare confirm declined, success, guard, error', () => {
    const s = build() as any;
    const order = makeOrder();
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    s.revokeReceiptShare(order);
    expect(account.revokeReceiptShare).not.toHaveBeenCalled();
    confirmSpy.and.returnValue(true);
    s.receiptShares.set({ o1: { receipt_url: 'u' } });
    s.revokeReceiptShare(order);
    expect(s.receiptShares()['o1']).toBeUndefined();
    expect(toast.success).toHaveBeenCalledWith('account.orders.receiptRevoked');
    s.revokingReceiptId = 'busy';
    s.revokeReceiptShare(order);
    s.revokingReceiptId = null;
    account.revokeReceiptShare.and.returnValue(throwError(() => ({ error: { detail: 'rerr' } })));
    resetBusy(s);
    s.revokeReceiptShare(order);
    expect(toast.error).toHaveBeenCalledWith('rerr');
    account.revokeReceiptShare.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.revokeReceiptShare(order);
    expect(toast.error).toHaveBeenCalledWith('account.orders.receiptRevokeError');
  });

  it('copyReceiptUrl: copied success (with timer reset) and clipboard-failure fallback', fakeAsync(() => {
    const s = build() as any;
    setClipboard({ writeText: jasmine.createSpy('w').and.returnValue(Promise.resolve()) });
    s.receiptCopiedTimer = 123;
    s.copyReceiptUrl('o1', 'http://x/r', 'account.orders.receiptReady');
    tick();
    expect(s.receiptCopiedId()).toBe('o1');
    tick(2200);
    expect(s.receiptCopiedId()).toBeNull();
    // clipboard failure → ready toast
    setClipboard({ writeText: jasmine.createSpy('w').and.returnValue(Promise.reject(new Error('no'))) });
    s.copyReceiptUrl('o2', 'http://x/r2', 'account.orders.receiptReady');
    tick();
    expect(toast.success).toHaveBeenCalledWith('account.orders.receiptReady');
    discardPeriodicTasks();
  }));

  it('copyToClipboard returns false when clipboard unavailable', async () => {
    const s = build() as any;
    const original = (navigator as any).clipboard;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const ok = await s.copyToClipboard('text');
    expect(ok).toBeFalse();
    Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true });
  });

  // ---- address form ------------------------------------------------------------

  it('openAddressForm / duplicateAddress / closeAddressForm / editAddress', () => {
    const s = build();
    s.openAddressForm();
    expect(s.addressModel.label).toBe('home');
    expect(s.editingAddressId).toBeNull();
    s.openAddressForm(makeAddress({ id: 'a9', label: 'Work', line2: 'apt', region: 'B' }));
    expect(s.editingAddressId).toBe('a9');
    s.duplicateAddress(makeAddress({ id: 'a9', label: 'Other' }));
    expect(s.editingAddressId).toBeNull();
    expect(s.addressModel.is_default_shipping).toBeFalse();
    s.editAddress(makeAddress());
    expect(s.showAddressForm).toBeTrue();
    s.closeAddressForm();
    expect(s.showAddressForm).toBeFalse();
  });

  it('saveAddress create and update, success and error', () => {
    const s = build();
    const payload = { line1: 'x', city: 'c', postal_code: 'p', country: 'RO' } as any;
    // create
    s.editingAddressId = null;
    s.saveAddress(payload);
    expect(account.createAddress).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('account.addresses.messages.added');
    // create error
    account.createAddress.and.returnValue(throwError(() => ({ error: { detail: 'ce' } })));
    resetBusy(s);
    s.saveAddress(payload);
    expect(toast.error).toHaveBeenCalledWith('ce');
    account.createAddress.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.saveAddress(payload);
    expect(toast.error).toHaveBeenCalledWith('account.addresses.errors.add');
    // update
    s.editingAddressId = 'a1';
    s.saveAddress(payload);
    expect(account.updateAddress).toHaveBeenCalledWith('a1', payload);
    expect(toast.success).toHaveBeenCalledWith('account.addresses.messages.updated');
    account.updateAddress.and.returnValue(throwError(() => ({ error: { detail: 'ue' } })));
    resetBusy(s);
    s.editingAddressId = 'a1';
    s.saveAddress(payload);
    expect(toast.error).toHaveBeenCalledWith('ue');
    account.updateAddress.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.editingAddressId = 'a1';
    s.saveAddress(payload);
    expect(toast.error).toHaveBeenCalledWith('account.addresses.errors.update');
  });

  it('removeAddress confirm declined, success, error', () => {
    const s = build() as any;
    s.addresses.set([makeAddress(), makeAddress({ id: 'a2' })]);
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    s.removeAddress('a1');
    expect(account.deleteAddress).not.toHaveBeenCalled();
    confirmSpy.and.returnValue(true);
    s.removeAddress('a1');
    expect(s.addresses().some((a: any) => a.id === 'a1')).toBeFalse();
    account.deleteAddress.and.returnValue(throwError(() => new Error('x')));
    resetBusy(s);
    s.removeAddress('a2');
    expect(toast.error).toHaveBeenCalledWith('account.addresses.errors.remove');
  });

  it('setDefaultShipping/Billing success and error', () => {
    const s = build() as any;
    s.addresses.set([makeAddress({ id: 'a1' }), makeAddress({ id: 'a2', is_default_shipping: false })]);
    account.updateAddress.and.returnValue(of(makeAddress({ id: 'a2', is_default_shipping: true })));
    s.setDefaultShipping(makeAddress({ id: 'a2' }));
    expect(toast.success).toHaveBeenCalledWith('account.addresses.messages.defaultShippingUpdated');
    account.updateAddress.and.returnValue(
      of(makeAddress({ id: 'a2', is_default_billing: true, is_default_shipping: false })),
    );
    s.setDefaultBilling(makeAddress({ id: 'a2' }));
    expect(toast.success).toHaveBeenCalledWith('account.addresses.messages.defaultBillingUpdated');
    account.updateAddress.and.returnValue(throwError(() => ({ error: { detail: 'se' } })));
    resetBusy(s);
    s.setDefaultShipping(makeAddress({ id: 'a2' }));
    expect(toast.error).toHaveBeenCalledWith('se');
    account.updateAddress.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.setDefaultShipping(makeAddress({ id: 'a2' }));
    expect(toast.error).toHaveBeenCalledWith('account.addresses.errors.defaultShipping');
    account.updateAddress.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.setDefaultBilling(makeAddress({ id: 'a2' }));
    expect(toast.error).toHaveBeenCalledWith('account.addresses.errors.defaultBilling');
  });

  it('upsertAddress merges new and existing', () => {
    const s = build() as any;
    s.addresses.set([makeAddress({ id: 'a1', is_default_shipping: true })]);
    s.upsertAddress(makeAddress({ id: 'a2', is_default_shipping: true, is_default_billing: true }));
    const list = s.addresses();
    expect(list.length).toBe(2);
    expect(list.find((a: any) => a.id === 'a1').is_default_shipping).toBeFalse();
    s.upsertAddress(makeAddress({ id: 'a2', is_default_shipping: false, is_default_billing: false }));
    expect(s.addresses().length).toBe(2);
  });

  it('normalizeAddressLabel maps known and unknown labels', () => {
    const s = build() as any;
    expect(s.normalizeAddressLabel(null)).toBe('home');
    expect(s.normalizeAddressLabel('Home')).toBe('home');
    expect(s.normalizeAddressLabel('acasa')).toBe('home');
    expect(s.normalizeAddressLabel('serviciu')).toBe('work');
    expect(s.normalizeAddressLabel('altul')).toBe('other');
    expect(s.normalizeAddressLabel('Custom Place')).toBe('Custom Place');
  });

  // ---- verification & avatar ---------------------------------------------------

  it('primaryVerificationResendRemainingSeconds and resendVerification', () => {
    const s = build() as any;
    expect(s.primaryVerificationResendRemainingSeconds()).toBe(0);
    s.now.set(1_000_000);
    s.primaryVerificationResendUntil.set(1_000_000 + 30_000);
    expect(s.primaryVerificationResendRemainingSeconds()).toBe(30);
    // resend blocked while cooling down
    s.resendVerification();
    expect(auth.requestEmailVerification).not.toHaveBeenCalled();
    // resend success
    s.primaryVerificationResendUntil.set(null);
    s.resendVerification();
    expect(toast.success).toHaveBeenCalledWith('account.verification.sentToast');
    // resend error
    s.primaryVerificationResendUntil.set(null);
    auth.requestEmailVerification.and.returnValue(throwError(() => new Error('x')));
    resetBusy(s);
    s.resendVerification();
    expect(toast.error).toHaveBeenCalledWith('account.verification.sendError');
  });

  it('onAvatarChange with and without file', () => {
    const s = build();
    const uploadSpy = spyOn(s, 'uploadAvatar');
    const input: any = { files: [], value: 'x' };
    s.onAvatarChange({ target: input } as any);
    expect(uploadSpy).not.toHaveBeenCalled();
    const file = new File(['a'], 'a.png');
    const input2: any = { files: [file], value: 'x' };
    s.onAvatarChange({ target: input2 } as any);
    expect(uploadSpy).toHaveBeenCalledWith(file);
  });

  it('uploadAvatar success, guard, error', () => {
    const s = build();
    const file = new File(['a'], 'a.png');
    s.uploadAvatar(file);
    expect(s.avatarBusy).toBeFalse();
    s.avatarBusy = true;
    s.uploadAvatar(file);
    expect(auth.uploadAvatar).toHaveBeenCalledTimes(1);
    s.avatarBusy = false;
    auth.uploadAvatar.and.returnValue(throwError(() => ({ error: { detail: 'ae' } })));
    resetBusy(s);
    s.uploadAvatar(file);
    expect(toast.error).toHaveBeenCalledWith('ae');
    auth.uploadAvatar.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.uploadAvatar(file);
    expect(toast.error).toHaveBeenCalledWith('account.profile.avatar.uploadError');
  });

  it('useGoogleAvatar success, guard, error', () => {
    const s = build();
    s.useGoogleAvatar();
    expect(toast.success).toHaveBeenCalledWith('account.profile.avatar.updated');
    s.avatarBusy = true;
    s.useGoogleAvatar();
    expect(auth.useGoogleAvatar).toHaveBeenCalledTimes(1);
    s.avatarBusy = false;
    auth.useGoogleAvatar.and.returnValue(throwError(() => ({ error: { detail: 'ge' } })));
    resetBusy(s);
    s.useGoogleAvatar();
    expect(toast.error).toHaveBeenCalledWith('ge');
    auth.useGoogleAvatar.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.useGoogleAvatar();
    expect(toast.error).toHaveBeenCalledWith('account.profile.avatar.googleError');
  });

  it('removeAvatar guard, confirm declined, success, error', () => {
    const s = build();
    s.avatarBusy = true;
    s.removeAvatar();
    expect(auth.removeAvatar).not.toHaveBeenCalled();
    s.avatarBusy = false;
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    s.removeAvatar();
    expect(auth.removeAvatar).not.toHaveBeenCalled();
    confirmSpy.and.returnValue(true);
    s.removeAvatar();
    expect(toast.success).toHaveBeenCalledWith('account.profile.avatar.removed');
    auth.removeAvatar.and.returnValue(throwError(() => ({ error: { detail: 're' } })));
    resetBusy(s);
    s.removeAvatar();
    expect(toast.error).toHaveBeenCalledWith('re');
    auth.removeAvatar.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.removeAvatar();
    expect(toast.error).toHaveBeenCalledWith('account.profile.avatar.removeError');
  });

  // ---- session / auth ----------------------------------------------------------

  it('refreshSession success token, null token, error', () => {
    const s = build();
    s.refreshSession();
    expect(toast.success).toHaveBeenCalledWith('account.security.session.refreshed');
    auth.refresh.and.returnValue(of(null));
    s.refreshSession();
    expect(toast.error).toHaveBeenCalledWith('account.security.session.expired');
    auth.refresh.and.returnValue(throwError(() => new Error('x')));
    resetBusy(s);
    s.refreshSession();
    expect(toast.error).toHaveBeenCalledWith('account.security.session.refreshError');
  });

  it('signOut clears and navigates', () => {
    const s = build();
    s.signOut();
    expect(wishlist.clear).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('isAdmin / isAuthenticated delegate', () => {
    const s = build();
    expect(s.isAdmin()).toBeFalse();
    expect(s.isAuthenticated()).toBeTrue();
  });

  // ---- profile completeness / preview -----------------------------------------

  it('profileCompleteness counts completed fields', () => {
    const s = build() as any;
    s.loadProfile();
    const c = s.profileCompleteness();
    expect(c.total).toBe(8);
    expect(c.percent).toBeGreaterThan(0);
    // empty profile path
    account.getProfile.and.returnValue(of({ ...PROFILE_MIN, avatar_url: null }));
    s.profileLoaded = false;
    s.loadProfile();
    s.profileName = '';
    s.profileFirstName = '';
    s.profileLastName = '';
    s.profileDateOfBirth = '';
    s.profilePhoneNational = '';
    s.profileLanguage = 'fr' as any;
    s.avatar = null;
    s.emailVerified.set(false);
    s.profile.set(null);
    const c2 = s.profileCompleteness();
    expect(c2.completed).toBe(0);
  });

  it('missingProfileFields / profileCompletionRequired', () => {
    const s = build() as any;
    s.profile.set(null);
    expect(s.profileCompletionRequired()).toBeFalse();
    s.profile.set({ ...PROFILE_FULL });
    expect(s.profileCompletionRequired()).toBeFalse();
    s.profile.set({ id: 'u', email: 'e', google_sub: 'g' });
    expect(Array.isArray(s.missingProfileFields())).toBeTrue();
    expect(s.profileCompletionRequired()).toBeTrue();
    s.profile.set({ id: 'u', email: 'e', google_sub: null });
    s.forceProfileCompletion = true;
    expect(s.profileCompletionRequired()).toBeTrue();
  });

  it('phone previews, usernameChanged, requiredFieldLabelKey', () => {
    const s = build() as any;
    s.profilePhoneCountry = 'RO';
    s.profilePhoneNational = '723204204';
    expect(typeof s.phoneNationalPreview()).toBe('string');
    expect(s.phoneE164Preview()).toContain('+40');
    s.profile.set({ username: 'old' });
    s.profileUsername = 'new';
    expect(s.usernameChanged()).toBeTrue();
    s.profileUsername = 'old';
    expect(s.usernameChanged()).toBeFalse();
    expect(s.requiredFieldLabelKey('name')).toBe('auth.displayName');
    expect(s.requiredFieldLabelKey('username')).toBe('auth.username');
    expect(s.requiredFieldLabelKey('first_name')).toBe('auth.firstName');
    expect(s.requiredFieldLabelKey('last_name')).toBe('auth.lastName');
    expect(s.requiredFieldLabelKey('date_of_birth')).toBe('auth.dateOfBirth');
    expect(s.requiredFieldLabelKey('phone')).toBe('auth.phone');
    expect(s.publicIdentityLabel()).toBeDefined();
    expect(s.publicIdentityPreviewLabel()).toBeDefined();
  });

  // ---- saveProfile -------------------------------------------------------------

  it('saveProfile unauthenticated returns', () => {
    const s = build();
    auth.isAuthenticated.and.returnValue(false);
    s.saveProfile();
    expect(auth.updateProfile).not.toHaveBeenCalled();
  });

  it('saveProfile completion-required validation errors', () => {
    const s = build() as any;
    s.profile.set({ id: 'u', email: 'e', google_sub: 'g' });
    s.forceProfileCompletion = true;
    // missing name
    s.profileName = '';
    s.saveProfile();
    expect(s.profileError).toBe('account.profile.errors.displayNameRequired');
    // invalid username
    s.profileName = 'Name';
    s.profileUsername = '!!';
    s.saveProfile();
    expect(s.profileError).toBe('validation.usernameInvalid');
    // missing first name
    s.profileUsername = 'valid_user';
    s.profileFirstName = '';
    s.saveProfile();
    expect(s.profileError).toBe('account.profile.errors.firstNameRequired');
    // missing last name
    s.profileFirstName = 'F';
    s.profileLastName = '';
    s.saveProfile();
    expect(s.profileError).toBe('account.profile.errors.lastNameRequired');
    // missing dob
    s.profileLastName = 'L';
    s.profileDateOfBirth = '';
    s.saveProfile();
    expect(s.profileError).toBe('account.profile.errors.dobRequired');
    // missing/invalid phone
    s.profileDateOfBirth = '1990-01-01';
    s.profilePhoneNational = '';
    s.saveProfile();
    expect(s.profileError).toBe('validation.phoneInvalid');
  });

  it('saveProfile phone invalid (non-completion) and future dob', () => {
    const s = build() as any;
    s.profile.set({ ...PROFILE_FULL });
    s.forceProfileCompletion = false;
    s.profilePhoneCountry = 'RO';
    s.profilePhoneNational = 'abc'; // invalid → buildE164 null
    s.saveProfile();
    expect(s.profileError).toBe('validation.phoneInvalid');
    // future dob
    s.profilePhoneNational = '';
    const future = new Date(Date.now() + 86400_000 * 365).toISOString().slice(0, 10);
    s.profileDateOfBirth = future;
    s.saveProfile();
    expect(s.profileError).toBe('account.profile.errors.dobFuture');
  });

  it('saveProfile requires password when username changes', () => {
    const s = build() as any;
    s.profile.set({ username: 'old', preferred_language: 'en' });
    s.forceProfileCompletion = false;
    s.profileUsername = 'newname';
    s.profileUsernamePassword = '';
    s.profileDateOfBirth = '';
    s.profilePhoneNational = '';
    s.saveProfile();
    expect(s.profileError).toBe('auth.currentPasswordRequired');
  });

  it('saveProfile success updates username then profile and clears completion', () => {
    const s = build() as any;
    s.profile.set({ username: 'old', preferred_language: 'en' });
    s.forceProfileCompletion = true;
    s.profileName = 'Name';
    s.profileUsername = 'newname';
    s.profileUsernamePassword = 'pw';
    s.profileFirstName = 'F';
    s.profileLastName = 'L';
    s.profileDateOfBirth = '1990-01-01';
    s.profilePhoneCountry = 'RO';
    s.profilePhoneNational = '723204204';
    s.profileLanguage = 'ro';
    auth.updateProfile.and.returnValue(of(PROFILE_FULL));
    s.saveProfile();
    expect(auth.updateUsername).toHaveBeenCalled();
    expect(auth.updateProfile).toHaveBeenCalled();
    expect(s.profileSaved).toBeTrue();
    expect(router.navigate).toHaveBeenCalled();
  });

  it('saveProfile success without username change and stays in completion', () => {
    const s = build() as any;
    s.profile.set({ username: 'same', preferred_language: 'en' });
    s.forceProfileCompletion = false;
    s.profileUsername = 'same';
    s.profileName = 'Name';
    s.profileDateOfBirth = '';
    s.profilePhoneNational = '';
    auth.updateProfile.and.returnValue(of({ ...PROFILE_MIN, google_sub: 'g' }));
    s.saveProfile();
    expect(auth.updateUsername).not.toHaveBeenCalled();
    expect(s.profileSaved).toBeTrue();
  });

  it('saveProfile error path', () => {
    const s = build() as any;
    s.profile.set({ username: 'same', preferred_language: 'en' });
    s.profileUsername = 'same';
    s.profileName = 'Name';
    s.profileDateOfBirth = '';
    s.profilePhoneNational = '';
    auth.updateProfile.and.returnValue(throwError(() => ({ error: { detail: 'pe' } })));
    resetBusy(s);
    s.saveProfile();
    expect(s.profileError).toBe('pe');
    auth.updateProfile.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.saveProfile();
    expect(s.profileError).toBe('account.profile.errors.saveError');
  });

  // ---- aliases / cooldowns -----------------------------------------------------

  it('loadAliases success, guards, error, unauthenticated', () => {
    const s = build() as any;
    s.loadAliases();
    expect(s.aliases()).toBeTruthy();
    s.loadAliases();
    expect(auth.getAliases).toHaveBeenCalledTimes(1);
    s.aliases.set(null);
    s.aliasesLoading.set(true);
    s.loadAliases();
    expect(auth.getAliases).toHaveBeenCalledTimes(1);
    s.aliasesLoading.set(false);
    auth.getAliases.and.returnValue(throwError(() => new Error('x')));
    resetBusy(s);
    s.loadAliases(true);
    expect(s.aliasesError()).toBe('account.profile.aliases.loadError');
    auth.isAuthenticated.and.returnValue(false);
    s.loadAliases(true);
  });

  it('loadCooldowns success, guards, error, unauthenticated', () => {
    const s = build() as any;
    s.loadCooldowns();
    expect(s.cooldownsLoaded()).toBeTrue();
    s.loadCooldowns();
    expect(auth.getCooldowns).toHaveBeenCalledTimes(1);
    s.cooldownsLoaded.set(false);
    s.cooldownsLoading.set(true);
    s.loadCooldowns();
    expect(auth.getCooldowns).toHaveBeenCalledTimes(1);
    s.cooldownsLoading.set(false);
    auth.getCooldowns.and.returnValue(throwError(() => new Error('x')));
    resetBusy(s);
    s.loadCooldowns(true);
    expect(s.cooldownsError()).toBe('account.cooldowns.loadError');
    auth.isAuthenticated.and.returnValue(false);
    s.loadCooldowns(true);
  });

  it('cooldown second getters and formatCooldown', () => {
    const s = build() as any;
    s.now.set(1_000_000);
    const future = new Date(1_000_000 + 90_000_000).toISOString();
    s.cooldowns.set({
      username: { next_allowed_at: future },
      display_name: { next_allowed_at: future },
      email: { next_allowed_at: future },
    });
    expect(s.usernameCooldownSeconds()).toBeGreaterThan(0);
    expect(s.displayNameCooldownSeconds()).toBeGreaterThan(0);
    expect(s.emailCooldownSeconds()).toBeGreaterThan(0);
    // cooldownRemainingSeconds branches
    expect(s.cooldownRemainingSeconds(null)).toBe(0);
    expect(s.cooldownRemainingSeconds({ next_allowed_at: 'not-a-date' })).toBe(0);
    expect(s.cooldownRemainingSeconds({ next_allowed_at: future })).toBeGreaterThan(0);
    // formatCooldown
    expect(s.formatCooldown(0)).toBe('');
    expect(s.formatCooldown(90_000)).toContain('d');
    expect(s.formatCooldown(3700)).toContain('h');
    expect(s.formatCooldown(120)).toContain('m');
    expect(s.formatCooldown(45)).toBe('45s');
  });

  // ---- overview labels ---------------------------------------------------------

  it('accountHeaderLabel variants', () => {
    const s = build();
    expect(s.accountHeaderLabel({ username: '' } as any)).toBe('...');
    expect(s.accountHeaderLabel({ username: 'u', name: 'N', name_tag: 7 } as any)).toBe('u (N#7)');
    expect(s.accountHeaderLabel({ username: 'u', name: 'N' } as any)).toBe('u (N)');
    expect(s.accountHeaderLabel({ username: 'u' } as any)).toBe('u');
  });

  it('lastOrderLabel and subcopy across states', () => {
    const s = build() as any;
    // loading
    s.ordersLoading.set(true);
    s.ordersLoaded.set(false);
    expect(s.lastOrderLabel()).toBe('notifications.loading');
    expect(s.lastOrderSubcopy()).toBe('notifications.loading');
    // not loaded, not loading
    s.ordersLoading.set(false);
    expect(s.lastOrderLabel()).toBe('...');
    expect(s.lastOrderSubcopy()).toBe('');
    // loaded, no order
    s.ordersLoaded.set(true);
    s.latestOrder.set(null);
    s.orders.set([]);
    expect(s.lastOrderLabel()).toBe('account.overview.noOrders');
    expect(s.lastOrderSubcopy()).toBe('account.overview.noOrdersCopy');
    // loaded with order + translated status
    translations['adminUi.orders.delivered'] = 'Delivered!';
    translations['account.overview.lastOrderLabel'] = 'label';
    s.latestOrder.set(makeOrder({ status: 'delivered', created_at: '2020-01-01T00:00:00Z' }));
    expect(s.lastOrderLabel()).toBe('label');
    expect(s.lastOrderSubcopy()).toContain('·');
    // status without translation, no created_at
    s.latestOrder.set(makeOrder({ status: 'weird', created_at: '' }));
    expect(s.lastOrderLabel()).toBe('label');
    expect(typeof s.lastOrderSubcopy()).toBe('string');
  });

  it('lastOrder falls back to sorted orders, formatMoney handles bad currency', () => {
    const s = build() as any;
    s.ordersLoaded.set(true);
    s.latestOrder.set(null);
    s.orders.set([
      makeOrder({ id: 'old', created_at: '2019-01-01T00:00:00Z' }),
      makeOrder({ id: 'new', created_at: '2021-01-01T00:00:00Z', currency: '!!' }),
    ]);
    expect(s.lastOrderSubcopy()).toContain('20.00');
  });

  it('defaultAddressLabel and subcopy across states', () => {
    const s = build() as any;
    s.addressesLoading.set(true);
    s.addressesLoaded.set(false);
    expect(s.defaultAddressLabel()).toBe('notifications.loading');
    expect(s.defaultAddressSubcopy()).toBe('notifications.loading');
    s.addressesLoading.set(false);
    expect(s.defaultAddressLabel()).toBe('...');
    expect(s.defaultAddressSubcopy()).toBe('');
    s.addressesLoaded.set(true);
    s.addresses.set([]);
    expect(s.defaultAddressLabel()).toBe('account.overview.noAddresses');
    expect(s.defaultAddressSubcopy()).toBe('account.overview.noAddressesCopy');
    s.addresses.set([makeAddress({ label: 'home', line1: '1 St', city: 'Buc' })]);
    expect(s.defaultAddressLabel()).toBe('home');
    expect(s.defaultAddressSubcopy()).toContain('1 St');
    // no label, no line
    s.addresses.set([makeAddress({ label: '', line1: '', city: '' })]);
    expect(s.defaultAddressLabel()).toBe('account.addresses.defaultShipping');
    expect(s.defaultAddressSubcopy()).toBe('account.overview.savedAddressFallback');
    // default shipping not found → first
    s.addresses.set([makeAddress({ id: 'a1', is_default_shipping: false })]);
    expect(s.defaultAddressLabel()).toBe('home');
  });

  it('wishlistCountLabel states', () => {
    const s = build();
    wishlist.isLoaded.and.returnValue(false);
    expect(s.wishlistCountLabel()).toBe('notifications.loading');
    wishlist.isLoaded.and.returnValue(true);
    wishlist.items.and.returnValue([{ id: 'p1' }]);
    expect(s.wishlistCountLabel()).toBe('account.overview.wishlistCountOne');
    wishlist.items.and.returnValue([{ id: 'p1' }, { id: 'p2' }]);
    expect(s.wishlistCountLabel()).toBe('account.overview.wishlistCountMany');
  });

  it('notificationsLabel and securityLabel', () => {
    const s = build() as any;
    s.profile.set(null);
    expect(s.notificationsLabel()).toBe('notifications.loading');
    expect(s.securityLabel()).toBe('notifications.loading');
    s.profile.set(PROFILE_FULL);
    s.notifyBlogComments = false;
    s.notifyBlogCommentReplies = false;
    s.notifyMarketing = false;
    expect(s.notificationsLabel()).toBe('account.overview.notificationsAllOff');
    s.notifyMarketing = true;
    expect(s.notificationsLabel()).toBe('account.overview.notificationsEnabled');
    s.emailVerified.set(true);
    s.googleEmail.set('g@example.com');
    expect(s.securityLabel()).toContain('·');
    s.emailVerified.set(false);
    s.googleEmail.set(null);
    expect(s.securityLabel()).toContain('·');
  });

  it('supportTicketsLabel and subcopy', () => {
    const s = build() as any;
    s.ticketsLoading.set(true);
    s.ticketsLoaded.set(false);
    expect(s.supportTicketsLabel()).toBe('notifications.loading');
    expect(s.supportTicketsSubcopy()).toBe('notifications.loading');
    s.ticketsLoading.set(false);
    expect(s.supportTicketsLabel()).toBe('...');
    expect(s.supportTicketsSubcopy()).toBe('');
    s.ticketsLoaded.set(true);
    s.ticketsError.set('account.overview.support.loadError');
    expect(s.supportTicketsLabel()).toBe('account.overview.support.loadError');
    expect(s.supportTicketsSubcopy()).toBe('account.overview.support.loadErrorCopy');
    s.ticketsError.set(null);
    s.tickets.set([]);
    expect(s.supportTicketsLabel()).toBe('account.overview.support.none');
    expect(s.supportTicketsSubcopy()).toBe('account.overview.support.noneCopy');
    s.tickets.set([{ status: 'resolved' }, { status: 'resolved' }]);
    expect(s.supportTicketsLabel()).toBe('account.overview.support.allResolved');
    s.tickets.set([{ status: 'open' }]);
    expect(s.supportTicketsLabel()).toBe('account.overview.support.openOne');
    s.tickets.set([{ status: 'open' }, { status: 'open' }]);
    expect(s.supportTicketsLabel()).toBe('account.overview.support.openMany');
    expect(s.supportTicketsSubcopy()).toBe('account.overview.support.hint');
  });

  // ---- notifications save ------------------------------------------------------

  it('saveNotifications unauthenticated, success, error', () => {
    const s = build();
    auth.isAuthenticated.and.returnValue(false);
    s.saveNotifications();
    expect(auth.updateNotificationPreferences).not.toHaveBeenCalled();
    auth.isAuthenticated.and.returnValue(true);
    s.saveNotifications();
    expect(s.notificationsMessage).toBe('account.notifications.saved');
    auth.updateNotificationPreferences.and.returnValue(throwError(() => new Error('x')));
    resetBusy(s);
    s.saveNotifications();
    expect(s.notificationsError).toBe('account.notifications.saveError');
  });

  // ---- deletion / export -------------------------------------------------------

  it('loadDeletionStatus success, error, unauthenticated', () => {
    const s = build() as any;
    s.loadDeletionStatus();
    expect(s.deletionStatus()).toBeTruthy();
    account.getDeletionStatus.and.returnValue(throwError(() => new Error('x')));
    resetBusy(s);
    s.loadDeletionStatus();
    expect(s.deletionError()).toBe('account.privacy.deletion.loadError');
    auth.isAuthenticated.and.returnValue(false);
    s.loadDeletionStatus();
  });

  it('loadLatestExportJob success starts polling, 404, error, guard, unauthenticated', fakeAsync(() => {
    const s = build() as any;
    account.getLatestExportJob.and.returnValue(of({ id: 'j1', status: 'pending' } as any));
    s.loadLatestExportJob();
    expect(s.exportJob()).toBeTruthy();
    s.stopExportJobPolling();
    // guard: loading
    s.exportJobLoading.set(true);
    s.loadLatestExportJob();
    s.exportJobLoading.set(false);
    // 404
    account.getLatestExportJob.and.returnValue(throwError(() => ({ status: 404 })));
    resetBusy(s);
    s.loadLatestExportJob();
    expect(s.exportJob()).toBeNull();
    // generic error
    account.getLatestExportJob.and.returnValue(throwError(() => ({ error: { detail: 'ee' } })));
    resetBusy(s);
    s.loadLatestExportJob();
    expect(s.exportError).toBe('ee');
    account.getLatestExportJob.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.loadLatestExportJob();
    expect(s.exportError).toBe('account.privacy.export.loadError');
    auth.isAuthenticated.and.returnValue(false);
    s.loadLatestExportJob();
    discardPeriodicTasks();
  }));

  it('export job polling transitions to succeeded and stops', () => {
    const s = build() as any;
    let cb: any;
    spyOn(window, 'setInterval').and.callFake((fn: any) => {
      cb = fn;
      return 777 as any;
    });
    const clearSpy = spyOn(window, 'clearInterval');
    account.getExportJob.and.returnValue(of({ id: 'j1', status: 'running' } as any));
    s.startExportJobPolling('j1');
    cb();
    expect(account.getExportJob).toHaveBeenCalledTimes(1);
    // status unchanged (prev running === next running) exercises the else-if false arm
    account.getExportJob.and.returnValue(of({ id: 'j1', status: 'running' } as any));
    cb();
    account.getExportJob.and.returnValue(of({ id: 'j1', status: 'succeeded' } as any));
    cb();
    expect(toast.success).toHaveBeenCalledWith('account.privacy.export.readyToast');
    expect(notifications.refreshUnreadCount).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
    // succeeded again but already toasted for this job → no duplicate toast
    toast.success.calls.reset();
    s.exportReadyToastShownForJobId = 'j1';
    account.getExportJob.and.returnValue(of({ id: 'j1', status: 'succeeded' } as any));
    cb();
    expect(toast.success).not.toHaveBeenCalled();
    // succeeded with empty id → inner guard skips toast
    account.getExportJob.and.returnValue(of({ id: '', status: 'succeeded' } as any));
    cb();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('startExportJobPolling skips re-entry for the same active job', () => {
    const s = build() as any;
    spyOn(window, 'setInterval').and.returnValue(555 as any);
    spyOn(window, 'clearInterval');
    s.exportJob.set({ id: 'j1', status: 'pending' });
    s.startExportJobPolling('j1');
    expect(s.exportJobPoll).toBe(555);
    s.startExportJobPolling('j1');
    expect(window.setInterval).toHaveBeenCalledTimes(1);
    s.stopExportJobPolling();
  });

  it('export polling guards: empty id, unauthenticated tick, in-flight, error tick', () => {
    const s = build() as any;
    s.startExportJobPolling('');
    expect(s.exportJobPoll).toBeUndefined();
    let cb: any;
    spyOn(window, 'setInterval').and.callFake((fn: any) => {
      cb = fn;
      return 1 as any;
    });
    spyOn(window, 'clearInterval');
    s.startExportJobPolling('j2');
    // unauthenticated → callback returns early
    account.getExportJob.calls.reset();
    auth.isAuthenticated.and.returnValue(false);
    cb();
    expect(account.getExportJob).not.toHaveBeenCalled();
    auth.isAuthenticated.and.returnValue(true);
    // in-flight → returns early
    s.exportJobPollInFlight = true;
    cb();
    expect(account.getExportJob).not.toHaveBeenCalled();
    s.exportJobPollInFlight = false;
    // error tick keeps polling (no throw)
    account.getExportJob.and.returnValue(throwError(() => new Error('x')));
    cb();
    expect(account.getExportJob).toHaveBeenCalled();
    s.stopExportJobPolling();
  });

  it('export polling failed status stops without toast', () => {
    const s = build() as any;
    let cb: any;
    spyOn(window, 'setInterval').and.callFake((fn: any) => {
      cb = fn;
      return 1 as any;
    });
    const clearSpy = spyOn(window, 'clearInterval');
    account.getExportJob.and.returnValue(of({ id: 'j1', status: 'failed' } as any));
    s.startExportJobPolling('j1');
    cb();
    expect(clearSpy).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('requestDataExport success (pending+succeeded), guard, error', () => {
    const s = build() as any;
    s.requestDataExport();
    expect(account.startExportJob).toHaveBeenCalled();
    s.stopExportJobPolling();
    // succeeded status
    account.startExportJob.and.returnValue(of({ id: 'j2', status: 'succeeded' } as any));
    s.requestDataExport();
    expect(s.exportReadyToastShownForJobId).toBe('j2');
    // guard: already loading
    s.exportJobLoading.set(true);
    s.requestDataExport();
    s.exportJobLoading.set(false);
    s.exportingData = true;
    s.requestDataExport();
    s.exportingData = false;
    // error
    account.startExportJob.and.returnValue(throwError(() => ({ error: { detail: 'xe' } })));
    resetBusy(s);
    s.requestDataExport();
    expect(s.exportError).toBe('xe');
    account.startExportJob.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.requestDataExport();
    expect(s.exportError).toBe('account.privacy.export.startError');
    auth.isAuthenticated.and.returnValue(false);
    s.requestDataExport();
  });

  it('downloadExportJob success, guard conditions, error', () => {
    const s = build() as any;
    spyOn(document, 'createElement').and.returnValue({ click: jasmine.createSpy('click'), set href(v: string) {}, set download(v: string) {} } as any);
    spyOn(window.URL, 'createObjectURL').and.returnValue('blob:1');
    spyOn(window.URL, 'revokeObjectURL');
    // not succeeded → return
    s.exportJob.set({ id: 'j1', status: 'pending' });
    s.downloadExportJob();
    expect(account.downloadExportJob).not.toHaveBeenCalled();
    // succeeded
    s.exportJob.set({ id: 'j1', status: 'succeeded' });
    s.downloadExportJob();
    expect(toast.success).toHaveBeenCalledWith('account.privacy.export.downloaded');
    // error
    account.downloadExportJob.and.returnValue(throwError(() => ({ error: { detail: 'de' } })));
    resetBusy(s);
    s.exportJob.set({ id: 'j1', status: 'succeeded' });
    s.downloadExportJob();
    expect(s.exportError).toBe('de');
    account.downloadExportJob.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.exportJob.set({ id: 'j1', status: 'succeeded' });
    s.downloadExportJob();
    expect(s.exportError).toBe('account.privacy.export.downloadError');
  });

  it('downloadMyData routes to download or request', () => {
    const s = build() as any;
    const dl = spyOn(s, 'downloadExportJob');
    const req = spyOn(s, 'requestDataExport');
    s.exportJob.set({ id: 'j1', status: 'succeeded' });
    s.downloadMyData();
    expect(dl).toHaveBeenCalled();
    s.exportJob.set({ id: 'j1', status: 'pending' });
    s.downloadMyData();
    expect(req).toHaveBeenCalled();
  });

  it('exportActionLabelKey and exportActionDisabled', () => {
    const s = build() as any;
    s.exportJobLoading.set(true);
    expect(s.exportActionLabelKey()).toBe('account.privacy.export.actionWorking');
    expect(s.exportActionDisabled()).toBeTrue();
    s.exportJobLoading.set(false);
    s.exportJob.set(null);
    expect(s.exportActionLabelKey()).toBe('account.privacy.export.actionGenerate');
    expect(s.exportActionDisabled()).toBeFalse();
    s.exportJob.set({ status: 'succeeded' });
    expect(s.exportActionLabelKey()).toBe('account.privacy.export.actionDownload');
    s.exportingData = true;
    expect(s.exportActionLabelKey()).toBe('account.privacy.export.actionDownloading');
    expect(s.exportActionDisabled()).toBeTrue();
    s.exportingData = false;
    s.exportJob.set({ status: 'failed' });
    expect(s.exportActionLabelKey()).toBe('account.privacy.export.actionRetry');
    s.exportJob.set({ status: 'pending' });
    expect(s.exportActionLabelKey()).toBe('account.privacy.export.actionGenerating');
    expect(s.exportActionDisabled()).toBeTrue();
    s.exportJob.set({ status: 'running' });
    expect(s.exportActionDisabled()).toBeTrue();
  });

  it('requestDeletion guard, no password, success, error', () => {
    const s = build() as any;
    s.requestingDeletion = true;
    s.requestDeletion();
    expect(account.requestAccountDeletion).not.toHaveBeenCalled();
    s.requestingDeletion = false;
    s.deletionPassword = '   ';
    s.requestDeletion();
    expect(s.deletionError()).toBe('auth.currentPasswordRequired');
    s.deletionPassword = 'pw';
    s.deletionConfirmText = 'DELETE';
    s.requestDeletion();
    expect(toast.success).toHaveBeenCalledWith('account.privacy.deletion.scheduled');
    account.requestAccountDeletion.and.returnValue(throwError(() => ({ error: { detail: 'rde' } })));
    resetBusy(s);
    s.deletionPassword = 'pw';
    s.requestDeletion();
    expect(s.deletionError()).toBe('rde');
    account.requestAccountDeletion.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.deletionPassword = 'pw';
    s.requestDeletion();
    expect(s.deletionError()).toBe('account.privacy.deletion.requestError');
    auth.isAuthenticated.and.returnValue(false);
    s.deletionPassword = 'pw';
    s.requestDeletion();
  });

  it('cancelDeletion guard, success, error', () => {
    const s = build() as any;
    s.cancellingDeletion = true;
    s.cancelDeletion();
    expect(account.cancelAccountDeletion).not.toHaveBeenCalled();
    s.cancellingDeletion = false;
    s.cancelDeletion();
    expect(toast.success).toHaveBeenCalledWith('account.privacy.deletion.canceled');
    account.cancelAccountDeletion.and.returnValue(throwError(() => ({ error: { detail: 'cde' } })));
    resetBusy(s);
    s.cancelDeletion();
    expect(s.deletionError()).toBe('cde');
    account.cancelAccountDeletion.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.cancelDeletion();
    expect(s.deletionError()).toBe('account.privacy.deletion.cancelError');
    auth.isAuthenticated.and.returnValue(false);
    s.cancelDeletion();
  });

  it('deletion cooldown calculations and formatDurationShort', () => {
    const s = build() as any;
    s.now.set(1_000_000);
    expect(s.deletionCooldownRemainingMs()).toBeNull();
    s.deletionStatus.set({ requested_at: null, scheduled_for: new Date(1_000_000 + 5000).toISOString() });
    expect(s.deletionCooldownRemainingMs()).toBe(5000);
    s.deletionStatus.set({ requested_at: null, scheduled_for: new Date(500_000).toISOString() });
    expect(s.deletionCooldownRemainingMs()).toBe(0);
    // progress percent
    s.deletionStatus.set({ requested_at: null, scheduled_for: null });
    expect(s.deletionCooldownProgressPercent()).toBe(0);
    s.deletionStatus.set({
      requested_at: new Date(900_000).toISOString(),
      scheduled_for: new Date(1_100_000).toISOString(),
    });
    expect(s.deletionCooldownProgressPercent()).toBeGreaterThan(0);
    // end <= start
    s.deletionStatus.set({
      requested_at: new Date(1_100_000).toISOString(),
      scheduled_for: new Date(900_000).toISOString(),
    });
    expect(s.deletionCooldownProgressPercent()).toBe(0);
    // clamps to 100 when now is past the scheduled end
    s.deletionStatus.set({
      requested_at: new Date(900_000).toISOString(),
      scheduled_for: new Date(950_000).toISOString(),
    });
    expect(s.deletionCooldownProgressPercent()).toBe(100);
    // formatDurationShort
    expect(s.formatDurationShort(-5)).toBe('0s');
    expect(s.formatDurationShort(3_700_000)).toContain('h');
    expect(s.formatDurationShort(120_000)).toContain('m');
    expect(s.formatDurationShort(5000)).toBe('5s');
    // parseTimestampMs invalid
    expect(s.parseTimestampMs('not-a-date')).toBeNull();
  });

  // ---- comments ----------------------------------------------------------------

  it('loadMyComments success, error, unauthenticated and paging', () => {
    const s = build() as any;
    blog.listMyComments.and.returnValue(
      of({ items: [{ id: 'c1' }], meta: { total_items: 1, total_pages: 3, page: 2, limit: 10 } } as any),
    );
    s.loadMyComments(2);
    expect(s.myCommentsPage).toBe(2);
    // next page
    s.nextMyCommentsPage();
    expect(blog.listMyComments).toHaveBeenCalledTimes(2);
    // prev page
    s.prevMyCommentsPage();
    expect(blog.listMyComments).toHaveBeenCalledTimes(3);
    // no meta guards
    s.myCommentsMeta.set(null);
    s.nextMyCommentsPage();
    s.prevMyCommentsPage();
    expect(blog.listMyComments).toHaveBeenCalledTimes(3);
    // page bounds
    s.myCommentsMeta.set({ page: 3, total_pages: 3 } as any);
    s.nextMyCommentsPage();
    s.myCommentsMeta.set({ page: 1, total_pages: 3 } as any);
    s.prevMyCommentsPage();
    expect(blog.listMyComments).toHaveBeenCalledTimes(3);
    // error
    blog.listMyComments.and.returnValue(throwError(() => new Error('x')));
    resetBusy(s);
    s.loadMyComments();
    expect(s.myCommentsError()).toBe('account.comments.loadError');
    auth.isAuthenticated.and.returnValue(false);
    s.loadMyComments();
  });

  it('commentStatusChipClass and formatTimestamp', () => {
    const s = build();
    expect(s.commentStatusChipClass('posted')).toContain('emerald');
    expect(s.commentStatusChipClass('hidden')).toContain('amber');
    expect(s.commentStatusChipClass('deleted')).toContain('slate');
    expect(s.commentStatusChipClass('other')).toContain('slate');
    expect(s.formatTimestamp(null)).toBe('');
    expect(typeof s.formatTimestamp('2020-01-01')).toBe('string');
  });

  // ---- idle timer / destroy ----------------------------------------------------

  it('resetIdleTimer triggers idle logout', fakeAsync(() => {
    const s = build() as any;
    const out = spyOn(s, 'signOut');
    s.resetIdleTimer();
    // calling again clears the prior timer (covers the clearTimeout branch)
    s.resetIdleTimer();
    tick(30 * 60 * 1000);
    expect(s.idleWarning()).toBe('account.security.session.idleLogout');
    expect(out).toHaveBeenCalled();
    discardPeriodicTasks();
  }));

  it('handleUserActivity resets the idle timer', () => {
    const s = build() as any;
    const spy = spyOn(s, 'resetIdleTimer');
    s.handleUserActivity();
    expect(spy).toHaveBeenCalled();
  });

  it('ngOnDestroy after full init clears timers and listeners', () => {
    const fixture = TestBed.createComponent(HostComponent);
    const s = fixture.componentInstance as any;
    router.url = '/account/overview';
    s.ngOnInit();
    s.exportJobPoll = window.setInterval(() => {}, 1000);
    s.ngOnDestroy();
    expect(s.exportJobPoll).toBeUndefined();
    created = null; // already destroyed
  });

  // ---- secondary emails / sessions / security events ---------------------------

  it('loadSecondaryEmails success, guards, error, unauthenticated', () => {
    const s = build() as any;
    s.loadSecondaryEmails();
    expect(s.secondaryEmailsLoaded()).toBeTrue();
    s.loadSecondaryEmails();
    expect(auth.listEmails).toHaveBeenCalledTimes(1);
    s.secondaryEmailsLoaded.set(false);
    s.secondaryEmailsLoading.set(true);
    s.loadSecondaryEmails();
    expect(auth.listEmails).toHaveBeenCalledTimes(1);
    s.secondaryEmailsLoading.set(false);
    auth.listEmails.and.returnValue(of({ secondary_emails: null } as any));
    s.loadSecondaryEmails(true);
    expect(s.secondaryEmails()).toEqual([]);
    auth.listEmails.and.returnValue(throwError(() => new Error('x')));
    resetBusy(s);
    s.loadSecondaryEmails(true);
    expect(s.secondaryEmailsError()).toBe('account.security.emails.loadError');
    auth.isAuthenticated.and.returnValue(false);
    s.loadSecondaryEmails(true);
  });

  it('loadSessions success, guards, error, unauthenticated', () => {
    const s = build() as any;
    auth.listSessions.and.returnValue(of([{ id: 's1', is_current: true }] as any));
    s.loadSessions();
    expect(s.sessionsLoaded()).toBeTrue();
    s.loadSessions();
    expect(auth.listSessions).toHaveBeenCalledTimes(1);
    s.sessionsLoaded.set(false);
    s.sessionsLoading.set(true);
    s.loadSessions();
    expect(auth.listSessions).toHaveBeenCalledTimes(1);
    s.sessionsLoading.set(false);
    auth.listSessions.and.returnValue(of(null as any));
    s.loadSessions(true);
    expect(s.sessions()).toEqual([]);
    auth.listSessions.and.returnValue(throwError(() => new Error('x')));
    resetBusy(s);
    s.loadSessions(true);
    expect(s.sessionsError()).toBe('account.security.devices.loadError');
    auth.isAuthenticated.and.returnValue(false);
    s.loadSessions(true);
  });

  it('loadSecurityEvents success, guards, error, unauthenticated', () => {
    const s = build() as any;
    auth.listSecurityEvents.and.returnValue(of([{ id: 'e1' }] as any));
    s.loadSecurityEvents();
    expect(s.securityEventsLoaded()).toBeTrue();
    s.loadSecurityEvents();
    expect(auth.listSecurityEvents).toHaveBeenCalledTimes(1);
    s.securityEventsLoaded.set(false);
    s.securityEventsLoading.set(true);
    s.loadSecurityEvents();
    expect(auth.listSecurityEvents).toHaveBeenCalledTimes(1);
    s.securityEventsLoading.set(false);
    auth.listSecurityEvents.and.returnValue(of(null as any));
    s.loadSecurityEvents(true);
    expect(s.securityEvents()).toEqual([]);
    auth.listSecurityEvents.and.returnValue(throwError(() => new Error('x')));
    resetBusy(s);
    s.loadSecurityEvents(true);
    expect(s.securityEventsError()).toBe('account.security.activity.loadError');
    auth.isAuthenticated.and.returnValue(false);
    s.loadSecurityEvents(true);
  });

  it('loadTwoFactorStatus success, guards, error, unauthenticated', () => {
    const s = build() as any;
    s.loadTwoFactorStatus();
    expect(s.twoFactorLoaded()).toBeTrue();
    s.loadTwoFactorStatus();
    expect(auth.getTwoFactorStatus).toHaveBeenCalledTimes(1);
    s.twoFactorLoaded.set(false);
    s.twoFactorLoading.set(true);
    s.loadTwoFactorStatus();
    expect(auth.getTwoFactorStatus).toHaveBeenCalledTimes(1);
    s.twoFactorLoading.set(false);
    auth.getTwoFactorStatus.and.returnValue(throwError(() => new Error('x')));
    resetBusy(s);
    s.loadTwoFactorStatus(true);
    expect(s.twoFactorError()).toBe('account.security.twoFactor.loadError');
    auth.isAuthenticated.and.returnValue(false);
    s.loadTwoFactorStatus(true);
  });

  // ---- passkeys ----------------------------------------------------------------

  it('passkeysSupported reflects environment', () => {
    const s = build();
    expect(typeof s.passkeysSupported()).toBe('boolean');
  });

  it('loadPasskeys when supported: success, guards, error', () => {
    const s = build() as any;
    spyOn(s, 'passkeysSupported').and.returnValue(true);
    auth.listPasskeys.and.returnValue(of([{ id: 'pk1' }] as any));
    s.loadPasskeys();
    expect(s.passkeysLoaded()).toBeTrue();
    s.loadPasskeys();
    expect(auth.listPasskeys).toHaveBeenCalledTimes(1);
    s.passkeysLoaded.set(false);
    s.passkeysLoading.set(true);
    s.loadPasskeys();
    expect(auth.listPasskeys).toHaveBeenCalledTimes(1);
    s.passkeysLoading.set(false);
    auth.listPasskeys.and.returnValue(of(null as any));
    s.loadPasskeys(true);
    expect(s.passkeys()).toEqual([]);
    auth.listPasskeys.and.returnValue(throwError(() => new Error('x')));
    resetBusy(s);
    s.loadPasskeys(true);
    expect(s.passkeysError()).toBe('account.security.passkeys.loadError');
  });

  it('loadPasskeys when unsupported sets loaded empty; unauthenticated returns', () => {
    const s = build() as any;
    spyOn(s, 'passkeysSupported').and.returnValue(false);
    s.loadPasskeys();
    expect(s.passkeysLoaded()).toBeTrue();
    expect(s.passkeys()).toEqual([]);
    auth.isAuthenticated.and.returnValue(false);
    (s as any).passkeysLoaded.set(false);
    s.loadPasskeys();
    expect(s.passkeysLoaded()).toBeFalse();
  });

  it('registerPasskey guards: unauthenticated, busy, unsupported, no password', () => {
    const s = build() as any;
    auth.isAuthenticated.and.returnValue(false);
    s.registerPasskey();
    expect(auth.startPasskeyRegistration).not.toHaveBeenCalled();
    auth.isAuthenticated.and.returnValue(true);
    s.registeringPasskey = true;
    s.registerPasskey();
    s.registeringPasskey = false;
    spyOn(s, 'passkeysSupported').and.returnValue(false);
    s.registerPasskey();
    expect(toast.error).toHaveBeenCalledWith('account.security.passkeys.notSupported');
  });

  it('registerPasskey no password when supported', () => {
    const s = build() as any;
    spyOn(s, 'passkeysSupported').and.returnValue(true);
    s.passkeyRegisterPassword = '   ';
    s.registerPasskey();
    expect(toast.error).toHaveBeenCalledWith('auth.completeForm');
  });

  it('registerPasskey full success flow', async () => {
    const s = build() as any;
    spyOn(s, 'passkeysSupported').and.returnValue(true);
    const cred: any = {
      id: 'c',
      rawId: new Uint8Array([1, 2]).buffer,
      type: 'public-key',
      response: { clientDataJSON: new Uint8Array([3]).buffer, attestationObject: new Uint8Array([4]).buffer },
      getClientExtensionResults: () => ({}),
    };
    spyOn(navigator.credentials, 'create').and.returnValue(Promise.resolve(cred));
    s.passkeyRegisterPassword = 'pw';
    s.passkeyRegisterName = 'My Key';
    await s.registerPasskey();
    await Promise.resolve();
    expect(auth.completePasskeyRegistration).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('account.security.passkeys.added');
  });

  it('registerPasskey complete error', async () => {
    const s = build() as any;
    spyOn(s, 'passkeysSupported').and.returnValue(true);
    const cred: any = {
      id: 'c',
      rawId: new Uint8Array([1]).buffer,
      type: 'public-key',
      response: { clientDataJSON: new Uint8Array([3]).buffer },
      getClientExtensionResults: () => ({}),
    };
    spyOn(navigator.credentials, 'create').and.returnValue(Promise.resolve(cred));
    auth.completePasskeyRegistration.and.returnValue(throwError(() => ({ error: { detail: 'pke' } })));
    resetBusy(s);
    s.passkeyRegisterPassword = 'pw';
    s.passkeyRegisterName = '';
    await s.registerPasskey();
    await Promise.resolve();
    expect(toast.error).toHaveBeenCalledWith('pke');
  });

  it('registerPasskey null credential and cancel and generic create error', async () => {
    const s = build() as any;
    spyOn(s, 'passkeysSupported').and.returnValue(true);
    const createSpy = spyOn(navigator.credentials, 'create').and.returnValue(Promise.resolve(null));
    s.passkeyRegisterPassword = 'pw';
    await s.registerPasskey();
    await Promise.resolve();
    expect(s.registeringPasskey).toBeFalse();
    // NotAllowedError → info. Reject with the raw WebAuthn-style error shape the
    // source inspects (err.name / err.message); a real Error always has a truthy
    // `name`, which would not exercise the `err?.name || ''` fallback branch.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- exercises the catch's err.name handling
    createSpy.and.returnValue(Promise.reject({ name: 'NotAllowedError' }));
    s.passkeyRegisterPassword = 'pw';
    await s.registerPasskey();
    await Promise.resolve();
    expect(toast.info).toHaveBeenCalledWith('account.security.passkeys.cancelled');
    // generic error with a message but no name → `err?.name || ''` fallback
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- exercises the catch's err.message handling
    createSpy.and.returnValue(Promise.reject({ message: 'boom' }));
    s.passkeyRegisterPassword = 'pw';
    await s.registerPasskey();
    await Promise.resolve();
    expect(toast.error).toHaveBeenCalledWith('boom');
    // generic error with neither name nor message → both `|| ''` fallbacks → default key
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- exercises the catch's empty-shape fallback
    createSpy.and.returnValue(Promise.reject({}));
    s.passkeyRegisterPassword = 'pw';
    await s.registerPasskey();
    await Promise.resolve();
    expect(toast.error).toHaveBeenCalledWith('account.security.passkeys.addError');
  });

  it('registerPasskey start error', () => {
    const s = build() as any;
    spyOn(s, 'passkeysSupported').and.returnValue(true);
    auth.startPasskeyRegistration.and.returnValue(throwError(() => ({ error: { detail: 'se' } })));
    resetBusy(s);
    s.passkeyRegisterPassword = 'pw';
    s.registerPasskey();
    expect(toast.error).toHaveBeenCalledWith('se');
    auth.startPasskeyRegistration.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.passkeyRegisterPassword = 'pw';
    s.registerPasskey();
    expect(toast.error).toHaveBeenCalledWith('account.security.passkeys.addError');
  });

  it('startRemovePasskey / cancelRemovePasskey / confirmRemovePasskey', () => {
    const s = build() as any;
    s.removingPasskeyId = 'busy';
    s.startRemovePasskey('pk1');
    expect(s.removePasskeyConfirmId).toBeNull();
    s.removingPasskeyId = null;
    s.startRemovePasskey('pk1');
    expect(s.removePasskeyConfirmId).toBe('pk1');
    // cancel guard
    s.removingPasskeyId = 'busy';
    s.cancelRemovePasskey();
    expect(s.removePasskeyConfirmId).toBe('pk1');
    s.removingPasskeyId = null;
    s.cancelRemovePasskey();
    expect(s.removePasskeyConfirmId).toBeNull();
    // confirm unauthenticated
    auth.isAuthenticated.and.returnValue(false);
    s.confirmRemovePasskey();
    auth.isAuthenticated.and.returnValue(true);
    // confirm with no confirm id
    s.removePasskeyConfirmId = null;
    s.confirmRemovePasskey();
    expect(auth.deletePasskey).not.toHaveBeenCalled();
    // confirm declined
    s.removePasskeyConfirmId = 'pk1';
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    s.confirmRemovePasskey();
    expect(auth.deletePasskey).not.toHaveBeenCalled();
    confirmSpy.and.returnValue(true);
    // no password
    s.removePasskeyPassword = '';
    s.confirmRemovePasskey();
    expect(s.passkeysError()).toBe('auth.currentPasswordRequired');
    // success
    s.passkeys.set([{ id: 'pk1' }, { id: 'pk2' }] as any);
    s.removePasskeyConfirmId = 'pk1';
    s.removePasskeyPassword = 'pw';
    s.confirmRemovePasskey();
    expect(s.passkeys().some((p: any) => p.id === 'pk1')).toBeFalse();
    // busy guard
    s.removingPasskeyId = 'x';
    s.confirmRemovePasskey();
    s.removingPasskeyId = null;
  });

  it('confirmRemovePasskey error variants', () => {
    const s = build() as any;
    spyOn(window, 'confirm').and.returnValue(true);
    auth.deletePasskey.and.returnValue(throwError(() => ({ error: { detail: 'rmerr' } })));
    resetBusy(s);
    s.removePasskeyConfirmId = 'pk1';
    s.removePasskeyPassword = 'pw';
    s.confirmRemovePasskey();
    expect(toast.error).toHaveBeenCalledWith('rmerr');
    auth.deletePasskey.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.removePasskeyConfirmId = 'pk1';
    s.removePasskeyPassword = 'pw';
    s.confirmRemovePasskey();
    expect(toast.error).toHaveBeenCalledWith('account.security.passkeys.removeError');
  });

  // ---- two factor --------------------------------------------------------------

  it('startTwoFactorSetup guards, success, error', () => {
    const s = build() as any;
    auth.isAuthenticated.and.returnValue(false);
    s.startTwoFactorSetup();
    expect(auth.startTwoFactorSetup).not.toHaveBeenCalled();
    auth.isAuthenticated.and.returnValue(true);
    s.startingTwoFactor = true;
    s.startTwoFactorSetup();
    s.startingTwoFactor = false;
    s.twoFactorSetupPassword = '';
    s.startTwoFactorSetup();
    expect(toast.error).toHaveBeenCalledWith('auth.completeForm');
    s.twoFactorSetupPassword = 'pw';
    s.startTwoFactorSetup();
    expect(s.twoFactorSetupSecret).toBe('S');
    auth.startTwoFactorSetup.and.returnValue(throwError(() => ({ error: { detail: 'te' } })));
    resetBusy(s);
    s.twoFactorSetupPassword = 'pw';
    s.startTwoFactorSetup();
    expect(s.twoFactorError()).toBe('te');
    auth.startTwoFactorSetup.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.twoFactorSetupPassword = 'pw';
    s.startTwoFactorSetup();
    expect(s.twoFactorError()).toBe('account.security.twoFactor.startError');
  });

  it('enableTwoFactor guards, success, error', () => {
    const s = build() as any;
    auth.isAuthenticated.and.returnValue(false);
    s.enableTwoFactor();
    expect(auth.enableTwoFactor).not.toHaveBeenCalled();
    auth.isAuthenticated.and.returnValue(true);
    s.enablingTwoFactor = true;
    s.enableTwoFactor();
    s.enablingTwoFactor = false;
    s.twoFactorEnableCode = '';
    s.enableTwoFactor();
    expect(toast.error).toHaveBeenCalledWith('auth.completeForm');
    s.twoFactorEnableCode = '123456';
    // loadCurrentUser rejects so the `error: () => void 0` refresh callback is exercised
    auth.loadCurrentUser.and.returnValue(throwError(() => new Error('x')));
    s.enableTwoFactor();
    expect(s.twoFactorRecoveryCodes).toEqual(['c1', 'c2']);
    auth.loadCurrentUser.and.returnValue(of(PROFILE_FULL));
    // recovery_codes missing → []
    auth.enableTwoFactor.and.returnValue(of({} as any));
    s.twoFactorEnableCode = '123456';
    s.enableTwoFactor();
    expect(s.twoFactorRecoveryCodes).toEqual([]);
    auth.enableTwoFactor.and.returnValue(throwError(() => ({ error: { detail: 'ee' } })));
    resetBusy(s);
    s.twoFactorEnableCode = '123456';
    s.enableTwoFactor();
    expect(s.twoFactorError()).toBe('ee');
    auth.enableTwoFactor.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.twoFactorEnableCode = '123456';
    s.enableTwoFactor();
    expect(s.twoFactorError()).toBe('account.security.twoFactor.enableError');
  });

  it('copyTwoFactorSecret/Url/RecoveryCodes copy success and unavailable', async () => {
    const s = build() as any;
    setClipboard({ writeText: jasmine.createSpy('w').and.returnValue(Promise.resolve()) });
    // nothing to copy → early returns
    s.twoFactorSetupSecret = null;
    await s.copyTwoFactorSecret();
    s.twoFactorSetupUrl = null;
    await s.copyTwoFactorSetupUrl();
    s.twoFactorRecoveryCodes = null;
    await s.copyTwoFactorRecoveryCodes();
    expect(toast.success).not.toHaveBeenCalled();
    // success copies
    s.twoFactorSetupSecret = 'SEC';
    await s.copyTwoFactorSecret();
    expect(toast.success).toHaveBeenCalledWith('account.security.twoFactor.copied');
    s.twoFactorSetupUrl = 'otpauth://x';
    await s.copyTwoFactorSetupUrl();
    s.twoFactorRecoveryCodes = ['a', 'b'];
    await s.copyTwoFactorRecoveryCodes();
    // copy failure fallbacks
    setClipboard({ writeText: jasmine.createSpy('w').and.returnValue(Promise.reject(new Error('no'))) });
    s.twoFactorSetupSecret = 'SEC';
    await s.copyTwoFactorSecret();
    expect(toast.success).toHaveBeenCalledWith('account.security.twoFactor.copySecret');
    s.twoFactorSetupUrl = 'otpauth://x';
    await s.copyTwoFactorSetupUrl();
    expect(toast.success).toHaveBeenCalledWith('account.security.twoFactor.copyUrl');
    s.twoFactorRecoveryCodes = ['a'];
    await s.copyTwoFactorRecoveryCodes();
    expect(toast.success).toHaveBeenCalledWith('account.security.twoFactor.copyCodes');
  });

  it('updateTwoFactorSetupQr: empty url, success, stale request, encode failure', async () => {
    const s = build() as any;
    // empty url early return
    s.twoFactorSetupUrl = '';
    await s.updateTwoFactorSetupQr();
    expect(s.twoFactorSetupQrDataUrl).toBeNull();
    // success
    s.twoFactorSetupUrl = 'otpauth://totp/x?secret=ABC';
    await s.updateTwoFactorSetupQr();
    expect(s.twoFactorSetupQrDataUrl).toContain('data:');
    // stale request: start two; first sees stale id
    s.twoFactorSetupUrl = 'otpauth://totp/y?secret=DEF';
    const p1 = s.updateTwoFactorSetupQr();
    const p2 = s.updateTwoFactorSetupQr();
    await Promise.all([p1, p2]);
    expect(s.twoFactorSetupQrDataUrl).toContain('data:');
    // encode failure (oversized payload) → caught, stays null
    s.twoFactorSetupQrDataUrl = null;
    s.twoFactorSetupUrl = 'x'.repeat(3000); // exceeds QR byte-mode capacity → encode throws
    await s.updateTwoFactorSetupQr();
    expect(s.twoFactorSetupQrDataUrl).toBeNull();
  });

  it('regenerateTwoFactorRecoveryCodes guards, success, error', () => {
    const s = build() as any;
    auth.isAuthenticated.and.returnValue(false);
    s.regenerateTwoFactorRecoveryCodes();
    expect(auth.regenerateTwoFactorRecoveryCodes).not.toHaveBeenCalled();
    auth.isAuthenticated.and.returnValue(true);
    s.regeneratingTwoFactorCodes = true;
    s.regenerateTwoFactorRecoveryCodes();
    s.regeneratingTwoFactorCodes = false;
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    s.regenerateTwoFactorRecoveryCodes();
    expect(auth.regenerateTwoFactorRecoveryCodes).not.toHaveBeenCalled();
    confirmSpy.and.returnValue(true);
    s.twoFactorManagePassword = '';
    s.twoFactorManageCode = '';
    s.regenerateTwoFactorRecoveryCodes();
    expect(toast.error).toHaveBeenCalledWith('auth.completeForm');
    s.twoFactorManagePassword = 'pw';
    s.twoFactorManageCode = '123';
    s.regenerateTwoFactorRecoveryCodes();
    expect(s.twoFactorRecoveryCodes).toEqual(['c3']);
    auth.regenerateTwoFactorRecoveryCodes.and.returnValue(of({} as any));
    s.twoFactorManagePassword = 'pw';
    s.twoFactorManageCode = '123';
    s.regenerateTwoFactorRecoveryCodes();
    expect(s.twoFactorRecoveryCodes).toEqual([]);
    auth.regenerateTwoFactorRecoveryCodes.and.returnValue(throwError(() => ({ error: { detail: 're' } })));
    resetBusy(s);
    s.twoFactorManagePassword = 'pw';
    s.twoFactorManageCode = '123';
    s.regenerateTwoFactorRecoveryCodes();
    expect(s.twoFactorError()).toBe('re');
    auth.regenerateTwoFactorRecoveryCodes.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.twoFactorManagePassword = 'pw';
    s.twoFactorManageCode = '123';
    s.regenerateTwoFactorRecoveryCodes();
    expect(s.twoFactorError()).toBe('account.security.twoFactor.regenerateError');
  });

  it('disableTwoFactor guards, success, error', () => {
    const s = build() as any;
    auth.isAuthenticated.and.returnValue(false);
    s.disableTwoFactor();
    expect(auth.disableTwoFactor).not.toHaveBeenCalled();
    auth.isAuthenticated.and.returnValue(true);
    s.disablingTwoFactor = true;
    s.disableTwoFactor();
    s.disablingTwoFactor = false;
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    s.disableTwoFactor();
    expect(auth.disableTwoFactor).not.toHaveBeenCalled();
    confirmSpy.and.returnValue(true);
    s.twoFactorManagePassword = '';
    s.twoFactorManageCode = '';
    s.disableTwoFactor();
    expect(toast.error).toHaveBeenCalledWith('auth.completeForm');
    s.twoFactorManagePassword = 'pw';
    s.twoFactorManageCode = '123';
    // loadCurrentUser rejects so the `error: () => void 0` refresh callback is exercised
    auth.loadCurrentUser.and.returnValue(throwError(() => new Error('x')));
    s.disableTwoFactor();
    expect(toast.success).toHaveBeenCalledWith('account.security.activity.two_factor_disabled');
    auth.loadCurrentUser.and.returnValue(of(PROFILE_FULL));
    auth.disableTwoFactor.and.returnValue(throwError(() => ({ error: { detail: 'de' } })));
    resetBusy(s);
    s.twoFactorManagePassword = 'pw';
    s.twoFactorManageCode = '123';
    s.disableTwoFactor();
    expect(s.twoFactorError()).toBe('de');
    auth.disableTwoFactor.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.twoFactorManagePassword = 'pw';
    s.twoFactorManageCode = '123';
    s.disableTwoFactor();
    expect(s.twoFactorError()).toBe('account.security.twoFactor.disableError');
  });

  it('refreshSecurityEvents and otherSessionsCount', () => {
    const s = build() as any;
    s.refreshSecurityEvents();
    expect(auth.listSecurityEvents).toHaveBeenCalled();
    s.sessions.set([{ is_current: true }, { is_current: false }] as any);
    expect(s.otherSessionsCount()).toBe(1);
    s.sessions.set(null as any);
    expect(s.otherSessionsCount()).toBe(0);
  });

  // ---- revoke other sessions ---------------------------------------------------

  it('startRevokeOtherSessions / cancelRevokeOtherSessions / confirmRevokeOtherSessions', () => {
    const s = build() as any;
    s.revokingOtherSessions = true;
    s.startRevokeOtherSessions();
    expect(s.revokeOtherSessionsConfirming).toBeFalse();
    s.revokingOtherSessions = false;
    auth.isAuthenticated.and.returnValue(false);
    s.startRevokeOtherSessions();
    expect(s.revokeOtherSessionsConfirming).toBeFalse();
    auth.isAuthenticated.and.returnValue(true);
    s.startRevokeOtherSessions();
    expect(s.revokeOtherSessionsConfirming).toBeTrue();
    // cancel guard
    s.revokingOtherSessions = true;
    s.cancelRevokeOtherSessions();
    expect(s.revokeOtherSessionsConfirming).toBeTrue();
    s.revokingOtherSessions = false;
    s.cancelRevokeOtherSessions();
    expect(s.revokeOtherSessionsConfirming).toBeFalse();
  });

  it('confirmRevokeOtherSessions guards, declines, success (revoked/none), error', () => {
    const s = build() as any;
    // busy guard
    s.revokingOtherSessions = true;
    s.confirmRevokeOtherSessions();
    s.revokingOtherSessions = false;
    // unauthenticated
    auth.isAuthenticated.and.returnValue(false);
    s.confirmRevokeOtherSessions();
    auth.isAuthenticated.and.returnValue(true);
    // not confirming
    s.revokeOtherSessionsConfirming = false;
    s.confirmRevokeOtherSessions();
    expect(auth.revokeOtherSessions).not.toHaveBeenCalled();
    s.revokeOtherSessionsConfirming = true;
    // confirm declined
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    s.confirmRevokeOtherSessions();
    expect(auth.revokeOtherSessions).not.toHaveBeenCalled();
    confirmSpy.and.returnValue(true);
    // no password
    s.revokeOtherSessionsPassword = '';
    s.confirmRevokeOtherSessions();
    expect(s.sessionsError()).toBe('auth.currentPasswordRequired');
    // success revoked > 0
    s.revokeOtherSessionsConfirming = true;
    s.revokeOtherSessionsPassword = 'pw';
    s.confirmRevokeOtherSessions();
    expect(toast.success).toHaveBeenCalledWith('account.security.devices.revoked');
    // success none revoked
    auth.revokeOtherSessions.and.returnValue(of({ revoked: 0 } as any));
    s.revokeOtherSessionsConfirming = true;
    s.revokeOtherSessionsPassword = 'pw';
    s.confirmRevokeOtherSessions();
    expect(toast.success).toHaveBeenCalledWith('account.security.devices.noneRevoked');
    // success undefined revoked
    auth.revokeOtherSessions.and.returnValue(of({} as any));
    s.revokeOtherSessionsConfirming = true;
    s.revokeOtherSessionsPassword = 'pw';
    s.confirmRevokeOtherSessions();
    // error variants
    auth.revokeOtherSessions.and.returnValue(throwError(() => ({ error: { detail: 'roe' } })));
    resetBusy(s);
    s.revokeOtherSessionsConfirming = true;
    s.revokeOtherSessionsPassword = 'pw';
    s.confirmRevokeOtherSessions();
    expect(s.sessionsError()).toBe('roe');
    auth.revokeOtherSessions.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.revokeOtherSessionsConfirming = true;
    s.revokeOtherSessionsPassword = 'pw';
    s.confirmRevokeOtherSessions();
    expect(s.sessionsError()).toBe('account.security.devices.revokeError');
  });

  // ---- secondary email management ----------------------------------------------

  it('secondaryEmailResendRemainingSeconds and verification start/cancel', () => {
    const s = build() as any;
    s.now.set(1_000_000);
    expect(s.secondaryEmailResendRemainingSeconds('se1')).toBe(0);
    s.secondaryEmailResendUntilById.set({ se1: 1_000_000 + 20_000 });
    expect(s.secondaryEmailResendRemainingSeconds('se1')).toBe(20);
    s.startSecondaryEmailVerification('se1');
    expect(s.secondaryVerificationEmailId).toBe('se1');
    s.cancelSecondaryEmailVerification();
    expect(s.secondaryVerificationEmailId).toBeNull();
    // cooldown helpers
    s.bumpSecondaryEmailResendCooldown('se2');
    expect(s.secondaryEmailResendUntilById()['se2']).toBeGreaterThan(0);
    s.clearSecondaryEmailResendCooldown('se2');
    expect(s.secondaryEmailResendUntilById()['se2']).toBeUndefined();
    s.clearSecondaryEmailResendCooldown('missing');
  });

  it('addSecondaryEmail guard, empty, success, error', () => {
    const s = build() as any;
    s.addingSecondaryEmail = true;
    s.addSecondaryEmail();
    expect(auth.addSecondaryEmail).not.toHaveBeenCalled();
    s.addingSecondaryEmail = false;
    s.secondaryEmailToAdd = '   ';
    s.addSecondaryEmail();
    expect(s.secondaryEmailMessage).toBe('account.security.emails.enterEmail');
    s.secondaryEmailToAdd = 'b@example.com';
    s.secondaryEmails.set([{ id: 'se1' }] as any);
    s.addSecondaryEmail();
    expect(s.secondaryEmailMessage).toBe('account.security.emails.verificationSent');
    auth.addSecondaryEmail.and.returnValue(throwError(() => ({ error: { detail: 'ae' } })));
    resetBusy(s);
    s.secondaryEmailToAdd = 'c@example.com';
    s.addSecondaryEmail();
    expect(s.secondaryEmailMessage).toBe('ae');
    auth.addSecondaryEmail.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.secondaryEmailToAdd = 'd@example.com';
    s.addSecondaryEmail();
    expect(s.secondaryEmailMessage).toBe('account.security.emails.addError');
  });

  it('resendSecondaryEmailVerification cooldown, success, error', () => {
    const s = build() as any;
    s.now.set(1_000_000);
    s.secondaryEmailResendUntilById.set({ se1: 1_000_000 + 30_000 });
    s.resendSecondaryEmailVerification('se1');
    expect(auth.requestSecondaryEmailVerification).not.toHaveBeenCalled();
    s.secondaryEmailResendUntilById.set({});
    s.resendSecondaryEmailVerification('se1');
    expect(s.secondaryEmailMessage).toBe('account.security.emails.verificationResent');
    auth.requestSecondaryEmailVerification.and.returnValue(throwError(() => ({ error: { detail: 'rs' } })));
    resetBusy(s);
    s.secondaryEmailResendUntilById.set({});
    s.resendSecondaryEmailVerification('se1');
    expect(s.secondaryEmailMessage).toBe('rs');
    auth.requestSecondaryEmailVerification.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.secondaryEmailResendUntilById.set({});
    s.resendSecondaryEmailVerification('se1');
    expect(s.secondaryEmailMessage).toBe('account.security.emails.resendError');
  });

  it('confirmSecondaryEmailVerification guard, no id, no token, success, error', () => {
    const s = build() as any;
    s.verifyingSecondaryEmail = true;
    s.confirmSecondaryEmailVerification();
    s.verifyingSecondaryEmail = false;
    s.secondaryVerificationEmailId = null;
    s.confirmSecondaryEmailVerification();
    expect(auth.confirmSecondaryEmailVerification).not.toHaveBeenCalled();
    s.secondaryVerificationEmailId = 'se1';
    s.secondaryVerificationToken = '';
    s.confirmSecondaryEmailVerification();
    expect(s.secondaryVerificationStatus).toBe('account.security.emails.enterVerificationCode');
    // success (with and without verified_at)
    s.secondaryEmails.set([{ id: 'se1', verified: false }, { id: 'se2' }] as any);
    s.secondaryVerificationEmailId = 'se1';
    s.secondaryVerificationToken = 'tok';
    auth.confirmSecondaryEmailVerification.and.returnValue(of({ id: 'se1', verified_at: '2020-01-01' } as any));
    s.confirmSecondaryEmailVerification();
    expect(s.secondaryEmailMessage).toBe('account.security.emails.verified');
    // verified_at null branch
    s.secondaryEmails.set([{ id: 'se1', verified: false }] as any);
    s.secondaryVerificationEmailId = 'se1';
    s.secondaryVerificationToken = 'tok';
    auth.confirmSecondaryEmailVerification.and.returnValue(of({ id: 'se1', verified_at: null } as any));
    s.confirmSecondaryEmailVerification();
    // error
    auth.confirmSecondaryEmailVerification.and.returnValue(throwError(() => ({ error: { detail: 've' } })));
    resetBusy(s);
    s.secondaryVerificationEmailId = 'se1';
    s.secondaryVerificationToken = 'tok';
    s.confirmSecondaryEmailVerification();
    expect(s.secondaryVerificationStatus).toBe('ve');
    auth.confirmSecondaryEmailVerification.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.secondaryVerificationEmailId = 'se1';
    s.secondaryVerificationToken = 'tok';
    s.confirmSecondaryEmailVerification();
    expect(s.secondaryVerificationStatus).toBe('account.security.emails.verifyError');
  });

  it('startDeleteSecondaryEmail / cancelDeleteSecondaryEmail / confirmDeleteSecondaryEmail', () => {
    const s = build() as any;
    s.removingSecondaryEmail = true;
    s.startDeleteSecondaryEmail('se1');
    expect(s.removeSecondaryEmailId).toBeNull();
    s.removingSecondaryEmail = false;
    s.startDeleteSecondaryEmail('se1');
    expect(s.removeSecondaryEmailId).toBe('se1');
    // cancel guard
    s.removingSecondaryEmail = true;
    s.cancelDeleteSecondaryEmail();
    expect(s.removeSecondaryEmailId).toBe('se1');
    s.removingSecondaryEmail = false;
    s.cancelDeleteSecondaryEmail();
    expect(s.removeSecondaryEmailId).toBeNull();
    // confirm guard busy
    s.removingSecondaryEmail = true;
    s.confirmDeleteSecondaryEmail();
    s.removingSecondaryEmail = false;
    // no id
    s.removeSecondaryEmailId = null;
    s.confirmDeleteSecondaryEmail();
    expect(auth.deleteSecondaryEmail).not.toHaveBeenCalled();
    // confirm declined
    s.removeSecondaryEmailId = 'se1';
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    s.confirmDeleteSecondaryEmail();
    expect(auth.deleteSecondaryEmail).not.toHaveBeenCalled();
    confirmSpy.and.returnValue(true);
    // no password
    s.removeSecondaryEmailPassword = '';
    s.confirmDeleteSecondaryEmail();
    expect(toast.error).toHaveBeenCalledWith('auth.currentPasswordRequired');
    // success (also clears active verification for same id)
    s.secondaryEmails.set([{ id: 'se1' }, { id: 'se2' }] as any);
    s.secondaryVerificationEmailId = 'se1';
    s.removeSecondaryEmailId = 'se1';
    s.removeSecondaryEmailPassword = 'pw';
    s.confirmDeleteSecondaryEmail();
    expect(s.secondaryEmails().some((e: any) => e.id === 'se1')).toBeFalse();
    expect(s.secondaryVerificationEmailId).toBeNull();
    // error variants
    auth.deleteSecondaryEmail.and.returnValue(throwError(() => ({ error: { detail: 'rmse' } })));
    resetBusy(s);
    s.removeSecondaryEmailId = 'se2';
    s.removeSecondaryEmailPassword = 'pw';
    s.confirmDeleteSecondaryEmail();
    expect(s.secondaryEmailMessage).toBe('rmse');
    auth.deleteSecondaryEmail.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.removeSecondaryEmailId = 'se2';
    s.removeSecondaryEmailPassword = 'pw';
    s.confirmDeleteSecondaryEmail();
    expect(s.secondaryEmailMessage).toBe('account.security.emails.removeError');
  });

  it('confirmDeleteSecondaryEmail success when verification id differs', () => {
    const s = build() as any;
    spyOn(window, 'confirm').and.returnValue(true);
    s.secondaryEmails.set([{ id: 'se1' }] as any);
    s.secondaryVerificationEmailId = 'other';
    s.removeSecondaryEmailId = 'se1';
    s.removeSecondaryEmailPassword = 'pw';
    s.confirmDeleteSecondaryEmail();
    expect(s.secondaryVerificationEmailId).toBe('other');
  });

  it('startMakePrimary / cancelMakePrimary / confirmMakePrimary', () => {
    const s = build() as any;
    s.startMakePrimary('se1');
    expect(s.makePrimarySecondaryEmailId).toBe('se1');
    s.cancelMakePrimary();
    expect(s.makePrimarySecondaryEmailId).toBeNull();
    // confirm guard busy
    s.makingPrimaryEmail = true;
    s.confirmMakePrimary();
    s.makingPrimaryEmail = false;
    // no id
    s.makePrimarySecondaryEmailId = null;
    s.confirmMakePrimary();
    expect(auth.makeSecondaryEmailPrimary).not.toHaveBeenCalled();
    // no password
    s.makePrimarySecondaryEmailId = 'se1';
    s.makePrimaryPassword = '';
    s.confirmMakePrimary();
    expect(s.makePrimaryError).toBe('account.security.emails.makePrimaryPasswordRequired');
    // success
    s.makePrimarySecondaryEmailId = 'se1';
    s.makePrimaryPassword = 'pw';
    s.confirmMakePrimary();
    expect(toast.success).toHaveBeenCalledWith('account.security.emails.primaryUpdated');
    // error variants
    auth.makeSecondaryEmailPrimary.and.returnValue(throwError(() => ({ error: { detail: 'mpe' } })));
    resetBusy(s);
    s.makePrimarySecondaryEmailId = 'se1';
    s.makePrimaryPassword = 'pw';
    s.confirmMakePrimary();
    expect(s.makePrimaryError).toBe('mpe');
    auth.makeSecondaryEmailPrimary.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.makePrimarySecondaryEmailId = 'se1';
    s.makePrimaryPassword = 'pw';
    s.confirmMakePrimary();
    expect(s.makePrimaryError).toBe('account.security.emails.primaryUpdateError');
  });

  // ---- google link -------------------------------------------------------------

  it('linkGoogle with pending context: no password, success, error', () => {
    const s = build() as any;
    pendingLink = { code: 'c', state: 'st' };
    s.googlePassword = '';
    s.linkGoogle();
    expect(s.googleError).toBe('account.security.google.passwordRequiredLink');
    s.googlePassword = 'pw';
    s.linkGoogle();
    expect(s.profile()).toEqual(PROFILE_FULL);
    expect(toast.success).toHaveBeenCalled();
    auth.completeGoogleLink.and.returnValue(throwError(() => ({ error: { detail: 'gle' } })));
    resetBusy(s);
    s.googlePassword = 'pw';
    s.linkGoogle();
    expect(s.googleError).toBe('gle');
    auth.completeGoogleLink.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.googlePassword = 'pw';
    s.linkGoogle();
    expect(s.googleError).toBe('auth.googleError');
  });

  it('linkGoogle without pending context: start success and error', () => {
    const s = build() as any;
    pendingLink = null;
    // Non-emitting so the (istanbul-ignored) `window.location.href = url` redirect
    // never fires — that would navigate the Karma test iframe and drop the run.
    auth.startGoogleLink.and.returnValue(of() as any);
    s.linkGoogle();
    expect(auth.startGoogleLink).toHaveBeenCalled();
    // success path persists the flow marker; only the error path clears it
    expect(localStorage.getItem('google_flow')).toBe('link');
    auth.startGoogleLink.and.returnValue(throwError(() => ({ error: { detail: 'sle' } })));
    resetBusy(s);
    s.linkGoogle();
    expect(s.googleError).toBe('sle');
    auth.startGoogleLink.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.linkGoogle();
    expect(s.googleError).toBe('account.security.google.startLinkError');
  });

  it('unlinkGoogle no password, success, error', () => {
    const s = build() as any;
    s.googlePassword = '';
    s.unlinkGoogle();
    expect(s.googleError).toBe('account.security.google.passwordRequiredUnlink');
    s.googlePassword = 'pw';
    s.unlinkGoogle();
    expect(toast.success).toHaveBeenCalledWith('account.security.google.unlinked');
    auth.unlinkGoogle.and.returnValue(throwError(() => ({ error: { detail: 'ue' } })));
    resetBusy(s);
    s.googlePassword = 'pw';
    s.unlinkGoogle();
    expect(s.googleError).toBe('ue');
    auth.unlinkGoogle.and.returnValue(throwError(() => ({})));
    resetBusy(s);
    s.googlePassword = 'pw';
    s.unlinkGoogle();
    expect(s.googleError).toBe('account.security.google.unlinkError');
  });

  // ---- unsaved changes / discard -----------------------------------------------

  it('discardProfileChanges / discardNotificationChanges / discardAddressChanges', () => {
    const s = build() as any;
    // no baseline → no-op
    s.profileBaseline = null;
    s.discardProfileChanges();
    s.notificationsBaseline = null;
    s.discardNotificationChanges();
    // with baseline
    s.profileBaseline = {
      name: 'N',
      username: 'U',
      firstName: 'F',
      middleName: 'M',
      lastName: 'L',
      dateOfBirth: '1990-01-01',
      phoneCountry: 'RO',
      phoneNational: '700',
      preferredLanguage: 'en',
      themePreference: 'system',
    };
    s.discardProfileChanges();
    expect(s.profileName).toBe('N');
    s.notificationsBaseline = {
      notifyBlogComments: true,
      notifyBlogCommentReplies: false,
      notifyMarketing: true,
    };
    s.discardNotificationChanges();
    expect(s.notifyBlogComments).toBeTrue();
    // address discard
    s.showAddressForm = false;
    s.discardAddressChanges();
    s.showAddressForm = true;
    s.discardAddressChanges();
    expect(s.showAddressForm).toBeFalse();
  });

  it('profileHasUnsavedChanges / notificationsHasUnsavedChanges / addressesHasUnsavedChanges', () => {
    const s = build() as any;
    // no baselines
    s.profileBaseline = null;
    expect(s.profileHasUnsavedChanges()).toBeFalse();
    s.notificationsBaseline = null;
    expect(s.notificationsHasUnsavedChanges()).toBeFalse();
    s.showAddressForm = false;
    expect(s.addressesHasUnsavedChanges()).toBeFalse();
    // profile: username password present → dirty
    s.profileBaseline = s.captureProfileSnapshot();
    s.profileUsernamePassword = 'pw';
    expect(s.profileHasUnsavedChanges()).toBeTrue();
    s.profileUsernamePassword = '';
    expect(s.profileHasUnsavedChanges()).toBeFalse();
    s.profileName = 'Changed';
    expect(s.profileHasUnsavedChanges()).toBeTrue();
    // notifications
    s.notificationsBaseline = s.captureNotificationSnapshot();
    expect(s.notificationsHasUnsavedChanges()).toBeFalse();
    s.notifyMarketing = !s.notifyMarketing;
    expect(s.notificationsHasUnsavedChanges()).toBeTrue();
    // addresses: form open, no baseline → dirty
    s.showAddressForm = true;
    s.addressFormBaseline = null;
    expect(s.addressesHasUnsavedChanges()).toBeTrue();
    s.addressFormBaseline = { ...s.addressModel };
    expect(s.addressesHasUnsavedChanges()).toBeFalse();
    s.addressModel = { ...s.addressModel, line1: 'different' };
    expect(s.addressesHasUnsavedChanges()).toBeTrue();
  });

  it('hasUnsavedChanges aggregates and beforeunload handler', () => {
    const s = build() as any;
    s.profileBaseline = null;
    s.notificationsBaseline = null;
    s.showAddressForm = false;
    expect(s.hasUnsavedChanges()).toBeFalse();
    // beforeunload: no unsaved → does nothing
    const evt1: any = { preventDefault: jasmine.createSpy('pd'), returnValue: undefined };
    s.handleBeforeUnload(evt1);
    expect(evt1.preventDefault).not.toHaveBeenCalled();
    // with unsaved → prevents
    s.notificationsBaseline = s.captureNotificationSnapshot();
    s.notifyMarketing = !s.notifyMarketing;
    const evt2: any = { preventDefault: jasmine.createSpy('pd'), returnValue: undefined };
    s.handleBeforeUnload(evt2);
    expect(evt2.preventDefault).toHaveBeenCalled();
  });

  it('sameAddressSnapshot normalizes phone variants', () => {
    const s = build() as any;
    const a = { label: 'home', line1: '1', city: 'c', postal_code: 'p', country: 'RO', phone: ' 123 ' };
    const b = { label: 'home', line1: '1', city: 'c', postal_code: 'p', country: 'RO', phone: '123' };
    expect(s.sameAddressSnapshot(a, b)).toBeTrue();
    const c = { ...b, phone: null };
    expect(s.sameAddressSnapshot(b, c)).toBeFalse();
    const d = { ...b, phone: 42 as any };
    expect(s.sameAddressSnapshot(d, c)).toBeTrue();
    // null/undefined model fields exercise the `?? ''` normalization fallbacks
    const empty = {};
    expect(s.sameAddressSnapshot(empty, empty)).toBeTrue();
  });

  // ---- defensive fallback branches (null/undefined/empty inputs) ----------------

  it('url helpers and storage fallbacks with empty inputs', () => {
    const s = build() as any;
    expect(s.isAccountRootUrl('')).toBeFalse();
    localStorage.removeItem('account.lastSection');
    expect(s.lastVisitedSection()).toBe('overview');
  });

  it('loadCouponsCount tolerates a null coupon list', () => {
    const s = build() as any;
    coupons.myCoupons.and.returnValue(of(null as any));
    s.loadCouponsCount();
    expect(s.couponsCount()).toBe(0);
    // direct call exercises the defensive `coupons ?? []` guard inside the counter
    expect(s.countAvailableCoupons(null)).toBe(0);
  });

  it('loadOrders defaults total_pages and clears latest when no items', () => {
    const s = build() as any;
    account.getOrdersPage.and.returnValue(
      of({ items: [], meta: { total_pages: 0, pending_count: 0 } } as any),
    );
    s.loadOrders(true);
    expect(s.totalPages).toBe(1);
    expect(s.latestOrder()).toBeNull();
  });

  it('loadTickets sorts entries missing updated_at', () => {
    const s = build() as any;
    tickets.listMine.and.returnValue(of([{ id: 't1' }, { id: 't2' }] as any));
    s.loadTickets();
    expect(s.tickets().length).toBe(2);
  });

  it('order display helpers handle missing fields', () => {
    const s = build();
    expect(s.trackingUrl('')).toBe('');
    expect(s.trackingStatusLabel(makeOrder({ tracking_number: 'T', status: '' as any }))).toBeNull();
    expect(s.paymentMethodLabel(makeOrder({ payment_method: undefined }))).toBe('—');
    expect(s.deliveryLabel(makeOrder({ courier: undefined, delivery_type: undefined }))).toBe('—');
    expect(s.lockerLabel(makeOrder({ delivery_type: undefined }))).toBeNull();
    expect(
      s.lockerLabel(makeOrder({ delivery_type: 'locker', locker_name: undefined, locker_address: undefined })),
    ).toBeNull();
  });

  it('manualRefundRequired handles missing status/method/events entries', () => {
    const s = build();
    expect(s.manualRefundRequired(makeOrder({ status: '' as any }))).toBeFalse();
    expect(
      s.manualRefundRequired(makeOrder({ status: 'cancelled', payment_method: '' as any })),
    ).toBeFalse();
    expect(
      s.manualRefundRequired(
        makeOrder({
          status: 'cancelled',
          payment_method: 'stripe',
          events: [null, { event: 'payment_captured' }] as any,
        }),
      ),
    ).toBeTrue();
  });

  it('return/cancel eligibility with missing status and event entries', () => {
    const s = build() as any;
    expect(s.canRequestReturn(makeOrder({ status: '' as any }))).toBeFalse();
    expect(s.canRequestCancel(makeOrder({ status: '' as any }))).toBeFalse();
    // hasCancelRequested via the in-memory set
    s.cancelRequestedOrderIds.add('o1');
    expect(s.hasCancelRequested(makeOrder({ id: 'o1' }))).toBeTrue();
    // events not an array, and array with a null entry
    expect(s.hasCancelRequested(makeOrder({ id: 'x', events: null as any }))).toBeFalse();
    expect(s.hasCancelRequested(makeOrder({ id: 'y', events: [null] as any }))).toBeFalse();
  });

  it('submitCancelRequest updates the cached latest order and uses id when ref missing', () => {
    const order = makeOrder({ id: 'o1', status: 'paid', reference_code: '' });
    spyOn(window, 'confirm').and.returnValue(true);
    const s = build() as any;
    s.latestOrder.set(makeOrder({ id: 'o1', status: 'paid' }));
    // list holds a matching + non-matching order so updateOrderInList maps both arms
    s.orders.set([makeOrder({ id: 'o1', status: 'paid' }), makeOrder({ id: 'o2', status: 'paid' })]);
    account.requestOrderCancellation.and.returnValue(of(makeOrder({ id: 'o1', status: 'cancelled' })) as any);
    s.openCancelRequest(order);
    s.cancelReason = 'reason';
    s.submitCancelRequest(order);
    expect(s.latestOrder()?.status).toBe('cancelled');
    expect(s.orders().find((o: any) => o.id === 'o1').status).toBe('cancelled');
  });

  it('cancel/return create errors with no detail fall back to generic keys', () => {
    const s = build() as any;
    spyOn(window, 'confirm').and.returnValue(true);
    const co = makeOrder({ id: 'c1', status: 'paid' });
    account.requestOrderCancellation.and.returnValue(throwError(() => ({})));
    s.openCancelRequest(co);
    s.cancelReason = 'r';
    s.submitCancelRequest(co);
    expect(s.cancelRequestError).toBe('account.orders.cancel.errors.create');
    const ro = makeOrder({ id: 'r1', status: 'delivered' });
    account.createReturnRequest.and.returnValue(throwError(() => ({})));
    s.returnOrderId = ro.id;
    s.returnReason = 'r';
    s.returnQty = { i1: 1 };
    s.submitReturnRequest(ro);
    expect(s.returnCreateError).toBe('account.orders.return.errors.create');
  });

  it('openReturnRequest/submitReturnRequest with missing status and items', () => {
    const s = build() as any;
    s.openReturnRequest(makeOrder({ status: '' as any }));
    expect(toast.error).toHaveBeenCalledWith('account.orders.return.errors.notEligible');
    // open with missing items list
    s.returnOrderId = null;
    s.openReturnRequest(makeOrder({ id: 'o1', status: 'delivered', items: undefined }));
    expect(s.returnOrderId).toBe('o1');
    // submit with missing status
    s.returnOrderId = 'z';
    s.submitReturnRequest(makeOrder({ id: 'z', status: '' as any }));
    expect(s.returnCreateError).toBe('account.orders.return.errors.notEligible');
    // submit with missing items list → empty loop → itemsRequired
    s.returnOrderId = 'w';
    s.returnReason = 'reason';
    s.returnQty = {};
    s.submitReturnRequest(makeOrder({ id: 'w', status: 'delivered', items: undefined }));
    expect(s.returnCreateError).toBe('account.orders.return.errors.itemsRequired');
    // items present but returnQty has no entry → `?? 0` fallback → itemsRequired
    s.returnOrderId = 'v';
    s.returnReason = 'reason';
    s.returnQty = {};
    s.submitReturnRequest(makeOrder({ id: 'v', status: 'delivered' }));
    expect(s.returnCreateError).toBe('account.orders.return.errors.itemsRequired');
  });

  it('downloadReceipt names file with id when reference_code missing', () => {
    const s = build();
    spyOn(document, 'createElement').and.returnValue({
      click: jasmine.createSpy('click'),
      remove: jasmine.createSpy('remove'),
      set href(v: string) {},
      set download(v: string) {},
      set rel(v: string) {},
    } as any);
    spyOn(document.body, 'appendChild').and.returnValue({} as any);
    spyOn(window.URL, 'createObjectURL').and.returnValue('blob:1');
    spyOn(window.URL, 'revokeObjectURL');
    s.downloadReceipt(makeOrder({ reference_code: '' }));
    expect(account.downloadReceipt).toHaveBeenCalled();
  });

  it('duplicateAddress with null and empty-field source', () => {
    const s = build();
    s.duplicateAddress(null as any);
    expect(s.addressModel.country).toBe('US');
    s.duplicateAddress(
      makeAddress({ line1: '', line2: '', city: '', region: '', postal_code: '', country: '', label: '' }),
    );
    expect(s.addressModel.country).toBe('US');
    expect(s.addressModel.label).toBe('home');
  });

  it('openAddressForm with empty-field existing address', () => {
    const s = build();
    s.openAddressForm(
      makeAddress({ id: 'a9', line1: '', line2: '', city: '', region: '', postal_code: '', country: '', label: '' }),
    );
    expect(s.addressModel.country).toBe('US');
  });

  it('avatar setters tolerate a user without avatar_url', () => {
    const s = build() as any;
    auth.uploadAvatar.and.returnValue(of({ ...PROFILE_MIN }));
    s.uploadAvatar(new File(['a'], 'a.png'));
    expect(s.avatar).toBeNull();
    auth.useGoogleAvatar.and.returnValue(of({ ...PROFILE_MIN }));
    s.useGoogleAvatar();
    expect(s.avatar).toBeNull();
    spyOn(window, 'confirm').and.returnValue(true);
    auth.removeAvatar.and.returnValue(of({ ...PROFILE_MIN }));
    s.removeAvatar();
    expect(s.avatar).toBeNull();
  });

  it('identity/label fallbacks with null profile and empty fields', () => {
    const s = build() as any;
    s.profile.set(null);
    expect(s.usernameChanged()).toBeFalse();
    expect(s.accountHeaderLabel()).toBe('...');
    s.profileUsername = '';
    expect(typeof s.publicIdentityPreviewLabel()).toBe('string');
    // lastOrderLabel uses id when reference_code missing
    s.ordersLoaded.set(true);
    s.latestOrder.set(makeOrder({ reference_code: '' }));
    expect(typeof s.lastOrderLabel()).toBe('string');
    // supportTickets label with a ticket missing status
    s.ticketsLoaded.set(true);
    s.ticketsError.set(null);
    s.tickets.set([{ id: 't1' }] as any);
    expect(s.supportTicketsLabel()).toBe('account.overview.support.openOne');
  });

  it('saveProfile success keeps middle name and tolerates a null current profile', () => {
    const s = build() as any;
    s.profile.set(null);
    s.forceProfileCompletion = false;
    s.profileName = 'Name';
    s.profileUsername = 'brandnew';
    s.profileUsernamePassword = 'pw';
    s.profileMiddleName = 'Middle';
    s.profileDateOfBirth = '';
    s.profilePhoneNational = '';
    auth.updateProfile.and.returnValue(of({ ...PROFILE_FULL, middle_name: 'Middle' }));
    s.saveProfile();
    expect(auth.updateUsername).toHaveBeenCalled();
    expect(s.profileMiddleName).toBe('Middle');
  });

  it('saveNotifications tolerates a user without updated_at', () => {
    const s = build() as any;
    auth.updateNotificationPreferences.and.returnValue(of({ ...PROFILE_MIN }));
    s.saveNotifications();
    expect(s.notificationLastUpdated).toBeNull();
  });

  it('registerPasskey completion error without detail uses default key', async () => {
    const s = build() as any;
    spyOn(s, 'passkeysSupported').and.returnValue(true);
    const cred: any = {
      id: 'c',
      rawId: new Uint8Array([1]).buffer,
      type: 'public-key',
      response: { clientDataJSON: new Uint8Array([3]).buffer },
      getClientExtensionResults: () => ({}),
    };
    spyOn(navigator.credentials, 'create').and.returnValue(Promise.resolve(cred));
    auth.completePasskeyRegistration.and.returnValue(throwError(() => ({})));
    s.passkeyRegisterPassword = 'pw';
    await s.registerPasskey();
    await Promise.resolve();
    expect(toast.error).toHaveBeenCalledWith('account.security.passkeys.addError');
  });

  it('google link/unlink tolerate users without google fields', () => {
    const s = build() as any;
    pendingLink = { code: 'c', state: 'st' };
    auth.completeGoogleLink.and.returnValue(of({ ...PROFILE_MIN }));
    s.googlePassword = 'pw';
    s.linkGoogle();
    expect(s.googleEmail()).toBeNull();
    expect(s.googlePicture()).toBeNull();
    auth.unlinkGoogle.and.returnValue(of({ ...PROFILE_MIN }));
    s.googlePassword = 'pw';
    s.unlinkGoogle();
    expect(s.googleEmail()).toBeNull();
  });

  it('lastOrderSubcopy formats money with a missing currency', () => {
    const s = build() as any;
    s.ordersLoaded.set(true);
    s.latestOrder.set(makeOrder({ currency: '' as any, created_at: '2020-01-01T00:00:00Z' }));
    expect(typeof s.lastOrderSubcopy()).toBe('string');
  });
});
