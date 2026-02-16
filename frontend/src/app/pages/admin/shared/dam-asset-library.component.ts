import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import {
  AdminService,
  MediaAsset,
  MediaAssetStatus,
  MediaAssetType,
  MediaAssetVisibility,
  MediaCollection,
  MediaJob,
  MediaJobEvent,
  MediaJobStatus,
  MediaJobTriageState,
  MediaJobType,
  MediaRetryPolicy,
  MediaRetryPolicyEvent,
  MediaRetryPolicyPreset,
  MediaRetryPolicyPresetKey,
  MediaRetryPolicySnapshot,
  MediaTelemetryResponse
} from '../../../core/admin.service';
import { AuthService } from '../../../core/auth.service';
import { ToastService } from '../../../core/toast.service';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { extractRequestId } from '../../../shared/http-error';

type DamTab = 'library' | 'review' | 'collections' | 'trash' | 'queue';
type QueueMode = 'pipeline' | 'dead_letter';
type RetryPolicyDiffRow = {
  field: 'max_attempts' | 'backoff_schedule_seconds' | 'jitter_ratio' | 'enabled';
  label: string;
  before: string;
  after: string;
  changed: boolean;
  detail?: string;
};
type RetryPolicyRollbackPreview = {
  jobType: MediaJobType;
  targetLabel: string;
  targetPolicy: MediaRetryPolicySnapshot;
  currentPolicy: MediaRetryPolicySnapshot;
  diffs: RetryPolicyDiffRow[];
  request: { preset_key?: MediaRetryPolicyPresetKey; event_id?: string };
};

