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
  MediaJobStatus,
  MediaJobType,
  MediaTelemetryResponse
} from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { extractRequestId } from '../../../shared/http-error';

type DamTab = 'library' | 'review' | 'collections' | 'trash' | 'queue';

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

          <div *ngIf="queueError()" class="text-sm text-rose-700 dark:text-rose-300">{{ queueError() }}</div>
          <div *ngIf="queueLoading()" class="text-sm text-slate-600 dark:text-slate-300">Loading job queue…</div>
          <div *ngIf="!queueLoading() && jobs().length === 0" class="text-sm text-slate-500 dark:text-slate-400">No jobs found.</div>
          <div
            *ngFor="let job of jobs()"
            class="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <p class="font-semibold text-slate-900 dark:text-slate-50">{{ job.job_type }} · {{ job.status }}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">Asset {{ job.asset_id || 'n/a' }} · {{ job.progress_pct }}% · attempt {{ job.attempt }}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ job.created_at | date: 'short' }}</p>
            <p *ngIf="job.error_message" class="text-xs text-rose-600 dark:text-rose-300">{{ job.error_message }}</p>
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
    </section>
  `
})
export class DamAssetLibraryComponent implements OnInit, OnDestroy {
  constructor(
    private readonly admin: AdminService,
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
  readonly telemetry = signal<MediaTelemetryResponse | null>(null);
  readonly loading = signal(false);
  readonly queueLoading = signal(false);
  readonly queueError = signal<string | null>(null);
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
    if (tab === 'queue') {
      this.startQueuePolling();
      this.loadJobs(true);
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
        asset_id: this.queueAssetId.trim() || undefined,
        created_from: this.queueCreatedFrom ? `${this.queueCreatedFrom}T00:00:00+00:00` : undefined,
        created_to: this.queueCreatedTo ? `${this.queueCreatedTo}T23:59:59+00:00` : undefined
      })
      .subscribe({
        next: (res) => {
          this.jobs.set(res.items || []);
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
    this.queueAssetId = '';
    this.queueCreatedFrom = '';
    this.queueCreatedTo = '';
    this.loadJobs(true);
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

  private pushJob(job: MediaJob): void {
    const merged = [job, ...this.jobs().filter((existing) => existing.id !== job.id)];
    this.jobs.set(merged.slice(0, 20));
  }
}
