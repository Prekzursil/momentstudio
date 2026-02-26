import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import {
  AdminService,
  MediaAsset,
  MediaAssetListResponse,
  MediaJob,
  MediaJobListResponse,
  MediaRetryPolicy,
  MediaRetryPolicyEvent,
  MediaRetryPolicyHistoryResponse,
  MediaRetryPolicyListResponse,
  MediaRetryPolicyPresetsResponse,
  MediaTelemetryResponse
} from '../../../core/admin.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../core/toast.service';
import { DamAssetLibraryComponent } from './dam-asset-library.component';

const ADMIN_SERVICE_METHODS = [
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
  'replaceMediaCollectionItems'
] as const;

const BASE_ASSET: MediaAsset = {
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

const DEFAULT_MEDIA_ASSET_LIST: MediaAssetListResponse = {
  items: [BASE_ASSET],
  meta: { total_items: 1, total_pages: 1, page: 1, limit: 24 }
};

const DEFAULT_MEDIA_JOB_LIST: MediaJobListResponse = {
  items: [],
  meta: { total_items: 0, total_pages: 1, page: 1, limit: 20 }
};

const DEFAULT_MEDIA_TELEMETRY: MediaTelemetryResponse = {
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
};

const DEFAULT_USAGE_RECONCILE_JOB: MediaJob = {
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
};

const DEFAULT_RETRY_MEDIA_JOB: MediaJob = {
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
};

const DEFAULT_RETRY_MEDIA_JOBS_BULK: MediaJobListResponse = {
  items: [],
  meta: { total_items: 0, total_pages: 1, page: 1, limit: 1 }
};

const DEFAULT_UPDATE_MEDIA_JOB_TRIAGE: MediaJob = {
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
};

const DEFAULT_RETRY_POLICIES: MediaRetryPolicyListResponse = {
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
};

const DEFAULT_UPDATE_RETRY_POLICY: MediaRetryPolicy = {
  job_type: 'ingest',
  max_attempts: 6,
  backoff_schedule_seconds: [10, 30, 120],
  jitter_ratio: 0.2,
  enabled: true,
  updated_by_user_id: 'owner-1',
  created_at: '2026-02-16T00:00:00Z',
  updated_at: '2026-02-16T01:00:00Z'
};

const DEFAULT_RESET_RETRY_POLICY: MediaRetryPolicy = {
  job_type: 'ingest',
  max_attempts: 5,
  backoff_schedule_seconds: [30, 120, 600, 1800],
  jitter_ratio: 0.15,
  enabled: true,
  updated_by_user_id: null,
  created_at: '2026-02-16T00:00:00Z',
  updated_at: '2026-02-16T02:00:00Z'
};

const DEFAULT_RESET_ALL_RETRY_POLICIES: MediaRetryPolicyListResponse = {
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
};

const DEFAULT_RETRY_POLICY_HISTORY: MediaRetryPolicyHistoryResponse = {
  items: [
    {
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
        version_ts: 'seed'
      },
      after_policy: {
        max_attempts: 6,
        backoff_schedule_seconds: [10, 30, 120],
        jitter_ratio: 0.2,
        enabled: true,
        version_ts: 'seed'
      },
      note: null,
      created_at: '2026-02-16T03:00:00Z'
    }
  ],
  meta: { total_items: 1, total_pages: 1, page: 1, limit: 10 }
};

const DEFAULT_RETRY_POLICY_PRESETS: MediaRetryPolicyPresetsResponse = {
  job_type: 'ingest',
  items: [
    {
      preset_key: 'factory_default',
      label: 'Factory default',
      policy: {
        max_attempts: 5,
        backoff_schedule_seconds: [30, 120, 600, 1800],
        jitter_ratio: 0.15,
        enabled: true,
        version_ts: 'seed'
      },
      source_event_id: null,
      fallback_used: false,
      updated_at: null
    }
  ]
};

const DEFAULT_ROLLBACK_RETRY_POLICY: MediaRetryPolicy = {
  job_type: 'ingest',
  max_attempts: 5,
  backoff_schedule_seconds: [30, 120, 600, 1800],
  jitter_ratio: 0.15,
  enabled: true,
  updated_by_user_id: 'owner-1',
  created_at: '2026-02-16T00:00:00Z',
  updated_at: '2026-02-16T04:00:00Z'
};

const DEFAULT_KNOWN_GOOD_EVENT: MediaRetryPolicyEvent = {
  id: 'evt-2',
  job_type: 'ingest',
  action: 'mark_known_good',
  actor_user_id: 'owner-1',
  preset_key: 'known_good',
  before_policy: {
    max_attempts: 5,
    backoff_schedule_seconds: [30, 120, 600, 1800],
    jitter_ratio: 0.15,
    enabled: true,
    version_ts: 'seed'
  },
  after_policy: {
    max_attempts: 5,
    backoff_schedule_seconds: [30, 120, 600, 1800],
    jitter_ratio: 0.15,
    enabled: true,
    version_ts: 'seed'
  },
  note: null,
  created_at: '2026-02-16T05:00:00Z'
};

