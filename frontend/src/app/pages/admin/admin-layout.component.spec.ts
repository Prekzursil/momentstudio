import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationStart } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { AdminLayoutComponent } from './admin-layout.component';

type AnySpyObj = Record<string, jasmine.Spy>;

interface Deps {
  component: AdminLayoutComponent;
  auth: {
    role: () => string | null;
    user: () => unknown;
    canAccessAdminSection: jasmine.Spy;
    updateTrainingMode: jasmine.Spy;
  };
  router: {
    url: string;
    events: Subject<unknown>;
    navigate: jasmine.Spy;
    navigateByUrl: jasmine.Spy;
  };
  translate: { instant: jasmine.Spy; onLangChange: Subject<unknown> };
  favorites: { init: jasmine.Spy; items: () => unknown[]; toggle: jasmine.Spy };
  uiPrefs: {
    sidebarCompact: () => boolean;
    preset: () => string;
    mode: () => string;
    setPreset: jasmine.Spy;
    setMode: jasmine.Spy;
    setSidebarCompact: jasmine.Spy;
  };
  recent: { add: jasmine.Spy };
  admin: { summary: jasmine.Spy };
  ops: { getWebhookFailureStats: jasmine.Spy; getEmailFailureStats: jasmine.Spy };
  support: { submitFeedback: jasmine.Spy };
  toast: AnySpyObj;
  roleSig: ReturnType<typeof signal<string | null>>;
  userSig: ReturnType<typeof signal<unknown>>;
  itemsSig: ReturnType<typeof signal<unknown[]>>;
  compactSig: ReturnType<typeof signal<boolean>>;
  presetSig: ReturnType<typeof signal<string>>;
  modeSig: ReturnType<typeof signal<string>>;
  accessSet: Set<string>;
}

function setup(): Deps {
  const roleSig = signal<string | null>('owner');
  const userSig = signal<unknown>({ role: 'owner' });
  const itemsSig = signal<unknown[]>([]);
  const compactSig = signal<boolean>(false);
  const presetSig = signal<string>('custom');
  const modeSig = signal<string>('advanced');
  const accessSet = new Set<string>([
    'dashboard',
    'content',
    'products',
    'inventory',
    'orders',
    'returns',
    'coupons',
    'users',
    'support',
    'ops',
  ]);

  const auth = {
    role: () => roleSig(),
    user: () => userSig(),
    canAccessAdminSection: jasmine
      .createSpy('canAccessAdminSection')
      .and.callFake((section: string) => accessSet.has(section)),
    updateTrainingMode: jasmine.createSpy('updateTrainingMode').and.returnValue(of({})),
  };

  const router = {
    url: '/admin/dashboard',
    events: new Subject<unknown>(),
    navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)),
    navigateByUrl: jasmine.createSpy('navigateByUrl').and.returnValue(Promise.resolve(true)),
  };

  const translate = {
    instant: jasmine.createSpy('instant').and.callFake((key: string) => key),
    onLangChange: new Subject<unknown>(),
  };

  const favorites = {
    init: jasmine.createSpy('init'),
    items: () => itemsSig(),
    toggle: jasmine.createSpy('toggle'),
  };

  const uiPrefs = {
    sidebarCompact: () => compactSig(),
    preset: () => presetSig(),
    mode: () => modeSig(),
    setPreset: jasmine.createSpy('setPreset'),
    setMode: jasmine.createSpy('setMode'),
    setSidebarCompact: jasmine.createSpy('setSidebarCompact'),
  };

  const recent = { add: jasmine.createSpy('add') };
  const admin = {
    summary: jasmine.createSpy('summary').and.returnValue(of({ low_stock: 3 })),
  };
  const ops = {
    getWebhookFailureStats: jasmine
      .createSpy('getWebhookFailureStats')
      .and.returnValue(of({ failed: 2 })),
    getEmailFailureStats: jasmine
      .createSpy('getEmailFailureStats')
      .and.returnValue(of({ failed: 1 })),
  };
  const support = {
    submitFeedback: jasmine.createSpy('submitFeedback').and.returnValue(of({})),
  };
  const toast = {
    success: jasmine.createSpy('success'),
    error: jasmine.createSpy('error'),
  };

  const injector = TestBed.inject(Injector);
  const component = runInInjectionContext(
    injector,
    () =>
      new AdminLayoutComponent(
        auth as never,
        router as never,
        translate as never,
        favorites as never,
        uiPrefs as never,
        recent as never,
        admin as never,
        ops as never,
        support as never,
        toast as never,
      ),
  );

  return {
    component,
    auth,
    router,
    translate,
    favorites,
    uiPrefs,
    recent,
    admin,
    ops,
    support,
    toast,
    roleSig,
    userSig,
    itemsSig,
    compactSig,
    presetSig,
    modeSig,
    accessSet,
  };
}