@Component({
  selector: 'app-dam-asset-library',
  standalone: true,
  imports: [CommonModule, FormsModule, ErrorStateComponent],
  template: `
    <section class="grid gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          *ngFor="let t of tabs"
          class="rounded-full border px-3 py-1.5 text-xs font-semibold"
          [class.border-indigo-600]="tab() === t.id"
          [class.bg-indigo-50]="tab() === t.id"
          [class.text-indigo-700]="tab() === t.id"
          [class.border-slate-300]="tab() !== t.id"
          [class.text-slate-700]="tab() !== t.id"
          (click)="switchTab(t.id)"
        >
          {{ t.label }}
        </button>
      </div>

      <div class="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div class="flex flex-wrap items-end gap-2">
          <label class="grid gap-1">
            <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">Search</span>
            <input
              class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
              [(ngModel)]="q"
              placeholder="filename, URL, tags, metadata"
              (keyup.enter)="reload(true)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">Tag</span>
            <input
              class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
              [(ngModel)]="tag"
              placeholder="hero"
              (keyup.enter)="reload(true)"
            />
          </label>
          <label class="grid gap-1">
            <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">Type</span>
            <select
              class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
              [(ngModel)]="assetType"
              (change)="reload(true)"
            >
              <option value="">All</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="document">Document</option>
            </select>
          </label>
          <label class="grid gap-1">
            <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">Status</span>
            <select
              class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
              [(ngModel)]="statusFilter"
              (change)="reload(true)"
            >
              <option value="">Any</option>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="archived">Archived</option>
              <option value="trashed">Trashed</option>
            </select>
          </label>
          <label class="grid gap-1">
            <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">Visibility</span>
            <select
              class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
              [(ngModel)]="visibility"
              (change)="reload(true)"
            >
              <option value="">Any</option>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </label>
          <label class="grid gap-1">
            <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">Sort</span>
            <select
              class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
              [(ngModel)]="sort"
              (change)="reload(true)"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="name_asc">Name A-Z</option>
              <option value="name_desc">Name Z-A</option>
            </select>
          </label>
          <button
            type="button"
            class="h-10 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            (click)="reload(true)"
          >
            Apply
          </button>
          <button
            type="button"
            class="h-10 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            (click)="resetFilters()"
          >
            Reset
          </button>
          <label class="h-10 cursor-pointer rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-700">
            Upload
            <input type="file" class="hidden" (change)="upload($event)" />
          </label>
        </div>

        <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30">
            <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Queue depth</p>
            <p class="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">{{ telemetry()?.queue_depth ?? 0 }}</p>
          </div>
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30">
            <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Online workers</p>
            <p class="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">{{ telemetry()?.online_workers ?? 0 }}</p>
          </div>
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30">
            <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Stale processing</p>
            <p class="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">{{ telemetry()?.stale_processing_count ?? 0 }}</p>
          </div>
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30">
            <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Oldest queued</p>
            <p class="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">{{ oldestQueuedLabel() }}</p>
          </div>
        </div>

        <app-error-state
          *ngIf="error()"
          [message]="error()!"
          [requestId]="errorRequestId()"
          [showRetry]="true"
          (retry)="reload()"
        ></app-error-state>

        <div *ngIf="loading()" class="text-sm text-slate-600 dark:text-slate-300">Loading media…</div>

        <div *ngIf="tab() === 'collections'" class="grid gap-3">
          <div class="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950/30">
            <input
              class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
              [(ngModel)]="newCollectionName"
              placeholder="Collection name"
            />
            <input
              class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
              [(ngModel)]="newCollectionSlug"
              placeholder="collection-slug"
            />
            <select
              class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
              [(ngModel)]="newCollectionVisibility"
            >
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>
            <button
              type="button"
              class="h-10 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
              (click)="createCollection()"
            >
              Create collection
            </button>
          </div>
          <div class="grid gap-2">
            <div
              *ngFor="let c of collections()"
              class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <div>
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ c.name }} <span class="text-xs text-slate-500">({{ c.slug }})</span></p>
                <p class="text-xs text-slate-500 dark:text-slate-400">{{ c.visibility }} · {{ c.item_count }} items</p>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button type="button" class="text-xs text-slate-700 underline dark:text-slate-200" (click)="editCollection(c)">Edit</button>
                <button type="button" class="text-xs text-indigo-700 underline dark:text-indigo-300" (click)="attachSelectionToCollection(c)">
                  Add selected ({{ selectedCount() }})
                </button>
              </div>
            </div>
          </div>
        </div>

        <div *ngIf="tab() === 'queue'" class="grid gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="rounded-full border px-3 py-1.5 text-xs font-semibold"
              [class.border-indigo-600]="queueMode === 'pipeline'"
              [class.bg-indigo-50]="queueMode === 'pipeline'"
              [class.text-indigo-700]="queueMode === 'pipeline'"
              [class.border-slate-300]="queueMode !== 'pipeline'"
              [class.text-slate-700]="queueMode !== 'pipeline'"
              (click)="setQueueMode('pipeline')"
            >
              Pipeline
            </button>
            <button
              type="button"
              class="rounded-full border px-3 py-1.5 text-xs font-semibold"
              [class.border-rose-600]="queueMode === 'dead_letter'"
              [class.bg-rose-50]="queueMode === 'dead_letter'"
              [class.text-rose-700]="queueMode === 'dead_letter'"
              [class.border-slate-300]="queueMode !== 'dead_letter'"
              [class.text-slate-700]="queueMode !== 'dead_letter'"
              (click)="setQueueMode('dead_letter')"
            >
              Dead-letter
            </button>
          </div>
          <div class="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950/30">
            <label class="grid gap-1">
              <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">Status</span>
              <select
                class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                [(ngModel)]="queueStatus"
                (change)="loadJobs(true)"
              >
                <option value="">Any</option>
                <option value="queued">Queued</option>
                <option value="processing">Processing</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="dead_letter">Dead letter</option>
              </select>
            </label>
            <label class="grid gap-1">
              <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">Job type</span>
              <select
                class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                [(ngModel)]="queueJobType"
                (change)="loadJobs(true)"
              >
                <option value="">Any</option>
                <option value="ingest">Ingest</option>
                <option value="variant">Variant</option>
                <option value="edit">Edit</option>
                <option value="ai_tag">AI tag</option>
                <option value="duplicate_scan">Duplicate scan</option>
                <option value="usage_reconcile">Usage reconcile</option>
              </select>
            </label>
            <label class="grid gap-1">
              <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">Triage</span>
              <select
                class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                [(ngModel)]="queueTriageState"
                (change)="loadJobs(true)"
              >
                <option value="">Any</option>
                <option value="open">Open</option>
                <option value="retrying">Retrying</option>
                <option value="ignored">Ignored</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
            <label class="grid gap-1">
              <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">Assignee</span>
              <input
                class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                [(ngModel)]="queueAssignedToUserId"
                placeholder="user uuid"
                (keyup.enter)="loadJobs(true)"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">Tag</span>
              <input
                class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                [(ngModel)]="queueTag"
                placeholder="timeout"
                (keyup.enter)="loadJobs(true)"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">Asset ID</span>
              <input
                class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                [(ngModel)]="queueAssetId"
                placeholder="asset uuid"
                (keyup.enter)="loadJobs(true)"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">From</span>
              <input
                type="date"
                class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                [(ngModel)]="queueCreatedFrom"
                (change)="loadJobs(true)"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">To</span>
              <input
                type="date"
                class="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-800"
                [(ngModel)]="queueCreatedTo"
                (change)="loadJobs(true)"
              />
            </label>
            <label class="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              <input type="checkbox" [(ngModel)]="queueSlaBreachedOnly" (change)="loadJobs(true)" />
              SLA breached
            </label>
            <button
              type="button"
              class="h-10 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              (click)="loadJobs(true)"
            >
              Apply
            </button>
            <button
              type="button"
              class="h-10 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              (click)="resetQueueFilters()"
            >
              Reset
            </button>
            <button
              type="button"
              class="h-10 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
              (click)="runUsageReconcile()"
            >
              Reconcile usage
            </button>
          </div>

          <div class="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between gap-2">
              <div>
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">Retry policies</p>
                <p class="text-xs text-slate-500 dark:text-slate-400">Per job-type attempts, schedule, and jitter for newly queued jobs.</p>
              </div>
              <button
                type="button"
                class="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100"
                [disabled]="!canEditRetryPolicies()"
                (click)="resetAllRetryPolicies()"
              >
                Reset all
              </button>
            </div>

            <p *ngIf="retryPoliciesError()" class="text-xs text-rose-700 dark:text-rose-300">{{ retryPoliciesError() }}</p>
            <div *ngIf="retryPoliciesLoading()" class="text-xs text-slate-500 dark:text-slate-400">Loading retry policies…</div>

            <div *ngFor="let policy of retryPolicies()" class="grid gap-2 rounded border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-950/20">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="text-xs font-semibold text-slate-800 uppercase tracking-[0.14em] dark:text-slate-100">{{ policy.job_type }}</p>
                <p class="text-[11px] text-slate-500 dark:text-slate-400">Updated {{ policy.updated_at | date: 'short' }}</p>
              </div>
              <div class="grid gap-2 md:grid-cols-5">
                <label class="grid gap-1 text-xs">
                  <span class="font-semibold text-slate-700 dark:text-slate-200">Enabled</span>
                  <input
                    type="checkbox"
                    [ngModel]="retryPolicyDraft(policy.job_type).enabled"
                    (ngModelChange)="setRetryPolicyDraftEnabled(policy.job_type, $event)"
                    [disabled]="!canEditRetryPolicies()"
                  />
                </label>
                <label class="grid gap-1 text-xs">
                  <span class="font-semibold text-slate-700 dark:text-slate-200">Max attempts</span>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    class="h-10 rounded border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900"
                    [ngModel]="retryPolicyDraft(policy.job_type).max_attempts"
                    (ngModelChange)="setRetryPolicyDraftMaxAttempts(policy.job_type, $event)"
                    [disabled]="!canEditRetryPolicies()"
                  />
                </label>
                <label class="grid gap-1 text-xs md:col-span-2">
                  <span class="font-semibold text-slate-700 dark:text-slate-200">Schedule (seconds)</span>
                  <input
                    class="h-10 rounded border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900"
                    [ngModel]="retryPolicyDraft(policy.job_type).scheduleText"
                    (ngModelChange)="setRetryPolicyDraftSchedule(policy.job_type, $event)"
                    [disabled]="!canEditRetryPolicies()"
                    placeholder="30,120,600,1800"
                  />
                </label>
                <label class="grid gap-1 text-xs">
                  <span class="font-semibold text-slate-700 dark:text-slate-200">Jitter ratio</span>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    class="h-10 rounded border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900"
                    [ngModel]="retryPolicyDraft(policy.job_type).jitter_ratio"
                    (ngModelChange)="setRetryPolicyDraftJitter(policy.job_type, $event)"
                    [disabled]="!canEditRetryPolicies()"
                  />
                </label>
              </div>
              <p class="text-[11px] text-slate-500 dark:text-slate-400">Preview delays: {{ retryDelayPreview(policy.job_type) }}</p>
              <p *ngIf="retryPolicyError(policy.job_type)" class="text-xs text-rose-700 dark:text-rose-300">{{ retryPolicyError(policy.job_type) }}</p>
              <div class="flex flex-wrap items-center gap-2 text-xs">
                <button
                  type="button"
                  class="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100"
                  [disabled]="!canEditRetryPolicies()"
                  (click)="saveRetryPolicy(policy.job_type)"
                >
                  Save
                </button>
                <button
                  type="button"
                  class="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100"
                  [disabled]="!canEditRetryPolicies()"
                  (click)="resetRetryPolicy(policy.job_type)"
                >
                  Reset
                </button>
                <button
                  type="button"
                  class="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100"
                  [disabled]="!canEditRetryPolicies()"
                  (click)="markRetryPolicyKnownGood(policy.job_type)"
                >
                  Mark known good
                </button>
                <button
                  type="button"
                  class="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100"
                  [disabled]="!canEditRetryPolicies()"
                  (click)="rollbackRetryPolicyPreset(policy.job_type, 'factory_default')"
                >
                  Factory default
                </button>
                <button
                  type="button"
                  class="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100"
                  [disabled]="!canEditRetryPolicies()"
                  (click)="rollbackRetryPolicyPreset(policy.job_type, 'last_change')"
                >
                  Last change
                </button>
                <button
                  type="button"
                  class="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100"
                  [disabled]="!canEditRetryPolicies()"
                  (click)="rollbackRetryPolicyPreset(policy.job_type, 'known_good')"
                >
                  Known good
                </button>
                <button
                  type="button"
                  class="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100"
                  (click)="toggleRetryPolicyHistory(policy.job_type)"
                >
                  {{ isRetryPolicyHistoryOpen(policy.job_type) ? 'Hide history' : 'History' }}
                </button>
              </div>
              <div
                *ngIf="isRetryPolicyHistoryOpen(policy.job_type)"
                class="grid gap-2 rounded border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900/40"
              >
                <p class="text-[11px] text-slate-500 dark:text-slate-400">
                  Presets: {{ retryPolicyPresetSummary(policy.job_type) }}
                </p>
                <p *ngIf="retryPolicyHistoryError(policy.job_type)" class="text-xs text-rose-700 dark:text-rose-300">
                  {{ retryPolicyHistoryError(policy.job_type) }}
                </p>
                <p *ngIf="retryPolicyHistoryLoading(policy.job_type)" class="text-xs text-slate-500 dark:text-slate-400">
                  Loading policy history…
                </p>
                <p
                  *ngIf="!retryPolicyHistoryLoading(policy.job_type) && retryPolicyHistoryItems(policy.job_type).length === 0"
                  class="text-xs text-slate-500 dark:text-slate-400"
                >
                  No policy events yet.
                </p>
                <div
                  *ngFor="let evt of retryPolicyHistoryItems(policy.job_type)"
                  class="rounded border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-950/20"
                >
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <p class="text-xs font-semibold text-slate-900 dark:text-slate-50">
                      {{ evt.action }} <span *ngIf="evt.preset_key">· {{ evt.preset_key }}</span>
                    </p>
                    <p class="text-[11px] text-slate-500 dark:text-slate-400">
                      {{ evt.created_at | date: 'short' }} · actor {{ evt.actor_user_id || 'system' }}
                    </p>
                  </div>
                  <p class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ formatPolicySnapshot(evt.before_policy) }} → {{ formatPolicySnapshot(evt.after_policy) }}
                  </p>
                  <div class="mt-1 flex flex-wrap gap-1">
                    <span
                      *ngFor="let chip of retryPolicyDiffChips(evt.before_policy, evt.after_policy)"
                      class="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {{ chip }}
                    </span>
                  </div>
                  <div class="mt-1 grid gap-1" *ngIf="retryPolicyEventDiffRows(evt).length">
                    <div
                      *ngFor="let row of retryPolicyEventDiffRows(evt)"
                      class="grid gap-1 rounded border border-slate-200 bg-white p-1 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      <p class="font-semibold">{{ row.label }}</p>
                      <p>Before: {{ row.before }}</p>
                      <p>After: {{ row.after }}</p>
                      <p *ngIf="row.detail" class="text-slate-500 dark:text-slate-400">{{ row.detail }}</p>
                    </div>
                  </div>
                  <p *ngIf="evt.note" class="text-xs text-slate-700 dark:text-slate-200">{{ evt.note }}</p>
                  <button
                    *ngIf="canEditRetryPolicies()"
                    type="button"
                    class="mt-1 text-xs text-indigo-700 underline dark:text-indigo-300"
                    (click)="rollbackRetryPolicyEvent(policy.job_type, evt.id)"
                  >
                    Rollback to this revision
                  </button>
                </div>
                <button
                  *ngIf="retryPolicyHistoryHasMore(policy.job_type)"
                  type="button"
                  class="justify-self-start rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100"
                  (click)="loadMoreRetryPolicyHistory(policy.job_type)"
                >
                  Load more
                </button>
              </div>
              <div
                *ngIf="retryPolicyRollbackPreview()?.jobType === policy.job_type"
                class="grid gap-2 rounded border border-indigo-300 bg-indigo-50 p-3 dark:border-indigo-900/70 dark:bg-indigo-950/30"
              >
                <div class="flex items-center justify-between gap-2">
                  <p class="text-xs font-semibold text-indigo-900 dark:text-indigo-100">
                    Rollback preview · {{ retryPolicyRollbackPreview()?.targetLabel }}
                  </p>
                  <button
                    type="button"
                    class="rounded border border-indigo-300 px-2 py-1 text-[11px] font-semibold text-indigo-800 dark:border-indigo-700 dark:text-indigo-200"
                    (click)="cancelRetryPolicyRollbackPreview()"
                  >
                    Close
                  </button>
                </div>
                <div class="grid gap-2 md:grid-cols-2">
                  <div class="rounded border border-slate-300 bg-white p-2 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                    <p class="font-semibold text-slate-700 dark:text-slate-100">Current</p>
                    <p>{{ formatPolicySnapshot(retryPolicyRollbackPreview()!.currentPolicy) }}</p>
                  </div>
                  <div class="rounded border border-slate-300 bg-white p-2 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                    <p class="font-semibold text-slate-700 dark:text-slate-100">Target</p>
                    <p>{{ formatPolicySnapshot(retryPolicyRollbackPreview()!.targetPolicy) }}</p>
                  </div>
                </div>
                <div class="grid gap-1 text-[11px]">
                  <div
                    *ngFor="let row of retryPolicyRollbackPreview()!.diffs"
                    class="rounded border border-slate-300 bg-white p-2 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <p class="font-semibold text-slate-700 dark:text-slate-100">{{ row.label }}</p>
                    <p>Before: {{ row.before }}</p>
                    <p>After: {{ row.after }}</p>
                    <p *ngIf="row.detail" class="text-slate-500 dark:text-slate-400">{{ row.detail }}</p>
                  </div>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="rounded border border-indigo-400 bg-indigo-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-60"
                    [disabled]="retryPolicyRollbackApplying()"
                    (click)="applyRetryPolicyRollbackPreview()"
                  >
                    Apply rollback
                  </button>
                  <button
                    type="button"
                    class="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100"
                    [disabled]="retryPolicyRollbackApplying()"
                    (click)="cancelRetryPolicyRollbackPreview()"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div *ngIf="selectedQueueJobCount() > 0" class="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-xs dark:border-slate-800 dark:bg-slate-900">
            <span class="font-semibold text-slate-700 dark:text-slate-100">{{ selectedQueueJobCount() }} selected</span>
            <button type="button" class="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100" (click)="bulkRetrySelectedJobs()">Retry selected</button>
            <button type="button" class="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100" (click)="bulkAssignSelectedJobs()">Assign</button>
            <button type="button" class="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100" (click)="bulkMarkSelectedJobs('ignored')">Mark ignored</button>
            <button type="button" class="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100" (click)="bulkMarkSelectedJobs('resolved')">Mark resolved</button>
            <button type="button" class="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100" (click)="bulkAddTagToSelectedJobs()">Add tag</button>
            <button type="button" class="rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100" (click)="bulkRemoveTagFromSelectedJobs()">Remove tag</button>
          </div>

          <div *ngIf="queueError()" class="text-sm text-rose-700 dark:text-rose-300">{{ queueError() }}</div>
          <div *ngIf="queueLoading()" class="text-sm text-slate-600 dark:text-slate-300">Loading job queue…</div>
          <div *ngIf="!queueLoading() && jobs().length === 0" class="text-sm text-slate-500 dark:text-slate-400">No jobs found.</div>
          <div
            *ngFor="let job of jobs()"
            class="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="font-semibold text-slate-900 dark:text-slate-50">{{ job.job_type }} · {{ job.status }}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400">Asset {{ job.asset_id || 'n/a' }} · {{ job.progress_pct }}% · attempt {{ job.attempt }}/{{ job.max_attempts }}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400">Triage: {{ job.triage_state }} · Created {{ job.created_at | date: 'short' }}</p>
                <p *ngIf="job.next_retry_at" class="text-xs text-indigo-700 dark:text-indigo-300">Next retry: {{ job.next_retry_at | date: 'short' }}</p>
                <p *ngIf="job.sla_due_at" class="text-xs text-amber-700 dark:text-amber-300">SLA: {{ job.sla_due_at | date: 'short' }}</p>
                <p *ngIf="job.incident_url" class="truncate text-xs text-slate-500 dark:text-slate-400">Incident: {{ job.incident_url }}</p>
              </div>
              <input type="checkbox" [checked]="selectedQueueJobIds().has(job.id)" (change)="toggleQueueJobSelected(job.id, $event)" />
            </div>
            <div *ngIf="job.tags?.length" class="mt-2 flex flex-wrap gap-1">
              <span
                *ngFor="let t of job.tags"
                class="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-950/20 dark:text-slate-200"
              >
                {{ t }}
              </span>
            </div>
            <p *ngIf="job.error_message" class="mt-2 text-xs text-rose-600 dark:text-rose-300">{{ job.error_message }}</p>
            <div class="mt-2 flex flex-wrap gap-2 text-xs">
              <button type="button" class="text-indigo-700 underline dark:text-indigo-300" (click)="retryJob(job)">Retry now</button>
              <button type="button" class="text-slate-700 underline dark:text-slate-200" (click)="assignJob(job)">Assign</button>
              <button type="button" class="text-slate-700 underline dark:text-slate-200" (click)="setSla(job)">Set SLA</button>
              <button type="button" class="text-slate-700 underline dark:text-slate-200" (click)="setIncident(job)">Set incident</button>
              <button type="button" class="text-slate-700 underline dark:text-slate-200" (click)="setTriageState(job, 'open')">Open</button>
              <button type="button" class="text-slate-700 underline dark:text-slate-200" (click)="setTriageState(job, 'ignored')">Ignore</button>
              <button type="button" class="text-slate-700 underline dark:text-slate-200" (click)="setTriageState(job, 'resolved')">Resolve</button>
              <button type="button" class="text-slate-700 underline dark:text-slate-200" (click)="addJobTag(job)">Add tag</button>
              <button type="button" class="text-slate-700 underline dark:text-slate-200" (click)="removeJobTag(job)">Remove tag</button>
              <button type="button" class="text-slate-700 underline dark:text-slate-200" (click)="addTriageNote(job)">Add note</button>
              <button type="button" class="text-slate-700 underline dark:text-slate-200" (click)="openJobEvents(job)">Events</button>
            </div>
          </div>

          <div *ngIf="jobsMetaTotalPages() > 1" class="flex items-center justify-between">
            <button
              type="button"
              class="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100"
              [disabled]="queuePage <= 1"
              (click)="prevQueuePage()"
            >
              Prev
            </button>
            <p class="text-xs text-slate-500 dark:text-slate-400">Page {{ queuePage }} / {{ jobsMetaTotalPages() }}</p>
            <button
              type="button"
              class="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100"
              [disabled]="queuePage >= jobsMetaTotalPages()"
              (click)="nextQueuePage()"
            >
              Next
            </button>
          </div>
        </div>

        <div *ngIf="tab() !== 'collections' && tab() !== 'queue'" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <label
            *ngFor="let asset of assets()"
            class="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{{ asset.original_filename || asset.public_url }}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400">{{ asset.asset_type }} · {{ asset.status }} · {{ asset.visibility }}</p>
              </div>
              <input type="checkbox" [checked]="selectedIds().has(asset.id)" (change)="toggleSelected(asset.id, $event)" />
            </div>
            <img
              *ngIf="asset.asset_type === 'image'"
              [src]="asset.preview_url || asset.public_url"
              [alt]="asset.original_filename || 'media'"
              class="h-36 w-full rounded-lg border border-slate-200 object-cover dark:border-slate-700"
              loading="lazy"
            />
            <div *ngIf="asset.asset_type !== 'image'" class="rounded-lg border border-dashed border-slate-300 p-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {{ asset.asset_type.toUpperCase() }} preview
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ asset.public_url }}</p>
            <div class="flex flex-wrap gap-1">
              <span
                *ngFor="let t of asset.tags"
                class="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-950/20 dark:text-slate-200"
              >
                {{ t }}
              </span>
            </div>
            <div class="flex flex-wrap gap-2 text-xs">
              <button type="button" class="text-slate-700 underline dark:text-slate-200" (click)="openDetails(asset)">Details</button>
              <button type="button" class="text-slate-700 underline dark:text-slate-200" (click)="editTags(asset)">Tags</button>
              <button type="button" class="text-slate-700 underline dark:text-slate-200" (click)="openUsage(asset)">Usage</button>
              <button type="button" class="text-slate-700 underline dark:text-slate-200" (click)="requestVariant(asset)">Variant</button>
              <button type="button" class="text-slate-700 underline dark:text-slate-200" (click)="editImage(asset)">Edit</button>
              <button *ngIf="asset.status === 'draft'" type="button" class="text-emerald-700 underline dark:text-emerald-300" (click)="approve(asset)">Approve</button>
              <button *ngIf="asset.status === 'draft'" type="button" class="text-rose-700 underline dark:text-rose-300" (click)="reject(asset)">Reject</button>
              <button *ngIf="asset.status !== 'trashed'" type="button" class="text-rose-700 underline dark:text-rose-300" (click)="softDelete(asset)">Trash</button>
              <button *ngIf="asset.status === 'trashed'" type="button" class="text-indigo-700 underline dark:text-indigo-300" (click)="restore(asset)">Restore</button>
              <button *ngIf="asset.status === 'trashed'" type="button" class="text-rose-700 underline dark:text-rose-300" (click)="purge(asset)">Purge</button>
            </div>
          </label>
        </div>

        <div *ngIf="metaTotalPages() > 1" class="flex items-center justify-between pt-1">
          <button
            type="button"
            class="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100"
            [disabled]="page <= 1"
            (click)="prevPage()"
          >
            Prev
          </button>
          <p class="text-xs text-slate-500 dark:text-slate-400">Page {{ page }} / {{ metaTotalPages() }}</p>
          <button
            type="button"
            class="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100"
            [disabled]="page >= metaTotalPages()"
            (click)="nextPage()"
          >
            Next
          </button>
        </div>
      </div>

      <div *ngIf="detailAsset()" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div class="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ detailAsset()?.original_filename || detailAsset()?.public_url }}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">{{ detailAsset()?.asset_type }} · {{ detailAsset()?.status }}</p>
            </div>
            <button type="button" class="text-xs font-semibold text-slate-700 underline dark:text-slate-200" (click)="closeDetails()">Close</button>
          </div>
          <div class="mt-3 grid gap-3 md:grid-cols-2">
            <div class="grid gap-2">
              <label class="grid gap-1 text-xs">
                <span class="font-semibold text-slate-700 dark:text-slate-200">Rights license</span>
                <input class="h-10 rounded border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900" [(ngModel)]="editRightsLicense" />
              </label>
              <label class="grid gap-1 text-xs">
                <span class="font-semibold text-slate-700 dark:text-slate-200">Rights owner</span>
                <input class="h-10 rounded border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900" [(ngModel)]="editRightsOwner" />
              </label>
              <label class="grid gap-1 text-xs">
                <span class="font-semibold text-slate-700 dark:text-slate-200">Visibility</span>
                <select class="h-10 rounded border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900" [(ngModel)]="editVisibility">
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
              </label>
              <label class="grid gap-1 text-xs">
                <span class="font-semibold text-slate-700 dark:text-slate-200">Status</span>
                <select class="h-10 rounded border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900" [(ngModel)]="editStatus">
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
            </div>
            <div class="grid gap-2">
              <label class="grid gap-1 text-xs">
                <span class="font-semibold text-slate-700 dark:text-slate-200">Title EN</span>
                <input class="h-10 rounded border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900" [(ngModel)]="editTitleEn" />
              </label>
              <label class="grid gap-1 text-xs">
                <span class="font-semibold text-slate-700 dark:text-slate-200">Alt EN</span>
                <input class="h-10 rounded border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900" [(ngModel)]="editAltEn" />
              </label>
              <label class="grid gap-1 text-xs">
                <span class="font-semibold text-slate-700 dark:text-slate-200">Title RO</span>
                <input class="h-10 rounded border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900" [(ngModel)]="editTitleRo" />
              </label>
              <label class="grid gap-1 text-xs">
                <span class="font-semibold text-slate-700 dark:text-slate-200">Alt RO</span>
                <input class="h-10 rounded border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900" [(ngModel)]="editAltRo" />
              </label>
            </div>
          </div>
          <div class="mt-3 flex justify-end gap-2">
            <button type="button" class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-100" (click)="closeDetails()">Cancel</button>
            <button type="button" class="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900" (click)="saveDetails()">Save</button>
          </div>
        </div>
      </div>

      <div *ngIf="activeJobEventsFor()" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div class="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">Job events</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">{{ activeJobEventsFor()?.job_type }} · {{ activeJobEventsFor()?.id }}</p>
            </div>
            <button type="button" class="text-xs font-semibold text-slate-700 underline dark:text-slate-200" (click)="closeJobEvents()">Close</button>
          </div>
          <div *ngIf="jobEventsLoading()" class="mt-3 text-sm text-slate-600 dark:text-slate-300">Loading events…</div>
          <div *ngIf="!jobEventsLoading() && !jobEvents().length" class="mt-3 text-sm text-slate-500 dark:text-slate-400">No events recorded.</div>
          <div *ngIf="jobEvents().length" class="mt-3 max-h-[55vh] space-y-2 overflow-auto pr-1">
            <div *ngFor="let evt of jobEvents()" class="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900">
              <p class="text-xs font-semibold text-slate-900 dark:text-slate-50">{{ evt.action }}</p>
              <p class="text-[11px] text-slate-500 dark:text-slate-400">{{ evt.created_at | date: 'short' }} · actor {{ evt.actor_user_id || 'system' }}</p>
              <p *ngIf="evt.note" class="text-xs text-slate-700 dark:text-slate-200">{{ evt.note }}</p>
              <pre *ngIf="evt.meta_json" class="mt-1 overflow-auto rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">{{ evt.meta_json }}</pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  `
})
export class DamAssetLibraryComponent implements OnInit, OnDestroy {
  constructor(
    private readonly admin: AdminService,
    private readonly auth: AuthService,
    private readonly toast: ToastService
  ) {}

