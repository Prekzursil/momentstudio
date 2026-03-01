import { of, throwError } from 'rxjs';

import { HeaderComponent } from './header.component';

type SignalLike<T> = (() => T) & { set: (next: T) => void };

function makeSignal<T>(initial: T): SignalLike<T> {
  let value = initial;
  const fn = (() => value) as SignalLike<T>;
  fn.set = (next: T) => {
    value = next;
  };
  return fn;
}

function createHarness() {
  const router = jasmine.createSpyObj('Router', ['navigate', 'navigateByUrl']);
  router.navigate.and.returnValue(Promise.resolve(true));
  router.navigateByUrl.and.returnValue(Promise.resolve(true));
  router.url = '/admin/dashboard';

  const auth = jasmine.createSpyObj('AuthService', [
    'isAuthenticated',
    'user',
    'isStaff',
    'isAdmin',
    'isImpersonating',
    'checkAdminAccess',
    'logout'
  ]);
  auth.isAuthenticated.and.returnValue(true);
  auth.user.and.returnValue({ id: 'u-1', username: 'owner' });
  auth.isStaff.and.returnValue(true);
  auth.isAdmin.and.returnValue(true);
  auth.isImpersonating.and.returnValue(false);
  auth.checkAdminAccess.and.returnValue(of({}));
  auth.logout.and.returnValue(of({}));

  const notificationsService = jasmine.createSpyObj('NotificationsService', [
    'items',
    'loading',
    'unreadCount',
    'load',
    'markRead',
    'dismiss',
    'reset',
    'refreshUnreadCount'
  ]);
  notificationsService.items.and.returnValue([]);
  notificationsService.loading.and.returnValue(false);
  notificationsService.unreadCount.and.returnValue(3);

  const ops = jasmine.createSpyObj('OpsService', ['getActiveBanner']);
  ops.getActiveBanner.and.returnValue(
    of({
      level: 'warning',
      message_ro: 'Atentie',
      message_en: 'Warning',
      link_url: '/status',
      link_label_ro: 'Detalii',
      link_label_en: 'Details'
    } as any)
  );

  const storefrontAdminMode = {
    enabled: jasmine.createSpy('enabled').and.returnValue(false),
    setEnabled: jasmine.createSpy('setEnabled')
  };

  const navSource = {
    get: jasmine.createSpy('get').and.returnValue(
      of({
        headerLinks: [
          { label: { en: 'Shop', ro: 'Magazin' }, url: '/shop' },
          { label: { en: 'Blog', ro: 'Blog' }, url: 'https://momentstudio.example/blog' }
        ]
      } as any)
    )
  };

  const cmp: any = Object.create(HeaderComponent.prototype);
  cmp.isBrowser = true;
  cmp.themeChange = { emit: jasmine.createSpy('emit') };
  cmp.languageChange = { emit: jasmine.createSpy('emit') };
  cmp.languageSig = makeSignal<'en' | 'ro'>('en');
  cmp.banner = makeSignal<any>(null);
  cmp.cmsNavigation = makeSignal<any>(null);
  cmp.unreadCount = () => notificationsService.unreadCount();
  cmp.storefrontEditMode = storefrontAdminMode.enabled;
  cmp.notificationsService = notificationsService;
  cmp.auth = auth;
  cmp.router = router;
  cmp.ops = ops;
  cmp.toast = jasmine.createSpyObj('ToastService', ['error']);
  cmp.translate = { instant: jasmine.createSpy('instant').and.callFake((key: string) => key) };
  cmp.storefrontAdminMode = storefrontAdminMode;
  cmp.navigation = navSource;
  cmp.pwa = { isOnline: () => true };

  cmp.drawerOpen = false;
  cmp.searchOpen = false;
  cmp.userMenuOpen = false;
  cmp.notificationsOpen = false;
  cmp.searchQuery = '';
  cmp.unreadPoll = undefined;
  cmp.navSub = { unsubscribe: jasmine.createSpy('unsubscribe') };
  cmp.authEffect = { destroy: jasmine.createSpy('destroy') };
  cmp.bannerPoll = 123;

  cmp.fallbackStorefrontLinks = [
    { label: 'nav.home', path: '/' },
    { label: 'nav.shop', path: '/shop' }
  ];

  Object.defineProperty(cmp, 'language', {
    get: () => cmp.languageSig(),
    set: (value: string) => cmp.languageSig.set(value === 'ro' ? 'ro' : 'en')
  });

  return { cmp, auth, router, notificationsService, ops, storefrontAdminMode };
}

