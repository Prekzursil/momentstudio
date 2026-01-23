import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { from, of } from 'rxjs';
import { catchError, finalize, map, mergeMap, toArray } from 'rxjs/operators';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { ToastService } from '../../../core/toast.service';
import { LocalizedCurrencyPipe } from '../../../shared/localized-currency.pipe';
import { AdminOrderListItem, AdminOrderListResponse, AdminOrdersService } from '../../../core/admin-orders.service';
import { orderStatusChipClass } from '../../../shared/order-status';
import { AuthService } from '../../../core/auth.service';

type OrderStatusFilter =
  | 'all'
  | 'pending'
  | 'pending_payment'
  | 'pending_acceptance'
  | 'paid'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

type AdminOrdersFilterPreset = {
  id: string;
  name: string;
  createdAt: string;
  filters: {
    q: string;
    status: OrderStatusFilter;
    fromDate: string;
    toDate: string;
    limit: number;
  };
};

@Component({
  selector: 'app-admin-orders',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
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
	              <option value="pending_payment">{{ 'adminUi.orders.pending_payment' | translate }}</option>
	              <option value="pending_acceptance">{{ 'adminUi.orders.pending_acceptance' | translate }}</option>
	              <option value="paid">{{ 'adminUi.orders.paid' | translate }}</option>
	              <option value="shipped">{{ 'adminUi.orders.shipped' | translate }}</option>
	              <option value="delivered">{{ 'adminUi.orders.delivered' | translate }}</option>
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

          <div class="flex flex-wrap items-end justify-between gap-3">
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 w-full sm:w-auto">
              {{ 'adminUi.orders.presets.label' | translate }}
              <select
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 min-w-[220px]"
                [(ngModel)]="selectedPresetId"
                (ngModelChange)="applyPreset($event)"
              >
                <option value="">{{ 'adminUi.orders.presets.none' | translate }}</option>
                <option *ngFor="let preset of presets" [value]="preset.id">{{ preset.name }}</option>
              </select>
            </label>

            <div class="flex flex-wrap items-center gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.orders.presets.save' | translate"
                (action)="savePreset()"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.orders.presets.delete' | translate"
                [disabled]="!selectedPresetId"
                (action)="deletePreset()"
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

            <div
              *ngIf="selectedIds.size"
              class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200"
            >
              <div class="font-medium">
                {{ 'adminUi.orders.bulk.selected' | translate: { count: selectedIds.size } }}
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <label class="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.orders.bulk.status' | translate }}
                  <select
                    class="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="bulkStatus"
                    [disabled]="bulkBusy"
                  >
                    <option value="">{{ 'adminUi.orders.bulk.noChange' | translate }}</option>
                    <option value="pending_acceptance">{{ 'adminUi.orders.pending_acceptance' | translate }}</option>
                    <option value="paid">{{ 'adminUi.orders.paid' | translate }}</option>
                    <option value="shipped">{{ 'adminUi.orders.shipped' | translate }}</option>
                    <option value="delivered">{{ 'adminUi.orders.delivered' | translate }}</option>
                  </select>
                </label>

                <label class="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.orders.bulk.courier' | translate }}
                  <select
                    class="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="bulkCourier"
                    [disabled]="bulkBusy"
                  >
                    <option value="">{{ 'adminUi.orders.bulk.noChange' | translate }}</option>
                    <option value="sameday">{{ 'checkout.courierSameday' | translate }}</option>
                    <option value="fan_courier">{{ 'checkout.courierFanCourier' | translate }}</option>
                    <option value="clear">{{ 'adminUi.orders.bulk.clearCourier' | translate }}</option>
                  </select>
                </label>

                <app-button
                  size="sm"
                  [label]="'adminUi.orders.bulk.apply' | translate"
                  [disabled]="bulkBusy || (!bulkStatus && !bulkCourier)"
                  (action)="applyBulkUpdate()"
                ></app-button>

                <span class="hidden sm:block h-9 w-px bg-slate-200 dark:bg-slate-800"></span>

                <label class="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.orders.bulk.email' | translate }}
                  <select
                    class="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="bulkEmailKind"
                    [disabled]="bulkBusy"
                  >
                    <option value="">{{ 'adminUi.orders.bulk.noChange' | translate }}</option>
                    <option value="confirmation">{{ 'adminUi.orders.bulk.emailConfirmation' | translate }}</option>
                    <option value="delivery">{{ 'adminUi.orders.bulk.emailDelivery' | translate }}</option>
                  </select>
                </label>

                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.orders.bulk.sendEmails' | translate"
                  [disabled]="bulkBusy || !bulkEmailKind"
                  (action)="resendBulkEmails()"
                ></app-button>

                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.orders.bulk.packingSlips' | translate"
                  [disabled]="bulkBusy"
                  (action)="downloadBatchPackingSlips()"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.orders.bulk.clearSelection' | translate"
                  [disabled]="bulkBusy"
                  (action)="clearSelection()"
                ></app-button>
              </div>
            </div>

	          <div *ngIf="orders().length > 0" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
	            <table class="min-w-[920px] w-full text-sm">
	              <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
	                <tr>
                    <th class="text-left font-semibold px-3 py-2">
                      <input
                        type="checkbox"
                        [checked]="allSelectedOnPage()"
                        [indeterminate]="someSelectedOnPage()"
                        (change)="toggleSelectAllOnPage($any($event.target).checked)"
                        [disabled]="bulkBusy"
                      />
                    </th>
	                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.orders.table.reference' | translate }}</th>
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
                    <td class="px-3 py-2">
                      <input
                        type="checkbox"
                        [checked]="selectedIds.has(order.id)"
                        (change)="toggleSelected(order.id, $any($event.target).checked)"
                        [disabled]="bulkBusy"
                      />
                    </td>
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

  presets: AdminOrdersFilterPreset[] = [];
  selectedPresetId = '';

  selectedIds = new Set<string>();
  bulkStatus: '' | Exclude<OrderStatusFilter, 'all'> = '';
  bulkCourier: '' | 'sameday' | 'fan_courier' | 'clear' = '';
  bulkEmailKind: '' | 'confirmation' | 'delivery' = '';
  bulkBusy = false;

  constructor(
    private ordersApi: AdminOrdersService,
    private router: Router,
    private toast: ToastService,
    private translate: TranslateService,
    private auth: AuthService
  ) {}

  ngOnInit(): void {
    this.presets = this.loadPresets();
    this.load();
  }

  applyFilters(): void {
    this.page = 1;
    this.selectedPresetId = '';
    this.clearSelection();
    this.load();
  }

  resetFilters(): void {
    this.q = '';
    this.status = 'all';
    this.fromDate = '';
    this.toDate = '';
    this.page = 1;
    this.selectedPresetId = '';
    this.clearSelection();
    this.load();
  }

  applyPreset(presetId: string): void {
    this.selectedPresetId = presetId;
    if (!presetId) return;
    const preset = this.presets.find((candidate) => candidate.id === presetId);
    if (!preset) return;

    this.q = preset.filters.q;
    this.status = preset.filters.status;
    this.fromDate = preset.filters.fromDate;
    this.toDate = preset.filters.toDate;
    this.limit = preset.filters.limit;
    this.page = 1;
    this.clearSelection();
    this.load();
  }

  savePreset(): void {
    const name = (window.prompt(this.translate.instant('adminUi.orders.presets.prompt')) ?? '').trim();
    if (!name) {
      this.toast.error(this.translate.instant('adminUi.orders.presets.errors.nameRequired'));
      return;
    }

    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const preset: AdminOrdersFilterPreset = {
      id,
      name,
      createdAt: new Date().toISOString(),
      filters: {
        q: this.q,
        status: this.status,
        fromDate: this.fromDate,
        toDate: this.toDate,
        limit: this.limit
      }
    };

    this.presets = [preset, ...this.presets].slice(0, 20);
    this.selectedPresetId = preset.id;
    this.persistPresets();
    this.toast.success(this.translate.instant('adminUi.orders.presets.success.saved'));
  }

  deletePreset(): void {
    const preset = this.presets.find((candidate) => candidate.id === this.selectedPresetId);
    if (!preset) return;
    const ok = window.confirm(
      this.translate.instant('adminUi.orders.presets.confirmDelete', {
        name: preset.name
      })
    );
    if (!ok) return;

    this.presets = this.presets.filter((candidate) => candidate.id !== preset.id);
    this.selectedPresetId = '';
    this.persistPresets();
    this.toast.success(this.translate.instant('adminUi.orders.presets.success.deleted'));
  }

  toggleSelected(orderId: string, selected: boolean): void {
    if (this.bulkBusy) return;
    if (selected) this.selectedIds.add(orderId);
    else this.selectedIds.delete(orderId);
  }

  toggleSelectAllOnPage(selected: boolean): void {
    if (this.bulkBusy) return;
    const ids = this.orders().map((order) => order.id);
    if (!ids.length) return;
    if (selected) ids.forEach((id) => this.selectedIds.add(id));
    else ids.forEach((id) => this.selectedIds.delete(id));
  }

  allSelectedOnPage(): boolean {
    const ids = this.orders().map((order) => order.id);
    return ids.length > 0 && ids.every((id) => this.selectedIds.has(id));
  }

  someSelectedOnPage(): boolean {
    const ids = this.orders().map((order) => order.id);
    if (!ids.length) return false;
    const any = ids.some((id) => this.selectedIds.has(id));
    return any && !this.allSelectedOnPage();
  }

  clearSelection(): void {
    this.selectedIds.clear();
  }

  applyBulkUpdate(): void {
    if (!this.selectedIds.size) return;
    if (!this.bulkStatus && !this.bulkCourier) {
      this.toast.error(this.translate.instant('adminUi.orders.bulk.errors.chooseAction'));
      return;
    }

    const payload: Parameters<AdminOrdersService['update']>[1] = {};
    if (this.bulkStatus) payload.status = this.bulkStatus;
    if (this.bulkCourier === 'clear') payload.courier = null;
    else if (this.bulkCourier) payload.courier = this.bulkCourier;

    const ids = Array.from(this.selectedIds);
    this.bulkBusy = true;
    from(ids)
      .pipe(
        mergeMap(
          (id) =>
            this.ordersApi.update(id, payload).pipe(
              map(() => ({ id, ok: true as const })),
              catchError(() => of({ id, ok: false as const }))
            ),
          3
        ),
        toArray(),
        finalize(() => {
          this.bulkBusy = false;
        })
      )
      .subscribe((results) => {
        const failed = results.filter((r) => !r.ok).map((r) => r.id);
        const successCount = results.length - failed.length;
        if (failed.length) {
          this.selectedIds = new Set(failed);
          this.toast.error(
            this.translate.instant('adminUi.orders.bulk.partial', {
              success: successCount,
              total: results.length
            })
          );
        } else {
          this.clearSelection();
          this.toast.success(this.translate.instant('adminUi.orders.bulk.success', { count: results.length }));
        }
        this.bulkStatus = '';
        this.bulkCourier = '';
        this.bulkEmailKind = '';
        this.load();
      });
  }

  resendBulkEmails(): void {
    if (!this.selectedIds.size) return;
    if (!this.bulkEmailKind) {
      this.toast.error(this.translate.instant('adminUi.orders.bulk.errors.chooseEmail'));
      return;
    }

    const notePrompt = this.translate.instant('adminUi.orders.bulk.emailNotePrompt');
    const noteRaw = window.prompt(notePrompt) ?? null;
    if (noteRaw === null) return;
    const note = noteRaw.trim() || null;

    const ids = Array.from(this.selectedIds);
    this.bulkBusy = true;
    from(ids)
      .pipe(
        mergeMap(
          (id) => {
            const req =
              this.bulkEmailKind === 'delivery'
                ? this.ordersApi.resendDeliveryEmail(id, note)
                : this.ordersApi.resendOrderConfirmationEmail(id, note);
            return req.pipe(
              map(() => ({ id, ok: true as const })),
              catchError(() => of({ id, ok: false as const }))
            );
          },
          3
        ),
        toArray(),
        finalize(() => {
          this.bulkBusy = false;
        })
      )
      .subscribe((results) => {
        const failed = results.filter((r) => !r.ok).map((r) => r.id);
        const successCount = results.length - failed.length;
        if (failed.length) {
          this.selectedIds = new Set(failed);
          this.toast.error(
            this.translate.instant('adminUi.orders.bulk.emailsPartial', {
              success: successCount,
              total: results.length
            })
          );
        } else {
          this.clearSelection();
          this.toast.success(this.translate.instant('adminUi.orders.bulk.emailsQueued', { count: results.length }));
        }
        this.bulkEmailKind = '';
      });
  }

  downloadBatchPackingSlips(): void {
    if (!this.selectedIds.size) return;
    const ids = Array.from(this.selectedIds);
    this.bulkBusy = true;
    this.ordersApi.downloadBatchPackingSlips(ids).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'packing-slips.pdf';
        a.click();
        URL.revokeObjectURL(url);
        this.toast.success(this.translate.instant('adminUi.orders.bulk.packingSlipsReady'));
        this.bulkBusy = false;
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.orders.bulk.errors.packingSlips'));
        this.bulkBusy = false;
      }
    });
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
    return orderStatusChipClass(status);
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

  private storageKey(): string {
    const userId = (this.auth.user()?.id ?? '').trim();
    return `admin.orders.filters.v1:${userId || 'anonymous'}`;
  }

  private loadPresets(): AdminOrdersFilterPreset[] {
    try {
      const raw = localStorage.getItem(this.storageKey());
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((candidate: any) => typeof candidate?.id === 'string' && typeof candidate?.name === 'string')
        .map((candidate: any) => ({
          id: String(candidate.id),
          name: String(candidate.name),
          createdAt: String(candidate.createdAt ?? ''),
          filters: {
            q: String(candidate?.filters?.q ?? ''),
            status: (candidate?.filters?.status ?? 'all') as OrderStatusFilter,
            fromDate: String(candidate?.filters?.fromDate ?? ''),
            toDate: String(candidate?.filters?.toDate ?? ''),
            limit:
              typeof candidate?.filters?.limit === 'number' && Number.isFinite(candidate.filters.limit)
                ? candidate.filters.limit
                : 20
          }
        })) as AdminOrdersFilterPreset[];
    } catch {
      return [];
    }
  }

  private persistPresets(): void {
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify(this.presets));
    } catch {
      // ignore
    }
  }
}