let admin: jasmine.SpyObj<AdminService>;
let auth: jasmine.SpyObj<AuthService>;
let toast: jasmine.SpyObj<ToastService>;

function createAdminSpy() {
  return jasmine.createSpyObj<AdminService>('AdminService', [...ADMIN_SERVICE_METHODS]);
}

function configureAdminDefaults() {
  admin.listMediaAssets.and.returnValue(of(DEFAULT_MEDIA_ASSET_LIST));
  admin.listMediaCollections.and.returnValue(of([]));
  admin.listMediaJobs.and.returnValue(of(DEFAULT_MEDIA_JOB_LIST));
  admin.getMediaTelemetry.and.returnValue(of(DEFAULT_MEDIA_TELEMETRY));
  admin.requestMediaUsageReconcile.and.returnValue(of(DEFAULT_USAGE_RECONCILE_JOB));
  admin.retryMediaJob.and.returnValue(of(DEFAULT_RETRY_MEDIA_JOB));
  admin.retryMediaJobsBulk.and.returnValue(of(DEFAULT_RETRY_MEDIA_JOBS_BULK));
  admin.updateMediaJobTriage.and.returnValue(of(DEFAULT_UPDATE_MEDIA_JOB_TRIAGE));
  admin.listMediaJobEvents.and.returnValue(of({ items: [] }));
  admin.listMediaRetryPolicies.and.returnValue(of(DEFAULT_RETRY_POLICIES));
  admin.updateMediaRetryPolicy.and.returnValue(of(DEFAULT_UPDATE_RETRY_POLICY));
  admin.resetMediaRetryPolicy.and.returnValue(of(DEFAULT_RESET_RETRY_POLICY));
  admin.resetAllMediaRetryPolicies.and.returnValue(of(DEFAULT_RESET_ALL_RETRY_POLICIES));
  admin.listMediaRetryPolicyHistory.and.returnValue(of(DEFAULT_RETRY_POLICY_HISTORY));
  admin.getMediaRetryPolicyPresets.and.returnValue(of(DEFAULT_RETRY_POLICY_PRESETS));
  admin.rollbackMediaRetryPolicy.and.returnValue(of(DEFAULT_ROLLBACK_RETRY_POLICY));
  admin.markMediaRetryPolicyKnownGood.and.returnValue(of(DEFAULT_KNOWN_GOOD_EVENT));
}

function configureTestingModule() {
  TestBed.configureTestingModule({
    imports: [DamAssetLibraryComponent],
    providers: [
      { provide: AdminService, useValue: admin },
      { provide: AuthService, useValue: auth },
      { provide: ToastService, useValue: toast }
    ]
  });
}

function createInitializedComponent() {
  const fixture = TestBed.createComponent(DamAssetLibraryComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance };
}

function createQueueTabComponent() {
  const { component } = createInitializedComponent();
  component.switchTab('queue');
  return component;
}

async function createQueueHistoryComponent() {
  const component = createQueueTabComponent();
  component.toggleRetryPolicyHistory('ingest');
  await Promise.resolve();
  return component;
}

function assertLoadsAssetsOnInit() {
  const { component } = createInitializedComponent();

  expect(admin.listMediaAssets).toHaveBeenCalledWith(
    jasmine.objectContaining({
      page: 1,
      limit: 24,
      sort: 'newest'
    })
  );
  expect(component.assets().length).toBe(1);
}

function assertReviewTabAppliesDraftFilter() {
  const { component } = createInitializedComponent();
  admin.listMediaAssets.calls.reset();

  component.switchTab('review');

  expect(component.tab()).toBe('review');
  expect(component.statusFilter).toBe('draft');
  expect(admin.listMediaAssets).toHaveBeenCalledWith(jasmine.objectContaining({ status: 'draft' }));
}

function assertPreviewUrlUsedForImage() {
  const { fixture } = createInitializedComponent();

  const image: HTMLImageElement | null = fixture.nativeElement.querySelector('img');
  expect(image).toBeTruthy();
  expect(image?.getAttribute('src')).toContain('/api/v1/content/admin/media/assets/asset-1/preview');
}

function assertQueueTabLoadsPersistentJobs() {
  const { component } = createInitializedComponent();
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
  expect(component.tab()).toBe('queue');
}

