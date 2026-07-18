import { PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AuthService } from '../core/auth.service';
import { CartStore } from '../core/cart.store';
import { NotificationsService } from '../core/notifications.service';
import { OpsService } from '../core/ops.service';
import { PwaService } from '../core/pwa.service';
import { SiteNavigationService } from '../core/site-navigation.service';
import { StorefrontAdminModeService } from '../core/storefront-admin-mode.service';
import { ToastService } from '../core/toast.service';
import { HeaderComponent } from './header.component';

interface Harness {
  authed: WritableSignal<boolean>;
  user: WritableSignal<{ username: string } | null>;
  staff: WritableSignal<boolean>;
  admin: WritableSignal<boolean>;
  impersonating: WritableSignal<boolean>;
  enabled: WritableSignal<boolean>;
  online: WritableSignal<boolean>;
  count: WritableSignal<number>;
  unread: WritableSignal<number>;
  items: WritableSignal<unknown[]>;
  loading: WritableSignal<boolean>;
  setEnabled: jasmine.Spy;
  checkAdminAccess: jasmine.Spy;
  logout: jasmine.Spy;
  notif: jasmine.SpyObj<NotificationsService>;
  toastError: jasmine.Spy;
  router: jasmine.SpyObj<Router>;
  getActiveBanner: jasmine.Spy;
  navGet: jasmine.Spy;
}

function setup(platform: 'browser' | 'server' = 'browser'): Harness {
  const h: Partial<Harness> = {};
  h.authed = signal(false);
  h.user = signal<{ username: string } | null>(null);
  h.staff = signal(false);
  h.admin = signal(false);
  h.impersonating = signal(false);
  h.enabled = signal(false);
  h.online = signal(true);
  h.count = signal(0);
  h.unread = signal(0);
  h.items = signal<unknown[]>([]);
  h.loading = signal(false);
  h.setEnabled = jasmine.createSpy('setEnabled').and.callFake((v: boolean) => h.enabled!.set(v));
  h.checkAdminAccess = jasmine.createSpy('checkAdminAccess').and.returnValue(of(null));
  h.logout = jasmine.createSpy('logout').and.returnValue(of(null));
  h.toastError = jasmine.createSpy('error');
  h.getActiveBanner = jasmine.createSpy('getActiveBanner').and.returnValue(of(null));
  h.navGet = jasmine.createSpy('navGet').and.returnValue(of(null));
  h.router = jasmine.createSpyObj<Router>('Router', ['navigate', 'navigateByUrl']);
  h.router.navigate.and.returnValue(Promise.resolve(true));
  h.router.navigateByUrl.and.returnValue(Promise.resolve(true));
  (h.router as { url: string }).url = '/admin/dashboard';
  h.notif = jasmine.createSpyObj<NotificationsService>('NotificationsService', [
    'reset',
    'refreshUnreadCount',
    'load',
    'markRead',
    'dismiss',
  ]);
  (h.notif as unknown as { items: unknown }).items = h.items;
  (h.notif as unknown as { loading: unknown }).loading = h.loading;
  (h.notif as unknown as { unreadCount: unknown }).unreadCount = h.unread;

  TestBed.configureTestingModule({
    imports: [HeaderComponent, TranslateModule.forRoot()],
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      {
        provide: AuthService,
        useValue: {
          isAuthenticated: () => h.authed!(),
          user: () => h.user!(),
          isStaff: () => h.staff!(),
          isAdmin: () => h.admin!(),
          isImpersonating: () => h.impersonating!(),
          checkAdminAccess: h.checkAdminAccess,
          logout: h.logout,
        },
      },
      { provide: CartStore, useValue: { count: h.count } },
      {
        provide: StorefrontAdminModeService,
        useValue: { enabled: h.enabled, setEnabled: h.setEnabled },
      },
      { provide: NotificationsService, useValue: h.notif },
      { provide: OpsService, useValue: { getActiveBanner: h.getActiveBanner } },
      { provide: PwaService, useValue: { isOnline: () => h.online!() } },
      { provide: SiteNavigationService, useValue: { get: h.navGet } },
      { provide: ToastService, useValue: { error: h.toastError } },
      { provide: Router, useValue: h.router },
    ],
  }).overrideComponent(HeaderComponent, { set: { template: '', imports: [] } });

  return h as Harness;
}