describe('AdminLayoutComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  describe('construction and navItems', () => {
    it('filters allNavItems via canAccessAdminSection', () => {
      const d = setup();
      d.accessSet.clear();
      d.accessSet.add('dashboard');
      d.accessSet.add('orders');
      const paths = d.component.navItems.map((item) => item.path);
      expect(paths).toEqual(['/admin/dashboard', '/admin/orders']);
    });

    it('initializes isDesktop from window width', () => {
      const d = setup();
      expect(typeof d.component.isDesktop).toBe('boolean');
    });
  });

  describe('ngOnInit / ngOnDestroy lifecycle', () => {
    it('wires effect, subscriptions, alerts and recent on init then tears down', () => {
      const d = setup();
      spyOn(window, 'setInterval').and.returnValue(
        9999 as unknown as ReturnType<typeof setInterval>,
      );
      const clearSpy = spyOn(window, 'clearInterval');

      d.component.ngOnInit();

      expect(d.favorites.init).toHaveBeenCalled();
      // effect body executes on flush.
      TestBed.flushEffects();
      expect(d.component.groupedFilteredNavItemsView.length).toBeGreaterThan(0);
      // recorded recent for current url.
      expect(d.recent.add).toHaveBeenCalled();
      // language change recomputes views.
      d.recent.add.calls.reset();
      d.translate.onLangChange.next({ lang: 'ro' });
      expect(d.component.filteredNavItemsView.length).toBeGreaterThan(0);

      d.component.ngOnDestroy();
      expect(clearSpy).toHaveBeenCalledWith(9999);
      expect(d.component['alertsIntervalId']).toBeNull();
    });

    it('reacts to NavigationEnd using urlAfterRedirects then url fallback', () => {
      const d = setup();
      spyOn(window, 'setInterval').and.returnValue(1 as unknown as ReturnType<typeof setInterval>);
      spyOn(window, 'clearInterval');
      d.component.ngOnInit();
      d.component.mobileSidebarOpen = true;

      d.recent.add.calls.reset();
      d.router.events.next(new NavigationEnd(1, '/admin/orders', '/admin/orders'));
      expect(d.component.mobileSidebarOpen).toBe(false);
      expect(d.recent.add).toHaveBeenCalled();

      d.recent.add.calls.reset();
      d.component.mobileSidebarOpen = true;
      // urlAfterRedirects empty -> falls back to url.
      d.router.events.next(new NavigationEnd(2, '/admin/products', ''));
      expect(d.recent.add).toHaveBeenCalled();
      expect(d.component.mobileSidebarOpen).toBe(false);

      // Non-NavigationEnd events are filtered out.
      d.recent.add.calls.reset();
      d.router.events.next(new NavigationStart(3, '/admin/users'));
      expect(d.recent.add).not.toHaveBeenCalled();

      d.component.ngOnDestroy();
    });

    it('invokes the interval callback to refresh alerts', () => {
      const d = setup();
      let captured: (() => void) | null = null;
      spyOn(window, 'setInterval').and.callFake(((handler: TimerHandler) => {
        captured = handler as () => void;
        return 7;
      }) as unknown as typeof window.setInterval);
      spyOn(window, 'clearInterval');
      d.component.ngOnInit();
      d.admin.summary.calls.reset();
      captured!();
      expect(d.admin.summary).toHaveBeenCalled();
      d.component.ngOnDestroy();
    });

    it('ngOnDestroy is safe before init (undefined subscriptions, null interval)', () => {
      const d = setup();
      const clearSpy = spyOn(window, 'clearInterval');
      expect(() => d.component.ngOnDestroy()).not.toThrow();
      expect(clearSpy).not.toHaveBeenCalled();
    });
  });

  describe('responsive + sidebar toggles', () => {
    it('onWindowResize sets desktop and closes mobile sidebar when desktop', () => {
      const d = setup();
      const widthSpy = spyOnProperty(window, 'innerWidth', 'get').and.returnValue(1280);
      d.component.mobileSidebarOpen = true;
      d.component.onWindowResize();
      expect(d.component.isDesktop).toBe(true);
      expect(d.component.mobileSidebarOpen).toBe(false);

      widthSpy.and.returnValue(500);
      d.component.mobileSidebarOpen = true;
      d.component.onWindowResize();
      expect(d.component.isDesktop).toBe(false);
      // not desktop -> mobile sidebar untouched.
      expect(d.component.mobileSidebarOpen).toBe(true);
    });

    it('toggleMobileSidebar no-ops on desktop and toggles on mobile', () => {
      const d = setup();
      d.component.isDesktop = true;
      d.component.mobileSidebarOpen = false;
      d.component.toggleMobileSidebar();
      expect(d.component.mobileSidebarOpen).toBe(false);

      d.component.isDesktop = false;
      d.component.toggleMobileSidebar();
      expect(d.component.mobileSidebarOpen).toBe(true);
      d.component.toggleMobileSidebar();
      expect(d.component.mobileSidebarOpen).toBe(false);
    });

    it('closeMobileSidebar closes the sidebar', () => {
      const d = setup();
      d.component.mobileSidebarOpen = true;
      d.component.closeMobileSidebar();
      expect(d.component.mobileSidebarOpen).toBe(false);
    });

    it('handleNavSelection closes mobile sidebar only on mobile', () => {
      const d = setup();
      d.component.isDesktop = false;
      d.component.mobileSidebarOpen = true;
      d.component.handleNavSelection();
      expect(d.component.mobileSidebarOpen).toBe(false);

      d.component.isDesktop = true;
      d.component.mobileSidebarOpen = true;
      d.component.handleNavSelection();
      expect(d.component.mobileSidebarOpen).toBe(true);
    });
  });

  describe('trackBy helpers', () => {
    it('trackByNavPath returns path; trackByGroupKey returns key', () => {
      const d = setup();
      expect(d.component.trackByNavPath(0, { path: '/admin/orders' } as never)).toBe(
        '/admin/orders',
      );
      expect(d.component.trackByGroupKey(1, { key: 'overview' } as never)).toBe('overview');
    });
  });

  describe('feedback modal', () => {
    it('openFeedback resets state; closeFeedback clears it', () => {
      const d = setup();
      d.component.feedbackError = 'boom';
      d.component.feedbackMessage = 'old';
      d.component.openFeedback();
      expect(d.component.feedbackOpen).toBe(true);
      expect(d.component.feedbackMessage).toBe('');
      expect(d.component.feedbackContext).toBe('');
      expect(d.component.feedbackIncludePage).toBe(true);
      expect(d.component.feedbackSending).toBe(false);
      expect(d.component.feedbackError).toBeNull();

      d.component.feedbackSending = true;
      d.component.feedbackError = 'err';
      d.component.closeFeedback();
      expect(d.component.feedbackOpen).toBe(false);
      expect(d.component.feedbackSending).toBe(false);
      expect(d.component.feedbackError).toBeNull();
    });

    it('submitFeedback no-ops while sending', () => {
      const d = setup();
      d.component.feedbackSending = true;
      d.component.feedbackMessage = 'hi';
      d.component.submitFeedback();
      expect(d.support.submitFeedback).not.toHaveBeenCalled();
    });

    it('submitFeedback no-ops with whitespace-only message', () => {
      const d = setup();
      d.component.feedbackMessage = '   ';
      d.component.submitFeedback();
      expect(d.support.submitFeedback).not.toHaveBeenCalled();
    });

    it('submitFeedback no-ops with an empty message', () => {
      const d = setup();
      d.component.feedbackMessage = '';
      d.component.submitFeedback();
      expect(d.support.submitFeedback).not.toHaveBeenCalled();
    });

    it('submitFeedback includes page and extra context on success', () => {
      const d = setup();
      d.router.url = '/admin/orders';
      d.component.feedbackMessage = '  great  ';
      d.component.feedbackContext = '  extra detail  ';
      d.component.feedbackIncludePage = true;
      d.component.submitFeedback();
      expect(d.support.submitFeedback).toHaveBeenCalledWith({
        message: 'great',
        context: 'Page: /admin/orders\nextra detail',
      });
      expect(d.toast['success']).toHaveBeenCalled();
      expect(d.component.feedbackOpen).toBe(false);
      expect(d.component.feedbackSending).toBe(false);
    });

    it('submitFeedback sends null context when no page and no extra', () => {
      const d = setup();
      d.component.feedbackMessage = 'msg';
      d.component.feedbackContext = '';
      d.component.feedbackIncludePage = false;
      d.component.submitFeedback();
      expect(d.support.submitFeedback).toHaveBeenCalledWith({ message: 'msg', context: null });
    });

    it('submitFeedback surfaces error and unsubscribes prior request', () => {
      const d = setup();
      d.support.submitFeedback.and.returnValue(of({}));
      d.component.feedbackMessage = 'first';
      d.component.submitFeedback();
      // Second submit unsubscribes the prior subscription, then errors.
      d.support.submitFeedback.and.returnValue(throwError(() => new Error('nope')));
      d.component.feedbackMessage = 'second';
      d.component.submitFeedback();
      expect(d.component.feedbackSending).toBe(false);
      expect(d.component.feedbackError).toBe('adminUi.feedback.errors.send');
    });

    it('feedbackSub is cleaned up on destroy after a submit', () => {
      const d = setup();
      spyOn(window, 'setInterval').and.returnValue(2 as unknown as ReturnType<typeof setInterval>);
      spyOn(window, 'clearInterval');
      d.component.ngOnInit();
      d.component.feedbackMessage = 'x';
      d.component.submitFeedback();
      expect(() => d.component.ngOnDestroy()).not.toThrow();
    });
  });

  describe('training mode', () => {
    it('isTrainingMode reflects the user flag', () => {
      const d = setup();
      d.userSig.set({ role: 'owner', admin_training_mode: true });
      expect(d.component.isTrainingMode()).toBe(true);
      d.userSig.set({ role: 'owner' });
      expect(d.component.isTrainingMode()).toBe(false);
      d.userSig.set(null);
      expect(d.component.isTrainingMode()).toBe(false);
    });

    it('toggleTrainingMode persists checked state on success', () => {
      const d = setup();
      d.auth.updateTrainingMode.and.returnValue(of({}));
      d.component.toggleTrainingMode({ target: { checked: true } } as unknown as Event);
      expect(d.auth.updateTrainingMode).toHaveBeenCalledWith(true);
      expect(d.component.trainingSaving).toBe(false);
      expect(d.component.trainingError).toBeNull();
    });

    it('toggleTrainingMode handles missing target and error path', () => {
      const d = setup();
      d.auth.updateTrainingMode.and.returnValue(throwError(() => new Error('x')));
      d.component.toggleTrainingMode({ target: null } as unknown as Event);
      expect(d.auth.updateTrainingMode).toHaveBeenCalledWith(false);
      expect(d.component.trainingSaving).toBe(false);
      expect(d.component.trainingError).toBe('adminUi.trainingMode.errors.save');
    });

    it('toggleTrainingMode no-ops while saving', () => {
      const d = setup();
      d.component.trainingSaving = true;
      d.component.toggleTrainingMode({ target: { checked: true } } as unknown as Event);
      expect(d.auth.updateTrainingMode).not.toHaveBeenCalled();
    });
  });

  describe('preferences toggles', () => {
    it('toggleSidebarCompact forwards checked state (and false when no target)', () => {
      const d = setup();
      d.component.toggleSidebarCompact({ target: { checked: true } } as unknown as Event);
      expect(d.uiPrefs.setSidebarCompact).toHaveBeenCalledWith(true);
      d.component.toggleSidebarCompact({ target: null } as unknown as Event);
      expect(d.uiPrefs.setSidebarCompact).toHaveBeenCalledWith(false);
    });

    it('toggleNavFavorite toggles favorite and recomputes views', () => {
      const d = setup();
      d.translate.instant.and.callFake((key: string) =>
        key === 'adminUi.nav.orders' ? 'Orders' : key,
      );
      const event = {
        preventDefault: jasmine.createSpy('preventDefault'),
        stopPropagation: jasmine.createSpy('stopPropagation'),
      } as unknown as MouseEvent;
      const item = {
        path: '/admin/orders',
        labelKey: 'adminUi.nav.orders',
        section: 'orders',
        label: 'Orders',
        highlightBefore: 'Orders',
        highlightMatch: '',
        highlightAfter: '',
        isFavorite: false,
      };
      d.component.toggleNavFavorite(item as never, event);
      expect(event.preventDefault as jasmine.Spy).toHaveBeenCalled();
      expect(event.stopPropagation as jasmine.Spy).toHaveBeenCalled();
      expect(d.favorites.toggle).toHaveBeenCalledWith({
        key: 'page:/admin/orders',
        type: 'page',
        label: 'Orders',
        subtitle: '',
        url: '/admin/orders',
        state: null,
      });
    });

    it('clearNavQuery resets the query', () => {
      const d = setup();
      d.component.navQuery = 'orders';
      d.component.clearNavQuery();
      expect(d.component.navQuery).toBe('');
    });
  });

  describe('alerts', () => {
    it('refreshAlerts loads counts from admin and ops services', () => {
      const d = setup();
      d.component.refreshAlerts();
      expect(d.component.lowStockCount).toBe(3);
      expect(d.component.failedWebhooksCount).toBe(2);
      expect(d.component.failedEmailsCount).toBe(1);
      expect(d.component.alertsLoading).toBe(false);
      expect(d.component.alertsError).toBeNull();
    });

    it('floors fractional counts and clamps negatives to zero', () => {
      const d = setup();
      d.admin.summary.and.returnValue(of({ low_stock: 4.9 }));
      d.ops.getWebhookFailureStats.and.returnValue(of({ failed: -3 }));
      d.ops.getEmailFailureStats.and.returnValue(of({ failed: 2.7 }));
      d.component.refreshAlerts();
      expect(d.component.lowStockCount).toBe(4);
      expect(d.component.failedWebhooksCount).toBe(0);
      expect(d.component.failedEmailsCount).toBe(2);
    });

    it('treats non-finite counts as zero', () => {
      const d = setup();
      d.admin.summary.and.returnValue(of({ low_stock: 'oops' }));
      d.ops.getWebhookFailureStats.and.returnValue(of({ failed: Number.NaN }));
      d.ops.getEmailFailureStats.and.returnValue(of({ failed: Infinity }));
      d.component.refreshAlerts();
      expect(d.component.lowStockCount).toBe(0);
      expect(d.component.failedWebhooksCount).toBe(0);
      expect(d.component.failedEmailsCount).toBe(0);
    });

    it('handles nullish responses', () => {
      const d = setup();
      d.admin.summary.and.returnValue(of(null));
      d.ops.getWebhookFailureStats.and.returnValue(of(null));
      d.ops.getEmailFailureStats.and.returnValue(of(null));
      d.component.refreshAlerts();
      expect(d.component.lowStockCount).toBe(0);
      expect(d.component.failedWebhooksCount).toBe(0);
      expect(d.component.failedEmailsCount).toBe(0);
    });

    it('records errors per failing source', () => {
      const d = setup();
      d.admin.summary.and.returnValue(throwError(() => new Error('a')));
      d.ops.getWebhookFailureStats.and.returnValue(throwError(() => new Error('b')));
      d.ops.getEmailFailureStats.and.returnValue(throwError(() => new Error('c')));
      d.component.refreshAlerts();
      expect(d.component.lowStockCount).toBe(0);
      expect(d.component.failedWebhooksCount).toBe(0);
      expect(d.component.failedEmailsCount).toBe(0);
      expect(d.component.alertsError).toBe('adminUi.alerts.errors.load');
    });

    it('skips ops requests when only inventory is accessible', () => {
      const d = setup();
      d.accessSet.clear();
      d.accessSet.add('inventory');
      d.component.refreshAlerts();
      expect(d.admin.summary).toHaveBeenCalled();
      expect(d.ops.getWebhookFailureStats).not.toHaveBeenCalled();
      expect(d.component.failedWebhooksCount).toBe(0);
      expect(d.component.failedEmailsCount).toBe(0);
    });

    it('skips inventory request when only ops is accessible', () => {
      const d = setup();
      d.accessSet.clear();
      d.accessSet.add('ops');
      d.component.refreshAlerts();
      expect(d.admin.summary).not.toHaveBeenCalled();
      expect(d.component.lowStockCount).toBe(0);
      expect(d.ops.getWebhookFailureStats).toHaveBeenCalled();
    });

    it('finishes loading immediately when no sources are accessible', () => {
      const d = setup();
      d.accessSet.clear();
      d.component.refreshAlerts();
      expect(d.component.alertsLoading).toBe(false);
      expect(d.admin.summary).not.toHaveBeenCalled();
      expect(d.ops.getWebhookFailureStats).not.toHaveBeenCalled();
    });

    it('goToInventory and goToOps navigate appropriately', () => {
      const d = setup();
      d.component.goToInventory();
      expect(d.router.navigateByUrl).toHaveBeenCalledWith('/admin/inventory');
      d.component.goToOps('webhooks');
      expect(d.router.navigateByUrl).toHaveBeenCalledWith('/admin/ops', {
        state: { focusOpsSection: 'webhooks' },
      });
    });
  });

  describe('shouldShowAlerts', () => {
    it('returns false for owner_basic preset', () => {
      const d = setup();
      d.presetSig.set('owner_basic');
      expect(d.component.shouldShowAlerts()).toBe(false);
    });

    it('returns true while loading', () => {
      const d = setup();
      d.component.alertsLoading = true;
      expect(d.component.shouldShowAlerts()).toBe(true);
    });

    it('returns true on error', () => {
      const d = setup();
      d.component.alertsError = 'err';
      expect(d.component.shouldShowAlerts()).toBe(true);
    });

    it('returns true for low stock with inventory access', () => {
      const d = setup();
      d.component.lowStockCount = 2;
      expect(d.component.shouldShowAlerts()).toBe(true);
    });

    it('ignores low stock without inventory access', () => {
      const d = setup();
      d.component.lowStockCount = 2;
      d.accessSet.delete('inventory');
      d.accessSet.delete('ops');
      expect(d.component.shouldShowAlerts()).toBe(false);
    });

    it('returns true for failed webhooks with ops access', () => {
      const d = setup();
      d.component.failedWebhooksCount = 1;
      expect(d.component.shouldShowAlerts()).toBe(true);
    });

    it('ignores failed webhooks without ops access', () => {
      const d = setup();
      d.component.failedWebhooksCount = 1;
      d.accessSet.delete('ops');
      d.accessSet.delete('inventory');
      expect(d.component.shouldShowAlerts()).toBe(false);
    });

    it('returns true for failed emails with ops access', () => {
      const d = setup();
      d.component.failedEmailsCount = 1;
      expect(d.component.shouldShowAlerts()).toBe(true);
    });

    it('ignores failed emails without ops access', () => {
      const d = setup();
      d.component.failedEmailsCount = 1;
      d.accessSet.delete('ops');
      d.accessSet.delete('inventory');
      expect(d.component.shouldShowAlerts()).toBe(false);
    });

    it('returns false when nothing is pending', () => {
      const d = setup();
      expect(d.component.shouldShowAlerts()).toBe(false);
    });
  });

  describe('onNavQueryChange', () => {
    it('stores string values and recomputes', () => {
      const d = setup();
      d.component.onNavQueryChange('orders');
      expect(d.component.navQuery).toBe('orders');
    });

    it('coerces non-string values to empty string', () => {
      const d = setup();
      d.component.onNavQueryChange(123 as unknown as string);
      expect(d.component.navQuery).toBe('');
    });
  });

  describe('onDocumentKeydown', () => {
    function keyEvent(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
      return {
        defaultPrevented: false,
        target: null,
        ctrlKey: false,
        metaKey: false,
        preventDefault: jasmine.createSpy('preventDefault'),
        ...init,
      } as unknown as KeyboardEvent;
    }

    it('closes the mobile sidebar on Escape when open', () => {
      const d = setup();
      d.component.isDesktop = false;
      d.component.mobileSidebarOpen = true;
      d.component.onDocumentKeydown(keyEvent({ key: 'Escape' }));
      expect(d.component.mobileSidebarOpen).toBe(false);
    });

    it('ignores shortcuts triggered from form fields', () => {
      const d = setup();
      const event = keyEvent({
        key: 'g',
        target: { tagName: 'INPUT', isContentEditable: false } as unknown as HTMLElement,
      });
      d.component.onDocumentKeydown(event);
      expect(d.component['pendingGoAt']).toBeNull();
    });

    it('opens global search on Ctrl+K and focuses dashboard input', () => {
      const d = setup();
      d.router.url = '/admin/dashboard';
      const input = document.createElement('input');
      input.id = 'admin-global-search';
      document.body.appendChild(input);
      const focusSpy = spyOn(input, 'focus');
      const selectSpy = spyOn(input, 'select');
      const event = keyEvent({ key: 'k', ctrlKey: true });
      d.component.onDocumentKeydown(event);
      expect(event.preventDefault as jasmine.Spy).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
      expect(selectSpy).toHaveBeenCalled();
      document.body.removeChild(input);
    });

    it('opens global search on Meta+K while on dashboard without the input present', () => {
      const d = setup();
      d.router.url = '/admin/dashboard';
      const event = keyEvent({ key: 'K', metaKey: true });
      d.component.onDocumentKeydown(event);
      expect(event.preventDefault as jasmine.Spy).toHaveBeenCalled();
      expect(d.router.navigate).not.toHaveBeenCalled();
    });

    it('navigates to dashboard for global search when not on dashboard', () => {
      const d = setup();
      d.router.url = '/admin/orders';
      d.component.onDocumentKeydown(keyEvent({ key: 'k', ctrlKey: true }));
      expect(d.router.navigate).toHaveBeenCalledWith(['/admin/dashboard'], {
        state: { focusGlobalSearch: true },
      });
    });

    it('handles empty router url when opening global search', () => {
      const d = setup();
      d.router.url = '';
      d.component.onDocumentKeydown(keyEvent({ key: 'k', metaKey: true }));
      expect(d.router.navigate).toHaveBeenCalledWith(['/admin/dashboard'], {
        state: { focusGlobalSearch: true },
      });
    });

    it('clears pending go-shortcut on Escape (desktop)', () => {
      const d = setup();
      d.component['pendingGoAt'] = Date.now();
      d.component.onDocumentKeydown(keyEvent({ key: 'Escape' }));
      expect(d.component['pendingGoAt']).toBeNull();
    });

    it('coerces a missing key to an empty string and does nothing', () => {
      const d = setup();
      d.component.onDocumentKeydown(keyEvent({ key: '' }));
      expect(d.router.navigate).not.toHaveBeenCalled();
      expect(d.component['pendingGoAt']).toBeNull();
    });

    it('arms the go-shortcut on "g"', () => {
      const d = setup();
      d.component.onDocumentKeydown(keyEvent({ key: 'g' }));
      expect(d.component['pendingGoAt']).not.toBeNull();
    });

    it('navigates with a valid go-shortcut destination', () => {
      const d = setup();
      d.component.onDocumentKeydown(keyEvent({ key: 'g' }));
      const event = keyEvent({ key: 'o' });
      d.component.onDocumentKeydown(event);
      expect(event.preventDefault as jasmine.Spy).toHaveBeenCalled();
      expect(d.router.navigate).toHaveBeenCalledWith(['/admin/orders']);
      expect(d.component['pendingGoAt']).toBeNull();
    });

    it('ignores an unknown go-shortcut key', () => {
      const d = setup();
      d.component['pendingGoAt'] = Date.now();
      d.component.onDocumentKeydown(keyEvent({ key: 'z' }));
      expect(d.router.navigate).not.toHaveBeenCalled();
      // pending stays set because nothing matched.
      expect(d.component['pendingGoAt']).not.toBeNull();
    });

    it('expires a stale pending go-shortcut', () => {
      const d = setup();
      d.component['pendingGoAt'] = Date.now() - 5000;
      d.component.onDocumentKeydown(keyEvent({ key: 'o' }));
      expect(d.router.navigate).not.toHaveBeenCalled();
      expect(d.component['pendingGoAt']).toBeNull();
    });
  });

  describe('routeForGoShortcut', () => {
    it('maps each shortcut key to its route', () => {
      const d = setup();
      const route = (key: string): string | null =>
        (
          d.component as unknown as { routeForGoShortcut(k: string): string | null }
        ).routeForGoShortcut(key);
      expect(route('d')).toBe('/admin/dashboard');
      expect(route('o')).toBe('/admin/orders');
      expect(route('p')).toBe('/admin/products');
      expect(route('u')).toBe('/admin/users');
      expect(route('c')).toBe('/admin/coupons');
      expect(route('s')).toBe('/admin/support');
      expect(route('x')).toBe('/admin/ops');
      expect(route('i')).toBe('/admin/inventory');
      expect(route('r')).toBe('/admin/returns');
      expect(route('z')).toBeNull();
    });
  });

  describe('shouldIgnoreShortcut', () => {
    function ignore(d: Deps, event: unknown): boolean {
      return (
        d.component as unknown as { shouldIgnoreShortcut(e: unknown): boolean }
      ).shouldIgnoreShortcut(event);
    }

    it('returns true when default prevented', () => {
      const d = setup();
      expect(ignore(d, { defaultPrevented: true })).toBe(true);
    });

    it('returns false when there is no target', () => {
      const d = setup();
      expect(ignore(d, { defaultPrevented: false, target: null })).toBe(false);
    });

    it('returns true for input/textarea/select targets', () => {
      const d = setup();
      expect(ignore(d, { target: { tagName: 'INPUT', isContentEditable: false } })).toBe(true);
      expect(ignore(d, { target: { tagName: 'TEXTAREA', isContentEditable: false } })).toBe(true);
      expect(ignore(d, { target: { tagName: 'SELECT', isContentEditable: false } })).toBe(true);
    });

    it('returns true for contenteditable targets', () => {
      const d = setup();
      expect(ignore(d, { target: { tagName: 'DIV', isContentEditable: true } })).toBe(true);
    });

    it('returns false for a plain target, including missing tagName', () => {
      const d = setup();
      expect(ignore(d, { target: { tagName: 'DIV', isContentEditable: false } })).toBe(false);
      expect(ignore(d, { target: { tagName: undefined, isContentEditable: false } })).toBe(false);
    });
  });

  describe('navLabel + recomputeNavViews', () => {
    it('uses translated label when present, falling back to the key', () => {
      const d = setup();
      const navLabel = (item: unknown): string =>
        (d.component as unknown as { navLabel(i: unknown): string }).navLabel(item);
      d.translate.instant.and.returnValue('Dashboard');
      expect(navLabel({ labelKey: 'adminUi.nav.dashboard' })).toBe('Dashboard');
      d.translate.instant.and.returnValue('   ');
      expect(navLabel({ labelKey: 'adminUi.nav.dashboard' })).toBe('adminUi.nav.dashboard');
      d.translate.instant.and.returnValue({ not: 'a string' });
      expect(navLabel({ labelKey: 'adminUi.nav.dashboard' })).toBe('adminUi.nav.dashboard');
    });

    it('groups all visible items in advanced mode', () => {
      const d = setup();
      d.component['recomputeNavViews']();
      expect(d.component.filteredNavItemsView.length).toBe(10);
      const groupKeys = d.component.groupedFilteredNavItemsView.map((g) => g.key);
      expect(groupKeys).toContain('overview');
      expect(groupKeys).toContain('operationsSecurity');
    });

    it('restricts to owner-basic sections when not advanced', () => {
      const d = setup();
      d.modeSig.set('simple');
      d.component['recomputeNavViews']();
      const sections = d.component.filteredNavItemsView.map((i) => i.section).sort();
      expect(sections).toEqual(
        ['content', 'dashboard', 'orders', 'products', 'returns', 'support'].sort(),
      );
    });

    it('restricts to owner-basic sections when preset is owner_basic even in advanced mode', () => {
      const d = setup();
      d.presetSig.set('owner_basic');
      d.modeSig.set('advanced');
      d.component['recomputeNavViews']();
      const sections = d.component.filteredNavItemsView.map((i) => i.section);
      expect(sections).not.toContain('ops');
    });

    it('computes highlight slices when the label matches the query', () => {
      const d = setup();
      d.translate.instant.and.callFake((key: string) =>
        key === 'adminUi.nav.orders' ? 'Orders' : key,
      );
      d.component.navQuery = 'ord';
      d.component['recomputeNavViews']();
      const orders = d.component.filteredNavItemsView.find((i) => i.section === 'orders');
      expect(orders?.highlightBefore).toBe('');
      expect(orders?.highlightMatch).toBe('Ord');
      expect(orders?.highlightAfter).toBe('ers');
    });

    it('keeps section-only matches without highlight slices', () => {
      const d = setup();
      // Label deliberately does NOT contain the query, but the section does.
      d.translate.instant.and.callFake((key: string) =>
        key === 'adminUi.nav.ops' ? 'Operations centre' : key,
      );
      d.component.navQuery = 'ops';
      d.component['recomputeNavViews']();
      const ops = d.component.filteredNavItemsView.find((i) => i.section === 'ops');
      expect(ops).toBeTruthy();
      expect(ops?.label).toBe('Operations centre');
      expect(ops?.highlightBefore).toBe('Operations centre');
      expect(ops?.highlightMatch).toBe('');
      expect(ops?.highlightAfter).toBe('');
    });

    it('derives favorites only from matching page favorites with urls', () => {
      const d = setup();
      d.itemsSig.set([
        { type: 'page', url: '/admin/orders' },
        { type: 'page', url: '  ' },
        { type: 'page', url: '' },
        { type: 'content', url: '/admin/content' },
        { type: 'page', url: '/admin/not-a-nav-item' },
        null,
      ]);
      d.component['recomputeNavViews']();
      const favPaths = d.component.favoriteNavItemsView.map((i) => i.path);
      expect(favPaths).toEqual(['/admin/orders']);
      const orders = d.component.filteredNavItemsView.find((i) => i.path === '/admin/orders');
      expect(orders?.isFavorite).toBe(true);
    });

    it('falls back to operationsSecurity for an unknown section', () => {
      const d = setup();
      d.accessSet.add('mystery');
      (d.component as unknown as { allNavItems: unknown[] }).allNavItems.push({
        path: '/admin/mystery',
        labelKey: 'adminUi.nav.mystery',
        section: 'mystery',
      });
      d.component['recomputeNavViews']();
      const opsGroup = d.component.groupedFilteredNavItemsView.find(
        (g) => g.key === 'operationsSecurity',
      );
      expect(opsGroup?.items.some((i) => i.section === 'mystery')).toBe(true);
    });
  });

  describe('recordRecent', () => {
    function record(d: Deps, url: string): void {
      (d.component as unknown as { recordRecent(u: string): void }).recordRecent(url);
    }

    it('ignores non-admin urls', () => {
      const d = setup();
      record(d, '/shop/cart');
      expect(d.recent.add).not.toHaveBeenCalled();
    });

    it('ignores empty/whitespace urls', () => {
      const d = setup();
      record(d, '   ');
      expect(d.recent.add).not.toHaveBeenCalled();
    });

    it('ignores a falsy url', () => {
      const d = setup();
      record(d, '' as unknown as string);
      expect(d.recent.add).not.toHaveBeenCalled();
    });

    it('picks the longest matching nav item when several prefixes match', () => {
      const d = setup();
      // Inject an overlapping prefix item so two candidates match and the
      // comparator must choose the most specific (longest) path.
      (d.component as unknown as { allNavItems: unknown[] }).allNavItems.push({
        path: '/admin',
        labelKey: 'adminUi.nav.root',
        section: 'dashboard',
      });
      record(d, '/admin/orders');
      expect(d.recent.add).toHaveBeenCalledWith(
        jasmine.objectContaining({ key: 'page:/admin/orders', url: '/admin/orders' }),
      );
    });

    it('ignores order detail urls', () => {
      const d = setup();
      record(d, '/admin/orders/abc123');
      expect(d.recent.add).not.toHaveBeenCalled();
    });

    it('ignores admin urls with no matching nav item', () => {
      const d = setup();
      record(d, '/admin/unknown-area');
      expect(d.recent.add).not.toHaveBeenCalled();
    });

    it('records the longest matching nav item for a page url with query/hash stripped', () => {
      const d = setup();
      record(d, '/admin/orders?status=open#top');
      expect(d.recent.add).toHaveBeenCalledWith({
        key: 'page:/admin/orders',
        type: 'page',
        label: 'adminUi.nav.orders',
        subtitle: '',
        url: '/admin/orders',
        state: null,
      });
    });

    it('records content urls with a translated subtitle', () => {
      const d = setup();
      d.translate.instant.and.callFake((key: string) =>
        key === 'adminUi.content.nav.blog' ? 'Blog' : key,
      );
      record(d, '/admin/content/blog');
      expect(d.recent.add).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'content', subtitle: 'Blog', url: '/admin/content/blog' }),
      );
    });

    it('uses the raw section when the content subtitle has no translation', () => {
      const d = setup();
      d.translate.instant.and.callFake((key: string) => key);
      record(d, '/admin/content/pages');
      expect(d.recent.add).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'content', subtitle: 'pages' }),
      );
    });

    it('records content root without a subtitle section', () => {
      const d = setup();
      record(d, '/admin/content');
      expect(d.recent.add).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'content', subtitle: '' }),
      );
    });
  });
});