describe('HeaderComponent coverage wave', () => {
  it('covers drawer/search/user/notifications toggles and overlay closing', () => {
    const { cmp, notificationsService } = createHarness();

    cmp.toggleDrawer();
    expect(cmp.drawerOpen).toBeTrue();
    cmp.openSearch();
    expect(cmp.searchOpen).toBeTrue();
    expect(cmp.drawerOpen).toBeFalse();

    cmp.toggleUserMenu();
    expect(cmp.userMenuOpen).toBeTrue();
    cmp.toggleNotifications();
    expect(cmp.notificationsOpen).toBeTrue();
    expect(notificationsService.load).toHaveBeenCalledWith(25);

    cmp.closeUserMenu();
    cmp.closeNotifications();
    cmp.closeSearch();
    cmp.closeOverlays();
    expect(cmp.userMenuOpen).toBeFalse();
    expect(cmp.notificationsOpen).toBeFalse();
  });

  it('covers banner label/link/class helpers and external-link checks', () => {
    const { cmp } = createHarness();

    cmp.language = 'ro';
    cmp.banner.set({
      level: 'promo',
      message_ro: 'Oferta',
      message_en: 'Offer',
      link_url: 'https://momentstudio.example/deals',
      link_label_ro: 'Vezi',
      link_label_en: 'See'
    });

    expect(cmp.bannerText()).toBe('Oferta');
    expect(cmp.bannerLinkUrl()).toContain('https://');
    expect(cmp.bannerLinkLabel()).toBe('Vezi');
    expect(cmp.bannerClasses()).toContain('emerald');

    cmp.banner.set({ level: 'warning', message_ro: '', message_en: 'Warning' });
    expect(cmp.bannerClasses()).toContain('amber');
    expect(cmp.isExternalLink('https://site.test')).toBeTrue();
    expect(cmp.isExternalLink('http://site.test')).toBeTrue();
    expect(cmp.isExternalLink('/local')).toBeFalse();

    const tracked = cmp.trackNavLink(0, { label: 'nav.shop', path: '/shop' });
    expect(tracked).toBe('/shop|nav.shop');
  });

  it('covers notifications actions, search submit, and unread badge branches', () => {
    const { cmp, router, notificationsService } = createHarness();

    expect(cmp.unreadBadge()).toBe('3');
    notificationsService.unreadCount.and.returnValue(12);
    expect(cmp.unreadBadge()).toBe('9+');

    cmp.markRead({ id: 'n-1' } as any);
    cmp.dismiss({ id: 'n-1' } as any);
    expect(notificationsService.markRead).toHaveBeenCalledWith('n-1');
    expect(notificationsService.dismiss).toHaveBeenCalledWith('n-1');

    cmp.openNotification({ id: 'n-2', read_at: null, dismissed_at: null, url: '/orders' } as any);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/orders');

    cmp.searchQuery = '  rings  ';
    const event = { preventDefault: jasmine.createSpy('preventDefault') } as unknown as Event;
    cmp.submitSearch(event);
    expect(router.navigate).toHaveBeenCalledWith(['/shop'], { queryParams: { q: 'rings' } });
  });

  it('covers storefront edit mode enable/disable and guarded error routes', () => {
    const { cmp, auth, router, storefrontAdminMode } = createHarness();

    storefrontAdminMode.enabled.and.returnValue(true);
    cmp.toggleStorefrontEditMode();
    expect(storefrontAdminMode.setEnabled).toHaveBeenCalledWith(false);

    storefrontAdminMode.enabled.and.returnValue(false);
    auth.checkAdminAccess.and.returnValue(of({}));
    cmp.toggleStorefrontEditMode();
    expect(storefrontAdminMode.setEnabled).toHaveBeenCalledWith(true);

    auth.checkAdminAccess.and.returnValue(
      throwError(() => ({ error: { detail: 'Two-factor authentication or passkey required for admin access' } }))
    );
    cmp.toggleStorefrontEditMode();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/account/security');

    auth.checkAdminAccess.and.returnValue(
      throwError(() => ({ error: { detail: 'Admin access is blocked from this IP address' } }))
    );
    cmp.toggleStorefrontEditMode();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/ip-bypass?returnUrl=%2Fadmin%2Fdashboard');
  });

  it('covers polling lifecycle, sign out, refresh banner, and destroy cleanup', () => {
    const { cmp, auth, notificationsService, ops } = createHarness();
    const setIntervalSpy = spyOn(window, 'setInterval').and.returnValue(99 as any);
    const clearIntervalSpy = spyOn(window, 'clearInterval');

    (cmp as any).startUnreadPolling();
    expect(setIntervalSpy).toHaveBeenCalled();
    (cmp as any).stopUnreadPolling();
    expect(clearIntervalSpy).toHaveBeenCalled();

    cmp.signOut();
    expect(notificationsService.reset).toHaveBeenCalled();
    expect(auth.logout).toHaveBeenCalled();

    ops.getActiveBanner.and.returnValue(throwError(() => new Error('banner fail')));
    (cmp as any).refreshBanner();
    expect(cmp.banner()).toBeNull();

    cmp.ngOnDestroy();
    expect(cmp.navSub.unsubscribe).toHaveBeenCalled();
    expect(cmp.authEffect.destroy).toHaveBeenCalled();
  });
});
