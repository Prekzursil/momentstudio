import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription, forkJoin } from 'rxjs';
import { AdminReturnsService, ReturnRequestListItem, ReturnRequestRead, ReturnRequestStatus } from '../../../core/admin-returns.service';
import { ToastService } from '../../../core/toast.service';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { extractRequestId } from '../../../shared/http-error';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { AdminPageHeaderComponent } from '../shared/admin-page-header.component';

type StatusOption = { value: ReturnRequestStatus | ''; labelKey: string };
type BoardStatus = 'requested' | 'approved' | 'received' | 'refunded';
type BoardColumn = { items: ReturnRequestListItem[]; total: number };

@Component({
  selector: 'app-admin-returns',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TranslateModule,
    BreadcrumbComponent,
    ButtonComponent,
    ErrorStateComponent,
    SkeletonComponent,
    AdminPageHeaderComponent
  ],
		  template: `
		    <div class="grid gap-6">
		      <app-breadcrumb [crumbs]="crumbs()"></app-breadcrumb>

	        <app-admin-page-header [titleKey]="'adminUi.returns.title'" [hintKey]="'adminUi.returns.subtitle'"></app-admin-page-header>

	      <div class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-3 dark:border-slate-800 dark:bg-slate-900">
	        <div class="flex flex-wrap items-end gap-3">
	          <label class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
            <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'adminUi.returns.filters.search' | translate }}</span>
            <input
              class="h-10 w-64 max-w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="query"
              (keyup.enter)="applyFilters()"
              [placeholder]="'adminUi.returns.filters.searchPh' | translate"
            />
	          </label>

	          <label *ngIf="viewMode() === 'list'" class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
	            <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'adminUi.returns.filters.status' | translate }}</span>
	            <select
	              class="h-10 w-56 max-w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	              [(ngModel)]="statusFilter"
	            >
              <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="">
                {{ 'adminUi.returns.filters.statusAll' | translate }}
              </option>
              <option *ngFor="let opt of statusOptions" class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" [value]="opt.value">
                {{ opt.labelKey | translate }}
	              </option>
	            </select>
	          </label>

	          <app-button size="sm" [label]="'adminUi.returns.filters.apply' | translate" (action)="applyFilters()"></app-button>

	          <div class="flex items-center gap-2">
	            <button
	              type="button"
	              class="h-10 rounded-lg border px-3 text-sm font-medium shadow-sm transition-colors dark:shadow-none"
	              [ngClass]="
	                viewMode() === 'list'
	                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-700/60 dark:bg-indigo-950/30 dark:text-indigo-200'
	                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/40'
	              "
	              (click)="setView('list')"
	            >
	              {{ 'adminUi.returns.view.list' | translate }}
	            </button>
	            <button
	              type="button"
	              class="h-10 rounded-lg border px-3 text-sm font-medium shadow-sm transition-colors dark:shadow-none"
	              [ngClass]="
	                viewMode() === 'board'
	                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-700/60 dark:bg-indigo-950/30 dark:text-indigo-200'
	                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/40'
	              "
	              (click)="setView('board')"
	            >
	              {{ 'adminUi.returns.view.board' | translate }}
	            </button>
	          </div>
	        </div>

	        <div class="grid lg:grid-cols-[1fr_440px] gap-4 items-start">
	          <div class="grid gap-3">
	            <ng-container *ngIf="viewMode() === 'list'">
	              <div *ngIf="loading()" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
	                <app-skeleton [rows]="6"></app-skeleton>
	              </div>

	              <app-error-state
                  *ngIf="!loading() && error()"
                  [message]="error()!"
                  [requestId]="errorRequestId()"
                  [showRetry]="true"
                  (retry)="retryLoad()"
                ></app-error-state>

	              <div *ngIf="!loading() && !items().length" class="text-sm text-slate-600 dark:text-slate-300">
	                {{ 'adminUi.returns.empty' | translate }}
	              </div>

	              <div *ngIf="items().length" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
	                <table class="min-w-[760px] w-full text-sm">
	                  <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
	                    <tr>
	                      <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.returns.table.date' | translate }}</th>
	                      <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.returns.table.status' | translate }}</th>
	                      <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.returns.table.order' | translate }}</th>
	                      <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.returns.table.customer' | translate }}</th>
	                    </tr>
	                  </thead>
	                  <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
	                    <tr
	                      *ngFor="let row of items()"
	                      class="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
	                      [ngClass]="row.id === selectedId() ? 'bg-slate-100 dark:bg-slate-800/70' : ''"
	                      (click)="select(row.id)"
	                    >
	                      <td class="px-3 py-2 whitespace-nowrap text-slate-700 dark:text-slate-200">
	                        {{ row.created_at | date: 'short' }}
	                      </td>
	                      <td class="px-3 py-2">
	                        <span class="inline-flex rounded-full px-2 py-0.5 text-xs border border-slate-200 dark:border-slate-700">
	                          {{ ('adminUi.returns.status.' + row.status) | translate }}
	                        </span>
	                      </td>
	                      <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
	                        <span class="font-mono text-xs">{{ row.order_reference || row.order_id.slice(0, 8) }}</span>
	                      </td>
	                      <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
	                        <div class="font-medium text-slate-900 dark:text-slate-50">{{ row.customer_name || '—' }}</div>
	                        <div class="text-xs text-slate-500 dark:text-slate-400">{{ row.customer_email || '—' }}</div>
	                      </td>
	                    </tr>
	                  </tbody>
	                </table>
	              </div>

	              <div *ngIf="items().length" class="flex items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
	                <span>
	                  {{
	                    'adminUi.returns.pagination'
	                      | translate: { page: meta().page || 1, total: meta().total_pages || 1, count: meta().total_items || 0 }
	                  }}
	                </span>
	                <div class="flex items-center gap-2">
	                  <app-button size="sm" [disabled]="!hasPrev()" [label]="'adminUi.returns.prev' | translate" (action)="prev()"></app-button>
	                  <app-button size="sm" [disabled]="!hasNext()" [label]="'adminUi.returns.next' | translate" (action)="next()"></app-button>
	                </div>
	              </div>
	            </ng-container>

	            <ng-container *ngIf="viewMode() === 'board'">
	              <div *ngIf="boardLoading()" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
	                <app-skeleton [rows]="6"></app-skeleton>
	              </div>

	              <app-error-state
                  *ngIf="!boardLoading() && boardError()"
                  [message]="boardError()!"
                  [requestId]="boardErrorRequestId()"
                  [showRetry]="true"
                  (retry)="retryLoad()"
                ></app-error-state>

	              <div *ngIf="!boardLoading() && !boardError()" class="grid gap-3 xl:grid-cols-4">
	                <div
	                  *ngFor="let status of boardStatuses"
	                  class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
	                >
	                  <div class="flex items-center justify-between gap-2">
	                    <div class="text-xs font-semibold tracking-wide uppercase text-slate-600 dark:text-slate-300">
	                      {{ ('adminUi.returns.status.' + status) | translate }}
	                    </div>
	                    <div class="text-xs text-slate-500 dark:text-slate-400">{{ board()[status].total }}</div>
	                  </div>

	                  <div *ngIf="!board()[status].items.length" class="mt-2 text-xs text-slate-500 dark:text-slate-400">
	                    {{ 'adminUi.returns.board.empty' | translate }}
	                  </div>

	                  <div *ngIf="board()[status].items.length" class="mt-2 grid gap-2">
	                    <button
	                      *ngFor="let row of board()[status].items"
	                      type="button"
	                      class="text-left rounded-lg border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700/40"
	                      [ngClass]="row.id === selectedId() ? 'ring-2 ring-indigo-500/40' : ''"
	                      (click)="select(row.id)"
	                    >
	                      <div class="flex items-center justify-between gap-2">
	                        <div class="font-mono text-xs text-slate-600 dark:text-slate-300 truncate">
	                          {{ row.order_reference || row.order_id.slice(0, 8) }}
	                        </div>
	                        <div class="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">{{ row.created_at | date: 'shortDate' }}</div>
	                      </div>
	                      <div class="mt-1 text-sm font-medium text-slate-900 dark:text-slate-50 truncate">
	                        {{ row.customer_name || '—' }}
	                      </div>
	                      <div class="text-xs text-slate-500 dark:text-slate-400 truncate">
	                        {{ row.customer_email || '—' }}
	                      </div>
	                    </button>
	                  </div>

	                  <div class="mt-3 flex items-center justify-between gap-2 text-xs">
	                    <button
	                      type="button"
	                      class="text-indigo-600 hover:underline dark:text-indigo-300"
	                      (click)="openStatusList(status)"
	                    >
	                      {{ 'adminUi.returns.board.viewAll' | translate }}
	                    </button>
	                    <div *ngIf="board()[status].total > board()[status].items.length" class="text-slate-500 dark:text-slate-400">
	                      +{{ board()[status].total - board()[status].items.length }}
	                    </div>
	                  </div>
	                </div>
	              </div>
	            </ng-container>
	          </div>

	          <div class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-3 dark:border-slate-800 dark:bg-slate-900">
	            <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.returns.detail.title' | translate }}</div>

            <div *ngIf="detailLoading()" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <app-skeleton [rows]="5"></app-skeleton>
            </div>

            <div *ngIf="!detailLoading() && !selected()" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.returns.detail.empty' | translate }}
            </div>

	            <div *ngIf="!detailLoading() && selected()" class="grid gap-3 text-sm text-slate-700 dark:text-slate-200">
	              <div class="grid gap-1">
	                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
	                  {{ 'adminUi.returns.detail.order' | translate }}
	                </div>
                <a
                  [routerLink]="['/admin/orders', selected()!.order_id]"
                  class="text-indigo-600 hover:underline dark:text-indigo-300"
                >
                  {{ selected()!.order_reference || selected()!.order_id }}
                </a>
                <div class="text-xs text-slate-500 dark:text-slate-400">
                  {{ selected()!.customer_name || '—' }} · {{ selected()!.customer_email || '—' }}
                </div>
              </div>

              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.returns.detail.status' | translate }}
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="editStatus"
                >
                  <option *ngFor="let opt of statusOptions" class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" [value]="opt.value">
                    {{ opt.labelKey | translate }}
                  </option>
                </select>
              </label>

              <div class="grid gap-1">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.returns.detail.reason' | translate }}
                </div>
                <div class="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{{ selected()!.reason }}</div>
              </div>

              <div *ngIf="selected()!.customer_message" class="grid gap-1">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.returns.detail.customerMessage' | translate }}
                </div>
                <div class="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{{ selected()!.customer_message }}</div>
              </div>

              <div class="grid gap-1">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.returns.detail.items' | translate }}
                </div>
                <ul class="grid gap-1">
                  <li *ngFor="let item of selected()!.items" class="flex items-center justify-between gap-2">
                    <span class="truncate">{{ item.product_name || item.order_item_id || item.id }}</span>
                    <span class="font-mono text-xs text-slate-500 dark:text-slate-400">×{{ item.quantity }}</span>
	                  </li>
	                </ul>
	              </div>

	              <div class="grid gap-2">
	                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
	                  {{ 'adminUi.returns.detail.returnLabel' | translate }}
	                </div>

	                <div
	                  *ngIf="returnLabelError()"
	                  class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-2 text-xs dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
	                >
	                  {{ returnLabelError() }}
	                </div>

	                <div class="flex flex-wrap items-center gap-2">
	                  <label
	                    class="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                  >
	                    <input type="file" class="hidden" (change)="onReturnLabelSelected($event)" />
	                    <span class="font-medium text-slate-900 dark:text-slate-50">{{ 'adminUi.returns.detail.returnLabelChoose' | translate }}</span>
	                    <span class="text-xs text-slate-500 dark:text-slate-300 truncate max-w-[220px]">
	                      {{ returnLabelFileName() }}
	                    </span>
	                  </label>

	                  <app-button
	                    size="sm"
	                    variant="ghost"
	                    [label]="'adminUi.returns.detail.returnLabelUpload' | translate"
	                    [disabled]="returnLabelBusy() || !returnLabelFile"
	                    (action)="uploadReturnLabel()"
	                  ></app-button>

	                  <app-button
	                    *ngIf="selected()!.has_return_label"
	                    size="sm"
	                    variant="ghost"
	                    [label]="'adminUi.returns.detail.returnLabelDownload' | translate"
	                    [disabled]="returnLabelBusy()"
	                    (action)="downloadReturnLabel()"
	                  ></app-button>

	                  <app-button
	                    *ngIf="selected()!.has_return_label"
	                    size="sm"
	                    variant="ghost"
	                    [label]="'adminUi.returns.detail.returnLabelDelete' | translate"
	                    [disabled]="returnLabelBusy()"
	                    (action)="deleteReturnLabel()"
	                  ></app-button>
	                </div>

	                <div *ngIf="selected()!.has_return_label" class="text-xs text-slate-600 dark:text-slate-300">
	                  {{ selected()!.return_label_filename }} · {{ selected()!.return_label_uploaded_at | date: 'short' }}
	                </div>
	                <div *ngIf="!selected()!.has_return_label" class="text-xs text-slate-600 dark:text-slate-300">
	                  {{ 'adminUi.returns.detail.returnLabelNone' | translate }}
	                </div>
	              </div>

	              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                {{ 'adminUi.returns.detail.adminNote' | translate }}
	                <textarea
	                  class="min-h-[120px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                  [(ngModel)]="editNote"
                  [placeholder]="'adminUi.returns.detail.adminNotePh' | translate"
                ></textarea>
              </label>

              <div class="flex items-center justify-end gap-2 pt-2">
                <app-button
                  size="sm"
                  [label]="'adminUi.returns.detail.save' | translate"
                  [loading]="saving()"
                  (action)="save()"
                ></app-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class AdminReturnsComponent implements OnInit, OnDestroy {
  viewMode = signal<'list' | 'board'>('list');

  loading = signal(true);
  error = signal<string | null>(null);
  errorRequestId = signal<string | null>(null);
  items = signal<ReturnRequestListItem[]>([]);
  meta = signal<{ total_items?: number; total_pages?: number; page?: number; limit?: number }>({});

  boardLoading = signal(false);
  boardError = signal<string | null>(null);
  boardErrorRequestId = signal<string | null>(null);
  board = signal<Record<BoardStatus, BoardColumn>>({
    requested: { items: [], total: 0 },
    approved: { items: [], total: 0 },
    received: { items: [], total: 0 },
    refunded: { items: [], total: 0 }
  });

  selectedId = signal<string | null>(null);
  selected = signal<ReturnRequestRead | null>(null);
  detailLoading = signal(false);
  saving = signal(false);

  returnLabelBusy = signal(false);
  returnLabelError = signal<string | null>(null);
  returnLabelFile: File | null = null;
  returnLabelSelectedName = signal<string>('');

  query = '';
  statusFilter: ReturnRequestStatus | '' = '';
  orderIdFilter: string | null = null;
  page = 1;

  editStatus: ReturnRequestStatus = 'requested';
  editNote = '';

  readonly boardStatuses: BoardStatus[] = ['requested', 'approved', 'received', 'refunded'];
  readonly statusOptions: StatusOption[] = [
    { value: 'requested', labelKey: 'adminUi.returns.status.requested' },
    { value: 'approved', labelKey: 'adminUi.returns.status.approved' },
    { value: 'rejected', labelKey: 'adminUi.returns.status.rejected' },
    { value: 'received', labelKey: 'adminUi.returns.status.received' },
    { value: 'refunded', labelKey: 'adminUi.returns.status.refunded' },
    { value: 'closed', labelKey: 'adminUi.returns.status.closed' }
  ];

  private readonly routeSub?: Subscription;

  constructor(
    private api: AdminReturnsService,
    private toast: ToastService,
    private translate: TranslateService,
    route: ActivatedRoute
  ) {
    this.routeSub = route.queryParamMap.subscribe((params) => {
      const orderId = params.get('order_id');
      this.orderIdFilter = orderId;
      const statusParam = (params.get('status') || params.get('status_filter') || '').trim().toLowerCase();
      const allowedStatuses = new Set(['requested', 'approved', 'rejected', 'received', 'refunded', 'closed']);
      if (statusParam && allowedStatuses.has(statusParam)) {
        this.statusFilter = statusParam as ReturnRequestStatus;
        this.viewMode.set('list');
      }
      this.page = 1;
      if (this.viewMode() === 'board') {
        this.loadBoard();
      } else {
        this.load();
      }
    });
  }

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
  }

  crumbs(): { label: string; url?: string }[] {
    return [
      { label: 'nav.home', url: '/' },
      { label: 'nav.admin', url: '/admin/dashboard' },
      { label: 'adminUi.returns.title' }
    ];
  }

  applyFilters(): void {
    this.page = 1;
    if (this.viewMode() === 'board') {
      this.loadBoard();
    } else {
      this.load();
    }
  }

  retryLoad(): void {
    if (this.viewMode() === 'board') {
      this.loadBoard();
    } else {
      this.load();
    }
  }

  hasPrev(): boolean {
    return (this.meta().page || 1) > 1;
  }

  hasNext(): boolean {
    const m = this.meta();
    return (m.page || 1) < (m.total_pages || 1);
  }

  prev(): void {
    if (!this.hasPrev()) return;
    this.page = (this.meta().page || 1) - 1;
    this.load();
  }

  next(): void {
    if (!this.hasNext()) return;
    this.page = (this.meta().page || 1) + 1;
    this.load();
  }

  select(returnId: string): void {
    if (!returnId) return;
    this.selectedId.set(returnId);
    this.detailLoading.set(true);
    this.returnLabelFile = null;
    this.returnLabelSelectedName.set('');
    this.returnLabelError.set(null);
    this.api.get(returnId).subscribe({
      next: (detail) => {
        this.selected.set(detail);
        this.editStatus = detail.status;
        this.editNote = detail.admin_note || '';
        this.detailLoading.set(false);
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.returns.errors.loadDetail'));
        this.detailLoading.set(false);
      }
    });
  }

  setView(mode: 'list' | 'board'): void {
    if (this.viewMode() === mode) return;
    this.viewMode.set(mode);
    this.page = 1;
    if (mode === 'board') {
      this.statusFilter = '';
      this.loadBoard();
    } else {
      this.load();
    }
  }

  openStatusList(status: BoardStatus): void {
    this.viewMode.set('list');
    this.statusFilter = status;
    this.page = 1;
    this.load(false);
  }

  returnLabelFileName(): string {
    return this.returnLabelSelectedName() || this.translate.instant('adminUi.returns.detail.returnLabelNoFile');
  }

  onReturnLabelSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] || null;
    this.returnLabelFile = file;
    this.returnLabelSelectedName.set(file?.name || '');
    this.returnLabelError.set(null);
    if (input) input.value = '';
  }

  uploadReturnLabel(): void {
    const id = this.selectedId();
    if (!id || !this.returnLabelFile) return;
    this.returnLabelBusy.set(true);
    this.returnLabelError.set(null);
    this.api.uploadReturnLabel(id, this.returnLabelFile).subscribe({
      next: (updated) => {
        this.selected.set(updated);
        this.returnLabelFile = null;
        this.returnLabelSelectedName.set('');
        this.returnLabelBusy.set(false);
        this.toast.success(this.translate.instant('adminUi.returns.success.saved'));
      },
      error: (err) => {
        this.returnLabelBusy.set(false);
        const msg = err?.error?.detail || this.translate.instant('adminUi.returns.errors.save');
        this.returnLabelError.set(msg);
        this.toast.error(msg);
      }
    });
  }

  downloadReturnLabel(): void {
    const id = this.selectedId();
    if (!id) return;
    this.returnLabelBusy.set(true);
    this.returnLabelError.set(null);
    const orderRef = this.selected()?.order_reference || this.selected()?.order_id?.slice(0, 8) || id.slice(0, 8);
    this.api.downloadReturnLabel(id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.selected()?.return_label_filename || `return-${orderRef}-label`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        this.returnLabelBusy.set(false);
      },
      error: (err) => {
        this.returnLabelBusy.set(false);
        const msg = err?.error?.detail || this.translate.instant('adminUi.returns.errors.loadDetail');
        this.returnLabelError.set(msg);
        this.toast.error(msg);
      }
    });
  }

  deleteReturnLabel(): void {
    const id = this.selectedId();
    if (!id) return;
    if (!confirm(this.translate.instant('adminUi.returns.detail.returnLabelConfirmDelete'))) return;
    this.returnLabelBusy.set(true);
    this.returnLabelError.set(null);
    this.api.deleteReturnLabel(id).subscribe({
      next: () => {
        const current = this.selected();
        if (current) {
          this.selected.set({ ...current, has_return_label: false, return_label_filename: null, return_label_uploaded_at: null });
        }
        this.returnLabelBusy.set(false);
        this.toast.success(this.translate.instant('adminUi.returns.success.saved'));
      },
      error: (err) => {
        this.returnLabelBusy.set(false);
        const msg = err?.error?.detail || this.translate.instant('adminUi.returns.errors.save');
        this.returnLabelError.set(msg);
        this.toast.error(msg);
      }
    });
  }

  save(): void {
    const id = this.selectedId();
    if (!id) return;
    this.saving.set(true);
    this.api.update(id, { status: this.editStatus, admin_note: this.editNote.trim() || null }).subscribe({
      next: (updated) => {
        this.selected.set(updated);
        this.saving.set(false);
        this.toast.success(this.translate.instant('adminUi.returns.success.saved'));
        this.load(false);
      },
      error: (err) => {
        this.saving.set(false);
        const msg = err?.error?.detail || this.translate.instant('adminUi.returns.errors.save');
        this.toast.error(msg);
      }
    });
  }

  private load(clearSelection = true): void {
    this.loading.set(true);
    this.error.set(null);
    this.errorRequestId.set(null);
    const params: any = { page: this.page, limit: 25 };
    const q = this.query.trim();
    if (q) params.q = q;
    if (this.statusFilter) params.status_filter = this.statusFilter;
    if (this.orderIdFilter) params.order_id = this.orderIdFilter;
    this.api.search(params).subscribe({
      next: (resp) => {
        this.items.set(resp.items || []);
        this.meta.set(resp.meta as any);
        this.loading.set(false);
        if (clearSelection && this.selectedId()) {
          this.selectedId.set(null);
          this.selected.set(null);
        }
      },
      error: (err) => {
        this.error.set(this.translate.instant('adminUi.returns.errors.load'));
        this.errorRequestId.set(extractRequestId(err));
        this.loading.set(false);
      }
    });
  }

  private loadBoard(): void {
    this.boardLoading.set(true);
    this.boardError.set(null);
    this.boardErrorRequestId.set(null);
    const params: any = { page: 1, limit: 25 };
    const q = this.query.trim();
    if (q) params.q = q;
    if (this.orderIdFilter) params.order_id = this.orderIdFilter;

    forkJoin({
      requested: this.api.search({ ...params, status_filter: 'requested' }),
      approved: this.api.search({ ...params, status_filter: 'approved' }),
      received: this.api.search({ ...params, status_filter: 'received' }),
      refunded: this.api.search({ ...params, status_filter: 'refunded' })
    }).subscribe({
      next: (resp) => {
        this.board.set({
          requested: { items: resp.requested.items || [], total: resp.requested.meta?.total_items || 0 },
          approved: { items: resp.approved.items || [], total: resp.approved.meta?.total_items || 0 },
          received: { items: resp.received.items || [], total: resp.received.meta?.total_items || 0 },
          refunded: { items: resp.refunded.items || [], total: resp.refunded.meta?.total_items || 0 }
        });
        this.boardLoading.set(false);
      },
      error: (err) => {
        this.boardError.set(this.translate.instant('adminUi.returns.errors.load'));
        this.boardErrorRequestId.set(extractRequestId(err));
        this.boardLoading.set(false);
      }
    });
  }
}
