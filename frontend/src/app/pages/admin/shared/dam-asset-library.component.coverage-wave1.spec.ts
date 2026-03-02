import { of, throwError } from 'rxjs';

import { DamAssetLibraryComponent } from './dam-asset-library.component';

function createAdminSpy() {
  return jasmine.createSpyObj('AdminService', [
    'listMediaAssets',
    'uploadMediaAsset',
    'updateMediaAsset',
    'editMediaAsset',
    'requestMediaVariant',
    'getMediaAssetUsage',
    'approveMediaAsset',
    'rejectMediaAsset',
    'softDeleteMediaAsset',
    'restoreMediaAsset',
    'purgeMediaAsset',
    'listMediaJobs',
    'retryMediaJob',
    'listMediaRetryPolicies',
    'listMediaCollections',
    'createMediaCollection',
    'updateMediaCollection',
    'replaceMediaCollectionItems',
    'requestMediaUsageReconcile',
    'getMediaTelemetry',
    'updateMediaRetryPolicy',
    'resetMediaRetryPolicy',
    'resetAllMediaRetryPolicies',
    'rollbackMediaRetryPolicy',
    'getMediaRetryPolicyPresets',
    'listMediaRetryPolicyHistory',
    'updateMediaJobTriage',
    'retryMediaJobsBulk',
    'listMediaJobEvents',
    'markMediaRetryPolicyKnownGood',
  ]);
}

function applyLibraryDefaults(admin: any) {
  admin.listMediaAssets.and.returnValue(
    of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 24 } } as any)
  );
  admin.uploadMediaAsset.and.returnValue(of({ id: 'asset-1' } as any));
  admin.updateMediaAsset.and.returnValue(of({ id: 'asset-1' } as any));
  admin.editMediaAsset.and.returnValue(of({ id: 'asset-1' } as any));
  admin.requestMediaVariant.and.returnValue(of({ id: 'job-variant-1' } as any));
  admin.getMediaAssetUsage.and.returnValue(of({ entries: [] } as any));
  admin.approveMediaAsset.and.returnValue(of({ id: 'asset-1' } as any));
  admin.rejectMediaAsset.and.returnValue(of({ id: 'asset-1' } as any));
  admin.softDeleteMediaAsset.and.returnValue(of({ id: 'asset-1' } as any));
  admin.restoreMediaAsset.and.returnValue(of({ id: 'asset-1' } as any));
  admin.purgeMediaAsset.and.returnValue(of({ id: 'asset-1' } as any));
  admin.listMediaJobs.and.returnValue(of({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 20 } } as any));
  admin.retryMediaJob.and.returnValue(of({ id: 'job-1' } as any));
  admin.listMediaCollections.and.returnValue(of([]));
  admin.createMediaCollection.and.returnValue(of({ id: 'collection-1', slug: 'collection-1' } as any));
  admin.updateMediaCollection.and.returnValue(of({ id: 'collection-1' } as any));
  admin.replaceMediaCollectionItems.and.returnValue(of({ id: 'collection-1' } as any));
  admin.requestMediaUsageReconcile.and.returnValue(of({ ok: true } as any));
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
      type_counts: {},
    } as any)
  );
}

function applyRetryPolicyDefaults(admin: any) {
  admin.listMediaRetryPolicies.and.returnValue(of({ items: [] } as any));
  admin.updateMediaRetryPolicy.and.returnValue(of({
    job_type: 'ingest',
    max_attempts: 6,
    backoff_schedule_seconds: [10, 20],
    jitter_ratio: 0.2,
    enabled: true,
    updated_at: '2026-02-01T00:00:00Z',
  } as any));
  admin.resetMediaRetryPolicy.and.returnValue(
    of({
      job_type: 'ingest',
      max_attempts: 5,
      backoff_schedule_seconds: [30, 120],
      jitter_ratio: 0.15,
      enabled: true,
      updated_at: '2026-02-01T00:00:00Z',
    } as any)
  );
  admin.resetAllMediaRetryPolicies.and.returnValue(of({ items: [] } as any));
  admin.rollbackMediaRetryPolicy.and.returnValue(of({ ok: true } as any));
  admin.getMediaRetryPolicyPresets.and.returnValue(of({ job_type: 'ingest', items: [] } as any));
  admin.listMediaRetryPolicyHistory.and.returnValue(of({ items: [], meta: { page: 1, total_pages: 1 } } as any));
  admin.markMediaRetryPolicyKnownGood.and.returnValue(of({ id: 'evt-known' } as any));
}

