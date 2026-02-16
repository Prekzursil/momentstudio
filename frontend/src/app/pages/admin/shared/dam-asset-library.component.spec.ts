import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { AdminService, MediaAsset } from '../../../core/admin.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../core/toast.service';
import { DamAssetLibraryComponent } from './dam-asset-library.component';

describe('DamAssetLibraryComponent', () => {
  let admin: jasmine.SpyObj<AdminService>;
  let auth: jasmine.SpyObj<AuthService>;
  let toast: jasmine.SpyObj<ToastService>;

  const baseAsset: MediaAsset = {
    id: 'asset-1',
    asset_type: 'image',
    status: 'draft',
    visibility: 'private',
    source_kind: 'upload',
    source_ref: null,
    storage_key: 'originals/asset-1/pic.jpg',
    public_url: '/media/originals/asset-1/pic.jpg',
    preview_url: '/api/v1/content/admin/media/assets/asset-1/preview?exp=123&sig=abc',
    original_filename: 'pic.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 1024,
    width: 1200,
    height: 800,
    duration_ms: null,
    page_count: null,
    checksum_sha256: null,
    perceptual_hash: null,
    dedupe_group: null,
    rights_license: null,
    rights_owner: null,
    rights_notes: null,
    approved_at: null,
    trashed_at: null,
    created_at: '2026-02-16T00:00:00Z',
    updated_at: '2026-02-16T00:00:00Z',
    tags: ['hero'],
    i18n: [],
    variants: []
  };

  beforeEach(() => {
    admin = jasmine.createSpyObj<AdminService>('AdminService', [
      'listMediaAssets',
      'listMediaCollections',
      'uploadMediaAsset',
      'updateMediaAsset',
      'getMediaAssetUsage',
      'requestMediaVariant',
      'editMediaAsset',
      'listMediaJobs',
      'retryMediaJob',
      'retryMediaJobsBulk',
      'updateMediaJobTriage',
      'listMediaJobEvents',
      'getMediaTelemetry',
      'listMediaRetryPolicies',
      'updateMediaRetryPolicy',
      'resetMediaRetryPolicy',
      'resetAllMediaRetryPolicies',
      'requestMediaUsageReconcile',
      'approveMediaAsset',
      'rejectMediaAsset',
      'softDeleteMediaAsset',
      'restoreMediaAsset',
      'purgeMediaAsset',
      'createMediaCollection',
      'updateMediaCollection',
      'replaceMediaCollectionItems'
    ]);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['role']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    auth.role.and.returnValue('admin');

    admin.listMediaAssets.and.returnValue(
      of({
        items: [baseAsset],
        meta: { total_items: 1, total_pages: 1, page: 1, limit: 24 }
      })
    );
    admin.listMediaCollections.and.returnValue(of([]));
    admin.listMediaJobs.and.returnValue(
      of({
        items: [],
        meta: { total_items: 0, total_pages: 1, page: 1, limit: 20 }
      })
    );
    admin.getMediaTelemetry.and.returnValue(
      of({
        queue_depth: 0,
        online_workers: 0,
        workers: [],
        stale_processing_count: 0,
        dead_letter_count: 0,
        sla_breached_count: 0,
        retry_scheduled_count: 0,
        oldest_queued_age_seconds: null,
        avg_processing_seconds: null,
        status_counts: {},
        type_counts: {}
      })
    );
    admin.requestMediaUsageReconcile.and.returnValue(
      of({
        id: 'job-1',
        asset_id: null,
        job_type: 'usage_reconcile',
        status: 'queued',
        progress_pct: 0,
        attempt: 0,
        max_attempts: 5,
        triage_state: 'open',
        tags: [],
        error_code: null,
        error_message: null,
        created_at: '2026-02-16T00:00:00Z',
        next_retry_at: null,
        dead_lettered_at: null,
        last_error_at: null,
        assigned_to_user_id: null,
        sla_due_at: null,
        incident_url: null,
        started_at: null,
        completed_at: null
      })
    );
    admin.retryMediaJob.and.returnValue(
      of({
        id: 'job-2',
        asset_id: 'asset-1',
        job_type: 'ingest',
        status: 'queued',
        progress_pct: 0,
        attempt: 1,
        max_attempts: 5,
        triage_state: 'retrying',
        tags: ['timeout'],
        error_code: null,
        error_message: null,
        created_at: '2026-02-16T00:00:00Z',
        next_retry_at: null,
        dead_lettered_at: null,
        last_error_at: null,
        assigned_to_user_id: null,
        sla_due_at: null,
        incident_url: null,
        started_at: null,
        completed_at: null
      })
    );
    admin.retryMediaJobsBulk.and.returnValue(
      of({
        items: [],
        meta: { total_items: 0, total_pages: 1, page: 1, limit: 1 }
      })
    );
    admin.updateMediaJobTriage.and.returnValue(
      of({
        id: 'job-2',
        asset_id: 'asset-1',
        job_type: 'ingest',
        status: 'dead_letter',
        progress_pct: 100,
        attempt: 5,
        max_attempts: 5,
        triage_state: 'open',
        tags: ['timeout'],
        error_code: 'processing_failed',
        error_message: 'boom',
        created_at: '2026-02-16T00:00:00Z',
        next_retry_at: null,
        dead_lettered_at: '2026-02-16T00:00:00Z',
        last_error_at: '2026-02-16T00:00:00Z',
        assigned_to_user_id: null,
        sla_due_at: null,
        incident_url: null,
        started_at: null,
        completed_at: '2026-02-16T00:00:00Z'
      })
    );
    admin.listMediaJobEvents.and.returnValue(of({ items: [] }));
    admin.listMediaRetryPolicies.and.returnValue(
      of({
        items: [
          {
            job_type: 'ingest',
            max_attempts: 5,
            backoff_schedule_seconds: [30, 120, 600, 1800],
            jitter_ratio: 0.15,
            enabled: true,
            updated_by_user_id: null,
            created_at: '2026-02-16T00:00:00Z',
            updated_at: '2026-02-16T00:00:00Z'
          }
        ]
      })
    );
    admin.updateMediaRetryPolicy.and.returnValue(
      of({
        job_type: 'ingest',
        max_attempts: 6,
        backoff_schedule_seconds: [10, 30, 120],
        jitter_ratio: 0.2,
        enabled: true,
        updated_by_user_id: 'owner-1',
        created_at: '2026-02-16T00:00:00Z',
        updated_at: '2026-02-16T01:00:00Z'
      })
    );
    admin.resetMediaRetryPolicy.and.returnValue(
      of({
        job_type: 'ingest',
        max_attempts: 5,
        backoff_schedule_seconds: [30, 120, 600, 1800],
        jitter_ratio: 0.15,
        enabled: true,
        updated_by_user_id: null,
        created_at: '2026-02-16T00:00:00Z',
        updated_at: '2026-02-16T02:00:00Z'
      })
    );
    admin.resetAllMediaRetryPolicies.and.returnValue(
      of({
        items: [
          {
            job_type: 'ingest',
            max_attempts: 5,
            backoff_schedule_seconds: [30, 120, 600, 1800],
            jitter_ratio: 0.15,
            enabled: true,
            updated_by_user_id: null,
            created_at: '2026-02-16T00:00:00Z',
            updated_at: '2026-02-16T02:00:00Z'
          }
        ]
      })
    );

    TestBed.configureTestingModule({
      imports: [DamAssetLibraryComponent],
      providers: [
        { provide: AdminService, useValue: admin },
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast }
      ]
    });
  });

  it('loads assets on init with default list filters', () => {
    const fixture = TestBed.createComponent(DamAssetLibraryComponent);
    fixture.detectChanges();

    expect(admin.listMediaAssets).toHaveBeenCalledWith(
      jasmine.objectContaining({
        page: 1,
        limit: 24,
        sort: 'newest'
      })
    );
    expect(fixture.componentInstance.assets().length).toBe(1);
  });

  it('switches to review tab and applies draft status filter', () => {
    const fixture = TestBed.createComponent(DamAssetLibraryComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    admin.listMediaAssets.calls.reset();

    component.switchTab('review');

    expect(component.tab()).toBe('review');
    expect(component.statusFilter).toBe('draft');
    expect(admin.listMediaAssets).toHaveBeenCalledWith(jasmine.objectContaining({ status: 'draft' }));
  });

  it('uses preview_url for image rendering when available', () => {
    const fixture = TestBed.createComponent(DamAssetLibraryComponent);
    fixture.detectChanges();

    const image: HTMLImageElement | null = fixture.nativeElement.querySelector('img');
    expect(image).toBeTruthy();
    expect(image?.getAttribute('src')).toContain('/api/v1/content/admin/media/assets/asset-1/preview');
  });

  it('loads persistent job list when switching to queue tab', () => {
    const fixture = TestBed.createComponent(DamAssetLibraryComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    admin.listMediaJobs.calls.reset();

    component.switchTab('queue');

    expect(admin.listMediaJobs).toHaveBeenCalledWith(
      jasmine.objectContaining({
        page: 1,
        limit: 20,
        dead_letter_only: false
      })
    );
    expect(admin.listMediaRetryPolicies).toHaveBeenCalled();
  });

  it('switches queue mode to dead-letter and requests dead-letter-only list', () => {
    const fixture = TestBed.createComponent(DamAssetLibraryComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    admin.listMediaJobs.calls.reset();

    component.setQueueMode('dead_letter');

    expect(admin.listMediaJobs).toHaveBeenCalledWith(
      jasmine.objectContaining({
        dead_letter_only: true
      })
    );
  });

  it('saves retry policy edits from the jobs tab', async () => {
    const fixture = TestBed.createComponent(DamAssetLibraryComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.switchTab('queue');
    component.retryPolicyDraft('ingest').max_attempts = 6;
    component.retryPolicyDraft('ingest').scheduleText = '10,30,120';
    component.retryPolicyDraft('ingest').jitter_ratio = 0.2;
    await component.saveRetryPolicy('ingest');

    expect(admin.updateMediaRetryPolicy).toHaveBeenCalledWith('ingest', {
      enabled: true,
      max_attempts: 6,
      backoff_schedule_seconds: [10, 30, 120],
      jitter_ratio: 0.2
    });
    expect(toast.success).toHaveBeenCalled();
  });

  it('keeps retry policy editor read-only for non owner/admin roles', async () => {
    auth.role.and.returnValue('content');
    const fixture = TestBed.createComponent(DamAssetLibraryComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');

    expect(component.canEditRetryPolicies()).toBeFalse();
    await component.saveRetryPolicy('ingest');
    expect(admin.updateMediaRetryPolicy).not.toHaveBeenCalled();
  });

  it('rejects invalid retry schedule input before calling API', async () => {
    const fixture = TestBed.createComponent(DamAssetLibraryComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    admin.updateMediaRetryPolicy.calls.reset();
    toast.error.calls.reset();

    component.retryPolicyDraft('ingest').scheduleText = 'abc,0';
    await component.saveRetryPolicy('ingest');

    expect(admin.updateMediaRetryPolicy).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});
