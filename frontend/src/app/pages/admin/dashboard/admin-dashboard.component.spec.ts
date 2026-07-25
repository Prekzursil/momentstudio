import { HttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';

import { AdminService, AdminSummary } from '../../../core/admin.service';
import { AdminOrdersService } from '../../../core/admin-orders.service';
import { AdminUsersService } from '../../../core/admin-users.service';
import { AdminCouponsV2Service } from '../../../core/admin-coupons-v2.service';
import { AuthService } from '../../../core/auth.service';
import { AdminFavoritesService } from '../../../core/admin-favorites.service';
import { AdminRecentService } from '../../../core/admin-recent.service';
import { ToastService } from '../../../core/toast.service';
import { MarkdownService } from '../../../core/markdown.service';
import { AdminDashboardComponent } from './admin-dashboard.component';

function buildSummary(overrides: Partial<AdminSummary> = {}): AdminSummary {
  return {
    products: 5,
    orders: 10,
    users: 20,
    low_stock: 3,
    sales_30d: 1000,
    gross_sales_30d: 1200,
    net_sales_30d: 1000,
    orders_30d: 40,
    sales_range: 800,
    gross_sales_range: 900,
    net_sales_range: 800,
    orders_range: 30,
    range_days: 30,
    range_from: '2026-01-01',
    range_to: '2026-01-31',
    today_orders: 4,
    yesterday_orders: 2,
    orders_delta_pct: 100,
    today_sales: 500,
    yesterday_sales: 400,
    sales_delta_pct: 25,
    gross_today_sales: 600,
    gross_yesterday_sales: 500,
    gross_sales_delta_pct: 20,
    net_today_sales: 500,
    net_yesterday_sales: 400,
    net_sales_delta_pct: 25,
    today_refunds: 1,
    yesterday_refunds: 0,
    refunds_delta_pct: null,
    ...overrides,
  } as AdminSummary;
}

describe('AdminDashboardComponent', () => {
  let admin: jasmine.SpyObj<AdminService>;
  let ordersApi: jasmine.SpyObj<AdminOrdersService>;
  let usersApi: jasmine.SpyObj<AdminUsersService>;
  let couponsApi: jasmine.SpyObj<AdminCouponsV2Service>;
  let auth: jasmine.SpyObj<AuthService>;
  let favorites: jasmine.SpyObj<AdminFavoritesService>;
  let recent: jasmine.SpyObj<AdminRecentService>;
  let router: jasmine.SpyObj<Router>;
  let toast: jasmine.SpyObj<ToastService>;
  let markdown: jasmine.SpyObj<MarkdownService>;
  let http: jasmine.SpyObj<HttpClient>;

  beforeEach(async () => {
    localStorage.clear();

    admin = jasmine.createSpyObj<AdminService>('AdminService', [
      'summary',
      'channelBreakdown',
      'paymentsHealth',
      'refundsBreakdown',
      'shippingPerformance',
      'stockoutImpact',
      'channelAttribution',
      'funnel',
      'scheduledTasks',
      'sendScheduledReport',
      'globalSearch',
      'updateAlertThresholds',
      'auditEntries',
      'auditRetention',
      'purgeAuditRetention',
      'exportAuditCsv',
      'transferOwner',
    ]);
    ordersApi = jasmine.createSpyObj<AdminOrdersService>('AdminOrdersService', ['downloadExport']);
    usersApi = jasmine.createSpyObj<AdminUsersService>('AdminUsersService', [
      'listGdprExportJobs',
      'retryGdprExportJob',
      'downloadGdprExportJob',
    ]);
    couponsApi = jasmine.createSpyObj<AdminCouponsV2Service>('AdminCouponsV2Service', [
      'listAllBulkJobs',
      'cancelBulkJob',
      'retryBulkJob',
    ]);
    auth = jasmine.createSpyObj<AuthService>('AuthService', [
      'role',
      'canAccessAdminSection',
      'isAdmin',
      'user',
    ]);
    favorites = jasmine.createSpyObj<AdminFavoritesService>(
      'AdminFavoritesService',
      ['toggle', 'clear', 'isFavorite'],
      { items: signal([]), loading: signal(false) },
    );
    recent = jasmine.createSpyObj<AdminRecentService>('AdminRecentService', ['clear', 'add'], {
      items: signal([]),
    });
    router = jasmine.createSpyObj<Router>('Router', ['navigate', 'navigateByUrl']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);
    markdown = jasmine.createSpyObj<MarkdownService>('MarkdownService', ['render']);
    http = jasmine.createSpyObj<HttpClient>('HttpClient', ['get']);

    // Defaults so ngOnInit + change detection never explode.
    admin.summary.and.returnValue(of(buildSummary()));
    admin.channelBreakdown.and.returnValue(
      of({ payment_methods: [], couriers: [], delivery_types: [] } as any),
    );
    admin.paymentsHealth.and.returnValue(
      of({ window_hours: 24, providers: [], recent_webhook_errors: [] } as any),
    );
    admin.refundsBreakdown.and.returnValue(
      of({
        window_days: 30,
        missing_refunds: {
          current: { amount: 0, count: 0 },
          delta_pct: { count: null, amount: null },
        },
        providers: [],
        reasons: [],
      } as any),
    );
    admin.shippingPerformance.and.returnValue(
      of({ window_days: 30, time_to_ship: [], delivery_time: [] } as any),
    );
    admin.stockoutImpact.and.returnValue(of({ window_days: 30, items: [] } as any));
    admin.channelAttribution.and.returnValue(
      of({ tracked_orders: 0, total_orders: 0, coverage_pct: null, channels: [] } as any),
    );
    admin.funnel.and.returnValue(
      of({
        counts: { sessions: 100, carts: 50, checkouts: 30, orders: 10 },
        conversions: { to_cart: 0.5, to_checkout: 0.3, to_order: 0.1 },
      } as any),
    );
    admin.scheduledTasks.and.returnValue(of({ publish_schedules: [], promo_schedules: [] } as any));
    admin.sendScheduledReport.and.returnValue(of({ attempted: 1, delivered: 1 } as any));
    admin.globalSearch.and.returnValue(of({ items: [] } as any));
    admin.updateAlertThresholds.and.returnValue(of({} as any));
    admin.auditEntries.and.returnValue(
      of({ items: [], meta: { page: 1, limit: 20, total_items: 0, total_pages: 1 } } as any),
    );
    admin.auditRetention.and.returnValue(
      of({
        policies: {
          product: { enabled: true, days: 90 },
          content: { enabled: false, days: 0 },
          security: { enabled: true, days: 365 },
        },
        counts: {
          product: { total: 0, expired: 0 },
          content: { total: 0, expired: 0 },
          security: { total: 0, expired: 0 },
        },
      } as any),
    );
    admin.purgeAuditRetention.and.returnValue(of({ dry_run: true, deleted: {} } as any));
    admin.exportAuditCsv.and.returnValue(of(new Blob()));
    admin.transferOwner.and.returnValue(of({} as any));

    ordersApi.downloadExport.and.returnValue(of(new Blob()));
    usersApi.listGdprExportJobs.and.returnValue(of({ items: [] } as any));
    usersApi.retryGdprExportJob.and.returnValue(of({} as any));
    usersApi.downloadGdprExportJob.and.returnValue(of(new Blob()));
    couponsApi.listAllBulkJobs.and.returnValue(of([] as any));
    couponsApi.cancelBulkJob.and.returnValue(of({} as any));
    couponsApi.retryBulkJob.and.returnValue(of({} as any));

    auth.role.and.returnValue('owner');
    auth.canAccessAdminSection.and.returnValue(true);
    auth.isAdmin.and.returnValue(true);
    auth.user.and.returnValue({ id: 'u1' } as any);

    favorites.isFavorite.and.returnValue(false);
    http.get.and.returnValue(of('# hello') as any);
    markdown.render.and.returnValue('<p>hello</p>');

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminDashboardComponent],
      providers: [
        { provide: AdminService, useValue: admin },
        { provide: AdminOrdersService, useValue: ordersApi },
        { provide: AdminUsersService, useValue: usersApi },
        { provide: AdminCouponsV2Service, useValue: couponsApi },
        { provide: AuthService, useValue: auth },
        { provide: AdminFavoritesService, useValue: favorites },
        { provide: AdminRecentService, useValue: recent },
        { provide: Router, useValue: router },
        { provide: ToastService, useValue: toast },
        { provide: MarkdownService, useValue: markdown },
        { provide: HttpClient, useValue: http },
      ],
    }).compileComponents();
  });

  function instance(): AdminDashboardComponent {
    return TestBed.createComponent(AdminDashboardComponent).componentInstance;
  }

  function rendered(): ComponentFixture<AdminDashboardComponent> {
    const fixture = TestBed.createComponent(AdminDashboardComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders and runs ngOnInit loaders', () => {
    const fixture = rendered();
    expect(admin.summary).toHaveBeenCalled();
    expect(admin.funnel).toHaveBeenCalled();
    expect(admin.channelBreakdown).toHaveBeenCalled();
    expect(admin.scheduledTasks).toHaveBeenCalled();
    expect(fixture.componentInstance.loading()).toBeFalse();
    expect(fixture.componentInstance.summary()).toBeTruthy();
  });

  it('skips section loads when sections are inaccessible', () => {
    auth.canAccessAdminSection.and.returnValue(false);
    auth.role.and.returnValue('support');
    const fixture = rendered();
    expect(admin.paymentsHealth).not.toHaveBeenCalled();
    expect(admin.refundsBreakdown).not.toHaveBeenCalled();
    expect(admin.channelAttribution).not.toHaveBeenCalled();
    expect(fixture.componentInstance.gdprExportJobs().length).toBe(0);
  });

  describe('ngAfterViewInit focus handling', () => {
    // history.state is a native accessor and history.replaceState is a no-op in
    // the karma harness; install a deterministic getter on the window.history
    // instance per-test so the focus branch is reproducible regardless of order.
    let stateValue: unknown;

    beforeEach(() => {
      stateValue = {};
      Object.defineProperty(window.history, 'state', {
        configurable: true,
        get: () => stateValue,
      });
    });

    afterEach(() => {
      delete (window.history as unknown as Record<string, unknown>)['state'];
    });

    it('does nothing when focusGlobalSearch is not set', fakeAsync(() => {
      stateValue = { focusGlobalSearch: false };
      const cmp = instance();
      cmp.ngAfterViewInit();
      tick(1);
      expect(cmp.globalSearchOpen()).toBeFalse();
    }));

    it('focuses and clears history state when requested', fakeAsync(() => {
      stateValue = { focusGlobalSearch: true, keep: 1 };
      // Confirm the getter override is actually visible to the component.
      expect((history.state as { focusGlobalSearch?: boolean })?.focusGlobalSearch).toBeTrue();
      const replaceSpy = spyOn(history, 'replaceState');
      // Render so the real #globalSearchInput @ViewChild resolves to a live input.
      const fixture = TestBed.createComponent(AdminDashboardComponent);
      fixture.detectChanges();
      const cmp = fixture.componentInstance;
      const input = cmp.globalSearchInput!.nativeElement;
      const focusSpy = spyOn(input, 'focus');
      const selectSpy = spyOn(input, 'select');
      cmp.ngAfterViewInit();
      flush();
      expect(cmp.globalSearchOpen()).toBeTrue();
      expect(focusSpy).toHaveBeenCalled();
      expect(selectSpy).toHaveBeenCalled();
      const writtenState = replaceSpy.calls.mostRecent().args[0] as {
        focusGlobalSearch?: boolean;
        keep?: number;
      };
      expect(writtenState.focusGlobalSearch).toBeUndefined();
      expect(writtenState.keep).toBe(1);
    }));

    it('tolerates history write failures', fakeAsync(() => {
      stateValue = { focusGlobalSearch: true };
      const cmp = instance();
      spyOn(history, 'replaceState').and.throwError('blocked');
      expect(() => {
        cmp.ngAfterViewInit();
        tick(1);
      }).not.toThrow();
    }));
  });

  describe('recent + favorites', () => {
    it('clears recent and favorites', () => {
      const cmp = instance();
      cmp.clearRecent();
      cmp.clearFavorites();
      expect(recent.clear).toHaveBeenCalled();
      expect(favorites.clear).toHaveBeenCalled();
    });

    it('opens recent items only with a url, passing state when present', () => {
      const cmp = instance();
      cmp.openRecent({ url: '   ' } as any);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
      cmp.openRecent({ url: '/admin/x', state: { a: 1 } } as any);
      expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/x', { state: { a: 1 } });
      router.navigateByUrl.calls.reset();
      cmp.openRecent({ url: '/admin/y' } as any);
      expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/y', undefined);
    });

    it('opens favorite items only with a url, passing state when present', () => {
      const cmp = instance();
      cmp.openFavorite({ url: '' } as any);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
      cmp.openFavorite({ url: '/admin/f', state: { b: 2 } } as any);
      expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/f', { state: { b: 2 } });
      router.navigateByUrl.calls.reset();
      cmp.openFavorite({ url: '/admin/g' } as any);
      expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/g', undefined);
    });

    it('toggles favorites with and without an event', () => {
      const cmp = instance();
      const event = jasmine.createSpyObj<MouseEvent>('MouseEvent', [
        'preventDefault',
        'stopPropagation',
      ]);
      cmp.toggleFavorite({ key: 'k' } as any, event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(favorites.toggle).toHaveBeenCalled();
      cmp.toggleFavorite({ key: 'k2' } as any);
      expect(favorites.toggle).toHaveBeenCalledTimes(2);
    });
  });

  describe('navigation helpers', () => {
    it('reports owner role', () => {
      const cmp = instance();
      expect(cmp.isOwner()).toBeTrue();
      auth.role.and.returnValue('admin');
      expect(cmp.isOwner()).toBeFalse();
    });

    it('navigates to static admin sections', () => {
      const cmp = instance();
      cmp.openProducts();
      cmp.openOrders();
      cmp.openUsers();
      cmp.openInventory();
      cmp.openStockouts();
      cmp.goToGdprJobs();
      cmp.goToCoupons();
      cmp.openRefundRequests();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/products');
      expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/inventory');
      expect(router.navigate).toHaveBeenCalledWith(['/admin/returns'], {
        queryParams: { status: 'requested' },
      });
    });

    it('opens filtered order views', () => {
      const cmp = instance();
      cmp.openOrdersToday();
      cmp.openSalesToday();
      cmp.openRefunds();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/orders', jasmine.any(Object));
    });

    it('opens failed payments using configured then fallback window', () => {
      const cmp = instance();
      cmp.summary.set(
        buildSummary({
          anomalies: {
            failed_payments: { window_hours: 12, current: 5, previous: 1, delta_pct: 1 },
            refund_requests: { current: 0, previous: 0, delta_pct: null },
            stockouts: { count: 0 },
          } as any,
        }),
      );
      cmp.openFailedPayments();
      cmp.summary.set(
        buildSummary({
          anomalies: {
            failed_payments: { window_hours: 0, current: 5, previous: 1, delta_pct: 1 },
            refund_requests: { current: 0, previous: 0, delta_pct: null },
            stockouts: { count: 0 },
          } as any,
        }),
      );
      cmp.openFailedPayments();
      expect(router.navigateByUrl).toHaveBeenCalledTimes(2);
    });

    it('opens range views with and without summary range', () => {
      const cmp = instance();
      cmp.summary.set(buildSummary({ range_from: '2026-01-01', range_to: '2026-01-10' }));
      cmp.openOrdersRange();
      cmp.openSalesRange();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/orders', jasmine.any(Object));
      router.navigateByUrl.calls.reset();
      cmp.summary.set(buildSummary({ range_from: '', range_to: '' }));
      cmp.openOrdersRange();
      cmp.openSalesRange();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/orders');
    });

    it('navigates to create flows and global search results', () => {
      const cmp = instance();
      cmp.goToCreateProduct();
      cmp.goToCreateCoupon();
      cmp.selectGlobalSearch({ type: 'order', id: 'o1' } as any);
      expect(router.navigate).toHaveBeenCalledWith(['/admin/orders', 'o1']);
      cmp.selectGlobalSearch(
        { type: 'product', slug: 'p1' } as any,
        {
          preventDefault: () => undefined,
        } as any,
      );
      expect(router.navigate).toHaveBeenCalledWith(['/admin/products'], {
        state: { editProductSlug: 'p1' },
      });
      cmp.selectGlobalSearch({ type: 'user', email: 'a@b.c' } as any);
      expect(router.navigate).toHaveBeenCalledWith(['/admin/users'], {
        state: { prefillUserSearch: 'a@b.c', autoSelectFirst: true },
      });
    });
  });

  describe('refresh + live refresh', () => {
    it('refreshNow does nothing while loading', () => {
      const cmp = instance();
      cmp.loading.set(true);
      cmp.refreshNow();
      expect(admin.summary).not.toHaveBeenCalled();
    });

    it('refreshNow triggers silent reloads when not loading', () => {
      const cmp = instance();
      cmp.loading.set(false);
      cmp.refreshNow();
      expect(admin.summary).toHaveBeenCalled();
      expect(admin.funnel).toHaveBeenCalled();
      expect(admin.scheduledTasks).toHaveBeenCalled();
    });

    it('toggleLiveRefresh enables then disables the timer', fakeAsync(() => {
      const cmp = instance();
      cmp.loading.set(false);
      cmp.toggleLiveRefresh();
      expect(cmp.liveRefreshEnabled()).toBeTrue();
      tick(60 * 1000);
      cmp.toggleLiveRefresh();
      expect(cmp.liveRefreshEnabled()).toBeFalse();
      tick(60 * 1000);
    }));
  });

  describe('sales metric selectors', () => {
    it('returns zero values when no summary', () => {
      const cmp = instance();
      cmp.summary.set(null);
      expect(cmp.todaySales()).toBe(0);
      expect(cmp.yesterdaySales()).toBe(0);
      expect(cmp.salesDeltaPct()).toBeNull();
      expect(cmp.rangeSales()).toBe(0);
    });

    it('returns net and gross values based on metric', () => {
      const cmp = instance();
      cmp.summary.set(buildSummary());
      cmp.setSalesMetric('net');
      expect(cmp.todaySales()).toBe(500);
      expect(cmp.yesterdaySales()).toBe(400);
      expect(cmp.salesDeltaPct()).toBe(25);
      expect(cmp.rangeSales()).toBe(800);
      cmp.setSalesMetric('gross');
      expect(cmp.todaySales()).toBe(600);
      expect(cmp.yesterdaySales()).toBe(500);
      expect(cmp.salesDeltaPct()).toBe(20);
      expect(cmp.rangeSales()).toBe(900);
    });

    it('channelSales picks gross/net and tolerates nullish rows', () => {
      const cmp = instance();
      cmp.setSalesMetric('gross');
      expect(cmp.channelSales({ gross_sales: 7, net_sales: 3 })).toBe(7);
      cmp.setSalesMetric('net');
      expect(cmp.channelSales({ gross_sales: 7, net_sales: 3 })).toBe(3);
      expect(cmp.channelSales(null as any)).toBe(0);
    });

    it('formats channel keys', () => {
      const cmp = instance();
      expect(cmp.formatChannelKey('')).toBe('—');
      expect(cmp.formatChannelKey('credit_card')).toBe('credit card');
    });
  });

  describe('access guards + label keys', () => {
    it('reports section visibility', () => {
      const cmp = instance();
      expect(cmp.shouldShowJobsPanel()).toBeTrue();
      expect(cmp.canShowPaymentsHealth()).toBeTrue();
      expect(cmp.canShowRefundsBreakdown()).toBeTrue();
      expect(cmp.canShowShippingPerformance()).toBeTrue();
      expect(cmp.canShowStockoutImpact()).toBeTrue();
      expect(cmp.canShowChannelAttribution()).toBeTrue();
      expect(cmp.canManageGdprJobs()).toBeTrue();
      expect(cmp.canManageCouponJobs()).toBeTrue();
    });

    it('maps provider/reason label keys', () => {
      const cmp = instance();
      expect(cmp.paymentsProviderLabelKey('stripe')).toContain('providers.stripe');
      expect(cmp.paymentsProviderLabelKey('mystery')).toContain('providers.unknown');
      expect(cmp.supportsWebhookMetrics('stripe')).toBeTrue();
      expect(cmp.supportsWebhookMetrics('cod')).toBeFalse();
      expect(cmp.refundProviderLabelKey('manual')).toContain('providers.manual');
      expect(cmp.refundProviderLabelKey('mystery')).toContain('providers.unknown');
      expect(cmp.refundReasonLabelKey('damaged')).toContain('reasons.damaged');
      expect(cmp.refundReasonLabelKey('mystery')).toContain('reasons.other');
    });
  });

  describe('background jobs', () => {
    it('clears jobs when the panel is not allowed', () => {
      auth.canAccessAdminSection.and.returnValue(false);
      const cmp = instance();
      cmp.loadBackgroundJobs();
      expect(cmp.gdprExportJobs().length).toBe(0);
      expect(cmp.couponBulkJobs().length).toBe(0);
      expect(cmp.jobsLoading()).toBeFalse();
    });

    it('loads gdpr and coupon jobs and slices to 5', () => {
      usersApi.listGdprExportJobs.and.returnValue(
        of({ items: Array.from({ length: 7 }, (_, i) => ({ id: `g${i}` })) } as any),
      );
      couponsApi.listAllBulkJobs.and.returnValue(
        of(Array.from({ length: 6 }, (_, i) => ({ id: `c${i}` })) as any),
      );
      const cmp = instance();
      cmp.loadBackgroundJobs();
      expect(cmp.gdprExportJobs().length).toBe(5);
      expect(cmp.couponBulkJobs().length).toBe(5);
      expect(cmp.jobsLoading()).toBeFalse();
    });

    it('handles non-array job payloads and load errors', () => {
      usersApi.listGdprExportJobs.and.returnValue(of({ items: null } as any));
      couponsApi.listAllBulkJobs.and.returnValue(throwError(() => new Error('boom')));
      const cmp = instance();
      cmp.loadBackgroundJobs();
      expect(cmp.gdprExportJobs().length).toBe(0);
      expect(cmp.jobsError()).toBeTruthy();
    });

    it('handles a gdpr error branch', () => {
      usersApi.listGdprExportJobs.and.returnValue(throwError(() => new Error('boom')));
      const cmp = instance();
      cmp.loadBackgroundJobs();
      expect(cmp.jobsError()).toBeTruthy();
    });

    it('clears jobs lists per-section when only one section allowed', () => {
      auth.canAccessAdminSection.and.callFake((s: string) => s === 'users');
      const cmp = instance();
      cmp.loadBackgroundJobs();
      expect(cmp.couponBulkJobs().length).toBe(0);
      auth.canAccessAdminSection.and.callFake((s: string) => s === 'coupons');
      cmp.loadBackgroundJobs();
      expect(cmp.gdprExportJobs().length).toBe(0);
    });
  });

  describe('progress + job actions', () => {
    it('clamps progress percentages', () => {
      const cmp = instance();
      expect(cmp.progressPct('nope')).toBe(0);
      expect(cmp.progressPct(-5)).toBe(0);
      expect(cmp.progressPct(150)).toBe(100);
      expect(cmp.progressPct(42)).toBe(42);
    });

    it('computes coupon progress', () => {
      const cmp = instance();
      expect(cmp.couponProgressPct({ processed: 'x', total_candidates: 0 } as any)).toBe(0);
      expect(cmp.couponProgressPct({ processed: 5, total_candidates: 10 } as any)).toBe(50);
    });

    it('guards gdpr retry/download by permission and id', () => {
      const cmp = instance();
      auth.isAdmin.and.returnValue(false);
      cmp.retryGdprExport({ id: 'g1' } as any);
      cmp.downloadGdprExport({ id: 'g1' } as any);
      expect(usersApi.retryGdprExportJob).not.toHaveBeenCalled();
      auth.isAdmin.and.returnValue(true);
      cmp.retryGdprExport({ id: '' } as any);
      cmp.downloadGdprExport({ id: '' } as any);
      expect(usersApi.retryGdprExportJob).not.toHaveBeenCalled();
    });

    it('retries gdpr export with confirm gate', () => {
      const cmp = instance();
      spyOn(window, 'confirm').and.returnValues(false, true);
      cmp.retryGdprExport({ id: 'g1' } as any);
      expect(usersApi.retryGdprExportJob).not.toHaveBeenCalled();
      cmp.retryGdprExport({ id: 'g1' } as any);
      expect(usersApi.retryGdprExportJob).toHaveBeenCalledWith('g1');
      expect(toast.success).toHaveBeenCalled();
      expect(cmp.gdprJobBusyId()).toBeNull();
    });

    it('handles gdpr retry error', () => {
      usersApi.retryGdprExportJob.and.returnValue(throwError(() => new Error('x')));
      const cmp = instance();
      spyOn(window, 'confirm').and.returnValue(true);
      cmp.retryGdprExport({ id: 'g1' } as any);
      expect(toast.error).toHaveBeenCalled();
      expect(cmp.gdprJobBusyId()).toBeNull();
    });

    it('downloads gdpr export and revokes the url', () => {
      const cmp = instance();
      const click = jasmine.createSpy('click');
      spyOn(document, 'createElement').and.returnValue({ click } as any);
      spyOn(window.URL, 'createObjectURL').and.returnValue('blob:1');
      const revoke = spyOn(window.URL, 'revokeObjectURL');
      cmp.downloadGdprExport({ id: 'g1' } as any);
      expect(click).toHaveBeenCalled();
      expect(revoke).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalled();
    });

    it('handles gdpr download error', () => {
      usersApi.downloadGdprExportJob.and.returnValue(throwError(() => new Error('x')));
      const cmp = instance();
      cmp.downloadGdprExport({ id: 'g1' } as any);
      expect(toast.error).toHaveBeenCalled();
      expect(cmp.gdprJobBusyId()).toBeNull();
    });

    it('guards coupon cancel/retry by permission and id', () => {
      const cmp = instance();
      auth.canAccessAdminSection.and.returnValue(false);
      cmp.cancelCouponJob({ id: 'c1' } as any);
      cmp.retryCouponJob({ id: 'c1' } as any);
      expect(couponsApi.cancelBulkJob).not.toHaveBeenCalled();
      auth.canAccessAdminSection.and.returnValue(true);
      cmp.cancelCouponJob({ id: '' } as any);
      cmp.retryCouponJob({ id: '' } as any);
      expect(couponsApi.cancelBulkJob).not.toHaveBeenCalled();
    });

    it('cancels coupon job with confirm gate and success', () => {
      const cmp = instance();
      spyOn(window, 'confirm').and.returnValues(false, true);
      cmp.cancelCouponJob({ id: 'c1' } as any);
      expect(couponsApi.cancelBulkJob).not.toHaveBeenCalled();
      cmp.cancelCouponJob({ id: 'c1' } as any);
      expect(couponsApi.cancelBulkJob).toHaveBeenCalledWith('c1');
      expect(toast.success).toHaveBeenCalled();
    });

    it('handles coupon cancel error', () => {
      couponsApi.cancelBulkJob.and.returnValue(throwError(() => new Error('x')));
      const cmp = instance();
      spyOn(window, 'confirm').and.returnValue(true);
      cmp.cancelCouponJob({ id: 'c1' } as any);
      expect(toast.error).toHaveBeenCalled();
      expect(cmp.couponJobBusyId()).toBeNull();
    });

    it('retries coupon job with confirm gate and success/error', () => {
      const cmp = instance();
      const confirmSpy = spyOn(window, 'confirm').and.returnValues(false, true, true);
      cmp.retryCouponJob({ id: 'c1' } as any);
      expect(couponsApi.retryBulkJob).not.toHaveBeenCalled();
      cmp.retryCouponJob({ id: 'c1' } as any);
      expect(toast.success).toHaveBeenCalled();
      couponsApi.retryBulkJob.and.returnValue(throwError(() => new Error('x')));
      cmp.retryCouponJob({ id: 'c1' } as any);
      expect(toast.error).toHaveBeenCalled();
      expect(confirmSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('whats new', () => {
    it('renders markdown on success', () => {
      const cmp = instance();
      cmp.loadWhatsNew(true);
      expect(markdown.render).toHaveBeenCalled();
      expect(cmp.whatsNewHtml()).toBe('<p>hello</p>');
    });

    it('skips while loading and when already loaded without force', () => {
      const cmp = instance();
      cmp.whatsNewLoading.set(true);
      cmp.loadWhatsNew();
      expect(http.get).not.toHaveBeenCalled();
      cmp.whatsNewLoading.set(false);
      cmp.whatsNewHtml.set('<p>x</p>');
      cmp.loadWhatsNew();
      expect(http.get).not.toHaveBeenCalled();
    });

    it('clears html when markdown is blank', () => {
      http.get.and.returnValue(of('   ') as any);
      const cmp = instance();
      cmp.loadWhatsNew(true);
      expect(cmp.whatsNewHtml()).toBe('');
    });

    it('sets error on failure', () => {
      http.get.and.returnValue(throwError(() => new Error('x')) as any);
      const cmp = instance();
      cmp.loadWhatsNew(true);
      expect(cmp.whatsNewError()).toBeTruthy();
      expect(cmp.whatsNewLoading()).toBeFalse();
    });
  });

  describe('summary + section loaders', () => {
    it('retryDashboard reloads summary and breakdown', () => {
      const cmp = instance();
      admin.summary.calls.reset();
      cmp.retryDashboard();
      expect(admin.summary).toHaveBeenCalled();
      expect(admin.channelBreakdown).toHaveBeenCalled();
    });

    it('records summary load error', () => {
      admin.summary.and.returnValue(throwError(() => ({ headers: { get: () => 'req-1' } })));
      const cmp = instance();
      cmp.retryDashboard();
      expect(cmp.error()).toBeTruthy();
      expect(cmp.loading()).toBeFalse();
    });

    it('ignores silent summary refresh errors', () => {
      const cmp = instance();
      admin.summary.and.returnValue(throwError(() => new Error('x')));
      cmp.loading.set(false);
      expect(() => cmp.refreshNow()).not.toThrow();
    });

    it('loads channel breakdown error with and without detail', () => {
      admin.channelBreakdown.and.returnValue(throwError(() => ({ error: { detail: 'boom' } })));
      const cmp = instance();
      cmp.retryDashboard();
      expect(cmp.channelBreakdownError()).toBe('boom');
      admin.channelBreakdown.and.returnValue(throwError(() => ({})));
      cmp.retryDashboard();
      expect(cmp.channelBreakdownError()).toBeTruthy();
    });

    it('loads payments health, guarding double loads and errors', () => {
      const cmp = instance();
      admin.paymentsHealth.calls.reset();
      cmp.paymentsHealthLoading.set(true);
      cmp.loadPaymentsHealth();
      expect(admin.paymentsHealth).not.toHaveBeenCalled();
      cmp.paymentsHealthLoading.set(false);
      admin.paymentsHealth.and.returnValue(throwError(() => ({ error: { detail: 'd' } })));
      cmp.loadPaymentsHealth();
      expect(cmp.paymentsHealthError()).toBe('d');
      cmp.paymentsHealthLoading.set(false);
      admin.paymentsHealth.and.returnValue(throwError(() => ({})));
      cmp.loadPaymentsHealth();
      expect(cmp.paymentsHealthError()).toBeTruthy();
    });

    it('loads refunds breakdown with guard + errors', () => {
      const cmp = instance();
      cmp.refundsBreakdownLoading.set(true);
      cmp.loadRefundsBreakdown();
      cmp.refundsBreakdownLoading.set(false);
      admin.refundsBreakdown.and.returnValue(throwError(() => ({ error: { detail: 'd' } })));
      cmp.loadRefundsBreakdown();
      expect(cmp.refundsBreakdownError()).toBe('d');
      cmp.refundsBreakdownLoading.set(false);
      admin.refundsBreakdown.and.returnValue(throwError(() => ({})));
      cmp.loadRefundsBreakdown();
      expect(cmp.refundsBreakdownError()).toBeTruthy();
    });

    it('loads shipping performance with guard + errors', () => {
      const cmp = instance();
      cmp.shippingPerformanceLoading.set(true);
      cmp.loadShippingPerformance();
      cmp.shippingPerformanceLoading.set(false);
      admin.shippingPerformance.and.returnValue(throwError(() => ({ error: { detail: 'd' } })));
      cmp.loadShippingPerformance();
      expect(cmp.shippingPerformanceError()).toBe('d');
      cmp.shippingPerformanceLoading.set(false);
      admin.shippingPerformance.and.returnValue(throwError(() => ({})));
      cmp.loadShippingPerformance();
      expect(cmp.shippingPerformanceError()).toBeTruthy();
    });

    it('loads stockout impact with guard + errors', () => {
      const cmp = instance();
      cmp.stockoutImpactLoading.set(true);
      cmp.loadStockoutImpact();
      cmp.stockoutImpactLoading.set(false);
      admin.stockoutImpact.and.returnValue(throwError(() => ({ error: { detail: 'd' } })));
      cmp.loadStockoutImpact();
      expect(cmp.stockoutImpactError()).toBe('d');
      cmp.stockoutImpactLoading.set(false);
      admin.stockoutImpact.and.returnValue(throwError(() => ({})));
      cmp.loadStockoutImpact();
      expect(cmp.stockoutImpactError()).toBeTruthy();
    });

    it('loads channel attribution with guard + errors', () => {
      const cmp = instance();
      cmp.channelAttributionLoading.set(true);
      cmp.loadChannelAttribution();
      cmp.channelAttributionLoading.set(false);
      admin.channelAttribution.and.returnValue(throwError(() => ({ error: { detail: 'd' } })));
      cmp.loadChannelAttribution();
      expect(cmp.channelAttributionError()).toBe('d');
      cmp.channelAttributionLoading.set(false);
      admin.channelAttribution.and.returnValue(throwError(() => ({})));
      cmp.loadChannelAttribution();
      expect(cmp.channelAttributionError()).toBeTruthy();
    });

    it('uses custom-range params for channel attribution when set', () => {
      const cmp = instance();
      cmp.rangePreset = 'custom';
      cmp.rangeFrom = '';
      cmp.rangeTo = '';
      admin.channelAttribution.calls.reset();
      cmp.loadChannelAttribution();
      expect(admin.channelAttribution).toHaveBeenCalledWith({ range_days: 30, limit: 12 });
    });

    it('records funnel error and ignores silent refresh errors', () => {
      admin.funnel.and.returnValue(throwError(() => ({ error: { detail: 'fd' } })));
      const cmp = instance();
      cmp.onRangePresetChange();
      expect(cmp.funnelError()).toBe('fd');
      admin.funnel.and.returnValue(throwError(() => ({})));
      cmp.onRangePresetChange();
      expect(cmp.funnelError()).toBeTruthy();
      cmp.loading.set(false);
      expect(() => cmp.refreshNow()).not.toThrow();
    });
  });

  describe('window days resolution', () => {
    it('derives window days from range presets and custom dates', () => {
      const cmp = instance();
      cmp.rangePreset = '7';
      cmp.loadShippingPerformance();
      expect(admin.shippingPerformance).toHaveBeenCalledWith({ window_days: 7 });

      cmp.rangePreset = 'custom';
      cmp.rangeFrom = '';
      cmp.rangeTo = '';
      admin.stockoutImpact.calls.reset();
      cmp.loadStockoutImpact();
      expect(admin.stockoutImpact).toHaveBeenCalledWith({ window_days: 30, limit: 8 });

      cmp.rangeFrom = '2026-01-01';
      cmp.rangeTo = '2026-01-05';
      admin.stockoutImpact.calls.reset();
      cmp.loadStockoutImpact();
      expect(admin.stockoutImpact).toHaveBeenCalledWith({ window_days: 5, limit: 8 });

      cmp.rangeFrom = 'not-a-date';
      cmp.rangeTo = 'also-bad';
      admin.stockoutImpact.calls.reset();
      cmp.loadStockoutImpact();
      expect(admin.stockoutImpact).toHaveBeenCalledWith({ window_days: 30, limit: 8 });

      cmp.rangeFrom = '2026-01-10';
      cmp.rangeTo = '2026-01-01';
      admin.stockoutImpact.calls.reset();
      cmp.loadStockoutImpact();
      expect(admin.stockoutImpact).toHaveBeenCalledWith({ window_days: 30, limit: 8 });
    });
  });

  describe('preferences persistence', () => {
    it('restores live refresh + sales metric preferences', fakeAsync(() => {
      localStorage.setItem('admin.dashboard.liveRefresh.v1', JSON.stringify({ enabled: true }));
      localStorage.setItem('admin.dashboard.salesMetric.v1', JSON.stringify({ metric: 'gross' }));
      const cmp = instance();
      cmp.ngOnInit();
      expect(cmp.liveRefreshEnabled()).toBeTrue();
      expect(cmp.salesMetric()).toBe('gross');
      cmp.ngOnDestroy();
      tick(60 * 1000);
    }));

    it('ignores malformed preference payloads', () => {
      localStorage.setItem('admin.dashboard.liveRefresh.v1', '{bad');
      localStorage.setItem('admin.dashboard.salesMetric.v1', '{bad');
      const cmp = instance();
      expect(() => cmp.ngOnInit()).not.toThrow();
      expect(cmp.liveRefreshEnabled()).toBeFalse();
    });

    it('returns early when preference keys are absent', () => {
      const cmp = instance();
      cmp.ngOnInit();
      expect(cmp.salesMetric()).toBe('net');
    });

    it('persists preferences without throwing when storage fails', () => {
      const cmp = instance();
      spyOn(localStorage, 'setItem').and.throwError('full');
      expect(() => cmp.setSalesMetric('gross')).not.toThrow();
      expect(() => cmp.toggleLiveRefresh()).not.toThrow();
    });
  });

  describe('onboarding', () => {
    it('opens, dismisses, completes and navigates', () => {
      const cmp = instance();
      cmp.openOnboarding();
      expect(cmp.onboardingOpen()).toBeTrue();
      cmp.dismissOnboarding();
      expect(cmp.onboardingOpen()).toBeFalse();
      cmp.completeOnboarding();
      cmp.goToOnboarding('/admin/products');
      expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/products');
    });

    it('shows onboarding for owners only when not completed/recently dismissed', () => {
      const cmp = instance();
      auth.role.and.returnValue('admin');
      cmp.onboardingOpen.set(false);
      cmp.ngOnInit();
      expect(cmp.onboardingOpen()).toBeFalse();

      auth.role.and.returnValue('owner');
      localStorage.setItem('admin.onboarding.v1', JSON.stringify({ completed_at: 'x' }));
      cmp.onboardingOpen.set(false);
      cmp.ngOnInit();
      expect(cmp.onboardingOpen()).toBeFalse();

      localStorage.setItem(
        'admin.onboarding.v1',
        JSON.stringify({ dismissed_at: new Date().toISOString() }),
      );
      cmp.onboardingOpen.set(false);
      cmp.ngOnInit();
      expect(cmp.onboardingOpen()).toBeFalse();

      localStorage.setItem(
        'admin.onboarding.v1',
        JSON.stringify({ dismissed_at: '2000-01-01T00:00:00Z' }),
      );
      cmp.onboardingOpen.set(false);
      cmp.ngOnInit();
      expect(cmp.onboardingOpen()).toBeTrue();
    });

    it('shows onboarding when dismissed_at is unparseable', () => {
      localStorage.setItem('admin.onboarding.v1', JSON.stringify({ dismissed_at: 'not-a-date' }));
      const cmp = instance();
      cmp.onboardingOpen.set(false);
      cmp.ngOnInit();
      expect(cmp.onboardingOpen()).toBeTrue();
    });

    it('reads empty/invalid onboarding state safely', () => {
      const cmp = instance();
      spyOn(localStorage, 'getItem').and.throwError('blocked');
      cmp.onboardingOpen.set(false);
      expect(() => cmp.ngOnInit()).not.toThrow();
    });

    it('handles non-object stored onboarding state and save failures', () => {
      localStorage.setItem('admin.onboarding.v1', JSON.stringify('string-value'));
      const cmp = instance();
      cmp.onboardingOpen.set(false);
      cmp.ngOnInit();
      expect(cmp.onboardingOpen()).toBeTrue();
      spyOn(localStorage, 'setItem').and.throwError('full');
      expect(() => cmp.dismissOnboarding()).not.toThrow();
    });
  });

  describe('scheduled tasks + reports', () => {
    it('records scheduled tasks load error', () => {
      admin.scheduledTasks.and.returnValue(throwError(() => new Error('x')));
      const cmp = instance();
      cmp.loadScheduledTasks();
      expect(cmp.scheduledError()).toBeTruthy();
      expect(cmp.scheduledLoading()).toBeFalse();
    });

    it('runs a scheduled report (success, skipped, busy, error)', () => {
      const cmp = instance();
      cmp.runScheduledReport('daily' as any);
      expect(toast.success).toHaveBeenCalled();
      expect(cmp.scheduledRunBusy()).toBeNull();

      cmp.scheduledRunBusy.set('weekly' as any);
      admin.sendScheduledReport.calls.reset();
      cmp.runScheduledReport('daily' as any);
      expect(admin.sendScheduledReport).not.toHaveBeenCalled();
      cmp.scheduledRunBusy.set(null);

      admin.sendScheduledReport.and.returnValue(of({ skipped: true } as any));
      cmp.runScheduledReport('daily' as any);
      expect(toast.info).toHaveBeenCalled();

      admin.sendScheduledReport.and.returnValue(throwError(() => ({ error: { detail: 'sd' } })));
      cmp.runScheduledReport('daily' as any);
      expect(cmp.scheduledRunError()).toBe('sd');
      admin.sendScheduledReport.and.returnValue(throwError(() => ({})));
      cmp.runScheduledReport('daily' as any);
      expect(cmp.scheduledRunError()).toBeTruthy();
    });
  });

  describe('range controls', () => {
    it('reloads on preset change unless custom', () => {
      const cmp = instance();
      admin.summary.calls.reset();
      cmp.rangePreset = '7';
      cmp.onRangePresetChange();
      expect(admin.summary).toHaveBeenCalled();
      admin.summary.calls.reset();
      cmp.rangePreset = 'custom';
      cmp.onRangePresetChange();
      expect(admin.summary).not.toHaveBeenCalled();
    });

    it('applyRange handles non-custom, missing dates, bad order and valid custom', () => {
      const cmp = instance();
      cmp.rangePreset = '30';
      admin.summary.calls.reset();
      cmp.applyRange();
      expect(admin.summary).toHaveBeenCalled();

      cmp.rangePreset = 'custom';
      cmp.rangeFrom = '';
      cmp.rangeTo = '';
      cmp.applyRange();
      expect(cmp.rangeError).toBeTruthy();

      cmp.rangeFrom = '2026-02-10';
      cmp.rangeTo = '2026-02-01';
      cmp.applyRange();
      expect(cmp.rangeError).toBeTruthy();

      cmp.rangeFrom = '2026-02-01';
      cmp.rangeTo = '2026-02-10';
      admin.summary.calls.reset();
      cmp.applyRange();
      expect(admin.summary).toHaveBeenCalled();
      expect(admin.channelAttribution).toHaveBeenCalled();
    });

    it('builds summary params for custom and numeric presets', () => {
      const cmp = instance();
      cmp.rangePreset = 'custom';
      cmp.rangeFrom = '2026-03-01';
      cmp.rangeTo = '2026-03-05';
      admin.summary.calls.reset();
      cmp.onRangePresetChange();
      cmp.applyRange();
      expect(admin.summary).toHaveBeenCalledWith({
        range_from: '2026-03-01',
        range_to: '2026-03-05',
      });
    });

    it('formats delta labels', () => {
      const cmp = instance();
      expect(cmp.deltaLabel(null)).toBe('—');
      expect(cmp.deltaLabel(undefined)).toBe('—');
      expect(cmp.deltaLabel(12.34)).toBe('+12.3%');
      expect(cmp.deltaLabel(-5)).toBe('-5%');
    });
  });

  describe('global search', () => {
    it('opens search and selects first available result', () => {
      const cmp = instance();
      cmp.globalSearchResults.set([{ type: 'order', id: '1' } as any]);
      cmp.globalSearchActiveIndex.set(-1);
      cmp.openGlobalSearch();
      expect(cmp.globalSearchOpen()).toBeTrue();
      expect(cmp.globalSearchActiveIndex()).toBe(0);
    });

    it('blur closes after timeout and clears prior handle', fakeAsync(() => {
      const cmp = instance();
      cmp.globalSearchOpen.set(true);
      cmp.onGlobalSearchBlur();
      cmp.onGlobalSearchBlur();
      tick(150);
      expect(cmp.globalSearchOpen()).toBeFalse();
    }));

    it('handles keyboard navigation keys', () => {
      const cmp = instance();
      cmp.globalSearchResults.set([
        { type: 'order', id: '1' } as any,
        { type: 'order', id: '2' } as any,
      ]);
      const mk = (key: string) =>
        ({ key, preventDefault: jasmine.createSpy('pd') }) as unknown as KeyboardEvent;

      cmp.globalSearchOpen.set(true);
      cmp.onGlobalSearchKeydown(mk('Escape'));
      expect(cmp.globalSearchOpen()).toBeFalse();

      cmp.onGlobalSearchKeydown(mk('ArrowDown'));
      cmp.onGlobalSearchKeydown(mk('ArrowDown'));
      expect(cmp.globalSearchActiveIndex()).toBe(1);
      cmp.onGlobalSearchKeydown(mk('ArrowUp'));
      expect(cmp.globalSearchActiveIndex()).toBe(0);
      cmp.onGlobalSearchKeydown(mk('End'));
      expect(cmp.globalSearchActiveIndex()).toBe(1);
      cmp.onGlobalSearchKeydown(mk('Home'));
      expect(cmp.globalSearchActiveIndex()).toBe(0);

      cmp.onGlobalSearchKeydown(mk('Tab'));
      cmp.onGlobalSearchKeydown(mk('Enter'));
      expect(router.navigate).toHaveBeenCalled();
    });

    it('enter with no results does nothing', () => {
      const cmp = instance();
      cmp.globalSearchResults.set([]);
      cmp.globalSearchActiveIndex.set(-1);
      cmp.onGlobalSearchKeydown({
        key: 'Enter',
        preventDefault: () => undefined,
      } as unknown as KeyboardEvent);
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('debounces queries and ignores short needles', fakeAsync(() => {
      const cmp = instance();
      cmp.globalSearchQuery = 'a';
      cmp.onGlobalSearchChange();
      expect(cmp.globalSearchResults().length).toBe(0);

      admin.globalSearch.and.returnValue(of({ items: [{ type: 'order', id: '1' }] } as any));
      cmp.globalSearchQuery = 'shoe';
      cmp.onGlobalSearchChange();
      cmp.globalSearchQuery = 'shoes';
      cmp.onGlobalSearchChange();
      tick(250);
      expect(cmp.globalSearchResults().length).toBe(1);
      expect(cmp.globalSearchActiveIndex()).toBe(0);
    }));

    it('runGlobalSearch handles empty results and errors and stale responses', fakeAsync(() => {
      const cmp = instance();
      admin.globalSearch.and.returnValue(of({ items: [] } as any));
      cmp.globalSearchQuery = 'shoes';
      cmp.onGlobalSearchChange();
      tick(250);
      expect(cmp.globalSearchActiveIndex()).toBe(-1);

      admin.globalSearch.and.returnValue(throwError(() => new Error('x')));
      cmp.globalSearchQuery = 'boots';
      cmp.onGlobalSearchChange();
      tick(250);
      expect(cmp.globalSearchError).toBeTruthy();
    }));

    it('ignores stale next and error responses', () => {
      const cmp = instance();
      const internal = cmp as unknown as {
        globalSearchRequestId: number;
        runGlobalSearch: (n: string) => void;
      };
      // A newer request lands (id bumped further) before this emission resolves.
      admin.globalSearch.and.callFake(() => {
        internal.globalSearchRequestId += 10;
        return of({ items: [{ type: 'order', id: '1' }] } as any);
      });
      internal.runGlobalSearch('shoes');
      expect(cmp.globalSearchResults().length).toBe(0);

      admin.globalSearch.and.callFake(() => {
        internal.globalSearchRequestId += 10;
        return throwError(() => new Error('x'));
      });
      cmp.globalSearchError = '';
      internal.runGlobalSearch('boots');
      expect(cmp.globalSearchError).toBe('');
    });

    it('computes active descendant id', () => {
      const cmp = instance();
      cmp.globalSearchOpen.set(false);
      expect(cmp.globalSearchActiveDescendant()).toBeNull();
      cmp.globalSearchOpen.set(true);
      cmp.globalSearchResults.set([{ type: 'order', id: '1' } as any]);
      cmp.globalSearchActiveIndex.set(-1);
      expect(cmp.globalSearchActiveDescendant()).toBeNull();
      cmp.globalSearchActiveIndex.set(0);
      expect(cmp.globalSearchActiveDescendant()).toBe('admin-global-search-option-0');
    });

    it('move/set active are no-ops with empty results', () => {
      const cmp = instance();
      cmp.globalSearchResults.set([]);
      cmp.onGlobalSearchKeydown({
        key: 'ArrowDown',
        preventDefault: () => undefined,
      } as unknown as KeyboardEvent);
      expect(cmp.globalSearchActiveIndex()).toBe(-1);
      cmp.onGlobalSearchKeydown({
        key: 'Home',
        preventDefault: () => undefined,
      } as unknown as KeyboardEvent);
      expect(cmp.globalSearchActiveIndex()).toBe(-1);
    });

    it('scrolls the active option into view', fakeAsync(() => {
      const el = document.createElement('div');
      el.id = 'admin-global-search-option-0';
      const scrollSpy = spyOn(el, 'scrollIntoView');
      spyOn(document, 'getElementById').and.returnValue(el);
      const cmp = instance();
      cmp.globalSearchResults.set([{ type: 'order', id: '1' } as any]);
      cmp.onGlobalSearchKeydown({
        key: 'Home',
        preventDefault: () => undefined,
      } as unknown as KeyboardEvent);
      tick(0);
      expect(scrollSpy).toHaveBeenCalled();
    }));

    it('produces a translated type label', () => {
      const cmp = instance();
      expect(cmp.globalSearchTypeLabel('order' as any)).toContain('globalSearchTypes.order');
    });
  });

  describe('orders export', () => {
    it('downloads orders export and handles error', () => {
      const cmp = instance();
      const click = jasmine.createSpy('click');
      spyOn(document, 'createElement').and.returnValue({ click } as any);
      spyOn(URL, 'createObjectURL').and.returnValue('blob:1');
      const revoke = spyOn(URL, 'revokeObjectURL');
      cmp.downloadOrdersExport();
      expect(click).toHaveBeenCalled();
      expect(revoke).toHaveBeenCalled();

      ordersApi.downloadExport.and.returnValue(throwError(() => new Error('x')));
      cmp.downloadOrdersExport();
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('alert thresholds', () => {
    it('open is gated to owners and seeds from summary', () => {
      const cmp = instance();
      auth.role.and.returnValue('admin');
      cmp.openAlertThresholds();
      expect(cmp.alertThresholdsOpen()).toBeFalse();

      auth.role.and.returnValue('owner');
      cmp.summary.set(
        buildSummary({
          alert_thresholds: {
            failed_payments_min_count: 2,
            failed_payments_min_delta_pct: 10,
            refund_requests_min_count: 3,
            refund_requests_min_rate_pct: 5,
            stockouts_min_count: 4,
          } as any,
        }),
      );
      cmp.openAlertThresholds();
      expect(cmp.alertThresholdsOpen()).toBeTrue();
      expect(cmp.alertFailedPaymentsMinCount).toBe(2);
      cmp.closeAlertThresholds();
      expect(cmp.alertThresholdsOpen()).toBeFalse();
    });

    it('opens with no thresholds present', () => {
      const cmp = instance();
      cmp.summary.set(buildSummary({ alert_thresholds: undefined }));
      cmp.openAlertThresholds();
      expect(cmp.alertThresholdsOpen()).toBeTrue();
    });

    it('seeds nullable threshold fields to blank', () => {
      const cmp = instance();
      cmp.summary.set(
        buildSummary({
          alert_thresholds: {
            failed_payments_min_count: 1,
            failed_payments_min_delta_pct: null,
            refund_requests_min_count: 1,
            refund_requests_min_rate_pct: null,
            stockouts_min_count: 1,
          } as any,
        }),
      );
      cmp.openAlertThresholds();
      expect(cmp.alertFailedPaymentsMinDeltaPct).toBe('');
      expect(cmp.alertRefundRequestsMinRatePct).toBe('');
    });

    it('save is gated by owner and by in-flight saving', () => {
      const cmp = instance();
      auth.role.and.returnValue('admin');
      cmp.saveAlertThresholds();
      expect(admin.updateAlertThresholds).not.toHaveBeenCalled();
      auth.role.and.returnValue('owner');
      cmp.alertThresholdsSaving.set(true);
      cmp.saveAlertThresholds();
      expect(admin.updateAlertThresholds).not.toHaveBeenCalled();
    });

    it('rejects invalid threshold input', () => {
      const cmp = instance();
      cmp.alertThresholdsSaving.set(false);
      cmp.alertFailedPaymentsMinCount = 0;
      cmp.saveAlertThresholds();
      expect(cmp.alertThresholdsError()).toBeTruthy();
      expect(admin.updateAlertThresholds).not.toHaveBeenCalled();
    });

    it('saves valid thresholds and handles success + errors', () => {
      const cmp = instance();
      cmp.alertFailedPaymentsMinCount = 1;
      cmp.alertFailedPaymentsMinDeltaPct = 10;
      cmp.alertRefundRequestsMinCount = 1;
      cmp.alertRefundRequestsMinRatePct = 5;
      cmp.alertStockoutsMinCount = 1;
      admin.updateAlertThresholds.and.returnValue(
        of({
          failed_payments_min_count: 1,
          failed_payments_min_delta_pct: 10,
          refund_requests_min_count: 1,
          refund_requests_min_rate_pct: 5,
          stockouts_min_count: 1,
        } as any),
      );
      cmp.saveAlertThresholds();
      expect(toast.success).toHaveBeenCalled();
      expect(cmp.alertThresholdsOpen()).toBeFalse();

      admin.updateAlertThresholds.and.returnValue(throwError(() => ({ error: { detail: 'ad' } })));
      cmp.saveAlertThresholds();
      expect(cmp.alertThresholdsError()).toBe('ad');
      admin.updateAlertThresholds.and.returnValue(throwError(() => ({})));
      cmp.saveAlertThresholds();
      expect(cmp.alertThresholdsError()).toBeTruthy();
    });

    it('parses optional numbers across edge cases', () => {
      const cmp = instance() as unknown as {
        parseOptionalNumber: (v: unknown, o?: { max?: number }) => number | null | undefined;
      };
      expect(cmp.parseOptionalNumber(null)).toBeNull();
      expect(cmp.parseOptionalNumber('   ')).toBeNull();
      expect(cmp.parseOptionalNumber('abc')).toBeUndefined();
      expect(cmp.parseOptionalNumber(-1)).toBeUndefined();
      expect(cmp.parseOptionalNumber(200, { max: 100 })).toBeUndefined();
      expect(cmp.parseOptionalNumber(42)).toBe(42);
    });
  });

  describe('anomaly alerts', () => {
    it('returns failed payments alert via is_alert and fallback', () => {
      const cmp = instance();
      cmp.summary.set(buildSummary({ anomalies: undefined }));
      expect(cmp.failedPaymentsAlert()).toBeNull();
      cmp.summary.set(
        buildSummary({
          anomalies: {
            failed_payments: { current: 5, previous: 0, delta_pct: null, is_alert: true },
            refund_requests: { current: 0, previous: 0, delta_pct: null, is_alert: false },
            stockouts: { count: 0 },
          } as any,
        }),
      );
      expect(cmp.failedPaymentsAlert()).toBeTruthy();
      expect(cmp.refundRequestsAlert()).toBeNull();

      cmp.summary.set(
        buildSummary({
          anomalies: {
            failed_payments: { current: 0, previous: 0, delta_pct: null },
            refund_requests: { current: 3, previous: 0, delta_pct: null },
            stockouts: { count: 0 },
          } as any,
        }),
      );
      expect(cmp.failedPaymentsAlert()).toBeNull();
      expect(cmp.refundRequestsAlert()).toBeTruthy();
    });

    it('returns null refund alert when missing', () => {
      const cmp = instance();
      cmp.summary.set(buildSummary({ anomalies: undefined }));
      expect(cmp.refundRequestsAlert()).toBeNull();
    });

    it('computes stockouts alert count and hasAnomalyAlerts', () => {
      const cmp = instance();
      cmp.summary.set(
        buildSummary({
          anomalies: {
            failed_payments: { current: 0, previous: 0, delta_pct: null, is_alert: false },
            refund_requests: { current: 0, previous: 0, delta_pct: null, is_alert: false },
            stockouts: { count: 4, is_alert: true },
          } as any,
        }),
      );
      expect(cmp.stockoutsAlertCount()).toBe(4);
      expect(cmp.hasAnomalyAlerts()).toBeTrue();

      cmp.summary.set(
        buildSummary({
          anomalies: {
            failed_payments: { current: 0, previous: 0, delta_pct: null, is_alert: false },
            refund_requests: { current: 0, previous: 0, delta_pct: null, is_alert: false },
            stockouts: { count: 0 },
          } as any,
        }),
      );
      expect(cmp.stockoutsAlertCount()).toBeNull();
      expect(cmp.hasAnomalyAlerts()).toBeFalse();

      cmp.summary.set(
        buildSummary({
          anomalies: {
            failed_payments: { current: 0, previous: 0, delta_pct: null, is_alert: false },
            refund_requests: { current: 0, previous: 0, delta_pct: null, is_alert: false },
            stockouts: { count: 2 },
          } as any,
        }),
      );
      expect(cmp.stockoutsAlertCount()).toBe(2);
    });
  });

  describe('metric widgets', () => {
    it('toggles customize panel and lists widgets', () => {
      const cmp = instance();
      cmp.toggleCustomizeWidgets();
      expect(cmp.customizeWidgetsOpen()).toBeTrue();
      expect(cmp.metricWidgets()).toEqual(['kpis', 'counts', 'range']);
    });

    it('labels widgets', () => {
      const cmp = instance();
      expect(cmp.metricWidgetLabel('kpis')).toContain('widgets.kpis');
      expect(cmp.metricWidgetLabel('counts')).toContain('widgets.counts');
      expect(cmp.metricWidgetLabel('range')).toContain('widgets.range');
    });

    it('toggles hidden widgets and persists', () => {
      const cmp = instance();
      expect(cmp.isMetricWidgetHidden('kpis')).toBeFalse();
      cmp.toggleMetricWidget('kpis');
      expect(cmp.isMetricWidgetHidden('kpis')).toBeTrue();
    });

    it('moves widgets within bounds', () => {
      const cmp = instance();
      cmp.moveMetricWidget('nonexistent' as any, 1);
      expect(cmp.metricWidgets()).toEqual(['kpis', 'counts', 'range']);
      cmp.moveMetricWidget('kpis', -1);
      expect(cmp.metricWidgets()).toEqual(['kpis', 'counts', 'range']);
      cmp.moveMetricWidget('kpis', 1);
      expect(cmp.metricWidgets()).toEqual(['counts', 'kpis', 'range']);
    });

    it('restores widget prefs and filters invalid order entries', () => {
      auth.user.and.returnValue({ id: 'u9' } as any);
      localStorage.setItem(
        'admin_dashboard_widgets_v1:u9',
        JSON.stringify({ order: ['range', 'bogus', 'range'], hidden: { counts: true } }),
      );
      const cmp = instance();
      cmp.ngOnInit();
      expect(cmp.metricWidgets()[0]).toBe('range');
      expect(cmp.isMetricWidgetHidden('counts')).toBeTrue();
    });

    it('uses anon prefs key and ignores invalid prefs json', () => {
      auth.user.and.returnValue(null);
      localStorage.setItem('admin_dashboard_widgets_v1:anon', '{bad');
      const cmp = instance();
      expect(() => cmp.ngOnInit()).not.toThrow();
    });

    it('handles missing order array branch', () => {
      auth.user.and.returnValue({ id: 'u7' } as any);
      localStorage.setItem('admin_dashboard_widgets_v1:u7', JSON.stringify({ hidden: {} }));
      const cmp = instance();
      cmp.ngOnInit();
      expect(cmp.metricWidgets().length).toBe(3);
    });

    it('persists widget prefs without throwing on storage errors', () => {
      const cmp = instance();
      spyOn(localStorage, 'setItem').and.throwError('full');
      expect(() => cmp.toggleMetricWidget('range')).not.toThrow();
    });
  });

  describe('audit log', () => {
    it('loads audit entries on init and records errors', () => {
      const cmp = instance();
      cmp.applyAuditFilters();
      expect(admin.auditEntries).toHaveBeenCalled();
      admin.auditEntries.and.returnValue(throwError(() => new Error('x')));
      cmp.applyAuditFilters();
      expect(cmp.auditError()).toBeTruthy();
      expect(cmp.auditEntries()?.items.length).toBe(0);
    });

    it('passes trimmed action/user filters', () => {
      const cmp = instance();
      cmp.auditAction = '  create ';
      cmp.auditUser = ' me ';
      admin.auditEntries.calls.reset();
      cmp.applyAuditFilters();
      expect(admin.auditEntries).toHaveBeenCalledWith(
        jasmine.objectContaining({ action: 'create', user: 'me' }),
      );
    });

    it('loads audit retention and handles errors', () => {
      const cmp = instance();
      cmp.loadAuditRetention();
      expect(cmp.auditRetention()).toBeTruthy();
      admin.auditRetention.and.returnValue(throwError(() => new Error('x')));
      cmp.loadAuditRetention();
      expect(cmp.auditRetentionError()).toBeTruthy();
      expect(cmp.auditRetention()).toBeNull();
    });

    it('validates the purge confirm phrase', () => {
      const cmp = instance();
      cmp.auditRetentionConfirm = 'nope';
      expect(cmp.auditRetentionConfirmOk()).toBeFalse();
      cmp.auditRetentionConfirm = ' purge ';
      expect(cmp.auditRetentionConfirmOk()).toBeTrue();
    });

    it('purges retention (owner gate, dry-run, real, error)', () => {
      const cmp = instance();
      auth.role.and.returnValue('admin');
      cmp.purgeAuditRetention();
      expect(admin.purgeAuditRetention).not.toHaveBeenCalled();

      auth.role.and.returnValue('owner');
      admin.purgeAuditRetention.and.returnValue(
        of({ dry_run: true, deleted: { product: 1, content: 2, security: 3 } } as any),
      );
      cmp.purgeAuditRetention();
      expect(toast.success).toHaveBeenCalled();
      expect(cmp.auditRetentionPurgeLoading).toBeFalse();

      admin.purgeAuditRetention.and.returnValue(of({ dry_run: false, deleted: {} } as any));
      cmp.purgeAuditRetention();
      expect(toast.success).toHaveBeenCalledTimes(2);

      admin.purgeAuditRetention.and.returnValue(throwError(() => new Error('x')));
      cmp.purgeAuditRetention();
      expect(cmp.auditRetentionPurgeError).toBeTruthy();
    });

    it('applies audit presets and reports active preset', () => {
      const cmp = instance();
      (['all', 'security', 'content', 'catalog', 'payments'] as const).forEach((preset) => {
        cmp.applyAuditPreset(preset);
      });
      cmp.applyAuditPreset('security');
      expect(cmp.auditPresetActive('security')).toBeTrue();
      expect(cmp.auditPresetActive('payments')).toBeFalse();
    });

    it('handles pagination state and navigation', () => {
      const cmp = instance();
      const pageTwo = () =>
        cmp.auditEntries.set({
          items: [],
          meta: { page: 2, limit: 20, total_items: 60, total_pages: 3 },
        } as any);
      pageTwo();
      expect(cmp.auditHasPrev()).toBeTrue();
      expect(cmp.auditHasNext()).toBeTrue();

      admin.auditEntries.calls.reset();
      cmp.auditPrev();
      expect(admin.auditEntries).toHaveBeenCalledWith(jasmine.objectContaining({ page: 1 }));

      pageTwo();
      admin.auditEntries.calls.reset();
      cmp.auditNext();
      expect(admin.auditEntries).toHaveBeenCalledWith(jasmine.objectContaining({ page: 3 }));
    });

    it('guards pagination at boundaries and missing meta', () => {
      const cmp = instance();
      cmp.auditEntries.set(null);
      expect(cmp.auditHasNext()).toBeFalse();
      cmp.auditPrev();
      cmp.auditNext();
      cmp.auditEntries.set({
        items: [],
        meta: { page: 1, limit: 20, total_items: 0, total_pages: 1 },
      } as any);
      expect(cmp.auditHasPrev()).toBeFalse();
      admin.auditEntries.calls.reset();
      cmp.auditPrev();
      cmp.auditNext();
      expect(admin.auditEntries).not.toHaveBeenCalled();
    });

    it('labels audit entities', () => {
      const cmp = instance();
      expect(cmp.auditEntityLabel('product')).toContain('audit.products');
      expect(cmp.auditEntityLabel('content')).toContain('audit.content');
      expect(cmp.auditEntityLabel('security')).toContain('audit.security');
      expect(cmp.auditEntityLabel('all')).toContain('audit.entityAll');
    });

    it('decides whether audit entries can be opened', () => {
      const cmp = instance();
      expect(cmp.canOpenAuditEntry({ entity: 'product', ref_key: 'p' } as any)).toBeTrue();
      expect(cmp.canOpenAuditEntry({ entity: 'content', ref_key: '' } as any)).toBeFalse();
      expect(cmp.canOpenAuditEntry({ entity: 'security' } as any)).toBeFalse();
    });

    it('opens audit entries to the right destination', () => {
      const cmp = instance();
      cmp.openAuditEntry({ entity: 'product', ref_key: 'slug-1' } as any);
      expect(router.navigate).toHaveBeenCalledWith(['/admin/products'], {
        state: { editProductSlug: 'slug-1' },
      });
      cmp.openAuditEntry({ entity: 'product', ref_key: '' } as any);

      router.navigate.calls.reset();
      cmp.openAuditEntry({ entity: 'content', ref_key: '' } as any);
      expect(router.navigate).not.toHaveBeenCalled();

      cmp.openAuditEntry({ entity: 'content', ref_key: 'page.home' } as any);
      expect(router.navigate).toHaveBeenCalledWith(['/admin/content', 'pages'], {
        state: { openContentKey: 'page.home' },
      });
      cmp.openAuditEntry({ entity: 'security' } as any);
    });

    it('routes content keys to the proper section', () => {
      const cmp = instance();
      const cases: Array<[string, string]> = [
        ['blog.post', 'blog'],
        ['seo.title', 'settings'],
        ['site.name', 'settings'],
        ['other.thing', 'home'],
      ];
      cases.forEach(([key, section]) => {
        router.navigate.calls.reset();
        cmp.openAuditEntry({ entity: 'content', ref_key: key } as any);
        expect(router.navigate).toHaveBeenCalledWith(
          ['/admin/content', section],
          jasmine.any(Object),
        );
      });
    });

    it('opens scheduled publish/promo items only when identified', () => {
      const cmp = instance();
      cmp.openScheduledPublish({ slug: '' } as any);
      cmp.openScheduledPromo({ id: '' } as any);
      expect(router.navigate).not.toHaveBeenCalled();
      cmp.openScheduledPublish({ slug: 'p' } as any);
      cmp.openScheduledPromo({ id: 'pr' } as any);
      expect(router.navigate).toHaveBeenCalledWith(['/admin/products'], {
        state: { editProductSlug: 'p' },
      });
      expect(router.navigate).toHaveBeenCalledWith(['/admin/coupons'], {
        state: { editPromotionId: 'pr' },
      });
    });

    it('downloads audit csv with owner redact toggle and handles errors', () => {
      const cmp = instance();
      const click = jasmine.createSpy('click');
      const remove = jasmine.createSpy('remove');
      spyOn(document, 'createElement').and.returnValue({ click, remove } as any);
      spyOn(URL, 'createObjectURL').and.returnValue('blob:1');
      spyOn(URL, 'revokeObjectURL');
      cmp.auditExportRedact = false;
      cmp.downloadAuditCsv();
      expect(admin.exportAuditCsv).toHaveBeenCalledWith(
        jasmine.objectContaining({ redact: false }),
      );

      auth.role.and.returnValue('support');
      admin.exportAuditCsv.calls.reset();
      cmp.downloadAuditCsv();
      expect(admin.exportAuditCsv).toHaveBeenCalledWith(jasmine.objectContaining({ redact: true }));

      admin.exportAuditCsv.and.returnValue(throwError(() => new Error('x')));
      cmp.downloadAuditCsv();
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('owner transfer', () => {
    it('requires identifier and password', () => {
      const cmp = instance();
      cmp.ownerTransferIdentifier = '';
      cmp.submitOwnerTransfer();
      expect(cmp.ownerTransferError).toBeTruthy();
      expect(admin.transferOwner).not.toHaveBeenCalled();

      cmp.ownerTransferIdentifier = 'new@owner.com';
      cmp.ownerTransferPassword = '';
      cmp.submitOwnerTransfer();
      expect(cmp.ownerTransferError).toBeTruthy();
      expect(admin.transferOwner).not.toHaveBeenCalled();
    });

    it('submits and handles success + error', () => {
      const cmp = instance();
      cmp.ownerTransferIdentifier = 'new@owner.com';
      cmp.ownerTransferPassword = 'secret';
      cmp.ownerTransferConfirm = 'TRANSFER';
      cmp.submitOwnerTransfer();
      expect(admin.transferOwner).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalled();
      expect(cmp.ownerTransferLoading).toBeFalse();

      admin.transferOwner.and.returnValue(throwError(() => new Error('x')));
      cmp.ownerTransferIdentifier = 'new@owner.com';
      cmp.ownerTransferPassword = 'secret';
      cmp.submitOwnerTransfer();
      expect(cmp.ownerTransferError).toBeTruthy();
      expect(cmp.ownerTransferLoading).toBeFalse();
    });
  });

  describe('branch coverage completeness', () => {
    it('openRecent ignores a null item', () => {
      const cmp = instance();
      cmp.openRecent(null as any);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('channelSales returns 0 for nullish gross rows', () => {
      const cmp = instance();
      cmp.setSalesMetric('gross');
      expect(cmp.channelSales(null as any)).toBe(0);
      expect(cmp.channelSales({} as any)).toBe(0);
    });

    it('formatChannelKey tolerates nullish keys', () => {
      const cmp = instance();
      expect(cmp.formatChannelKey(null as any)).toBe('—');
    });

    it('label keys fall back for empty provider/category inputs', () => {
      const cmp = instance();
      expect(cmp.paymentsProviderLabelKey('')).toContain('providers.unknown');
      expect(cmp.supportsWebhookMetrics('')).toBeFalse();
      expect(cmp.refundProviderLabelKey('')).toContain('providers.unknown');
      expect(cmp.refundReasonLabelKey('')).toContain('reasons.other');
    });

    it('coupon jobs default to an empty list for non-array payloads', () => {
      couponsApi.listAllBulkJobs.and.returnValue(of(null as any));
      const cmp = instance();
      cmp.loadBackgroundJobs();
      expect(cmp.couponBulkJobs().length).toBe(0);
    });

    it('progress helpers treat nullish input as zero', () => {
      const cmp = instance();
      expect(cmp.progressPct(null)).toBe(0);
      expect(cmp.progressPct(undefined)).toBe(0);
      expect(cmp.couponProgressPct(null as any)).toBe(0);
    });

    it('loadWhatsNew clears html for a null body', () => {
      http.get.and.returnValue(of(null) as any);
      const cmp = instance();
      cmp.loadWhatsNew(true);
      expect(cmp.whatsNewHtml()).toBe('');
    });

    it('refreshNow swallows silent channel-breakdown errors', () => {
      const cmp = instance();
      admin.channelBreakdown.and.returnValue(throwError(() => new Error('x')));
      cmp.loading.set(false);
      expect(() => cmp.refreshNow()).not.toThrow();
    });

    it('resolveWindowDays uses the default fallback argument', () => {
      const cmp = instance();
      cmp.rangePreset = 'custom';
      cmp.rangeFrom = '';
      cmp.rangeTo = '';
      expect((cmp as unknown as { resolveWindowDays: () => number }).resolveWindowDays()).toBe(30);
    });

    it('restores net and ignores invalid sales metric preferences', () => {
      localStorage.setItem('admin.dashboard.salesMetric.v1', JSON.stringify({ metric: 'net' }));
      const a = instance();
      a.ngOnInit();
      expect(a.salesMetric()).toBe('net');
      localStorage.setItem('admin.dashboard.salesMetric.v1', JSON.stringify({ metric: 'bogus' }));
      const b = instance();
      b.ngOnInit();
      expect(b.salesMetric()).toBe('net');
    });

    it('runScheduledReport tolerates a success payload with missing counts', () => {
      admin.sendScheduledReport.and.returnValue(of({} as any));
      const cmp = instance();
      cmp.runScheduledReport('weekly' as any);
      expect(toast.success).toHaveBeenCalled();
    });

    it('buildSummaryParams returns undefined for a non-positive preset', () => {
      const cmp = instance();
      cmp.rangePreset = '0' as any;
      admin.summary.calls.reset();
      cmp.onRangePresetChange();
      expect(admin.summary).toHaveBeenCalledWith(undefined);
    });

    it('onGlobalSearchChange handles a null query', () => {
      const cmp = instance();
      cmp.globalSearchQuery = null as any;
      cmp.onGlobalSearchChange();
      expect(cmp.globalSearchResults().length).toBe(0);
    });

    it('runGlobalSearch defaults to an empty list for non-array items', fakeAsync(() => {
      admin.globalSearch.and.returnValue(of({ items: null } as any));
      const cmp = instance();
      cmp.globalSearchQuery = 'shoes';
      cmp.onGlobalSearchChange();
      tick(250);
      expect(cmp.globalSearchResults().length).toBe(0);
    }));

    it('moveGlobalSearchActive clamps up from a negative active index', () => {
      const cmp = instance();
      cmp.globalSearchResults.set([
        { type: 'order', id: '1' } as any,
        { type: 'order', id: '2' } as any,
      ]);
      cmp.globalSearchActiveIndex.set(-1);
      (cmp as unknown as { moveGlobalSearchActive: (d: number) => void }).moveGlobalSearchActive(1);
      // current < 0 is normalised to 0, then +1 step lands on index 1.
      expect(cmp.globalSearchActiveIndex()).toBe(1);
    });

    it('selectGlobalSearch tolerates a missing slug or email', () => {
      const cmp = instance();
      cmp.selectGlobalSearch({ type: 'product' } as any);
      expect(router.navigate).toHaveBeenCalledWith(['/admin/products'], {
        state: { editProductSlug: '' },
      });
      cmp.selectGlobalSearch({ type: 'user' } as any);
      expect(router.navigate).toHaveBeenCalledWith(['/admin/users'], {
        state: { prefillUserSearch: '', autoSelectFirst: true },
      });
    });

    it('seeds alert thresholds from zero and undefined counts', () => {
      const cmp = instance();
      cmp.summary.set(
        buildSummary({
          alert_thresholds: {
            failed_payments_min_count: 0,
            failed_payments_min_delta_pct: 1,
            refund_requests_min_count: 0,
            refund_requests_min_rate_pct: 1,
            stockouts_min_count: 0,
          } as any,
        }),
      );
      cmp.openAlertThresholds();
      expect(cmp.alertFailedPaymentsMinCount).toBe(1);
      expect(cmp.alertRefundRequestsMinCount).toBe(1);
      expect(cmp.alertStockoutsMinCount).toBe(1);

      cmp.summary.set(buildSummary({ alert_thresholds: {} as any }));
      cmp.openAlertThresholds();
      expect(cmp.alertStockoutsMinCount).toBe(1);
    });

    it('rejects non-finite threshold counts on save', () => {
      const cmp = instance();
      cmp.alertFailedPaymentsMinCount = 'abc';
      cmp.saveAlertThresholds();
      expect(cmp.alertThresholdsError()).toBeTruthy();
      expect(admin.updateAlertThresholds).not.toHaveBeenCalled();
    });

    it('loadWidgetPrefs defaults hidden to empty when absent', () => {
      auth.user.and.returnValue({ id: 'u8' } as any);
      localStorage.setItem('admin_dashboard_widgets_v1:u8', JSON.stringify({ order: ['kpis'] }));
      const cmp = instance();
      cmp.ngOnInit();
      expect(cmp.isMetricWidgetHidden('kpis')).toBeFalse();
    });

    it('auditHasPrev treats a zero page as the first page', () => {
      const cmp = instance();
      cmp.auditEntries.set({
        items: [],
        meta: { page: 0, limit: 20, total_items: 0, total_pages: 1 },
      } as any);
      expect(cmp.auditHasPrev()).toBeFalse();
    });

    it('canOpenAuditEntry is false for a product without a ref key', () => {
      const cmp = instance();
      expect(cmp.canOpenAuditEntry({ entity: 'product', ref_key: '' } as any)).toBeFalse();
    });

    it('downloadAuditCsv defaults the entity to all and revokes the url later', fakeAsync(() => {
      const cmp = instance();
      const click = jasmine.createSpy('click');
      const remove = jasmine.createSpy('remove');
      const realCreate = document.createElement.bind(document);
      spyOn(document, 'createElement').and.callFake((tag: string) =>
        tag === 'a' ? ({ click, remove } as any) : realCreate(tag),
      );
      spyOn(URL, 'createObjectURL').and.returnValue('blob:1');
      const revoke = spyOn(URL, 'revokeObjectURL');
      cmp.auditEntity = '' as any;
      cmp.downloadAuditCsv();
      expect(admin.exportAuditCsv).toHaveBeenCalledWith(jasmine.objectContaining({ entity: '' }));
      tick(1000);
      expect(revoke).toHaveBeenCalled();
    }));
  });
});