  readonly tabs: Array<{ id: DamTab; label: string }> = [
    { id: 'library', label: 'Library' },
    { id: 'review', label: 'Review queue' },
    { id: 'collections', label: 'Collections' },
    { id: 'trash', label: 'Trash' },
    { id: 'queue', label: 'Jobs' }
  ];

  readonly tab = signal<DamTab>('library');
  readonly assets = signal<MediaAsset[]>([]);
  readonly collections = signal<MediaCollection[]>([]);
  readonly jobs = signal<MediaJob[]>([]);
  readonly retryPolicies = signal<MediaRetryPolicy[]>([]);
  readonly selectedQueueJobIds = signal<Set<string>>(new Set());
  readonly activeJobEventsFor = signal<MediaJob | null>(null);
  readonly jobEvents = signal<MediaJobEvent[]>([]);
  readonly jobEventsLoading = signal(false);
  readonly telemetry = signal<MediaTelemetryResponse | null>(null);
  readonly loading = signal(false);
  readonly queueLoading = signal(false);
  readonly queueError = signal<string | null>(null);
  readonly retryPoliciesLoading = signal(false);
  readonly retryPoliciesError = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly errorRequestId = signal<string | null>(null);
  readonly detailAsset = signal<MediaAsset | null>(null);
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly meta = signal<{ total_items: number; total_pages: number; page: number; limit: number }>({
    total_items: 0,
    total_pages: 1,
    page: 1,
    limit: 24
  });
  readonly jobsMeta = signal<{ total_items: number; total_pages: number; page: number; limit: number }>({
    total_items: 0,
    total_pages: 1,
    page: 1,
    limit: 20
  });

