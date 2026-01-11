import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { ToastService } from '../../../core/toast.service';
import { LocalizedCurrencyPipe } from '../../../shared/localized-currency.pipe';
import { AdminOrderListItem, AdminOrderListResponse, AdminOrdersService } from '../../../core/admin-orders.service';

type OrderStatusFilter = 'all' | 'pending' | 'paid' | 'shipped' | 'cancelled' | 'refunded';

@Component({
  selector: 'app-admin-orders',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TranslateModule,
    BreadcrumbComponent,
    ButtonComponent,
    InputComponent,
    SkeletonComponent,
    LocalizedCurrencyPipe
  ],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <div class="flex items-start justify-between gap-4">
        <div class="grid gap-1">
          <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.orders.title' | translate }}</h1>
          <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.orders.hint' | translate }}</p>
        </div>
        <app-button size="sm" variant="ghost" [label]="'adminUi.orders.export' | translate" (action)="downloadExport()"></app-button>
      </div>

      <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
        <div class="grid gap-3 lg:grid-cols-[1fr_240px_240px_240px_auto] items-end">
          <app-input [label]="'adminUi.orders.search' | translate" [(value)]="q"></app-input>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.orders.statusFilter' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="status"
            >
              <option value="all">{{ 'adminUi.orders.all' | translate }}</option>
              <option value="pending">{{ 'adminUi.orders.pending' | translate }}</option>
              <option value="paid">{{ 'adminUi.orders.paid' | translate }}</option>
              <option value="shipped">{{ 'adminUi.orders.shipped' | translate }}</option>
              <option value="cancelled">{{ 'adminUi.orders.cancelled' | translate }}</option>
              <option value="refunded">{{ 'adminUi.orders.refunded' | translate }}</option>
            </select>
          </label>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.orders.from' | translate }}
            <input
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              type="date"
              [(ngModel)]="fromDate"
            />
          </label>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.orders.to' | translate }}
            <input
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              type="date"
              [(ngModel)]="toDate"
            />
          </label>

          <div class="flex items-center gap-2">
            <app-button size="sm" [label]="'adminUi.actions.refresh' | translate" (action)="applyFilters()"></app-button>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'adminUi.actions.reset' | translate"
              (action)="resetFilters()"
            ></app-button>
          </div>
        </div>

        <div *ngIf="error()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
          {{ error() }}
        </div>

        <div *ngIf="loading(); else tableTpl">
          <app-skeleton [rows]="8"></app-skeleton>
        </div>
        <ng-template #tableTpl>
          <div *ngIf="orders().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'adminUi.orders.empty' | translate }}
          </div>

          <div *ngIf="orders().length > 0" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table class="min-w-[860px] w-full text-sm">
              <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                <tr>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.orders.table.ref' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.orders.table.customer' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.orders.table.status' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.orders.table.total' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.orders.table.created' | translate }}</th>
                  <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.orders.table.actions' | translate }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  *ngFor="let order of orders()"
                  class="border-t border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                >
                  <td class="px-3 py-2 font-medium text-slate-900 dark:text-slate-50">
                    {{ order.reference_code || (order.id | slice: 0:8) }}
                  </td>
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
                    {{ customerLabel(order) }}
                  </td>
                  <td class="px-3 py-2">
                    <span [ngClass]="statusPillClass(order.status)" class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold">
                      {{ ('adminUi.orders.' + order.status) | translate }}
                    </span>
                  </td>
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
                    {{ order.total_amount | localizedCurrency : order.currency }}
                  </td>
                  <td class="px-3 py-2 text-slate-600 dark:text-slate-300">
                    {{ order.created_at | date: 'short' }}
                  </td>
                  <td class="px-3 py-2 text-right">
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.orders.view' | translate"
                      (action)="open(order.id)"
                    ></app-button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div *ngIf="meta()" class="flex items-center justify-between gap-3 pt-2 text-sm text-slate-700 dark:text-slate-200">
            <div>
              {{ 'adminUi.orders.pagination' | translate: { page: meta()!.page, total_pages: meta()!.total_pages, total_items: meta()!.total_items } }}
            </div>
            <div class="flex items-center gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.orders.prev' | translate"
                [disabled]="meta()!.page <= 1"
                (action)="goToPage(meta()!.page - 1)"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.orders.next' | translate"
                [disabled]="meta()!.page >= meta()!.total_pages"
                (action)="goToPage(meta()!.page + 1)"
              ></app-button>
            </div>
          </div>
        </ng-template>
      </section>
    </div>
  `
})
export class AdminOrdersComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.admin', url: '/admin/dashboard' },
    { label: 'adminUi.orders.title' }
  ];

  loading = signal(true);
  error = signal<string | null>(null);
  orders = signal<AdminOrderListItem[]>([]);
  meta = signal<AdminOrderListResponse['meta'] | null>(null);

  q = '';
  status: OrderStatusFilter = 'all';
  fromDate = '';
  toDate = '';
  page = 1;
  limit = 20;

  constructor(
    private ordersApi: AdminOrdersService,
    private router: Router,
    private toast: ToastService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  applyFilters(): void {
    this.page = 1;
    this.load();
  }

  resetFilters(): void {
    this.q = '';
    this.status = 'all';
    this.fromDate = '';
    this.toDate = '';
    this.page = 1;
    this.load();
  }

  goToPage(page: number): void {
    this.page = page;
    this.load();
  }

  open(orderId: string): void {
    void this.router.navigate(['/admin/orders', orderId]);
  }

  downloadExport(): void {
    this.ordersApi.downloadExport().subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'orders.csv';
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.toast.error(this.translate.instant('adminUi.orders.errors.export'))
    });
  }

  customerLabel(order: AdminOrderListItem): string {
    const email = (order.customer_email ?? '').trim();
    const username = (order.customer_username ?? '').trim();
    if (email && username) return `${email} (${username})`;
    return email || username || this.translate.instant('adminUi.orders.guest');
  }

  statusPillClass(status: string): string {
    switch (status) {
      case 'paid':
        return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200';
      case 'shipped':
        return 'bg-indigo-100 text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-200';
      case 'cancelled':
        return 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100';
      case 'refunded':
        return 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200';
      default:
        return 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100';
    }
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);

    const params: Parameters<AdminOrdersService['search']>[0] = {
      page: this.page,
      limit: this.limit
    };
    const q = this.q.trim();
    if (q) params.q = q;
    if (this.status !== 'all') params.status = this.status;
    if (this.fromDate) params.from = `${this.fromDate}T00:00:00Z`;
    if (this.toDate) params.to = `${this.toDate}T23:59:59Z`;

    this.ordersApi.search(params).subscribe({
      next: (res) => {
        this.orders.set(res.items);
        this.meta.set(res.meta);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.translate.instant('adminUi.orders.errors.load'));
        this.loading.set(false);
      }
    });
  }
}
