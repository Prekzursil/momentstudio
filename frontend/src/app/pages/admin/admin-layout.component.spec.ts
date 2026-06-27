import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NavigationEnd } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { AdminFavoritesService } from '../../core/admin-favorites.service';
import { AdminRecentService } from '../../core/admin-recent.service';
import { AdminSupportService } from '../../core/admin-support.service';
import { AdminUiPrefsService } from '../../core/admin-ui-prefs.service';
import { AdminService } from '../../core/admin.service';
import { AuthService } from '../../core/auth.service';
import { OpsService } from '../../core/ops.service';
import { ToastService } from '../../core/toast.service';
import { TranslateService } from '@ngx-translate/core';
import { Router } from '@angular/router';

import { AdminLayoutComponent } from './admin-layout.component';

type Stubs = {
  auth: {
    role: ReturnType<typeof signal<string | null>>;
    user: ReturnType<typeof signal<{ admin_training_mode?: boolean } | null>>;
    canAccessAdminSection: jasmine.Spy;
    updateTrainingMode: jasmine.Spy;
  };
  uiPrefs: {
    preset: ReturnType<typeof signal<string>>;
    mode: ReturnType<typeof signal<string>>;
    sidebarCompact: ReturnType<typeof signal<boolean>>;
    setPreset: jasmine.Spy;
    setMode: jasmine.Spy;
    setSidebarCompact: jasmine.Spy;
  };
  favorites: {
    items: ReturnType<typeof signal<any[]>>;
    init: jasmine.Spy;
    toggle: jasmine.Spy;
  };
  recent: { add: jasmine.Spy };
  admin: { summary: jasmine.Spy };
  ops: { getWebhookFailureStats: jasmine.Spy; getEmailFailureStats: jasmine.Spy };
  support: { submitFeedback: jasmine.Spy };
  toast: { success: jasmine.Spy; error: jasmine.Spy };
  translate: { instant: (key: string) => any; onLangChange: Subject<unknown> };
  router: {
    url: string;
    events: Subject<unknown>;
    navigate: jasmine.Spy;
    navigateByUrl: jasmine.Spy;
  };
};

function makeStubs(): Stubs {
  return {
    auth: {
      role: signal<string | null>('owner'),
      user: signal<{ admin_training_mode?: boolean } | null>({ admin_training_mode: false }),
      canAccessAdminSection: jasmine.createSpy('canAccessAdminSection').and.returnValue(true),
      updateTrainingMode: jasmine.createSpy('updateTrainingMode').and.returnValue(of({} as any)),
    },
    uiPrefs: {
      preset: signal<string>('custom'),
      mode: signal<string>('advanced'),
      sidebarCompact: signal<boolean>(false),
      setPreset: jasmine.createSpy('setPreset'),
      setMode: jasmine.createSpy('setMode'),
      setSidebarCompact: jasmine.createSpy('setSidebarCompact'),
    },
    favorites: {
      items: signal<any[]>([]),
      init: jasmine.createSpy('init'),
      toggle: jasmine.createSpy('toggle'),
    },
    recent: { add: jasmine.createSpy('add') },
    admin: { summary: jasmine.createSpy('summary').and.returnValue(of({ low_stock: 0 })) },
    ops: {
      getWebhookFailureStats: jasmine
        .createSpy('getWebhookFailureStats')
        .and.returnValue(of({ failed: 0 })),
      getEmailFailureStats: jasmine
        .createSpy('getEmailFailureStats')
        .and.returnValue(of({ failed: 0 })),
    },
    support: { submitFeedback: jasmine.createSpy('submitFeedback').and.returnValue(of({})) },
    toast: { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') },
    translate: { instant: (key: string) => key, onLangChange: new Subject<unknown>() },
    router: {
      url: '/admin/dashboard',
      events: new Subject<unknown>(),
      navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)),
      navigateByUrl: jasmine.createSpy('navigateByUrl').and.returnValue(Promise.resolve(true)),
    },
  };
}