  readonly metaTotalPages = computed(() => Math.max(1, this.meta().total_pages || 1));
  readonly selectedCount = computed(() => this.selectedIds().size);
  readonly selectedQueueJobCount = computed(() => this.selectedQueueJobIds().size);
  readonly jobsMetaTotalPages = computed(() => Math.max(1, this.jobsMeta().total_pages || 1));
  readonly oldestQueuedLabel = computed(() => {
    const ageSeconds = this.telemetry()?.oldest_queued_age_seconds ?? null;
    if (ageSeconds == null) return 'n/a';
    if (ageSeconds < 60) return `${ageSeconds}s`;
    if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m`;
    return `${Math.floor(ageSeconds / 3600)}h`;
  });

  q = '';
  tag = '';
  assetType: MediaAssetType | '' = '';
  statusFilter: MediaAssetStatus | '' = '';
  visibility: MediaAssetVisibility | '' = '';
  sort: 'newest' | 'oldest' | 'name_asc' | 'name_desc' = 'newest';
  page = 1;
  queuePage = 1;
  queueStatus: MediaJobStatus | '' = '';
  queueJobType: MediaJobType | '' = '';
  queueTriageState: MediaJobTriageState | '' = '';
  queueAssignedToUserId = '';
  queueTag = '';
  queueSlaBreachedOnly = false;
  queueMode: QueueMode = 'pipeline';
  queueAssetId = '';
  queueCreatedFrom = '';
  queueCreatedTo = '';

  newCollectionName = '';
  newCollectionSlug = '';
  newCollectionVisibility: MediaAssetVisibility = 'private';

  editRightsLicense = '';
  editRightsOwner = '';
  editVisibility: MediaAssetVisibility = 'private';
  editStatus: MediaAssetStatus = 'draft';
  editTitleEn = '';
  editAltEn = '';
  editTitleRo = '';
  editAltRo = '';
  private queuePollHandle: ReturnType<typeof setInterval> | null = null;
  private retryPolicyDrafts: Record<
    string,
    { max_attempts: number; scheduleText: string; jitter_ratio: number; enabled: boolean }
  > = {};
  private retryPolicyRowErrors: Record<string, string> = {};
  private retryPolicyHistories: Record<string, MediaRetryPolicyEvent[]> = {};
  private retryPolicyHistoryMeta: Record<string, { page: number; total_pages: number }> = {};
  private retryPolicyHistoryLoadingByType: Record<string, boolean> = {};
  private retryPolicyHistoryErrorByType: Record<string, string> = {};
  private retryPolicyPresetsByType: Record<string, MediaRetryPolicyPreset[]> = {};
  private readonly retryPolicyHistoryOpen = signal<Set<string>>(new Set());
  readonly retryPolicyRollbackPreview = signal<RetryPolicyRollbackPreview | null>(null);
  readonly retryPolicyRollbackApplying = signal(false);

  ngOnInit(): void {
    this.reload();
    void this.loadCollections();
    this.loadTelemetry();
  }

  ngOnDestroy(): void {
    this.stopQueuePolling();
  }

  switchTab(tab: DamTab): void {
    this.tab.set(tab);
    this.retryPolicyRollbackPreview.set(null);
    if (tab === 'queue') {
      this.startQueuePolling();
      this.loadJobs(true);
      this.loadRetryPolicies();
      return;
    }
    this.stopQueuePolling();
    if (tab === 'review') {
      this.statusFilter = 'draft';
      this.reload(true);
    } else if (tab === 'trash') {
      this.statusFilter = 'trashed';
      this.reload(true);
    } else if (tab === 'library') {
      if (this.statusFilter === 'draft' || this.statusFilter === 'trashed') {
        this.statusFilter = '';
      }
      this.reload(true);
    } else if (tab === 'collections') {
      void this.loadCollections();
    }
  }

  setQueueMode(mode: QueueMode): void {
    if (this.queueMode === mode) return;
    this.queueMode = mode;
    if (mode === 'dead_letter') {
      this.queueStatus = '';
      this.queueTriageState = this.queueTriageState || 'open';
    }
    this.loadJobs(true);
  }

  resetFilters(): void {
    this.q = '';
    this.tag = '';
    this.assetType = '';
    this.statusFilter = this.tab() === 'review' ? 'draft' : this.tab() === 'trash' ? 'trashed' : '';
    this.visibility = '';
    this.sort = 'newest';
    this.reload(true);
  }

  reload(resetPage = false): void {
    if (resetPage) this.page = 1;
    this.loading.set(true);
    this.error.set(null);
    this.errorRequestId.set(null);
    this.admin
      .listMediaAssets({
        q: this.q || undefined,
        tag: this.tag || undefined,
        asset_type: this.assetType || undefined,
        status: this.statusFilter || undefined,
        visibility: this.visibility || undefined,
        include_trashed: this.tab() === 'trash',
        page: this.page,
        limit: 24,
        sort: this.sort
      })
      .subscribe({
        next: (res) => {
          this.assets.set(res.items || []);
          this.meta.set(res.meta || { total_items: 0, total_pages: 1, page: this.page, limit: 24 });
          this.loading.set(false);
          this.loadTelemetry();
        },
        error: (err) => {
          this.error.set(err?.error?.detail || 'Failed to load media assets.');
          this.errorRequestId.set(extractRequestId(err));
          this.loading.set(false);
        }
      });
  }

  prevPage(): void {
    if (this.page <= 1) return;
    this.page -= 1;
    this.reload();
  }

  nextPage(): void {
    if (this.page >= this.metaTotalPages()) return;
    this.page += 1;
    this.reload();
  }

  loadJobs(resetPage = false): void {
    if (resetPage) this.queuePage = 1;
    this.queueLoading.set(true);
    this.queueError.set(null);
    this.admin
      .listMediaJobs({
        page: this.queuePage,
        limit: 20,
        status: this.queueStatus || undefined,
        job_type: this.queueJobType || undefined,
        triage_state: this.queueTriageState || undefined,
        assigned_to_user_id: this.queueAssignedToUserId.trim() || undefined,
        tag: this.queueTag.trim() || undefined,
        sla_breached: this.queueSlaBreachedOnly || undefined,
        dead_letter_only: this.queueMode === 'dead_letter',
        asset_id: this.queueAssetId.trim() || undefined,
        created_from: this.queueCreatedFrom ? `${this.queueCreatedFrom}T00:00:00+00:00` : undefined,
        created_to: this.queueCreatedTo ? `${this.queueCreatedTo}T23:59:59+00:00` : undefined
      })
      .subscribe({
        next: (res) => {
          this.jobs.set(res.items || []);
          this.selectedQueueJobIds.set(new Set());
          this.jobsMeta.set(res.meta || { total_items: 0, total_pages: 1, page: this.queuePage, limit: 20 });
          this.queueLoading.set(false);
          this.loadTelemetry();
        },
        error: (err) => {
          this.queueError.set(err?.error?.detail || 'Failed to load media jobs.');
          this.queueLoading.set(false);
        }
      });
  }

  loadRetryPolicies(): void {
    this.retryPoliciesLoading.set(true);
    this.retryPoliciesError.set(null);
    this.admin.listMediaRetryPolicies().subscribe({
      next: (res) => {
        const items = (res.items || []).slice().sort((a, b) => a.job_type.localeCompare(b.job_type));
        this.retryPolicies.set(items);
        const drafts: Record<string, { max_attempts: number; scheduleText: string; jitter_ratio: number; enabled: boolean }> = {};
        for (const item of items) {
          drafts[item.job_type] = {
            max_attempts: item.max_attempts,
            scheduleText: (item.backoff_schedule_seconds || []).join(','),
            jitter_ratio: item.jitter_ratio,
            enabled: item.enabled
          };
        }
        this.retryPolicyDrafts = drafts;
        this.retryPolicyRowErrors = {};
        this.retryPolicyHistories = {};
        this.retryPolicyHistoryMeta = {};
        this.retryPolicyHistoryLoadingByType = {};
        this.retryPolicyHistoryErrorByType = {};
        this.retryPolicyPresetsByType = {};
        this.retryPolicyHistoryOpen.set(new Set<string>());
        this.retryPoliciesLoading.set(false);
      },
      error: (err) => {
        this.retryPoliciesError.set(err?.error?.detail || 'Failed to load retry policies.');
        this.retryPoliciesLoading.set(false);
      }
    });
  }

  prevQueuePage(): void {
    if (this.queuePage <= 1) return;
    this.queuePage -= 1;
    this.loadJobs();
  }

  nextQueuePage(): void {
    if (this.queuePage >= this.jobsMetaTotalPages()) return;
    this.queuePage += 1;
    this.loadJobs();
  }

  resetQueueFilters(): void {
    this.queueStatus = '';
    this.queueJobType = '';
    this.queueTriageState = '';
    this.queueAssignedToUserId = '';
    this.queueTag = '';
    this.queueSlaBreachedOnly = false;
    this.queueAssetId = '';
    this.queueCreatedFrom = '';
    this.queueCreatedTo = '';
    this.loadJobs(true);
  }

  canEditRetryPolicies(): boolean {
    const role = (this.auth.role() || '').toLowerCase();
    return role === 'owner' || role === 'admin';
  }

  retryPolicyDraft(jobType: MediaJobType): { max_attempts: number; scheduleText: string; jitter_ratio: number; enabled: boolean } {
    if (!this.retryPolicyDrafts[jobType]) {
      this.retryPolicyDrafts[jobType] = { max_attempts: 5, scheduleText: '30,120,600,1800', jitter_ratio: 0.15, enabled: true };
    }
    return this.retryPolicyDrafts[jobType];
  }

  setRetryPolicyDraftEnabled(jobType: MediaJobType, value: boolean): void {
    this.retryPolicyDraft(jobType).enabled = !!value;
  }

  setRetryPolicyDraftMaxAttempts(jobType: MediaJobType, value: string | number): void {
    this.retryPolicyDraft(jobType).max_attempts = Number(value);
  }

  setRetryPolicyDraftSchedule(jobType: MediaJobType, value: string): void {
    this.retryPolicyDraft(jobType).scheduleText = String(value || '');
  }

  setRetryPolicyDraftJitter(jobType: MediaJobType, value: string | number): void {
    this.retryPolicyDraft(jobType).jitter_ratio = Number(value);
  }

  retryPolicyError(jobType: MediaJobType): string | null {
    return this.retryPolicyRowErrors[jobType] || null;
  }

  retryDelayPreview(jobType: MediaJobType): string {
    const parsed = this.parseScheduleInput(this.retryPolicyDraft(jobType).scheduleText);
    if (!parsed.length) return 'invalid schedule';
    return parsed.map((seconds, idx) => `#${idx + 1}: ${seconds}s`).join(' · ');
  }

  async saveRetryPolicy(jobType: MediaJobType): Promise<void> {
    if (!this.canEditRetryPolicies()) return;
    const draft = this.retryPolicyDraft(jobType);
    const parsedSchedule = this.parseScheduleInput(draft.scheduleText);
    if (!parsedSchedule.length) {
      this.retryPolicyRowErrors[jobType] = 'Schedule must contain at least one positive integer.';
      this.toast.error(this.retryPolicyRowErrors[jobType]);
      return;
    }
    if (!Number.isFinite(Number(draft.max_attempts)) || Number(draft.max_attempts) < 1 || Number(draft.max_attempts) > 20) {
      this.retryPolicyRowErrors[jobType] = 'Max attempts must be between 1 and 20.';
      this.toast.error(this.retryPolicyRowErrors[jobType]);
      return;
    }
    const jitter = Number(draft.jitter_ratio);
    if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
      this.retryPolicyRowErrors[jobType] = 'Jitter ratio must be between 0 and 1.';
      this.toast.error(this.retryPolicyRowErrors[jobType]);
      return;
    }
    this.retryPolicyRowErrors[jobType] = '';
    try {
      const saved = await firstValueFrom(
        this.admin.updateMediaRetryPolicy(jobType, {
          enabled: !!draft.enabled,
          max_attempts: Number(draft.max_attempts),
          backoff_schedule_seconds: parsedSchedule,
          jitter_ratio: jitter
        })
      );
      this.applyRetryPolicySavedState(saved);
      if (this.isRetryPolicyHistoryOpen(saved.job_type)) {
        await this.loadRetryPolicyPresets(saved.job_type);
        await this.loadRetryPolicyHistory(saved.job_type, false);
      }
      this.toast.success(`Retry policy updated for ${saved.job_type}.`);
    } catch (err) {
      this.retryPolicyRowErrors[jobType] = (err as any)?.error?.detail || 'Failed to update retry policy.';
      this.toast.error(this.retryPolicyRowErrors[jobType]);
    }
  }

