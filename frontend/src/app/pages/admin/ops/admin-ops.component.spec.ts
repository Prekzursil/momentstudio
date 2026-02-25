import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';

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
});
