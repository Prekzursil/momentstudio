import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import {
  AdminService,
  MediaAsset,
  MediaAssetListResponse,
  MediaCollection,
  MediaJob,
  MediaJobEventsResponse,
  MediaJobListResponse,
  MediaRetryPolicy,
  MediaRetryPolicyHistoryResponse,
  MediaRetryPolicyListResponse,
  MediaRetryPolicyPresetsResponse,
  MediaRetryPolicySnapshot,
  MediaTelemetryResponse,
} from '../../../core/admin.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../core/toast.service';
import { DamAssetLibraryComponent } from './dam-asset-library.component';

describe('DamAssetLibraryComponent', () => {
  let admin: jasmine.SpyObj<AdminService>;
  let auth: jasmine.SpyObj<AuthService>;
  let toast: jasmine.SpyObj<ToastService>;
  const createdFixtures: ComponentFixture<DamAssetLibraryComponent>[] = [];

  const errDetail = () => throwError(() => ({ error: { detail: 'boom' } }));
  const errPlain = () => throwError(() => ({}));

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
    variants: [],
  };

  const makeJob = (over: Partial<MediaJob> = {}): MediaJob => ({
    id: 'job-x',
    asset_id: 'asset-1',
    job_type: 'ingest',
    status: 'failed',
    progress_pct: 50,
    attempt: 2,
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
    completed_at: null,
    ...over,
  });

  const makeCollection = (over: Partial<MediaCollection> = {}): MediaCollection => ({
    id: 'col-1',
    name: 'Hero',
    slug: 'hero',
    visibility: 'private',
    created_at: '2026-02-16T00:00:00Z',
    updated_at: '2026-02-16T00:00:00Z',
    item_count: 0,
    ...over,
  });

  const makePolicy = (over: Partial<MediaRetryPolicy> = {}): MediaRetryPolicy => ({
    job_type: 'ingest',
    max_attempts: 5,
    backoff_schedule_seconds: [30, 120, 600, 1800],
    jitter_ratio: 0.15,
    enabled: true,
    updated_by_user_id: null,
    created_at: '2026-02-16T00:00:00Z',
    updated_at: '2026-02-16T00:00:00Z',
    ...over,
  });

  const snapshot = (over: Partial<MediaRetryPolicySnapshot> = {}): MediaRetryPolicySnapshot => ({
    max_attempts: 5,
    backoff_schedule_seconds: [30, 120, 600, 1800],
    jitter_ratio: 0.15,
    enabled: true,
    version_ts: 'seed',
    ...over,
  });

  const telemetry = (over: Partial<MediaTelemetryResponse> = {}): MediaTelemetryResponse => ({
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
    type_counts: {},
    ...over,
  });

  const make = (): ComponentFixture<DamAssetLibraryComponent> => {
    const fixture = TestBed.createComponent(DamAssetLibraryComponent);
    createdFixtures.push(fixture);
    return fixture;
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
      'listMediaRetryPolicyHistory',
      'getMediaRetryPolicyPresets',
      'rollbackMediaRetryPolicy',
      'markMediaRetryPolicyKnownGood',
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
      'replaceMediaCollectionItems',
    ]);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['role']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    auth.role.and.returnValue('admin');

    admin.listMediaAssets.and.returnValue(
      of({
        items: [baseAsset],
        meta: { total_items: 1, total_pages: 1, page: 1, limit: 24 },
      }),
    );
    admin.listMediaCollections.and.returnValue(of([]));
    admin.listMediaJobs.and.returnValue(
      of({
        items: [],
        meta: { total_items: 0, total_pages: 1, page: 1, limit: 20 },
      }),
    );
    admin.getMediaTelemetry.and.returnValue(of(telemetry()));
    admin.requestMediaUsageReconcile.and.returnValue(
      of(makeJob({ id: 'job-1', job_type: 'usage_reconcile', asset_id: null })),
    );
    admin.retryMediaJob.and.returnValue(
      of(makeJob({ id: 'job-2', status: 'queued', triage_state: 'retrying' })),
    );
    admin.retryMediaJobsBulk.and.returnValue(
      of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 1 } }),
    );
    admin.updateMediaJobTriage.and.returnValue(
      of(makeJob({ id: 'job-2', triage_state: 'resolved' })),
    );
    admin.listMediaJobEvents.and.returnValue(of({ items: [] }));
    admin.uploadMediaAsset.and.returnValue(of(baseAsset));
    admin.updateMediaAsset.and.returnValue(of(baseAsset));
    admin.getMediaAssetUsage.and.returnValue(
      of({
        asset_id: 'asset-1',
        public_url: '/x',
        items: [
          {
            source_type: 'page',
            source_key: 'home',
            source_id: null,
            field_path: 'hero',
            lang: null,
            last_seen_at: '2026-02-16T00:00:00Z',
          },
        ],
      }),
    );
    admin.requestMediaVariant.and.returnValue(of(makeJob({ job_type: 'variant' })));
    admin.editMediaAsset.and.returnValue(of(makeJob({ job_type: 'edit' })));
    admin.approveMediaAsset.and.returnValue(of({ ...baseAsset, status: 'approved' }));
    admin.rejectMediaAsset.and.returnValue(of({ ...baseAsset, status: 'rejected' }));
    admin.softDeleteMediaAsset.and.returnValue(of(void 0));
    admin.restoreMediaAsset.and.returnValue(of({ ...baseAsset, status: 'draft' }));
    admin.purgeMediaAsset.and.returnValue(of(void 0));
    admin.createMediaCollection.and.returnValue(of(makeCollection()));
    admin.updateMediaCollection.and.returnValue(of(makeCollection()));
    admin.replaceMediaCollectionItems.and.returnValue(of(void 0));
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
            updated_at: '2026-02-16T00:00:00Z',
          },
        ],
      }),
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
        updated_at: '2026-02-16T01:00:00Z',
      }),
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
        updated_at: '2026-02-16T02:00:00Z',
      }),
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
            updated_at: '2026-02-16T02:00:00Z',
          },
        ],
      }),
    );
    admin.listMediaRetryPolicyHistory.and.returnValue(
      of({
        items: [
          {
            id: 'evt-1',
            job_type: 'ingest',
            action: 'update',
            actor_user_id: 'owner-1',
            preset_key: null,
            before_policy: snapshot(),
            after_policy: snapshot({
              max_attempts: 6,
              backoff_schedule_seconds: [10, 30, 120],
              jitter_ratio: 0.2,
            }),
            note: null,
            created_at: '2026-02-16T03:00:00Z',
          },
        ],
        meta: { total_items: 1, total_pages: 1, page: 1, limit: 10 },
      }),
    );
    admin.getMediaRetryPolicyPresets.and.returnValue(
      of({
        job_type: 'ingest',
        items: [
          {
            preset_key: 'factory_default',
            label: 'Factory default',
            policy: snapshot(),
            source_event_id: null,
            fallback_used: false,
            updated_at: null,
          },
        ],
      }),
    );
    admin.rollbackMediaRetryPolicy.and.returnValue(
      of({
        job_type: 'ingest',
        max_attempts: 5,
        backoff_schedule_seconds: [30, 120, 600, 1800],
        jitter_ratio: 0.15,
        enabled: true,
        updated_by_user_id: 'owner-1',
        created_at: '2026-02-16T00:00:00Z',
        updated_at: '2026-02-16T04:00:00Z',
      }),
    );
    admin.markMediaRetryPolicyKnownGood.and.returnValue(
      of({
        id: 'evt-2',
        job_type: 'ingest',
        action: 'mark_known_good',
        actor_user_id: 'owner-1',
        preset_key: 'known_good',
        before_policy: snapshot(),
        after_policy: snapshot(),
        note: null,
        created_at: '2026-02-16T05:00:00Z',
      }),
    );

    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), DamAssetLibraryComponent],
      providers: [
        { provide: AdminService, useValue: admin },
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
      ],
    });
    TestBed.inject(TranslateService).use('en');
  });

  afterEach(() => {
    while (createdFixtures.length) {
      const fixture = createdFixtures.pop();
      try {
        fixture?.destroy();
      } catch {
        // destroy is best-effort cleanup; ignore teardown errors.
      }
    }
  });

  // ---------- existing behavioral coverage ----------

  it('loads assets on init with default list filters', () => {
    const fixture = make();
    fixture.detectChanges();

    expect(admin.listMediaAssets).toHaveBeenCalledWith(
      jasmine.objectContaining({ page: 1, limit: 24, sort: 'newest' }),
    );
    expect(fixture.componentInstance.assets().length).toBe(1);
  });

  it('switches to review tab and applies draft status filter', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    admin.listMediaAssets.calls.reset();

    component.switchTab('review');

    expect(component.tab()).toBe('review');
    expect(component.statusFilter).toBe('draft');
    expect(admin.listMediaAssets).toHaveBeenCalledWith(
      jasmine.objectContaining({ status: 'draft' }),
    );
  });

  it('uses preview_url for image rendering when available', () => {
    const fixture = make();
    fixture.detectChanges();

    const image: HTMLImageElement | null = fixture.nativeElement.querySelector('img');
    expect(image).toBeTruthy();
    expect(image?.getAttribute('src')).toContain(
      '/api/v1/content/admin/media/assets/asset-1/preview',
    );
  });

  it('loads persistent job list when switching to queue tab', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    admin.listMediaJobs.calls.reset();

    component.switchTab('queue');

    expect(admin.listMediaJobs).toHaveBeenCalledWith(
      jasmine.objectContaining({ page: 1, limit: 20, dead_letter_only: false }),
    );
    expect(admin.listMediaRetryPolicies).toHaveBeenCalled();
  });

  it('switches queue mode to dead-letter and requests dead-letter-only list', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    admin.listMediaJobs.calls.reset();

    component.setQueueMode('dead_letter');

    expect(admin.listMediaJobs).toHaveBeenCalledWith(
      jasmine.objectContaining({ dead_letter_only: true }),
    );
  });

  it('saves retry policy edits from the jobs tab', async () => {
    const fixture = make();
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
      jitter_ratio: 0.2,
    });
    expect(toast.success).toHaveBeenCalled();
  });

  it('keeps retry policy editor read-only for non owner/admin roles', async () => {
    auth.role.and.returnValue('content');
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');

    expect(component.canEditRetryPolicies()).toBeFalse();
    await component.saveRetryPolicy('ingest');
    expect(admin.updateMediaRetryPolicy).not.toHaveBeenCalled();
  });

  it('loads retry policy history + presets when toggling history panel', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    admin.listMediaRetryPolicyHistory.calls.reset();
    admin.getMediaRetryPolicyPresets.calls.reset();

    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();

    expect(admin.listMediaRetryPolicyHistory).toHaveBeenCalledWith({
      job_type: 'ingest',
      page: 1,
      limit: 10,
    });
    expect(admin.getMediaRetryPolicyPresets).toHaveBeenCalledWith('ingest');
    expect(component.isRetryPolicyHistoryOpen('ingest')).toBeTrue();
  });

  it('opens rollback preview for preset and applies on explicit confirmation', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();

    await component.rollbackRetryPolicyPreset('ingest', 'factory_default');

    expect(admin.rollbackMediaRetryPolicy).not.toHaveBeenCalled();
    expect(component.retryPolicyRollbackPreview()?.request.preset_key).toBe('factory_default');

    await component.applyRetryPolicyRollbackPreview();

    expect(admin.rollbackMediaRetryPolicy).toHaveBeenCalledWith('ingest', {
      preset_key: 'factory_default',
    });
    expect(toast.success).toHaveBeenCalled();
  });

  it('opens rollback preview for history event and applies selected revision', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();

    await component.rollbackRetryPolicyEvent('ingest', 'evt-1');
    expect(admin.rollbackMediaRetryPolicy).not.toHaveBeenCalled();
    expect(component.retryPolicyRollbackPreview()?.request.event_id).toBe('evt-1');

    await component.applyRetryPolicyRollbackPreview();
    expect(admin.rollbackMediaRetryPolicy).toHaveBeenCalledWith('ingest', { event_id: 'evt-1' });
  });

  it('marks retry policy as known good for owner/admin role', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');

    await component.markRetryPolicyKnownGood('ingest');

    expect(admin.markMediaRetryPolicyKnownGood).toHaveBeenCalledWith('ingest');
    expect(toast.success).toHaveBeenCalled();
  });

  it('rejects invalid retry schedule input before calling API', async () => {
    const fixture = make();
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

  // ---------- lifecycle ----------

  it('clears queue polling on destroy when polling was never started', () => {
    const fixture = make();
    fixture.detectChanges();
    expect(() => fixture.componentInstance.ngOnDestroy()).not.toThrow();
  });

  // ---------- computed helpers ----------

  it('formats oldest queued label across magnitude buckets', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.telemetry.set(telemetry({ oldest_queued_age_seconds: null }));
    expect(component.oldestQueuedLabel()).toBe('n/a');
    component.telemetry.set(telemetry({ oldest_queued_age_seconds: 42 }));
    expect(component.oldestQueuedLabel()).toBe('42s');
    component.telemetry.set(telemetry({ oldest_queued_age_seconds: 120 }));
    expect(component.oldestQueuedLabel()).toBe('2m');
    component.telemetry.set(telemetry({ oldest_queued_age_seconds: 7200 }));
    expect(component.oldestQueuedLabel()).toBe('2h');
  });

  it('falls back to a single page when meta total_pages is zero', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.meta.set({ total_items: 0, total_pages: 0, page: 1, limit: 24 });
    component.jobsMeta.set({ total_items: 0, total_pages: 0, page: 1, limit: 20 });
    expect(component.metaTotalPages()).toBe(1);
    expect(component.jobsMetaTotalPages()).toBe(1);
  });

  it('computes selected counts from selection sets', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectedIds.set(new Set(['a', 'b']));
    component.selectedQueueJobIds.set(new Set(['j']));
    expect(component.selectedCount()).toBe(2);
    expect(component.selectedQueueJobCount()).toBe(1);
  });

  // ---------- tab switching ----------

  it('switches to trash tab and shows trashed assets', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('trash');
    expect(component.statusFilter).toBe('trashed');
    expect(admin.listMediaAssets).toHaveBeenCalledWith(
      jasmine.objectContaining({ include_trashed: true }),
    );
  });

  it('clears draft/trashed filter when returning to library tab', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('review');
    expect(component.statusFilter).toBe('draft');
    component.switchTab('library');
    expect(component.statusFilter).toBe('');
  });

  it('keeps an unrelated status filter when switching to library tab', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.statusFilter = 'approved';
    component.switchTab('library');
    expect(component.statusFilter).toBe('approved');
  });

  it('reloads collections when switching to collections tab', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    admin.listMediaCollections.calls.reset();
    component.switchTab('collections');
    expect(admin.listMediaCollections).toHaveBeenCalled();
  });

  it('ignores setQueueMode when the mode is unchanged', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    admin.listMediaJobs.calls.reset();
    component.setQueueMode('pipeline');
    expect(admin.listMediaJobs).not.toHaveBeenCalled();
  });

  it('keeps an existing triage filter when entering dead-letter mode', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    component.queueTriageState = 'retrying';
    component.setQueueMode('dead_letter');
    expect(component.queueTriageState).toBe('retrying');
  });

  // ---------- filters ----------

  it('resets list filters to library defaults', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.q = 'x';
    component.tag = 'y';
    component.assetType = 'image';
    component.visibility = 'public';
    component.sort = 'oldest';
    component.resetFilters();
    expect(component.q).toBe('');
    expect(component.statusFilter).toBe('');
    expect(component.sort).toBe('newest');
  });

  it('resets filters to draft default while in review tab', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('review');
    component.resetFilters();
    expect(component.statusFilter).toBe('draft');
  });

  it('resets filters to trashed default while in trash tab', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('trash');
    component.resetFilters();
    expect(component.statusFilter).toBe('trashed');
  });

  it('sends populated filter params and reuses an empty default page on reload', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    admin.listMediaAssets.calls.reset();
    component.q = 'logo';
    component.tag = 'hero';
    component.assetType = 'video';
    component.statusFilter = 'approved';
    component.visibility = 'public';
    component.page = 3;
    component.reload(false);
    expect(admin.listMediaAssets).toHaveBeenCalledWith(
      jasmine.objectContaining({
        q: 'logo',
        tag: 'hero',
        asset_type: 'video',
        status: 'approved',
        visibility: 'public',
        page: 3,
      }),
    );
  });

  it('tolerates missing items/meta from the asset list endpoint', () => {
    admin.listMediaAssets.and.returnValue(of({} as unknown as MediaAssetListResponse));
    const fixture = make();
    fixture.detectChanges();
    expect(fixture.componentInstance.assets()).toEqual([]);
    expect(fixture.componentInstance.meta().total_pages).toBe(1);
  });

  it('surfaces an error state when asset loading fails', () => {
    admin.listMediaAssets.and.returnValue(errDetail());
    const fixture = make();
    fixture.detectChanges();
    expect(fixture.componentInstance.error()).toBe('boom');
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('falls back to a default error message when no detail is provided', () => {
    admin.listMediaAssets.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    expect(fixture.componentInstance.error()).toBe('Failed to load media assets.');
  });

  // ---------- list pagination ----------

  it('guards previous/next page boundaries and advances within range', () => {
    admin.listMediaAssets.and.returnValue(
      of({ items: [baseAsset], meta: { total_items: 60, total_pages: 3, page: 1, limit: 24 } }),
    );
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component.prevPage();
    expect(component.page).toBe(1);

    component.nextPage();
    expect(component.page).toBe(2);

    component.prevPage();
    expect(component.page).toBe(1);

    component.page = 3;
    component.nextPage();
    expect(component.page).toBe(3);
  });

  // ---------- queue loading ----------

  it('sends trimmed queue filters and tolerates missing job items/meta', () => {
    admin.listMediaJobs.and.returnValue(of({} as unknown as MediaJobListResponse));
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.queueStatus = 'failed';
    component.queueJobType = 'ingest';
    component.queueTriageState = 'open';
    component.queueAssignedToUserId = '  user-1  ';
    component.queueTag = '  timeout  ';
    component.queueAssetId = '  asset-9  ';
    component.queueSlaBreachedOnly = true;
    component.queueCreatedFrom = '2026-01-01';
    component.queueCreatedTo = '2026-02-01';
    component.loadJobs(true);

    expect(admin.listMediaJobs).toHaveBeenCalledWith(
      jasmine.objectContaining({
        status: 'failed',
        assigned_to_user_id: 'user-1',
        tag: 'timeout',
        asset_id: 'asset-9',
        sla_breached: true,
        created_from: '2026-01-01T00:00:00+00:00',
        created_to: '2026-02-01T23:59:59+00:00',
      }),
    );
    expect(component.jobs()).toEqual([]);
    expect(component.jobsMeta().total_pages).toBe(1);
  });

  it('surfaces a queue error message on job load failure', () => {
    admin.listMediaJobs.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    fixture.componentInstance.loadJobs();
    expect(fixture.componentInstance.queueError()).toBe('Failed to load media jobs.');
  });

  it('guards previous/next queue page boundaries and advances within range', () => {
    admin.listMediaJobs.and.returnValue(
      of({ items: [], meta: { total_items: 60, total_pages: 3, page: 1, limit: 20 } }),
    );
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');

    component.prevQueuePage();
    expect(component.queuePage).toBe(1);
    component.nextQueuePage();
    expect(component.queuePage).toBe(2);
    component.prevQueuePage();
    expect(component.queuePage).toBe(1);
    component.queuePage = 3;
    component.nextQueuePage();
    expect(component.queuePage).toBe(3);
  });

  it('resets queue filters back to defaults', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.queueStatus = 'failed';
    component.queueJobType = 'ingest';
    component.queueTriageState = 'open';
    component.queueAssignedToUserId = 'u';
    component.queueTag = 't';
    component.queueSlaBreachedOnly = true;
    component.queueAssetId = 'a';
    component.queueCreatedFrom = '2026-01-01';
    component.queueCreatedTo = '2026-02-01';
    component.resetQueueFilters();
    expect(component.queueStatus).toBe('');
    expect(component.queueSlaBreachedOnly).toBeFalse();
    expect(component.queueAssetId).toBe('');
  });

  // ---------- retry policies ----------

  it('surfaces an error when retry policies fail to load', () => {
    admin.listMediaRetryPolicies.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    fixture.componentInstance.loadRetryPolicies();
    expect(fixture.componentInstance.retryPoliciesError()).toBe('Failed to load retry policies.');
  });

  it('treats only owner/admin as able to edit retry policies', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    auth.role.and.returnValue('owner');
    expect(component.canEditRetryPolicies()).toBeTrue();
    auth.role.and.returnValue('admin');
    expect(component.canEditRetryPolicies()).toBeTrue();
    auth.role.and.returnValue('editor');
    expect(component.canEditRetryPolicies()).toBeFalse();
    auth.role.and.returnValue(null as never);
    expect(component.canEditRetryPolicies()).toBeFalse();
  });

  it('creates a default draft for an unknown job type', () => {
    const fixture = make();
    fixture.detectChanges();
    const draft = fixture.componentInstance.retryPolicyDraft('variant');
    expect(draft.max_attempts).toBe(5);
    expect(draft.scheduleText).toBe('30,120,600,1800');
  });

  it('mutates retry policy draft fields through setters', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.setRetryPolicyDraftEnabled('ingest', false);
    component.setRetryPolicyDraftMaxAttempts('ingest', '7');
    component.setRetryPolicyDraftSchedule('ingest', null as never);
    component.setRetryPolicyDraftJitter('ingest', 0.3);
    const draft = component.retryPolicyDraft('ingest');
    expect(draft.enabled).toBeFalse();
    expect(draft.max_attempts).toBe(7);
    expect(draft.scheduleText).toBe('');
    expect(draft.jitter_ratio).toBe(0.3);
  });

  it('returns the stored row error or null', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component.retryPolicyError('ingest')).toBeNull();
    (component as unknown as { retryPolicyRowErrors: Record<string, string> }).retryPolicyRowErrors[
      'ingest'
    ] = 'oops';
    expect(component.retryPolicyError('ingest')).toBe('oops');
  });

  it('previews retry delays and flags invalid schedules', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.retryPolicyDraft('ingest').scheduleText = '30,120';
    expect(component.retryDelayPreview('ingest')).toBe('#1: 30s · #2: 120s');
    component.retryPolicyDraft('ingest').scheduleText = 'nope';
    expect(component.retryDelayPreview('ingest')).toBe('invalid schedule');
  });

  it('caps the parsed retry schedule at twenty entries', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    const longSchedule = Array.from({ length: 25 }, (_, i) => i + 1).join(',');
    component.retryPolicyDraft('ingest').scheduleText = longSchedule;
    await component.saveRetryPolicy('ingest');
    const call = admin.updateMediaRetryPolicy.calls.mostRecent().args[1];
    expect(call.backoff_schedule_seconds?.length).toBe(20);
  });

  it('rejects out-of-range max attempts and jitter before saving', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');

    component.retryPolicyDraft('ingest').scheduleText = '30';
    component.retryPolicyDraft('ingest').max_attempts = Number.NaN;
    await component.saveRetryPolicy('ingest');
    component.retryPolicyDraft('ingest').max_attempts = 0;
    await component.saveRetryPolicy('ingest');
    component.retryPolicyDraft('ingest').max_attempts = 21;
    await component.saveRetryPolicy('ingest');
    expect(admin.updateMediaRetryPolicy).not.toHaveBeenCalled();

    component.retryPolicyDraft('ingest').max_attempts = 5;
    component.retryPolicyDraft('ingest').jitter_ratio = Number.NaN;
    await component.saveRetryPolicy('ingest');
    component.retryPolicyDraft('ingest').jitter_ratio = -0.5;
    await component.saveRetryPolicy('ingest');
    component.retryPolicyDraft('ingest').jitter_ratio = 1.5;
    await component.saveRetryPolicy('ingest');
    expect(admin.updateMediaRetryPolicy).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('refreshes open history after a successful policy save', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    admin.listMediaRetryPolicyHistory.calls.reset();

    component.retryPolicyDraft('ingest').scheduleText = '10,30';
    await component.saveRetryPolicy('ingest');
    expect(admin.listMediaRetryPolicyHistory).toHaveBeenCalled();
  });

  it('reports a row error when policy save fails', async () => {
    admin.updateMediaRetryPolicy.and.returnValue(errDetail());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    component.retryPolicyDraft('ingest').scheduleText = '10,30';
    await component.saveRetryPolicy('ingest');
    expect(component.retryPolicyError('ingest')).toBe('boom');
  });

  it('uses a default error message when policy save fails without detail', async () => {
    admin.updateMediaRetryPolicy.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    component.retryPolicyDraft('ingest').scheduleText = '10,30';
    await component.saveRetryPolicy('ingest');
    expect(component.retryPolicyError('ingest')).toBe('Failed to update retry policy.');
  });

  it('resets a single retry policy and refreshes open history', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    admin.listMediaRetryPolicyHistory.calls.reset();

    await component.resetRetryPolicy('ingest');
    expect(admin.resetMediaRetryPolicy).toHaveBeenCalledWith('ingest');
    expect(admin.listMediaRetryPolicyHistory).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it('blocks resetting a retry policy for read-only roles', async () => {
    auth.role.and.returnValue('viewer');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.resetRetryPolicy('ingest');
    expect(admin.resetMediaRetryPolicy).not.toHaveBeenCalled();
  });

  it('reports an error when resetting a retry policy fails', async () => {
    admin.resetMediaRetryPolicy.and.returnValue(errDetail());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    await component.resetRetryPolicy('ingest');
    expect(component.retryPolicyError('ingest')).toBe('boom');
  });

  it('resets all retry policies and clears caches', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    await component.resetAllRetryPolicies();
    expect(admin.resetAllMediaRetryPolicies).toHaveBeenCalled();
    expect(component.retryPolicies().length).toBe(1);
    expect(toast.success).toHaveBeenCalled();
  });

  it('blocks resetting all retry policies for read-only roles', async () => {
    auth.role.and.returnValue('viewer');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.resetAllRetryPolicies();
    expect(admin.resetAllMediaRetryPolicies).not.toHaveBeenCalled();
  });

  it('reports an error when resetting all retry policies fails', async () => {
    admin.resetAllMediaRetryPolicies.and.returnValue(errDetail());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.resetAllRetryPolicies();
    expect(fixture.componentInstance.retryPoliciesError()).toBe('boom');
    expect(toast.error).toHaveBeenCalled();
  });

  it('toggles the retry policy history panel open and closed', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    expect(component.isRetryPolicyHistoryOpen('ingest')).toBeTrue();
    component.toggleRetryPolicyHistory('ingest');
    expect(component.isRetryPolicyHistoryOpen('ingest')).toBeFalse();
  });

  it('exposes history loading, error, items and has-more accessors', async () => {
    admin.listMediaRetryPolicyHistory.and.returnValue(
      of({
        items: [
          {
            id: 'evt-1',
            job_type: 'ingest',
            action: 'update',
            actor_user_id: null,
            preset_key: null,
            before_policy: snapshot(),
            after_policy: snapshot({ max_attempts: 6 }),
            note: null,
            created_at: '2026-02-16T03:00:00Z',
          },
        ],
        meta: { total_items: 20, total_pages: 2, page: 1, limit: 10 },
      }),
    );
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    await Promise.resolve();

    expect(component.retryPolicyHistoryLoading('ingest')).toBeFalse();
    expect(component.retryPolicyHistoryError('ingest')).toBeNull();
    expect(component.retryPolicyHistoryItems('ingest').length).toBe(1);
    expect(component.retryPolicyHistoryHasMore('ingest')).toBeTrue();
    expect(component.retryPolicyHistoryHasMore('variant')).toBeFalse();
  });

  it('loads additional history pages when more are available', async () => {
    admin.listMediaRetryPolicyHistory.and.returnValues(
      of({
        items: [
          {
            id: 'evt-1',
            job_type: 'ingest',
            action: 'update',
            actor_user_id: null,
            preset_key: null,
            before_policy: snapshot(),
            after_policy: snapshot({ max_attempts: 6 }),
            note: null,
            created_at: '2026-02-16T03:00:00Z',
          },
        ],
        meta: { total_items: 20, total_pages: 2, page: 1, limit: 10 },
      }),
      of({
        items: [
          {
            id: 'evt-2',
            job_type: 'ingest',
            action: 'reset',
            actor_user_id: null,
            preset_key: null,
            before_policy: snapshot({ max_attempts: 6 }),
            after_policy: snapshot(),
            note: null,
            created_at: '2026-02-16T04:00:00Z',
          },
        ],
        meta: { total_items: 20, total_pages: 2, page: 2, limit: 10 },
      }),
    );
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    await Promise.resolve();
    await component.loadMoreRetryPolicyHistory('ingest');
    expect(component.retryPolicyHistoryItems('ingest').length).toBe(2);
  });

  it('does not request more history past the last page', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    await Promise.resolve();
    admin.listMediaRetryPolicyHistory.calls.reset();
    await component.loadMoreRetryPolicyHistory('ingest');
    expect(admin.listMediaRetryPolicyHistory).not.toHaveBeenCalled();
  });

  it('skips concurrent history loads while one is in flight', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    (
      component as unknown as { retryPolicyHistoryLoadingByType: Record<string, boolean> }
    ).retryPolicyHistoryLoadingByType['ingest'] = true;
    admin.listMediaRetryPolicyHistory.calls.reset();
    await component.loadMoreRetryPolicyHistory('ingest');
    expect(admin.listMediaRetryPolicyHistory).not.toHaveBeenCalled();
  });

  it('defaults history meta when the response omits it', async () => {
    admin.listMediaRetryPolicyHistory.and.returnValue(
      of({ items: [] } as unknown as MediaRetryPolicyHistoryResponse),
    );
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    await Promise.resolve();
    expect(component.retryPolicyHistoryHasMore('ingest')).toBeFalse();
  });

  it('reports a history error when the history endpoint fails', async () => {
    admin.listMediaRetryPolicyHistory.and.returnValue(errDetail());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    await Promise.resolve();
    expect(component.retryPolicyHistoryError('ingest')).toBe('boom');
  });

  it('reports a preset error when the presets endpoint fails', async () => {
    admin.getMediaRetryPolicyPresets.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    await Promise.resolve();
    expect(component.retryPolicyHistoryError('ingest')).toBe(
      'Failed to load retry policy presets.',
    );
  });

  it('summarises retry policy presets and falls back while loading', async () => {
    admin.getMediaRetryPolicyPresets.and.returnValue(
      of({
        job_type: 'ingest',
        items: [
          {
            preset_key: 'factory_default',
            label: 'Factory default',
            policy: snapshot(),
            source_event_id: null,
            fallback_used: false,
            updated_at: null,
          },
          {
            preset_key: 'known_good',
            label: 'Known good',
            policy: snapshot(),
            source_event_id: null,
            fallback_used: true,
            updated_at: null,
          },
        ],
      }),
    );
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component.retryPolicyPresetSummary('ingest')).toBe('loading…');
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    await Promise.resolve();
    expect(component.retryPolicyPresetSummary('ingest')).toBe(
      'Factory default · Known good (fallback)',
    );
  });

  it('formats a policy snapshot for display', () => {
    const fixture = make();
    fixture.detectChanges();
    expect(fixture.componentInstance.formatPolicySnapshot(snapshot({ enabled: false }))).toBe(
      '5 tries · [30,120,600,1800] · jitter 0.15 · off',
    );
  });

  it('derives diff chips and event diff rows for changed fields', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const before = snapshot();
    const after = snapshot({
      max_attempts: 6,
      backoff_schedule_seconds: [10, 30],
      jitter_ratio: 0.4,
      enabled: false,
    });
    const chips = component.retryPolicyDiffChips(before, after);
    expect(chips).toEqual(['Max attempts', 'Schedule (seconds)', 'Jitter ratio', 'Enabled']);

    const rows = component.retryPolicyEventDiffRows({
      id: 'evt-9',
      job_type: 'ingest',
      action: 'update',
      actor_user_id: null,
      preset_key: null,
      before_policy: before,
      after_policy: after,
      note: null,
      created_at: '2026-02-16T03:00:00Z',
    });
    expect(rows.length).toBe(4);
    const scheduleRow = rows.find((r) => r.field === 'backoff_schedule_seconds');
    expect(scheduleRow?.detail).toContain('#3: 600 -> —');
  });

  it('emits no diff chips when policies are identical', () => {
    const fixture = make();
    fixture.detectChanges();
    expect(fixture.componentInstance.retryPolicyDiffChips(snapshot(), snapshot())).toEqual([]);
  });

  it('blocks marking a policy known good for read-only roles', async () => {
    auth.role.and.returnValue('viewer');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.markRetryPolicyKnownGood('ingest');
    expect(admin.markMediaRetryPolicyKnownGood).not.toHaveBeenCalled();
  });

  it('reports an error when marking a policy known good fails', async () => {
    admin.markMediaRetryPolicyKnownGood.and.returnValue(errDetail());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    await component.markRetryPolicyKnownGood('ingest');
    expect(component.retryPolicyError('ingest')).toBe('boom');
  });

  // ---------- rollback preview flows ----------

  it('blocks preset rollback preview for read-only roles', async () => {
    auth.role.and.returnValue('viewer');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.rollbackRetryPolicyPreset('ingest', 'factory_default');
    expect(fixture.componentInstance.retryPolicyRollbackPreview()).toBeNull();
  });

  it('lazily loads presets before building a rollback preview', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    await component.rollbackRetryPolicyPreset('ingest', 'factory_default');
    expect(admin.getMediaRetryPolicyPresets).toHaveBeenCalledWith('ingest');
    expect(component.retryPolicyRollbackPreview()?.targetLabel).toBe('Factory default');
  });

  it('reports an error when the requested preset is unavailable', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    await component.rollbackRetryPolicyPreset('ingest', 'known_good');
    expect(component.retryPolicyError('ingest')).toBe('Preset is not available.');
  });

  it('reports an error when the current policy is missing for preset rollback', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    await component.rollbackRetryPolicyPreset('variant', 'factory_default');
    expect(component.retryPolicyError('variant')).toBe('Current policy could not be loaded.');
  });

  it('blocks event rollback preview for read-only roles', async () => {
    auth.role.and.returnValue('viewer');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.rollbackRetryPolicyEvent('ingest', 'evt-1');
    expect(fixture.componentInstance.retryPolicyRollbackPreview()).toBeNull();
  });

  it('lazily loads history before building an event rollback preview', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    await component.rollbackRetryPolicyEvent('ingest', 'evt-1');
    expect(component.retryPolicyRollbackPreview()?.request.event_id).toBe('evt-1');
  });

  it('reports an error when the requested history event is unavailable', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    await component.rollbackRetryPolicyEvent('ingest', 'missing');
    expect(component.retryPolicyError('ingest')).toBe('History event is not available.');
  });

  it('reports an error when the current policy is missing for event rollback', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    await component.rollbackRetryPolicyEvent('variant', 'evt-1');
    expect(component.retryPolicyError('variant')).toBe('Current policy could not be loaded.');
  });

  it('cancels an open rollback preview', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.retryPolicyRollbackPreview.set({
      jobType: 'ingest',
      targetLabel: 'x',
      targetPolicy: snapshot(),
      currentPolicy: snapshot(),
      diffs: [],
      request: { preset_key: 'factory_default' },
    });
    component.cancelRetryPolicyRollbackPreview();
    expect(component.retryPolicyRollbackPreview()).toBeNull();
  });

  it('does nothing when applying a rollback with no preview', async () => {
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.applyRetryPolicyRollbackPreview();
    expect(admin.rollbackMediaRetryPolicy).not.toHaveBeenCalled();
  });

  it('does not apply a rollback preview for read-only roles', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.retryPolicyRollbackPreview.set({
      jobType: 'ingest',
      targetLabel: 'x',
      targetPolicy: snapshot(),
      currentPolicy: snapshot(),
      diffs: [],
      request: { preset_key: 'factory_default' },
    });
    auth.role.and.returnValue('viewer');
    await component.applyRetryPolicyRollbackPreview();
    expect(admin.rollbackMediaRetryPolicy).not.toHaveBeenCalled();
  });

  it('reports an error when applying a rollback fails', async () => {
    admin.rollbackMediaRetryPolicy.and.returnValue(errDetail());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    await component.rollbackRetryPolicyPreset('ingest', 'factory_default');
    await component.applyRetryPolicyRollbackPreview();
    expect(component.retryPolicyError('ingest')).toBe('boom');
    expect(component.retryPolicyRollbackApplying()).toBeFalse();
  });

  // ---------- usage reconcile ----------

  it('queues a usage reconcile job and refreshes the queue when on the jobs tab', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    admin.listMediaJobs.calls.reset();
    await component.runUsageReconcile();
    expect(admin.requestMediaUsageReconcile).toHaveBeenCalled();
    expect(admin.listMediaJobs).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it('queues a usage reconcile job without reloading when off the jobs tab', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    admin.listMediaJobs.calls.reset();
    await component.runUsageReconcile();
    expect(admin.listMediaJobs).not.toHaveBeenCalled();
  });

  it('reports an error when a usage reconcile job fails to queue', async () => {
    admin.requestMediaUsageReconcile.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.runUsageReconcile();
    expect(toast.error).toHaveBeenCalledWith('Failed to queue usage reconciliation.');
  });

  // ---------- queue selection + bulk ----------

  it('toggles queue job selection on and off', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.toggleQueueJobSelected('job-2', { target: { checked: true } } as unknown as Event);
    expect(component.selectedQueueJobIds().has('job-2')).toBeTrue();
    component.toggleQueueJobSelected('job-2', { target: { checked: false } } as unknown as Event);
    expect(component.selectedQueueJobIds().has('job-2')).toBeFalse();
  });

  it('ignores bulk retry when no jobs are selected', async () => {
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.bulkRetrySelectedJobs();
    expect(admin.retryMediaJobsBulk).not.toHaveBeenCalled();
  });

  it('applies bulk retry results to the in-memory job list', async () => {
    admin.retryMediaJobsBulk.and.returnValue(
      of({
        items: [makeJob({ id: 'job-2', status: 'queued' })],
        meta: { total_items: 1, total_pages: 1, page: 1, limit: 1 },
      }),
    );
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.jobs.set([makeJob({ id: 'job-2' }), makeJob({ id: 'job-9' })]);
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkRetrySelectedJobs();
    expect(component.jobs().find((j) => j.id === 'job-2')?.status).toBe('queued');
    expect(component.jobs().find((j) => j.id === 'job-9')).toBeTruthy();
    expect(component.selectedQueueJobIds().size).toBe(0);
  });

  it('reports an error when bulk retry fails', async () => {
    admin.retryMediaJobsBulk.and.returnValue(errDetail());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkRetrySelectedJobs();
    expect(toast.error).toHaveBeenCalledWith('boom');
  });

  it('ignores bulk assign when nothing is selected', async () => {
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.bulkAssignSelectedJobs();
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('cancels bulk assign when the prompt is dismissed', async () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkAssignSelectedJobs();
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('assigns selected jobs to a user id', async () => {
    spyOn(window, 'prompt').and.returnValue('  user-9  ');
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkAssignSelectedJobs();
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', {
      assigned_to_user_id: 'user-9',
    });
  });

  it('clears the assignee when bulk assign receives a blank value', async () => {
    spyOn(window, 'prompt').and.returnValue('   ');
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkAssignSelectedJobs();
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { clear_assignee: true });
  });

  it('reports an error when bulk assign fails', async () => {
    spyOn(window, 'prompt').and.returnValue('user-9');
    admin.updateMediaJobTriage.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkAssignSelectedJobs();
    expect(toast.error).toHaveBeenCalledWith('Bulk assignment failed.');
  });

  it('ignores bulk triage marking when nothing is selected', async () => {
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.bulkMarkSelectedJobs('resolved');
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('marks selected jobs with a triage state', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkMarkSelectedJobs('ignored');
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { triage_state: 'ignored' });
  });

  it('reports an error when bulk triage marking fails', async () => {
    admin.updateMediaJobTriage.and.returnValue(errDetail());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkMarkSelectedJobs('resolved');
    expect(toast.error).toHaveBeenCalledWith('boom');
  });

  it('ignores bulk tag add when nothing is selected', async () => {
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.bulkAddTagToSelectedJobs();
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('skips bulk tag add when the prompt is blank', async () => {
    spyOn(window, 'prompt').and.returnValue('   ');
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkAddTagToSelectedJobs();
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('adds a tag to selected jobs', async () => {
    spyOn(window, 'prompt').and.returnValue(' urgent ');
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkAddTagToSelectedJobs();
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { add_tags: ['urgent'] });
  });

  it('reports an error when bulk tag add fails', async () => {
    spyOn(window, 'prompt').and.returnValue('urgent');
    admin.updateMediaJobTriage.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkAddTagToSelectedJobs();
    expect(toast.error).toHaveBeenCalledWith('Bulk tag update failed.');
  });

  it('ignores bulk tag removal when nothing is selected', async () => {
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.bulkRemoveTagFromSelectedJobs();
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('skips bulk tag removal when the prompt is blank', async () => {
    spyOn(window, 'prompt').and.returnValue('');
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkRemoveTagFromSelectedJobs();
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('removes a tag from selected jobs', async () => {
    spyOn(window, 'prompt').and.returnValue('stale');
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkRemoveTagFromSelectedJobs();
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { remove_tags: ['stale'] });
  });

  it('reports an error when bulk tag removal fails', async () => {
    spyOn(window, 'prompt').and.returnValue('stale');
    admin.updateMediaJobTriage.and.returnValue(errDetail());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkRemoveTagFromSelectedJobs();
    expect(toast.error).toHaveBeenCalledWith('boom');
  });

  // ---------- single job actions ----------

  it('retries a single job and replaces it in the list', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.jobs.set([makeJob({ id: 'job-2', status: 'failed' }), makeJob({ id: 'job-7' })]);
    await component.retryJob(makeJob({ id: 'job-2' }));
    expect(component.jobs().find((j) => j.id === 'job-2')?.status).toBe('queued');
    expect(toast.success).toHaveBeenCalledWith('Job queued for retry.');
  });

  it('refreshes open job events when the retried job is being viewed', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.jobs.set([makeJob({ id: 'job-2' })]);
    component.activeJobEventsFor.set(makeJob({ id: 'job-2' }));
    admin.listMediaJobEvents.calls.reset();
    await component.retryJob(makeJob({ id: 'job-2' }));
    expect(admin.listMediaJobEvents).toHaveBeenCalledWith('job-2', { limit: 200 });
  });

  it('reports an error when retrying a single job fails', async () => {
    admin.retryMediaJob.and.returnValue(errDetail());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.retryJob(makeJob({ id: 'job-2' }));
    expect(toast.error).toHaveBeenCalledWith('boom');
  });

  it('cancels assigning a single job when the prompt is dismissed', async () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.assignJob(makeJob({ id: 'job-2', assigned_to_user_id: 'u-1' }));
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('assigns a single job to a user id', async () => {
    spyOn(window, 'prompt').and.returnValue(' u-5 ');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.assignJob(makeJob({ id: 'job-2', assigned_to_user_id: null }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', {
      assigned_to_user_id: 'u-5',
    });
  });

  it('clears a single job assignee with a blank prompt value', async () => {
    spyOn(window, 'prompt').and.returnValue('  ');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.assignJob(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { clear_assignee: true });
  });

  it('cancels setting an SLA when the prompt is dismissed', async () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.setSla(
      makeJob({ id: 'job-2', sla_due_at: '2026-02-16T00:00:00Z' }),
    );
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('sets and clears the SLA due date', async () => {
    const promptSpy = spyOn(window, 'prompt').and.returnValues('2026-03-01T10:00:00', '   ');
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    await component.setSla(makeJob({ id: 'job-2', sla_due_at: null }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', {
      sla_due_at: '2026-03-01T10:00:00',
    });
    await component.setSla(makeJob({ id: 'job-2', sla_due_at: '2026-02-16T00:00:00Z' }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { clear_sla_due_at: true });
    expect(promptSpy).toHaveBeenCalledTimes(2);
  });

  it('cancels setting an incident when the prompt is dismissed', async () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.setIncident(makeJob({ id: 'job-2', incident_url: 'http://x' }));
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('sets and clears the incident link', async () => {
    spyOn(window, 'prompt').and.returnValues('https://incident/1', '');
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    await component.setIncident(makeJob({ id: 'job-2', incident_url: null }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', {
      incident_url: 'https://incident/1',
    });
    await component.setIncident(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { clear_incident_url: true });
  });

  it('sets a triage state on a single job', async () => {
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.setTriageState(makeJob({ id: 'job-2' }), 'resolved');
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { triage_state: 'resolved' });
  });

  it('skips adding a job tag when the prompt is blank', async () => {
    spyOn(window, 'prompt').and.returnValue('   ');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.addJobTag(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('adds a tag to a single job', async () => {
    spyOn(window, 'prompt').and.returnValue(' fresh ');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.addJobTag(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { add_tags: ['fresh'] });
  });

  it('skips removing a job tag when the prompt is blank', async () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.removeJobTag(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('removes a tag from a single job', async () => {
    spyOn(window, 'prompt').and.returnValue('old');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.removeJobTag(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { remove_tags: ['old'] });
  });

  it('cancels a triage note when the prompt is dismissed', async () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.addTriageNote(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('saves a triage note and clears it when blank', async () => {
    spyOn(window, 'prompt').and.returnValues('looking into it', '   ');
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    await component.addTriageNote(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { note: 'looking into it' });
    await component.addTriageNote(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { note: null });
  });

  it('reports an error when a triage patch fails', async () => {
    admin.updateMediaJobTriage.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.setTriageState(makeJob({ id: 'job-2' }), 'open');
    expect(toast.error).toHaveBeenCalledWith('Failed to update job triage.');
  });

  // ---------- job events modal ----------

  it('opens job events and loads the event list', async () => {
    admin.listMediaJobEvents.and.returnValue(
      of({
        items: [
          {
            id: 'e1',
            job_id: 'job-2',
            action: 'queued',
            actor_user_id: null,
            note: null,
            meta_json: null,
            created_at: '2026-02-16T00:00:00Z',
          },
        ],
      }),
    );
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.openJobEvents(makeJob({ id: 'job-2' }));
    await Promise.resolve();
    expect(component.jobEvents().length).toBe(1);
    expect(component.jobEventsLoading()).toBeFalse();
  });

  it('tolerates a missing events array and reports load failures', () => {
    admin.listMediaJobEvents.and.returnValue(of({} as unknown as MediaJobEventsResponse));
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.openJobEvents(makeJob({ id: 'job-2' }));
    expect(component.jobEvents()).toEqual([]);

    admin.listMediaJobEvents.and.returnValue(errDetail());
    component.openJobEvents(makeJob({ id: 'job-3' }));
    expect(toast.error).toHaveBeenCalledWith('boom');
    expect(component.jobEventsLoading()).toBeFalse();
  });

  it('closes the job events modal', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.activeJobEventsFor.set(makeJob({ id: 'job-2' }));
    component.jobEvents.set([
      {
        id: 'e1',
        job_id: 'job-2',
        action: 'x',
        actor_user_id: null,
        note: null,
        meta_json: null,
        created_at: '2026-02-16T00:00:00Z',
      },
    ]);
    component.closeJobEvents();
    expect(component.activeJobEventsFor()).toBeNull();
    expect(component.jobEvents()).toEqual([]);
  });

  // ---------- asset selection + upload ----------

  it('toggles asset selection on and off', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.toggleSelected('asset-1', { target: { checked: true } } as unknown as Event);
    expect(component.selectedIds().has('asset-1')).toBeTrue();
    component.toggleSelected('asset-1', { target: { checked: false } } as unknown as Event);
    expect(component.selectedIds().has('asset-1')).toBeFalse();
  });

  it('ignores upload when no file is chosen', async () => {
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.upload({ target: { files: [] } } as unknown as Event);
    expect(admin.uploadMediaAsset).not.toHaveBeenCalled();
  });

  it('uploads a chosen file and resets the input', async () => {
    const fixture = make();
    fixture.detectChanges();
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const input = { files: [file], value: 'a.png' };
    await fixture.componentInstance.upload({ target: input } as unknown as Event);
    expect(admin.uploadMediaAsset).toHaveBeenCalledWith(file, {
      visibility: 'private',
      auto_finalize: true,
    });
    expect(toast.success).toHaveBeenCalledWith('Media uploaded.');
    expect(input.value).toBe('');
  });

  it('reports an error when an upload fails', async () => {
    admin.uploadMediaAsset.and.returnValue(errDetail());
    const fixture = make();
    fixture.detectChanges();
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await fixture.componentInstance.upload({
      target: { files: [file], value: 'a.png' },
    } as unknown as Event);
    expect(toast.error).toHaveBeenCalledWith('boom');
  });

  // ---------- details modal ----------

  it('opens details and pre-fills localized fields when present', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.openDetails({
      ...baseAsset,
      rights_license: 'CC-BY',
      rights_owner: 'Studio',
      i18n: [
        { lang: 'en', title: 'Title EN', alt_text: 'Alt EN' },
        { lang: 'ro', title: 'Title RO', alt_text: 'Alt RO' },
      ],
    });
    expect(component.editRightsLicense).toBe('CC-BY');
    expect(component.editTitleEn).toBe('Title EN');
    expect(component.editTitleRo).toBe('Title RO');
  });

  it('opens details with empty fields when localized data is missing', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.openDetails(baseAsset);
    expect(component.editRightsLicense).toBe('');
    expect(component.editTitleEn).toBe('');
    expect(component.editAltRo).toBe('');
  });

  it('closes the details modal', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.detailAsset.set(baseAsset);
    component.closeDetails();
    expect(component.detailAsset()).toBeNull();
  });

  it('does nothing when saving details without an open asset', async () => {
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.saveDetails();
    expect(admin.updateMediaAsset).not.toHaveBeenCalled();
  });

  it('saves details with localized payload and nullifies blanks', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.detailAsset.set(baseAsset);
    component.editRightsLicense = '';
    component.editRightsOwner = 'Owner';
    component.editVisibility = 'public';
    component.editStatus = 'approved';
    component.editTitleEn = 'EN';
    component.editAltEn = '';
    component.editTitleRo = '';
    component.editAltRo = 'RO alt';
    await component.saveDetails();
    expect(admin.updateMediaAsset).toHaveBeenCalledWith('asset-1', {
      rights_license: null,
      rights_owner: 'Owner',
      visibility: 'public',
      status: 'approved',
      i18n: [
        { lang: 'en', title: 'EN', alt_text: null },
        { lang: 'ro', title: null, alt_text: 'RO alt' },
      ],
    });
    expect(component.detailAsset()).toBeNull();
  });

  it('reports an error when saving details fails', async () => {
    admin.updateMediaAsset.and.returnValue(errDetail());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.detailAsset.set(baseAsset);
    await component.saveDetails();
    expect(toast.error).toHaveBeenCalledWith('boom');
  });

  // ---------- tags / variant / edit / usage ----------

  it('cancels editing tags when the prompt is dismissed', async () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.editTags(baseAsset);
    expect(admin.updateMediaAsset).not.toHaveBeenCalled();
  });

  it('updates tags from a comma-separated prompt', async () => {
    spyOn(window, 'prompt').and.returnValue('one, two ,, three');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.editTags(baseAsset);
    expect(admin.updateMediaAsset).toHaveBeenCalledWith('asset-1', {
      tags: ['one', 'two', 'three'],
    });
  });

  it('reports an error when updating tags fails', async () => {
    spyOn(window, 'prompt').and.returnValue('one');
    admin.updateMediaAsset.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.editTags(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('Failed to update tags.');
  });

  it('cancels variant requests when the prompt is dismissed', async () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.requestVariant(baseAsset);
    expect(admin.requestMediaVariant).not.toHaveBeenCalled();
  });

  it('queues a variant job for the chosen profile', async () => {
    spyOn(window, 'prompt').and.returnValue(' web-640 ');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.requestVariant(baseAsset);
    expect(admin.requestMediaVariant).toHaveBeenCalledWith('asset-1', 'web-640');
  });

  it('reports an error when a variant job fails to queue', async () => {
    spyOn(window, 'prompt').and.returnValue('web-640');
    admin.requestMediaVariant.and.returnValue(errDetail());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.requestVariant(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('boom');
  });

  it('cancels image edits when the prompt is dismissed', async () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.editImage(baseAsset);
    expect(admin.editMediaAsset).not.toHaveBeenCalled();
  });

  it('queues an image edit job with the requested rotation', async () => {
    spyOn(window, 'prompt').and.returnValue('90');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.editImage(baseAsset);
    expect(admin.editMediaAsset).toHaveBeenCalledWith('asset-1', { rotate_cw: 90 });
  });

  it('reports an error when an image edit job fails to queue', async () => {
    spyOn(window, 'prompt').and.returnValue('90');
    admin.editMediaAsset.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.editImage(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('Failed to queue edit job.');
  });

  it('alerts with usage sources when present', async () => {
    const alertSpy = spyOn(window, 'alert');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.openUsage(baseAsset);
    expect(alertSpy).toHaveBeenCalledWith('Used in:\nhome');
  });

  it('alerts that no usage exists when the list is empty', async () => {
    admin.getMediaAssetUsage.and.returnValue(
      of({ asset_id: 'asset-1', public_url: '/x', items: [] }),
    );
    const alertSpy = spyOn(window, 'alert');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.openUsage(baseAsset);
    expect(alertSpy).toHaveBeenCalledWith('No usage found.');
  });

  it('reports an error when loading usage fails', async () => {
    admin.getMediaAssetUsage.and.returnValue(errDetail());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.openUsage(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('boom');
  });

  // ---------- approval lifecycle ----------

  it('approves an asset and reloads', async () => {
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.approve(baseAsset);
    expect(admin.approveMediaAsset).toHaveBeenCalledWith('asset-1');
    expect(toast.success).toHaveBeenCalledWith('Asset approved.');
  });

  it('reports an error when approval fails', async () => {
    admin.approveMediaAsset.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.approve(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('Approval failed.');
  });

  it('rejects an asset and reloads', async () => {
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.reject(baseAsset);
    expect(admin.rejectMediaAsset).toHaveBeenCalledWith('asset-1');
    expect(toast.success).toHaveBeenCalledWith('Asset rejected.');
  });

  it('reports an error when rejection fails', async () => {
    admin.rejectMediaAsset.and.returnValue(errDetail());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.reject(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('boom');
  });

  it('cancels soft delete when not confirmed', async () => {
    spyOn(window, 'confirm').and.returnValue(false);
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.softDelete(baseAsset);
    expect(admin.softDeleteMediaAsset).not.toHaveBeenCalled();
  });

  it('soft deletes an asset when confirmed', async () => {
    spyOn(window, 'confirm').and.returnValue(true);
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.softDelete(baseAsset);
    expect(admin.softDeleteMediaAsset).toHaveBeenCalledWith('asset-1');
    expect(toast.success).toHaveBeenCalledWith('Asset moved to trash.');
  });

  it('reports an error when soft delete fails', async () => {
    spyOn(window, 'confirm').and.returnValue(true);
    admin.softDeleteMediaAsset.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.softDelete(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('Trash action failed.');
  });

  it('restores an asset', async () => {
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.restore(baseAsset);
    expect(admin.restoreMediaAsset).toHaveBeenCalledWith('asset-1');
    expect(toast.success).toHaveBeenCalledWith('Asset restored.');
  });

  it('reports an error when restore fails', async () => {
    admin.restoreMediaAsset.and.returnValue(errDetail());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.restore(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('boom');
  });

  it('cancels purge when not confirmed', async () => {
    spyOn(window, 'confirm').and.returnValue(false);
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.purge(baseAsset);
    expect(admin.purgeMediaAsset).not.toHaveBeenCalled();
  });

  it('purges an asset when confirmed', async () => {
    spyOn(window, 'confirm').and.returnValue(true);
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.purge(baseAsset);
    expect(admin.purgeMediaAsset).toHaveBeenCalledWith('asset-1');
    expect(toast.success).toHaveBeenCalledWith('Asset purged.');
  });

  it('reports an error when purge fails', async () => {
    spyOn(window, 'confirm').and.returnValue(true);
    admin.purgeMediaAsset.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.purge(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('Purge failed.');
  });

  // ---------- collections ----------

  it('tolerates a missing collection list and reports load failures', async () => {
    admin.listMediaCollections.and.returnValue(of(null as unknown as MediaCollection[]));
    const fixture = make();
    fixture.detectChanges();
    await Promise.resolve();
    expect(fixture.componentInstance.collections()).toEqual([]);

    admin.listMediaCollections.and.returnValue(errDetail());
    await fixture.componentInstance.loadCollections();
    expect(toast.error).toHaveBeenCalledWith('boom');
  });

  it('validates collection name and slug before creating', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.newCollectionName = '   ';
    component.newCollectionSlug = 'slug';
    await component.createCollection();
    expect(admin.createMediaCollection).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Collection name and slug are required.');
  });

  it('creates a collection and resets the form', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.newCollectionName = 'New';
    component.newCollectionSlug = 'New-Slug';
    component.newCollectionVisibility = 'public';
    await component.createCollection();
    expect(admin.createMediaCollection).toHaveBeenCalledWith({
      name: 'New',
      slug: 'new-slug',
      visibility: 'public',
    });
    expect(component.newCollectionName).toBe('');
    expect(component.newCollectionVisibility).toBe('private');
  });

  it('reports an error when creating a collection fails', async () => {
    admin.createMediaCollection.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.newCollectionName = 'New';
    component.newCollectionSlug = 'slug';
    await component.createCollection();
    expect(toast.error).toHaveBeenCalledWith('Failed to create collection.');
  });

  it('cancels editing a collection when the name prompt is dismissed', async () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.editCollection(makeCollection());
    expect(admin.updateMediaCollection).not.toHaveBeenCalled();
  });

  it('cancels editing a collection when the slug prompt is dismissed', async () => {
    spyOn(window, 'prompt').and.returnValues('Name', null);
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.editCollection(makeCollection());
    expect(admin.updateMediaCollection).not.toHaveBeenCalled();
  });

  it('cancels editing a collection when the visibility prompt is blank', async () => {
    spyOn(window, 'prompt').and.returnValues('Name', 'slug', '');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.editCollection(makeCollection());
    expect(admin.updateMediaCollection).not.toHaveBeenCalled();
  });

  it('updates a collection to public visibility', async () => {
    spyOn(window, 'prompt').and.returnValues('Name', ' New-Slug ', 'public');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.editCollection(makeCollection());
    expect(admin.updateMediaCollection).toHaveBeenCalledWith('col-1', {
      name: 'Name',
      slug: 'new-slug',
      visibility: 'public',
    });
  });

  it('coerces unknown visibility to private when updating a collection', async () => {
    spyOn(window, 'prompt').and.returnValues('Name', 'slug', 'weird');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.editCollection(makeCollection());
    expect(admin.updateMediaCollection).toHaveBeenCalledWith('col-1', {
      name: 'Name',
      slug: 'slug',
      visibility: 'private',
    });
  });

  it('reports an error when updating a collection fails', async () => {
    spyOn(window, 'prompt').and.returnValues('Name', 'slug', 'private');
    admin.updateMediaCollection.and.returnValue(errDetail());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.editCollection(makeCollection());
    expect(toast.error).toHaveBeenCalledWith('boom');
  });

  it('requires a selection before attaching assets to a collection', async () => {
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.attachSelectionToCollection(makeCollection());
    expect(admin.replaceMediaCollectionItems).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Select at least one asset first.');
  });

  it('attaches the current selection to a collection', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectedIds.set(new Set(['asset-1', 'asset-2']));
    await component.attachSelectionToCollection(makeCollection());
    expect(admin.replaceMediaCollectionItems).toHaveBeenCalledWith('col-1', ['asset-1', 'asset-2']);
    expect(toast.success).toHaveBeenCalledWith('Collection items updated.');
  });

  it('reports an error when attaching a selection fails', async () => {
    admin.replaceMediaCollectionItems.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectedIds.set(new Set(['asset-1']));
    await component.attachSelectionToCollection(makeCollection());
    expect(toast.error).toHaveBeenCalledWith('Failed to update collection items.');
  });

  // ---------- telemetry + polling ----------

  it('keeps stale telemetry when a refresh fails', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.telemetry.set(telemetry({ queue_depth: 9 }));
    admin.getMediaTelemetry.and.returnValue(errPlain());
    component.reload();
    expect(component.telemetry()?.queue_depth).toBe(9);
  });

  it('polls the job queue while on the queue tab and stops on tab change', fakeAsync(() => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    (component as unknown as { startQueuePolling: () => void }).startQueuePolling();
    admin.listMediaJobs.calls.reset();
    tick(8000);
    expect(admin.listMediaJobs).toHaveBeenCalled();

    component.tab.set('library');
    admin.listMediaJobs.calls.reset();
    tick(8000);
    expect(admin.listMediaJobs).not.toHaveBeenCalled();

    component.ngOnDestroy();
  }));

  // ---------- complementary branch coverage (default-value / fallback arms) ----------

  it('tolerates a retry policy list without items or schedules', () => {
    admin.listMediaRetryPolicies.and.returnValue(of({} as unknown as MediaRetryPolicyListResponse));
    const fixture = make();
    fixture.detectChanges();
    fixture.componentInstance.loadRetryPolicies();
    expect(fixture.componentInstance.retryPolicies()).toEqual([]);
  });

  it('joins an empty schedule when a policy omits the backoff array', () => {
    admin.listMediaRetryPolicies.and.returnValue(
      of({ items: [makePolicy({ backoff_schedule_seconds: undefined as never })] }),
    );
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.loadRetryPolicies();
    expect(component.retryPolicyDraft('ingest').scheduleText).toBe('');
  });

  it('uses the default error message when resetting a policy fails without detail', async () => {
    admin.resetMediaRetryPolicy.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    await component.resetRetryPolicy('ingest');
    expect(component.retryPolicyError('ingest')).toBe('Failed to reset retry policy.');
  });

  it('tolerates a reset-all response without items or schedules', async () => {
    admin.resetAllMediaRetryPolicies.and.returnValue(
      of({ items: [makePolicy({ backoff_schedule_seconds: undefined as never })] }),
    );
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    await component.resetAllRetryPolicies();
    expect(component.retryPolicyDraft('ingest').scheduleText).toBe('');

    admin.resetAllMediaRetryPolicies.and.returnValue(
      of({} as unknown as MediaRetryPolicyListResponse),
    );
    await component.resetAllRetryPolicies();
    expect(component.retryPolicies()).toEqual([]);
  });

  it('uses the default error message when resetting all policies fails without detail', async () => {
    admin.resetAllMediaRetryPolicies.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.resetAllRetryPolicies();
    expect(fixture.componentInstance.retryPoliciesError()).toBe('Failed to reset retry policies.');
  });

  it('returns an empty history list for an unknown job type', () => {
    const fixture = make();
    fixture.detectChanges();
    expect(fixture.componentInstance.retryPolicyHistoryItems('variant')).toEqual([]);
  });

  it('formats an enabled snapshot that omits its schedule', () => {
    const fixture = make();
    fixture.detectChanges();
    expect(
      fixture.componentInstance.formatPolicySnapshot(
        snapshot({ backoff_schedule_seconds: undefined as never, enabled: true }),
      ),
    ).toBe('5 tries · [] · jitter 0.15 · on');
  });

  it('builds a snapshot of a sparse current policy when previewing a rollback', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    await Promise.resolve();
    component.retryPolicies.set([
      makePolicy({
        backoff_schedule_seconds: undefined as never,
        jitter_ratio: 0,
        updated_at: '',
      }),
    ]);
    await component.rollbackRetryPolicyPreset('ingest', 'factory_default');
    const preview = component.retryPolicyRollbackPreview();
    expect(preview?.currentPolicy.backoff_schedule_seconds).toEqual([]);
    expect(preview?.currentPolicy.version_ts).toBeNull();
  });

  it('diffs sparse and empty policy snapshots without throwing', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const sparse = snapshot({
      backoff_schedule_seconds: undefined as never,
      jitter_ratio: 0,
      enabled: false,
    });
    expect(component.retryPolicyDiffChips(sparse, sparse)).toEqual([]);
    const grown = component.retryPolicyEventDiffRows({
      id: 'evt-grow',
      job_type: 'ingest',
      action: 'update',
      actor_user_id: null,
      preset_key: null,
      before_policy: snapshot({ backoff_schedule_seconds: [30] }),
      after_policy: snapshot({ backoff_schedule_seconds: [30, 120] }),
      note: null,
      created_at: '2026-02-16T03:00:00Z',
    });
    const scheduleRow = grown.find((r) => r.field === 'backoff_schedule_seconds');
    expect(scheduleRow?.detail).toContain('#2: — -> 120');
  });

  it('uses the default error message when marking known good fails without detail', async () => {
    admin.markMediaRetryPolicyKnownGood.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    await component.markRetryPolicyKnownGood('ingest');
    expect(component.retryPolicyError('ingest')).toBe('Failed to mark policy as known good.');
  });

  it('reloads history then errors when an event is missing after a failed reload', async () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    admin.listMediaRetryPolicyHistory.and.returnValue(errPlain());
    await component.rollbackRetryPolicyEvent('ingest', 'evt-1');
    expect(component.retryPolicyError('ingest')).toBe('History event is not available.');
  });

  it('uses the default error message when applying a rollback fails without detail', async () => {
    admin.rollbackMediaRetryPolicy.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    await component.rollbackRetryPolicyPreset('ingest', 'factory_default');
    await component.applyRetryPolicyRollbackPreview();
    expect(component.retryPolicyError('ingest')).toBe('Failed to rollback retry policy.');
  });

  it('handles a malformed bulk retry response', async () => {
    admin.retryMediaJobsBulk.and.returnValue(of({} as unknown as MediaJobListResponse));
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.jobs.set([makeJob({ id: 'job-2' })]);
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkRetrySelectedJobs();
    expect(toast.error).toHaveBeenCalled();
  });

  it('uses default error messages on bulk retry/mark/tag failures without detail', async () => {
    admin.retryMediaJobsBulk.and.returnValue(errPlain());
    admin.updateMediaJobTriage.and.returnValue(errPlain());
    spyOn(window, 'prompt').and.returnValue('tag');
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkRetrySelectedJobs();
    expect(toast.error).toHaveBeenCalledWith('Bulk retry failed.');
    await component.bulkMarkSelectedJobs('resolved');
    expect(toast.error).toHaveBeenCalledWith('Bulk triage update failed.');
    await component.bulkRemoveTagFromSelectedJobs();
    expect(toast.error).toHaveBeenCalledWith('Bulk tag removal failed.');
  });

  it('uses the default error message when a single retry fails without detail', async () => {
    admin.retryMediaJob.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.retryJob(makeJob({ id: 'job-2' }));
    expect(toast.error).toHaveBeenCalledWith('Retry failed.');
  });

  it('uses the default error message when job events fail to load without detail', () => {
    admin.listMediaJobEvents.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    fixture.componentInstance.openJobEvents(makeJob({ id: 'job-2' }));
    expect(toast.error).toHaveBeenCalledWith('Failed to load job events.');
  });

  it('uses the default error message when an upload fails without detail', async () => {
    admin.uploadMediaAsset.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await fixture.componentInstance.upload({
      target: { files: [file], value: 'a.png' },
    } as unknown as Event);
    expect(toast.error).toHaveBeenCalledWith('Upload failed.');
  });

  it('opens details for an asset that omits localized metadata', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.openDetails({ ...baseAsset, i18n: undefined as never });
    expect(component.editTitleEn).toBe('');
    expect(component.editTitleRo).toBe('');
  });

  it('uses the default error message when saving details fails without detail', async () => {
    admin.updateMediaAsset.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.detailAsset.set(baseAsset);
    await component.saveDetails();
    expect(toast.error).toHaveBeenCalledWith('Failed to update asset metadata.');
  });

  it('seeds the tag prompt with an empty list when tags are missing', async () => {
    const promptSpy = spyOn(window, 'prompt').and.returnValue(null);
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.editTags({ ...baseAsset, tags: undefined as never });
    expect(promptSpy).toHaveBeenCalledWith('Comma-separated tags', '');
  });

  it('uses the default error message when a variant job fails without detail', async () => {
    spyOn(window, 'prompt').and.returnValue('web-640');
    admin.requestMediaVariant.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.requestVariant(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('Failed to queue variant job.');
  });

  it('defaults a blank rotation to zero when queuing an image edit', async () => {
    spyOn(window, 'prompt').and.returnValue('');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.editImage(baseAsset);
    expect(admin.editMediaAsset).toHaveBeenCalledWith('asset-1', { rotate_cw: 0 });
  });

  it('handles usage responses without an items array and default errors', async () => {
    admin.getMediaAssetUsage.and.returnValue(
      of({ asset_id: 'asset-1', public_url: '/x', items: undefined as never }),
    );
    const alertSpy = spyOn(window, 'alert');
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.openUsage(baseAsset);
    expect(alertSpy).toHaveBeenCalledWith('No usage found.');

    admin.getMediaAssetUsage.and.returnValue(errPlain());
    await fixture.componentInstance.openUsage(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('Failed to load usage.');
  });

  it('uses default error messages on reject/restore failures without detail', async () => {
    admin.rejectMediaAsset.and.returnValue(errPlain());
    admin.restoreMediaAsset.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    await component.reject(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('Reject failed.');
    await component.restore(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('Restore failed.');
  });

  it('uses the default error message when loading collections fails without detail', async () => {
    admin.listMediaCollections.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.loadCollections();
    expect(toast.error).toHaveBeenCalledWith('Failed to load collections.');
  });

  it('uses the default error message when updating a collection fails without detail', async () => {
    spyOn(window, 'prompt').and.returnValues('Name', 'slug', 'private');
    admin.updateMediaCollection.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.editCollection(makeCollection());
    expect(toast.error).toHaveBeenCalledWith('Failed to update collection.');
  });

  it('parses an empty schedule string as no entries', () => {
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.setRetryPolicyDraftSchedule('ingest', '');
    expect(component.retryDelayPreview('ingest')).toBe('invalid schedule');
  });

  it('preserves unrelated policy rows and an empty saved schedule on save', async () => {
    admin.updateMediaRetryPolicy.and.returnValue(
      of(makePolicy({ backoff_schedule_seconds: undefined as never })),
    );
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    component.retryPolicies.set([
      makePolicy({ job_type: 'variant' }),
      makePolicy({ job_type: 'ingest' }),
    ]);
    component.retryPolicyDraft('ingest').scheduleText = '10,30';
    await component.saveRetryPolicy('ingest');
    expect(component.retryPolicies().some((p) => p.job_type === 'variant')).toBeTrue();
    expect(component.retryPolicyDraft('ingest').scheduleText).toBe('');
  });

  it('tolerates a presets response without items', async () => {
    admin.getMediaRetryPolicyPresets.and.returnValue(
      of({ job_type: 'ingest' } as unknown as MediaRetryPolicyPresetsResponse),
    );
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    await Promise.resolve();
    expect(component.retryPolicyPresetSummary('ingest')).toBe('loading…');
  });

  it('defaults history paging fields for a fresh append with a sparse response', async () => {
    admin.listMediaRetryPolicyHistory.and.returnValue(
      of({
        items: undefined,
        meta: { page: 0, total_pages: 0 },
      } as unknown as MediaRetryPolicyHistoryResponse),
    );
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    await (
      component as unknown as {
        loadRetryPolicyHistory: (jobType: string, append: boolean) => Promise<void>;
      }
    ).loadRetryPolicyHistory('variant', true);
    expect(component.retryPolicyHistoryItems('variant')).toEqual([]);
    expect(component.retryPolicyHistoryHasMore('variant')).toBeFalse();
  });

  it('uses the default error message when history fails to load without detail', async () => {
    admin.listMediaRetryPolicyHistory.and.returnValue(errPlain());
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    await Promise.resolve();
    expect(component.retryPolicyHistoryError('ingest')).toBe(
      'Failed to load retry policy history.',
    );
  });

  it('sorts loaded retry policies by job type', () => {
    admin.listMediaRetryPolicies.and.returnValue(
      of({ items: [makePolicy({ job_type: 'variant' }), makePolicy({ job_type: 'ingest' })] }),
    );
    const fixture = make();
    fixture.detectChanges();
    fixture.componentInstance.loadRetryPolicies();
    expect(fixture.componentInstance.retryPolicies().map((p) => p.job_type)).toEqual([
      'ingest',
      'variant',
    ]);
  });

  it('sorts retry policies by job type after a reset-all', async () => {
    admin.resetAllMediaRetryPolicies.and.returnValue(
      of({ items: [makePolicy({ job_type: 'variant' }), makePolicy({ job_type: 'ingest' })] }),
    );
    const fixture = make();
    fixture.detectChanges();
    await fixture.componentInstance.resetAllRetryPolicies();
    expect(fixture.componentInstance.retryPolicies().map((p) => p.job_type)).toEqual([
      'ingest',
      'variant',
    ]);
  });

  it('deduplicates the pushed job and keeps other queue entries', async () => {
    spyOn(window, 'prompt').and.returnValue('web-1280');
    const fixture = make();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.jobs.set([makeJob({ id: 'job-x', status: 'failed' }), makeJob({ id: 'job-y' })]);
    await component.requestVariant(baseAsset);
    const ids = component.jobs().map((j) => j.id);
    expect(ids.filter((id) => id === 'job-x').length).toBe(1);
    expect(ids).toContain('job-y');
    expect(component.jobs()[0].job_type).toBe('variant');
  });
});