  async resetRetryPolicy(jobType: MediaJobType): Promise<void> {
    if (!this.canEditRetryPolicies()) return;
    try {
      const saved = await firstValueFrom(this.admin.resetMediaRetryPolicy(jobType));
      this.applyRetryPolicySavedState(saved);
      if (this.isRetryPolicyHistoryOpen(saved.job_type)) {
        await this.loadRetryPolicyPresets(saved.job_type);
        await this.loadRetryPolicyHistory(saved.job_type, false);
      }
      this.toast.success(`Retry policy reset for ${saved.job_type}.`);
    } catch (err) {
      this.retryPolicyRowErrors[jobType] = (err as any)?.error?.detail || 'Failed to reset retry policy.';
      this.toast.error(this.retryPolicyRowErrors[jobType]);
    }
  }

  async resetAllRetryPolicies(): Promise<void> {
    if (!this.canEditRetryPolicies()) return;
    try {
      const res = await firstValueFrom(this.admin.resetAllMediaRetryPolicies());
      const items = (res.items || []).slice().sort((a, b) => a.job_type.localeCompare(b.job_type));
      this.retryPolicies.set(items);
      const drafts: Record<string, { max_attempts: number; scheduleText: string; jitter_ratio: number; enabled: boolean }> = {};
      for (const item of items) {
        drafts[item.job_type] = {
          max_attempts: item.max_attempts,
          scheduleText: (item.backoff_schedule_seconds || []).join(','),
          jitter_ratio: item.jitter_ratio,
          enabled: item.enabled
        };
      }
      this.retryPolicyDrafts = drafts;
      this.retryPolicyRowErrors = {};
      this.retryPolicyHistories = {};
      this.retryPolicyHistoryMeta = {};
      this.retryPolicyHistoryLoadingByType = {};
      this.retryPolicyHistoryErrorByType = {};
      this.retryPolicyPresetsByType = {};
      this.retryPolicyHistoryOpen.set(new Set<string>());
      this.toast.success('All retry policies were reset to defaults.');
    } catch (err) {
      this.retryPoliciesError.set((err as any)?.error?.detail || 'Failed to reset retry policies.');
      this.toast.error(this.retryPoliciesError() || 'Failed to reset retry policies.');
    }
  }

