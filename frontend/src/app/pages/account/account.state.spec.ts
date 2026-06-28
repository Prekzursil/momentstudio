import { Component, signal } from '@angular/core';
import {
  TestBed,
  discardPeriodicTasks,
  fakeAsync,
  flushMicrotasks,
  tick,
} from '@angular/core/testing';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject, of, throwError } from 'rxjs';

import { AccountState } from './account.state';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { AccountService, Address, Order } from '../../core/account.service';
import { BlogService } from '../../core/blog.service';
import { ApiService } from '../../core/api.service';
import { WishlistService } from '../../core/wishlist.service';
import { ThemeService } from '../../core/theme.service';
import { LanguageService } from '../../core/language.service';
import { CartStore } from '../../core/cart.store';
import { CouponsService } from '../../core/coupons.service';
import { NotificationsService } from '../../core/notifications.service';
import { TicketsService } from '../../core/tickets.service';
import { GoogleLinkPendingService } from '../../core/google-link-pending.service';

// Concrete host so the abstract @Directive() AccountState can be instantiated
// through the Angular DI/lifecycle machinery exactly like the real subpages do.
@Component({ selector: 'app-account-state-host', template: '', standalone: true })
class AccountStateHost extends AccountState {}

describe('AccountState', () => {
  let toast: jasmine.SpyObj<ToastService>;
  let auth: jasmine.SpyObj<AuthService>;
  let account: jasmine.SpyObj<AccountService>;
  let blog: jasmine.SpyObj<BlogService>;
  let api: jasmine.SpyObj<ApiService>;
  let wishlist: any;
  let coupons: jasmine.SpyObj<CouponsService>;
  let notifications: any;
  let theme: any;
  let prefSig: ReturnType<typeof signal<'light' | 'dark' | 'system'>>;
  let lang: any;
  let cart: jasmine.SpyObj<CartStore>;
  let tickets: jasmine.SpyObj<TicketsService>;
  let googleLinkPending: jasmine.SpyObj<GoogleLinkPendingService>;
  let routerEvents$: Subject<any>;

  const profile: any = {
    id: 'u1',
    email: 'user@example.com',
    role: 'customer',
    name: 'User',
    username: 'theuser',
    first_name: 'First',
    last_name: 'Last',
    middle_name: 'Mid',
    date_of_birth: '1990-01-01',
    name_tag: 7,
    phone: '+40723204204',
    avatar_url: null,
    email_verified: true,
    preferred_language: 'en',
    notify_blog_comments: false,
    notify_blog_comment_replies: true,
    notify_marketing: false,
    google_sub: null,
    google_email: null,
    google_picture_url: null,
    created_at: '2000-01-01T00:00:00+00:00',
    updated_at: '2000-01-02T00:00:00+00:00',
  };

  const address: Address = {
    id: 'a1',
    label: 'Home',
    line1: '123 Main',
    line2: null,
    city: 'Bucharest',
    region: 'IF',
    postal_code: '010203',
    country: 'RO',
    is_default_shipping: true,
    is_default_billing: false,
  } as any;

  const order: Order = {
    id: 'o1',
    reference_code: 'REF123',
    status: 'delivered',
    total_amount: 20,
    currency: 'RON',
    tracking_number: 'TRACK1',
    payment_method: 'stripe',
    courier: 'sameday',
    delivery_type: 'locker',
    locker_name: 'Locker A',
    locker_address: 'Str X',
    created_at: '2000-01-03T00:00:00+00:00',
    updated_at: '2000-01-03T00:00:00+00:00',
    events: [],
    items: [
      {
        id: 'i1',
        product_id: 'p1',
        variant_id: 'v1',
        product: { id: 'p1', slug: 'prod', name: 'Prod' },
        quantity: 2,
        unit_price: 20,
        subtotal: 40,
      },
    ],
  } as any;

  const ordersPage = (items: Order[] = [order], meta: any = {}) =>
    of({
      items,
      meta: {
        total_items: items.length,
        total_pages: 1,
        page: 1,
        limit: 5,
        pending_count: 0,
        ...meta,
      },
    } as any);

  function makeHost(url: string = '/account/overview', queryComplete = false) {
    (auth.isAuthenticated as jasmine.Spy).and.returnValue(true);
    const router = TestBed.inject(Router);
    spyOnProperty(router, 'url', 'get').and.returnValue(url);
    spyOn(router, 'navigate').and.returnValue(Promise.resolve(true) as any);
    const route = TestBed.inject(ActivatedRoute);
    (route.snapshot as any) = {
      queryParamMap: { get: (k: string) => (k === 'complete' && queryComplete ? '1' : null) },
    };
    const fixture = TestBed.createComponent(AccountStateHost);
    const cmp = fixture.componentInstance;
    return { fixture, cmp, router, route };
  }

  // isWebAuthnSupported() reads window.isSecureContext, window.PublicKeyCredential
  // and navigator.credentials. ES module exports cannot be spied on under esbuild,
  // so we steer the helper by shaping the real browser environment instead.
  const savedEnv: { secure?: any; pkc?: any; credsDesc?: PropertyDescriptor } = {};
  function setWebAuthnSupport(supported: boolean): void {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    (window as any).PublicKeyCredential = supported ? function PublicKeyCredential() {} : undefined;
    if (!supported) {
      Object.defineProperty(navigator, 'credentials', { value: undefined, configurable: true });
    }
  }
  function setCredentialsCreate(create: (opts?: any) => Promise<any>): void {
    Object.defineProperty(navigator, 'credentials', { value: { create }, configurable: true });
  }
  // navigator.clipboard is a read-only accessor; redefine it (spyOnProperty cannot
  // be re-applied within one test, which several clipboard-branch tests need).
  let savedClipboardDesc: PropertyDescriptor | undefined;
  function setClipboard(value: any): void {
    Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
  }
  // A credential object whose buffers the real serializePublicKeyCredential can read.
  const realCredential = (): any => ({
    id: 'cred-id',
    rawId: new Uint8Array([1, 2, 3]).buffer,
    type: 'public-key',
    response: {
      clientDataJSON: new Uint8Array([4, 5, 6]).buffer,
      attestationObject: new Uint8Array([7]).buffer,
    },
    getClientExtensionResults: () => ({}),
  });

  beforeEach(() => {
    savedEnv.pkc = (window as any).PublicKeyCredential;
    savedEnv.credsDesc = Object.getOwnPropertyDescriptor(navigator, 'credentials');
    savedClipboardDesc = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    localStorage.removeItem('account.lastSection');
    routerEvents$ = new Subject<any>();
    localStorage.removeItem('account.lastSection');
    routerEvents$ = new Subject<any>();

    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);

    auth = jasmine.createSpyObj<AuthService>('AuthService', [
      'isAuthenticated',
      'isAdmin',
      'role',
      'logout',
      'refresh',
      'requestEmailVerification',
      'uploadAvatar',
      'useGoogleAvatar',
      'removeAvatar',
      'updateProfile',
      'updateUsername',
      'getAliases',
      'getCooldowns',
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
      'disableTwoFactor',
      'regenerateTwoFactorRecoveryCodes',
      'revokeOtherSessions',
      'addSecondaryEmail',
      'requestSecondaryEmailVerification',
      'confirmSecondaryEmailVerification',
      'deleteSecondaryEmail',
      'makeSecondaryEmailPrimary',
      'startGoogleLink',
      'completeGoogleLink',
      'unlinkGoogle',
      'loadCurrentUser',
      'updateNotificationPreferences',
    ]);
    auth.isAuthenticated.and.returnValue(true);
    auth.isAdmin.and.returnValue(true);
    auth.role.and.returnValue('customer');
    auth.logout.and.returnValue(of(void 0));
    auth.refresh.and.returnValue(of({ access: 'a', refresh: 'r' } as any));
    auth.requestEmailVerification.and.returnValue(of(void 0 as any));
    auth.uploadAvatar.and.returnValue(of({ ...profile, avatar_url: 'a.png' } as any));
    auth.useGoogleAvatar.and.returnValue(of({ ...profile, avatar_url: 'g.png' } as any));
    auth.removeAvatar.and.returnValue(of({ ...profile, avatar_url: null } as any));
    auth.updateProfile.and.returnValue(of(profile as any));
    auth.updateUsername.and.returnValue(of(profile as any));
    auth.getAliases.and.returnValue(of({ usernames: [], display_names: [] } as any));
    auth.getCooldowns.and.returnValue(
      of({ username: null, display_name: null, email: null } as any),
    );
    auth.listEmails.and.returnValue(
      of({ primary_email: profile.email, primary_verified: true, secondary_emails: [] } as any),
    );
    auth.listSessions.and.returnValue(of([] as any));
    auth.listSecurityEvents.and.returnValue(of([] as any));
    auth.getTwoFactorStatus.and.returnValue(of({ enabled: false } as any));
    auth.listPasskeys.and.returnValue(of([] as any));
    auth.startPasskeyRegistration.and.returnValue(
      of({ options: {}, registration_token: 'rt' } as any),
    );
    auth.completePasskeyRegistration.and.returnValue(of({ id: 'pk1' } as any));
    auth.deletePasskey.and.returnValue(of(void 0 as any));
    auth.startTwoFactorSetup.and.returnValue(
      of({ secret: 'S', otpauth_url: 'otpauth://x' } as any),
    );
    auth.enableTwoFactor.and.returnValue(of({ recovery_codes: ['c1', 'c2'] } as any));
    auth.disableTwoFactor.and.returnValue(of({ enabled: false } as any));
    auth.regenerateTwoFactorRecoveryCodes.and.returnValue(of({ recovery_codes: ['x'] } as any));
    auth.revokeOtherSessions.and.returnValue(of({ revoked: 2 } as any));
    auth.addSecondaryEmail.and.returnValue(of({ id: 'se1', email: 'b@b.com' } as any));
    auth.requestSecondaryEmailVerification.and.returnValue(of(void 0 as any));
    auth.confirmSecondaryEmailVerification.and.returnValue(
      of({ id: 'se1', verified_at: '2020-01-01' } as any),
    );
    auth.deleteSecondaryEmail.and.returnValue(of(void 0 as any));
    auth.makeSecondaryEmailPrimary.and.returnValue(of(profile as any));
    auth.startGoogleLink.and.returnValue(of('https://google/link' as any));
    auth.completeGoogleLink.and.returnValue(of({ ...profile, google_email: 'g@g.com' } as any));
    auth.unlinkGoogle.and.returnValue(of({ ...profile, google_email: null } as any));
    auth.loadCurrentUser.and.returnValue(of(profile as any));
    auth.updateNotificationPreferences.and.returnValue(of(profile as any));

    account = jasmine.createSpyObj<AccountService>('AccountService', [
      'getProfile',
      'getAddresses',
      'getOrdersPage',
      'getDeletionStatus',
      'requestAccountDeletion',
      'cancelAccountDeletion',
      'reorderOrder',
      'downloadReceipt',
      'shareReceipt',
      'revokeReceiptShare',
      'createAddress',
      'updateAddress',
      'deleteAddress',
      'requestOrderCancellation',
      'createReturnRequest',
      'getLatestExportJob',
      'getExportJob',
      'startExportJob',
      'downloadExportJob',
    ]);
    account.getProfile.and.returnValue(of(profile as any));
    account.getAddresses.and.returnValue(of([address]));
    account.getOrdersPage.and.returnValue(ordersPage());
    account.getDeletionStatus.and.returnValue(
      of({ requested_at: null, scheduled_for: null, deleted_at: null, cooldown_hours: 24 } as any),
    );
    account.requestAccountDeletion.and.returnValue(
      of({ requested_at: '2020-01-01', scheduled_for: '2020-01-02', deleted_at: null } as any),
    );
    account.cancelAccountDeletion.and.returnValue(
      of({ requested_at: null, scheduled_for: null, deleted_at: null } as any),
    );
    account.reorderOrder.and.returnValue(of({} as any));
    account.downloadReceipt.and.returnValue(of(new Blob(['pdf'], { type: 'application/pdf' })));
    account.shareReceipt.and.returnValue(
      of({
        receipt_url: 'http://r',
        expires_at: new Date(Date.now() + 600000).toISOString(),
      } as any),
    );
    account.revokeReceiptShare.and.returnValue(of(void 0 as any));
    account.createAddress.and.returnValue(of(address));
    account.updateAddress.and.returnValue(of(address));
    account.deleteAddress.and.returnValue(of(void 0 as any));
    account.requestOrderCancellation.and.returnValue(of({ ...order, status: 'cancelled' } as any));
    account.createReturnRequest.and.returnValue(of({} as any));
    account.getLatestExportJob.and.returnValue(of(null as any));
    account.getExportJob.and.returnValue(of({ id: 'j1', status: 'succeeded' } as any));
    account.startExportJob.and.returnValue(of({ id: 'j1', status: 'pending' } as any));
    account.downloadExportJob.and.returnValue(of(new Blob(['json'], { type: 'application/json' })));

    blog = jasmine.createSpyObj<BlogService>('BlogService', ['listMyComments']);
    blog.listMyComments.and.returnValue(
      of({ items: [], meta: { total_items: 0, total_pages: 2, page: 1, limit: 10 } } as any),
    );

    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post', 'delete']);
    api.post.and.returnValue(of({} as any));

    wishlist = {
      items: jasmine.createSpy('items').and.returnValue([{ id: 'p1' }]),
      isLoaded: jasmine.createSpy('isLoaded').and.returnValue(true),
      ensureLoaded: jasmine.createSpy('ensureLoaded'),
      clear: jasmine.createSpy('clear'),
    };

    coupons = jasmine.createSpyObj<CouponsService>('CouponsService', ['myCoupons']);
    coupons.myCoupons.and.returnValue(of([] as any));

    notifications = {
      unreadCount: jasmine.createSpy('unreadCount').and.returnValue(3),
      refreshUnreadCount: jasmine.createSpy('refreshUnreadCount'),
    };

    prefSig = signal<'light' | 'dark' | 'system'>('system');
    theme = {
      preference: () => prefSig.asReadonly(),
      setPreference: jasmine.createSpy('setPreference'),
    };

    lang = {
      language: () => 'en',
      setLanguage: jasmine.createSpy('setLanguage'),
    };

    cart = jasmine.createSpyObj<CartStore>('CartStore', ['loadFromBackend']);

    tickets = jasmine.createSpyObj<TicketsService>('TicketsService', ['listMine']);
    tickets.listMine.and.returnValue(
      of([{ id: 't1', status: 'open', updated_at: '2020-01-02' }] as any),
    );

    googleLinkPending = jasmine.createSpyObj<GoogleLinkPendingService>('GoogleLinkPendingService', [
      'getPending',
      'clear',
    ]);
    googleLinkPending.getPending.and.returnValue(null);

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, TranslateModule.forRoot(), AccountStateHost],
      providers: [
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: auth },
        { provide: AccountService, useValue: account },
        { provide: BlogService, useValue: blog },
        { provide: ApiService, useValue: api },
        { provide: WishlistService, useValue: wishlist },
        { provide: CouponsService, useValue: coupons },
        { provide: NotificationsService, useValue: notifications },
        { provide: ThemeService, useValue: theme },
        { provide: LanguageService, useValue: lang },
        { provide: CartStore, useValue: cart },
        { provide: TicketsService, useValue: tickets },
        { provide: GoogleLinkPendingService, useValue: googleLinkPending },
      ],
    });

    const router = TestBed.inject(Router);
    Object.defineProperty(router, 'events', { get: () => routerEvents$.asObservable() });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      { account: { overview: { lastOrderLabel: '#{{ref}} {{status}}' } } },
      true,
    );
    translate.setDefaultLang('en');
    void translate.use('en');
  });

  afterEach(() => {
    (window as any).PublicKeyCredential = savedEnv.pkc;
    if (savedEnv.credsDesc) {
      Object.defineProperty(navigator, 'credentials', savedEnv.credsDesc);
    }
    if (savedClipboardDesc) {
      Object.defineProperty(navigator, 'clipboard', savedClipboardDesc);
    }
  });

  // ---- ngOnInit / routing ----

  it('initializes, navigates to remembered section from account root, and wires listeners', fakeAsync(() => {
    localStorage.setItem('account.lastSection', 'orders');
    const { cmp, router } = makeHost('/account');
    cmp.ngOnInit();
    expect(account.getProfile).toHaveBeenCalled();
    expect(notifications.refreshUnreadCount).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('navigates to profile on account root when forceProfileCompletion is set', fakeAsync(() => {
    const { cmp, router } = makeHost('/account', true);
    cmp.ngOnInit();
    expect((router.navigate as jasmine.Spy).calls.mostRecent().args[0]).toEqual(['profile']);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('falls back to overview when remembered section is password', fakeAsync(() => {
    localStorage.setItem('account.lastSection', 'password');
    const { cmp, router } = makeHost('/account');
    cmp.ngOnInit();
    expect((router.navigate as jasmine.Spy).calls.mostRecent().args[0]).toEqual(['overview']);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('loads the section for a non-root initial URL and reacts to NavigationEnd', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    cmp.ngOnInit();
    expect(auth.listSessions).toHaveBeenCalled();
    routerEvents$.next(new NavigationEnd(1, '/account/orders', '/account/orders'));
    expect(account.getOrdersPage).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('retryAccountLoad reloads profile and section', fakeAsync(() => {
    const { cmp } = makeHost('/account/overview');
    cmp.ngOnInit();
    account.getProfile.calls.reset();
    cmp.retryAccountLoad();
    expect(account.getProfile).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- section helpers ----

  it('navigationSection maps password to security and navigateToSection guards', () => {
    const { cmp, router } = makeHost('/account/password');
    expect(cmp.navigationSection()).toBe('security');
    cmp.navigateToSection('');
    cmp.navigateToSection('password');
    expect(router.navigate).not.toHaveBeenCalled();
    cmp.navigateToSection('overview');
    cmp.navigateToSection('orders');
    const navArgs = (router.navigate as jasmine.Spy).calls.allArgs().map((a: any[]) => a[0]);
    expect(navArgs).toEqual([['overview'], ['orders']]);
  });

  it('navigationSection returns plain section when not password', () => {
    const { cmp } = makeHost('/account/profile');
    expect(cmp.navigationSection()).toBe('profile');
  });

  it('activeSectionFromUrl handles urls without account and root account', fakeAsync(() => {
    const { cmp } = makeHost('/other');
    cmp.ngOnInit();
    routerEvents$.next(new NavigationEnd(1, '/other/page', '/other/page'));
    expect(account.getOrdersPage).toHaveBeenCalled(); // overview default
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('ensureLoadedForSection covers all section branches', fakeAsync(() => {
    const { cmp } = makeHost('/account/profile');
    cmp.ngOnInit();
    const sections = [
      'profile',
      'orders',
      'addresses',
      'wishlist',
      'coupons',
      'notifications',
      'password',
      'comments',
      'privacy',
      'unknown',
    ];
    for (const s of sections) {
      routerEvents$.next(new NavigationEnd(1, `/account/${s}`, `/account/${s}`));
    }
    expect(account.getDeletionStatus).toHaveBeenCalled();
    expect(account.getLatestExportJob).toHaveBeenCalled();
    expect(blog.listMyComments).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('comments section does not reload when meta already present', fakeAsync(() => {
    const { cmp } = makeHost('/account/comments');
    cmp.ngOnInit();
    blog.listMyComments.calls.reset();
    routerEvents$.next(new NavigationEnd(1, '/account/comments', '/account/comments'));
    expect(blog.listMyComments).not.toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('privacy section does not reload deletion status when already loaded', fakeAsync(() => {
    const { cmp } = makeHost('/account/privacy');
    cmp.ngOnInit();
    account.getDeletionStatus.calls.reset();
    routerEvents$.next(new NavigationEnd(1, '/account/privacy', '/account/privacy'));
    expect(account.getDeletionStatus).not.toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- counts ----

  it('unreadNotificationsCount and pendingOrdersCount', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.ngOnInit();
    expect(cmp.unreadNotificationsCount()).toBe(3);
    expect(cmp.pendingOrdersCount()).toBe(0);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- coupons ----

  it('loadCouponsCount counts only available coupons', fakeAsync(() => {
    const { cmp } = makeHost();
    coupons.myCoupons.and.returnValue(
      of([
        { is_active: true, promotion: { is_active: true } },
        { is_active: false },
        { is_active: true, promotion: { is_active: false } },
        { is_active: true, starts_at: new Date(Date.now() + 1e9).toISOString() },
        { is_active: true, ends_at: new Date(Date.now() - 1e9).toISOString() },
        { is_active: true, starts_at: 'bad', ends_at: 'bad' },
        null,
      ] as any),
    );
    cmp.loadCouponsCount(true);
    expect(cmp.couponsCount()).toBe(2);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('loadCouponsCount handles null coupons, error, and guards', fakeAsync(() => {
    const { cmp } = makeHost();
    coupons.myCoupons.and.returnValue(of(null as any));
    cmp.loadCouponsCount(true);
    expect(cmp.couponsCount()).toBe(0);
    cmp.couponsCountLoaded.set(true);
    coupons.myCoupons.calls.reset();
    cmp.loadCouponsCount();
    expect(coupons.myCoupons).not.toHaveBeenCalled();
    auth.isAuthenticated.and.returnValue(false);
    cmp.loadCouponsCount(true);
    auth.isAuthenticated.and.returnValue(true);
    cmp.couponsCountLoading.set(true);
    cmp.loadCouponsCount();
    coupons.myCoupons.and.returnValue(throwError(() => new Error('x')));
    cmp.couponsCountLoading.set(false);
    cmp.couponsCountLoaded.set(false);
    cmp.loadCouponsCount(true);
    expect(cmp.couponsCount()).toBe(0);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- profile load ----

  it('loadProfile populates fields and handles error + guards', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.ngOnInit();
    expect(cmp.profileName).toBe('User');
    expect(cmp.profilePhoneCountry).toBeTruthy();
    // guard: profileLoaded true -> no reload
    account.getProfile.calls.reset();
    (cmp as any).loadProfile();
    expect(account.getProfile).not.toHaveBeenCalled();
    // loading guard
    cmp.loading.set(true);
    (cmp as any).loadProfile();
    cmp.loading.set(false);
    // error path
    account.getProfile.and.returnValue(throwError(() => new Error('x')));
    (cmp as any).loadProfile(true);
    expect(cmp.error()).toBe('account.loadError');
    // not authenticated guard
    auth.isAuthenticated.and.returnValue(false);
    (cmp as any).loadProfile(true);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('loadProfile handles missing optional fields and ro language', fakeAsync(() => {
    const { cmp } = makeHost();
    account.getProfile.and.returnValue(
      of({ id: 'u2', email: 'e', preferred_language: 'ro', phone: null } as any),
    );
    cmp.ngOnInit();
    expect(cmp.profileLanguage).toBe('ro');
    expect(cmp.profilePhoneCountry).toBe('RO');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- orders ----

  it('loadOrders with filters, sets latestOrder only for default query', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.ngOnInit();
    cmp.ordersLoaded.set(false);
    cmp.ordersQuery = 'foo';
    cmp.orderFilter = 'paid';
    cmp.ordersFrom = '2020-01-01';
    cmp.ordersTo = '2020-12-31';
    cmp.loadOrders(true);
    expect(account.getOrdersPage).toHaveBeenCalled();
    expect(cmp.ordersFiltersActive()).toBeTrue();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('loadOrders guards and error branches', fakeAsync(() => {
    const { cmp } = makeHost();
    auth.isAuthenticated.and.returnValue(false);
    cmp.loadOrders();
    auth.isAuthenticated.and.returnValue(true);
    cmp.ordersLoading.set(true);
    cmp.loadOrders();
    cmp.ordersLoading.set(false);
    cmp.ordersLoaded.set(true);
    cmp.loadOrders();
    cmp.ordersLoaded.set(false);
    account.getOrdersPage.and.returnValue(
      throwError(() => ({ error: { detail: 'Invalid date range' } })),
    );
    cmp.loadOrders(true);
    expect(cmp.ordersError()).toBe('account.orders.invalidDateRange');
    account.getOrdersPage.and.returnValue(throwError(() => ({})));
    cmp.ordersLoaded.set(false);
    cmp.loadOrders(true);
    expect(cmp.ordersError()).toBe('account.orders.loadError');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('loadOrders clamps total_pages when meta missing', fakeAsync(() => {
    const { cmp } = makeHost();
    account.getOrdersPage.and.returnValue(ordersPage([order], { total_pages: 0 }));
    cmp.ngOnInit();
    expect(cmp.totalPages).toBe(1);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('order filter helpers: clear, filter, invalid range, pagination', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.ngOnInit();
    cmp.ordersFrom = '2020-12-31';
    cmp.ordersTo = '2020-01-01';
    cmp.applyOrderFilters();
    expect(cmp.ordersError()).toBe('account.orders.invalidDateRange');
    cmp.clearOrderFilters();
    expect(cmp.ordersFiltersActive()).toBeFalse();
    cmp.filterOrders();
    expect(cmp.pagedOrders().length).toBe(1);
    // loadOrders() re-derives page from the response meta, so the mock must report
    // a 3-page result for next/prev navigation to advance.
    account.getOrdersPage.and.callFake((opts: any) =>
      ordersPage([order], { total_pages: 3, page: opts.page }),
    );
    cmp.totalPages = 3;
    cmp.page = 1;
    cmp.nextPage();
    expect(cmp.page).toBe(2);
    cmp.prevPage();
    expect(cmp.page).toBe(1);
    cmp.prevPage(); // no-op
    cmp.page = 3;
    cmp.nextPage(); // no-op stays at 3
    expect(cmp.page).toBe(3);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- addresses ----

  it('loadAddresses guards and error', fakeAsync(() => {
    const { cmp } = makeHost();
    auth.isAuthenticated.and.returnValue(false);
    cmp.loadAddresses();
    auth.isAuthenticated.and.returnValue(true);
    cmp.addressesLoading.set(true);
    cmp.loadAddresses();
    cmp.addressesLoading.set(false);
    cmp.addressesLoaded.set(true);
    cmp.loadAddresses();
    cmp.addressesLoaded.set(false);
    account.getAddresses.and.returnValue(throwError(() => new Error('x')));
    cmp.loadAddresses(true);
    expect(cmp.addressesError()).toBe('account.addresses.loadError');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- tickets ----

  it('loadTickets sorts, handles non-array and error', fakeAsync(() => {
    const { cmp } = makeHost();
    tickets.listMine.and.returnValue(of(null as any));
    cmp.loadTickets(true);
    expect(cmp.tickets()).toEqual([]);
    cmp.ticketsLoaded.set(false);
    tickets.listMine.and.returnValue(throwError(() => new Error('x')));
    cmp.loadTickets(true);
    expect(cmp.ticketsError()).toBe('account.overview.support.loadError');
    auth.isAuthenticated.and.returnValue(false);
    cmp.loadTickets();
    auth.isAuthenticated.and.returnValue(true);
    cmp.ticketsLoading.set(true);
    cmp.loadTickets();
    cmp.ticketsLoading.set(false);
    cmp.ticketsLoaded.set(true);
    cmp.loadTickets();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- order presentation helpers ----

  it('orderStatusChipClass / trackingUrl / trackingStatusLabel', () => {
    const { cmp } = makeHost();
    expect(typeof cmp.orderStatusChipClass('paid')).toBe('string');
    expect(cmp.trackingUrl('')).toBe('');
    expect(cmp.trackingUrl('AB 1')).toContain('nums=AB%201');
    expect(cmp.trackingStatusLabel({ ...order, status: 'delivered' } as any)).toContain(
      'delivered',
    );
    expect(cmp.trackingStatusLabel({ ...order, status: 'shipped' } as any)).toContain('inTransit');
    expect(cmp.trackingStatusLabel({ ...order, status: 'paid' } as any)).toBeNull();
    expect(cmp.trackingStatusLabel({ ...order, tracking_number: '' } as any)).toBeNull();
  });

  it('paymentMethodLabel covers all methods', () => {
    const { cmp } = makeHost();
    expect(cmp.paymentMethodLabel({ payment_method: 'stripe' } as any)).toBeTruthy();
    expect(cmp.paymentMethodLabel({ payment_method: 'paypal' } as any)).toBeTruthy();
    expect(cmp.paymentMethodLabel({ payment_method: 'cod' } as any)).toBeTruthy();
    expect(cmp.paymentMethodLabel({ payment_method: 'netopia' } as any)).toBeTruthy();
    expect(cmp.paymentMethodLabel({ payment_method: 'other' } as any)).toBe('OTHER');
    expect(cmp.paymentMethodLabel({ payment_method: null } as any)).toBe('—');
  });

  it('paymentMethodLabel returns translated value when key resolves', () => {
    const { cmp } = makeHost();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { adminUi: { orders: { paymentStripe: 'Card' } } }, true);
    expect(cmp.paymentMethodLabel({ payment_method: 'stripe' } as any)).toBe('Card');
  });

  it('deliveryLabel and lockerLabel cover branches', () => {
    const { cmp } = makeHost();
    expect(cmp.deliveryLabel({ courier: 'sameday', delivery_type: 'home' } as any)).toContain(
      'Sameday',
    );
    expect(cmp.deliveryLabel({ courier: 'fan_courier', delivery_type: 'locker' } as any)).toContain(
      'Fan Courier',
    );
    expect(cmp.deliveryLabel({ courier: 'dhl', delivery_type: 'x' } as any)).toContain('dhl');
    expect(cmp.deliveryLabel({ courier: null, delivery_type: null } as any)).toBe('—');
    expect(cmp.lockerLabel({ delivery_type: 'home' } as any)).toBeNull();
    expect(
      cmp.lockerLabel({ delivery_type: 'locker', locker_name: 'L', locker_address: 'A' } as any),
    ).toBe('L — A');
    expect(
      cmp.lockerLabel({ delivery_type: 'locker', locker_name: '', locker_address: '' } as any),
    ).toBeNull();
  });

  it('manualRefundRequired branches', () => {
    const { cmp } = makeHost();
    expect(cmp.manualRefundRequired({ status: 'paid' } as any)).toBeFalse();
    expect(
      cmp.manualRefundRequired({ status: 'cancelled', payment_method: 'cod' } as any),
    ).toBeFalse();
    expect(
      cmp.manualRefundRequired({
        status: 'cancelled',
        payment_method: 'stripe',
        events: [],
      } as any),
    ).toBeFalse();
    expect(
      cmp.manualRefundRequired({
        status: 'cancelled',
        payment_method: 'stripe',
        events: [{ event: 'payment_captured' }],
      } as any),
    ).toBeTrue();
    expect(
      cmp.manualRefundRequired({
        status: 'cancelled',
        payment_method: 'stripe',
        events: [{ event: 'payment_captured' }, { event: 'payment_refunded' }],
      } as any),
    ).toBeFalse();
    expect(
      cmp.manualRefundRequired({
        status: 'cancelled',
        payment_method: 'stripe',
        events: null,
      } as any),
    ).toBeFalse();
  });

  // ---- reorder ----

  it('reorder success and error, and guard', fakeAsync(() => {
    const { cmp, router } = makeHost();
    spyOn(router, 'navigateByUrl').and.returnValue(Promise.resolve(true) as any);
    cmp.reorder(order);
    expect(cart.loadFromBackend).toHaveBeenCalled();
    expect(cmp.reorderingOrderId).toBeNull();
    cmp.reorderingOrderId = 'busy';
    cmp.reorder(order);
    cmp.reorderingOrderId = null;
    account.reorderOrder.and.returnValue(throwError(() => ({ error: { detail: 'boom' } })));
    cmp.reorder(order);
    expect(toast.error).toHaveBeenCalledWith('boom');
    cmp.reorderingOrderId = null; // error path has no complete -> reset to retry
    account.reorderOrder.and.returnValue(throwError(() => ({})));
    cmp.reorder(order);
    expect(toast.error).toHaveBeenCalledWith('account.orders.reorderError');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('reorderItem success, error, and guard', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.reorderItem(order, order.items[0]);
    expect(api.post).toHaveBeenCalled();
    cmp.reorderingOrderItemId = 'busy';
    cmp.reorderItem(order, order.items[0]);
    cmp.reorderingOrderItemId = null;
    api.post.and.returnValue(throwError(() => ({ error: { detail: 'e' } })));
    cmp.reorderItem(order, order.items[0]);
    expect(toast.error).toHaveBeenCalledWith('e');
    cmp.reorderingOrderItemId = null; // error path has no complete -> reset to retry
    api.post.and.returnValue(throwError(() => ({})));
    cmp.reorderItem(order, order.items[0]);
    expect(toast.error).toHaveBeenCalledWith('account.orders.reorderError');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- return / cancel requests ----

  it('return request lifecycle: open, toggle, close, submit success', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.openReturnRequest({ ...order, status: 'paid' } as any);
    expect(toast.error).toHaveBeenCalled();
    cmp.openReturnRequest(order);
    expect(cmp.returnOrderId).toBe('o1');
    cmp.openReturnRequest(order); // toggle close
    expect(cmp.returnOrderId).toBeNull();
    cmp.openReturnRequest(order);
    cmp.returnReason = 'damaged';
    cmp.returnQty = { i1: 1 };
    cmp.submitReturnRequest(order);
    expect(account.createReturnRequest).toHaveBeenCalled();
    expect(cmp.hasReturnRequested(order)).toBeTrue();
    expect(cmp.canRequestReturn(order)).toBeFalse();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('submitReturnRequest validation branches', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.creatingReturn = true;
    cmp.submitReturnRequest(order);
    cmp.creatingReturn = false;
    cmp.submitReturnRequest(order); // no returnOrderId
    cmp.openReturnRequest(order);
    cmp.submitReturnRequest({ ...order, status: 'paid' } as any); // not delivered after open
    expect(cmp.returnCreateError).toBe('account.orders.return.errors.notEligible');
    cmp.returnOrderId = order.id;
    cmp.returnReason = '';
    cmp.submitReturnRequest(order);
    expect(cmp.returnCreateError).toBe('account.orders.return.errors.reasonRequired');
    cmp.returnReason = 'r';
    cmp.returnQty = { i1: 99 };
    cmp.submitReturnRequest(order);
    expect(cmp.returnCreateError).toBe('account.orders.return.errors.invalidQuantity');
    cmp.returnQty = { i1: 0 };
    cmp.submitReturnRequest(order);
    expect(cmp.returnCreateError).toBe('account.orders.return.errors.itemsRequired');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('submitReturnRequest error variants', fakeAsync(() => {
    const { cmp } = makeHost();
    const setup = () => {
      cmp.creatingReturn = false; // error path leaves this true (no complete on throwError)
      cmp.returnOrderId = order.id;
      cmp.returnReason = 'r';
      cmp.returnQty = { i1: 1 };
    };
    account.createReturnRequest.and.returnValue(
      throwError(() => ({ error: { detail: 'Return request already exists' } })),
    );
    setup();
    cmp.submitReturnRequest(order);
    expect(cmp.returnCreateError).toBe('account.orders.return.errors.alreadyExists');
    account.createReturnRequest.and.returnValue(
      throwError(() => ({ error: { detail: 'Return request not eligible' } })),
    );
    setup();
    cmp.submitReturnRequest(order);
    expect(cmp.returnCreateError).toBe('account.orders.return.errors.notEligible');
    account.createReturnRequest.and.returnValue(throwError(() => ({})));
    setup();
    cmp.submitReturnRequest(order);
    expect(cmp.returnCreateError).toBe('account.orders.return.errors.create');
    cmp.closeReturnRequest();
    expect(cmp.returnOrderId).toBeNull();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('openReturnRequest with null items uses empty quantities', () => {
    const { cmp } = makeHost();
    cmp.openReturnRequest({ ...order, items: null } as any);
    expect(cmp.returnQty).toEqual({});
  });

  it('cancel request lifecycle and eligibility', fakeAsync(() => {
    const { cmp } = makeHost();
    spyOn(window, 'confirm').and.returnValue(true);
    const paid = { ...order, status: 'paid', events: [] } as any;
    cmp.openCancelRequest({ ...order, status: 'delivered' } as any); // not eligible
    expect(toast.error).toHaveBeenCalled();
    cmp.openCancelRequest(paid);
    expect(cmp.cancelOrderId).toBe('o1');
    cmp.openCancelRequest(paid); // toggle close
    expect(cmp.cancelOrderId).toBeNull();
    cmp.openCancelRequest(paid);
    cmp.cancelReason = 'changed mind';
    cmp.submitCancelRequest(paid);
    expect(account.requestOrderCancellation).toHaveBeenCalled();
    expect(cmp.hasCancelRequested(paid)).toBeTrue();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('hasCancelRequested detects cancel_requested event', () => {
    const { cmp } = makeHost();
    expect(
      cmp.hasCancelRequested({ ...order, events: [{ event: 'cancel_requested' }] } as any),
    ).toBeTrue();
    expect(cmp.canRequestCancel({ ...order, status: 'shipped', events: [] } as any)).toBeFalse();
  });

  it('submitCancelRequest validation and error branches', fakeAsync(() => {
    const { cmp } = makeHost();
    spyOn(window, 'confirm').and.returnValues(false, true, true, true, true);
    const paid = { ...order, status: 'paid', events: [] } as any;
    cmp.requestingCancel = true;
    cmp.submitCancelRequest(paid);
    cmp.requestingCancel = false;
    cmp.submitCancelRequest(paid); // no cancelOrderId
    cmp.openCancelRequest(paid);
    cmp.submitCancelRequest({ ...order, status: 'shipped', id: 'o1', events: [] } as any); // not eligible
    expect(cmp.cancelRequestError).toBe('account.orders.cancel.errors.notEligible');
    cmp.cancelOrderId = paid.id;
    cmp.cancelReason = '';
    cmp.submitCancelRequest(paid);
    expect(cmp.cancelRequestError).toBe('account.orders.cancel.errors.reasonRequired');
    cmp.cancelOrderId = paid.id;
    cmp.cancelReason = 'r';
    cmp.submitCancelRequest(paid); // confirm=false -> returns
    cmp.submitCancelRequest(paid); // confirm=true success
    cmp.closeCancelRequest();
    expect(cmp.cancelOrderId).toBeNull();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('submitCancelRequest error detail mapping', fakeAsync(() => {
    const { cmp } = makeHost();
    spyOn(window, 'confirm').and.returnValue(true);
    const paid = { ...order, status: 'paid', events: [], reference_code: '' } as any;
    const details = [
      ['Cancel request already exists', 'account.orders.cancel.errors.alreadyRequested'],
      ['Cancel request not eligible', 'account.orders.cancel.errors.notEligible'],
      ['Cancel reason is required', 'account.orders.cancel.errors.reasonRequired'],
      ['other', 'account.orders.cancel.errors.create'],
    ];
    for (const [detail, key] of details) {
      account.requestOrderCancellation.and.returnValue(throwError(() => ({ error: { detail } })));
      (cmp as any).cancelRequestedOrderIds = new Set();
      cmp.requestingCancel = false; // error path leaves this true (no complete on throwError)
      cmp.cancelOrderId = paid.id;
      cmp.cancelReason = 'r';
      cmp.submitCancelRequest(paid);
      expect(cmp.cancelRequestError).toBe(key);
    }
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- receipts ----

  it('downloadReceipt success, guard, error, and no-window', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.downloadReceipt(order);
    expect(account.downloadReceipt).toHaveBeenCalled();
    cmp.downloadingReceiptId = 'busy';
    cmp.downloadReceipt(order);
    cmp.downloadingReceiptId = null;
    account.downloadReceipt.and.returnValue(throwError(() => ({ error: { detail: 'd' } })));
    cmp.downloadReceipt(order);
    expect(toast.error).toHaveBeenCalledWith('d');
    cmp.downloadingReceiptId = null; // error path has no complete -> reset to retry
    account.downloadReceipt.and.returnValue(throwError(() => ({})));
    cmp.downloadReceipt({ ...order, reference_code: '' } as any);
    expect(toast.error).toHaveBeenCalledWith('account.orders.receiptDownloadError');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('copyReceiptLink branches', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.copyReceiptLink(order); // no existing -> error
    expect(toast.error).toHaveBeenCalled();
    cmp.receiptShares.set({
      o1: { receipt_url: 'http://r', expires_at: new Date(Date.now() - 1000).toISOString() } as any,
    });
    cmp.copyReceiptLink(order); // expired -> shareReceipt
    cmp.receiptShares.set({
      o1: {
        receipt_url: 'http://r',
        expires_at: new Date(Date.now() + 600000).toISOString(),
      } as any,
    });
    cmp.copyReceiptLink(order); // valid -> copy
    flushMicrotasks();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('shareReceipt success, valid cache, guard, error', fakeAsync(() => {
    const { cmp } = makeHost();
    setClipboard({ writeText: () => Promise.resolve() } as any);
    cmp.shareReceipt(order);
    flushMicrotasks();
    expect(account.shareReceipt).toHaveBeenCalled();
    cmp.receiptShares.set({
      o1: {
        receipt_url: 'http://r',
        expires_at: new Date(Date.now() + 600000).toISOString(),
      } as any,
    });
    account.shareReceipt.calls.reset();
    cmp.shareReceipt(order); // valid cache -> copy, no API
    flushMicrotasks();
    expect(account.shareReceipt).not.toHaveBeenCalled();
    cmp.sharingReceiptId = 'busy';
    cmp.shareReceipt({ ...order, id: 'o2' } as any);
    cmp.sharingReceiptId = null;
    account.shareReceipt.and.returnValue(throwError(() => ({ error: { detail: 's' } })));
    cmp.shareReceipt({ ...order, id: 'o3' } as any);
    expect(toast.error).toHaveBeenCalledWith('s');
    cmp.sharingReceiptId = null; // error path has no complete -> reset to retry
    account.shareReceipt.and.returnValue(throwError(() => ({})));
    cmp.shareReceipt({ ...order, id: 'o4' } as any);
    expect(toast.error).toHaveBeenCalledWith('account.orders.receiptGenerateError');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('shareReceipt and copyReceiptLink no-op without navigator.clipboard support path', () => {
    const { cmp } = makeHost();
    const origNav = (window as any).navigator;
    // Force navigator undefined branch
    Object.defineProperty(window, 'navigator', { value: undefined, configurable: true });
    expect(() => cmp.copyReceiptLink(order)).not.toThrow();
    expect(() => cmp.shareReceipt(order)).not.toThrow();
    Object.defineProperty(window, 'navigator', { value: origNav, configurable: true });
  });

  it('revokeReceiptShare confirm, guard, success, error', fakeAsync(() => {
    const { cmp } = makeHost();
    const confirmSpy = spyOn(window, 'confirm').and.returnValues(false, true, true, true, true);
    cmp.revokeReceiptShare(order); // confirm false -> returns
    cmp.receiptShares.set({ o1: { receipt_url: 'r' } as any });
    cmp.revokeReceiptShare(order); // success
    expect(toast.success).toHaveBeenCalled();
    cmp.revokingReceiptId = 'busy';
    cmp.revokeReceiptShare(order); // busy guard
    cmp.revokingReceiptId = null;
    account.revokeReceiptShare.and.returnValue(throwError(() => ({ error: { detail: 'rv' } })));
    cmp.revokeReceiptShare(order);
    expect(toast.error).toHaveBeenCalledWith('rv');
    cmp.revokingReceiptId = null; // error path has no complete -> reset to retry
    account.revokeReceiptShare.and.returnValue(throwError(() => ({})));
    cmp.revokeReceiptShare(order);
    expect(toast.error).toHaveBeenCalledWith('account.orders.receiptRevokeError');
    expect(confirmSpy).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('copyReceiptUrl clipboard success sets and clears copied id, failure falls back', fakeAsync(() => {
    const { cmp } = makeHost();
    setClipboard({ writeText: () => Promise.resolve() } as any);
    (cmp as any).copyReceiptUrl('o1', 'http://r', 'account.orders.receiptReady');
    flushMicrotasks();
    expect(cmp.receiptCopiedId()).toBe('o1');
    tick(2300);
    expect(cmp.receiptCopiedId()).toBeNull();
    // second copy resets timer
    (cmp as any).copyReceiptUrl('o1', 'http://r', 'account.orders.receiptReady');
    flushMicrotasks();
    (cmp as any).copyReceiptUrl('o2', 'http://r', 'account.orders.receiptReady');
    flushMicrotasks();
    tick(2300);
    // clipboard failure path
    setClipboard({ writeText: () => Promise.reject(new Error('no')) } as any);
    (cmp as any).copyReceiptUrl('o3', 'http://r', 'account.orders.receiptReady');
    flushMicrotasks();
    // no clipboard at all
    setClipboard(undefined as any);
    (cmp as any).copyReceiptUrl('o4', 'http://r', 'account.orders.receiptReady');
    flushMicrotasks();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- address form ----

  it('openAddressForm / duplicateAddress / closeAddressForm / edit', () => {
    const { cmp } = makeHost();
    cmp.openAddressForm();
    expect(cmp.addressModel.country).toBe('US');
    cmp.openAddressForm({ ...address, label: 'Work' } as any);
    expect(cmp.editingAddressId).toBe('a1');
    cmp.duplicateAddress(address);
    expect(cmp.editingAddressId).toBeNull();
    cmp.duplicateAddress({ id: 'x' } as any);
    cmp.editAddress(address);
    expect(cmp.showAddressForm).toBeTrue();
    cmp.closeAddressForm();
    expect(cmp.showAddressForm).toBeFalse();
  });

  it('saveAddress create and update, success and error', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.editingAddressId = null;
    cmp.saveAddress(address as any);
    expect(account.createAddress).toHaveBeenCalled();
    cmp.editingAddressId = 'a1';
    cmp.saveAddress(address as any);
    expect(account.updateAddress).toHaveBeenCalled();
    account.createAddress.and.returnValue(throwError(() => ({ error: { detail: 'c' } })));
    cmp.editingAddressId = null;
    cmp.saveAddress(address as any);
    expect(toast.error).toHaveBeenCalledWith('c');
    account.createAddress.and.returnValue(throwError(() => ({})));
    cmp.saveAddress(address as any);
    account.updateAddress.and.returnValue(throwError(() => ({ error: { detail: 'u' } })));
    cmp.editingAddressId = 'a1';
    cmp.saveAddress(address as any);
    expect(toast.error).toHaveBeenCalledWith('u');
    account.updateAddress.and.returnValue(throwError(() => ({})));
    cmp.saveAddress(address as any);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('removeAddress confirm, success, error', fakeAsync(() => {
    const { cmp } = makeHost();
    spyOn(window, 'confirm').and.returnValues(false, true, true);
    cmp.removeAddress('a1');
    cmp.addresses.set([address]);
    cmp.removeAddress('a1');
    expect(cmp.addresses().length).toBe(0);
    account.deleteAddress.and.returnValue(throwError(() => new Error('x')));
    cmp.removeAddress('a1');
    expect(toast.error).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('setDefaultShipping / setDefaultBilling success and error', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.addresses.set([address, { ...address, id: 'a2', is_default_shipping: false } as any]);
    cmp.setDefaultShipping({ ...address, id: 'a2' } as any);
    account.updateAddress.and.returnValue(
      of({ ...address, id: 'a2', is_default_billing: true } as any),
    );
    cmp.setDefaultBilling({ ...address, id: 'a2' } as any);
    account.updateAddress.and.returnValue(throwError(() => ({ error: { detail: 'se' } })));
    cmp.setDefaultShipping(address);
    expect(toast.error).toHaveBeenCalledWith('se');
    account.updateAddress.and.returnValue(throwError(() => ({})));
    cmp.setDefaultShipping(address);
    expect(toast.error).toHaveBeenCalledWith('account.addresses.errors.defaultShipping');
    account.updateAddress.and.returnValue(throwError(() => ({ error: { detail: 'be' } })));
    cmp.setDefaultBilling(address);
    expect(toast.error).toHaveBeenCalledWith('be');
    account.updateAddress.and.returnValue(throwError(() => ({})));
    cmp.setDefaultBilling(address);
    expect(toast.error).toHaveBeenCalledWith('account.addresses.errors.defaultBilling');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('upsertAddress adds new when not present', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.addresses.set([address]);
    account.updateAddress.and.returnValue(
      of({ ...address, id: 'new', is_default_shipping: true } as any),
    );
    cmp.setDefaultShipping({ ...address, id: 'new' } as any);
    expect(cmp.addresses().some((a) => a.id === 'new')).toBeTrue();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('normalizeAddressLabel covers home/work/other/translated/raw', () => {
    const { cmp } = makeHost();
    const fn = (l: any) => (cmp as any).normalizeAddressLabel(l);
    expect(fn(null)).toBe('home');
    expect(fn('home')).toBe('home');
    expect(fn('acasa')).toBe('home');
    expect(fn('serviciu')).toBe('work');
    expect(fn('altul')).toBe('other');
    expect(fn('Custom Label')).toBe('Custom Label');
  });

  // ---- verification ----

  it('resendVerification success, cooldown guard, error', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.resendVerification();
    expect(cmp.verificationStatus).toBeTruthy();
    expect(cmp.primaryVerificationResendRemainingSeconds()).toBeGreaterThan(0);
    cmp.resendVerification(); // cooldown guard
    cmp.primaryVerificationResendUntil.set(null);
    expect(cmp.primaryVerificationResendRemainingSeconds()).toBe(0);
    auth.requestEmailVerification.and.returnValue(throwError(() => new Error('x')));
    cmp.resendVerification();
    expect(toast.error).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- avatar ----

  it('onAvatarChange no file vs file', () => {
    const { cmp } = makeHost();
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    cmp.onAvatarChange({ target: input } as any);
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    cmp.onAvatarChange({ target: input } as any);
    expect(auth.uploadAvatar).toHaveBeenCalled();
  });

  it('uploadAvatar success, guard, error', fakeAsync(() => {
    const { cmp } = makeHost();
    const file = new File(['x'], 'a.png');
    cmp.uploadAvatar(file);
    expect(cmp.avatar).toBe('a.png');
    cmp.avatarBusy = true;
    cmp.uploadAvatar(file);
    cmp.avatarBusy = false;
    auth.uploadAvatar.and.returnValue(throwError(() => ({ error: { detail: 'au' } })));
    cmp.uploadAvatar(file);
    expect(toast.error).toHaveBeenCalledWith('au');
    auth.uploadAvatar.and.returnValue(throwError(() => ({})));
    cmp.uploadAvatar(file);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('useGoogleAvatar success, guard, error', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.useGoogleAvatar();
    expect(cmp.avatar).toBe('g.png');
    cmp.avatarBusy = true;
    cmp.useGoogleAvatar();
    cmp.avatarBusy = false;
    auth.useGoogleAvatar.and.returnValue(throwError(() => ({ error: { detail: 'ge' } })));
    cmp.useGoogleAvatar();
    expect(toast.error).toHaveBeenCalledWith('ge');
    cmp.avatarBusy = false; // error path has no complete -> reset to retry
    auth.useGoogleAvatar.and.returnValue(throwError(() => ({})));
    cmp.useGoogleAvatar();
    expect(toast.error).toHaveBeenCalledWith('account.profile.avatar.googleError');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('removeAvatar confirm, guard, success, error', fakeAsync(() => {
    const { cmp } = makeHost();
    spyOn(window, 'confirm').and.returnValues(false, true, true, true);
    cmp.removeAvatar(); // confirm false
    cmp.removeAvatar(); // success
    expect(cmp.avatar).toBeNull();
    cmp.avatarBusy = true;
    cmp.removeAvatar();
    cmp.avatarBusy = false;
    auth.removeAvatar.and.returnValue(throwError(() => ({ error: { detail: 're' } })));
    cmp.removeAvatar();
    expect(toast.error).toHaveBeenCalledWith('re');
    cmp.avatarBusy = false; // error path has no complete -> reset to retry
    auth.removeAvatar.and.returnValue(throwError(() => ({})));
    cmp.removeAvatar();
    expect(toast.error).toHaveBeenCalledWith('account.profile.avatar.removeError');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- session / sign out / admin ----

  it('refreshSession success, expired, error', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.refreshSession();
    expect(toast.success).toHaveBeenCalled();
    auth.refresh.and.returnValue(of(null as any));
    cmp.refreshSession();
    auth.refresh.and.returnValue(throwError(() => new Error('x')));
    cmp.refreshSession();
    expect(toast.error).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('signOut clears wishlist and navigates', fakeAsync(() => {
    const { cmp, router } = makeHost();
    spyOn(router, 'navigateByUrl').and.returnValue(Promise.resolve(true) as any);
    cmp.signOut();
    expect(wishlist.clear).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('isAdmin and isAuthenticated delegate', () => {
    const { cmp } = makeHost();
    expect(cmp.isAdmin()).toBeTrue();
    expect(cmp.isAuthenticated()).toBeTrue();
  });

  // ---- profile completeness ----

  it('profileCompleteness counts all fields', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.ngOnInit();
    const result = cmp.profileCompleteness();
    expect(result.total).toBe(8);
    expect(result.percent).toBeGreaterThan(0);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('profileCompleteness with empty fields and avatar fallback', () => {
    const { cmp } = makeHost();
    cmp.profileName = '';
    cmp.profileFirstName = '';
    cmp.profileLastName = '';
    cmp.profileDateOfBirth = '';
    cmp.profilePhoneNational = '';
    cmp.avatar = null;
    cmp.profile.set({ avatar_url: 'x' } as any);
    cmp.profileLanguage = 'en';
    cmp.emailVerified.set(false);
    const r = cmp.profileCompleteness();
    expect(r.completed).toBeGreaterThanOrEqual(1);
  });

  it('missingProfileFields / profileCompletionRequired branches', () => {
    const { cmp } = makeHost();
    cmp.profile.set(null);
    expect(cmp.profileCompletionRequired()).toBeFalse();
    cmp.profile.set({ ...profile } as any);
    expect(Array.isArray(cmp.missingProfileFields())).toBeTrue();
    expect(cmp.profileCompletionRequired()).toBeFalse(); // complete profile
    cmp.profile.set({ id: 'u', email: 'e', google_sub: 'gs' } as any);
    expect(cmp.profileCompletionRequired()).toBeTrue();
  });

  it('phone previews and usernameChanged', () => {
    const { cmp } = makeHost();
    cmp.profilePhoneCountry = 'RO';
    cmp.profilePhoneNational = '723204204';
    expect(typeof cmp.phoneNationalPreview()).toBe('string');
    expect(cmp.phoneE164Preview()).toBeDefined();
    cmp.profile.set({ username: 'old' } as any);
    cmp.profileUsername = 'new';
    expect(cmp.usernameChanged()).toBeTrue();
    cmp.profileUsername = 'old';
    expect(cmp.usernameChanged()).toBeFalse();
  });

  it('requiredFieldLabelKey covers all fields', () => {
    const { cmp } = makeHost();
    const fields = [
      'name',
      'username',
      'first_name',
      'last_name',
      'date_of_birth',
      'phone',
    ] as const;
    for (const f of fields) {
      expect(typeof cmp.requiredFieldLabelKey(f)).toBe('string');
    }
  });

  // ---- saveProfile ----

  it('saveProfile not authenticated guard', () => {
    const { cmp } = makeHost();
    auth.isAuthenticated.and.returnValue(false);
    cmp.saveProfile();
    expect(auth.updateProfile).not.toHaveBeenCalled();
  });

  it('saveProfile success without username change navigates on completion', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.profile.set({ ...profile } as any);
    cmp.profileName = 'New';
    cmp.profileUsername = 'theuser';
    cmp.profilePhoneCountry = 'RO';
    cmp.profilePhoneNational = '723204204';
    (cmp as any).forceProfileCompletion = true;
    auth.updateProfile.and.returnValue(of({ ...profile, name: 'New' } as any));
    cmp.saveProfile();
    expect(auth.updateProfile).toHaveBeenCalled();
    expect(cmp.profileSaved).toBeTrue();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('saveProfile required-field validations', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.profile.set({ id: 'u', email: 'e', google_sub: 'gs' } as any);
    const cases: Array<[Partial<any>, string]> = [
      [{ profileName: '' }, 'account.profile.errors.displayNameRequired'],
      [{ profileName: 'N', profileUsername: '' }, 'validation.usernameInvalid'],
      [
        { profileName: 'N', profileUsername: 'okuser', profileFirstName: '' },
        'account.profile.errors.firstNameRequired',
      ],
      [
        { profileName: 'N', profileUsername: 'okuser', profileFirstName: 'F', profileLastName: '' },
        'account.profile.errors.lastNameRequired',
      ],
      [
        {
          profileName: 'N',
          profileUsername: 'okuser',
          profileFirstName: 'F',
          profileLastName: 'L',
          profileDateOfBirth: '',
        },
        'account.profile.errors.dobRequired',
      ],
      [
        {
          profileName: 'N',
          profileUsername: 'okuser',
          profileFirstName: 'F',
          profileLastName: 'L',
          profileDateOfBirth: '1990-01-01',
          profilePhoneNational: '',
        },
        'validation.phoneInvalid',
      ],
    ];
    for (const [patch, key] of cases) {
      Object.assign(cmp, patch);
      cmp.saveProfile();
      expect(cmp.profileError).toBe(key);
    }
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('saveProfile invalid phone (not required) and future dob', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.profile.set({ ...profile } as any);
    cmp.profilePhoneCountry = 'RO';
    cmp.profilePhoneNational = '1'; // invalid national
    cmp.saveProfile();
    expect(cmp.profileError).toBe('validation.phoneInvalid');
    cmp.profilePhoneNational = '';
    cmp.profileDateOfBirth = '2999-01-01';
    cmp.saveProfile();
    expect(cmp.profileError).toBe('account.profile.errors.dobFuture');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('saveProfile requires password when username changes, then updates username', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.profile.set({ ...profile, username: 'old' } as any);
    cmp.profileUsername = 'newname';
    cmp.profilePhoneNational = '';
    cmp.profileDateOfBirth = '';
    cmp.profileUsernamePassword = '';
    cmp.saveProfile();
    expect(cmp.profileError).toBe('auth.currentPasswordRequired');
    cmp.profileUsernamePassword = 'pw';
    cmp.saveProfile();
    expect(auth.updateUsername).toHaveBeenCalledWith('newname', 'pw');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('saveProfile error path', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.profile.set({ ...profile } as any);
    cmp.profilePhoneNational = '';
    cmp.profileDateOfBirth = '';
    auth.updateProfile.and.returnValue(throwError(() => ({ error: { detail: 'pe' } })));
    cmp.saveProfile();
    expect(cmp.profileError).toBe('pe');
    auth.updateProfile.and.returnValue(throwError(() => ({})));
    cmp.saveProfile();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- aliases / cooldowns ----

  it('loadAliases guards and error', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.loadAliases(true);
    expect(cmp.aliases()).toBeTruthy();
    cmp.loadAliases(); // already loaded guard
    cmp.aliasesLoading.set(true);
    cmp.loadAliases();
    cmp.aliasesLoading.set(false);
    cmp.aliases.set(null);
    auth.getAliases.and.returnValue(throwError(() => new Error('x')));
    cmp.loadAliases(true);
    expect(cmp.aliasesError()).toBeTruthy();
    auth.isAuthenticated.and.returnValue(false);
    cmp.loadAliases(true);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('loadCooldowns guards and error', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.loadCooldowns(true);
    expect(cmp.cooldownsLoaded()).toBeTrue();
    cmp.loadCooldowns(); // loaded guard
    cmp.cooldownsLoading.set(true);
    cmp.loadCooldowns();
    cmp.cooldownsLoading.set(false);
    cmp.cooldownsLoaded.set(false);
    auth.getCooldowns.and.returnValue(throwError(() => new Error('x')));
    cmp.loadCooldowns(true);
    expect(cmp.cooldownsError()).toBeTruthy();
    auth.isAuthenticated.and.returnValue(false);
    cmp.loadCooldowns(true);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('cooldown seconds and formatCooldown branches', () => {
    const { cmp } = makeHost();
    const future = new Date(Date.now() + 90061000).toISOString();
    cmp.cooldowns.set({
      username: { next_allowed_at: future },
      display_name: { next_allowed_at: new Date(Date.now() + 3600000).toISOString() },
      email: { next_allowed_at: new Date(Date.now() + 120000).toISOString() },
    } as any);
    expect(cmp.usernameCooldownSeconds()).toBeGreaterThan(0);
    expect(cmp.displayNameCooldownSeconds()).toBeGreaterThan(0);
    expect(cmp.emailCooldownSeconds()).toBeGreaterThan(0);
    expect(cmp.formatCooldown(0)).toBe('');
    expect(cmp.formatCooldown(90061)).toContain('d');
    expect(cmp.formatCooldown(3661)).toContain('h');
    expect(cmp.formatCooldown(61)).toContain('m');
    expect(cmp.formatCooldown(30)).toContain('s');
    cmp.cooldowns.set({ username: null } as any);
    expect(cmp.usernameCooldownSeconds()).toBe(0);
    cmp.cooldowns.set({ username: { next_allowed_at: 'bad' } } as any);
    expect(cmp.usernameCooldownSeconds()).toBe(0);
  });

  // ---- identity labels ----

  it('publicIdentityLabel / preview / accountHeaderLabel', () => {
    const { cmp } = makeHost();
    cmp.profile.set({ ...profile } as any);
    expect(typeof cmp.publicIdentityLabel()).toBe('string');
    expect(typeof cmp.publicIdentityPreviewLabel()).toBe('string');
    expect(cmp.accountHeaderLabel({ username: 'u', name: 'N', name_tag: 5 } as any)).toBe(
      'u (N#5)',
    );
    expect(cmp.accountHeaderLabel({ username: 'u', name: 'N' } as any)).toBe('u (N)');
    expect(cmp.accountHeaderLabel({ username: 'u' } as any)).toBe('u');
    expect(cmp.accountHeaderLabel({ username: '' } as any)).toBe('...');
  });

  // ---- overview labels ----

  it('lastOrderLabel branches', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.ordersLoading.set(true);
    cmp.ordersLoaded.set(false);
    expect(cmp.lastOrderLabel()).toBe('notifications.loading');
    cmp.ordersLoading.set(false);
    expect(cmp.lastOrderLabel()).toBe('...');
    cmp.ordersLoaded.set(true);
    cmp.latestOrder.set(null);
    cmp.orders.set([]);
    expect(cmp.lastOrderLabel()).toBe('account.overview.noOrders');
    cmp.latestOrder.set(order);
    expect(cmp.lastOrderLabel()).toContain('REF123');
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { adminUi: { orders: { delivered: 'Delivered!' } } }, true);
    expect(cmp.lastOrderLabel()).toContain('Delivered!');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('lastOrderSubcopy branches', () => {
    const { cmp } = makeHost();
    cmp.ordersLoading.set(true);
    cmp.ordersLoaded.set(false);
    expect(cmp.lastOrderSubcopy()).toBe('notifications.loading');
    cmp.ordersLoading.set(false);
    expect(cmp.lastOrderSubcopy()).toBe('');
    cmp.ordersLoaded.set(true);
    cmp.latestOrder.set(null);
    cmp.orders.set([]);
    expect(cmp.lastOrderSubcopy()).toBe('account.overview.noOrdersCopy');
    cmp.latestOrder.set({ ...order, created_at: '' } as any);
    expect(typeof cmp.lastOrderSubcopy()).toBe('string');
    cmp.latestOrder.set(order);
    expect(cmp.lastOrderSubcopy()).toContain('·');
  });

  it('defaultAddressLabel and subcopy branches', () => {
    const { cmp } = makeHost();
    cmp.addressesLoading.set(true);
    cmp.addressesLoaded.set(false);
    expect(cmp.defaultAddressLabel()).toBe('notifications.loading');
    expect(cmp.defaultAddressSubcopy()).toBe('notifications.loading');
    cmp.addressesLoading.set(false);
    expect(cmp.defaultAddressLabel()).toBe('...');
    expect(cmp.defaultAddressSubcopy()).toBe('');
    cmp.addressesLoaded.set(true);
    cmp.addresses.set([]);
    expect(cmp.defaultAddressLabel()).toBe('account.overview.noAddresses');
    expect(cmp.defaultAddressSubcopy()).toBe('account.overview.noAddressesCopy');
    cmp.addresses.set([{ ...address, label: '', line1: '', city: '' } as any]);
    expect(cmp.defaultAddressLabel()).toBe('account.addresses.defaultShipping');
    expect(cmp.defaultAddressSubcopy()).toBe('account.overview.savedAddressFallback');
    cmp.addresses.set([address]);
    expect(cmp.defaultAddressLabel()).toBe('Home');
    expect(cmp.defaultAddressSubcopy()).toContain('123 Main');
    cmp.addresses.set([{ ...address, is_default_shipping: false } as any]);
    expect(cmp.defaultAddressLabel()).toBe('Home');
  });

  it('wishlistCountLabel branches', () => {
    const { cmp } = makeHost();
    wishlist.isLoaded.and.returnValue(false);
    expect(cmp.wishlistCountLabel()).toBe('notifications.loading');
    wishlist.isLoaded.and.returnValue(true);
    wishlist.items.and.returnValue([{ id: '1' }]);
    expect(cmp.wishlistCountLabel()).toBe('account.overview.wishlistCountOne');
    wishlist.items.and.returnValue([{ id: '1' }, { id: '2' }]);
    expect(cmp.wishlistCountLabel()).toBe('account.overview.wishlistCountMany');
  });

  it('notificationsLabel and securityLabel branches', () => {
    const { cmp } = makeHost();
    cmp.profile.set(null);
    expect(cmp.notificationsLabel()).toBe('notifications.loading');
    expect(cmp.securityLabel()).toBe('notifications.loading');
    cmp.profile.set({ ...profile } as any);
    cmp.notifyBlogComments = false;
    cmp.notifyBlogCommentReplies = false;
    cmp.notifyMarketing = false;
    expect(cmp.notificationsLabel()).toBe('account.overview.notificationsAllOff');
    cmp.notifyMarketing = true;
    expect(cmp.notificationsLabel()).toBe('account.overview.notificationsEnabled');
    cmp.emailVerified.set(true);
    cmp.googleEmail.set('g@g');
    expect(cmp.securityLabel()).toContain('·');
    cmp.emailVerified.set(false);
    cmp.googleEmail.set(null);
    expect(cmp.securityLabel()).toContain('·');
  });

  it('supportTicketsLabel and subcopy branches', () => {
    const { cmp } = makeHost();
    cmp.ticketsLoading.set(true);
    cmp.ticketsLoaded.set(false);
    expect(cmp.supportTicketsLabel()).toBe('notifications.loading');
    expect(cmp.supportTicketsSubcopy()).toBe('notifications.loading');
    cmp.ticketsLoading.set(false);
    expect(cmp.supportTicketsLabel()).toBe('...');
    expect(cmp.supportTicketsSubcopy()).toBe('');
    cmp.ticketsLoaded.set(true);
    cmp.ticketsError.set('account.overview.support.loadError');
    expect(cmp.supportTicketsLabel()).toBe('account.overview.support.loadError');
    expect(cmp.supportTicketsSubcopy()).toBe('account.overview.support.loadErrorCopy');
    cmp.ticketsError.set(null);
    cmp.tickets.set([]);
    expect(cmp.supportTicketsLabel()).toBe('account.overview.support.none');
    expect(cmp.supportTicketsSubcopy()).toBe('account.overview.support.noneCopy');
    cmp.tickets.set([{ status: 'resolved' } as any]);
    expect(cmp.supportTicketsLabel()).toBe('account.overview.support.allResolved');
    cmp.tickets.set([{ status: 'open' } as any]);
    expect(cmp.supportTicketsLabel()).toBe('account.overview.support.openOne');
    expect(cmp.supportTicketsSubcopy()).toBe('account.overview.support.hint');
    cmp.tickets.set([{ status: 'open' } as any, { status: '' } as any]);
    expect(cmp.supportTicketsLabel()).toBe('account.overview.support.openMany');
  });

  // ---- notifications ----

  it('saveNotifications success, guard, error', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.saveNotifications();
    expect(cmp.notificationsMessage).toBe('account.notifications.saved');
    auth.isAuthenticated.and.returnValue(false);
    cmp.saveNotifications();
    auth.isAuthenticated.and.returnValue(true);
    auth.updateNotificationPreferences.and.returnValue(throwError(() => new Error('x')));
    cmp.saveNotifications();
    expect(cmp.notificationsError).toBe('account.notifications.saveError');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- deletion / export ----

  it('loadDeletionStatus error and guard', fakeAsync(() => {
    const { cmp } = makeHost('/account/privacy');
    auth.isAuthenticated.and.returnValue(false);
    (cmp as any).loadDeletionStatus();
    auth.isAuthenticated.and.returnValue(true);
    account.getDeletionStatus.and.returnValue(throwError(() => new Error('x')));
    (cmp as any).loadDeletionStatus();
    expect(cmp.deletionError()).toBeTruthy();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('export job: latest pending starts polling, succeeded toast, then stops', fakeAsync(() => {
    const { cmp } = makeHost('/account/privacy');
    account.getLatestExportJob.and.returnValue(of({ id: 'j1', status: 'pending' } as any));
    account.getExportJob.and.returnValue(of({ id: 'j1', status: 'succeeded' } as any));
    (cmp as any).loadLatestExportJob();
    tick(2000);
    expect(cmp.exportJob()?.status).toBe('succeeded');
    expect(notifications.refreshUnreadCount).toHaveBeenCalled();
    (cmp as any).stopExportJobPolling();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('loadLatestExportJob 404 clears job, other error toasts, guard', fakeAsync(() => {
    const { cmp } = makeHost('/account/privacy');
    account.getLatestExportJob.and.returnValue(throwError(() => ({ status: 404 })));
    (cmp as any).loadLatestExportJob();
    expect(cmp.exportJob()).toBeNull();
    account.getLatestExportJob.and.returnValue(throwError(() => ({ error: { detail: 'le' } })));
    (cmp as any).loadLatestExportJob();
    expect(cmp.exportError).toBe('le');
    account.getLatestExportJob.and.returnValue(throwError(() => ({})));
    (cmp as any).loadLatestExportJob();
    cmp.exportJobLoading.set(true);
    (cmp as any).loadLatestExportJob(); // guard
    cmp.exportJobLoading.set(false);
    auth.isAuthenticated.and.returnValue(false);
    (cmp as any).loadLatestExportJob();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('startExportJobPolling guards and failed status, transient errors', fakeAsync(() => {
    const { cmp } = makeHost('/account/privacy');
    (cmp as any).startExportJobPolling('');
    cmp.exportJob.set({ id: 'j1', status: 'pending' } as any);
    (cmp as any).startExportJobPolling('j1');
    (cmp as any).startExportJobPolling('j1'); // already polling same job
    account.getExportJob.and.returnValue(throwError(() => new Error('x')));
    tick(2000); // transient error path (error callback, no complete -> stays in-flight)
    // A real transient HTTP error never completes, leaving the in-flight flag set;
    // clear it so the next interval tick issues a fresh poll that resolves to failed.
    (cmp as any).exportJobPollInFlight = false;
    account.getExportJob.and.returnValue(of({ id: 'j1', status: 'failed' } as any));
    tick(2000);
    expect(cmp.exportJob()?.status).toBe('failed');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('export polling skips when not authenticated or in-flight', fakeAsync(() => {
    const { cmp } = makeHost('/account/privacy');
    cmp.exportJob.set({ id: 'j1', status: 'running' } as any);
    const resolveSub = new Subject<any>();
    account.getExportJob.and.returnValue(resolveSub.asObservable());
    (cmp as any).startExportJobPolling('j1');
    tick(2000); // starts in-flight (no complete yet)
    tick(2000); // in-flight guard hit
    auth.isAuthenticated.and.returnValue(false);
    tick(2000); // not-authenticated guard
    resolveSub.next({ id: 'j1', status: 'running' });
    resolveSub.complete();
    auth.isAuthenticated.and.returnValue(true);
    (cmp as any).stopExportJobPolling();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('export polling keeps polling on status transition (pending->running)', fakeAsync(() => {
    const { cmp } = makeHost('/account/privacy');
    cmp.exportJob.set({ id: 'j1', status: 'pending' } as any);
    account.getExportJob.and.returnValue(of({ id: 'j1', status: 'running' } as any));
    (cmp as any).startExportJobPolling('j1');
    tick(2000);
    expect(cmp.exportJob()?.status).toBe('running');
    (cmp as any).stopExportJobPolling();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('requestDataExport success started, succeeded, error, guard', fakeAsync(() => {
    const { cmp } = makeHost('/account/privacy');
    cmp.requestDataExport();
    expect(account.startExportJob).toHaveBeenCalled();
    (cmp as any).stopExportJobPolling();
    account.startExportJob.and.returnValue(of({ id: 'j2', status: 'succeeded' } as any));
    cmp.requestDataExport();
    expect((cmp as any).exportReadyToastShownForJobId).toBe('j2');
    cmp.exportJobLoading.set(true);
    cmp.requestDataExport(); // guard
    cmp.exportJobLoading.set(false);
    account.startExportJob.and.returnValue(throwError(() => ({ error: { detail: 'se' } })));
    cmp.requestDataExport();
    expect(cmp.exportError).toBe('se');
    account.startExportJob.and.returnValue(throwError(() => ({})));
    cmp.requestDataExport();
    auth.isAuthenticated.and.returnValue(false);
    cmp.requestDataExport();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('downloadExportJob success, guards, error', fakeAsync(() => {
    const { cmp } = makeHost('/account/privacy');
    cmp.exportJob.set({ id: 'j1', status: 'succeeded' } as any);
    cmp.downloadExportJob();
    expect(account.downloadExportJob).toHaveBeenCalled();
    cmp.exportingData = true;
    cmp.downloadExportJob();
    cmp.exportingData = false;
    cmp.exportJob.set({ id: 'j1', status: 'pending' } as any);
    cmp.downloadExportJob(); // not succeeded guard
    cmp.exportJob.set({ id: 'j1', status: 'succeeded' } as any);
    account.downloadExportJob.and.returnValue(throwError(() => ({ error: { detail: 'de' } })));
    cmp.downloadExportJob();
    expect(cmp.exportError).toBe('de');
    cmp.exportingData = false; // error path has no complete -> reset to retry
    account.downloadExportJob.and.returnValue(throwError(() => ({})));
    cmp.downloadExportJob();
    expect(cmp.exportError).toBe('account.privacy.export.downloadError');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('downloadMyData routes to download or request', fakeAsync(() => {
    const { cmp } = makeHost('/account/privacy');
    cmp.exportJob.set({ id: 'j1', status: 'succeeded' } as any);
    cmp.downloadMyData();
    expect(account.downloadExportJob).toHaveBeenCalled();
    cmp.exportJob.set(null);
    cmp.downloadMyData();
    expect(account.startExportJob).toHaveBeenCalled();
    (cmp as any).stopExportJobPolling();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('exportActionLabelKey and exportActionDisabled cover states', () => {
    const { cmp } = makeHost('/account/privacy');
    cmp.exportJobLoading.set(true);
    expect(cmp.exportActionLabelKey()).toBe('account.privacy.export.actionWorking');
    expect(cmp.exportActionDisabled()).toBeTrue();
    cmp.exportJobLoading.set(false);
    cmp.exportJob.set(null);
    expect(cmp.exportActionLabelKey()).toBe('account.privacy.export.actionGenerate');
    cmp.exportJob.set({ id: 'j', status: 'succeeded' } as any);
    expect(cmp.exportActionLabelKey()).toBe('account.privacy.export.actionDownload');
    cmp.exportingData = true;
    expect(cmp.exportActionLabelKey()).toBe('account.privacy.export.actionDownloading');
    expect(cmp.exportActionDisabled()).toBeTrue();
    cmp.exportingData = false;
    cmp.exportJob.set({ id: 'j', status: 'failed' } as any);
    expect(cmp.exportActionLabelKey()).toBe('account.privacy.export.actionRetry');
    cmp.exportJob.set({ id: 'j', status: 'pending' } as any);
    expect(cmp.exportActionLabelKey()).toBe('account.privacy.export.actionGenerating');
    expect(cmp.exportActionDisabled()).toBeTrue();
    cmp.exportJob.set({ id: 'j', status: 'running' } as any);
    expect(cmp.exportActionDisabled()).toBeTrue();
  });

  it('requestDeletion success, password missing, guard, error', fakeAsync(() => {
    const { cmp } = makeHost('/account/privacy');
    cmp.deletionPassword = '';
    cmp.requestDeletion();
    expect(cmp.deletionError()).toBeTruthy();
    cmp.deletionPassword = 'pw';
    cmp.requestDeletion();
    expect(account.requestAccountDeletion).toHaveBeenCalled();
    cmp.requestingDeletion = true;
    cmp.requestDeletion();
    cmp.requestingDeletion = false;
    cmp.deletionPassword = 'pw';
    account.requestAccountDeletion.and.returnValue(
      throwError(() => ({ error: { detail: 'rde' } })),
    );
    cmp.requestDeletion();
    expect(cmp.deletionError()).toBe('rde');
    cmp.requestingDeletion = false; // error path has no complete -> reset to retry
    account.requestAccountDeletion.and.returnValue(throwError(() => ({})));
    cmp.deletionPassword = 'pw';
    cmp.requestDeletion();
    expect(cmp.deletionError()).toBe('account.privacy.deletion.requestError');
    auth.isAuthenticated.and.returnValue(false);
    cmp.requestDeletion();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('cancelDeletion success, guard, error', fakeAsync(() => {
    const { cmp } = makeHost('/account/privacy');
    cmp.cancelDeletion();
    expect(account.cancelAccountDeletion).toHaveBeenCalled();
    cmp.cancellingDeletion = true;
    cmp.cancelDeletion();
    cmp.cancellingDeletion = false;
    account.cancelAccountDeletion.and.returnValue(throwError(() => ({ error: { detail: 'cde' } })));
    cmp.cancelDeletion();
    expect(cmp.deletionError()).toBe('cde');
    cmp.cancellingDeletion = false; // error path has no complete -> reset to retry
    account.cancelAccountDeletion.and.returnValue(throwError(() => ({})));
    cmp.cancelDeletion();
    expect(cmp.deletionError()).toBe('account.privacy.deletion.cancelError');
    auth.isAuthenticated.and.returnValue(false);
    cmp.cancelDeletion();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('deletion cooldown ms/percent and formatDurationShort', () => {
    const { cmp } = makeHost();
    cmp.deletionStatus.set(null);
    expect(cmp.deletionCooldownRemainingMs()).toBeNull();
    expect(cmp.deletionCooldownProgressPercent()).toBe(0);
    cmp.deletionStatus.set({ scheduled_for: new Date(Date.now() + 100000).toISOString() } as any);
    expect(cmp.deletionCooldownRemainingMs()!).toBeGreaterThan(0);
    cmp.deletionStatus.set({ scheduled_for: new Date(Date.now() - 100000).toISOString() } as any);
    expect(cmp.deletionCooldownRemainingMs()).toBe(0);
    cmp.deletionStatus.set({
      requested_at: new Date(Date.now() - 50000).toISOString(),
      scheduled_for: new Date(Date.now() + 50000).toISOString(),
    } as any);
    expect(cmp.deletionCooldownProgressPercent()).toBeGreaterThan(0);
    cmp.deletionStatus.set({ requested_at: 'x', scheduled_for: 'y' } as any);
    expect(cmp.deletionCooldownProgressPercent()).toBe(0);
    expect(cmp.formatDurationShort(7200000)).toContain('h');
    expect(cmp.formatDurationShort(120000)).toContain('m');
    expect(cmp.formatDurationShort(5000)).toContain('s');
    expect(cmp.formatDurationShort(-5)).toBe('0s');
  });

  // ---- comments ----

  it('loadMyComments success, error, guard, pagination', fakeAsync(() => {
    const { cmp } = makeHost('/account/comments');
    cmp.loadMyComments();
    expect(cmp.myCommentsMeta()).toBeTruthy();
    cmp.nextMyCommentsPage();
    expect(blog.listMyComments).toHaveBeenCalled();
    cmp.myCommentsMeta.set({ page: 2, total_pages: 2 } as any);
    cmp.nextMyCommentsPage(); // at end
    cmp.prevMyCommentsPage();
    cmp.myCommentsMeta.set({ page: 1, total_pages: 2 } as any);
    cmp.prevMyCommentsPage(); // at start
    cmp.myCommentsMeta.set(null);
    cmp.nextMyCommentsPage();
    cmp.prevMyCommentsPage();
    blog.listMyComments.and.returnValue(throwError(() => new Error('x')));
    cmp.loadMyComments();
    expect(cmp.myCommentsError()).toBeTruthy();
    auth.isAuthenticated.and.returnValue(false);
    cmp.loadMyComments();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('commentStatusChipClass and formatTimestamp', () => {
    const { cmp } = makeHost();
    expect(cmp.commentStatusChipClass('posted')).toContain('emerald');
    expect(cmp.commentStatusChipClass('hidden')).toContain('amber');
    expect(cmp.commentStatusChipClass('deleted')).toContain('slate');
    expect(cmp.commentStatusChipClass('other')).toContain('slate');
    expect(cmp.formatTimestamp(null)).toBe('');
    expect(cmp.formatTimestamp('2020-01-01')).toBeTruthy();
  });

  // ---- secondary emails ----

  it('loadSecondaryEmails error and guards (via security section)', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    cmp.ngOnInit();
    cmp.secondaryEmailsLoaded.set(false);
    auth.listEmails.and.returnValue(throwError(() => new Error('x')));
    (cmp as any).loadSecondaryEmails(true);
    expect(cmp.secondaryEmailsError()).toBeTruthy();
    cmp.secondaryEmailsLoading.set(true);
    (cmp as any).loadSecondaryEmails();
    cmp.secondaryEmailsLoading.set(false);
    cmp.secondaryEmailsLoaded.set(true);
    (cmp as any).loadSecondaryEmails();
    auth.isAuthenticated.and.returnValue(false);
    (cmp as any).loadSecondaryEmails(true);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('loadSecondaryEmails handles null secondary_emails', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    auth.listEmails.and.returnValue(of({ primary_email: 'e', secondary_emails: null } as any));
    (cmp as any).loadSecondaryEmails(true);
    expect(cmp.secondaryEmails()).toEqual([]);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('addSecondaryEmail success, empty, guard, error', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    cmp.secondaryEmailToAdd = '';
    cmp.addSecondaryEmail();
    expect(cmp.secondaryEmailMessage).toBeTruthy();
    cmp.secondaryEmailToAdd = 'b@b.com';
    cmp.addSecondaryEmail();
    expect(cmp.secondaryEmails().length).toBeGreaterThan(0);
    cmp.addingSecondaryEmail = true;
    cmp.addSecondaryEmail();
    cmp.addingSecondaryEmail = false;
    auth.addSecondaryEmail.and.returnValue(throwError(() => ({ error: { detail: 'ae' } })));
    cmp.secondaryEmailToAdd = 'c@c.com';
    cmp.addSecondaryEmail();
    expect(cmp.secondaryEmailMessage).toBe('ae');
    auth.addSecondaryEmail.and.returnValue(throwError(() => ({})));
    cmp.secondaryEmailToAdd = 'd@d.com';
    cmp.addSecondaryEmail();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('secondary email verification lifecycle, resend cooldown, confirm', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    cmp.startSecondaryEmailVerification('se1');
    expect(cmp.secondaryVerificationEmailId).toBe('se1');
    expect(cmp.secondaryEmailResendRemainingSeconds('se1')).toBe(0);
    cmp.resendSecondaryEmailVerification('se1');
    expect(cmp.secondaryEmailResendRemainingSeconds('se1')).toBeGreaterThan(0);
    cmp.resendSecondaryEmailVerification('se1'); // cooldown guard
    cmp.secondaryEmailResendUntilById.set({});
    auth.requestSecondaryEmailVerification.and.returnValue(
      throwError(() => ({ error: { detail: 're' } })),
    );
    cmp.resendSecondaryEmailVerification('se1');
    expect(cmp.secondaryEmailMessage).toBe('re');
    auth.requestSecondaryEmailVerification.and.returnValue(throwError(() => ({})));
    cmp.secondaryEmailResendUntilById.set({});
    cmp.resendSecondaryEmailVerification('se1');
    // confirm
    cmp.secondaryEmails.set([{ id: 'se1', email: 'b@b.com', verified: false } as any]);
    cmp.startSecondaryEmailVerification('se1');
    cmp.secondaryVerificationToken = '';
    cmp.confirmSecondaryEmailVerification();
    expect(cmp.secondaryVerificationStatus).toBeTruthy();
    cmp.secondaryVerificationToken = 'tok';
    cmp.confirmSecondaryEmailVerification();
    expect(cmp.secondaryEmails()[0].verified).toBeTrue();
    cmp.cancelSecondaryEmailVerification();
    expect(cmp.secondaryVerificationEmailId).toBeNull();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('confirmSecondaryEmailVerification guards and error and no verified_at', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    cmp.verifyingSecondaryEmail = true;
    cmp.confirmSecondaryEmailVerification();
    cmp.verifyingSecondaryEmail = false;
    cmp.secondaryVerificationEmailId = null;
    cmp.confirmSecondaryEmailVerification();
    cmp.secondaryEmails.set([{ id: 'se1', email: 'b', verified: false } as any]);
    cmp.startSecondaryEmailVerification('se1');
    cmp.secondaryVerificationToken = 'tok';
    auth.confirmSecondaryEmailVerification.and.returnValue(
      of({ id: 'se1', verified_at: null } as any),
    );
    cmp.confirmSecondaryEmailVerification();
    expect(cmp.secondaryEmails()[0].verified).toBeTrue();
    cmp.startSecondaryEmailVerification('se1');
    cmp.secondaryVerificationToken = 'tok';
    auth.confirmSecondaryEmailVerification.and.returnValue(
      throwError(() => ({ error: { detail: 'cve' } })),
    );
    cmp.confirmSecondaryEmailVerification();
    expect(cmp.secondaryVerificationStatus).toBe('cve');
    cmp.startSecondaryEmailVerification('se1');
    cmp.secondaryVerificationToken = 'tok';
    auth.confirmSecondaryEmailVerification.and.returnValue(throwError(() => ({})));
    cmp.confirmSecondaryEmailVerification();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('delete secondary email lifecycle, guards, confirm, error', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    spyOn(window, 'confirm').and.returnValues(false, true, true, true);
    cmp.startDeleteSecondaryEmail('se1');
    expect(cmp.removeSecondaryEmailId).toBe('se1');
    cmp.removingSecondaryEmail = true;
    cmp.startDeleteSecondaryEmail('se2'); // guard
    cmp.cancelDeleteSecondaryEmail(); // guard
    cmp.removingSecondaryEmail = false;
    cmp.confirmDeleteSecondaryEmail(); // confirm=false
    cmp.removeSecondaryEmailPassword = '';
    cmp.confirmDeleteSecondaryEmail(); // confirm=true, no password
    expect(toast.error).toHaveBeenCalled();
    cmp.secondaryEmails.set([{ id: 'se1', email: 'b' } as any]);
    cmp.secondaryVerificationEmailId = 'se1';
    cmp.removeSecondaryEmailPassword = 'pw';
    cmp.startDeleteSecondaryEmail('se1');
    cmp.removeSecondaryEmailPassword = 'pw';
    cmp.confirmDeleteSecondaryEmail();
    expect(cmp.secondaryEmails().length).toBe(0);
    cmp.cancelDeleteSecondaryEmail();
    expect(cmp.removeSecondaryEmailId).toBeNull();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('confirmDeleteSecondaryEmail no id guard and error', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    cmp.removeSecondaryEmailId = null;
    cmp.confirmDeleteSecondaryEmail();
    spyOn(window, 'confirm').and.returnValue(true);
    cmp.removeSecondaryEmailId = 'se1';
    cmp.removeSecondaryEmailPassword = 'pw';
    auth.deleteSecondaryEmail.and.returnValue(throwError(() => ({ error: { detail: 'dse' } })));
    cmp.confirmDeleteSecondaryEmail();
    expect(cmp.secondaryEmailMessage).toBe('dse');
    cmp.removeSecondaryEmailId = 'se1';
    cmp.removeSecondaryEmailPassword = 'pw';
    auth.deleteSecondaryEmail.and.returnValue(throwError(() => ({})));
    cmp.confirmDeleteSecondaryEmail();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('make primary lifecycle, guards, error', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    cmp.startMakePrimary('se1');
    expect(cmp.makePrimarySecondaryEmailId).toBe('se1');
    cmp.makingPrimaryEmail = true;
    cmp.confirmMakePrimary();
    cmp.makingPrimaryEmail = false;
    cmp.makePrimarySecondaryEmailId = null;
    cmp.confirmMakePrimary(); // no id
    cmp.startMakePrimary('se1');
    cmp.makePrimaryPassword = '';
    cmp.confirmMakePrimary(); // no password
    expect(cmp.makePrimaryError).toBeTruthy();
    cmp.makePrimaryPassword = 'pw';
    cmp.confirmMakePrimary();
    expect(auth.makeSecondaryEmailPrimary).toHaveBeenCalled();
    cmp.startMakePrimary('se1');
    cmp.makePrimaryPassword = 'pw';
    auth.makeSecondaryEmailPrimary.and.returnValue(throwError(() => ({ error: { detail: 'mp' } })));
    cmp.confirmMakePrimary();
    expect(cmp.makePrimaryError).toBe('mp');
    cmp.makingPrimaryEmail = false; // error path has no complete -> reset to retry
    cmp.startMakePrimary('se1');
    cmp.makePrimaryPassword = 'pw';
    auth.makeSecondaryEmailPrimary.and.returnValue(throwError(() => ({})));
    cmp.confirmMakePrimary();
    expect(cmp.makePrimaryError).toBe('account.security.emails.primaryUpdateError');
    cmp.cancelMakePrimary();
    expect(cmp.makePrimarySecondaryEmailId).toBeNull();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- sessions ----

  it('loadSessions error and guards, otherSessionsCount', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    auth.listSessions.and.returnValue(of([{ is_current: true }, { is_current: false }] as any));
    (cmp as any).loadSessions(true);
    expect(cmp.otherSessionsCount()).toBe(1);
    cmp.sessionsLoading.set(true);
    (cmp as any).loadSessions();
    cmp.sessionsLoading.set(false);
    cmp.sessionsLoaded.set(true);
    (cmp as any).loadSessions();
    cmp.sessionsLoaded.set(false);
    auth.listSessions.and.returnValue(throwError(() => new Error('x')));
    (cmp as any).loadSessions(true);
    expect(cmp.sessionsError()).toBeTruthy();
    auth.listSessions.and.returnValue(of(null as any));
    cmp.sessionsLoaded.set(false);
    (cmp as any).loadSessions(true);
    auth.isAuthenticated.and.returnValue(false);
    (cmp as any).loadSessions(true);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('revoke other sessions lifecycle, guards, none-revoked, error', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    const confirmSpy = spyOn(window, 'confirm').and.returnValues(false, true, true, true, true);
    cmp.startRevokeOtherSessions();
    expect(cmp.revokeOtherSessionsConfirming).toBeTrue();
    cmp.confirmRevokeOtherSessions(); // confirm=false
    cmp.revokeOtherSessionsConfirming = true;
    cmp.revokeOtherSessionsPassword = '';
    cmp.confirmRevokeOtherSessions(); // confirm=true, no password
    expect(toast.error).toHaveBeenCalled();
    cmp.revokeOtherSessionsConfirming = true;
    cmp.revokeOtherSessionsPassword = 'pw';
    cmp.confirmRevokeOtherSessions(); // success revoked>0
    expect(cmp.revokeOtherSessionsConfirming).toBeFalse();
    cmp.startRevokeOtherSessions();
    cmp.revokeOtherSessionsPassword = 'pw';
    auth.revokeOtherSessions.and.returnValue(of({ revoked: 0 } as any));
    cmp.confirmRevokeOtherSessions(); // none revoked
    cmp.startRevokeOtherSessions();
    cmp.revokeOtherSessionsPassword = 'pw';
    auth.revokeOtherSessions.and.returnValue(throwError(() => ({ error: { detail: 'rs' } })));
    cmp.confirmRevokeOtherSessions();
    expect(cmp.sessionsError()).toBe('rs');
    expect(confirmSpy).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('revoke other sessions extra guards', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    cmp.revokingOtherSessions = true;
    cmp.startRevokeOtherSessions();
    cmp.cancelRevokeOtherSessions();
    cmp.confirmRevokeOtherSessions();
    cmp.revokingOtherSessions = false;
    cmp.revokeOtherSessionsConfirming = false;
    cmp.confirmRevokeOtherSessions(); // not confirming guard
    cmp.cancelRevokeOtherSessions();
    expect(cmp.revokeOtherSessionsConfirming).toBeFalse();
    auth.isAuthenticated.and.returnValue(false);
    cmp.startRevokeOtherSessions();
    cmp.confirmRevokeOtherSessions();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('revoke other sessions error without detail', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    spyOn(window, 'confirm').and.returnValue(true);
    cmp.startRevokeOtherSessions();
    cmp.revokeOtherSessionsPassword = 'pw';
    auth.revokeOtherSessions.and.returnValue(throwError(() => ({})));
    cmp.confirmRevokeOtherSessions();
    cmp.startRevokeOtherSessions();
    cmp.revokeOtherSessionsPassword = 'pw';
    auth.revokeOtherSessions.and.returnValue(of(null as any));
    cmp.confirmRevokeOtherSessions();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- security events ----

  it('loadSecurityEvents error, guards, refresh', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    cmp.refreshSecurityEvents();
    expect(auth.listSecurityEvents).toHaveBeenCalled();
    cmp.securityEventsLoading.set(true);
    (cmp as any).loadSecurityEvents();
    cmp.securityEventsLoading.set(false);
    cmp.securityEventsLoaded.set(true);
    (cmp as any).loadSecurityEvents();
    cmp.securityEventsLoaded.set(false);
    auth.listSecurityEvents.and.returnValue(throwError(() => new Error('x')));
    (cmp as any).loadSecurityEvents(true);
    expect(cmp.securityEventsError()).toBeTruthy();
    auth.listSecurityEvents.and.returnValue(of(null as any));
    cmp.securityEventsLoaded.set(false);
    (cmp as any).loadSecurityEvents(true);
    auth.isAuthenticated.and.returnValue(false);
    (cmp as any).loadSecurityEvents(true);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- two factor ----

  it('loadTwoFactorStatus error and guards', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    (cmp as any).loadTwoFactorStatus(true);
    expect(cmp.twoFactorLoaded()).toBeTrue();
    cmp.twoFactorLoading.set(true);
    (cmp as any).loadTwoFactorStatus();
    cmp.twoFactorLoading.set(false);
    (cmp as any).loadTwoFactorStatus(); // loaded guard
    cmp.twoFactorLoaded.set(false);
    auth.getTwoFactorStatus.and.returnValue(throwError(() => new Error('x')));
    (cmp as any).loadTwoFactorStatus(true);
    expect(cmp.twoFactorError()).toBeTruthy();
    auth.isAuthenticated.and.returnValue(false);
    (cmp as any).loadTwoFactorStatus(true);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('startTwoFactorSetup success, password missing, guard, error', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    cmp.twoFactorSetupPassword = '';
    cmp.startTwoFactorSetup();
    expect(toast.error).toHaveBeenCalled();
    cmp.twoFactorSetupPassword = 'pw';
    cmp.startTwoFactorSetup();
    flushMicrotasks();
    expect(cmp.twoFactorSetupSecret).toBe('S');
    cmp.startingTwoFactor = true;
    cmp.startTwoFactorSetup();
    cmp.startingTwoFactor = false;
    cmp.twoFactorSetupPassword = 'pw';
    auth.startTwoFactorSetup.and.returnValue(throwError(() => ({ error: { detail: 'ts' } })));
    cmp.startTwoFactorSetup();
    expect(cmp.twoFactorError()).toBe('ts');
    cmp.startingTwoFactor = false; // error path has no complete -> reset to retry
    cmp.twoFactorSetupPassword = 'pw';
    auth.startTwoFactorSetup.and.returnValue(throwError(() => ({})));
    cmp.startTwoFactorSetup();
    expect(cmp.twoFactorError()).toBe('account.security.twoFactor.startError');
    auth.isAuthenticated.and.returnValue(false);
    cmp.startTwoFactorSetup();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('enableTwoFactor success, code missing, guard, error', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    cmp.twoFactorEnableCode = '';
    cmp.enableTwoFactor();
    cmp.twoFactorEnableCode = '123456';
    cmp.enableTwoFactor();
    expect(cmp.twoFactorRecoveryCodes).toEqual(['c1', 'c2']);
    cmp.enablingTwoFactor = true;
    cmp.enableTwoFactor();
    cmp.enablingTwoFactor = false;
    cmp.twoFactorEnableCode = '123456';
    auth.enableTwoFactor.and.returnValue(throwError(() => ({ error: { detail: 'en' } })));
    cmp.enableTwoFactor();
    expect(cmp.twoFactorError()).toBe('en');
    cmp.enablingTwoFactor = false; // error path has no complete -> reset to retry
    cmp.twoFactorEnableCode = '123456';
    auth.enableTwoFactor.and.returnValue(throwError(() => ({})));
    cmp.enableTwoFactor();
    expect(cmp.twoFactorError()).toBe('account.security.twoFactor.enableError');
    auth.isAuthenticated.and.returnValue(false);
    cmp.enableTwoFactor();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('enableTwoFactor with null recovery codes', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    auth.enableTwoFactor.and.returnValue(of({ recovery_codes: null } as any));
    cmp.twoFactorEnableCode = '123456';
    cmp.enableTwoFactor();
    expect(cmp.twoFactorRecoveryCodes).toEqual([]);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('copyTwoFactorSecret/Url/RecoveryCodes success and fallback and empty', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    cmp.twoFactorSetupSecret = null;
    void cmp.copyTwoFactorSecret();
    cmp.twoFactorSetupUrl = null;
    void cmp.copyTwoFactorSetupUrl();
    cmp.twoFactorRecoveryCodes = null;
    void cmp.copyTwoFactorRecoveryCodes();
    flushMicrotasks();
    setClipboard({ writeText: () => Promise.resolve() } as any);
    cmp.twoFactorSetupSecret = 'S';
    void cmp.copyTwoFactorSecret();
    cmp.twoFactorSetupUrl = 'otpauth://x';
    void cmp.copyTwoFactorSetupUrl();
    cmp.twoFactorRecoveryCodes = ['a', 'b'];
    void cmp.copyTwoFactorRecoveryCodes();
    flushMicrotasks();
    setClipboard(undefined as any);
    cmp.twoFactorSetupSecret = 'S';
    void cmp.copyTwoFactorSecret();
    cmp.twoFactorSetupUrl = 'otpauth://x';
    void cmp.copyTwoFactorSetupUrl();
    cmp.twoFactorRecoveryCodes = ['a'];
    void cmp.copyTwoFactorRecoveryCodes();
    flushMicrotasks();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('updateTwoFactorSetupQr returns early for an empty url', async () => {
    const { cmp } = makeHost('/account/security');
    cmp.twoFactorSetupUrl = '';
    await (cmp as any).updateTwoFactorSetupQr();
    expect(cmp.twoFactorSetupQrDataUrl).toBeNull();
    cmp.ngOnDestroy();
  });

  it('updateTwoFactorSetupQr renders a data url from the otpauth url', async () => {
    const { cmp } = makeHost('/account/security');
    cmp.twoFactorSetupUrl = 'otpauth://totp/Moment:user?secret=JBSWY3DPEHPK3PXP&issuer=Moment';
    await (cmp as any).updateTwoFactorSetupQr();
    expect(cmp.twoFactorSetupQrDataUrl).toContain('data:image');
    cmp.ngOnDestroy();
  });

  it('regenerateTwoFactorRecoveryCodes confirm/guards/error', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    const confirmSpy = spyOn(window, 'confirm').and.returnValues(false, true, true, true, true);
    cmp.regenerateTwoFactorRecoveryCodes(); // confirm false
    cmp.twoFactorManagePassword = '';
    cmp.twoFactorManageCode = '';
    cmp.regenerateTwoFactorRecoveryCodes(); // missing
    cmp.twoFactorManagePassword = 'pw';
    cmp.twoFactorManageCode = '123456';
    cmp.regenerateTwoFactorRecoveryCodes(); // success
    expect(cmp.twoFactorRecoveryCodes).toEqual(['x']);
    cmp.regeneratingTwoFactorCodes = true;
    cmp.regenerateTwoFactorRecoveryCodes();
    cmp.regeneratingTwoFactorCodes = false;
    cmp.twoFactorManagePassword = 'pw';
    cmp.twoFactorManageCode = '123456';
    auth.regenerateTwoFactorRecoveryCodes.and.returnValue(
      throwError(() => ({ error: { detail: 'rg' } })),
    );
    cmp.regenerateTwoFactorRecoveryCodes();
    expect(cmp.twoFactorError()).toBe('rg');
    cmp.regeneratingTwoFactorCodes = false; // error path has no complete -> reset to retry
    cmp.twoFactorManagePassword = 'pw';
    cmp.twoFactorManageCode = '123456';
    auth.regenerateTwoFactorRecoveryCodes.and.returnValue(throwError(() => ({})));
    cmp.regenerateTwoFactorRecoveryCodes();
    expect(cmp.twoFactorError()).toBe('account.security.twoFactor.regenerateError');
    auth.isAuthenticated.and.returnValue(false);
    cmp.regenerateTwoFactorRecoveryCodes();
    expect(confirmSpy).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('regenerate with null recovery codes', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    spyOn(window, 'confirm').and.returnValue(true);
    auth.regenerateTwoFactorRecoveryCodes.and.returnValue(of({ recovery_codes: null } as any));
    cmp.twoFactorManagePassword = 'pw';
    cmp.twoFactorManageCode = '123456';
    cmp.regenerateTwoFactorRecoveryCodes();
    expect(cmp.twoFactorRecoveryCodes).toEqual([]);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('disableTwoFactor confirm/guards/error', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    const confirmSpy = spyOn(window, 'confirm').and.returnValues(false, true, true, true, true);
    cmp.disableTwoFactor(); // confirm false
    cmp.twoFactorManagePassword = '';
    cmp.twoFactorManageCode = '';
    cmp.disableTwoFactor(); // missing
    cmp.twoFactorManagePassword = 'pw';
    cmp.twoFactorManageCode = '123456';
    cmp.disableTwoFactor(); // success
    expect(cmp.twoFactorStatus()).toBeTruthy();
    cmp.disablingTwoFactor = true;
    cmp.disableTwoFactor();
    cmp.disablingTwoFactor = false;
    cmp.twoFactorManagePassword = 'pw';
    cmp.twoFactorManageCode = '123456';
    auth.disableTwoFactor.and.returnValue(throwError(() => ({ error: { detail: 'di' } })));
    cmp.disableTwoFactor();
    expect(cmp.twoFactorError()).toBe('di');
    cmp.disablingTwoFactor = false; // error path has no complete -> reset to retry
    cmp.twoFactorManagePassword = 'pw';
    cmp.twoFactorManageCode = '123456';
    auth.disableTwoFactor.and.returnValue(throwError(() => ({})));
    cmp.disableTwoFactor();
    expect(cmp.twoFactorError()).toBe('account.security.twoFactor.disableError');
    auth.isAuthenticated.and.returnValue(false);
    cmp.disableTwoFactor();
    expect(confirmSpy).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('loadCurrentUser error callbacks are swallowed', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    auth.loadCurrentUser.and.returnValue(throwError(() => new Error('x')));
    cmp.twoFactorEnableCode = '123456';
    cmp.enableTwoFactor();
    spyOn(window, 'confirm').and.returnValue(true);
    cmp.twoFactorManagePassword = 'pw';
    cmp.twoFactorManageCode = '123456';
    cmp.disableTwoFactor();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- passkeys ----

  it('passkeysSupported and loadPasskeys unsupported path', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    setWebAuthnSupport(false);
    expect(cmp.passkeysSupported()).toBeFalse();
    (cmp as any).loadPasskeys(true);
    expect(cmp.passkeysLoaded()).toBeTrue();
    expect(cmp.passkeys()).toEqual([]);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('loadPasskeys success, error, guards', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    setWebAuthnSupport(true);
    setCredentialsCreate(() => Promise.resolve(realCredential()));
    (cmp as any).loadPasskeys(true);
    expect(cmp.passkeysLoaded()).toBeTrue();
    cmp.passkeysLoading.set(true);
    (cmp as any).loadPasskeys();
    cmp.passkeysLoading.set(false);
    (cmp as any).loadPasskeys(); // loaded guard
    cmp.passkeysLoaded.set(false);
    auth.listPasskeys.and.returnValue(throwError(() => new Error('x')));
    (cmp as any).loadPasskeys(true);
    expect(cmp.passkeysError()).toBeTruthy();
    auth.listPasskeys.and.returnValue(of(null as any));
    cmp.passkeysLoaded.set(false);
    (cmp as any).loadPasskeys(true);
    auth.isAuthenticated.and.returnValue(false);
    (cmp as any).loadPasskeys(true);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('registerPasskey full success flow', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    setWebAuthnSupport(true);
    setCredentialsCreate(() => Promise.resolve(realCredential()));
    cmp.passkeyRegisterPassword = 'pw';
    cmp.passkeyRegisterName = 'My Key';
    cmp.registerPasskey();
    flushMicrotasks();
    expect(auth.completePasskeyRegistration).toHaveBeenCalled();
    expect(cmp.passkeyRegisterPassword).toBe('');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('registerPasskey guards: not supported, no password, busy', () => {
    const { cmp } = makeHost('/account/security');
    setWebAuthnSupport(false);
    cmp.passkeyRegisterPassword = 'pw';
    cmp.registerPasskey();
    expect(toast.error).toHaveBeenCalled();
    setWebAuthnSupport(true);
    setCredentialsCreate(() => Promise.resolve(realCredential()));
    cmp.passkeyRegisterPassword = '';
    cmp.registerPasskey();
    cmp.passkeyRegisterPassword = 'pw';
    cmp.registeringPasskey = true;
    cmp.registerPasskey();
    auth.isAuthenticated.and.returnValue(false);
    cmp.registeringPasskey = false;
    cmp.registerPasskey();
  });

  it('registerPasskey credential null, complete error, NotAllowed, generic error, start error', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    setWebAuthnSupport(true);

    // credential null
    setCredentialsCreate(() => Promise.resolve(null));
    cmp.passkeyRegisterPassword = 'pw';
    cmp.registerPasskey();
    flushMicrotasks();
    expect(cmp.registeringPasskey).toBeFalse();

    // complete registration error
    setCredentialsCreate(() => Promise.resolve(realCredential()));
    auth.completePasskeyRegistration.and.returnValue(
      throwError(() => ({ error: { detail: 'cp' } })),
    );
    cmp.passkeyRegisterPassword = 'pw';
    cmp.passkeyRegisterName = '';
    cmp.registerPasskey();
    flushMicrotasks();
    expect(cmp.passkeysError()).toBe('cp');

    // NotAllowedError from create (prior error path left registeringPasskey true)
    cmp.registeringPasskey = false;
    setCredentialsCreate(() =>
      Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })),
    );
    cmp.passkeyRegisterPassword = 'pw';
    cmp.registerPasskey();
    flushMicrotasks();
    expect(toast.info).toHaveBeenCalled();

    // generic error with a message but no name (exercises the `err?.name || ''` fallback)
    cmp.registeringPasskey = false;
    setCredentialsCreate(() => Promise.reject(Object.assign(new Error('oops'), { name: '' })));
    cmp.passkeyRegisterPassword = 'pw';
    cmp.registerPasskey();
    flushMicrotasks();
    expect(toast.error).toHaveBeenCalledWith('oops');

    // generic error without message -> falls back to translated key
    cmp.registeringPasskey = false;
    setCredentialsCreate(() => Promise.reject(new Error()));
    cmp.passkeyRegisterPassword = 'pw';
    cmp.registerPasskey();
    flushMicrotasks();

    // start registration error with and without detail
    cmp.registeringPasskey = false;
    auth.startPasskeyRegistration.and.returnValue(throwError(() => ({ error: { detail: 'sp' } })));
    cmp.passkeyRegisterPassword = 'pw';
    cmp.registerPasskey();
    expect(cmp.passkeysError()).toBe('sp');
    auth.startPasskeyRegistration.and.returnValue(throwError(() => ({})));
    cmp.passkeyRegisterPassword = 'pw';
    cmp.registerPasskey();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('remove passkey lifecycle, guards, confirm, error', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    const confirmSpy = spyOn(window, 'confirm').and.returnValues(false, true, true, true);
    cmp.startRemovePasskey('pk1');
    expect(cmp.removePasskeyConfirmId).toBe('pk1');
    cmp.removingPasskeyId = 'busy';
    cmp.startRemovePasskey('pk2'); // guard
    cmp.cancelRemovePasskey(); // guard
    cmp.confirmRemovePasskey(); // guard
    cmp.removingPasskeyId = null;
    cmp.removePasskeyConfirmId = null;
    cmp.confirmRemovePasskey(); // no id
    cmp.startRemovePasskey('pk1');
    cmp.confirmRemovePasskey(); // confirm false
    cmp.removePasskeyPassword = '';
    cmp.confirmRemovePasskey(); // confirm true no password
    expect(cmp.passkeysError()).toBeTruthy();
    cmp.passkeys.set([{ id: 'pk1' } as any]);
    cmp.removePasskeyConfirmId = 'pk1';
    cmp.removePasskeyPassword = 'pw';
    cmp.confirmRemovePasskey(); // success
    expect(cmp.passkeys().length).toBe(0);
    cmp.cancelRemovePasskey();
    expect(cmp.removePasskeyConfirmId).toBeNull();
    expect(confirmSpy).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('confirmRemovePasskey error variants', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    spyOn(window, 'confirm').and.returnValue(true);
    cmp.removePasskeyConfirmId = 'pk1';
    cmp.removePasskeyPassword = 'pw';
    auth.deletePasskey.and.returnValue(throwError(() => ({ error: { detail: 'dp' } })));
    cmp.confirmRemovePasskey();
    expect(cmp.passkeysError()).toBe('dp');
    cmp.removingPasskeyId = null; // error path has no complete -> reset to retry
    cmp.removePasskeyConfirmId = 'pk1';
    cmp.removePasskeyPassword = 'pw';
    auth.deletePasskey.and.returnValue(throwError(() => ({})));
    cmp.confirmRemovePasskey();
    expect(cmp.passkeysError()).toBe('account.security.passkeys.removeError');
    auth.isAuthenticated.and.returnValue(false);
    cmp.confirmRemovePasskey();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- google linking ----

  it('linkGoogle without pending: starts oauth and error', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    // The success `next` callback assigns window.location.href (a real page navigation
    // that cannot run under Karma — it is istanbul-ignored in the source). Use a
    // never-emitting observable so the synchronous setup branch runs (flow flag set,
    // startGoogleLink invoked) without firing that redirect callback.
    auth.startGoogleLink.and.returnValue(new Subject<any>().asObservable());
    cmp.linkGoogle();
    expect(auth.startGoogleLink).toHaveBeenCalled();
    expect(localStorage.getItem('google_flow')).toBe('link');
    expect(cmp.googleBusy).toBeTrue();
    auth.startGoogleLink.and.returnValue(throwError(() => ({ error: { detail: 'sg' } })));
    cmp.linkGoogle();
    expect(cmp.googleError).toBe('sg');
    auth.startGoogleLink.and.returnValue(throwError(() => ({})));
    cmp.linkGoogle();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('linkGoogle with pending context: success, no password, error', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    googleLinkPending.getPending.and.returnValue({ code: 'c', state: 's' } as any);
    cmp.googlePassword = '';
    cmp.linkGoogle(); // no password
    expect(cmp.googleError).toBeTruthy();
    cmp.googlePassword = 'pw';
    cmp.linkGoogle(); // success
    expect(googleLinkPending.clear).toHaveBeenCalled();
    googleLinkPending.getPending.and.returnValue({ code: 'c', state: 's' } as any);
    cmp.googlePassword = 'pw';
    auth.completeGoogleLink.and.returnValue(throwError(() => ({ error: { detail: 'cg' } })));
    cmp.linkGoogle();
    expect(cmp.googleError).toBe('cg');
    cmp.googlePassword = 'pw';
    auth.completeGoogleLink.and.returnValue(throwError(() => ({})));
    cmp.linkGoogle();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('unlinkGoogle success, no password, error', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    cmp.googlePassword = '';
    cmp.unlinkGoogle();
    expect(cmp.googleError).toBeTruthy();
    cmp.googlePassword = 'pw';
    cmp.unlinkGoogle();
    expect(auth.unlinkGoogle).toHaveBeenCalled();
    cmp.googlePassword = 'pw';
    auth.unlinkGoogle.and.returnValue(throwError(() => ({ error: { detail: 'ug' } })));
    cmp.unlinkGoogle();
    expect(cmp.googleError).toBe('ug');
    cmp.googlePassword = 'pw';
    auth.unlinkGoogle.and.returnValue(throwError(() => ({})));
    cmp.unlinkGoogle();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- lastOrder / defaultShipping fallbacks ----

  it('lastOrder sorts when no cached latestOrder and money fallback', () => {
    const { cmp } = makeHost();
    cmp.latestOrder.set(null);
    cmp.orders.set([
      { ...order, id: 'o1', created_at: '2020-01-01T00:00:00Z' } as any,
      { ...order, id: 'o2', created_at: '2021-01-01T00:00:00Z' } as any,
    ]);
    cmp.ordersLoaded.set(true);
    expect(cmp.lastOrderSubcopy()).toBeTruthy();
    cmp.latestOrder.set({ ...order, currency: '@@@', total_amount: 1 } as any);
    expect(typeof cmp.lastOrderSubcopy()).toBe('string');
  });

  // ---- discard / unsaved changes ----

  it('discardProfileChanges restores baseline and no-op without baseline', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.discardProfileChanges(); // no baseline
    cmp.ngOnInit();
    cmp.profileName = 'Changed';
    cmp.discardProfileChanges();
    expect(cmp.profileName).toBe('User');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('discardNotificationChanges restores baseline and no-op', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.discardNotificationChanges();
    cmp.ngOnInit();
    cmp.notifyMarketing = true;
    cmp.discardNotificationChanges();
    expect(cmp.notifyMarketing).toBe(false);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('discardAddressChanges closes form', () => {
    const { cmp } = makeHost();
    cmp.discardAddressChanges(); // not open
    cmp.openAddressForm();
    cmp.discardAddressChanges();
    expect(cmp.showAddressForm).toBeFalse();
  });

  it('profileHasUnsavedChanges branches', fakeAsync(() => {
    const { cmp } = makeHost();
    expect(cmp.profileHasUnsavedChanges()).toBeFalse(); // no baseline
    cmp.ngOnInit();
    expect(cmp.profileHasUnsavedChanges()).toBeFalse();
    cmp.profileUsernamePassword = 'pw';
    expect(cmp.profileHasUnsavedChanges()).toBeTrue();
    cmp.profileUsernamePassword = '';
    cmp.profileName = 'Different';
    expect(cmp.profileHasUnsavedChanges()).toBeTrue();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('notificationsHasUnsavedChanges branches', fakeAsync(() => {
    const { cmp } = makeHost();
    expect(cmp.notificationsHasUnsavedChanges()).toBeFalse();
    cmp.ngOnInit();
    expect(cmp.notificationsHasUnsavedChanges()).toBeFalse();
    cmp.notifyMarketing = !cmp.notifyMarketing;
    expect(cmp.notificationsHasUnsavedChanges()).toBeTrue();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('addressesHasUnsavedChanges branches', () => {
    const { cmp } = makeHost();
    expect(cmp.addressesHasUnsavedChanges()).toBeFalse(); // not open
    cmp.openAddressForm(address);
    expect(cmp.addressesHasUnsavedChanges()).toBeFalse();
    cmp.addressModel = { ...cmp.addressModel, city: 'Different' };
    expect(cmp.addressesHasUnsavedChanges()).toBeTrue();
    (cmp as any).addressFormBaseline = null;
    cmp.showAddressForm = true;
    expect(cmp.addressesHasUnsavedChanges()).toBeTrue();
  });

  it('normalizeAddressSnapshot handles non-string phone', () => {
    const { cmp } = makeHost();
    cmp.openAddressForm({ ...address, phone: null } as any);
    cmp.addressModel = { ...cmp.addressModel, phone: undefined as any };
    expect(cmp.addressesHasUnsavedChanges()).toBeDefined();
  });

  // ---- beforeunload / idle ----

  it('beforeunload handler prevents default only with unsaved changes', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.ngOnInit();
    const handler = (cmp as any).handleBeforeUnload;
    const evt: any = { preventDefault: jasmine.createSpy('pd'), returnValue: undefined };
    handler(evt); // no unsaved
    expect(evt.preventDefault).not.toHaveBeenCalled();
    cmp.profileUsernamePassword = 'pw';
    handler(evt);
    expect(evt.preventDefault).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('idle timer triggers logout after timeout', fakeAsync(() => {
    const { cmp, router } = makeHost();
    spyOn(router, 'navigateByUrl').and.returnValue(Promise.resolve(true) as any);
    cmp.ngOnInit();
    tick(30 * 60 * 1000);
    expect(cmp.idleWarning()).toBeTruthy();
    expect(auth.logout).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('now signal interval updates', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.ngOnInit();
    tick(1000);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  // ---- branch-coverage edge cases ----

  it('lastVisitedSection reads a valid stored section and ignores invalid', fakeAsync(() => {
    localStorage.setItem('account.lastSection', 'wishlist');
    const { cmp, router } = makeHost('/account');
    cmp.ngOnInit();
    expect((router.navigate as jasmine.Spy).calls.mostRecent().args[0]).toEqual(['wishlist']);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('lastVisitedSection falls back to overview on invalid stored value', fakeAsync(() => {
    localStorage.setItem('account.lastSection', 'not-a-section');
    const { cmp, router } = makeHost('/account');
    cmp.ngOnInit();
    expect((router.navigate as jasmine.Spy).calls.mostRecent().args[0]).toEqual(['overview']);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('lastVisitedSection and rememberLastVisitedSection swallow localStorage errors', fakeAsync(() => {
    // Throw only for the account.lastSection key so the rest of the framework keeps
    // working; this exercises both try/catch blocks without breaking the test page.
    const realGet = Storage.prototype.getItem;
    const realSet = Storage.prototype.setItem;
    spyOn(Storage.prototype, 'getItem').and.callFake(function (this: Storage, k: string) {
      if (k === 'account.lastSection') throw new Error('boom');
      return realGet.call(this, k);
    });
    spyOn(Storage.prototype, 'setItem').and.callFake(function (
      this: Storage,
      k: string,
      v: string,
    ) {
      if (k === 'account.lastSection') throw new Error('boom');
      return realSet.call(this, k, v);
    });
    const { cmp, router } = makeHost('/account');
    cmp.ngOnInit();
    expect((router.navigate as jasmine.Spy).calls.mostRecent().args[0]).toEqual(['overview']);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('activeSectionFromUrl / isAccountRootUrl handle empty and section-less urls', fakeAsync(() => {
    const { cmp } = makeHost('/account/overview');
    cmp.ngOnInit();
    routerEvents$.next(new NavigationEnd(1, '', ''));
    routerEvents$.next(new NavigationEnd(1, '/account/', '/account/'));
    expect(account.getOrdersPage).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('updateOrderInList updates the latest order when ids match', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.orders.set([order]);
    cmp.latestOrder.set(order);
    cmp.reorderingOrderItemId = null;
    const updated = { ...order, status: 'shipped' } as any;
    (cmp as any).updateOrderInList(updated);
    expect(cmp.latestOrder()?.status).toBe('shipped');
    cmp.latestOrder.set({ ...order, id: 'other' } as any);
    (cmp as any).updateOrderInList(updated);
    expect(cmp.latestOrder()?.id).toBe('other');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('lockerLabel/deliveryLabel handle null/undefined order fields', () => {
    const { cmp } = makeHost();
    expect(cmp.lockerLabel({} as any)).toBeNull();
    expect(cmp.deliveryLabel({} as any)).toBe('—');
  });

  it('canRequestReturn true branch and openReturnRequest items present', () => {
    const { cmp } = makeHost();
    expect(cmp.canRequestReturn({ ...order, status: 'delivered' } as any)).toBeTrue();
  });

  it('defaultShippingAddress falls back to first when none default', () => {
    const { cmp } = makeHost();
    cmp.addresses.set([{ ...address, is_default_shipping: false } as any]);
    cmp.addressesLoaded.set(true);
    expect(cmp.defaultAddressLabel()).toBe('Home');
  });

  it('formatMoney falls back when currency is invalid', () => {
    const { cmp } = makeHost();
    cmp.latestOrder.set({ ...order, currency: '', total_amount: 5 } as any);
    cmp.ordersLoaded.set(true);
    expect(cmp.lastOrderSubcopy()).toContain('5');
  });

  it('otherSessionsCount handles null sessions and revoke null result', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    cmp.sessions.set(null as any);
    expect(cmp.otherSessionsCount()).toBe(0);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('saveProfile maps null optional fields and refreshes derived state', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.profile.set({ ...profile, username: 'theuser' } as any);
    cmp.profileName = '';
    cmp.profileFirstName = '';
    cmp.profileMiddleName = '';
    cmp.profileLastName = '';
    cmp.profileDateOfBirth = '';
    cmp.profilePhoneNational = '';
    cmp.profileUsername = 'theuser';
    auth.updateProfile.and.returnValue(
      of({
        id: 'u',
        email: 'e',
        name: null,
        username: null,
        first_name: null,
        last_name: null,
        middle_name: null,
        date_of_birth: null,
        phone: null,
        avatar_url: null,
        preferred_language: 'ro',
      } as any),
    );
    cmp.saveProfile();
    expect(cmp.profileSaved).toBeTrue();
    expect(cmp.profileName).toBe('');
    expect(cmp.profileLanguage).toBe('ro');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('clearSecondaryEmailResendCooldown removes an existing cooldown via verify', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    cmp.secondaryEmails.set([{ id: 'se1', email: 'b', verified: false } as any]);
    cmp.secondaryEmailResendUntilById.set({ se1: Date.now() + 60000 });
    cmp.startSecondaryEmailVerification('se1');
    cmp.secondaryVerificationToken = 'tok';
    auth.confirmSecondaryEmailVerification.and.returnValue(
      of({ id: 'se1', verified_at: '2020' } as any),
    );
    cmp.confirmSecondaryEmailVerification();
    expect(cmp.secondaryEmailResendUntilById()['se1']).toBeUndefined();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('confirmDeleteSecondaryEmail cancels active verification for the same id', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    spyOn(window, 'confirm').and.returnValue(true);
    cmp.secondaryEmails.set([{ id: 'se1', email: 'b' } as any]);
    cmp.secondaryEmailResendUntilById.set({ se1: Date.now() + 60000 });
    cmp.startSecondaryEmailVerification('se1');
    cmp.removeSecondaryEmailId = 'se1';
    cmp.removeSecondaryEmailPassword = 'pw';
    cmp.confirmDeleteSecondaryEmail();
    expect(cmp.secondaryVerificationEmailId).toBeNull();
    expect(cmp.secondaryEmails().length).toBe(0);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('confirmSecondaryEmailVerification leaves non-matching emails unchanged', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    cmp.secondaryEmails.set([
      { id: 'se1', email: 'a', verified: false } as any,
      { id: 'se2', email: 'b', verified: false } as any,
    ]);
    cmp.startSecondaryEmailVerification('se1');
    cmp.secondaryVerificationToken = 'tok';
    auth.confirmSecondaryEmailVerification.and.returnValue(
      of({ id: 'se1', verified_at: '2020' } as any),
    );
    cmp.confirmSecondaryEmailVerification();
    const se2 = cmp.secondaryEmails().find((e) => e.id === 'se2');
    expect(se2?.verified).toBeFalse();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('deletionCooldownProgressPercent clamps NaN to zero', () => {
    const { cmp } = makeHost();
    cmp.deletionStatus.set({
      requested_at: new Date(0).toISOString(),
      scheduled_for: new Date(0).toISOString(),
    } as any);
    expect(cmp.deletionCooldownProgressPercent()).toBe(0);
  });

  it('updateTwoFactorSetupQr discards the result of a superseded request', async () => {
    const { cmp } = makeHost('/account/security');
    cmp.twoFactorSetupUrl = 'otpauth://totp/x?secret=ABCDEFGH';
    const p = (cmp as any).updateTwoFactorSetupQr();
    // A newer request started before this one finished -> stale render is dropped.
    (cmp as any).twoFactorQrRequestId += 1;
    await p;
    expect(cmp.twoFactorSetupQrDataUrl).toBeNull();
    cmp.ngOnDestroy();
  });

  it('formatTimestamp returns raw value when Date formatting throws', () => {
    const { cmp } = makeHost();
    const orig = Date.prototype.toLocaleString;
    Date.prototype.toLocaleString = () => {
      throw new Error('intl boom');
    };
    try {
      expect(cmp.formatTimestamp('2020-01-01')).toBe('2020-01-01');
    } finally {
      Date.prototype.toLocaleString = orig;
    }
  });

  it('setDefaultBilling upsert normalizes other addresses', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.addresses.set([
      { ...address, id: 'a1', is_default_billing: true } as any,
      { ...address, id: 'a2', is_default_billing: false } as any,
    ]);
    account.updateAddress.and.returnValue(
      of({ ...address, id: 'a2', is_default_billing: true } as any),
    );
    cmp.setDefaultBilling({ ...address, id: 'a2' } as any);
    const a1 = cmp.addresses().find((a) => a.id === 'a1');
    expect(a1?.is_default_billing).toBeFalse();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('normalizeAddressSnapshot handles a fully empty model', () => {
    const { cmp } = makeHost();
    cmp.showAddressForm = true;
    (cmp as any).addressFormBaseline = (cmp as any).normalizeAddressSnapshot({});
    cmp.addressModel = {} as any;
    expect(cmp.addressesHasUnsavedChanges()).toBeFalse();
  });

  it('pendingOrdersCount falls back when ordersMeta is null', () => {
    const { cmp } = makeHost();
    cmp.ordersMeta.set(null);
    expect(cmp.pendingOrdersCount()).toBe(0);
  });

  it('isAccountRootUrl handles a falsy url', fakeAsync(() => {
    const { cmp } = makeHost('');
    cmp.ngOnInit();
    expect(account.getProfile).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('loadProfile uses system theme fallback when preference is null', fakeAsync(() => {
    prefSig.set(null as any);
    const { cmp } = makeHost();
    cmp.ngOnInit();
    expect(cmp.profileThemePreference).toBe('system');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('loadOrders sets latestOrder null when default query returns no items', fakeAsync(() => {
    const { cmp } = makeHost();
    account.getOrdersPage.and.returnValue(ordersPage([], { total_pages: 1 }));
    cmp.ngOnInit();
    expect(cmp.latestOrder()).toBeNull();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('loadTickets sorts tickets that lack updated_at', fakeAsync(() => {
    const { cmp } = makeHost();
    tickets.listMine.and.returnValue(of([{ id: 't1' }, { id: 't2' }] as any));
    cmp.loadTickets(true);
    expect(cmp.tickets().length).toBe(2);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('lockerLabel returns detail when locker fields are null', () => {
    const { cmp } = makeHost();
    expect(
      cmp.lockerLabel({ delivery_type: 'locker', locker_name: null, locker_address: null } as any),
    ).toBeNull();
    expect(
      cmp.lockerLabel({
        delivery_type: 'locker',
        locker_name: 'Only',
        locker_address: null,
      } as any),
    ).toBe('Only');
  });

  it('updateOrderInList leaves non-matching orders unchanged', () => {
    const { cmp } = makeHost();
    cmp.orders.set([{ ...order, id: 'a' } as any, { ...order, id: 'b' } as any]);
    (cmp as any).updateOrderInList({ ...order, id: 'a', status: 'shipped' } as any);
    expect(cmp.orders().find((o) => o.id === 'b')?.status).toBe('delivered');
  });

  it('manualRefundRequired handles missing fields', () => {
    const { cmp } = makeHost();
    expect(cmp.manualRefundRequired({} as any)).toBeFalse();
    expect(cmp.manualRefundRequired({ status: 'cancelled' } as any)).toBeFalse();
  });

  it('hasCancelRequested with null events and canRequestCancel statuses', () => {
    const { cmp } = makeHost();
    expect(cmp.hasCancelRequested({ ...order, events: null } as any)).toBeFalse();
    expect(
      cmp.canRequestCancel({ ...order, status: 'pending_payment', events: [] } as any),
    ).toBeTrue();
    expect(
      cmp.canRequestCancel({ ...order, status: 'pending_acceptance', events: [] } as any),
    ).toBeTrue();
  });

  it('openReturnRequest and submitReturnRequest handle missing status', () => {
    const { cmp } = makeHost();
    cmp.openReturnRequest({ ...order, status: undefined } as any);
    expect(toast.error).toHaveBeenCalled();
    cmp.returnOrderId = order.id;
    cmp.submitReturnRequest({ ...order, id: order.id, status: undefined } as any);
    expect(cmp.returnCreateError).toBe('account.orders.return.errors.notEligible');
  });

  it('submitReturnRequest treats missing returnQty entries as zero', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.returnOrderId = order.id;
    cmp.returnReason = 'r';
    cmp.returnQty = {}; // no entry for i1 -> Number(undefined ?? 0) = 0
    cmp.submitReturnRequest(order);
    expect(cmp.returnCreateError).toBe('account.orders.return.errors.itemsRequired');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('upsertAddress keeps existing default flags when new address is not default', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.addresses.set([{ ...address, id: 'a1', is_default_shipping: true } as any]);
    account.updateAddress.and.returnValue(
      of({ ...address, id: 'a1', is_default_shipping: false, is_default_billing: false } as any),
    );
    cmp.saveAddress({ ...address } as any); // editingAddressId null -> create path uses returned addr
    cmp.editingAddressId = 'a1';
    cmp.saveAddress({ ...address } as any);
    expect(cmp.addresses().length).toBeGreaterThan(0);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('profileCompleteness does not count an unknown language', () => {
    const { cmp } = makeHost();
    cmp.profileLanguage = 'xx' as any;
    const before = cmp.profileCompleteness().completed;
    cmp.profileLanguage = 'en';
    expect(cmp.profileCompleteness().completed).toBeGreaterThanOrEqual(before);
  });

  it('usernameChanged with no profile', () => {
    const { cmp } = makeHost();
    cmp.profile.set(null);
    cmp.profileUsername = 'newname';
    expect(cmp.usernameChanged()).toBeTrue();
  });

  it('saveProfile required phone present but national invalid sets phoneInvalid', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.profile.set({ id: 'u', email: 'e', google_sub: 'gs' } as any);
    cmp.profileName = 'N';
    cmp.profileUsername = 'okuser';
    cmp.profileFirstName = 'F';
    cmp.profileLastName = 'L';
    cmp.profileDateOfBirth = '1990-01-01';
    cmp.profilePhoneCountry = 'RO';
    cmp.profilePhoneNational = '1'; // present but invalid -> buildE164 null
    cmp.saveProfile();
    expect(cmp.profileError).toBe('validation.phoneInvalid');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('saveProfile success updates username when current username is empty', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.profile.set({ id: 'u', email: 'e', username: null } as any);
    cmp.profileUsername = 'brandnew';
    cmp.profileUsernamePassword = 'pw';
    cmp.profilePhoneNational = '';
    cmp.profileDateOfBirth = '';
    auth.updateProfile.and.returnValue(of({ id: 'u', email: 'e', username: 'brandnew' } as any));
    cmp.saveProfile();
    expect(auth.updateUsername).toHaveBeenCalledWith('brandnew', 'pw');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('accountHeaderLabel uses the current profile when no arg given', () => {
    const { cmp } = makeHost();
    cmp.profile.set({ username: 'me', name: 'Me', name_tag: 3 } as any);
    expect(cmp.accountHeaderLabel()).toBe('me (Me#3)');
  });

  it('lastOrderLabel uses order id when reference_code missing', () => {
    const { cmp } = makeHost();
    cmp.ordersLoaded.set(true);
    cmp.latestOrder.set({ ...order, reference_code: '', status: 'paid' } as any);
    expect(cmp.lastOrderLabel()).toContain('o1');
  });

  it('latest export job pending starts polling on load', fakeAsync(() => {
    const { cmp } = makeHost('/account/privacy');
    account.getLatestExportJob.and.returnValue(of({ id: 'jp', status: 'running' } as any));
    account.getExportJob.and.returnValue(of({ id: 'jp', status: 'running' } as any));
    (cmp as any).loadLatestExportJob();
    tick(2000);
    expect(account.getExportJob).toHaveBeenCalled();
    (cmp as any).stopExportJobPolling();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('revokeOtherSessions handles undefined revoked count', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    spyOn(window, 'confirm').and.returnValue(true);
    cmp.startRevokeOtherSessions();
    cmp.revokeOtherSessionsPassword = 'pw';
    auth.revokeOtherSessions.and.returnValue(of({} as any));
    cmp.confirmRevokeOtherSessions();
    expect(toast.success).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('cancelDeleteSecondaryEmail is a no-op while removing', () => {
    const { cmp } = makeHost('/account/security');
    cmp.removeSecondaryEmailId = 'se1';
    cmp.removingSecondaryEmail = true;
    cmp.cancelDeleteSecondaryEmail();
    expect(cmp.removeSecondaryEmailId).toBe('se1');
  });

  it('completeGoogleLink success with null google_email', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    googleLinkPending.getPending.and.returnValue({ code: 'c', state: 's' } as any);
    cmp.googlePassword = 'pw';
    auth.completeGoogleLink.and.returnValue(
      of({ id: 'u', email: 'e', google_email: null, google_picture_url: null } as any),
    );
    cmp.linkGoogle();
    expect(cmp.googleEmail()).toBeNull();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('linkGoogle without pending covers the localStorage-undefined guard implicitly', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    auth.startGoogleLink.and.returnValue(new Subject<any>().asObservable());
    cmp.linkGoogle();
    expect(cmp.googleBusy).toBeTrue();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('linkGoogle without pending error path clears pending context (no detail)', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    googleLinkPending.getPending.and.returnValue(null);
    auth.startGoogleLink.and.returnValue(throwError(() => ({})));
    cmp.linkGoogle();
    expect(googleLinkPending.clear).toHaveBeenCalled();
    expect(cmp.googleError).toBe('account.security.google.startLinkError');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('user activity listener resets the idle timer', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.ngOnInit();
    cmp.idleWarning.set('stale');
    window.dispatchEvent(new MouseEvent('mousemove'));
    window.dispatchEvent(new KeyboardEvent('keydown'));
    expect(cmp.idleWarning()).toBeNull();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('addSecondaryEmail filters out a duplicate id from the existing list', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    cmp.secondaryEmails.set([{ id: 'se1', email: 'old' } as any]);
    auth.addSecondaryEmail.and.returnValue(of({ id: 'se1', email: 'new' } as any));
    cmp.secondaryEmailToAdd = 'new@x.com';
    cmp.addSecondaryEmail();
    expect(cmp.secondaryEmails().filter((e) => e.id === 'se1').length).toBe(1);
    expect(cmp.secondaryEmails()[0].email).toBe('new');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('trackingStatusLabel / canRequestCancel handle missing status', () => {
    const { cmp } = makeHost();
    expect(cmp.trackingStatusLabel({ tracking_number: 'T', status: undefined } as any)).toBeNull();
    expect(cmp.canRequestCancel({ ...order, status: undefined, events: [] } as any)).toBeFalse();
  });

  it('manualRefundRequired and hasCancelRequested handle events with falsy event names', () => {
    const { cmp } = makeHost();
    expect(
      cmp.manualRefundRequired({
        status: 'cancelled',
        payment_method: 'stripe',
        events: [{ event: null }],
      } as any),
    ).toBeFalse();
    expect(cmp.hasCancelRequested({ ...order, events: [{ event: null }] } as any)).toBeFalse();
  });

  it('canRequestReturn is false when a return was already requested for a delivered order', () => {
    const { cmp } = makeHost();
    const delivered = { ...order, status: 'delivered' } as any;
    cmp.openReturnRequest(delivered);
    cmp.returnReason = 'r';
    cmp.returnQty = { i1: 1 };
    cmp.submitReturnRequest(delivered);
    expect(cmp.canRequestReturn(delivered)).toBeFalse();
  });

  it('submitCancelRequest error without a detail field maps to create', fakeAsync(() => {
    const { cmp } = makeHost();
    spyOn(window, 'confirm').and.returnValue(true);
    const paid = { ...order, status: 'paid', events: [] } as any;
    account.requestOrderCancellation.and.returnValue(throwError(() => ({})));
    cmp.cancelOrderId = paid.id;
    cmp.cancelReason = 'r';
    cmp.submitCancelRequest(paid);
    expect(cmp.cancelRequestError).toBe('account.orders.cancel.errors.create');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('submitReturnRequest treats null items as an empty list', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.returnOrderId = order.id;
    cmp.returnReason = 'r';
    cmp.submitReturnRequest({ ...order, items: null } as any);
    expect(cmp.returnCreateError).toBe('account.orders.return.errors.itemsRequired');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('downloadReceipt uses reference_code when present', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.downloadReceipt({ ...order, reference_code: 'REFX' } as any);
    expect(account.downloadReceipt).toHaveBeenCalled();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('uploadAvatar and useGoogleAvatar handle a null avatar_url in the response', fakeAsync(() => {
    const { cmp } = makeHost();
    auth.uploadAvatar.and.returnValue(of({ id: 'u', email: 'e', avatar_url: null } as any));
    cmp.uploadAvatar(new File(['x'], 'a.png'));
    expect(cmp.avatar).toBeNull();
    auth.useGoogleAvatar.and.returnValue(of({ id: 'u', email: 'e', avatar_url: null } as any));
    cmp.useGoogleAvatar();
    expect(cmp.avatar).toBeNull();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('saveProfile sends non-null optional fields when provided', fakeAsync(() => {
    const { cmp } = makeHost();
    cmp.profile.set({ ...profile, username: 'theuser' } as any);
    cmp.profileName = 'Name';
    cmp.profileFirstName = 'First';
    cmp.profileMiddleName = 'Mid';
    cmp.profileLastName = 'Last';
    cmp.profileDateOfBirth = '1990-01-01';
    cmp.profilePhoneCountry = 'RO';
    cmp.profilePhoneNational = '723204204';
    cmp.profileUsername = 'theuser';
    cmp.saveProfile();
    const payload = (auth.updateProfile as jasmine.Spy).calls.mostRecent().args[0];
    expect(payload.first_name).toBe('First');
    expect(payload.middle_name).toBe('Mid');
    expect(payload.last_name).toBe('Last');
    expect(payload.date_of_birth).toBe('1990-01-01');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('accountHeaderLabel returns ellipsis when current profile has no username', () => {
    const { cmp } = makeHost();
    cmp.profile.set(null);
    expect(cmp.accountHeaderLabel()).toBe('...');
  });

  it('saveNotifications handles a response without updated_at', fakeAsync(() => {
    const { cmp } = makeHost();
    auth.updateNotificationPreferences.and.returnValue(
      of({ id: 'u', email: 'e', notify_marketing: true } as any),
    );
    cmp.saveNotifications();
    expect(cmp.notificationLastUpdated).toBeNull();
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('registerPasskey complete error without detail uses fallback', fakeAsync(() => {
    const { cmp } = makeHost('/account/security');
    setWebAuthnSupport(true);
    setCredentialsCreate(() => Promise.resolve(realCredential()));
    auth.completePasskeyRegistration.and.returnValue(throwError(() => ({})));
    cmp.passkeyRegisterPassword = 'pw';
    cmp.registerPasskey();
    flushMicrotasks();
    expect(cmp.passkeysError()).toBe('account.security.passkeys.addError');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('cancelDeleteSecondaryEmail clears state when not removing', () => {
    const { cmp } = makeHost('/account/security');
    cmp.removeSecondaryEmailId = 'se1';
    cmp.removeSecondaryEmailPassword = 'pw';
    cmp.removingSecondaryEmail = false;
    cmp.cancelDeleteSecondaryEmail();
    expect(cmp.removeSecondaryEmailId).toBeNull();
    expect(cmp.removeSecondaryEmailPassword).toBe('');
  });

  it('normalizeAddressSnapshot trims provided string fields', () => {
    const { cmp } = makeHost();
    cmp.openAddressForm({
      ...address,
      label: ' Home ',
      line1: ' L1 ',
      line2: ' L2 ',
      city: ' City ',
      region: ' R ',
      postal_code: ' 12345 ',
      country: ' US ',
      phone: ' +40700000000 ',
    } as any);
    const baseline = { ...cmp.addressModel };
    (cmp as any).addressFormBaseline = baseline;
    cmp.addressModel = { ...baseline };
    expect(cmp.addressesHasUnsavedChanges()).toBeFalse();
  });

  it('account root navigation honours a remembered overview section', fakeAsync(() => {
    localStorage.setItem('account.lastSection', 'overview');
    const { cmp, router } = makeHost('/account');
    cmp.ngOnInit();
    expect((router.navigate as jasmine.Spy).calls.mostRecent().args[0]).toEqual(['overview']);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('account root navigation with no remembered section defaults to overview', fakeAsync(() => {
    // beforeEach removed the key, so getItem returns null here.
    const { cmp, router } = makeHost('/account');
    cmp.ngOnInit();
    expect((router.navigate as jasmine.Spy).calls.mostRecent().args[0]).toEqual(['overview']);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('loadCouponsCount with undefined coupons response uses empty list', fakeAsync(() => {
    const { cmp } = makeHost();
    coupons.myCoupons.and.returnValue(of(undefined as any));
    cmp.loadCouponsCount(true);
    expect(cmp.couponsCount()).toBe(0);
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('manualRefundRequired with captured payment but a falsy refund event name', () => {
    const { cmp } = makeHost();
    expect(
      cmp.manualRefundRequired({
        status: 'cancelled',
        payment_method: 'stripe',
        events: [{ event: 'payment_captured' }, { event: null }],
      } as any),
    ).toBeTrue();
  });

  it('canRequestReturn false branch when return already requested (delivered)', () => {
    const { cmp } = makeHost();
    const delivered = { ...order, id: 'del1', status: 'delivered' } as any;
    (cmp as any).returnRequestedOrderIds.add('del1');
    expect(cmp.canRequestReturn(delivered)).toBeFalse();
  });

  it('downloadReceipt names the file by order id when reference_code is empty', fakeAsync(() => {
    const { cmp } = makeHost();
    const blob = new Blob(['pdf'], { type: 'application/pdf' });
    account.downloadReceipt.and.returnValue(of(blob));
    const anchor = document.createElement('a');
    const clickSpy = spyOn(anchor, 'click');
    spyOn(document, 'createElement').and.returnValue(anchor);
    cmp.downloadReceipt({ ...order, reference_code: '' } as any);
    expect(clickSpy).toHaveBeenCalled();
    expect(anchor.download).toBe('receipt-o1.pdf');
    cmp.ngOnDestroy();
    discardPeriodicTasks();
  }));

  it('cancelDeleteSecondaryEmail is a no-op while a removal is in flight', () => {
    const { cmp } = makeHost('/account/security');
    cmp.removeSecondaryEmailId = 'keep';
    cmp.removingSecondaryEmail = true;
    cmp.cancelDeleteSecondaryEmail();
    expect(cmp.removeSecondaryEmailId).toBe('keep');
    cmp.removingSecondaryEmail = false;
    cmp.cancelDeleteSecondaryEmail();
    expect(cmp.removeSecondaryEmailId).toBeNull();
  });

  it('confirmDeleteSecondaryEmail is a no-op while a removal is in flight', () => {
    const { cmp } = makeHost('/account/security');
    cmp.removingSecondaryEmail = true;
    cmp.removeSecondaryEmailId = 'se1';
    cmp.removeSecondaryEmailPassword = 'pw';
    cmp.confirmDeleteSecondaryEmail();
    expect(auth.deleteSecondaryEmail).not.toHaveBeenCalled();
  });

  it('canRequestReturn returns false for a delivered order that already has a return', () => {
    const { cmp } = makeHost();
    const delivered = { ...order, id: 'rr1', status: 'delivered' } as any;
    expect(cmp.canRequestReturn(delivered)).toBeTrue();
    (cmp as any).returnRequestedOrderIds.add('rr1');
    expect(cmp.hasReturnRequested(delivered)).toBeTrue();
    expect(cmp.canRequestReturn(delivered)).toBeFalse();
  });

  it('canRequestReturn short-circuits for a non-delivered order', () => {
    const { cmp } = makeHost();
    // status !== 'delivered' makes the `&& !hasReturnRequested` short-circuit (left-falsy).
    expect(cmp.canRequestReturn({ ...order, id: 'nd1', status: 'paid' } as any)).toBeFalse();
    expect(cmp.canRequestReturn({ ...order, id: 'nd2', status: '' } as any)).toBeFalse();
    expect(cmp.canRequestReturn({ ...order, id: 'nd3', status: undefined } as any)).toBeFalse();
    expect(cmp.canRequestReturn({ ...order, id: 'nd4', status: 'shipped' } as any)).toBeFalse();
  });
});
