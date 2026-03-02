import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AdminService } from '../../../core/admin.service';
import { HealthService } from '../../../core/health.service';
import { OpsService } from '../../../core/ops.service';
import { ToastService } from '../../../core/toast.service';
import { AdminOpsComponent } from './admin-ops.component';

const OPS_SPY_METHODS = [
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
  'runSamedaySyncNow'
] as const;

type ServiceSpies = {
  adminService: jasmine.SpyObj<AdminService>;
  health: jasmine.SpyObj<HealthService>;
  ops: jasmine.SpyObj<OpsService>;
  toast: jasmine.SpyObj<ToastService>;
};

function createServiceSpies(): ServiceSpies {
  return {
    adminService: jasmine.createSpyObj<AdminService>('AdminService', ['getMediaTelemetry']),
    health: jasmine.createSpyObj<HealthService>('HealthService', ['ready']),
    ops: jasmine.createSpyObj<OpsService>('OpsService', [...OPS_SPY_METHODS]),
    toast: jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error'])
  };
}

function createMediaTelemetryResponse() {
  return {
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
    type_counts: { ingest: 2 }
  };
}

function createDiagnosticsResponse() {
  return {
    environment: 'test',
    checked_at: '2026-02-17T00:00:00Z',
    app_version: 'test',
    payments_provider: 'mock',
    smtp: { status: 'ok', message: null },
    redis: { status: 'ok', message: null },
    storage: { status: 'ok', message: null },
    stripe: { status: 'ok', message: null },
    paypal: { status: 'ok', message: null },
    netopia: { status: 'ok', message: null }
  };
}

function createSamedaySyncStatusResponse() {
  return {
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
      schema_drift_detected: true
    }
  };
}

function createSamedaySyncRunsResponse() {
  return {
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
        schema_drift_detected: true
      }
    ],
    meta: { page: 1, limit: 8, total: 1 }
  };
}

function configureAdminService(adminService: jasmine.SpyObj<AdminService>): void {
  adminService.getMediaTelemetry.and.returnValue(of(createMediaTelemetryResponse()));
}

function configureHealthService(health: jasmine.SpyObj<HealthService>): void {
  health.ready.and.returnValue(of({ status: 'ok' } as any));
}

function configureOpsListMethods(ops: jasmine.SpyObj<OpsService>): void {
  [ops.listBanners, ops.listShippingMethods, ops.listEmailFailures, ops.listWebhooks].forEach((method) =>
    method.and.returnValue(of([]))
  );
}

function configureOpsObjectMethods(ops: jasmine.SpyObj<OpsService>): void {
  [
    ops.simulateShipping,
    ops.createBanner,
    ops.updateBanner,
    ops.deleteBanner,
    ops.getWebhookDetail,
    ops.retryWebhook,
    ops.runSamedaySyncNow
  ].forEach((method) => method.and.returnValue(of({} as any)));
}

function configureOpsService(ops: jasmine.SpyObj<OpsService>): void {
  ops.getWebhookFailureStats.and.returnValue(of({ failed: 0 } as any));
  ops.getWebhookBacklogStats.and.returnValue(of({ pending: 0 } as any));
  ops.getEmailFailureStats.and.returnValue(of({ failed: 0 } as any));
  ops.getDiagnostics.and.returnValue(of(createDiagnosticsResponse() as any));
  configureOpsListMethods(ops);
  ops.downloadNewsletterConfirmedSubscribersExport.and.returnValue(of(new Blob()));
  configureOpsObjectMethods(ops);
  ops.getSamedaySyncStatus.and.returnValue(of(createSamedaySyncStatusResponse() as any));
  ops.listSamedaySyncRuns.and.returnValue(of(createSamedaySyncRunsResponse() as any));
}

function configureTestModule(spies: ServiceSpies): Promise<void> {
  return TestBed.configureTestingModule({
    imports: [TranslateModule.forRoot(), AdminOpsComponent],
    providers: [
      { provide: AdminService, useValue: spies.adminService },
      { provide: HealthService, useValue: spies.health },
      { provide: OpsService, useValue: spies.ops },
      { provide: ToastService, useValue: spies.toast },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map<string, string>() } } }
    ]
  }).compileComponents();
}