  isRetryPolicyHistoryOpen(jobType: MediaJobType): boolean {
    return this.retryPolicyHistoryOpen().has(jobType);
  }

  toggleRetryPolicyHistory(jobType: MediaJobType): void {
    const next = new Set(this.retryPolicyHistoryOpen());
    if (next.has(jobType)) {
      next.delete(jobType);
      this.retryPolicyHistoryOpen.set(next);
      return;
    }
    next.add(jobType);
    this.retryPolicyHistoryOpen.set(next);
    void this.loadRetryPolicyPresets(jobType);
    void this.loadRetryPolicyHistory(jobType, false);
  }

  retryPolicyHistoryLoading(jobType: MediaJobType): boolean {
    return !!this.retryPolicyHistoryLoadingByType[jobType];
  }

  retryPolicyHistoryError(jobType: MediaJobType): string | null {
    return this.retryPolicyHistoryErrorByType[jobType] || null;
  }

  retryPolicyHistoryItems(jobType: MediaJobType): MediaRetryPolicyEvent[] {
    return this.retryPolicyHistories[jobType] || [];
  }

  retryPolicyHistoryHasMore(jobType: MediaJobType): boolean {
    const meta = this.retryPolicyHistoryMeta[jobType];
    if (!meta) return false;
    return meta.page < meta.total_pages;
  }

  retryPolicyPresetSummary(jobType: MediaJobType): string {
    const items = this.retryPolicyPresetsByType[jobType] || [];
    if (!items.length) return 'loading…';
    return items
      .map((preset) => `${preset.label}${preset.fallback_used ? ' (fallback)' : ''}`)
      .join(' · ');
  }

  formatPolicySnapshot(snapshot: MediaRetryPolicySnapshot): string {
    const schedule = (snapshot.backoff_schedule_seconds || []).join(',');
    return `${snapshot.max_attempts} tries · [${schedule}] · jitter ${Number(snapshot.jitter_ratio).toFixed(2)} · ${snapshot.enabled ? 'on' : 'off'}`;
  }

  private currentRetryPolicySnapshot(jobType: MediaJobType): MediaRetryPolicySnapshot | null {
    const policy = this.retryPolicies().find((item) => item.job_type === jobType);
    if (!policy) return null;
    return {
      max_attempts: policy.max_attempts,
      backoff_schedule_seconds: [...(policy.backoff_schedule_seconds || [])],
      jitter_ratio: Number(policy.jitter_ratio || 0),
      enabled: !!policy.enabled,
      version_ts: policy.updated_at || null
    };
  }

  private computeRetryPolicyDiffRows(
    before: MediaRetryPolicySnapshot,
    after: MediaRetryPolicySnapshot
  ): RetryPolicyDiffRow[] {
    const beforeSchedule = [...(before.backoff_schedule_seconds || [])];
    const afterSchedule = [...(after.backoff_schedule_seconds || [])];
    const changedSteps: string[] = [];
    const maxSteps = Math.max(beforeSchedule.length, afterSchedule.length);
    for (let idx = 0; idx < maxSteps; idx += 1) {
      const prev = beforeSchedule[idx];
      const next = afterSchedule[idx];
      if (prev === next) continue;
      changedSteps.push(`#${idx + 1}: ${prev ?? '—'} -> ${next ?? '—'}`);
    }

    return [
      {
        field: 'max_attempts',
        label: 'Max attempts',
        before: String(before.max_attempts),
        after: String(after.max_attempts),
        changed: Number(before.max_attempts) !== Number(after.max_attempts)
      },
      {
        field: 'backoff_schedule_seconds',
        label: 'Schedule (seconds)',
        before: beforeSchedule.join(', ') || '—',
        after: afterSchedule.join(', ') || '—',
        changed: changedSteps.length > 0,
        detail: changedSteps.length ? changedSteps.join(' · ') : undefined
      },
      {
        field: 'jitter_ratio',
        label: 'Jitter ratio',
        before: Number(before.jitter_ratio || 0).toFixed(2),
        after: Number(after.jitter_ratio || 0).toFixed(2),
        changed: Number(before.jitter_ratio || 0) !== Number(after.jitter_ratio || 0)
      },
      {
        field: 'enabled',
        label: 'Enabled',
        before: before.enabled ? 'on' : 'off',
        after: after.enabled ? 'on' : 'off',
        changed: Boolean(before.enabled) !== Boolean(after.enabled)
      }
    ];
  }

  retryPolicyDiffChips(before: MediaRetryPolicySnapshot, after: MediaRetryPolicySnapshot): string[] {
    return this.computeRetryPolicyDiffRows(before, after)
      .filter((row) => row.changed)
      .map((row) => row.label);
  }

  retryPolicyEventDiffRows(event: MediaRetryPolicyEvent): RetryPolicyDiffRow[] {
    return this.computeRetryPolicyDiffRows(event.before_policy, event.after_policy).filter((row) => row.changed);
  }

  async loadMoreRetryPolicyHistory(jobType: MediaJobType): Promise<void> {
    await this.loadRetryPolicyHistory(jobType, true);
  }

  async markRetryPolicyKnownGood(jobType: MediaJobType): Promise<void> {
    if (!this.canEditRetryPolicies()) return;
    try {
      await firstValueFrom(this.admin.markMediaRetryPolicyKnownGood(jobType));
      this.toast.success(`Marked current policy as known good for ${jobType}.`);
      await this.loadRetryPolicyPresets(jobType);
      await this.loadRetryPolicyHistory(jobType, false);
    } catch (err) {
      this.retryPolicyRowErrors[jobType] = (err as any)?.error?.detail || 'Failed to mark policy as known good.';
      this.toast.error(this.retryPolicyRowErrors[jobType]);
    }
  }

  async rollbackRetryPolicyPreset(jobType: MediaJobType, presetKey: MediaRetryPolicyPresetKey): Promise<void> {
    if (!this.canEditRetryPolicies()) return;
    const presets = this.retryPolicyPresetsByType[jobType] || [];
    let preset = presets.find((item) => item.preset_key === presetKey);
    if (!preset) {
      await this.loadRetryPolicyPresets(jobType);
      preset = (this.retryPolicyPresetsByType[jobType] || []).find((item) => item.preset_key === presetKey);
    }
    if (!preset) {
      this.retryPolicyRowErrors[jobType] = 'Preset is not available.';
      this.toast.error(this.retryPolicyRowErrors[jobType]);
      return;
    }
    const currentPolicy = this.currentRetryPolicySnapshot(jobType);
    if (!currentPolicy) {
      this.retryPolicyRowErrors[jobType] = 'Current policy could not be loaded.';
      this.toast.error(this.retryPolicyRowErrors[jobType]);
      return;
    }
    this.retryPolicyRollbackPreview.set({
      jobType,
      targetLabel: preset.label,
      targetPolicy: preset.policy,
      currentPolicy,
      diffs: this.computeRetryPolicyDiffRows(currentPolicy, preset.policy),
      request: { preset_key: presetKey }
    });
  }

  async rollbackRetryPolicyEvent(jobType: MediaJobType, eventId: string): Promise<void> {
    if (!this.canEditRetryPolicies()) return;
    const events = this.retryPolicyHistories[jobType] || [];
    let event = events.find((item) => item.id === eventId);
    if (!event) {
      await this.loadRetryPolicyHistory(jobType, false);
      event = (this.retryPolicyHistories[jobType] || []).find((item) => item.id === eventId);
    }
    if (!event) {
      this.retryPolicyRowErrors[jobType] = 'History event is not available.';
      this.toast.error(this.retryPolicyRowErrors[jobType]);
      return;
    }
    const currentPolicy = this.currentRetryPolicySnapshot(jobType);
    if (!currentPolicy) {
      this.retryPolicyRowErrors[jobType] = 'Current policy could not be loaded.';
      this.toast.error(this.retryPolicyRowErrors[jobType]);
      return;
    }
    this.retryPolicyRollbackPreview.set({
      jobType,
      targetLabel: `history:${event.id.slice(0, 8)}`,
      targetPolicy: event.after_policy,
      currentPolicy,
      diffs: this.computeRetryPolicyDiffRows(currentPolicy, event.after_policy),
      request: { event_id: eventId }
    });
  }