function assertQueueDeadLetterModeFiltersList() {
  const component = createQueueTabComponent();
  admin.listMediaJobs.calls.reset();

  component.setQueueMode('dead_letter');

  expect(admin.listMediaJobs).toHaveBeenCalledWith(
    jasmine.objectContaining({
      dead_letter_only: true
    })
  );
}

async function assertRetryPolicyEditsSave() {
  const component = createQueueTabComponent();

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
}

async function assertRetryPolicyReadOnlyForContentRole() {
  auth.role.and.returnValue('content');
  const component = createQueueTabComponent();

  expect(component.canEditRetryPolicies()).toBeFalse();
  await component.saveRetryPolicy('ingest');
  expect(admin.updateMediaRetryPolicy).not.toHaveBeenCalled();
}

async function assertRetryPolicyHistoryAndPresetsLoad() {
  const component = createQueueTabComponent();
  admin.listMediaRetryPolicyHistory.calls.reset();
  admin.getMediaRetryPolicyPresets.calls.reset();

  component.toggleRetryPolicyHistory('ingest');
  await Promise.resolve();

  expect(admin.listMediaRetryPolicyHistory).toHaveBeenCalledWith({
    job_type: 'ingest',
    page: 1,
    limit: 10
  });
  expect(admin.getMediaRetryPolicyPresets).toHaveBeenCalledWith('ingest');
  expect(component.isRetryPolicyHistoryOpen('ingest')).toBeTrue();
}

async function assertPresetRollbackPreviewAndApply() {
  const component = await createQueueHistoryComponent();

  await component.rollbackRetryPolicyPreset('ingest', 'factory_default');

  expect(admin.rollbackMediaRetryPolicy).not.toHaveBeenCalled();
  expect(component.retryPolicyRollbackPreview()?.request.preset_key).toBe('factory_default');

  await component.applyRetryPolicyRollbackPreview();

  expect(admin.rollbackMediaRetryPolicy).toHaveBeenCalledWith('ingest', {
    preset_key: 'factory_default'
  });
  expect(toast.success).toHaveBeenCalled();
}

async function assertEventRollbackPreviewAndApply() {
  const component = await createQueueHistoryComponent();

  await component.rollbackRetryPolicyEvent('ingest', 'evt-1');
  expect(admin.rollbackMediaRetryPolicy).not.toHaveBeenCalled();
  expect(component.retryPolicyRollbackPreview()?.request.event_id).toBe('evt-1');

  await component.applyRetryPolicyRollbackPreview();
  expect(admin.rollbackMediaRetryPolicy).toHaveBeenCalledWith('ingest', { event_id: 'evt-1' });
}

async function assertMarkKnownGoodCallsApi() {
  const component = createQueueTabComponent();

  await component.markRetryPolicyKnownGood('ingest');

  expect(admin.markMediaRetryPolicyKnownGood).toHaveBeenCalledWith('ingest');
  expect(toast.success).toHaveBeenCalled();
}

async function assertInvalidScheduleRejected() {
  const component = createQueueTabComponent();
  admin.updateMediaRetryPolicy.calls.reset();
  toast.error.calls.reset();

  component.retryPolicyDraft('ingest').scheduleText = 'abc,0';
  await component.saveRetryPolicy('ingest');

  expect(admin.updateMediaRetryPolicy).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
}

describe('DamAssetLibraryComponent', () => {
  beforeEach(() => {
    admin = createAdminSpy();
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['role']);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    auth.role.and.returnValue('admin');

    configureAdminDefaults();
    configureTestingModule();
  });

  it('loads assets on init with default list filters', () => assertLoadsAssetsOnInit());
  it('switches to review tab and applies draft status filter', () => assertReviewTabAppliesDraftFilter());
  it('uses preview_url for image rendering when available', () => assertPreviewUrlUsedForImage());
  it('loads persistent job list when switching to queue tab', () => assertQueueTabLoadsPersistentJobs());
  it('switches queue mode to dead-letter and requests dead-letter-only list', () =>
    assertQueueDeadLetterModeFiltersList()
  );
  it('saves retry policy edits from the jobs tab', async () => assertRetryPolicyEditsSave());
  it('keeps retry policy editor read-only for non owner/admin roles', async () =>
    assertRetryPolicyReadOnlyForContentRole()
  );
  it('loads retry policy history + presets when toggling history panel', async () =>
    assertRetryPolicyHistoryAndPresetsLoad()
  );
  it('opens rollback preview for preset and applies on explicit confirmation', async () =>
    assertPresetRollbackPreviewAndApply()
  );
  it('opens rollback preview for history event and applies selected revision', async () =>
    assertEventRollbackPreviewAndApply()
  );
  it('marks retry policy as known good for owner/admin role', async () => assertMarkKnownGoodCallsApi());
  it('rejects invalid retry schedule input before calling API', async () => assertInvalidScheduleRejected());
});
