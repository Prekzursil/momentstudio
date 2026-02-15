import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';

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
      'retryWebhook'
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
        type_counts: { ingest: 2 }
      })
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
        netopia: { status: 'ok', message: null }
      } as any)
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

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), AdminOpsComponent],
      providers: [
        { provide: AdminService, useValue: adminService },
        { provide: HealthService, useValue: health },
        { provide: OpsService, useValue: ops },
        { provide: ToastService, useValue: toast },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map<string, string>() } } }
      ]
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
  });
});
