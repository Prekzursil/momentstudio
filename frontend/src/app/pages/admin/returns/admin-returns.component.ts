import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { AdminReturnsService, ReturnRequestRead, ReturnRequestStatus } from '../../../core/admin-returns.service';
import { ToastService } from '../../../core/toast.service';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';

type StatusOption = { value: ReturnRequestStatus | ''; labelKey: string };

@Component({
  selector: 'app-admin-returns',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslateModule, BreadcrumbComponent, ButtonComponent, SkeletonComponent],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs()"></app-breadcrumb>

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

          <label class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
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
        </div>

        <div class="grid lg:grid-cols-[1fr_440px] gap-4 items-start">
          <div class="grid gap-3">
            <div *ngIf="loading()" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <app-skeleton [rows]="6"></app-skeleton>
            </div>

            <div *ngIf="!loading() && error()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
              {{ error() }}
            </div>

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
  loading = signal(true);
  error = signal<string | null>(null);
  items = signal<Array<any>>([]);
  meta = signal<{ total_items?: number; total_pages?: number; page?: number; limit?: number }>({});

  selectedId = signal<string | null>(null);
  selected = signal<ReturnRequestRead | null>(null);
  detailLoading = signal(false);
  saving = signal(false);

  query = '';
  statusFilter: ReturnRequestStatus | '' = '';
  orderIdFilter: string | null = null;
  page = 1;

  editStatus: ReturnRequestStatus = 'requested';
  editNote = '';

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
      this.page = 1;
      this.load();
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
    this.load();
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
    const params: any = { page: this.page, limit: 25 };
    const q = this.query.trim();
    if (q) params.q = q;
    if (this.statusFilter) params.status_filter = this.statusFilter;
    if (this.orderIdFilter) params.order_id = this.orderIdFilter;
    this.api.search(params).subscribe({
      next: (resp) => {
        this.items.set(resp.items as any);
        this.meta.set(resp.meta as any);
        this.loading.set(false);
        if (clearSelection && this.selectedId()) {
          this.selectedId.set(null);
          this.selected.set(null);
        }
      },
      error: () => {
        this.error.set(this.translate.instant('adminUi.returns.errors.load'));
        this.loading.set(false);
      }
    });
  }
}
