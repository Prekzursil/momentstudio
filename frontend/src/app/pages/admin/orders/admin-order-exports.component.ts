import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AdminOrderDocumentExport, AdminOrdersService } from '../../../core/admin-orders.service';
import { ToastService } from '../../../core/toast.service';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { extractRequestId } from '../../../shared/http-error';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { AdminPageHeaderComponent } from '../shared/admin-page-header.component';

@Component({
  selector: 'app-admin-order-exports',
  standalone: true,
  imports: [CommonModule, TranslateModule, BreadcrumbComponent, ButtonComponent, ErrorStateComponent, SkeletonComponent, AdminPageHeaderComponent],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <app-admin-page-header [titleKey]="'adminUi.orders.exports.title'" [hintKey]="'adminUi.orders.exports.hint'">
        <ng-template #primaryActions>
          <app-button size="sm" variant="ghost" [label]="'adminUi.orders.exports.back' | translate" (action)="backToOrders()"></app-button>
        </ng-template>

        <ng-template #secondaryActions>
          <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="load()"></app-button>
        </ng-template>
      </app-admin-page-header>

      <div *ngIf="loading()" class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <app-skeleton [rows]="6"></app-skeleton>
      </div>

      <app-error-state
        *ngIf="!loading() && error()"
        [message]="error()!"
        [requestId]="errorRequestId()"
        [showRetry]="true"
        (retry)="load()"
      ></app-error-state>

      <div
        *ngIf="!loading() && !error()"
        class="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      >
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
            <tr>
              <th class="px-4 py-3 text-left font-semibold">{{ 'adminUi.orders.exports.table.kind' | translate }}</th>
              <th class="px-4 py-3 text-left font-semibold">{{ 'adminUi.orders.exports.table.orders' | translate }}</th>
              <th class="px-4 py-3 text-left font-semibold">{{ 'adminUi.orders.exports.table.file' | translate }}</th>
              <th class="px-4 py-3 text-left font-semibold">{{ 'adminUi.orders.exports.table.created' | translate }}</th>
              <th class="px-4 py-3 text-left font-semibold">{{ 'adminUi.orders.exports.table.expires' | translate }}</th>
              <th class="px-4 py-3 text-right font-semibold">{{ 'adminUi.orders.exports.table.actions' | translate }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
            <tr *ngFor="let item of items()" class="hover:bg-slate-50/70 dark:hover:bg-slate-950/30">
              <td class="px-4 py-3 font-medium text-slate-900 dark:text-slate-50">{{ kindLabel(item.kind) }}</td>
              <td class="px-4 py-3 text-slate-700 dark:text-slate-200">
                <ng-container *ngIf="item.order_reference; else batchTpl">{{ item.order_reference }}</ng-container>
                <ng-template #batchTpl>
                  {{ item.order_count || 0 }} {{ 'adminUi.orders.exports.ordersCount' | translate }}
                </ng-template>
              </td>
              <td class="px-4 py-3 text-slate-700 dark:text-slate-200">
                <span class="truncate block max-w-[340px]">{{ item.filename }}</span>
              </td>
              <td class="px-4 py-3 text-slate-600 dark:text-slate-300">{{ item.created_at | date: 'short' }}</td>
              <td class="px-4 py-3 text-slate-600 dark:text-slate-300">
                <ng-container *ngIf="item.expires_at; else neverTpl">{{ item.expires_at | date: 'short' }}</ng-container>
                <ng-template #neverTpl>—</ng-template>
              </td>
              <td class="px-4 py-3 text-right">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.orders.exports.download' | translate"
                  [disabled]="busyId() === item.id || isExpired(item)"
                  (action)="download(item)"
                ></app-button>
              </td>
            </tr>

            <tr *ngIf="items().length === 0">
              <td class="px-4 py-8 text-center text-slate-600 dark:text-slate-300" colspan="6">
                {{ 'adminUi.orders.exports.empty' | translate }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div *ngIf="meta()" class="flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
        <div>{{ page }} / {{ meta()!.total_pages }}</div>
        <div class="flex items-center gap-2">
          <app-button size="sm" variant="ghost" [label]="'adminUi.actions.prev' | translate" [disabled]="page <= 1" (action)="goTo(page - 1)"></app-button>
          <app-button size="sm" variant="ghost" [label]="'adminUi.actions.next' | translate" [disabled]="page >= meta()!.total_pages" (action)="goTo(page + 1)"></app-button>
        </div>
      </div>
    </div>
  `
})
export class AdminOrderExportsComponent implements OnInit {
  loading = signal(true);
  error = signal<string | null>(null);
  errorRequestId = signal<string | null>(null);
  items = signal<AdminOrderDocumentExport[]>([]);
  meta = signal<{ total_pages: number } | null>(null);
  busyId = signal<string | null>(null);

  page = 1;
  limit = 50;

  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.admin', url: '/admin/dashboard' },
    { label: 'adminUi.nav.orders', url: '/admin/orders' },
    { label: 'adminUi.orders.exports.title' }
  ];

  constructor(
    private api: AdminOrdersService,
    private toast: ToastService,
    private translate: TranslateService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.load();
  }

  backToOrders(): void {
    void this.router.navigateByUrl('/admin/orders');
  }

  goTo(next: number): void {
    this.page = Math.max(1, next);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.errorRequestId.set(null);
    this.api.listDocumentExports({ page: this.page, limit: this.limit }).subscribe({
      next: (res) => {
        this.items.set(res?.items || []);
        this.meta.set((res as any)?.meta || null);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(this.translate.instant('adminUi.orders.exports.errors.load'));
        this.errorRequestId.set(extractRequestId(err));
        this.items.set([]);
        this.meta.set(null);
        this.loading.set(false);
      }
    });
  }

  isExpired(item: AdminOrderDocumentExport): boolean {
    const raw = (item.expires_at || '').trim();
    if (!raw) return false;
    const t = new Date(raw).getTime();
    return Number.isFinite(t) && t <= Date.now();
  }

  kindLabel(kind: string): string {
    const key =
      kind === 'packing_slip'
        ? 'adminUi.orders.exports.kinds.packingSlip'
        : kind === 'packing_slips_batch'
          ? 'adminUi.orders.exports.kinds.packingSlipsBatch'
          : kind === 'shipping_label'
            ? 'adminUi.orders.exports.kinds.shippingLabel'
            : kind === 'receipt'
              ? 'adminUi.orders.exports.kinds.receipt'
              : null;
    return key ? this.translate.instant(key) : kind;
  }

  download(item: AdminOrderDocumentExport): void {
    if (!item?.id) return;
    if (this.isExpired(item)) {
      this.toast.error(this.translate.instant('adminUi.orders.exports.errors.expired'));
      return;
    }
    this.busyId.set(item.id);
    this.api.downloadDocumentExport(item.id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = item.filename || 'export.pdf';
        a.click();
        URL.revokeObjectURL(url);
        this.busyId.set(null);
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.orders.exports.errors.download'));
        this.busyId.set(null);
      }
    });
  }
}
