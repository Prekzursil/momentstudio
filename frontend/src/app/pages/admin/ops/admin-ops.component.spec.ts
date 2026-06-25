import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AdminService } from '../../../core/admin.service';
import { HealthService } from '../../../core/health.service';
import { OpsService } from '../../../core/ops.service';
import { ToastService } from '../../../core/toast.service';
import { AdminOpsComponent } from './admin-ops.component';

describe('AdminOpsComponent', () => {
  let adminService: jasmine.SpyObj<AdminService>;
  let health: jasmine.SpyObj<HealthService>;
  let ops: jasmine.SpyObj<OpsService>;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(async () => {
    adminService = jasmine.createSpyObj<AdminService>('AdminService', ['getMediaTelemetry']);
    health = jasmine.createSpyObj<HealthService>('HealthService', ['ready']);
    ops = jasmine.createSpyObj<OpsService>('OpsService', [
      'getWebhookFailureStats',
      'getWebhookBacklogStats',
      'getEmailFailureStats',
      'getDiagnostics',
      'listBanners',
      'listShippingMethods',
      'listEmailFailures',
      'listWebhooks',
      'downloadNewsletterConfirmedSubscribersExport',
      'simulateShipping',
      'createBanner',
      'updateBanner',
      'deleteBanner',
      'getWebhookDetail',
      'retryWebhook',
      'getSamedaySyncStatus',
      'listSamedaySyncRuns',
      'runSamedaySyncNow',
    ]);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);

    adminService.getMediaTelemetry.and.returnValue(
      of({
        queue_depth: 2,
        online_workers: 1,
        workers: [],
        stale_processing_count: 0,
        dead_letter_count: 1,
        sla_breached_count: 1,
        retry_scheduled_count: 2,
        oldest_queued_age_seconds: 45,
        avg_processing_seconds: null,
        status_counts: { queued: 2 },
        type_counts: { ingest: 2 },
      }),
    );
    health.ready.and.returnValue(of({ status: 'ok' } as any));
    ops.getWebhookFailureStats.and.returnValue(of({ failed: 0 } as any));
    ops.getWebhookBacklogStats.and.returnValue(of({ pending: 0 } as any));
    ops.getEmailFailureStats.and.returnValue(of({ failed: 0 } as any));
    ops.getDiagnostics.and.returnValue(
      of({
        environment: 'test',
        checked_at: '2026-02-17T00:00:00Z',
        app_version: 'test',
        payments_provider: 'mock',
        smtp: { status: 'ok', message: null },
        redis: { status: 'ok', message: null },
        storage: { status: 'ok', message: null },
        stripe: { status: 'ok', message: null },
        paypal: { status: 'ok', message: null },
        netopia: { status: 'ok', message: null },
      } as any),
    );
    ops.listBanners.and.returnValue(of([]));
    ops.listShippingMethods.and.returnValue(of([]));
    ops.listEmailFailures.and.returnValue(of([]));
    ops.listWebhooks.and.returnValue(of([]));
    ops.downloadNewsletterConfirmedSubscribersExport.and.returnValue(of(new Blob()));
    ops.simulateShipping.and.returnValue(of({} as any));
    ops.createBanner.and.returnValue(of({} as any));
    ops.updateBanner.and.returnValue(of({} as any));
    ops.deleteBanner.and.returnValue(of({} as any));
    ops.getWebhookDetail.and.returnValue(of({} as any));
    ops.retryWebhook.and.returnValue(of({} as any));
    ops.getSamedaySyncStatus.and.returnValue(
      of({
        provider: 'sameday',
        total_lockers: 100,
        stale: false,
        stale_age_seconds: 10,
        challenge_failure_streak: 3,
        schema_drift_detected: true,
        canary_alert_codes: ['schema_drift', 'challenge_failure_streak'],
        canary_alert_messages: ['schema changed', 'challenge streak'],
        latest_run: {
          id: '1',
          provider: 'sameday',
          status: 'success',
          started_at: '2026-02-18T00:00:00Z',
          fetched_count: 100,
          upserted_count: 10,
          deactivated_count: 2,
          failure_kind: null,
          schema_drift_detected: true,
        },
      } as any),
    );
    ops.listSamedaySyncRuns.and.returnValue(
      of({
        items: [
          {
            id: '1',
            provider: 'sameday',
            status: 'success',
            started_at: '2026-02-18T00:00:00Z',
            fetched_count: 100,
            upserted_count: 10,
            deactivated_count: 2,
            failure_kind: null,
            schema_drift_detected: true,
          },
        ],
        meta: { page: 1, limit: 8, total: 1 },
      } as any),
    );
    ops.runSamedaySyncNow.and.returnValue(of({} as any));

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminOpsComponent],
      providers: [
        { provide: AdminService, useValue: adminService },
        { provide: HealthService, useValue: health },
        { provide: OpsService, useValue: ops },
        { provide: ToastService, useValue: toast },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: new Map<string, string>() } },
        },
      ],
    }).compileComponents();
  });

  it('loads DAM telemetry and renders the DAM telemetry card', () => {
    const fixture = TestBed.createComponent(AdminOpsComponent);
    fixture.detectChanges();

    expect(adminService.getMediaTelemetry).toHaveBeenCalled();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('DAM telemetry');
    expect(text).toContain('Queue');
    expect(text).toContain('Dead-letter');
    expect(ops.getSamedaySyncStatus).toHaveBeenCalled();
    expect(text).toContain('adminUi.ops.samedaySync.title');
    expect(text).toContain('adminUi.ops.samedaySync.canaryTitle');
  });

  function create(): AdminOpsComponent {
    return TestBed.createComponent(AdminOpsComponent).componentInstance;
  }

  it('marks health errors and zeroes non-finite counts when calls fail', () => {
    health.ready.and.returnValue(throwError(() => new Error('down')));
    ops.getWebhookFailureStats.and.returnValue(of({ failed: 'x' } as any));
    ops.getWebhookBacklogStats.and.returnValue(of({ pending: 'x', pending_recent: 'x' } as any));
    ops.getEmailFailureStats.and.returnValue(of({ failed: 'x' } as any));
    const cmp = create();
    cmp.loadHealthDashboard();
    expect(cmp.backendReady()).toBeFalse();
    expect(cmp.healthError()).toBeTruthy();
    expect(cmp.webhookFailures24h()).toBe(0);
    expect(cmp.webhookBacklogTotal()).toBe(0);
    expect(cmp.emailFailures24h()).toBe(0);
    expect(cmp.healthLoading()).toBeFalse();
  });

  it('keeps finite health counts and clears the error when all calls succeed', () => {
    ops.getWebhookFailureStats.and.returnValue(of({ failed: 3 } as any));
    ops.getWebhookBacklogStats.and.returnValue(of({ pending: 5, pending_recent: 2 } as any));
    ops.getEmailFailureStats.and.returnValue(of({ failed: 1 } as any));
    const cmp = create();
    cmp.loadHealthDashboard();
    expect(cmp.backendReady()).toBeTrue();
    expect(cmp.webhookFailures24h()).toBe(3);
    expect(cmp.webhookBacklogTotal()).toBe(5);
    expect(cmp.webhookBacklogRecent24h()).toBe(2);
    expect(cmp.emailFailures24h()).toBe(1);
    expect(cmp.healthError()).toBeNull();
  });

  it('sets a diagnostics error when the request fails', () => {
    ops.getDiagnostics.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.loadDiagnostics();
    expect(cmp.diagnosticsError()).toBeTruthy();
    expect(cmp.diagnosticsLoading()).toBeFalse();
  });

  it('sets a DAM telemetry error when the request fails', () => {
    adminService.getMediaTelemetry.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.loadDamTelemetry();
    expect(cmp.damTelemetryError()).toBe('Failed to load DAM telemetry.');
    expect(cmp.damTelemetryLoading()).toBeFalse();
  });

  it('flags a partial Sameday sync failure and defaults runs to an empty list', () => {
    ops.getSamedaySyncStatus.and.returnValue(of(null as any));
    ops.listSamedaySyncRuns.and.returnValue(of(null as any));
    const cmp = create();
    cmp.loadSamedaySyncStatus();
    expect(cmp.samedaySyncStatus()).toBeNull();
    expect(cmp.samedaySyncRuns()).toEqual([]);
    expect(cmp.samedaySyncError()).toBeTruthy();
  });

  it('runs Sameday sync now and reloads status on success', () => {
    const cmp = create();
    cmp.runSamedaySyncNow();
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.samedaySyncRunning()).toBeFalse();
    expect(ops.getSamedaySyncStatus).toHaveBeenCalled();
  });

  it('does not start a second Sameday run while one is in flight', () => {
    const cmp = create();
    cmp.samedaySyncRunning.set(true);
    cmp.runSamedaySyncNow();
    expect(ops.runSamedaySyncNow).not.toHaveBeenCalled();
  });

  it('surfaces the server detail when a Sameday run fails', () => {
    ops.runSamedaySyncNow.and.returnValue(throwError(() => ({ error: { detail: 'busy' } })));
    const cmp = create();
    cmp.runSamedaySyncNow();
    expect(cmp.samedaySyncError()).toBe('busy');
    expect(toast.error).toHaveBeenCalledWith('busy');
  });

  it('falls back to a translated message when a Sameday run fails without detail', () => {
    ops.runSamedaySyncNow.and.returnValue(throwError(() => ({})));
    const cmp = create();
    cmp.runSamedaySyncNow();
    expect(cmp.samedaySyncError()).toBe('adminUi.ops.samedaySync.errors.run');
  });

  it('formats DAM ages across all unit thresholds', () => {
    const cmp = create();
    expect(cmp.formatDamAge(null)).toBe('n/a');
    expect(cmp.formatDamAge(30)).toBe('30s');
    expect(cmp.formatDamAge(120)).toBe('2m');
    expect(cmp.formatDamAge(7200)).toBe('2h');
  });

  it('maps diagnostics statuses to badge classes', () => {
    const cmp = create();
    expect(cmp.diagnosticsBadgeClass('ok')).toContain('emerald');
    expect(cmp.diagnosticsBadgeClass('warning')).toContain('amber');
    expect(cmp.diagnosticsBadgeClass('error')).toContain('rose');
    expect(cmp.diagnosticsBadgeClass('unknown')).toContain('slate');
  });

  it('returns the breadcrumb trail', () => {
    const cmp = create();
    expect(cmp.crumbs().length).toBe(3);
  });

  it('downloads the newsletter export and toasts on success', () => {
    const cmp = create();
    const createSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    const revokeSpy = spyOn(URL, 'revokeObjectURL');
    const clickSpy = spyOn(HTMLAnchorElement.prototype, 'click');
    cmp.downloadNewsletterExport();
    expect(createSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.newsletterExporting()).toBeFalse();
  });

  it('toasts on a newsletter export failure', () => {
    ops.downloadNewsletterConfirmedSubscribersExport.and.returnValue(
      throwError(() => new Error('x')),
    );
    const cmp = create();
    cmp.downloadNewsletterExport();
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.newsletterExporting()).toBeFalse();
  });

  it('derives banner status from active flag and schedule window', () => {
    const cmp = create();
    expect(cmp.bannerStatus({ is_active: false } as any)).toBe('disabled');
    expect(
      cmp.bannerStatus({
        is_active: true,
        starts_at: new Date(Date.now() + 86400000).toISOString(),
      } as any),
    ).toBe('scheduled');
    expect(
      cmp.bannerStatus({
        is_active: true,
        starts_at: new Date(Date.now() - 86400000).toISOString(),
        ends_at: new Date(Date.now() - 3600000).toISOString(),
      } as any),
    ).toBe('expired');
    expect(
      cmp.bannerStatus({
        is_active: true,
        starts_at: new Date(Date.now() - 86400000).toISOString(),
        ends_at: null,
      } as any),
    ).toBe('active');
  });

  it('selects a banner into the edit form and resets the form', () => {
    const cmp = create();
    cmp.selectBanner({
      id: 'banner-123',
      is_active: false,
      level: 'warning',
      starts_at: '2026-02-01T10:00:00Z',
      ends_at: '2026-02-02T10:00:00Z',
      message_en: 'EN',
      message_ro: 'RO',
      link_url: 'https://x',
      link_label_en: 'go',
      link_label_ro: 'mergi',
    } as any);
    expect(cmp.editingBannerId).toBe('banner-123');
    expect(cmp.bannerMessageEn).toBe('EN');
    expect(cmp.bannerEndsAtLocal).not.toBe('');

    cmp.selectBanner({
      id: 'b2',
      is_active: true,
      level: 'info',
      starts_at: '2026-02-01T10:00:00Z',
      ends_at: null,
      message_en: '',
      message_ro: '',
      link_url: '',
      link_label_en: '',
      link_label_ro: '',
    } as any);
    expect(cmp.bannerEndsAtLocal).toBe('');

    cmp.resetBannerForm();
    expect(cmp.editingBannerId).toBeNull();
    expect(cmp.bannerIsActive).toBeTrue();
  });

  it('validates the banner form before saving', () => {
    const cmp = create();
    cmp.resetBannerForm();
    cmp.bannerStartsAtLocal = '';
    cmp.saveBanner();
    expect(toast.error).toHaveBeenCalled();
    expect(ops.createBanner).not.toHaveBeenCalled();

    toast.error.calls.reset();
    cmp.bannerStartsAtLocal = '2026-02-01T10:00';
    cmp.bannerMessageEn = '';
    cmp.bannerMessageRo = '';
    cmp.saveBanner();
    expect(toast.error).toHaveBeenCalled();
    expect(ops.createBanner).not.toHaveBeenCalled();
  });

  it('creates a new banner on save and reloads', () => {
    const cmp = create();
    cmp.resetBannerForm();
    cmp.bannerStartsAtLocal = '2026-02-01T10:00';
    cmp.bannerEndsAtLocal = '2026-02-02T10:00';
    cmp.bannerMessageEn = 'Hello';
    cmp.bannerMessageRo = 'Salut';
    cmp.saveBanner();
    expect(ops.createBanner).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.bannerSaving()).toBeFalse();
  });

  it('updates an existing banner on save', () => {
    const cmp = create();
    cmp.editingBannerId = 'edit-me';
    cmp.bannerStartsAtLocal = '2026-02-01T10:00';
    cmp.bannerMessageEn = 'Hello';
    cmp.bannerMessageRo = 'Salut';
    cmp.saveBanner();
    expect(ops.updateBanner).toHaveBeenCalledWith('edit-me', jasmine.any(Object));
  });

  it('reports the server detail (then a fallback) when saving a banner fails', () => {
    ops.createBanner.and.returnValue(throwError(() => ({ error: { detail: 'bad' } })));
    const cmp = create();
    cmp.resetBannerForm();
    cmp.bannerStartsAtLocal = '2026-02-01T10:00';
    cmp.bannerMessageEn = 'Hello';
    cmp.bannerMessageRo = 'Salut';
    cmp.saveBanner();
    expect(toast.error).toHaveBeenCalledWith('bad');

    toast.error.calls.reset();
    ops.createBanner.and.returnValue(throwError(() => ({})));
    cmp.bannerStartsAtLocal = '2026-02-01T10:00';
    cmp.bannerMessageEn = 'Hello';
    cmp.bannerMessageRo = 'Salut';
    cmp.saveBanner();
    expect(toast.error).toHaveBeenCalledWith('adminUi.ops.banner.errors.save');
  });

  it('guards banner deletion behind id presence and confirmation', () => {
    const cmp = create();
    cmp.deleteBanner('');
    expect(ops.deleteBanner).not.toHaveBeenCalled();

    spyOn(window, 'confirm').and.returnValues(false, true);
    cmp.deleteBanner('id-1');
    expect(ops.deleteBanner).not.toHaveBeenCalled();

    cmp.deleteBanner('id-1');
    expect(ops.deleteBanner).toHaveBeenCalledWith('id-1');
    expect(toast.success).toHaveBeenCalled();
  });

  it('reports banner deletion failures with detail and fallback', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    ops.deleteBanner.and.returnValue(throwError(() => ({ error: { detail: 'nope' } })));
    const cmp = create();
    cmp.deleteBanner('id-1');
    expect(toast.error).toHaveBeenCalledWith('nope');

    toast.error.calls.reset();
    ops.deleteBanner.and.returnValue(throwError(() => ({})));
    cmp.deleteBanner('id-1');
    expect(toast.error).toHaveBeenCalledWith('adminUi.ops.banner.errors.delete');
  });

  it('runs a shipping simulation with explicit method and postal code', () => {
    ops.simulateShipping.and.returnValue(of({ total_ron: '120.00' } as any));
    const cmp = create();
    cmp.simSubtotal = '100.00';
    cmp.simShippingMethodId = 'm1';
    cmp.simPostalCode = '012345';
    cmp.runSimulation();
    expect(ops.simulateShipping).toHaveBeenCalledWith(
      jasmine.objectContaining({ shipping_method_id: 'm1', postal_code: '012345' }),
    );
    expect(cmp.simResult()).toBeTruthy();
    expect(cmp.simLoading()).toBeFalse();
  });

  it('requires a subtotal before simulating shipping', () => {
    const cmp = create();
    cmp.simSubtotal = '   ';
    cmp.runSimulation();
    expect(toast.error).toHaveBeenCalled();
    expect(ops.simulateShipping).not.toHaveBeenCalled();
  });

  it('reports shipping simulation failures with detail and fallback', () => {
    ops.simulateShipping.and.returnValue(throwError(() => ({ error: { detail: 'bad zip' } })));
    const cmp = create();
    cmp.simSubtotal = '100.00';
    cmp.runSimulation();
    expect(cmp.simError()).toBe('bad zip');

    ops.simulateShipping.and.returnValue(throwError(() => ({})));
    cmp.simSubtotal = '100.00';
    cmp.runSimulation();
    expect(cmp.simError()).toBe('adminUi.ops.shipping.errors.run');
  });

  it('maps webhook statuses to classes', () => {
    const cmp = create();
    expect(cmp.webhookStatusClasses('failed')).toContain('rose');
    expect(cmp.webhookStatusClasses('processed')).toContain('emerald');
    expect(cmp.webhookStatusClasses('queued')).toContain('slate');
  });

  it('opens, closes and refreshes a webhook detail', () => {
    ops.getWebhookDetail.and.returnValue(
      of({ provider: 'stripe', event_id: 'evt_1', payload: {} } as any),
    );
    const cmp = create();
    cmp.viewWebhook({} as any);
    expect(ops.getWebhookDetail).not.toHaveBeenCalled();

    cmp.viewWebhook({ provider: 'stripe', event_id: 'evt_1' } as any);
    expect(cmp.selectedWebhook()).toBeTruthy();
    cmp.closeWebhookDetail();
    expect(cmp.selectedWebhook()).toBeNull();
  });

  it('toasts when loading a webhook detail fails', () => {
    ops.getWebhookDetail.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.viewWebhook({ provider: 'stripe', event_id: 'evt_1' } as any);
    expect(toast.error).toHaveBeenCalled();
  });

  it('retries a webhook, reloads, and refreshes the open detail on success', () => {
    ops.getWebhookDetail.and.returnValue(
      of({ provider: 'stripe', event_id: 'evt_1', payload: {} } as any),
    );
    const cmp = create();
    cmp.retryWebhook({} as any);
    expect(ops.retryWebhook).not.toHaveBeenCalled();

    cmp.selectedWebhook.set({ provider: 'stripe', event_id: 'evt_1' } as any);
    cmp.retryWebhook({ provider: 'stripe', event_id: 'evt_1' } as any);
    expect(ops.retryWebhook).toHaveBeenCalledWith('stripe', 'evt_1');
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.webhookRetrying()).toBeNull();
  });

  it('retries a webhook without refreshing an unrelated open detail', () => {
    const cmp = create();
    cmp.selectedWebhook.set({ provider: 'paypal', event_id: 'other' } as any);
    ops.getWebhookDetail.calls.reset();
    cmp.retryWebhook({ provider: 'stripe', event_id: 'evt_1' } as any);
    expect(ops.getWebhookDetail).not.toHaveBeenCalled();
  });

  it('reports webhook retry failures with detail and fallback', () => {
    ops.retryWebhook.and.returnValue(throwError(() => ({ error: { detail: 'retry bad' } })));
    const cmp = create();
    cmp.retryWebhook({ provider: 'stripe', event_id: 'evt_1' } as any);
    expect(toast.error).toHaveBeenCalledWith('retry bad');

    toast.error.calls.reset();
    ops.retryWebhook.and.returnValue(throwError(() => ({})));
    cmp.retryWebhook({ provider: 'stripe', event_id: 'evt_1' } as any);
    expect(toast.error).toHaveBeenCalledWith('adminUi.ops.webhooks.errors.retry');
  });

  it('surfaces banner, shipping and webhook list load failures', () => {
    ops.listBanners.and.returnValue(throwError(() => new Error('x')));
    ops.listShippingMethods.and.returnValue(throwError(() => new Error('x')));
    ops.listWebhooks.and.returnValue(throwError(() => new Error('x')));
    ops.listEmailFailures.and.returnValue(throwError(() => new Error('x')));
    const fixture = TestBed.createComponent(AdminOpsComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    expect(cmp.bannersError()).toBeTruthy();
    expect(cmp.shippingMethods()).toEqual([]);
    expect(cmp.webhooksError()).toBeTruthy();
    expect(cmp.emailFailuresError()).toBeTruthy();
  });

  it('loads email failures with clamped since-hours and a to filter', () => {
    const cmp = create();
    cmp.emailFailuresTo = 'a@b.com';
    cmp.emailFailuresSinceHours = 500;
    cmp.loadEmailFailures();
    expect(ops.listEmailFailures).toHaveBeenCalledWith(
      jasmine.objectContaining({ since_hours: 168, to_email: 'a@b.com' }),
    );
  });

  it('defaults email since-hours to 24 when the value is not finite', () => {
    const cmp = create();
    cmp.emailFailuresTo = '';
    cmp.emailFailuresSinceHours = 'abc' as any;
    cmp.loadEmailFailures();
    expect(ops.listEmailFailures).toHaveBeenCalledWith(
      jasmine.objectContaining({ since_hours: 24, to_email: undefined }),
    );
  });

  it('defaults email since-hours to 24 when the value is zero/blank', () => {
    const cmp = create();
    cmp.emailFailuresSinceHours = 0 as any;
    cmp.loadEmailFailures();
    expect(ops.listEmailFailures).toHaveBeenCalledWith(
      jasmine.objectContaining({ since_hours: 24 }),
    );
  });

  it('zeroes health counts whose values are absent and catches per-call failures', () => {
    health.ready.and.returnValue(of(null as any));
    ops.getWebhookFailureStats.and.returnValue(of({} as any));
    ops.getWebhookBacklogStats.and.returnValue(of({} as any));
    ops.getEmailFailureStats.and.returnValue(of({} as any));
    const cmp = create();
    cmp.loadHealthDashboard();
    expect(cmp.webhookFailures24h()).toBe(0);
    expect(cmp.webhookBacklogTotal()).toBe(0);
    expect(cmp.webhookBacklogRecent24h()).toBe(0);
    expect(cmp.emailFailures24h()).toBe(0);
    expect(cmp.healthError()).toBeTruthy();
  });

  it('catches individual health call failures via catchError', () => {
    ops.getWebhookFailureStats.and.returnValue(throwError(() => new Error('x')));
    ops.getWebhookBacklogStats.and.returnValue(throwError(() => new Error('x')));
    ops.getEmailFailureStats.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.loadHealthDashboard();
    expect(cmp.healthError()).toBeTruthy();
    expect(cmp.healthLoading()).toBeFalse();
  });

  it('catches Sameday status and run-list failures via catchError', () => {
    ops.getSamedaySyncStatus.and.returnValue(throwError(() => new Error('x')));
    ops.listSamedaySyncRuns.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.loadSamedaySyncStatus();
    expect(cmp.samedaySyncStatus()).toBeNull();
    expect(cmp.samedaySyncRuns()).toEqual([]);
    expect(cmp.samedaySyncError()).toBeTruthy();
    expect(cmp.samedaySyncLoading()).toBeFalse();
  });

  it('returns the default badge class for a blank status', () => {
    const cmp = create();
    expect(cmp.diagnosticsBadgeClass('')).toContain('slate');
  });

  it('returns the default webhook class for a blank status', () => {
    const cmp = create();
    expect(cmp.webhookStatusClasses('')).toContain('slate');
  });

  it('runs a shipping simulation defaulting blank discount/method/postal', () => {
    ops.simulateShipping.and.returnValue(of({ total_ron: '100.00' } as any));
    const cmp = create();
    cmp.simSubtotal = '50.00';
    cmp.simDiscount = '';
    cmp.simShippingMethodId = '';
    cmp.simPostalCode = '';
    cmp.runSimulation();
    expect(ops.simulateShipping).toHaveBeenCalledWith(
      jasmine.objectContaining({
        discount_ron: '0.00',
        shipping_method_id: undefined,
        postal_code: undefined,
      }),
    );
  });

  it('defaults null list payloads to empty arrays', () => {
    ops.listBanners.and.returnValue(of(null as any));
    ops.listShippingMethods.and.returnValue(of(null as any));
    ops.listWebhooks.and.returnValue(of(null as any));
    ops.listEmailFailures.and.returnValue(of(null as any));
    const fixture = TestBed.createComponent(AdminOpsComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    expect(cmp.banners()).toEqual([]);
    expect(cmp.shippingMethods()).toEqual([]);
    expect(cmp.webhooks()).toEqual([]);
    expect(cmp.emailFailures()).toEqual([]);
  });

  it('reports an email failures load error', () => {
    ops.listEmailFailures.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.loadEmailFailures();
    expect(cmp.emailFailuresError()).toBeTruthy();
    expect(cmp.emailFailuresLoading()).toBeFalse();
  });

  it('resets email failure filters and reloads', () => {
    const cmp = create();
    cmp.emailFailuresTo = 'x';
    cmp.emailFailuresSinceHours = 100;
    cmp.resetEmailFailureFilters();
    expect(cmp.emailFailuresTo).toBe('');
    expect(cmp.emailFailuresSinceHours).toBe(24);
  });

  it('opens and closes an email failure detail', () => {
    const cmp = create();
    cmp.viewEmailFailure({ to_email: 'a@b.com' } as any);
    expect(cmp.selectedEmailFailure()).toBeTruthy();
    cmp.closeEmailFailureDetail();
    expect(cmp.selectedEmailFailure()).toBeNull();
  });

  it('reports a webhook list load failure path directly', () => {
    ops.listWebhooks.and.returnValue(throwError(() => new Error('x')));
    const cmp = create();
    cmp.loadWebhooks();
    expect(cmp.webhooksError()).toBeTruthy();
    expect(cmp.webhooksLoading()).toBeFalse();
  });

  it('applies the email failures deep link from query params', () => {
    const cmp = create();
    (cmp as any).route.snapshot.queryParamMap = new Map([
      ['to_email', 'deep@link.com'],
      ['since_hours', '48'],
    ]);
    (cmp as any).applyEmailFailuresDeepLink();
    expect(cmp.emailFailuresTo).toBe('deep@link.com');
    expect(cmp.emailFailuresSinceHours).toBe(48);
  });

  it('ignores out-of-range since-hours in the deep link', () => {
    const cmp = create();
    (cmp as any).route.snapshot.queryParamMap = new Map([['since_hours', '999']]);
    (cmp as any).applyEmailFailuresDeepLink();
    expect(cmp.emailFailuresSinceHours).toBe(24);
  });

  it('scrolls to the email failures section when deep-linked, swallowing history errors', fakeAsync(() => {
    const fixture = TestBed.createComponent(AdminOpsComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    spyOnProperty(history, 'state', 'get').and.returnValue({ focusOpsSection: 'emails' });
    spyOn(history, 'replaceState').and.throwError('blocked');
    const target = document.getElementById('admin-ops-email-failures');
    const scrollSpy = target
      ? spyOn(target, 'scrollIntoView')
      : jasmine.createSpy('scrollIntoView');
    (cmp as any).maybeFocusSection();
    tick(0);
    expect(scrollSpy).toHaveBeenCalled();
  }));

  it('focuses the webhooks section when deep-linked', fakeAsync(() => {
    const fixture = TestBed.createComponent(AdminOpsComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    spyOnProperty(history, 'state', 'get').and.returnValue({ focusOpsSection: 'webhooks' });
    spyOn(history, 'replaceState');
    const target = document.getElementById('admin-ops-webhooks');
    const scrollSpy = target
      ? spyOn(target, 'scrollIntoView')
      : jasmine.createSpy('scrollIntoView');
    (cmp as any).maybeFocusSection();
    tick(0);
    expect(scrollSpy).toHaveBeenCalled();
  }));

  it('does nothing when no ops section is requested', () => {
    const cmp = create();
    spyOnProperty(history, 'state', 'get').and.returnValue({});
    const setTimeoutSpy = spyOn(window, 'setTimeout').and.callThrough();
    (cmp as any).maybeFocusSection();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('converts local datetime input strings to and from ISO', () => {
    const cmp = create() as any;
    expect(cmp.toLocalInput('not-a-date')).toBe('');
    expect(cmp.fromLocalInput('')).toBeNull();
    expect(cmp.fromLocalInput('not-a-date')).toBeNull();
    expect(cmp.fromLocalInput('2026-02-01T10:00')).toContain('2026-02-01');
    expect(cmp.nowLocalInput()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('renders banners, shipping results, email failures and webhook rows', () => {
    ops.listBanners.and.returnValue(
      of([
        {
          id: 'banner-abcdef12',
          is_active: true,
          level: 'info',
          starts_at: '2026-01-01T00:00:00Z',
          ends_at: '2026-12-31T00:00:00Z',
          message_en: 'EN copy',
          message_ro: 'RO copy',
        },
      ] as any),
    );
    ops.simulateShipping.and.returnValue(
      of({
        subtotal_ron: '100.00',
        shipping_ron: '20.00',
        vat_ron: '5.00',
        total_ron: '125.00',
        shipping_fee_ron: '20.00',
        free_shipping_threshold_ron: '200.00',
        methods: [
          {
            name: 'Courier',
            rate_flat: '20.00',
            rate_per_kg: null,
            computed_shipping_ron: '20.00',
          },
        ],
      } as any),
    );
    ops.listEmailFailures.and.returnValue(
      of([
        {
          id: 'e1',
          to_email: 'fail@x.com',
          subject: 'Subject',
          created_at: '2026-01-01T00:00:00Z',
          error_message: 'SMTP timeout',
        },
      ] as any),
    );
    ops.listWebhooks.and.returnValue(
      of([
        {
          provider: 'stripe',
          event_id: 'evt_1',
          event_type: 'payment',
          status: 'failed',
          attempts: 2,
          last_attempt_at: '2026-01-01T00:00:00Z',
          last_error: 'boom',
        },
      ] as any),
    );
    const fixture = TestBed.createComponent(AdminOpsComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.runSimulation();
    cmp.viewEmailFailure({
      to_email: 'fail@x.com',
      subject: 'Subject',
      error_message: 'SMTP timeout',
    } as any);
    cmp.selectedWebhook.set({
      provider: 'stripe',
      event_id: 'evt_1',
      last_error: 'boom',
      payload: { a: 1 },
    } as any);
    fixture.detectChanges();

    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('EN copy');
    expect(text).toContain('Courier');
    expect(text).toContain('fail@x.com');
    expect(text).toContain('SMTP timeout');
    expect(text).toContain('boom');
  });

  it('renders error and loading banners across panels', () => {
    const fixture = TestBed.createComponent(AdminOpsComponent);
    const cmp = fixture.componentInstance;
    fixture.detectChanges();
    cmp.healthLoading.set(false);
    cmp.healthError.set('health down');
    cmp.diagnosticsLoading.set(false);
    cmp.diagnosticsError.set('diag down');
    cmp.diagnostics.set(null);
    cmp.damTelemetryError.set('dam down');
    cmp.samedaySyncError.set('sameday down');
    cmp.bannersLoading.set(false);
    cmp.bannersError.set('banners down');
    cmp.simError.set('sim down');
    cmp.emailFailuresLoading.set(false);
    cmp.emailFailuresError.set('emails down');
    cmp.emailFailures.set([]);
    cmp.webhooksLoading.set(false);
    cmp.webhooksError.set('webhooks down');
    fixture.detectChanges();
    const text = (fixture.nativeElement.textContent || '').replace(/\s+/g, ' ');
    expect(text).toContain('health down');
    expect(text).toContain('diag down');
    expect(text).toContain('webhooks down');
  });
});