describe('AdminOpsComponent', () => {
  let adminService: jasmine.SpyObj<AdminService>;
  let health: jasmine.SpyObj<HealthService>;
  let ops: jasmine.SpyObj<OpsService>;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(async () => {
    ({ adminService, health, ops, toast } = createServiceSpies());
    configureAdminService(adminService);
    configureHealthService(health);
    configureOpsService(ops);
    await configureTestModule({ adminService, health, ops, toast });
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

  it('covers health and diagnostics error branches', () => {
    health.ready.and.returnValue(throwError(() => new Error('health down')));
    ops.getWebhookFailureStats.and.returnValue(throwError(() => new Error('webhooks failed')));
    ops.getWebhookBacklogStats.and.returnValue(throwError(() => new Error('webhooks backlog failed')));
    ops.getEmailFailureStats.and.returnValue(throwError(() => new Error('emails failed')));
    ops.getDiagnostics.and.returnValue(throwError(() => new Error('diag failed')));
    adminService.getMediaTelemetry.and.returnValue(throwError(() => new Error('dam failed')));

    const fixture = TestBed.createComponent(AdminOpsComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(cmp.healthError()).toBeTruthy();
    expect(cmp.diagnosticsError()).toBeTruthy();
    expect(cmp.damTelemetryError()).toBe('Failed to load DAM telemetry.');
    expect(cmp.backendReady()).toBeFalse();
    expect(cmp.formatDamAge(null)).toBe('n/a');
    expect(cmp.formatDamAge(30)).toBe('30s');
    expect(cmp.formatDamAge(120)).toBe('2m');
    expect(cmp.formatDamAge(7200)).toBe('2h');
    expect(cmp.diagnosticsBadgeClass('ok')).toContain('emerald');
    expect(cmp.diagnosticsBadgeClass('warning')).toContain('amber');
    expect(cmp.diagnosticsBadgeClass('error')).toContain('rose');
    expect(cmp.diagnosticsBadgeClass('unknown')).toContain('slate');
  });

  it('covers banner save/delete flows and simulation branches', () => {
    const fixture = TestBed.createComponent(AdminOpsComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    spyOn(globalThis, 'confirm').and.returnValue(true);

    cmp.bannerStartsAtLocal = '';
    cmp.bannerMessageEn = '';
    cmp.bannerMessageRo = '';
    cmp.saveBanner();
    expect(toast.error).toHaveBeenCalled();

    cmp.bannerStartsAtLocal = '2026-02-18T12:00';
    cmp.bannerMessageEn = 'Maintenance';
    cmp.bannerMessageRo = 'Mentenanta';
    cmp.saveBanner();
    expect(ops.createBanner).toHaveBeenCalled();

    cmp.editingBannerId = 'banner-1';
    cmp.bannerStartsAtLocal = '2026-02-19T09:00';
    cmp.bannerMessageEn = 'Maintenance 2';
    cmp.bannerMessageRo = 'Mentenanta 2';
    cmp.saveBanner();
    expect(ops.updateBanner).toHaveBeenCalled();

    ops.deleteBanner.and.returnValue(throwError(() => ({ error: { detail: 'delete denied' } })));
    cmp.deleteBanner('banner-1');
    expect(toast.error).toHaveBeenCalledWith('delete denied');

    cmp.simSubtotal = '';
    cmp.runSimulation();
    expect(toast.error).toHaveBeenCalled();

    cmp.simSubtotal = '120.50';
    cmp.simDiscount = '5';
    cmp.simShippingMethodId = 'ship-1';
    cmp.simPostalCode = '010101';
    cmp.runSimulation();
    expect(ops.simulateShipping).toHaveBeenCalled();
  });

  it('covers webhook detail/retry and email failure list branches', () => {
    const fixture = TestBed.createComponent(AdminOpsComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    ops.getWebhookDetail.and.returnValue(of({ provider: 'stripe', event_id: 'evt-1' } as any));
    cmp.viewWebhook({ provider: 'stripe', event_id: 'evt-1', status: 'failed' } as any);
    expect(cmp.selectedWebhook()?.event_id).toBe('evt-1');
    cmp.closeWebhookDetail();
    expect(cmp.selectedWebhook()).toBeNull();

    ops.retryWebhook.and.returnValue(of({} as any));
    cmp.retryWebhook({ provider: 'stripe', event_id: 'evt-1', status: 'failed' } as any);
    expect(ops.retryWebhook).toHaveBeenCalledWith('stripe', 'evt-1');
    expect(ops.listWebhooks).toHaveBeenCalled();

    ops.retryWebhook.and.returnValue(throwError(() => ({ error: { detail: 'retry denied' } })));
    cmp.retryWebhook({ provider: 'stripe', event_id: 'evt-2', status: 'failed' } as any);
    expect(toast.error).toHaveBeenCalledWith('retry denied');

    ops.listEmailFailures.and.returnValue(throwError(() => new Error('email load failed')));
    cmp.loadEmailFailures();
    expect(cmp.emailFailuresError()).toBeTruthy();
    cmp.resetEmailFailureFilters();
    expect(cmp.emailFailuresTo).toBe('');
    expect(cmp.emailFailuresSinceHours).toBe(24);
    expect(cmp.webhookStatusClasses('failed')).toContain('rose');
    expect(cmp.webhookStatusClasses('processed')).toContain('emerald');
    expect(cmp.webhookStatusClasses('queued')).toContain('slate');
  });

  it('covers sync-run errors, export branches, and timestamp helpers', () => {
    const fixture = TestBed.createComponent(AdminOpsComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    ops.runSamedaySyncNow.and.returnValue(throwError(() => ({ error: { detail: 'sync blocked' } })));
    cmp.runSamedaySyncNow();
    expect(cmp.samedaySyncError()).toBe('sync blocked');

    const createUrl = spyOn(URL, 'createObjectURL').and.returnValue('blob:test');
    const revokeUrl = spyOn(URL, 'revokeObjectURL');
    const append = spyOn(document.body, 'appendChild').and.callThrough();
    const anchorClick = spyOn(HTMLAnchorElement.prototype, 'click').and.stub();
    const anchorRemove = spyOn(HTMLAnchorElement.prototype, 'remove').and.callThrough();

    cmp.downloadNewsletterExport();
    expect(ops.downloadNewsletterConfirmedSubscribersExport).toHaveBeenCalled();
    expect(createUrl).toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalledWith('blob:test');
    expect(append).toHaveBeenCalled();
    expect(anchorClick).toHaveBeenCalled();
    expect(anchorRemove).toHaveBeenCalled();

    ops.downloadNewsletterConfirmedSubscribersExport.and.returnValue(throwError(() => new Error('export fail')));
    cmp.downloadNewsletterExport();
    expect(toast.error).toHaveBeenCalled();

    expect((cmp as any).toLocalInput('invalid')).toBe('');
    expect((cmp as any).fromLocalInput('')).toBeNull();
    expect((cmp as any).fromLocalInput('2026-02-18T12:00')).toContain('2026-02-18T');
    expect((cmp as any).nowLocalInput()).toContain('T');
  });
});