function keyEvent(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
    key: 'a',
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    target: null,
    preventDefault: jasmine.createSpy('preventDefault'),
    ...overrides,
  };
}

describe('AdminLayoutComponent', () => {
  let stubs: Stubs;
  let fixture: ComponentFixture<AdminLayoutComponent>;
  let component: AdminLayoutComponent;

  function setup(): void {
    stubs = makeStubs();
    TestBed.configureTestingModule({
      imports: [AdminLayoutComponent],
      providers: [
        { provide: AuthService, useValue: stubs.auth },
        { provide: Router, useValue: stubs.router },
        { provide: TranslateService, useValue: stubs.translate },
        { provide: AdminFavoritesService, useValue: stubs.favorites },
        { provide: AdminUiPrefsService, useValue: stubs.uiPrefs },
        { provide: AdminRecentService, useValue: stubs.recent },
        { provide: AdminService, useValue: stubs.admin },
        { provide: OpsService, useValue: stubs.ops },
        { provide: AdminSupportService, useValue: stubs.support },
        { provide: ToastService, useValue: stubs.toast },
      ],
    });
    TestBed.overrideComponent(AdminLayoutComponent, { set: { template: '' } });
    fixture = TestBed.createComponent(AdminLayoutComponent);
    component = fixture.componentInstance;
  }

  beforeEach(() => setup());

  afterEach(() => {
    component.ngOnDestroy();
  });

  it('creates and exposes accessible nav items', () => {
    expect(component).toBeTruthy();
    expect(component.navItems.length).toBe(10);

    stubs.auth.canAccessAdminSection.and.callFake((section: string) => section !== 'ops');
    expect(component.navItems.some((i) => i.section === 'ops')).toBeFalse();
  });

  describe('lifecycle', () => {
    it('wires subscriptions, effect, recent + alerts on init and re-runs the effect on signal change', () => {
      const recompute = spyOn<any>(component, 'recomputeNavViews').and.callThrough();
      component.ngOnInit();
      TestBed.flushEffects();

      expect(stubs.favorites.init).toHaveBeenCalled();
      expect(stubs.recent.add).toHaveBeenCalled();
      expect(stubs.admin.summary).toHaveBeenCalled();

      const before = recompute.calls.count();
      stubs.uiPrefs.mode.set('simple');
      TestBed.flushEffects();
      expect(recompute.calls.count()).toBeGreaterThan(before);
    });

    it('recomputes nav views when the language changes', () => {
      component.ngOnInit();
      const recompute = spyOn<any>(component, 'recomputeNavViews').and.callThrough();
      stubs.translate.onLangChange.next({});
      expect(recompute).toHaveBeenCalled();
    });

    it('records recent and closes the mobile sidebar on navigation end', () => {
      component.ngOnInit();
      stubs.recent.add.calls.reset();
      component.mobileSidebarOpen = true;

      stubs.router.events.next(new NavigationEnd(1, '/admin/orders', '/admin/orders'));
      expect(component.mobileSidebarOpen).toBeFalse();
      expect(stubs.recent.add).toHaveBeenCalled();

      stubs.recent.add.calls.reset();
      stubs.router.events.next(new NavigationEnd(2, '/admin/products', ''));
      expect(stubs.recent.add).toHaveBeenCalled();
    });

    it('fires the alerts polling interval', () => {
      jasmine.clock().install();
      component.ngOnInit();
      stubs.admin.summary.calls.reset();
      jasmine.clock().tick(5 * 60 * 1000);
      expect(stubs.admin.summary).toHaveBeenCalled();
      jasmine.clock().uninstall();
    });

    it('tears down all subscriptions and the interval on destroy', () => {
      component.ngOnInit();
      component.submitFeedback();
      component.ngOnDestroy();
      expect((component as any).alertsIntervalId).toBeNull();
      // Second destroy without init exercises the null-interval branch.
      component.ngOnDestroy();
      expect((component as any).alertsIntervalId).toBeNull();
    });
  });

  describe('responsive + sidebar', () => {
    it('updates desktop flag and closes mobile sidebar when widening', () => {
      Object.defineProperty(window, 'innerWidth', { value: 1300, configurable: true });
      component.mobileSidebarOpen = true;
      component.onWindowResize();
      expect(component.isDesktop).toBeTrue();
      expect(component.mobileSidebarOpen).toBeFalse();

      component.mobileSidebarOpen = true;
      Object.defineProperty(window, 'innerWidth', { value: 700, configurable: true });
      component.onWindowResize();
      expect(component.isDesktop).toBeFalse();
      expect(component.mobileSidebarOpen).toBeTrue();
    });

    it('toggles the mobile sidebar only on non-desktop', () => {
      component.isDesktop = true;
      component.mobileSidebarOpen = false;
      component.toggleMobileSidebar();
      expect(component.mobileSidebarOpen).toBeFalse();

      component.isDesktop = false;
      component.toggleMobileSidebar();
      expect(component.mobileSidebarOpen).toBeTrue();
      component.toggleMobileSidebar();
      expect(component.mobileSidebarOpen).toBeFalse();
    });

    it('closeMobileSidebar always closes', () => {
      component.mobileSidebarOpen = true;
      component.closeMobileSidebar();
      expect(component.mobileSidebarOpen).toBeFalse();
    });

    it('handleNavSelection closes on mobile but keeps state on desktop', () => {
      component.isDesktop = false;
      component.mobileSidebarOpen = true;
      component.handleNavSelection();
      expect(component.mobileSidebarOpen).toBeFalse();

      component.isDesktop = true;
      component.mobileSidebarOpen = true;
      component.handleNavSelection();
      expect(component.mobileSidebarOpen).toBeTrue();
    });
  });

  it('trackBy helpers return stable keys', () => {
    expect(component.trackByNavPath(0, { path: '/x' } as any)).toBe('/x');
    expect(component.trackByGroupKey(1, { key: 'overview' } as any)).toBe('overview');
  });

  describe('feedback', () => {
    it('open and close reset state', () => {
      component.openFeedback();
      expect(component.feedbackOpen).toBeTrue();
      expect(component.feedbackMessage).toBe('');
      component.feedbackSending = true;
      component.feedbackError = 'x';
      component.closeFeedback();
      expect(component.feedbackOpen).toBeFalse();
      expect(component.feedbackSending).toBeFalse();
      expect(component.feedbackError).toBeNull();
    });

    it('does nothing when already sending', () => {
      component.feedbackSending = true;
      component.feedbackMessage = 'hi';
      component.submitFeedback();
      expect(stubs.support.submitFeedback).not.toHaveBeenCalled();
    });

    it('does nothing with an empty message', () => {
      component.feedbackMessage = '   ';
      component.submitFeedback();
      expect(stubs.support.submitFeedback).not.toHaveBeenCalled();
    });

    it('submits with page + extra context and reports success', () => {
      stubs.router.url = '/admin/orders';
      component.feedbackMessage = 'Bug here';
      component.feedbackIncludePage = true;
      component.feedbackContext = 'Extra detail';
      component.submitFeedback();

      const payload = stubs.support.submitFeedback.calls.mostRecent().args[0];
      expect(payload.message).toBe('Bug here');
      expect(payload.context).toContain('Page: /admin/orders');
      expect(payload.context).toContain('Extra detail');
      expect(stubs.toast.success).toHaveBeenCalled();
      expect(component.feedbackOpen).toBeFalse();
    });

    it('submits with null context when no page nor extra context', () => {
      component.feedbackMessage = 'Just a note';
      component.feedbackIncludePage = false;
      component.feedbackContext = '   ';
      component.submitFeedback();
      const payload = stubs.support.submitFeedback.calls.mostRecent().args[0];
      expect(payload.context).toBeNull();
    });

    it('reports an error and unsubscribes a prior in-flight request', () => {
      component.feedbackMessage = 'first';
      component.submitFeedback();

      stubs.support.submitFeedback.and.returnValue(throwError(() => new Error('boom')));
      component.feedbackMessage = 'second';
      component.submitFeedback();
      expect(component.feedbackSending).toBeFalse();
      expect(component.feedbackError).toBe('adminUi.feedback.errors.send');
    });
  });

  describe('training mode', () => {
    it('reflects the user flag', () => {
      stubs.auth.user.set({ admin_training_mode: true });
      expect(component.isTrainingMode()).toBeTrue();
      stubs.auth.user.set(null);
      expect(component.isTrainingMode()).toBeFalse();
    });

    it('saves a toggle and clears the saving flag on success', () => {
      component.toggleTrainingMode(keyEvent({ target: { checked: true } }));
      expect(stubs.auth.updateTrainingMode).toHaveBeenCalledWith(true);
      expect(component.trainingSaving).toBeFalse();
    });

    it('treats a null target as disabled', () => {
      component.toggleTrainingMode(keyEvent({ target: null }));
      expect(stubs.auth.updateTrainingMode).toHaveBeenCalledWith(false);
    });

    it('does nothing while a save is in flight', () => {
      component.trainingSaving = true;
      component.toggleTrainingMode(keyEvent({ target: { checked: true } }));
      expect(stubs.auth.updateTrainingMode).not.toHaveBeenCalled();
    });

    it('surfaces a save error', () => {
      stubs.auth.updateTrainingMode.and.returnValue(throwError(() => new Error('x')));
      component.toggleTrainingMode(keyEvent({ target: { checked: true } }));
      expect(component.trainingSaving).toBeFalse();
      expect(component.trainingError).toBe('adminUi.trainingMode.errors.save');
    });
  });

  it('toggleSidebarCompact forwards the checkbox value', () => {
    component.toggleSidebarCompact(keyEvent({ target: { checked: true } }));
    expect(stubs.uiPrefs.setSidebarCompact).toHaveBeenCalledWith(true);
    component.toggleSidebarCompact(keyEvent({ target: null }));
    expect(stubs.uiPrefs.setSidebarCompact).toHaveBeenCalledWith(false);
  });

  it('toggleNavFavorite pins via the favorites service and recomputes', () => {
    const recompute = spyOn<any>(component, 'recomputeNavViews').and.callThrough();
    const event = keyEvent({ stopPropagation: jasmine.createSpy('stopPropagation') });
    const item = { path: '/admin/orders', label: 'Orders' } as any;
    component.toggleNavFavorite(item, event as any);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(stubs.favorites.toggle).toHaveBeenCalledWith(
      jasmine.objectContaining({ key: 'page:/admin/orders', url: '/admin/orders', type: 'page' }),
    );
    expect(recompute).toHaveBeenCalled();
  });

  it('clearNavQuery resets the query', () => {
    component.navQuery = 'orders';
    component.clearNavQuery();
    expect(component.navQuery).toBe('');
  });

  it('refreshAlerts reloads the alert counts', () => {
    stubs.admin.summary.calls.reset();
    component.refreshAlerts();
    expect(stubs.admin.summary).toHaveBeenCalled();
  });

  it('navigation helpers route correctly', () => {
    component.goToInventory();
    expect(stubs.router.navigateByUrl).toHaveBeenCalledWith('/admin/inventory');
    component.goToOps('webhooks');
    expect(stubs.router.navigateByUrl).toHaveBeenCalledWith('/admin/ops', {
      state: { focusOpsSection: 'webhooks' },
    });
  });

  describe('shouldShowAlerts', () => {
    it('hides alerts in the owner_basic preset', () => {
      stubs.uiPrefs.preset.set('owner_basic');
      expect(component.shouldShowAlerts()).toBeFalse();
    });

    it('shows while loading', () => {
      component.alertsLoading = true;
      expect(component.shouldShowAlerts()).toBeTrue();
    });

    it('shows on error', () => {
      component.alertsError = 'oops';
      expect(component.shouldShowAlerts()).toBeTrue();
    });

    it('shows for low stock with inventory access', () => {
      component.lowStockCount = 3;
      stubs.auth.canAccessAdminSection.and.callFake((s: string) => s === 'inventory');
      expect(component.shouldShowAlerts()).toBeTrue();
    });

    it('shows for failed webhooks with ops access', () => {
      component.failedWebhooksCount = 2;
      stubs.auth.canAccessAdminSection.and.callFake((s: string) => s === 'ops');
      expect(component.shouldShowAlerts()).toBeTrue();
    });

    it('shows for failed emails with ops access', () => {
      component.failedEmailsCount = 2;
      stubs.auth.canAccessAdminSection.and.callFake((s: string) => s === 'ops');
      expect(component.shouldShowAlerts()).toBeTrue();
    });

    it('returns false when nothing demands attention', () => {
      stubs.auth.canAccessAdminSection.and.returnValue(false);
      expect(component.shouldShowAlerts()).toBeFalse();
    });
  });

  it('onNavQueryChange coerces non-string input to empty', () => {
    component.onNavQueryChange('orders');
    expect(component.navQuery).toBe('orders');
    component.onNavQueryChange(undefined as unknown as string);
    expect(component.navQuery).toBe('');
  });

  describe('keyboard shortcuts', () => {
    it('Escape closes the mobile sidebar first on non-desktop', () => {
      component.isDesktop = false;
      component.mobileSidebarOpen = true;
      component.onDocumentKeydown(keyEvent({ key: 'Escape' }));
      expect(component.mobileSidebarOpen).toBeFalse();
    });

    it('ignores shortcuts when the event was already handled', () => {
      const event = keyEvent({ ctrlKey: true, key: 'k', defaultPrevented: true });
      component.onDocumentKeydown(event);
      expect(stubs.router.navigate).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('ignores shortcuts originating from form fields', () => {
      component.onDocumentKeydown(keyEvent({ ctrlKey: true, key: 'k', target: { tagName: 'INPUT' } }));
      component.onDocumentKeydown(
        keyEvent({ ctrlKey: true, key: 'k', target: { tagName: 'DIV', isContentEditable: true } }),
      );
      component.onDocumentKeydown(keyEvent({ ctrlKey: true, key: 'k', target: { isContentEditable: false } }));
      expect(stubs.router.navigate).not.toHaveBeenCalled();
    });

    it('Ctrl/Cmd+K focuses the dashboard search input when present', () => {
      const input = document.createElement('input');
      input.id = 'admin-global-search';
      document.body.appendChild(input);
      const focusSpy = spyOn(input, 'focus');
      const selectSpy = spyOn(input, 'select');

      stubs.router.url = '/admin/dashboard';
      const event = keyEvent({ ctrlKey: true, key: 'k', target: { tagName: 'DIV' } });
      component.onDocumentKeydown(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
      expect(selectSpy).toHaveBeenCalled();
      document.body.removeChild(input);
    });

    it('Cmd+K on the dashboard without an input does nothing extra', () => {
      stubs.router.url = '/admin/dashboard';
      component.onDocumentKeydown(keyEvent({ metaKey: true, key: 'k', target: { tagName: 'DIV' } }));
      expect(stubs.router.navigate).not.toHaveBeenCalled();
    });

    it('Ctrl+K off the dashboard navigates to the dashboard search', () => {
      stubs.router.url = '/admin/orders';
      component.onDocumentKeydown(keyEvent({ ctrlKey: true, key: 'k', target: { tagName: 'DIV' } }));
      expect(stubs.router.navigate).toHaveBeenCalledWith(['/admin/dashboard'], {
        state: { focusGlobalSearch: true },
      });
    });

    it('Ctrl+K with an empty current url navigates to the dashboard search', () => {
      stubs.router.url = '';
      component.onDocumentKeydown(keyEvent({ ctrlKey: true, key: 'k', target: { tagName: 'DIV' } }));
      expect(stubs.router.navigate).toHaveBeenCalledWith(['/admin/dashboard'], {
        state: { focusGlobalSearch: true },
      });
    });

    it('escape clears a pending go-shortcut', () => {
      (component as any).pendingGoAt = Date.now();
      component.onDocumentKeydown(keyEvent({ key: 'Escape' }));
      expect((component as any).pendingGoAt).toBeNull();
    });

    it('g arms the go-shortcut', () => {
      component.onDocumentKeydown(keyEvent({ key: 'g' }));
      expect((component as any).pendingGoAt).not.toBeNull();
    });

    it('g then a mapped key navigates', () => {
      const routes: Record<string, string> = {
        d: '/admin/dashboard',
        o: '/admin/orders',
        p: '/admin/products',
        u: '/admin/users',
        c: '/admin/coupons',
        s: '/admin/support',
        x: '/admin/ops',
        i: '/admin/inventory',
        r: '/admin/returns',
      };
      for (const [k, route] of Object.entries(routes)) {
        stubs.router.navigate.calls.reset();
        (component as any).pendingGoAt = Date.now();
        component.onDocumentKeydown(keyEvent({ key: k, target: { tagName: 'DIV' } }));
        expect(stubs.router.navigate).toHaveBeenCalledWith([route]);
      }
    });

    it('ignores an unmapped key while a go-shortcut is pending', () => {
      (component as any).pendingGoAt = Date.now();
      component.onDocumentKeydown(keyEvent({ key: 'z', target: { tagName: 'DIV' } }));
      expect(stubs.router.navigate).not.toHaveBeenCalled();
      expect((component as any).pendingGoAt).not.toBeNull();
    });

    it('expires a stale go-shortcut', () => {
      (component as any).pendingGoAt = Date.now() - 5000;
      component.onDocumentKeydown(keyEvent({ key: 'd', target: { tagName: 'DIV' } }));
      expect(stubs.router.navigate).not.toHaveBeenCalled();
      expect((component as any).pendingGoAt).toBeNull();
    });

    it('handles an event with a missing key', () => {
      component.onDocumentKeydown(keyEvent({ key: undefined, target: { tagName: 'DIV' } }));
      expect(stubs.router.navigate).not.toHaveBeenCalled();
    });
  });

  describe('recordRecent', () => {
    function record(url: string): void {
      (component as any).recordRecent(url);
    }

    it('ignores non-admin urls', () => {
      record('/storefront');
      expect(stubs.recent.add).not.toHaveBeenCalled();
    });

    it('ignores an empty url', () => {
      record('');
      expect(stubs.recent.add).not.toHaveBeenCalled();
    });

    it('records the most specific match when several nav items match', () => {
      (component as any).allNavItems = [
        ...(component as any).allNavItems,
        { path: '/admin/products/featured', labelKey: 'adminUi.nav.products', section: 'products' },
      ];
      record('/admin/products/featured');
      const payload = stubs.recent.add.calls.mostRecent().args[0];
      expect(payload.url).toBe('/admin/products/featured');
    });

    it('ignores order detail urls', () => {
      record('/admin/orders/abc123');
      expect(stubs.recent.add).not.toHaveBeenCalled();
    });

    it('ignores urls without a matching nav item', () => {
      stubs.auth.canAccessAdminSection.and.returnValue(false);
      record('/admin/orders');
      expect(stubs.recent.add).not.toHaveBeenCalled();
    });

    it('records a plain admin page, stripping query and hash', () => {
      record('/admin/orders?tab=1#top');
      const payload = stubs.recent.add.calls.mostRecent().args[0];
      expect(payload.url).toBe('/admin/orders');
      expect(payload.type).toBe('page');
    });

    it('records a content page with a translated subtitle', () => {
      stubs.translate.instant = (key: string) =>
        key === 'adminUi.content.nav.blog' ? 'Blog posts' : key;
      record('/admin/content/blog');
      const payload = stubs.recent.add.calls.mostRecent().args[0];
      expect(payload.type).toBe('content');
      expect(payload.subtitle).toBe('Blog posts');
    });

    it('records a content page falling back to the raw section when untranslated', () => {
      record('/admin/content/pages');
      const payload = stubs.recent.add.calls.mostRecent().args[0];
      expect(payload.subtitle).toBe('pages');
    });

    it('records the content root with no subtitle', () => {
      record('/admin/content');
      const payload = stubs.recent.add.calls.mostRecent().args[0];
      expect(payload.type).toBe('content');
      expect(payload.subtitle).toBe('');
    });
  });

  describe('loadAlerts', () => {
    it('aggregates counts across inventory and ops sections', () => {
      stubs.admin.summary.and.returnValue(of({ low_stock: 4 }));
      stubs.ops.getWebhookFailureStats.and.returnValue(of({ failed: 2 }));
      stubs.ops.getEmailFailureStats.and.returnValue(of({ failed: 3 }));
      (component as any).loadAlerts();
      expect(component.lowStockCount).toBe(4);
      expect(component.failedWebhooksCount).toBe(2);
      expect(component.failedEmailsCount).toBe(3);
      expect(component.alertsLoading).toBeFalse();
    });

    it('coerces non-finite counts to zero', () => {
      stubs.admin.summary.and.returnValue(of({ low_stock: 'not-a-number' }));
      stubs.ops.getWebhookFailureStats.and.returnValue(of({ failed: 'nan' }));
      stubs.ops.getEmailFailureStats.and.returnValue(of({ failed: Infinity }));
      (component as any).loadAlerts();
      expect(component.lowStockCount).toBe(0);
      expect(component.failedWebhooksCount).toBe(0);
      expect(component.failedEmailsCount).toBe(0);
    });

    it('treats null or missing alert responses as zero', () => {
      stubs.admin.summary.and.returnValue(of(null));
      stubs.ops.getWebhookFailureStats.and.returnValue(of({}));
      stubs.ops.getEmailFailureStats.and.returnValue(of(null));
      (component as any).loadAlerts();
      expect(component.lowStockCount).toBe(0);
      expect(component.failedWebhooksCount).toBe(0);
      expect(component.failedEmailsCount).toBe(0);
    });

    it('captures load errors from each source', () => {
      stubs.admin.summary.and.returnValue(throwError(() => new Error('a')));
      stubs.ops.getWebhookFailureStats.and.returnValue(throwError(() => new Error('b')));
      stubs.ops.getEmailFailureStats.and.returnValue(throwError(() => new Error('c')));
      (component as any).loadAlerts();
      expect(component.lowStockCount).toBe(0);
      expect(component.failedWebhooksCount).toBe(0);
      expect(component.failedEmailsCount).toBe(0);
      expect(component.alertsError).toBe('adminUi.alerts.errors.load');
    });

    it('skips fetches and ends loading when no sections are accessible', () => {
      stubs.auth.canAccessAdminSection.and.returnValue(false);
      (component as any).loadAlerts();
      expect(stubs.admin.summary).not.toHaveBeenCalled();
      expect(stubs.ops.getWebhookFailureStats).not.toHaveBeenCalled();
      expect(component.lowStockCount).toBe(0);
      expect(component.failedWebhooksCount).toBe(0);
      expect(component.failedEmailsCount).toBe(0);
      expect(component.alertsLoading).toBeFalse();
    });
  });

  describe('recomputeNavViews', () => {
    function recompute(): void {
      (component as any).recomputeNavViews();
    }

    it('builds grouped views in advanced custom mode', () => {
      stubs.uiPrefs.preset.set('custom');
      stubs.uiPrefs.mode.set('advanced');
      recompute();
      expect(component.filteredNavItemsView.length).toBe(10);
      expect(component.groupedFilteredNavItemsView.some((g) => g.key === 'operationsSecurity')).toBeTrue();
      const dashboard = component.filteredNavItemsView.find((i) => i.section === 'dashboard');
      expect(dashboard?.highlightMatch).toBe('');
    });

    it('restricts items in simple (owner-basic section) mode', () => {
      stubs.uiPrefs.mode.set('simple');
      recompute();
      const sections = component.filteredNavItemsView.map((i) => i.section);
      expect(sections).not.toContain('users');
      expect(sections).toContain('dashboard');
    });

    it('restricts items in the owner_basic preset regardless of mode', () => {
      stubs.uiPrefs.preset.set('owner_basic');
      stubs.uiPrefs.mode.set('advanced');
      recompute();
      const sections = component.filteredNavItemsView.map((i) => i.section);
      expect(sections).not.toContain('coupons');
    });

    it('filters by query and produces highlight segments', () => {
      component.navQuery = 'dash';
      recompute();
      expect(component.filteredNavItemsView.length).toBe(1);
      const view = component.filteredNavItemsView[0];
      expect(view.highlightMatch.toLowerCase()).toBe('dash');
      expect(view.highlightBefore + view.highlightMatch + view.highlightAfter).toBe(view.label);
    });

    it('matches by section when the label does not match the query', () => {
      stubs.translate.instant = () => 'Untranslated';
      component.navQuery = 'ops';
      recompute();
      const sections = component.filteredNavItemsView.map((i) => i.section);
      expect(sections).toContain('ops');
      expect(sections).not.toContain('dashboard');
    });

    it('derives favorites from page favorites, ignoring invalid and unknown entries', () => {
      stubs.favorites.items.set([
        { type: 'page', url: '/admin/orders' },
        { type: 'content', url: '/admin/content' },
        null,
        { type: 'page', url: '   ' },
        { type: 'page', url: '' },
        { type: 'page', url: null },
        { type: 'page', url: '/admin/legacy' },
      ]);
      component.navQuery = '';
      recompute();
      const favPaths = component.favoriteNavItemsView.map((i) => i.path);
      expect(favPaths).toEqual(['/admin/orders']);
      expect(component.filteredNavItemsView.find((i) => i.path === '/admin/orders')?.isFavorite).toBeTrue();
    });

    it('uses the operationsSecurity fallback group for unmapped sections', () => {
      const map = (component as any).sectionGroupMap as Record<string, string>;
      delete map['dashboard'];
      recompute();
      const opsGroup = component.groupedFilteredNavItemsView.find((g) => g.key === 'operationsSecurity');
      expect(opsGroup?.items.some((i) => i.section === 'dashboard')).toBeTrue();
    });

    it('drops items whose group key has no bucket', () => {
      (component as any).sectionGroupMap = {
        ...(component as any).sectionGroupMap,
        dashboard: 'nonexistentGroup',
      };
      recompute();
      const allItems = component.groupedFilteredNavItemsView.flatMap((g) => g.items);
      expect(allItems.some((i) => i.section === 'dashboard')).toBeFalse();
    });
  });

  describe('navLabel', () => {
    function label(key: string): string {
      return (component as any).navLabel({ labelKey: key, path: '/x', section: 's' });
    }

    it('returns the translated value when present', () => {
      stubs.translate.instant = () => 'Dashboard';
      expect(label('adminUi.nav.dashboard')).toBe('Dashboard');
    });

    it('falls back to the label key for empty or non-string translations', () => {
      stubs.translate.instant = () => '   ';
      expect(label('adminUi.nav.dashboard')).toBe('adminUi.nav.dashboard');
      stubs.translate.instant = () => null;
      expect(label('adminUi.nav.orders')).toBe('adminUi.nav.orders');
    });
  });

  it('exposes an injector for effect scheduling', () => {
    expect(typeof (component as any).injector.get).toBe('function');
  });
});