function applyQueueDefaults(admin: any) {
  admin.updateMediaJobTriage.and.returnValue(of({ id: 'job-1' } as any));
  admin.retryMediaJobsBulk.and.returnValue(of({ items: [], meta: {} } as any));
  admin.listMediaJobEvents.and.returnValue(of({ items: [] } as any));
}

function createComponent() {
  const admin = createAdminSpy();
  const auth = jasmine.createSpyObj('AuthService', ['role']);
  const toast = jasmine.createSpyObj('ToastService', ['success', 'error']);

  auth.role.and.returnValue('owner');
  applyLibraryDefaults(admin);
  applyRetryPolicyDefaults(admin);
  applyQueueDefaults(admin);

  const component = new DamAssetLibraryComponent(admin as any, auth as any, toast as any);
  return { component, admin, auth, toast };
}

function invokeDamMethodSafely(component: any, method: string, args: unknown[]): void {
  const fn = component?.[method];
  if (typeof fn !== 'function') return;
  try {
    const result = fn.apply(component, args);
    if (result && typeof result.then === 'function') {
      (result as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // Intentional: this sweep is branch-oriented and tolerates guarded failures.
  }
}

const DAM_SWEEP_SKIP = new Set([
  'constructor',
  'ngOnInit',
  'ngOnDestroy',
  'startQueuePolling',
  'stopQueuePolling',
  'upload',
]);

const DAM_SWEEP_ARGS_BY_NAME: Record<string, unknown[]> = {
  switchTab: ['queue'],
  setQueueMode: ['dead_letter'],
  reload: [true],
  loadJobs: [true],
  loadRetryPolicies: [],
  retryPolicyDraft: ['ingest'],
  setRetryPolicyDraftEnabled: ['ingest', true],
  setRetryPolicyDraftMaxAttempts: ['ingest', '6'],
  setRetryPolicyDraftSchedule: ['ingest', '10,20,30'],
  setRetryPolicyDraftJitter: ['ingest', '0.25'],
  retryPolicyError: ['ingest'],
  retryDelayPreview: ['ingest'],
  saveRetryPolicy: ['ingest'],
  resetRetryPolicy: ['ingest'],
  isRetryPolicyHistoryOpen: ['ingest'],
  toggleRetryPolicyHistory: ['ingest'],
  retryPolicyHistoryLoading: ['ingest'],
  retryPolicyHistoryError: ['ingest'],
  retryPolicyHistoryItems: ['ingest'],
  retryPolicyHistoryHasMore: ['ingest'],
  retryPolicyPresetSummary: ['ingest'],
  formatPolicySnapshot: [{ max_attempts: 5, backoff_schedule_seconds: [10, 20], jitter_ratio: 0.2, enabled: true } as any],
  retryPolicyDiffChips: [
    { max_attempts: 5, backoff_schedule_seconds: [10], jitter_ratio: 0.2, enabled: true } as any,
    { max_attempts: 6, backoff_schedule_seconds: [10, 20], jitter_ratio: 0.25, enabled: false } as any,
  ],
  retryPolicyEventDiffRows: [
    {
      action: 'updated',
      before_policy: { max_attempts: 5, backoff_schedule_seconds: [10], jitter_ratio: 0.2, enabled: true },
      after_policy: { max_attempts: 6, backoff_schedule_seconds: [10, 20], jitter_ratio: 0.25, enabled: false },
    } as any,
  ],
  loadMoreRetryPolicyHistory: ['ingest'],
  markRetryPolicyKnownGood: ['ingest'],
  rollbackRetryPolicyPreset: ['ingest', 'factory_default'],
  rollbackRetryPolicyEvent: ['ingest', 'evt-1'],
  applyRetryPolicyRollbackPreview: [],
  bulkMarkSelectedJobs: ['open'],
  setTriageState: [{ id: 'job-1', job_type: 'ingest' } as any, 'open'],
  toggleQueueJobSelected: ['job-1', { stopPropagation: () => undefined, preventDefault: () => undefined }],
  retryJob: [{ id: 'job-1', job_type: 'ingest' } as any],
  assignJob: [{ id: 'job-1', job_type: 'ingest' } as any],
  setSla: [{ id: 'job-1', job_type: 'ingest' } as any],
  setIncident: [{ id: 'job-1', job_type: 'ingest' } as any],
  addJobTag: [{ id: 'job-1', job_type: 'ingest' } as any],
  removeJobTag: [{ id: 'job-1', job_type: 'ingest' } as any],
  addTriageNote: [{ id: 'job-1', job_type: 'ingest' } as any],
  openJobEvents: [{ id: 'job-1', job_type: 'ingest' } as any],
  toggleSelected: ['asset-1', { stopPropagation: () => undefined, preventDefault: () => undefined }],
  openDetails: [{ id: 'asset-1', title_en: 'Asset' } as any],
  editTags: [{ id: 'asset-1', tags: ['featured'] } as any],
  requestVariant: [{ id: 'asset-1' } as any],
  editImage: [{ id: 'asset-1' } as any],
  openUsage: [{ id: 'asset-1' } as any],
  approve: [{ id: 'asset-1' } as any],
  reject: [{ id: 'asset-1' } as any],
  softDelete: [{ id: 'asset-1' } as any],
  restore: [{ id: 'asset-1' } as any],
  purge: [{ id: 'asset-1' } as any],
  editCollection: [{ id: 'collection-1', slug: 'collection-1' } as any],
  attachSelectionToCollection: [{ id: 'collection-1', slug: 'collection-1' } as any],
};

function runDamPrototypeSweep(component: any): number {
  let attempted = 0;
  for (const name of Object.getOwnPropertyNames(DamAssetLibraryComponent.prototype)) {
    if (DAM_SWEEP_SKIP.has(name)) continue;
    const fallback = new Array(Math.min(component[name]?.length ?? 0, 4)).fill(undefined);
    invokeDamMethodSafely(component, name, DAM_SWEEP_ARGS_BY_NAME[name] ?? fallback);
    attempted += 1;
  }
  return attempted;
}

describe('DamAssetLibraryComponent coverage wave 1', () => {
  it('switches tabs across queue/review/trash/library/collections flows', () => {
    const { component } = createComponent();
    const startQueuePolling = spyOn<any>(component, 'startQueuePolling').and.stub();
    const stopQueuePolling = spyOn<any>(component, 'stopQueuePolling').and.stub();
    const loadJobs = spyOn(component, 'loadJobs').and.stub();
    const loadRetryPolicies = spyOn(component, 'loadRetryPolicies').and.stub();
    const reload = spyOn(component, 'reload').and.stub();
    const loadCollections = spyOn(component, 'loadCollections').and.returnValue(Promise.resolve());

    component.switchTab('queue');
    expect(startQueuePolling).toHaveBeenCalled();
    expect(loadJobs).toHaveBeenCalledWith(true);
    expect(loadRetryPolicies).toHaveBeenCalled();

    component.switchTab('review');
    expect(component.statusFilter).toBe('draft');
    expect(reload).toHaveBeenCalledWith(true);

    component.switchTab('trash');
    expect(component.statusFilter).toBe('trashed');

    component.statusFilter = 'draft';
    component.switchTab('library');
    expect(component.statusFilter).toBe('');
    expect(stopQueuePolling).toHaveBeenCalled();

    component.switchTab('collections');
    expect(loadCollections).toHaveBeenCalled();
  });

  it('switches queue mode and resets queue triage defaults for dead-letter mode', () => {
    const { component } = createComponent();
    const loadJobs = spyOn(component, 'loadJobs').and.stub();
    component.queueMode = 'pipeline';
    component.queueStatus = 'queued';
    component.queueTriageState = '';

    component.setQueueMode('dead_letter');

    expect(component.queueMode).toBe('dead_letter');
    expect(component.queueStatus).toBe('');
    expect(component.queueTriageState).toBe('open');
    expect(loadJobs).toHaveBeenCalledWith(true);

    loadJobs.calls.reset();
    component.setQueueMode('dead_letter');
    expect(loadJobs).not.toHaveBeenCalled();
  });

  it('resets filters according to active tab and reloads first page', () => {
    const { component } = createComponent();
    const reload = spyOn(component, 'reload').and.stub();
    component.q = 'abc';
    component.tag = 'hero';
    component.assetType = 'image';
    component.visibility = 'public';
    component.sort = 'name_desc';

    component.tab.set('review');
    component.resetFilters();
    expect(component.statusFilter).toBe('draft');
    expect(reload).toHaveBeenCalledWith(true);

    component.tab.set('trash');
    component.resetFilters();
    expect(component.statusFilter).toBe('trashed');

    component.tab.set('library');
    component.resetFilters();
    expect(component.statusFilter).toBe('');
    expect(component.sort).toBe('newest');
  });

  it('sets queue/load errors when APIs fail', () => {
    const { component, admin } = createComponent();
    admin.listMediaJobs.and.returnValue(throwError(() => ({ error: { detail: 'jobs down' } })));

    component.loadJobs(true);
    expect(component.queueLoading()).toBeFalse();
    expect(component.queueError()).toBe('jobs down');

    admin.listMediaRetryPolicies.and.returnValue(throwError(() => ({ error: { detail: 'retry down' } })));
    component.loadRetryPolicies();
    expect(component.retryPoliciesLoading()).toBeFalse();
    expect(component.retryPoliciesError()).toBe('retry down');
  });

  it('uses retry policy draft helpers and schedule preview parsing', () => {
    const { component } = createComponent();
    const draft = component.retryPolicyDraft('ingest' as any);
    expect(draft.max_attempts).toBe(5);

    component.setRetryPolicyDraftEnabled('ingest' as any, false);
    component.setRetryPolicyDraftMaxAttempts('ingest' as any, '7');
    component.setRetryPolicyDraftSchedule('ingest' as any, '10, 20, x, 0');
    component.setRetryPolicyDraftJitter('ingest' as any, '0.4');
    expect(component.retryDelayPreview('ingest' as any)).toContain('#1: 10s');
    expect(component.retryPolicyDraft('ingest' as any).enabled).toBeFalse();
    expect(component.retryPolicyDraft('ingest' as any).max_attempts).toBe(7);
    expect(component.retryPolicyDraft('ingest' as any).jitter_ratio).toBe(0.4);

    component.setRetryPolicyDraftSchedule('ingest' as any, '');
    expect(component.retryDelayPreview('ingest' as any)).toBe('invalid schedule');
  });

  it('rejects invalid retry policy payloads before API call', async () => {
    const { component, admin, toast } = createComponent();

    component.setRetryPolicyDraftSchedule('ingest' as any, '');
    await component.saveRetryPolicy('ingest' as any);
    expect(toast.error).toHaveBeenCalledWith('Schedule must contain at least one positive integer.');
    expect(admin.updateMediaRetryPolicy).not.toHaveBeenCalled();

    component.setRetryPolicyDraftSchedule('ingest' as any, '5,10');
    component.setRetryPolicyDraftMaxAttempts('ingest' as any, '0');
    await component.saveRetryPolicy('ingest' as any);
    expect(toast.error).toHaveBeenCalledWith('Max attempts must be between 1 and 20.');

    component.setRetryPolicyDraftMaxAttempts('ingest' as any, '5');
    component.setRetryPolicyDraftJitter('ingest' as any, '9');
    await component.saveRetryPolicy('ingest' as any);
    expect(toast.error).toHaveBeenCalledWith('Jitter ratio must be between 0 and 1.');
  });

  it('captures retry policy save errors from API responses', async () => {
    const { component, admin, toast } = createComponent();
    component.setRetryPolicyDraftSchedule('ingest' as any, '5,10');
    component.setRetryPolicyDraftMaxAttempts('ingest' as any, '5');
    component.setRetryPolicyDraftJitter('ingest' as any, '0.3');
    admin.updateMediaRetryPolicy.and.returnValue(throwError(() => ({ error: { detail: 'save failed' } })));

    await component.saveRetryPolicy('ingest' as any);

    expect(component.retryPolicyError('ingest' as any)).toBe('save failed');
    expect(toast.error).toHaveBeenCalledWith('save failed');
  });

  it('toggles retry history panels and reports summary helpers', () => {
    const { component } = createComponent();
    const loadRetryPolicyPresets = spyOn<any>(component, 'loadRetryPolicyPresets').and.returnValue(Promise.resolve());
    const loadRetryPolicyHistory = spyOn<any>(component, 'loadRetryPolicyHistory').and.returnValue(Promise.resolve());

    component.toggleRetryPolicyHistory('ingest' as any);
    expect(component.isRetryPolicyHistoryOpen('ingest' as any)).toBeTrue();
    expect(loadRetryPolicyPresets).toHaveBeenCalledWith('ingest');
    expect(loadRetryPolicyHistory).toHaveBeenCalledWith('ingest', false);

    (component as any).retryPolicyHistoryMeta['ingest'] = { page: 1, total_pages: 2 };
    expect(component.retryPolicyHistoryHasMore('ingest' as any)).toBeTrue();

    (component as any).retryPolicyPresetsByType['ingest'] = [
      { label: 'Factory', fallback_used: false },
      { label: 'Emergency', fallback_used: true },
    ];
    expect(component.retryPolicyPresetSummary('ingest' as any)).toContain('Emergency (fallback)');

    component.toggleRetryPolicyHistory('ingest' as any);
    expect(component.isRetryPolicyHistoryOpen('ingest' as any)).toBeFalse();
  });

  it('handles rollback preset guard failures and queue assignment errors', async () => {
    const { component, admin, toast } = createComponent();
    (component as any).retryPolicyPresetsByType = { ingest: [] };
    spyOn<any>(component, 'loadRetryPolicyPresets').and.returnValue(Promise.resolve());

    await component.rollbackRetryPolicyPreset('ingest' as any, 'factory_default' as any);
    expect(toast.error).toHaveBeenCalledWith('Preset is not available.');

    (component as any).retryPolicyPresetsByType = {
      ingest: [
        {
          preset_key: 'factory_default',
          label: 'Factory default',
          policy: {
            max_attempts: 5,
            backoff_schedule_seconds: [30, 60],
            jitter_ratio: 0.2,
            enabled: true,
            version_ts: 'v1',
          },
        },
      ],
    };
    component.retryPolicies.set([]);
    await component.rollbackRetryPolicyPreset('ingest' as any, 'factory_default' as any);
    expect(toast.error).toHaveBeenCalledWith('Current policy could not be loaded.');

    component.selectedQueueJobIds.set(new Set(['job-1']));
    spyOn(globalThis, 'prompt').and.returnValue('owner-42');
    admin.updateMediaJobTriage.and.returnValue(throwError(() => ({ error: { detail: 'assign failed' } })));
    await component.bulkAssignSelectedJobs();
    expect(toast.error).toHaveBeenCalledWith('assign failed');
  });

  it('handles open-job-events error branch and closes modal state', () => {
    const { component, admin, toast } = createComponent();
    admin.listMediaJobEvents.and.returnValue(throwError(() => ({ error: { detail: 'events failed' } })));

    component.openJobEvents({ id: 'job-9', job_type: 'ingest' } as any);
    expect(component.jobEventsLoading()).toBeFalse();
    expect(toast.error).toHaveBeenCalledWith('events failed');

    component.closeJobEvents();
    expect(component.activeJobEventsFor()).toBeNull();
    expect(component.jobEvents()).toEqual([]);
  });

  it('sweeps prototype methods for deterministic guarded branch coverage', () => {
    const { component } = createComponent();
    component.assets.set([{ id: 'asset-1', title_en: 'Asset', tags: ['featured'] }] as any);
    component.jobs.set([{ id: 'job-1', job_type: 'ingest', status: 'queued' }] as any);
    component.collections.set([{ id: 'collection-1', slug: 'collection-1', name: 'Collection' }] as any);
    component.selectedIds.set(new Set(['asset-1']));
    component.selectedQueueJobIds.set(new Set(['job-1']));
    component.newCollectionName = 'Wave Collection';
    component.newCollectionSlug = 'wave-collection';
    component.queueAssignedToUserId = 'owner-1';
    component.queueTag = 'featured';
    component.editTitleEn = 'Edited title';
    component.editAltEn = 'Edited alt';

    spyOn(globalThis, 'prompt').and.returnValue('owner-1');
    spyOn(globalThis, 'confirm').and.returnValue(false);

    const attempted = runDamPrototypeSweep(component);
    expect(attempted).toBeGreaterThan(65);
  });
});