function create(): ComponentFixture<HeaderComponent> {
  const fixture = TestBed.createComponent(HeaderComponent);
  fixture.detectChanges();
  return fixture;
}

describe('HeaderComponent', () => {
  it('creates in the browser', () => {
    setup();
    expect(create().componentInstance).toBeTruthy();
  });

  it('skips browser-only setup on the server', () => {
    const h = setup('server');
    const fixture = TestBed.createComponent(HeaderComponent);
    const cmp = fixture.componentInstance;
    expect(cmp).toBeTruthy();
    expect(h.getActiveBanner).not.toHaveBeenCalled();
    // startUnreadPolling / stopUnreadPolling early-return on the server
    (cmp as unknown as { startUnreadPolling(): void }).startUnreadPolling();
    (cmp as unknown as { stopUnreadPolling(): void }).stopUnreadPolling();
    expect(() => cmp.ngOnDestroy()).not.toThrow();
  });

  it('language setter normalizes to en/ro', () => {
    setup();
    const cmp = create().componentInstance;
    cmp.language = 'ro';
    expect(cmp.language).toBe('ro');
    cmp.language = 'fr';
    expect(cmp.language).toBe('en');
  });

  it('emits theme and language changes', () => {
    setup();
    const cmp = create().componentInstance;
    const themeSpy = jasmine.createSpy('theme');
    const langSpy = jasmine.createSpy('lang');
    cmp.themeChange.subscribe(themeSpy);
    cmp.languageChange.subscribe(langSpy);
    cmp.onThemeChange('dark');
    cmp.onLanguageChange('ro');
    expect(themeSpy).toHaveBeenCalledWith('dark');
    expect(langSpy).toHaveBeenCalledWith('ro');
  });

  describe('notifications effect + polling', () => {
    it('starts polling once when authenticated and resets when logged out', () => {
      const h = setup();
      const fixture = create();
      h.authed.set(true);
      fixture.detectChanges();
      expect(h.notif.refreshUnreadCount).toHaveBeenCalled();
      const cmp = fixture.componentInstance;
      // calling startUnreadPolling again is a no-op (already polling)
      (cmp as unknown as { startUnreadPolling(): void }).startUnreadPolling();
      h.authed.set(false);
      fixture.detectChanges();
      expect(h.notif.reset).toHaveBeenCalled();
    });

    it('runs the banner and unread-count callbacks on each interval tick', () => {
      const h = setup();
      const callbacks: Array<() => void> = [];
      spyOn(window, 'setInterval').and.callFake(((fn: () => void) => {
        callbacks.push(fn);
        return callbacks.length as unknown as number;
      }) as typeof window.setInterval);
      const fixture = create();
      h.authed.set(true);
      fixture.detectChanges();
      expect(callbacks.length).toBe(2);
      callbacks.forEach((fn) => fn());
      expect(h.getActiveBanner).toHaveBeenCalledTimes(2);
      expect(h.notif.refreshUnreadCount.calls.count()).toBeGreaterThan(1);
    });
  });

  describe('toggleStorefrontEditMode', () => {
    it('disables edit mode when already enabled', () => {
      const h = setup();
      const cmp = create().componentInstance;
      h.enabled.set(true);
      cmp.toggleStorefrontEditMode();
      expect(h.setEnabled).toHaveBeenCalledWith(false);
    });

    it('does nothing when not an admin or while impersonating', () => {
      const h = setup();
      const cmp = create().componentInstance;
      cmp.toggleStorefrontEditMode();
      expect(h.checkAdminAccess).not.toHaveBeenCalled();
      h.admin.set(true);
      h.impersonating.set(true);
      cmp.toggleStorefrontEditMode();
      expect(h.checkAdminAccess).not.toHaveBeenCalled();
    });

    it('enables edit mode after a successful admin check', () => {
      const h = setup();
      const cmp = create().componentInstance;
      h.admin.set(true);
      cmp.toggleStorefrontEditMode();
      expect(h.setEnabled).toHaveBeenCalledWith(true);
    });

    it('redirects to security when MFA is required', () => {
      const h = setup();
      h.checkAdminAccess.and.returnValue(
        throwError(() => ({
          error: { detail: 'Two-factor authentication or passkey required for admin access' },
        })),
      );
      const cmp = create().componentInstance;
      h.admin.set(true);
      cmp.toggleStorefrontEditMode();
      expect(h.toastError).toHaveBeenCalled();
      expect(h.router.navigateByUrl).toHaveBeenCalledWith('/account/security');
    });

    it('redirects to ip-bypass when admin access is IP-restricted', () => {
      const h = setup();
      h.checkAdminAccess.and.returnValue(
        throwError(() => ({ error: { detail: 'Admin access is blocked from this IP address' } })),
      );
      const cmp = create().componentInstance;
      h.admin.set(true);
      cmp.toggleStorefrontEditMode();
      expect(h.router.navigateByUrl).toHaveBeenCalledWith(
        jasmine.stringMatching(/^\/admin\/ip-bypass\?returnUrl=/),
      );
    });

    it('uses the default return url when the router url is empty', () => {
      const h = setup();
      (h.router as { url: string }).url = '';
      h.checkAdminAccess.and.returnValue(
        throwError(() => ({
          error: { detail: 'Admin access is restricted to approved IP addresses' },
        })),
      );
      const cmp = create().componentInstance;
      h.admin.set(true);
      cmp.toggleStorefrontEditMode();
      expect(h.router.navigateByUrl).toHaveBeenCalledWith(
        '/admin/ip-bypass?returnUrl=' + encodeURIComponent('/admin/dashboard'),
      );
    });

    it('surfaces a generic error otherwise', () => {
      const h = setup();
      h.checkAdminAccess.and.returnValue(throwError(() => ({ error: { detail: 'Nope' } })));
      const cmp = create().componentInstance;
      h.admin.set(true);
      cmp.toggleStorefrontEditMode();
      expect(h.toastError).toHaveBeenCalledWith('Nope');
    });

    it('falls back to a generic message when no detail is present', () => {
      const h = setup();
      h.checkAdminAccess.and.returnValue(throwError(() => ({})));
      const cmp = create().componentInstance;
      h.admin.set(true);
      cmp.toggleStorefrontEditMode();
      expect(h.toastError).toHaveBeenCalled();
    });
  });

  describe('overlay toggles', () => {
    it('toggleDrawer opens and closes, clearing other overlays', () => {
      setup();
      const cmp = create().componentInstance;
      cmp.searchOpen = true;
      cmp.userMenuOpen = true;
      cmp.notificationsOpen = true;
      cmp.toggleDrawer();
      expect(cmp.drawerOpen).toBeTrue();
      expect(cmp.searchOpen).toBeFalse();
      cmp.toggleDrawer();
      expect(cmp.drawerOpen).toBeFalse();
    });

    it('openSearch and closeSearch', () => {
      setup();
      const cmp = create().componentInstance;
      cmp.openSearch();
      expect(cmp.searchOpen).toBeTrue();
      cmp.closeSearch();
      expect(cmp.searchOpen).toBeFalse();
    });

    it('toggleUserMenu opens and closes', () => {
      setup();
      const cmp = create().componentInstance;
      cmp.toggleUserMenu();
      expect(cmp.userMenuOpen).toBeTrue();
      cmp.toggleUserMenu();
      expect(cmp.userMenuOpen).toBeFalse();
      cmp.closeUserMenu();
      expect(cmp.userMenuOpen).toBeFalse();
    });

    it('toggleNotifications loads on open and closes', () => {
      const h = setup();
      const cmp = create().componentInstance;
      cmp.toggleNotifications();
      expect(cmp.notificationsOpen).toBeTrue();
      expect(h.notif.load).toHaveBeenCalledWith(25);
      cmp.toggleNotifications();
      expect(cmp.notificationsOpen).toBeFalse();
      cmp.closeNotifications();
      expect(cmp.notificationsOpen).toBeFalse();
    });

    it('closeOverlays clears menus', () => {
      setup();
      const cmp = create().componentInstance;
      cmp.userMenuOpen = true;
      cmp.notificationsOpen = true;
      cmp.closeOverlays();
      expect(cmp.userMenuOpen).toBeFalse();
      expect(cmp.notificationsOpen).toBeFalse();
    });
  });

  describe('banner helpers', () => {
    it('returns null fields when there is no banner', () => {
      setup();
      const cmp = create().componentInstance;
      expect(cmp.bannerText()).toBeNull();
      expect(cmp.bannerLinkUrl()).toBeNull();
      expect(cmp.bannerLinkLabel()).toBeNull();
      expect(cmp.bannerClasses()).toContain('accent');
    });

    it('prefers the language-specific copy and falls back', () => {
      setup();
      const cmp = create().componentInstance;
      cmp.banner.set({
        level: 'warning',
        message_en: 'EN',
        message_ro: 'RO',
        link_url: 'https://x',
        link_label_en: 'More',
        link_label_ro: 'Mai mult',
        starts_at: '2026-01-01T00:00:00Z',
      });
      cmp.language = 'ro';
      expect(cmp.bannerText()).toBe('RO');
      expect(cmp.bannerLinkUrl()).toBe('https://x');
      expect(cmp.bannerLinkLabel()).toBe('Mai mult');
      expect(cmp.bannerClasses()).toContain('amber');
    });

    it('falls back to the other language when the preferred copy is missing', () => {
      setup();
      const cmp = create().componentInstance;
      cmp.banner.set({
        level: 'promo',
        message_en: '',
        message_ro: 'Doar RO',
        link_url: '',
        link_label_en: '',
        link_label_ro: 'Eticheta',
        starts_at: '2026-01-01T00:00:00Z',
      });
      expect(cmp.bannerText()).toBe('Doar RO');
      expect(cmp.bannerLinkUrl()).toBeNull();
      expect(cmp.bannerLinkLabel()).toBe('Eticheta');
      expect(cmp.bannerClasses()).toContain('emerald');
    });

    it('returns null when the resolved message/label is empty', () => {
      setup();
      const cmp = create().componentInstance;
      cmp.banner.set({
        level: 'info',
        message_en: '',
        message_ro: '',
        starts_at: '2026-01-01T00:00:00Z',
      });
      expect(cmp.bannerText()).toBeNull();
      expect(cmp.bannerLinkLabel()).toBeNull();
    });
  });

  describe('banner refresh', () => {
    it('stores the active banner on success', () => {
      const h = setup();
      h.getActiveBanner.and.returnValue(
        of({ level: 'info', message_en: 'Hi', message_ro: 'Salut' }),
      );
      const cmp = create().componentInstance;
      expect(cmp.banner()?.message_en).toBe('Hi');
    });

    it('clears the banner on error', () => {
      const h = setup();
      h.getActiveBanner.and.returnValue(throwError(() => new Error('down')));
      const cmp = create().componentInstance;
      expect(cmp.banner()).toBeNull();
    });
  });

  describe('navigation links', () => {
    it('uses fallback links when there is no CMS navigation', () => {
      setup();
      const cmp = create().componentInstance;
      expect(cmp.storefrontLinks().some((l) => l.path === '/shop')).toBeTrue();
    });

    it('maps CMS header links, skips invalid entries and resolves language', () => {
      const h = setup();
      h.navGet.and.returnValue(
        of({
          headerLinks: [
            { url: 'https://ext.com', label: { en: 'Ext', ro: 'Extern' } },
            { url: '/local', label: { en: 'Local', ro: 'Localnic' } },
            { url: '', label: { en: 'NoUrl', ro: 'x' } },
            { url: '/x', label: { en: '', ro: '' } },
          ],
        }),
      );
      const cmp = create().componentInstance;
      cmp.language = 'ro';
      const links = cmp.storefrontLinks();
      expect(links.map((l) => l.label)).toEqual(['Extern', 'Localnic']);
      expect(links[0].external).toBeTrue();
      expect(links[1].external).toBeFalse();
    });

    it('falls back when every CMS link is invalid', () => {
      const h = setup();
      h.navGet.and.returnValue(of({ headerLinks: [{ url: '', label: { en: '', ro: '' } }] }));
      const cmp = create().componentInstance;
      expect(cmp.storefrontLinks().some((l) => l.path === '/')).toBeTrue();
    });

    it('falls back when headerLinks is empty', () => {
      const h = setup();
      h.navGet.and.returnValue(of({ headerLinks: [] }));
      const cmp = create().componentInstance;
      expect(cmp.storefrontLinks().length).toBeGreaterThan(0);
    });

    it('adds account links for authenticated users and admin for staff', () => {
      const h = setup();
      const cmp = create().componentInstance;
      expect(cmp.navLinks().some((l) => l.path === '/login')).toBeTrue();
      h.authed.set(true);
      h.staff.set(true);
      expect(cmp.navLinks().some((l) => l.path === '/account')).toBeTrue();
      expect(cmp.navLinks().some((l) => l.path === '/admin')).toBeTrue();
    });

    it('trackNavLink builds a stable key, isExternalLink detects protocols', () => {
      setup();
      const cmp = create().componentInstance;
      expect(cmp.trackNavLink(0, { label: 'A', path: '/a' })).toBe('/a|A');
      expect(cmp.trackNavLink(0, null as never)).toBe('|');
      expect(cmp.isExternalLink('http://x')).toBeTrue();
      expect(cmp.isExternalLink('https://x')).toBeTrue();
      expect(cmp.isExternalLink('/local')).toBeFalse();
      expect(cmp.isExternalLink('' as unknown as string)).toBeFalse();
    });

    it('exposes the reactive view state through computed signals', () => {
      const h = setup();
      h.user.set({ username: 'jane' });
      h.authed.set(true);
      h.staff.set(true);
      h.admin.set(true);
      h.impersonating.set(true);
      h.online.set(false);
      h.count.set(3);
      h.items.set([{ id: 'n' }]);
      h.loading.set(true);
      const cmp = create().componentInstance;
      expect(cmp.currentUser()?.username).toBe('jane');
      expect(cmp.isAuthenticated()).toBeTrue();
      expect(cmp.isStaff()).toBeTrue();
      expect(cmp.isAdmin()).toBeTrue();
      expect(cmp.isImpersonating()).toBeTrue();
      expect(cmp.pwaOnline()).toBeFalse();
      expect(cmp.cartCount()).toBe(3);
      expect(cmp.notifications().length).toBe(1);
      expect(cmp.notificationsLoading()).toBeTrue();
      expect(cmp.storefrontEditMode()).toBeFalse();
    });
  });

  describe('notification interactions', () => {
    it('unreadBadge formats counts', () => {
      const h = setup();
      const cmp = create().componentInstance;
      h.unread.set(0);
      expect(cmp.unreadBadge()).toBe('');
      h.unread.set(5);
      expect(cmp.unreadBadge()).toBe('5');
      h.unread.set(42);
      expect(cmp.unreadBadge()).toBe('9+');
    });

    it('markRead and dismiss delegate to the service', () => {
      const h = setup();
      const cmp = create().componentInstance;
      cmp.markRead({ id: 'n1' } as never);
      cmp.dismiss({ id: 'n2' } as never);
      expect(h.notif.markRead).toHaveBeenCalledWith('n1');
      expect(h.notif.dismiss).toHaveBeenCalledWith('n2');
    });

    it('openNotification marks unread items read and navigates to its url', () => {
      const h = setup();
      const cmp = create().componentInstance;
      cmp.openNotification({ id: 'n1', url: '/somewhere' } as never);
      expect(h.notif.markRead).toHaveBeenCalledWith('n1');
      expect(h.router.navigateByUrl).toHaveBeenCalledWith('/somewhere');
    });

    it('openNotification skips marking already-read items and defaults the route', () => {
      const h = setup();
      const cmp = create().componentInstance;
      cmp.openNotification({ id: 'n1', read_at: 'yes' } as never);
      expect(h.notif.markRead).not.toHaveBeenCalled();
      expect(h.router.navigateByUrl).toHaveBeenCalledWith('/account/notifications');
    });
  });

  describe('search + sign out', () => {
    it('submitSearch navigates with a query when present', () => {
      const h = setup();
      const cmp = create().componentInstance;
      cmp.searchQuery = '  shoes  ';
      const event = { preventDefault: jasmine.createSpy('pd') } as unknown as Event;
      cmp.submitSearch(event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(h.router.navigate).toHaveBeenCalledWith(['/shop'], { queryParams: { q: 'shoes' } });
    });

    it('submitSearch navigates with empty params when blank', () => {
      const h = setup();
      const cmp = create().componentInstance;
      cmp.searchQuery = '   ';
      cmp.submitSearch({ preventDefault: () => undefined } as unknown as Event);
      expect(h.router.navigate).toHaveBeenCalledWith(['/shop'], { queryParams: {} });
    });

    it('signOut clears overlays and logs out', () => {
      const h = setup();
      const cmp = create().componentInstance;
      cmp.drawerOpen = true;
      cmp.signOut();
      expect(cmp.drawerOpen).toBeFalse();
      expect(h.notif.reset).toHaveBeenCalled();
      expect(h.logout).toHaveBeenCalled();
    });
  });

  it('cleans up on destroy', () => {
    setup();
    const fixture = create();
    expect(() => fixture.destroy()).not.toThrow();
  });
});