  cancelRetryPolicyRollbackPreview(): void {
    this.retryPolicyRollbackPreview.set(null);
  }

  async applyRetryPolicyRollbackPreview(): Promise<void> {
    const preview = this.retryPolicyRollbackPreview();
    if (!preview || !this.canEditRetryPolicies()) return;
    this.retryPolicyRollbackApplying.set(true);
    try {
      const saved = await firstValueFrom(this.admin.rollbackMediaRetryPolicy(preview.jobType, preview.request));
      this.applyRetryPolicySavedState(saved);
      this.toast.success(`Rolled back ${preview.jobType} policy.`);
      await this.loadRetryPolicyPresets(preview.jobType);
      await this.loadRetryPolicyHistory(preview.jobType, false);
      this.retryPolicyRollbackPreview.set(null);
    } catch (err) {
      this.retryPolicyRowErrors[preview.jobType] = (err as any)?.error?.detail || 'Failed to rollback retry policy.';
      this.toast.error(this.retryPolicyRowErrors[preview.jobType]);
    } finally {
      this.retryPolicyRollbackApplying.set(false);
    }
  }

  async runUsageReconcile(): Promise<void> {
    try {
      const job = await firstValueFrom(this.admin.requestMediaUsageReconcile());
      this.pushJob(job);
      this.toast.success('Usage reconciliation queued.');
      if (this.tab() === 'queue') {
        this.loadJobs(true);
      }
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Failed to queue usage reconciliation.');
    }
  }

  toggleQueueJobSelected(jobId: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const next = new Set(this.selectedQueueJobIds());
    if (input.checked) next.add(jobId);
    else next.delete(jobId);
    this.selectedQueueJobIds.set(next);
  }

  async bulkRetrySelectedJobs(): Promise<void> {
    const ids = Array.from(this.selectedQueueJobIds());
    if (!ids.length) return;
    try {
      const res = await firstValueFrom(this.admin.retryMediaJobsBulk(ids));
      const updated = new Map((res.items || []).map((row) => [row.id, row]));
      this.jobs.set(this.jobs().map((row) => updated.get(row.id) ?? row));
      this.selectedQueueJobIds.set(new Set());
      this.toast.success(`Queued ${res.items.length} jobs for retry.`);
      this.loadTelemetry();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Bulk retry failed.');
    }
  }

  async bulkAssignSelectedJobs(): Promise<void> {
    const ids = Array.from(this.selectedQueueJobIds());
    if (!ids.length) return;
    const value = window.prompt('Assign selected jobs to user id (blank clears assignee)', '');
    if (value === null) return;
    try {
      await Promise.all(
        ids.map((jobId) =>
          firstValueFrom(
            this.admin.updateMediaJobTriage(jobId, value.trim() ? { assigned_to_user_id: value.trim() } : { clear_assignee: true })
          )
        )
      );
      this.toast.success('Assignment updated for selected jobs.');
      this.loadJobs();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Bulk assignment failed.');
    }
  }

