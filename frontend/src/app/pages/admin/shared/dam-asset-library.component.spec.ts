import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject, throwError } from 'rxjs';

import {
  AdminService,
  MediaAsset,
  MediaCollection,
  MediaJob,
  MediaJobEvent,
  MediaRetryPolicyEvent,
  MediaRetryPolicyPreset,
  MediaTelemetryResponse,
} from '../../../core/admin.service';
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
    variants: [],
  };

  function makeAsset(over: Partial<MediaAsset> = {}): MediaAsset {
    return { ...baseAsset, ...over };
  }

  function makeJob(over: Partial<MediaJob> = {}): MediaJob {
    return {
      id: 'job-x',
      asset_id: 'asset-1',
      job_type: 'ingest',
      status: 'queued',
      progress_pct: 0,
      attempt: 1,
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
    };
  }

  function makeEvent(over: Partial<MediaJobEvent> = {}): MediaJobEvent {
    return {
      id: 'evt-job-1',
      job_id: 'job-x',
      actor_user_id: null,
      action: 'created',
      note: null,
      meta_json: null,
      created_at: '2026-02-16T00:00:00Z',
      ...over,
    };
  }

  function makeCollection(over: Partial<MediaCollection> = {}): MediaCollection {
    return {
      id: 'coll-1',
      name: 'Heroes',
      slug: 'heroes',
      visibility: 'private',
      created_at: '2026-02-16T00:00:00Z',
      updated_at: '2026-02-16T00:00:00Z',
      item_count: 3,
      ...over,
    };
  }

  const telemetry: MediaTelemetryResponse = {
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
  };

  const historyEvent: MediaRetryPolicyEvent = {
    id: 'evt-1',
    job_type: 'ingest',
    action: 'update',
    actor_user_id: 'owner-1',
    preset_key: null,
    before_policy: {
      max_attempts: 5,
      backoff_schedule_seconds: [30, 120, 600, 1800],
      jitter_ratio: 0.15,
      enabled: true,
      version_ts: 'seed',
    },
    after_policy: {
      max_attempts: 6,
      backoff_schedule_seconds: [10, 30, 120],
      jitter_ratio: 0.2,
      enabled: true,
      version_ts: 'seed',
    },
    note: null,
    created_at: '2026-02-16T03:00:00Z',
  };

  const factoryPreset: MediaRetryPolicyPreset = {
    preset_key: 'factory_default',
    label: 'Factory default',
    policy: {
      max_attempts: 5,
      backoff_schedule_seconds: [30, 120, 600, 1800],
      jitter_ratio: 0.15,
      enabled: true,
      version_ts: 'seed',
    },
    source_event_id: null,
    fallback_used: false,
    updated_at: null,
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
    admin.getMediaTelemetry.and.returnValue(of({ ...telemetry }));
    admin.requestMediaUsageReconcile.and.returnValue(
      of(makeJob({ id: 'job-1', asset_id: null, job_type: 'usage_reconcile', attempt: 0 })),
    );
    admin.retryMediaJob.and.returnValue(
      of(makeJob({ id: 'job-2', triage_state: 'retrying', tags: ['timeout'] })),
    );
    admin.retryMediaJobsBulk.and.returnValue(
      of({
        items: [makeJob({ id: 'job-2', status: 'queued' })],
        meta: { total_items: 1, total_pages: 1, page: 1, limit: 1 },
      }),
    );
    admin.updateMediaJobTriage.and.returnValue(
      of(makeJob({ id: 'job-2', status: 'dead_letter', triage_state: 'open', tags: ['timeout'] })),
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
        items: [historyEvent],
        meta: { total_items: 1, total_pages: 1, page: 1, limit: 10 },
      }),
    );
    admin.getMediaRetryPolicyPresets.and.returnValue(
      of({ job_type: 'ingest', items: [factoryPreset] }),
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
      of({ ...historyEvent, id: 'evt-2', action: 'mark_known_good', preset_key: 'known_good' }),
    );

    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), DamAssetLibraryComponent],
      providers: [
        { provide: AdminService, useValue: admin },
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
      ],
    });
  });

  function create() {
    const fixture = TestBed.createComponent(DamAssetLibraryComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  }

  // ---------------------------------------------------------------------------
  // Initial load + library filters
  // ---------------------------------------------------------------------------

  it('loads assets on init with default list filters', () => {
    const { fixture } = create();
    expect(admin.listMediaAssets).toHaveBeenCalledWith(
      jasmine.objectContaining({ page: 1, limit: 24, sort: 'newest' }),
    );
    expect(fixture.componentInstance.assets().length).toBe(1);
  });

  it('renders an error state and surfaces request id when the asset load fails', () => {
    admin.listMediaAssets.and.returnValue(
      throwError(() => ({
        error: { detail: 'nope', request_id: 'req-42' },
        headers: { get: (k: string) => (k === 'x-request-id' ? 'req-42' : null) },
      })),
    );
    const { fixture, component } = create();
    expect(component.error()).toBe('nope');
    expect(fixture.nativeElement.querySelector('app-error-state')).toBeTruthy();
  });

  it('falls back to a generic message and empty meta on asset load error without detail', () => {
    admin.listMediaAssets.and.returnValue(throwError(() => ({})));
    const { component } = create();
    expect(component.error()).toBe('Failed to load media assets.');
    expect(component.loading()).toBeFalse();
  });

  it('uses fallback meta when the asset response omits meta', () => {
    admin.listMediaAssets.and.returnValue(of({ items: [], meta: undefined as never }));
    const { component } = create();
    expect(component.meta().total_pages).toBe(1);
  });

  it('uses preview_url for image rendering when available', () => {
    const { fixture } = create();
    const image: HTMLImageElement | null = fixture.nativeElement.querySelector('img');
    expect(image?.getAttribute('src')).toContain(
      '/api/v1/content/admin/media/assets/asset-1/preview',
    );
  });

  it('renders image fallback url, non-image preview, and trashed asset actions', () => {
    admin.listMediaAssets.and.returnValue(
      of({
        items: [
          makeAsset({
            id: 'a-img',
            preview_url: null,
            original_filename: null,
            status: 'draft',
          }),
          makeAsset({
            id: 'a-vid',
            asset_type: 'video',
            status: 'trashed',
            tags: [],
          }),
        ],
        meta: { total_items: 2, total_pages: 1, page: 1, limit: 24 },
      }),
    );
    const { fixture } = create();
    const html = fixture.nativeElement.textContent as string;
    expect(html).toContain('VIDEO preview');
    expect(html).toContain('Restore');
    expect(html).toContain('Purge');
    const img: HTMLImageElement = fixture.nativeElement.querySelector('img');
    expect(img.getAttribute('src')).toBe('/media/originals/asset-1/pic.jpg');
  });

  it('shows the loading indicator while loading is active', () => {
    const { fixture, component } = create();
    component.loading.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent as string).toContain('Loading media');
  });

  it('switches to review tab and applies draft status filter', () => {
    const { component } = create();
    admin.listMediaAssets.calls.reset();
    component.switchTab('review');
    expect(component.tab()).toBe('review');
    expect(component.statusFilter).toBe('draft');
    expect(admin.listMediaAssets).toHaveBeenCalledWith(
      jasmine.objectContaining({ status: 'draft' }),
    );
  });

  it('switches to trash tab and includes trashed assets', () => {
    const { component } = create();
    admin.listMediaAssets.calls.reset();
    component.switchTab('trash');
    expect(component.statusFilter).toBe('trashed');
    expect(admin.listMediaAssets).toHaveBeenCalledWith(
      jasmine.objectContaining({ include_trashed: true }),
    );
  });

  it('clears draft/trashed filter when returning to the library tab', () => {
    const { component } = create();
    component.switchTab('review');
    expect(component.statusFilter).toBe('draft');
    component.switchTab('library');
    expect(component.statusFilter).toBe('');
  });

  it('keeps a non draft/trashed filter when returning to library tab', () => {
    const { component } = create();
    component.statusFilter = 'approved';
    component.switchTab('library');
    expect(component.statusFilter).toBe('approved');
  });

  it('loads collections when switching to the collections tab', async () => {
    admin.listMediaCollections.and.returnValue(of([makeCollection()]));
    const { component, fixture } = create();
    component.switchTab('collections');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.collections().length).toBe(1);
    expect(fixture.nativeElement.textContent as string).toContain('Heroes');
  });

  it('resets list filters and restores tab-appropriate status', () => {
    const { component } = create();
    component.q = 'x';
    component.tag = 'y';
    component.assetType = 'image';
    component.visibility = 'public';
    component.sort = 'oldest';
    component.resetFilters();
    expect(component.q).toBe('');
    expect(component.statusFilter).toBe('');

    component.switchTab('review');
    component.resetFilters();
    expect(component.statusFilter).toBe('draft');

    component.switchTab('trash');
    component.resetFilters();
    expect(component.statusFilter).toBe('trashed');
  });

  it('paginates library forward and backward respecting bounds', () => {
    admin.listMediaAssets.and.returnValue(
      of({
        items: [baseAsset],
        meta: { total_items: 60, total_pages: 3, page: 1, limit: 24 },
      }),
    );
    const { component, fixture } = create();
    expect(fixture.nativeElement.textContent as string).toContain('Page 1 / 3');

    component.prevPage();
    expect(component.page).toBe(1); // guarded

    component.nextPage();
    expect(component.page).toBe(2);
    component.prevPage();
    expect(component.page).toBe(1);
  });

  it('stops library paging when already on the last page', () => {
    admin.listMediaAssets.and.returnValue(
      of({ items: [baseAsset], meta: { total_items: 24, total_pages: 1, page: 1, limit: 24 } }),
    );
    const { component } = create();
    component.page = 1;
    component.nextPage();
    expect(component.page).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Telemetry
  // ---------------------------------------------------------------------------

  it('formats the oldest queued label for all age buckets', () => {
    const { component, fixture } = create();
    expect(component.oldestQueuedLabel()).toBe('n/a');

    component.telemetry.set({ ...telemetry, oldest_queued_age_seconds: 30 });
    expect(component.oldestQueuedLabel()).toBe('30s');
    component.telemetry.set({ ...telemetry, oldest_queued_age_seconds: 120 });
    expect(component.oldestQueuedLabel()).toBe('2m');
    component.telemetry.set({ ...telemetry, oldest_queued_age_seconds: 7200 });
    fixture.detectChanges();
    expect(component.oldestQueuedLabel()).toBe('2h');
    expect(fixture.nativeElement.textContent as string).toContain('2h');
  });

  it('keeps stale telemetry when a refresh fails', () => {
    const { component } = create();
    component.telemetry.set({ ...telemetry, queue_depth: 9 });
    admin.getMediaTelemetry.and.returnValue(throwError(() => new Error('down')));
    component.reload();
    expect(component.telemetry()?.queue_depth).toBe(9);
  });

  // ---------------------------------------------------------------------------
  // Queue tab + jobs
  // ---------------------------------------------------------------------------

  it('loads the persistent job list and retry policies on the queue tab', () => {
    const { component } = create();
    admin.listMediaJobs.calls.reset();
    component.switchTab('queue');
    expect(admin.listMediaJobs).toHaveBeenCalledWith(
      jasmine.objectContaining({ page: 1, limit: 20, dead_letter_only: false }),
    );
    expect(admin.listMediaRetryPolicies).toHaveBeenCalled();
  });

  it('renders rich job rows including optional metadata', () => {
    admin.listMediaJobs.and.returnValue(
      of({
        items: [
          makeJob({
            id: 'job-rich',
            status: 'failed',
            next_retry_at: '2026-02-16T05:00:00Z',
            sla_due_at: '2026-02-16T06:00:00Z',
            incident_url: 'https://incident/1',
            tags: ['timeout', 'urgent'],
            error_message: 'boom',
            assigned_to_user_id: 'user-7',
          }),
          makeJob({ id: 'job-bare', asset_id: null, tags: [] }),
        ],
        meta: { total_items: 2, total_pages: 2, page: 1, limit: 20 },
      }),
    );
    const { component, fixture } = create();
    component.switchTab('queue');
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Next retry');
    expect(text).toContain('SLA');
    expect(text).toContain('Incident');
    expect(text).toContain('boom');
    expect(text).toContain('n/a');
    expect(text).toContain('Page 1 / 2');
  });

  it('shows the empty job placeholder and queue error / loading states', () => {
    const { component, fixture } = create();
    component.switchTab('queue');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent as string).toContain('No jobs found');

    component.queueError.set('queue blew up');
    component.queueLoading.set(true);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('queue blew up');
    expect(text).toContain('Loading job queue');
  });

  it('surfaces a fallback message when the job list fails', () => {
    admin.listMediaJobs.and.returnValue(throwError(() => ({})));
    const { component } = create();
    component.switchTab('queue');
    expect(component.queueError()).toBe('Failed to load media jobs.');
    expect(component.queueLoading()).toBeFalse();
  });

  it('uses fallback job meta when omitted by the response', () => {
    admin.listMediaJobs.and.returnValue(of({ items: [], meta: undefined as never }));
    const { component } = create();
    component.switchTab('queue');
    expect(component.jobsMeta().total_pages).toBe(1);
  });

  it('sends ISO created_from/to bounds when date filters are set', () => {
    const { component } = create();
    component.switchTab('queue');
    admin.listMediaJobs.calls.reset();
    component.queueCreatedFrom = '2026-02-01';
    component.queueCreatedTo = '2026-02-28';
    component.loadJobs(true);
    expect(admin.listMediaJobs).toHaveBeenCalledWith(
      jasmine.objectContaining({
        created_from: '2026-02-01T00:00:00+00:00',
        created_to: '2026-02-28T23:59:59+00:00',
      }),
    );
  });

  it('switches queue mode to dead-letter and back to pipeline', () => {
    const { component } = create();
    component.switchTab('queue');
    admin.listMediaJobs.calls.reset();

    component.setQueueMode('dead_letter');
    expect(admin.listMediaJobs).toHaveBeenCalledWith(
      jasmine.objectContaining({ dead_letter_only: true }),
    );
    expect(component.queueTriageState).toBe('open');

    admin.listMediaJobs.calls.reset();
    component.setQueueMode('dead_letter'); // same mode → no-op
    expect(admin.listMediaJobs).not.toHaveBeenCalled();

    component.setQueueMode('pipeline');
    expect(admin.listMediaJobs).toHaveBeenCalledWith(
      jasmine.objectContaining({ dead_letter_only: false }),
    );
  });

  it('keeps an existing triage state when switching to dead-letter mode', () => {
    const { component } = create();
    component.switchTab('queue');
    component.queueTriageState = 'ignored';
    component.setQueueMode('dead_letter');
    expect(component.queueTriageState).toBe('ignored');
  });

  it('paginates the queue forward and backward respecting bounds', () => {
    admin.listMediaJobs.and.returnValue(
      of({ items: [], meta: { total_items: 40, total_pages: 2, page: 1, limit: 20 } }),
    );
    const { component } = create();
    component.switchTab('queue');
    component.prevQueuePage();
    expect(component.queuePage).toBe(1);
    component.nextQueuePage();
    expect(component.queuePage).toBe(2);
    component.nextQueuePage();
    expect(component.queuePage).toBe(2); // last page guard
    component.prevQueuePage();
    expect(component.queuePage).toBe(1);
  });

  it('resets queue filters back to defaults', () => {
    const { component } = create();
    component.switchTab('queue');
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

  it('starts polling on queue tab and stops it on destroy', () => {
    jasmine.clock().install();
    const { component } = create();
    component.switchTab('queue');
    admin.listMediaJobs.calls.reset();
    jasmine.clock().tick(8000);
    expect(admin.listMediaJobs).toHaveBeenCalledTimes(1);

    // polling no-op when the tab is no longer the queue
    component.tab.set('library');
    admin.listMediaJobs.calls.reset();
    jasmine.clock().tick(8000);
    expect(admin.listMediaJobs).not.toHaveBeenCalled();

    component.ngOnDestroy();
    jasmine.clock().tick(8000);
    jasmine.clock().uninstall();
  });

  it('does not start a second polling interval while one is active', () => {
    jasmine.clock().install();
    const { component } = create();
    component.switchTab('queue');
    component.switchTab('library'); // stop
    component.switchTab('queue'); // restart
    component.switchTab('queue'); // already on queue → startQueuePolling early return path
    jasmine.clock().uninstall();
    expect(component.tab()).toBe('queue');
  });

  it('ignores a destroy when polling was never started', () => {
    const { component } = create();
    expect(() => component.ngOnDestroy()).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Retry policies
  // ---------------------------------------------------------------------------

  it('surfaces a fallback error when retry policies fail to load', () => {
    admin.listMediaRetryPolicies.and.returnValue(throwError(() => ({})));
    const { component } = create();
    component.switchTab('queue');
    expect(component.retryPoliciesError()).toBe('Failed to load retry policies.');
    expect(component.retryPoliciesLoading()).toBeFalse();
  });

  it('lazily creates a default retry policy draft for unknown job types', () => {
    const { component } = create();
    const draft = component.retryPolicyDraft('variant');
    expect(draft.max_attempts).toBe(5);
    expect(draft.scheduleText).toBe('30,120,600,1800');
    expect(draft.enabled).toBeTrue();
  });

  it('mutates retry policy draft fields through setters', () => {
    const { component } = create();
    component.switchTab('queue');
    component.setRetryPolicyDraftEnabled('ingest', false);
    component.setRetryPolicyDraftMaxAttempts('ingest', '7');
    component.setRetryPolicyDraftSchedule('ingest', '5,10');
    component.setRetryPolicyDraftJitter('ingest', '0.3');
    const draft = component.retryPolicyDraft('ingest');
    expect(draft.enabled).toBeFalse();
    expect(draft.max_attempts).toBe(7);
    expect(draft.scheduleText).toBe('5,10');
    expect(draft.jitter_ratio).toBe(0.3);
  });

  it('coerces an empty schedule setter value to an empty string', () => {
    const { component } = create();
    component.setRetryPolicyDraftSchedule('ingest', undefined as never);
    expect(component.retryPolicyDraft('ingest').scheduleText).toBe('');
  });

  it('previews retry delays and flags invalid schedules', () => {
    const { component } = create();
    component.switchTab('queue');
    component.retryPolicyDraft('ingest').scheduleText = '30,120';
    expect(component.retryDelayPreview('ingest')).toBe('#1: 30s · #2: 120s');
    component.retryPolicyDraft('ingest').scheduleText = 'abc';
    expect(component.retryDelayPreview('ingest')).toBe('invalid schedule');
  });

  it('saves retry policy edits from the jobs tab', async () => {
    const { component } = create();
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

  it('reloads presets and history after saving while history is open', async () => {
    const { component } = create();
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    admin.getMediaRetryPolicyPresets.calls.reset();
    admin.listMediaRetryPolicyHistory.calls.reset();
    await component.saveRetryPolicy('ingest');
    expect(admin.getMediaRetryPolicyPresets).toHaveBeenCalledWith('ingest');
    expect(admin.listMediaRetryPolicyHistory).toHaveBeenCalled();
  });

  it('keeps retry policy editor read-only for non owner/admin roles', async () => {
    auth.role.and.returnValue('content');
    const { component } = create();
    component.switchTab('queue');
    expect(component.canEditRetryPolicies()).toBeFalse();
    await component.saveRetryPolicy('ingest');
    expect(admin.updateMediaRetryPolicy).not.toHaveBeenCalled();
  });

  it('treats a null role as not editable', () => {
    auth.role.and.returnValue(null as never);
    const { component } = create();
    expect(component.canEditRetryPolicies()).toBeFalse();
  });

  it('rejects invalid retry schedule input before calling API', async () => {
    const { component } = create();
    component.switchTab('queue');
    admin.updateMediaRetryPolicy.calls.reset();
    component.retryPolicyDraft('ingest').scheduleText = 'abc,0';
    await component.saveRetryPolicy('ingest');
    expect(admin.updateMediaRetryPolicy).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('rejects out-of-range max attempts', async () => {
    const { component } = create();
    component.switchTab('queue');
    component.retryPolicyDraft('ingest').max_attempts = 99;
    await component.saveRetryPolicy('ingest');
    expect(component.retryPolicyError('ingest')).toContain('Max attempts');
    expect(admin.updateMediaRetryPolicy).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range jitter ratio', async () => {
    const { component } = create();
    component.switchTab('queue');
    component.retryPolicyDraft('ingest').jitter_ratio = 5;
    await component.saveRetryPolicy('ingest');
    expect(component.retryPolicyError('ingest')).toContain('Jitter');
    expect(admin.updateMediaRetryPolicy).not.toHaveBeenCalled();
  });

  it('reports a save failure with the server detail', async () => {
    admin.updateMediaRetryPolicy.and.returnValue(
      throwError(() => ({ error: { detail: 'conflict' } })),
    );
    const { component } = create();
    component.switchTab('queue');
    await component.saveRetryPolicy('ingest');
    expect(component.retryPolicyError('ingest')).toBe('conflict');
  });

  it('reports a save failure with a generic message when detail is missing', async () => {
    admin.updateMediaRetryPolicy.and.returnValue(throwError(() => ({})));
    const { component } = create();
    component.switchTab('queue');
    await component.saveRetryPolicy('ingest');
    expect(component.retryPolicyError('ingest')).toBe('Failed to update retry policy.');
  });

  it('resets a single retry policy', async () => {
    const { component } = create();
    component.switchTab('queue');
    await component.resetRetryPolicy('ingest');
    expect(admin.resetMediaRetryPolicy).toHaveBeenCalledWith('ingest');
    expect(toast.success).toHaveBeenCalled();
  });

  it('skips resetting a single retry policy without edit rights', async () => {
    auth.role.and.returnValue('content');
    const { component } = create();
    component.switchTab('queue');
    await component.resetRetryPolicy('ingest');
    expect(admin.resetMediaRetryPolicy).not.toHaveBeenCalled();
  });

  it('reloads history after a reset when the panel is open', async () => {
    const { component } = create();
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    admin.listMediaRetryPolicyHistory.calls.reset();
    await component.resetRetryPolicy('ingest');
    expect(admin.listMediaRetryPolicyHistory).toHaveBeenCalled();
  });

  it('reports a single reset failure', async () => {
    admin.resetMediaRetryPolicy.and.returnValue(throwError(() => ({})));
    const { component } = create();
    component.switchTab('queue');
    await component.resetRetryPolicy('ingest');
    expect(component.retryPolicyError('ingest')).toBe('Failed to reset retry policy.');
  });

  it('resets all retry policies', async () => {
    const { component } = create();
    component.switchTab('queue');
    await component.resetAllRetryPolicies();
    expect(admin.resetAllMediaRetryPolicies).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it('skips reset-all without edit rights', async () => {
    auth.role.and.returnValue('content');
    const { component } = create();
    component.switchTab('queue');
    await component.resetAllRetryPolicies();
    expect(admin.resetAllMediaRetryPolicies).not.toHaveBeenCalled();
  });

  it('reports a reset-all failure', async () => {
    admin.resetAllMediaRetryPolicies.and.returnValue(throwError(() => ({})));
    const { component } = create();
    component.switchTab('queue');
    await component.resetAllRetryPolicies();
    expect(component.retryPoliciesError()).toBe('Failed to reset retry policies.');
    expect(toast.error).toHaveBeenCalled();
  });

  it('toggles the history panel open and closed', async () => {
    const { component } = create();
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    expect(component.isRetryPolicyHistoryOpen('ingest')).toBeTrue();
    expect(admin.listMediaRetryPolicyHistory).toHaveBeenCalledWith({
      job_type: 'ingest',
      page: 1,
      limit: 10,
    });
    component.toggleRetryPolicyHistory('ingest');
    expect(component.isRetryPolicyHistoryOpen('ingest')).toBeFalse();
  });

  it('renders history items with diff chips, presets and rollback affordances', async () => {
    admin.listMediaRetryPolicyHistory.and.returnValue(
      of({
        items: [
          {
            ...historyEvent,
            preset_key: 'known_good',
            note: 'manual rollback',
            after_policy: {
              max_attempts: 5,
              backoff_schedule_seconds: [30, 120, 600, 1800, 3600],
              jitter_ratio: 0.15,
              enabled: false,
              version_ts: 'seed',
            },
          },
        ],
        meta: { total_items: 11, total_pages: 2, page: 1, limit: 10 },
      }),
    );
    admin.getMediaRetryPolicyPresets.and.returnValue(
      of({
        job_type: 'ingest',
        items: [
          factoryPreset,
          { ...factoryPreset, preset_key: 'known_good', label: 'Known good', fallback_used: true },
        ],
      }),
    );
    const { component, fixture } = create();
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('manual rollback');
    expect(text).toContain('known_good');
    expect(text).toContain('(fallback)');
    expect(text).toContain('Load more');
    expect(component.retryPolicyHistoryHasMore('ingest')).toBeTrue();
  });

  it('reports the preset summary loading state directly', () => {
    const { component } = create();
    expect(component.retryPolicyPresetSummary('ingest')).toBe('loading…');
  });

  it('renders a system actor and "No policy events yet" when history is empty', async () => {
    admin.listMediaRetryPolicyHistory.and.returnValue(
      of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 10 } }),
    );
    const { component, fixture } = create();
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent as string).toContain('No policy events yet');
  });

  it('renders the history error state in the panel', async () => {
    admin.listMediaRetryPolicyHistory.and.returnValue(throwError(() => ({})));
    const { component, fixture } = create();
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent as string).toContain(
      'Failed to load retry policy history.',
    );
    expect(component.retryPolicyHistoryError('ingest')).toBe(
      'Failed to load retry policy history.',
    );
  });

  it('renders the history loading state while a fetch is in flight', async () => {
    admin.listMediaRetryPolicyHistory.and.returnValue(new Subject());
    const { component, fixture } = create();
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent as string).toContain('Loading policy history');
    expect(component.retryPolicyHistoryLoading('ingest')).toBeTrue();
  });

  it('formats a policy snapshot string', () => {
    const { component } = create();
    expect(
      component.formatPolicySnapshot({
        max_attempts: 4,
        backoff_schedule_seconds: [10, 20],
        jitter_ratio: 0.1,
        enabled: false,
      }),
    ).toBe('4 tries · [10,20] · jitter 0.10 · off');
  });

  it('computes diff chips and event diff rows only for changed fields', () => {
    const { component } = create();
    const chips = component.retryPolicyDiffChips(
      historyEvent.before_policy,
      historyEvent.after_policy,
    );
    expect(chips).toContain('Max attempts');
    expect(chips).toContain('Schedule (seconds)');
    expect(chips).toContain('Jitter ratio');

    const rows = component.retryPolicyEventDiffRows(historyEvent);
    const scheduleRow = rows.find((r) => r.field === 'backoff_schedule_seconds');
    expect(scheduleRow?.detail).toContain('#');
    expect(rows.every((r) => r.changed)).toBeTrue();
  });

  it('returns no chips when policies are identical', () => {
    const { component } = create();
    const snap = historyEvent.before_policy;
    expect(component.retryPolicyDiffChips(snap, snap)).toEqual([]);
  });

  it('loads additional history pages and stops when exhausted', async () => {
    admin.listMediaRetryPolicyHistory.and.returnValues(
      of({ items: [historyEvent], meta: { total_items: 12, total_pages: 2, page: 1, limit: 10 } }),
      of({
        items: [{ ...historyEvent, id: 'evt-2' }],
        meta: { total_items: 12, total_pages: 2, page: 2, limit: 10 },
      }),
    );
    const { component } = create();
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    await Promise.resolve();
    await component.loadMoreRetryPolicyHistory('ingest');
    expect(component.retryPolicyHistoryItems('ingest').length).toBe(2);

    admin.listMediaRetryPolicyHistory.calls.reset();
    await component.loadMoreRetryPolicyHistory('ingest'); // page 2 >= total 2 → early return
    expect(admin.listMediaRetryPolicyHistory).not.toHaveBeenCalled();
  });

  it('guards against concurrent history loads', async () => {
    const { component } = create();
    const internal = component as never as {
      loadRetryPolicyHistory(jobType: string, append: boolean): Promise<void>;
    };
    const a = internal.loadRetryPolicyHistory('ingest', false);
    const b = internal.loadRetryPolicyHistory('ingest', false); // guard hit
    await Promise.all([a, b]);
    expect(admin.listMediaRetryPolicyHistory).toHaveBeenCalledTimes(1);
  });

  it('uses fallback history meta and reports history failures', async () => {
    admin.listMediaRetryPolicyHistory.and.returnValue(
      of({ items: [historyEvent], meta: undefined as never }),
    );
    const { component } = create();
    const internal = component as never as {
      loadRetryPolicyHistory(jobType: string, append: boolean): Promise<void>;
    };
    await internal.loadRetryPolicyHistory('ingest', false);
    expect(component.retryPolicyHistoryHasMore('ingest')).toBeFalse();

    admin.listMediaRetryPolicyHistory.and.returnValue(throwError(() => ({})));
    await internal.loadRetryPolicyHistory('ingest', false);
    expect(component.retryPolicyHistoryError('ingest')).toBe(
      'Failed to load retry policy history.',
    );
  });

  it('reports a preset load failure', async () => {
    admin.getMediaRetryPolicyPresets.and.returnValue(throwError(() => ({})));
    const { component } = create();
    const internal = component as never as {
      loadRetryPolicyPresets(jobType: string): Promise<void>;
    };
    await internal.loadRetryPolicyPresets('ingest');
    expect(component.retryPolicyHistoryError('ingest')).toBe(
      'Failed to load retry policy presets.',
    );
  });

  it('marks a retry policy as known good for owner/admin role', async () => {
    const { component } = create();
    component.switchTab('queue');
    await component.markRetryPolicyKnownGood('ingest');
    expect(admin.markMediaRetryPolicyKnownGood).toHaveBeenCalledWith('ingest');
    expect(toast.success).toHaveBeenCalled();
  });

  it('skips known-good without edit rights', async () => {
    auth.role.and.returnValue('content');
    const { component } = create();
    component.switchTab('queue');
    await component.markRetryPolicyKnownGood('ingest');
    expect(admin.markMediaRetryPolicyKnownGood).not.toHaveBeenCalled();
  });

  it('reports a known-good failure', async () => {
    admin.markMediaRetryPolicyKnownGood.and.returnValue(throwError(() => ({})));
    const { component } = create();
    component.switchTab('queue');
    await component.markRetryPolicyKnownGood('ingest');
    expect(component.retryPolicyError('ingest')).toBe('Failed to mark policy as known good.');
  });

  // ---------------------------------------------------------------------------
  // Rollback preview flows
  // ---------------------------------------------------------------------------

  it('opens a preset rollback preview and applies it on confirmation', async () => {
    const { component } = create();
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
    expect(component.retryPolicyRollbackPreview()).toBeNull();
  });

  it('loads presets on demand when opening a preset rollback before history', async () => {
    const { component } = create();
    component.switchTab('queue');
    admin.getMediaRetryPolicyPresets.calls.reset();
    await component.rollbackRetryPolicyPreset('ingest', 'factory_default');
    expect(admin.getMediaRetryPolicyPresets).toHaveBeenCalledWith('ingest');
    expect(component.retryPolicyRollbackPreview()?.targetLabel).toBe('Factory default');
  });

  it('skips preset rollback without edit rights', async () => {
    auth.role.and.returnValue('content');
    const { component } = create();
    component.switchTab('queue');
    await component.rollbackRetryPolicyPreset('ingest', 'factory_default');
    expect(component.retryPolicyRollbackPreview()).toBeNull();
  });

  it('errors when a requested preset is unavailable', async () => {
    admin.getMediaRetryPolicyPresets.and.returnValue(of({ job_type: 'ingest', items: [] }));
    const { component } = create();
    component.switchTab('queue');
    await component.rollbackRetryPolicyPreset('ingest', 'last_change');
    expect(component.retryPolicyError('ingest')).toBe('Preset is not available.');
    expect(component.retryPolicyRollbackPreview()).toBeNull();
  });

  it('errors when the current policy cannot be resolved for a preset rollback', async () => {
    const { component } = create();
    component.switchTab('queue');
    // 'variant' has presets via the mock but is not present in retryPolicies()
    await component.rollbackRetryPolicyPreset('variant', 'factory_default');
    expect(component.retryPolicyError('variant')).toBe('Current policy could not be loaded.');
  });

  it('opens a history-event rollback preview and applies the selected revision', async () => {
    const { component } = create();
    component.switchTab('queue');
    component.toggleRetryPolicyHistory('ingest');
    await Promise.resolve();
    await component.rollbackRetryPolicyEvent('ingest', 'evt-1');
    expect(component.retryPolicyRollbackPreview()?.request.event_id).toBe('evt-1');
    expect(component.retryPolicyRollbackPreview()?.targetLabel).toContain('history:');

    await component.applyRetryPolicyRollbackPreview();
    expect(admin.rollbackMediaRetryPolicy).toHaveBeenCalledWith('ingest', { event_id: 'evt-1' });
  });

  it('loads history on demand when opening an event rollback', async () => {
    const { component } = create();
    component.switchTab('queue');
    admin.listMediaRetryPolicyHistory.calls.reset();
    await component.rollbackRetryPolicyEvent('ingest', 'evt-1');
    expect(admin.listMediaRetryPolicyHistory).toHaveBeenCalled();
    expect(component.retryPolicyRollbackPreview()?.request.event_id).toBe('evt-1');
  });

  it('skips event rollback without edit rights', async () => {
    auth.role.and.returnValue('content');
    const { component } = create();
    component.switchTab('queue');
    await component.rollbackRetryPolicyEvent('ingest', 'evt-1');
    expect(component.retryPolicyRollbackPreview()).toBeNull();
  });

  it('errors when the requested history event is unavailable', async () => {
    admin.listMediaRetryPolicyHistory.and.returnValue(
      of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 10 } }),
    );
    const { component } = create();
    component.switchTab('queue');
    await component.rollbackRetryPolicyEvent('ingest', 'missing');
    expect(component.retryPolicyError('ingest')).toBe('History event is not available.');
  });

  it('errors when the current policy cannot be resolved for an event rollback', async () => {
    admin.listMediaRetryPolicyHistory.and.returnValue(
      of({
        items: [{ ...historyEvent, job_type: 'variant' }],
        meta: { total_items: 1, total_pages: 1, page: 1, limit: 10 },
      }),
    );
    const { component } = create();
    component.switchTab('queue');
    await component.rollbackRetryPolicyEvent('variant', 'evt-1');
    expect(component.retryPolicyError('variant')).toBe('Current policy could not be loaded.');
  });

  it('cancels an open rollback preview', async () => {
    const { component } = create();
    component.switchTab('queue');
    await component.rollbackRetryPolicyPreset('ingest', 'factory_default');
    expect(component.retryPolicyRollbackPreview()).not.toBeNull();
    component.cancelRetryPolicyRollbackPreview();
    expect(component.retryPolicyRollbackPreview()).toBeNull();
  });

  it('ignores apply when there is no rollback preview', async () => {
    const { component } = create();
    await component.applyRetryPolicyRollbackPreview();
    expect(admin.rollbackMediaRetryPolicy).not.toHaveBeenCalled();
  });

  it('ignores apply without edit rights even with a preview present', async () => {
    const { component } = create();
    component.switchTab('queue');
    await component.rollbackRetryPolicyPreset('ingest', 'factory_default');
    auth.role.and.returnValue('content');
    await component.applyRetryPolicyRollbackPreview();
    expect(admin.rollbackMediaRetryPolicy).not.toHaveBeenCalled();
  });

  it('reports a rollback apply failure and clears the applying flag', async () => {
    admin.rollbackMediaRetryPolicy.and.returnValue(throwError(() => ({})));
    const { component } = create();
    component.switchTab('queue');
    await component.rollbackRetryPolicyPreset('ingest', 'factory_default');
    await component.applyRetryPolicyRollbackPreview();
    expect(component.retryPolicyError('ingest')).toBe('Failed to rollback retry policy.');
    expect(component.retryPolicyRollbackApplying()).toBeFalse();
    expect(component.retryPolicyRollbackPreview()).not.toBeNull();
  });

  it('renders the rollback preview panel with diff rows', async () => {
    const { component, fixture } = create();
    component.switchTab('queue');
    await component.rollbackRetryPolicyPreset('ingest', 'factory_default');
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Rollback preview');
    expect(text).toContain('Factory default');
  });

  // ---------------------------------------------------------------------------
  // Usage reconcile + bulk queue operations
  // ---------------------------------------------------------------------------

  it('queues usage reconciliation and reloads jobs when on the queue tab', async () => {
    const { component } = create();
    component.switchTab('queue');
    admin.listMediaJobs.calls.reset();
    await component.runUsageReconcile();
    expect(admin.requestMediaUsageReconcile).toHaveBeenCalled();
    expect(admin.listMediaJobs).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it('queues usage reconciliation without reloading when off the queue tab', async () => {
    const { component } = create();
    admin.listMediaJobs.calls.reset();
    await component.runUsageReconcile();
    expect(admin.listMediaJobs).not.toHaveBeenCalled();
  });

  it('reports a usage reconciliation failure', async () => {
    admin.requestMediaUsageReconcile.and.returnValue(throwError(() => ({})));
    const { component } = create();
    await component.runUsageReconcile();
    expect(toast.error).toHaveBeenCalledWith('Failed to queue usage reconciliation.');
  });

  it('toggles queue job selection on and off', () => {
    const { component } = create();
    component.toggleQueueJobSelected('job-x', { target: { checked: true } } as never as Event);
    expect(component.selectedQueueJobCount()).toBe(1);
    component.toggleQueueJobSelected('job-x', { target: { checked: false } } as never as Event);
    expect(component.selectedQueueJobCount()).toBe(0);
  });

  it('renders the bulk action bar when jobs are selected', () => {
    admin.listMediaJobs.and.returnValue(
      of({ items: [makeJob()], meta: { total_items: 1, total_pages: 1, page: 1, limit: 20 } }),
    );
    const { component, fixture } = create();
    component.switchTab('queue');
    component.selectedQueueJobIds.set(new Set(['job-x']));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent as string).toContain('1 selected');
  });

  it('bulk retries selected jobs and merges responses', async () => {
    admin.listMediaJobs.and.returnValue(
      of({
        items: [makeJob({ id: 'job-2' })],
        meta: { total_items: 1, total_pages: 1, page: 1, limit: 20 },
      }),
    );
    const { component } = create();
    component.switchTab('queue');
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkRetrySelectedJobs();
    expect(admin.retryMediaJobsBulk).toHaveBeenCalledWith(['job-2']);
    expect(component.selectedQueueJobCount()).toBe(0);
  });

  it('no-ops bulk retry when nothing is selected', async () => {
    const { component } = create();
    await component.bulkRetrySelectedJobs();
    expect(admin.retryMediaJobsBulk).not.toHaveBeenCalled();
  });

  it('reports a bulk retry failure', async () => {
    admin.retryMediaJobsBulk.and.returnValue(throwError(() => ({})));
    const { component } = create();
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkRetrySelectedJobs();
    expect(toast.error).toHaveBeenCalledWith('Bulk retry failed.');
  });

  it('bulk assigns selected jobs to a user', async () => {
    spyOn(window, 'prompt').and.returnValue('user-9');
    const { component } = create();
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkAssignSelectedJobs();
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', {
      assigned_to_user_id: 'user-9',
    });
  });

  it('bulk clears assignee when the prompt is blank', async () => {
    spyOn(window, 'prompt').and.returnValue('  ');
    const { component } = create();
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkAssignSelectedJobs();
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { clear_assignee: true });
  });

  it('cancels bulk assign when the prompt is dismissed', async () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const { component } = create();
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkAssignSelectedJobs();
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('no-ops bulk assign with no selection', async () => {
    const { component } = create();
    await component.bulkAssignSelectedJobs();
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('reports a bulk assign failure', async () => {
    spyOn(window, 'prompt').and.returnValue('user-9');
    admin.updateMediaJobTriage.and.returnValue(throwError(() => ({})));
    const { component } = create();
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkAssignSelectedJobs();
    expect(toast.error).toHaveBeenCalledWith('Bulk assignment failed.');
  });

  it('bulk marks selected jobs with a triage state', async () => {
    const { component } = create();
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkMarkSelectedJobs('resolved');
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { triage_state: 'resolved' });
  });

  it('no-ops bulk mark with no selection', async () => {
    const { component } = create();
    await component.bulkMarkSelectedJobs('ignored');
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('reports a bulk mark failure', async () => {
    admin.updateMediaJobTriage.and.returnValue(throwError(() => ({})));
    const { component } = create();
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkMarkSelectedJobs('ignored');
    expect(toast.error).toHaveBeenCalledWith('Bulk triage update failed.');
  });

  it('bulk adds a tag to selected jobs', async () => {
    spyOn(window, 'prompt').and.returnValue('urgent');
    const { component } = create();
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkAddTagToSelectedJobs();
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { add_tags: ['urgent'] });
  });

  it('cancels bulk add tag when the prompt is empty', async () => {
    spyOn(window, 'prompt').and.returnValue('   ');
    const { component } = create();
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkAddTagToSelectedJobs();
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('no-ops bulk add tag with no selection', async () => {
    const { component } = create();
    await component.bulkAddTagToSelectedJobs();
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('reports a bulk add tag failure', async () => {
    spyOn(window, 'prompt').and.returnValue('urgent');
    admin.updateMediaJobTriage.and.returnValue(throwError(() => ({})));
    const { component } = create();
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkAddTagToSelectedJobs();
    expect(toast.error).toHaveBeenCalledWith('Bulk tag update failed.');
  });

  it('bulk removes a tag from selected jobs', async () => {
    spyOn(window, 'prompt').and.returnValue('urgent');
    const { component } = create();
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkRemoveTagFromSelectedJobs();
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { remove_tags: ['urgent'] });
  });

  it('cancels bulk remove tag when the prompt is empty', async () => {
    spyOn(window, 'prompt').and.returnValue('');
    const { component } = create();
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkRemoveTagFromSelectedJobs();
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('no-ops bulk remove tag with no selection', async () => {
    const { component } = create();
    await component.bulkRemoveTagFromSelectedJobs();
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('reports a bulk remove tag failure', async () => {
    spyOn(window, 'prompt').and.returnValue('urgent');
    admin.updateMediaJobTriage.and.returnValue(throwError(() => ({})));
    const { component } = create();
    component.selectedQueueJobIds.set(new Set(['job-2']));
    await component.bulkRemoveTagFromSelectedJobs();
    expect(toast.error).toHaveBeenCalledWith('Bulk tag removal failed.');
  });

  // ---------------------------------------------------------------------------
  // Single job triage actions
  // ---------------------------------------------------------------------------

  it('retries a single job', async () => {
    const { component } = create();
    await component.retryJob(makeJob({ id: 'job-2' }));
    expect(admin.retryMediaJob).toHaveBeenCalledWith('job-2');
    expect(toast.success).toHaveBeenCalledWith('Job queued for retry.');
  });

  it('reports a single retry failure', async () => {
    admin.retryMediaJob.and.returnValue(throwError(() => ({})));
    const { component } = create();
    await component.retryJob(makeJob({ id: 'job-2' }));
    expect(toast.error).toHaveBeenCalledWith('Retry failed.');
  });

  it('assigns a job from a prompt and clears when blank', async () => {
    const promptSpy = spyOn(window, 'prompt').and.returnValue('user-3');
    const { component } = create();
    await component.assignJob(makeJob({ id: 'job-2', assigned_to_user_id: 'old' }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', {
      assigned_to_user_id: 'user-3',
    });
    promptSpy.and.returnValue('   ');
    await component.assignJob(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { clear_assignee: true });
  });

  it('cancels job assignment when the prompt is dismissed', async () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const { component } = create();
    await component.assignJob(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('sets and clears the SLA due date', async () => {
    const promptSpy = spyOn(window, 'prompt').and.returnValue('2026-03-01T00:00:00');
    const { component } = create();
    await component.setSla(makeJob({ id: 'job-2', sla_due_at: '2026-02-01T00:00:00Z' }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', {
      sla_due_at: '2026-03-01T00:00:00',
    });
    promptSpy.and.returnValue('  ');
    await component.setSla(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { clear_sla_due_at: true });
  });

  it('cancels SLA editing when the prompt is dismissed', async () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const { component } = create();
    await component.setSla(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('sets and clears the incident url', async () => {
    const promptSpy = spyOn(window, 'prompt').and.returnValue('https://incident/9');
    const { component } = create();
    await component.setIncident(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', {
      incident_url: 'https://incident/9',
    });
    promptSpy.and.returnValue('');
    await component.setIncident(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { clear_incident_url: true });
  });

  it('cancels incident editing when the prompt is dismissed', async () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const { component } = create();
    await component.setIncident(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('sets a triage state directly', async () => {
    const { component } = create();
    await component.setTriageState(makeJob({ id: 'job-2' }), 'ignored');
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { triage_state: 'ignored' });
  });

  it('adds and removes a single job tag', async () => {
    const promptSpy = spyOn(window, 'prompt').and.returnValue('newtag');
    const { component } = create();
    await component.addJobTag(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { add_tags: ['newtag'] });
    await component.removeJobTag(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { remove_tags: ['newtag'] });
    promptSpy.and.returnValue('  ');
    admin.updateMediaJobTriage.calls.reset();
    await component.addJobTag(makeJob({ id: 'job-2' }));
    await component.removeJobTag(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('adds a triage note and saves null when blank', async () => {
    const promptSpy = spyOn(window, 'prompt').and.returnValue('looked into it');
    const { component } = create();
    await component.addTriageNote(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { note: 'looked into it' });
    promptSpy.and.returnValue('   ');
    await component.addTriageNote(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).toHaveBeenCalledWith('job-2', { note: null });
  });

  it('cancels a triage note when the prompt is dismissed', async () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const { component } = create();
    await component.addTriageNote(makeJob({ id: 'job-2' }));
    expect(admin.updateMediaJobTriage).not.toHaveBeenCalled();
  });

  it('reports a triage patch failure', async () => {
    admin.updateMediaJobTriage.and.returnValue(throwError(() => ({})));
    const { component } = create();
    await component.setTriageState(makeJob({ id: 'job-2' }), 'open');
    expect(toast.error).toHaveBeenCalledWith('Failed to update job triage.');
  });

  it('refreshes the open events modal when the patched job matches', async () => {
    const { component } = create();
    component.switchTab('queue');
    component.openJobEvents(makeJob({ id: 'job-2' }));
    admin.updateMediaJobTriage.and.returnValue(
      of(makeJob({ id: 'job-2', triage_state: 'resolved' })),
    );
    admin.listMediaJobEvents.calls.reset();
    await component.setTriageState(makeJob({ id: 'job-2' }), 'resolved');
    expect(component.activeJobEventsFor()?.triage_state).toBe('resolved');
    expect(admin.listMediaJobEvents).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Job events modal
  // ---------------------------------------------------------------------------

  it('opens and renders the job events modal with note and meta', () => {
    admin.listMediaJobEvents.and.returnValue(
      of({
        items: [
          makeEvent({
            action: 'failed',
            note: 'transient',
            meta_json: '{"k":1}',
            actor_user_id: 'u1',
          }),
        ],
      }),
    );
    const { component, fixture } = create();
    component.openJobEvents(makeJob({ id: 'job-2' }));
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Job events');
    expect(text).toContain('transient');
    expect(component.jobEvents().length).toBe(1);
    expect(component.jobEventsLoading()).toBeFalse();
  });

  it('renders the empty job-events placeholder', () => {
    const { component, fixture } = create();
    component.openJobEvents(makeJob({ id: 'job-2' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent as string).toContain('No events recorded');
  });

  it('shows a loading indicator while job events load', () => {
    const { component, fixture } = create();
    component.openJobEvents(makeJob({ id: 'job-2' }));
    component.jobEventsLoading.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent as string).toContain('Loading events');
  });

  it('reports a job events load failure', () => {
    admin.listMediaJobEvents.and.returnValue(throwError(() => ({})));
    const { component } = create();
    component.openJobEvents(makeJob({ id: 'job-2' }));
    expect(toast.error).toHaveBeenCalledWith('Failed to load job events.');
    expect(component.jobEventsLoading()).toBeFalse();
  });

  it('closes the job events modal', () => {
    const { component } = create();
    component.openJobEvents(makeJob({ id: 'job-2' }));
    component.closeJobEvents();
    expect(component.activeJobEventsFor()).toBeNull();
    expect(component.jobEvents()).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Asset selection + upload
  // ---------------------------------------------------------------------------

  it('toggles asset selection on and off', () => {
    const { component } = create();
    component.toggleSelected('asset-1', { target: { checked: true } } as never as Event);
    expect(component.selectedCount()).toBe(1);
    component.toggleSelected('asset-1', { target: { checked: false } } as never as Event);
    expect(component.selectedCount()).toBe(0);
  });

  it('uploads a selected file and clears the input', async () => {
    admin.uploadMediaAsset.and.returnValue(of(baseAsset));
    const { component } = create();
    const input = {
      files: [new File(['x'], 'p.jpg')],
      value: 'p.jpg',
    } as never as HTMLInputElement;
    await component.upload({ target: input } as never as Event);
    expect(admin.uploadMediaAsset).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Media uploaded.');
    expect(input.value).toBe('');
  });

  it('does nothing when no file is chosen', async () => {
    const { component } = create();
    await component.upload({ target: { files: [] } } as never as Event);
    expect(admin.uploadMediaAsset).not.toHaveBeenCalled();
  });

  it('reports an upload failure but still clears the input', async () => {
    admin.uploadMediaAsset.and.returnValue(throwError(() => ({})));
    const { component } = create();
    const input = {
      files: [new File(['x'], 'p.jpg')],
      value: 'p.jpg',
    } as never as HTMLInputElement;
    await component.upload({ target: input } as never as Event);
    expect(toast.error).toHaveBeenCalledWith('Upload failed.');
    expect(input.value).toBe('');
  });

  // ---------------------------------------------------------------------------
  // Detail modal
  // ---------------------------------------------------------------------------

  it('opens the detail modal seeding fields from i18n rows', () => {
    const { component, fixture } = create();
    component.openDetails(
      makeAsset({
        rights_license: 'CC-BY',
        rights_owner: 'Studio',
        i18n: [
          { lang: 'en', title: 'Title EN', alt_text: 'Alt EN' },
          { lang: 'ro', title: 'Title RO', alt_text: 'Alt RO' },
        ],
      }),
    );
    fixture.detectChanges();
    expect(component.editTitleEn).toBe('Title EN');
    expect(component.editTitleRo).toBe('Title RO');
    expect(component.editRightsLicense).toBe('CC-BY');
    expect(fixture.nativeElement.textContent as string).toContain('Rights license');
  });

  it('opens the detail modal with empty fields when i18n is missing', () => {
    const { component } = create();
    component.openDetails(makeAsset({ i18n: [] }));
    expect(component.editTitleEn).toBe('');
    expect(component.editAltRo).toBe('');
  });

  it('saves detail edits', async () => {
    admin.updateMediaAsset.and.returnValue(of(baseAsset));
    const { component } = create();
    component.openDetails(baseAsset);
    component.editTitleEn = 'New';
    await component.saveDetails();
    expect(admin.updateMediaAsset).toHaveBeenCalledWith(
      'asset-1',
      jasmine.objectContaining({ visibility: 'private', status: 'draft' }),
    );
    expect(component.detailAsset()).toBeNull();
  });

  it('does nothing when saving details without an active asset', async () => {
    const { component } = create();
    await component.saveDetails();
    expect(admin.updateMediaAsset).not.toHaveBeenCalled();
  });

  it('reports a detail save failure', async () => {
    admin.updateMediaAsset.and.returnValue(throwError(() => ({})));
    const { component } = create();
    component.openDetails(baseAsset);
    await component.saveDetails();
    expect(toast.error).toHaveBeenCalledWith('Failed to update asset metadata.');
  });

  it('closes the detail modal', () => {
    const { component } = create();
    component.openDetails(baseAsset);
    component.closeDetails();
    expect(component.detailAsset()).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Tags / variant / edit / usage
  // ---------------------------------------------------------------------------

  it('edits tags from a prompt', async () => {
    spyOn(window, 'prompt').and.returnValue('a, b , ,c');
    admin.updateMediaAsset.and.returnValue(of(baseAsset));
    const { component } = create();
    await component.editTags(baseAsset);
    expect(admin.updateMediaAsset).toHaveBeenCalledWith('asset-1', { tags: ['a', 'b', 'c'] });
  });

  it('cancels tag editing when the prompt is dismissed', async () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const { component } = create();
    await component.editTags(baseAsset);
    expect(admin.updateMediaAsset).not.toHaveBeenCalled();
  });

  it('reports a tag update failure', async () => {
    spyOn(window, 'prompt').and.returnValue('a');
    admin.updateMediaAsset.and.returnValue(throwError(() => ({})));
    const { component } = create();
    await component.editTags(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('Failed to update tags.');
  });

  it('requests a variant job', async () => {
    spyOn(window, 'prompt').and.returnValue('web-640');
    admin.requestMediaVariant.and.returnValue(of(makeJob({ id: 'job-v', job_type: 'variant' })));
    const { component } = create();
    await component.requestVariant(baseAsset);
    expect(admin.requestMediaVariant).toHaveBeenCalledWith('asset-1', 'web-640');
    expect(toast.success).toHaveBeenCalledWith('Variant job queued.');
  });

  it('cancels variant request when the prompt is empty', async () => {
    spyOn(window, 'prompt').and.returnValue('');
    const { component } = create();
    await component.requestVariant(baseAsset);
    expect(admin.requestMediaVariant).not.toHaveBeenCalled();
  });

  it('reports a variant request failure', async () => {
    spyOn(window, 'prompt').and.returnValue('web-640');
    admin.requestMediaVariant.and.returnValue(throwError(() => ({})));
    const { component } = create();
    await component.requestVariant(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('Failed to queue variant job.');
  });

  it('queues an image edit job', async () => {
    spyOn(window, 'prompt').and.returnValue('90');
    admin.editMediaAsset.and.returnValue(of(makeJob({ id: 'job-e', job_type: 'edit' })));
    const { component } = create();
    await component.editImage(baseAsset);
    expect(admin.editMediaAsset).toHaveBeenCalledWith('asset-1', { rotate_cw: 90 });
  });

  it('cancels an image edit when the prompt is dismissed', async () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const { component } = create();
    await component.editImage(baseAsset);
    expect(admin.editMediaAsset).not.toHaveBeenCalled();
  });

  it('reports an image edit failure', async () => {
    spyOn(window, 'prompt').and.returnValue('90');
    admin.editMediaAsset.and.returnValue(throwError(() => ({})));
    const { component } = create();
    await component.editImage(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('Failed to queue edit job.');
  });

  it('shows usage entries via an alert', async () => {
    const alertSpy = spyOn(window, 'alert');
    admin.getMediaAssetUsage.and.returnValue(
      of({
        asset_id: 'asset-1',
        public_url: '/media/asset-1',
        items: [
          {
            source_type: 'block',
            source_key: 'page:home',
            source_id: null,
            field_path: 'hero',
            lang: null,
            last_seen_at: '2026-02-16T00:00:00Z',
          },
        ],
      }),
    );
    const { component } = create();
    await component.openUsage(baseAsset);
    expect(alertSpy).toHaveBeenCalledWith('Used in:\npage:home');
  });

  it('shows a no-usage alert when there are no edges', async () => {
    const alertSpy = spyOn(window, 'alert');
    admin.getMediaAssetUsage.and.returnValue(
      of({ asset_id: 'asset-1', public_url: '/media/asset-1', items: [] }),
    );
    const { component } = create();
    await component.openUsage(baseAsset);
    expect(alertSpy).toHaveBeenCalledWith('No usage found.');
  });

  it('reports a usage load failure', async () => {
    admin.getMediaAssetUsage.and.returnValue(throwError(() => ({})));
    const { component } = create();
    await component.openUsage(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('Failed to load usage.');
  });

  // ---------------------------------------------------------------------------
  // Approve / reject / trash lifecycle
  // ---------------------------------------------------------------------------

  it('approves and reports approval failures', async () => {
    admin.approveMediaAsset.and.returnValue(of(baseAsset));
    const { component } = create();
    await component.approve(baseAsset);
    expect(toast.success).toHaveBeenCalledWith('Asset approved.');
    admin.approveMediaAsset.and.returnValue(throwError(() => ({})));
    await component.approve(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('Approval failed.');
  });

  it('rejects and reports rejection failures', async () => {
    admin.rejectMediaAsset.and.returnValue(of(baseAsset));
    const { component } = create();
    await component.reject(baseAsset);
    expect(toast.success).toHaveBeenCalledWith('Asset rejected.');
    admin.rejectMediaAsset.and.returnValue(throwError(() => ({})));
    await component.reject(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('Reject failed.');
  });

  it('soft deletes after confirmation and reports failures', async () => {
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(true);
    admin.softDeleteMediaAsset.and.returnValue(of(undefined));
    const { component } = create();
    await component.softDelete(baseAsset);
    expect(toast.success).toHaveBeenCalledWith('Asset moved to trash.');

    admin.softDeleteMediaAsset.and.returnValue(throwError(() => ({})));
    await component.softDelete(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('Trash action failed.');

    confirmSpy.and.returnValue(false);
    admin.softDeleteMediaAsset.calls.reset();
    await component.softDelete(baseAsset);
    expect(admin.softDeleteMediaAsset).not.toHaveBeenCalled();
  });

  it('restores and reports restore failures', async () => {
    admin.restoreMediaAsset.and.returnValue(of(baseAsset));
    const { component } = create();
    await component.restore(baseAsset);
    expect(toast.success).toHaveBeenCalledWith('Asset restored.');
    admin.restoreMediaAsset.and.returnValue(throwError(() => ({})));
    await component.restore(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('Restore failed.');
  });

  it('purges after confirmation and reports failures', async () => {
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(true);
    admin.purgeMediaAsset.and.returnValue(of(undefined));
    const { component } = create();
    await component.purge(baseAsset);
    expect(toast.success).toHaveBeenCalledWith('Asset purged.');

    admin.purgeMediaAsset.and.returnValue(throwError(() => ({})));
    await component.purge(baseAsset);
    expect(toast.error).toHaveBeenCalledWith('Purge failed.');

    confirmSpy.and.returnValue(false);
    admin.purgeMediaAsset.calls.reset();
    await component.purge(baseAsset);
    expect(admin.purgeMediaAsset).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Collections
  // ---------------------------------------------------------------------------

  it('reports a collection load failure', async () => {
    admin.listMediaCollections.and.returnValue(throwError(() => ({})));
    const { component } = create();
    await component.loadCollections();
    expect(toast.error).toHaveBeenCalledWith('Failed to load collections.');
  });

  it('creates a collection and resets the form', async () => {
    admin.createMediaCollection.and.returnValue(of(makeCollection()));
    const { component } = create();
    component.newCollectionName = ' New ';
    component.newCollectionSlug = ' New-Slug ';
    component.newCollectionVisibility = 'public';
    await component.createCollection();
    expect(admin.createMediaCollection).toHaveBeenCalledWith({
      name: 'New',
      slug: 'new-slug',
      visibility: 'public',
    });
    expect(component.newCollectionName).toBe('');
  });

  it('blocks collection creation without a name or slug', async () => {
    const { component } = create();
    component.newCollectionName = '';
    component.newCollectionSlug = '';
    await component.createCollection();
    expect(toast.error).toHaveBeenCalledWith('Collection name and slug are required.');
    expect(admin.createMediaCollection).not.toHaveBeenCalled();
  });

  it('reports a collection creation failure', async () => {
    admin.createMediaCollection.and.returnValue(throwError(() => ({})));
    const { component } = create();
    component.newCollectionName = 'X';
    component.newCollectionSlug = 'x';
    await component.createCollection();
    expect(toast.error).toHaveBeenCalledWith('Failed to create collection.');
  });

  it('edits a collection through prompts', async () => {
    spyOn(window, 'prompt').and.returnValues('Renamed', 'renamed', 'public');
    admin.updateMediaCollection.and.returnValue(of(makeCollection({ name: 'Renamed' })));
    const { component } = create();
    await component.editCollection(makeCollection());
    expect(admin.updateMediaCollection).toHaveBeenCalledWith('coll-1', {
      name: 'Renamed',
      slug: 'renamed',
      visibility: 'public',
    });
  });

  it('coerces non-public collection visibility to private', async () => {
    spyOn(window, 'prompt').and.returnValues('Renamed', 'renamed', 'weird');
    admin.updateMediaCollection.and.returnValue(of(makeCollection()));
    const { component } = create();
    await component.editCollection(makeCollection());
    expect(admin.updateMediaCollection).toHaveBeenCalledWith(
      'coll-1',
      jasmine.objectContaining({ visibility: 'private' }),
    );
  });

  it('cancels collection editing at the name prompt', async () => {
    spyOn(window, 'prompt').and.returnValue(null);
    const { component } = create();
    await component.editCollection(makeCollection());
    expect(admin.updateMediaCollection).not.toHaveBeenCalled();
  });

  it('cancels collection editing at the slug prompt', async () => {
    spyOn(window, 'prompt').and.returnValues('Renamed', null);
    const { component } = create();
    await component.editCollection(makeCollection());
    expect(admin.updateMediaCollection).not.toHaveBeenCalled();
  });

  it('cancels collection editing when visibility prompt is empty', async () => {
    spyOn(window, 'prompt').and.returnValues('Renamed', 'renamed', '');
    const { component } = create();
    await component.editCollection(makeCollection());
    expect(admin.updateMediaCollection).not.toHaveBeenCalled();
  });

  it('reports a collection edit failure', async () => {
    spyOn(window, 'prompt').and.returnValues('Renamed', 'renamed', 'public');
    admin.updateMediaCollection.and.returnValue(throwError(() => ({})));
    const { component } = create();
    await component.editCollection(makeCollection());
    expect(toast.error).toHaveBeenCalledWith('Failed to update collection.');
  });

  it('attaches the current selection to a collection', async () => {
    admin.replaceMediaCollectionItems.and.returnValue(of(undefined));
    const { component } = create();
    component.selectedIds.set(new Set(['asset-1', 'asset-2']));
    await component.attachSelectionToCollection(makeCollection());
    expect(admin.replaceMediaCollectionItems).toHaveBeenCalledWith('coll-1', [
      'asset-1',
      'asset-2',
    ]);
    expect(toast.success).toHaveBeenCalledWith('Collection items updated.');
  });

  it('blocks attaching with no selection', async () => {
    const { component } = create();
    component.selectedIds.set(new Set());
    await component.attachSelectionToCollection(makeCollection());
    expect(toast.error).toHaveBeenCalledWith('Select at least one asset first.');
    expect(admin.replaceMediaCollectionItems).not.toHaveBeenCalled();
  });

  it('reports an attach failure', async () => {
    admin.replaceMediaCollectionItems.and.returnValue(throwError(() => ({})));
    const { component } = create();
    component.selectedIds.set(new Set(['asset-1']));
    await component.attachSelectionToCollection(makeCollection());
    expect(toast.error).toHaveBeenCalledWith('Failed to update collection items.');
  });

  it('renders the selected count on the collections tab', async () => {
    admin.listMediaCollections.and.returnValue(of([makeCollection()]));
    const { component, fixture } = create();
    component.selectedIds.set(new Set(['asset-1']));
    component.switchTab('collections');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent as string).toContain('Add selected (1)');
  });

  // ---------------------------------------------------------------------------
  // pushJob ring buffer
  // ---------------------------------------------------------------------------

  it('prepends queued jobs and caps the in-memory list at 20', async () => {
    admin.listMediaJobs.and.returnValue(
      of({
        items: Array.from({ length: 20 }, (_, i) => makeJob({ id: `j-${i}` })),
        meta: { total_items: 20, total_pages: 1, page: 1, limit: 20 },
      }),
    );
    spyOn(window, 'prompt').and.returnValue('web-640');
    admin.requestMediaVariant.and.returnValue(of(makeJob({ id: 'fresh' })));
    const { component } = create();
    component.switchTab('queue');
    await component.requestVariant(baseAsset);
    expect(component.jobs().length).toBe(20);
    expect(component.jobs()[0].id).toBe('fresh');
  });

  // ---------------------------------------------------------------------------
  // Defensive fallback branches (null/empty payloads)
  // ---------------------------------------------------------------------------

  it('defaults assets and total pages when the list payload is empty', () => {
    admin.listMediaAssets.and.returnValue(
      of({
        items: null as never,
        meta: { total_items: 0, total_pages: 0, page: 1, limit: 24 },
      }),
    );
    const { component } = create();
    expect(component.assets()).toEqual([]);
    expect(component.metaTotalPages()).toBe(1);
  });

  it('defaults jobs and queue total pages when the job payload is empty', () => {
    admin.listMediaJobs.and.returnValue(
      of({ items: null as never, meta: { total_items: 0, total_pages: 0, page: 1, limit: 20 } }),
    );
    const { component } = create();
    component.switchTab('queue');
    expect(component.jobs()).toEqual([]);
    expect(component.jobsMetaTotalPages()).toBe(1);
  });

  it('defaults to an empty policy list when the payload omits items', () => {
    admin.listMediaRetryPolicies.and.returnValue(of({ items: undefined as never }));
    const { component } = create();
    component.switchTab('queue');
    expect(component.retryPolicies()).toEqual([]);
  });

  it('sorts multiple policies and tolerates a null schedule', () => {
    admin.listMediaRetryPolicies.and.returnValue(
      of({
        items: [
          {
            job_type: 'variant',
            max_attempts: 4,
            backoff_schedule_seconds: null as never,
            jitter_ratio: 0.1,
            enabled: true,
            updated_by_user_id: null,
            created_at: '2026-02-16T00:00:00Z',
            updated_at: '2026-02-16T00:00:00Z',
          },
          {
            job_type: 'ingest',
            max_attempts: 5,
            backoff_schedule_seconds: [30, 120],
            jitter_ratio: 0.15,
            enabled: true,
            updated_by_user_id: null,
            created_at: '2026-02-16T00:00:00Z',
            updated_at: '2026-02-16T00:00:00Z',
          },
        ],
      }),
    );
    const { component } = create();
    component.switchTab('queue');
    expect(component.retryPolicies().map((p) => p.job_type)).toEqual(['ingest', 'variant']);
    expect(component.retryPolicyDraft('variant').scheduleText).toBe('');
  });

  it('reset-all defaults to an empty list when items are omitted', async () => {
    admin.resetAllMediaRetryPolicies.and.returnValue(of({ items: undefined as never }));
    const { component } = create();
    component.switchTab('queue');
    await component.resetAllRetryPolicies();
    expect(component.retryPolicies()).toEqual([]);
  });

  it('reset-all sorts multiple policies and tolerates a null schedule', async () => {
    admin.resetAllMediaRetryPolicies.and.returnValue(
      of({
        items: [
          {
            job_type: 'variant',
            max_attempts: 4,
            backoff_schedule_seconds: null as never,
            jitter_ratio: 0.1,
            enabled: true,
            updated_by_user_id: null,
            created_at: '2026-02-16T00:00:00Z',
            updated_at: '2026-02-16T00:00:00Z',
          },
          {
            job_type: 'ingest',
            max_attempts: 5,
            backoff_schedule_seconds: [30],
            jitter_ratio: 0.15,
            enabled: true,
            updated_by_user_id: null,
            created_at: '2026-02-16T00:00:00Z',
            updated_at: '2026-02-16T00:00:00Z',
          },
        ],
      }),
    );
    const { component } = create();
    component.switchTab('queue');
    await component.resetAllRetryPolicies();
    expect(component.retryPolicies().map((p) => p.job_type)).toEqual(['ingest', 'variant']);
    expect(component.retryPolicyDraft('variant').scheduleText).toBe('');
  });

  it('formats a snapshot with a null schedule and enabled flag', () => {
    const { component } = create();
    expect(
      component.formatPolicySnapshot({
        max_attempts: 3,
        backoff_schedule_seconds: null as never,
        jitter_ratio: 0.5,
        enabled: true,
      }),
    ).toBe('3 tries · [] · jitter 0.50 · on');
  });

  it('computes diff rows from null before-snapshot fields', () => {
    const { component } = create();
    const chips = component.retryPolicyDiffChips(
      {
        max_attempts: 1,
        backoff_schedule_seconds: null as never,
        jitter_ratio: null as never,
        enabled: false,
      },
      {
        max_attempts: 2,
        backoff_schedule_seconds: [5],
        jitter_ratio: 0.1,
        enabled: true,
      },
    );
    expect(chips).toEqual(['Max attempts', 'Schedule (seconds)', 'Jitter ratio', 'Enabled']);
  });

  it('computes diff rows from null after-snapshot fields', () => {
    const { component } = create();
    const chips = component.retryPolicyDiffChips(
      {
        max_attempts: 2,
        backoff_schedule_seconds: [5],
        jitter_ratio: 0.1,
        enabled: true,
      },
      {
        max_attempts: 1,
        backoff_schedule_seconds: null as never,
        jitter_ratio: null as never,
        enabled: false,
      },
    );
    expect(chips).toEqual(['Max attempts', 'Schedule (seconds)', 'Jitter ratio', 'Enabled']);
  });

  it('reads the current snapshot tolerating null policy fields', async () => {
    admin.listMediaRetryPolicies.and.returnValue(
      of({
        items: [
          {
            job_type: 'ingest',
            max_attempts: 5,
            backoff_schedule_seconds: null as never,
            jitter_ratio: null as never,
            enabled: true,
            updated_by_user_id: null,
            created_at: '2026-02-16T00:00:00Z',
            updated_at: null as never,
          },
        ],
      }),
    );
    const { component } = create();
    component.switchTab('queue');
    await component.rollbackRetryPolicyPreset('ingest', 'factory_default');
    const preview = component.retryPolicyRollbackPreview();
    expect(preview?.currentPolicy.backoff_schedule_seconds).toEqual([]);
    expect(preview?.currentPolicy.jitter_ratio).toBe(0);
    expect(preview?.currentPolicy.version_ts).toBeNull();
  });

  it('falls back to an empty history list when an event rollback load fails', async () => {
    admin.listMediaRetryPolicyHistory.and.returnValue(throwError(() => ({})));
    const { component } = create();
    component.switchTab('queue');
    await component.rollbackRetryPolicyEvent('ingest', 'evt-1');
    expect(component.retryPolicyError('ingest')).toBe('History event is not available.');
  });

  it('merges only matching jobs on bulk retry with an empty response', async () => {
    admin.listMediaJobs.and.returnValue(
      of({
        items: [makeJob({ id: 'job-a' }), makeJob({ id: 'job-b' })],
        meta: { total_items: 2, total_pages: 1, page: 1, limit: 20 },
      }),
    );
    admin.retryMediaJobsBulk.and.returnValue(
      of({
        items: undefined as never,
        meta: { total_items: 0, total_pages: 1, page: 1, limit: 1 },
      }),
    );
    const { component } = create();
    component.switchTab('queue');
    component.selectedQueueJobIds.set(new Set(['job-a']));
    await component.bulkRetrySelectedJobs();
    expect(component.jobs().map((j) => j.id)).toEqual(['job-a', 'job-b']);
  });

  it('replaces a matching job and leaves others untouched on triage patch', async () => {
    admin.listMediaJobs.and.returnValue(
      of({
        items: [makeJob({ id: 'job-2' }), makeJob({ id: 'job-3' })],
        meta: { total_items: 2, total_pages: 1, page: 1, limit: 20 },
      }),
    );
    admin.retryMediaJob.and.returnValue(of(makeJob({ id: 'job-2', status: 'queued' })));
    const { component } = create();
    component.switchTab('queue');
    await component.retryJob(makeJob({ id: 'job-2' }));
    expect(component.jobs().map((j) => j.id)).toEqual(['job-2', 'job-3']);
  });

  it('defaults job events to an empty list when omitted', () => {
    admin.listMediaJobEvents.and.returnValue(of({ items: undefined as never }));
    const { component } = create();
    component.openJobEvents(makeJob({ id: 'job-2' }));
    expect(component.jobEvents()).toEqual([]);
  });

  it('opens details tolerating a missing i18n array', () => {
    const { component } = create();
    component.openDetails(makeAsset({ i18n: undefined as never }));
    expect(component.editTitleEn).toBe('');
  });

  it('edits tags tolerating a missing tags array', async () => {
    spyOn(window, 'prompt').and.returnValue('x');
    admin.updateMediaAsset.and.returnValue(of(baseAsset));
    const { component } = create();
    await component.editTags(makeAsset({ tags: undefined as never }));
    expect(admin.updateMediaAsset).toHaveBeenCalledWith('asset-1', { tags: ['x'] });
  });

  it('treats an empty rotate prompt as zero degrees', async () => {
    spyOn(window, 'prompt').and.returnValue('');
    admin.editMediaAsset.and.returnValue(of(makeJob({ id: 'job-e', job_type: 'edit' })));
    const { component } = create();
    await component.editImage(baseAsset);
    expect(admin.editMediaAsset).toHaveBeenCalledWith('asset-1', { rotate_cw: 0 });
  });

  it('shows a no-usage alert when usage items are omitted', async () => {
    const alertSpy = spyOn(window, 'alert');
    admin.getMediaAssetUsage.and.returnValue(
      of({ asset_id: 'asset-1', public_url: '/m', items: undefined as never }),
    );
    const { component } = create();
    await component.openUsage(baseAsset);
    expect(alertSpy).toHaveBeenCalledWith('No usage found.');
  });

  it('defaults collections to an empty list when the payload is null', async () => {
    admin.listMediaCollections.and.returnValue(of(null as unknown as MediaCollection[]));
    const { component } = create();
    await component.loadCollections();
    expect(component.collections()).toEqual([]);
  });

  it('reports an empty schedule as invalid in the preview', () => {
    const { component } = create();
    component.switchTab('queue');
    component.retryPolicyDraft('ingest').scheduleText = '';
    expect(component.retryDelayPreview('ingest')).toBe('invalid schedule');
  });

  it('saves a policy across a multi-policy list and tolerates a null saved schedule', async () => {
    admin.listMediaRetryPolicies.and.returnValue(
      of({
        items: [
          {
            job_type: 'ingest',
            max_attempts: 5,
            backoff_schedule_seconds: [30],
            jitter_ratio: 0.15,
            enabled: true,
            updated_by_user_id: null,
            created_at: '2026-02-16T00:00:00Z',
            updated_at: '2026-02-16T00:00:00Z',
          },
          {
            job_type: 'variant',
            max_attempts: 4,
            backoff_schedule_seconds: [10],
            jitter_ratio: 0.1,
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
        backoff_schedule_seconds: null as never,
        jitter_ratio: 0.2,
        enabled: true,
        updated_by_user_id: 'owner-1',
        created_at: '2026-02-16T00:00:00Z',
        updated_at: '2026-02-16T01:00:00Z',
      }),
    );
    const { component } = create();
    component.switchTab('queue');
    await component.saveRetryPolicy('ingest');
    expect(component.retryPolicyDraft('ingest').scheduleText).toBe('');
    expect(component.retryPolicyDraft('variant').max_attempts).toBe(4);
  });

  it('defaults presets to an empty list when the payload omits items', async () => {
    admin.getMediaRetryPolicyPresets.and.returnValue(
      of({ job_type: 'ingest', items: undefined as never }),
    );
    const { component } = create();
    const internal = component as never as {
      loadRetryPolicyPresets(jobType: string): Promise<void>;
    };
    await internal.loadRetryPolicyPresets('ingest');
    expect(component.retryPolicyPresetSummary('ingest')).toBe('loading…');
  });

  it('loads the next history page when no prior page metadata exists', async () => {
    admin.listMediaRetryPolicyHistory.and.returnValue(
      of({
        items: [historyEvent],
        meta: { total_items: 30, total_pages: 3, page: 2, limit: 10 },
      }),
    );
    const { component } = create();
    component.switchTab('queue');
    await component.loadMoreRetryPolicyHistory('ai_tag');
    expect(admin.listMediaRetryPolicyHistory).toHaveBeenCalledWith({
      job_type: 'ai_tag',
      page: 2,
      limit: 10,
    });
  });

  it('defaults history items and meta when the payload omits them', async () => {
    admin.listMediaRetryPolicyHistory.and.returnValue(
      of({ items: undefined as never, meta: { page: 0, total_pages: 0 } as never }),
    );
    const { component } = create();
    const internal = component as never as {
      loadRetryPolicyHistory(jobType: string, append: boolean): Promise<void>;
    };
    await internal.loadRetryPolicyHistory('ingest', false);
    expect(component.retryPolicyHistoryItems('ingest')).toEqual([]);
    expect(component.retryPolicyHistoryHasMore('ingest')).toBeFalse();
  });
});