  async bulkMarkSelectedJobs(state: MediaJobTriageState): Promise<void> {
    const ids = Array.from(this.selectedQueueJobIds());
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((jobId) => firstValueFrom(this.admin.updateMediaJobTriage(jobId, { triage_state: state }))));
      this.toast.success(`Marked selected jobs as ${state}.`);
      this.loadJobs();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Bulk triage update failed.');
    }
  }

  async bulkAddTagToSelectedJobs(): Promise<void> {
    const ids = Array.from(this.selectedQueueJobIds());
    if (!ids.length) return;
    const value = window.prompt('Tag to add to selected jobs', '');
    if (!value || !value.trim()) return;
    try {
      await Promise.all(
        ids.map((jobId) => firstValueFrom(this.admin.updateMediaJobTriage(jobId, { add_tags: [value.trim()] })))
      );
      this.toast.success('Tag added to selected jobs.');
      this.loadJobs();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Bulk tag update failed.');
    }
  }

  async bulkRemoveTagFromSelectedJobs(): Promise<void> {
    const ids = Array.from(this.selectedQueueJobIds());
    if (!ids.length) return;
    const value = window.prompt('Tag to remove from selected jobs', '');
    if (!value || !value.trim()) return;
    try {
      await Promise.all(
        ids.map((jobId) => firstValueFrom(this.admin.updateMediaJobTriage(jobId, { remove_tags: [value.trim()] })))
      );
      this.toast.success('Tag removed from selected jobs.');
      this.loadJobs();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Bulk tag removal failed.');
    }
  }

  async retryJob(job: MediaJob): Promise<void> {
    try {
      const updated = await firstValueFrom(this.admin.retryMediaJob(job.id));
      this.replaceJob(updated);
      this.toast.success('Job queued for retry.');
      this.loadTelemetry();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Retry failed.');
    }
  }

  async assignJob(job: MediaJob): Promise<void> {
    const value = window.prompt('Assign user id (blank clears assignee)', job.assigned_to_user_id || '');
    if (value === null) return;
    await this.patchJobTriage(
      job,
      value.trim() ? { assigned_to_user_id: value.trim() } : { clear_assignee: true },
      'Assignment updated.'
    );
  }

  async setSla(job: MediaJob): Promise<void> {
    const value = window.prompt(
      'SLA due at (ISO 8601, blank to clear)',
      (job.sla_due_at || '').replace('Z', '')
    );
    if (value === null) return;
    await this.patchJobTriage(
      job,
      value.trim() ? { sla_due_at: value.trim() } : { clear_sla_due_at: true },
      'SLA updated.'
    );
  }

  async setIncident(job: MediaJob): Promise<void> {
    const value = window.prompt('Incident URL (blank to clear)', job.incident_url || '');
    if (value === null) return;
    await this.patchJobTriage(
      job,
      value.trim() ? { incident_url: value.trim() } : { clear_incident_url: true },
      'Incident link updated.'
    );
  }

  async setTriageState(job: MediaJob, state: MediaJobTriageState): Promise<void> {
    await this.patchJobTriage(job, { triage_state: state }, `Marked as ${state}.`);
  }

  async addJobTag(job: MediaJob): Promise<void> {
    const value = window.prompt('Tag to add', '');
    if (!value || !value.trim()) return;
    await this.patchJobTriage(job, { add_tags: [value.trim()] }, 'Tag added.');
  }

  async removeJobTag(job: MediaJob): Promise<void> {
    const value = window.prompt('Tag to remove', '');
    if (!value || !value.trim()) return;
    await this.patchJobTriage(job, { remove_tags: [value.trim()] }, 'Tag removed.');
  }

  async addTriageNote(job: MediaJob): Promise<void> {
    const value = window.prompt('Triage note', '');
    if (value === null) return;
    await this.patchJobTriage(job, { note: value.trim() || null }, 'Triage note saved.');
  }

  openJobEvents(job: MediaJob): void {
    this.activeJobEventsFor.set(job);
    this.jobEvents.set([]);
    this.jobEventsLoading.set(true);
    this.admin.listMediaJobEvents(job.id, { limit: 200 }).subscribe({
      next: (res) => {
        this.jobEvents.set(res.items || []);
        this.jobEventsLoading.set(false);
      },
      error: (err) => {
        this.jobEventsLoading.set(false);
        this.toast.error(err?.error?.detail || 'Failed to load job events.');
      }
    });
  }

  closeJobEvents(): void {
    this.activeJobEventsFor.set(null);
    this.jobEvents.set([]);
    this.jobEventsLoading.set(false);
  }

  toggleSelected(assetId: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const next = new Set(this.selectedIds());
    if (input.checked) next.add(assetId);
    else next.delete(assetId);
    this.selectedIds.set(next);
  }

  async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      await firstValueFrom(this.admin.uploadMediaAsset(file, { visibility: 'private', auto_finalize: true }));
      this.toast.success('Media uploaded.');
      this.reload();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Upload failed.');
    } finally {
      input.value = '';
    }
  }

  openDetails(asset: MediaAsset): void {
    this.detailAsset.set(asset);
    const en = (asset.i18n || []).find((row) => row.lang === 'en');
    const ro = (asset.i18n || []).find((row) => row.lang === 'ro');
    this.editRightsLicense = asset.rights_license || '';
    this.editRightsOwner = asset.rights_owner || '';
    this.editVisibility = asset.visibility;
    this.editStatus = asset.status;
    this.editTitleEn = en?.title || '';
    this.editAltEn = en?.alt_text || '';
    this.editTitleRo = ro?.title || '';
    this.editAltRo = ro?.alt_text || '';
  }

  closeDetails(): void {
    this.detailAsset.set(null);
  }

  async saveDetails(): Promise<void> {
    const asset = this.detailAsset();
    if (!asset) return;
    try {
      await firstValueFrom(
        this.admin.updateMediaAsset(asset.id, {
          rights_license: this.editRightsLicense || null,
          rights_owner: this.editRightsOwner || null,
          visibility: this.editVisibility,
          status: this.editStatus,
          i18n: [
            { lang: 'en', title: this.editTitleEn || null, alt_text: this.editAltEn || null },
            { lang: 'ro', title: this.editTitleRo || null, alt_text: this.editAltRo || null }
          ]
        })
      );
      this.toast.success('Asset metadata updated.');
      this.closeDetails();
      this.reload();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Failed to update asset metadata.');
    }
  }

  async editTags(asset: MediaAsset): Promise<void> {
    const nextRaw = window.prompt('Comma-separated tags', (asset.tags || []).join(', '));
    if (nextRaw === null) return;
    const tags = nextRaw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    try {
      await firstValueFrom(this.admin.updateMediaAsset(asset.id, { tags }));
      this.toast.success('Tags updated.');
      this.reload();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Failed to update tags.');
    }
  }

  async requestVariant(asset: MediaAsset): Promise<void> {
    const profile = window.prompt('Variant profile', 'web-1280');
    if (!profile) return;
    try {
      const job = await firstValueFrom(this.admin.requestMediaVariant(asset.id, profile.trim()));
      this.pushJob(job);
      this.toast.success('Variant job queued.');
      this.reload();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Failed to queue variant job.');
    }
  }

  async editImage(asset: MediaAsset): Promise<void> {
    const rotateText = window.prompt('Rotate clockwise (0/90/180/270)', '0');
    if (rotateText === null) return;
    const rotate = Number(rotateText || 0);
    try {
      const job = await firstValueFrom(this.admin.editMediaAsset(asset.id, { rotate_cw: rotate as 0 | 90 | 180 | 270 }));
      this.pushJob(job);
      this.toast.success('Edit job queued.');
      this.reload();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Failed to queue edit job.');
    }
  }

  async openUsage(asset: MediaAsset): Promise<void> {
    try {
      const usage = await firstValueFrom(this.admin.getMediaAssetUsage(asset.id));
      const keys = (usage.items || []).map((item) => item.source_key);
      window.alert(keys.length ? `Used in:\n${keys.join('\n')}` : 'No usage found.');
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Failed to load usage.');
    }
  }

  async approve(asset: MediaAsset): Promise<void> {
    try {
      await firstValueFrom(this.admin.approveMediaAsset(asset.id));
      this.toast.success('Asset approved.');
      this.reload();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Approval failed.');
    }
  }

  async reject(asset: MediaAsset): Promise<void> {
    try {
      await firstValueFrom(this.admin.rejectMediaAsset(asset.id));
      this.toast.success('Asset rejected.');
      this.reload();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Reject failed.');
    }
  }

  async softDelete(asset: MediaAsset): Promise<void> {
    if (!window.confirm('Move this asset to trash?')) return;
    try {
      await firstValueFrom(this.admin.softDeleteMediaAsset(asset.id));
      this.toast.success('Asset moved to trash.');
      this.reload();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Trash action failed.');
    }
  }

  async restore(asset: MediaAsset): Promise<void> {
    try {
      await firstValueFrom(this.admin.restoreMediaAsset(asset.id));
      this.toast.success('Asset restored.');
      this.reload();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Restore failed.');
    }
  }

  async purge(asset: MediaAsset): Promise<void> {
    if (!window.confirm('Permanently purge this asset?')) return;
    try {
      await firstValueFrom(this.admin.purgeMediaAsset(asset.id));
      this.toast.success('Asset purged.');
      this.reload();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Purge failed.');
    }
  }

  async loadCollections(): Promise<void> {
    try {
      const rows = await firstValueFrom(this.admin.listMediaCollections());
      this.collections.set(rows || []);
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Failed to load collections.');
    }
  }

  async createCollection(): Promise<void> {
    const name = this.newCollectionName.trim();
    const slug = this.newCollectionSlug.trim().toLowerCase();
    if (!name || !slug) {
      this.toast.error('Collection name and slug are required.');
      return;
    }
    try {
      await firstValueFrom(this.admin.createMediaCollection({ name, slug, visibility: this.newCollectionVisibility }));
      this.newCollectionName = '';
      this.newCollectionSlug = '';
      this.newCollectionVisibility = 'private';
      this.toast.success('Collection created.');
      await this.loadCollections();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Failed to create collection.');
    }
  }

  async editCollection(collection: MediaCollection): Promise<void> {
    const name = window.prompt('Collection name', collection.name);
    if (name === null) return;
    const slug = window.prompt('Collection slug', collection.slug);
    if (slug === null) return;
    const visibility = window.prompt('Visibility (public/private)', collection.visibility) as MediaAssetVisibility | null;
    if (!visibility) return;
    try {
      await firstValueFrom(
        this.admin.updateMediaCollection(collection.id, {
          name: name.trim(),
          slug: slug.trim().toLowerCase(),
          visibility: visibility === 'public' ? 'public' : 'private'
        })
      );
      this.toast.success('Collection updated.');
      await this.loadCollections();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Failed to update collection.');
    }
  }

  async attachSelectionToCollection(collection: MediaCollection): Promise<void> {
    const ids = Array.from(this.selectedIds());
    if (!ids.length) {
      this.toast.error('Select at least one asset first.');
      return;
    }
    try {
      await firstValueFrom(this.admin.replaceMediaCollectionItems(collection.id, ids));
      this.toast.success('Collection items updated.');
      await this.loadCollections();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Failed to update collection items.');
    }
  }

  private async patchJobTriage(job: MediaJob, payload: any, successMessage: string): Promise<void> {
    try {
      const updated = await firstValueFrom(this.admin.updateMediaJobTriage(job.id, payload));
      this.replaceJob(updated);
      this.toast.success(successMessage);
      this.loadTelemetry();
    } catch (err) {
      this.toast.error((err as any)?.error?.detail || 'Failed to update job triage.');
    }
  }

  private replaceJob(updated: MediaJob): void {
    this.jobs.set(this.jobs().map((row) => (row.id === updated.id ? updated : row)));
    if (this.activeJobEventsFor()?.id === updated.id) {
      this.activeJobEventsFor.set(updated);
      this.openJobEvents(updated);
    }
  }

  private loadTelemetry(): void {
    this.admin.getMediaTelemetry().subscribe({
      next: (res) => this.telemetry.set(res),
      error: () => {
        // Keep stale telemetry visible if refresh fails.
      }
    });
  }

  private startQueuePolling(): void {
    if (this.queuePollHandle != null) return;
    this.queuePollHandle = setInterval(() => {
      if (this.tab() !== 'queue') return;
      this.loadJobs();
    }, 8000);
  }

  private stopQueuePolling(): void {
    if (this.queuePollHandle == null) return;
    clearInterval(this.queuePollHandle);
    this.queuePollHandle = null;
  }

  private parseScheduleInput(value: string): number[] {
    return (value || '')
      .split(',')
      .map((token) => Number(token.trim()))
      .filter((num) => Number.isFinite(num) && Number.isInteger(num) && num > 0)
      .slice(0, 20);
  }

  private applyRetryPolicySavedState(saved: MediaRetryPolicy): void {
    this.retryPolicies.set(this.retryPolicies().map((row) => (row.job_type === saved.job_type ? saved : row)));
    this.retryPolicyDrafts[saved.job_type] = {
      max_attempts: saved.max_attempts,
      scheduleText: (saved.backoff_schedule_seconds || []).join(','),
      jitter_ratio: saved.jitter_ratio,
      enabled: saved.enabled
    };
    this.retryPolicyRowErrors[saved.job_type] = '';
  }

  private async loadRetryPolicyPresets(jobType: MediaJobType): Promise<void> {
    try {
      const res = await firstValueFrom(this.admin.getMediaRetryPolicyPresets(jobType));
      this.retryPolicyPresetsByType[jobType] = (res.items || []).slice();
    } catch (err) {
      this.retryPolicyPresetsByType[jobType] = [];
      this.retryPolicyHistoryErrorByType[jobType] = (err as any)?.error?.detail || 'Failed to load retry policy presets.';
    }
  }

  private async loadRetryPolicyHistory(jobType: MediaJobType, append: boolean): Promise<void> {
    if (this.retryPolicyHistoryLoadingByType[jobType]) return;
    const currentMeta = this.retryPolicyHistoryMeta[jobType];
    const nextPage = append ? Math.max(1, (currentMeta?.page || 1) + 1) : 1;
    if (append && currentMeta && currentMeta.page >= currentMeta.total_pages) return;
    this.retryPolicyHistoryLoadingByType[jobType] = true;
    this.retryPolicyHistoryErrorByType[jobType] = '';
    try {
      const res = await firstValueFrom(
        this.admin.listMediaRetryPolicyHistory({
          job_type: jobType,
          page: nextPage,
          limit: 10
        })
      );
      const nextItems = res.items || [];
      this.retryPolicyHistories[jobType] = append
        ? [...(this.retryPolicyHistories[jobType] || []), ...nextItems]
        : nextItems;
      const meta = res.meta || { page: nextPage, total_pages: 1 };
      this.retryPolicyHistoryMeta[jobType] = {
        page: Number(meta.page || nextPage),
        total_pages: Math.max(1, Number(meta.total_pages || 1))
      };
    } catch (err) {
      this.retryPolicyHistoryErrorByType[jobType] = (err as any)?.error?.detail || 'Failed to load retry policy history.';
    } finally {
      this.retryPolicyHistoryLoadingByType[jobType] = false;
    }
  }

  private pushJob(job: MediaJob): void {
    const merged = [job, ...this.jobs().filter((existing) => existing.id !== job.id)];
    this.jobs.set(merged.slice(0, 20));
  }
}
