import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { catchError, concatMap, from, map, of, toArray } from 'rxjs';
import { BreadcrumbComponent, Crumb } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { ModalComponent } from '../../../shared/modal.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import {
  AdminService,
  CartReservationItem,
  OrderReservationItem,
  RestockListItem,
  RestockListResponse,
  RestockNoteUpsert,
  StockAdjustmentReason
} from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';
import { extractRequestId } from '../../../shared/http-error';
import { AdminPageHeaderComponent } from '../shared/admin-page-header.component';

type RestockRow = RestockListItem & {
  draftSupplier: string;
  draftDesiredQuantity: string;
  draftNote: string;
  isDirty: boolean;
  isSaving: boolean;
};

@Component({
  selector: 'app-admin-inventory',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
    BreadcrumbComponent,
    ButtonComponent,
    ErrorStateComponent,
    ModalComponent,
    SkeletonComponent,
    AdminPageHeaderComponent
  ],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <app-admin-page-header [titleKey]="'adminUi.inventory.title'" [hintKey]="'adminUi.inventory.hint'">
        <ng-template #primaryActions>
          <app-button
            size="sm"
            [label]="'adminUi.inventory.export' | translate"
            (action)="exportCsv()"
            [disabled]="loading() || exporting"
          ></app-button>
          <app-button
            size="sm"
            variant="ghost"
            [label]="(piiReveal() ? 'adminUi.pii.hide' : 'adminUi.pii.reveal') | translate"
            (action)="togglePiiReveal()"
            [disabled]="loading()"
          ></app-button>
        </ng-template>
      </app-admin-page-header>

      <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
        <div class="grid gap-3 lg:grid-cols-[auto_auto_1fr] items-end">
          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            <span>{{ 'adminUi.inventory.filters.includeVariants' | translate }}</span>
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/40 dark:border-slate-600"
              [(ngModel)]="includeVariants"
            />
          </label>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            <span>{{ 'adminUi.inventory.filters.defaultThreshold' | translate }}</span>
            <input
              type="number"
              min="1"
              max="1000"
              class="h-10 w-40 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="defaultThreshold"
            />
          </label>

          <div class="flex items-center justify-end gap-2">
            <app-button
              size="sm"
              [label]="'adminUi.actions.refresh' | translate"
              (action)="applyFilters()"
              [disabled]="loading()"
            ></app-button>
          </div>
        </div>

        <div
          *ngIf="selected.size > 0"
          class="rounded-xl border border-slate-200 bg-slate-50 p-3 grid gap-3 dark:border-slate-800 dark:bg-slate-950/20"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
              {{ 'adminUi.inventory.bulkAdjust.selected' | translate: { count: selected.size } }}
            </p>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'adminUi.inventory.bulkAdjust.clearSelection' | translate"
              (action)="clearSelection()"
              [disabled]="bulkAdjustBusy()"
            ></app-button>
          </div>

          <div class="grid gap-3 lg:grid-cols-[220px_180px_1fr_auto] items-end">
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'adminUi.inventory.bulkAdjust.reason' | translate }}
              <select
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="bulkAdjustReason"
                [disabled]="bulkAdjustBusy()"
              >
                <option [ngValue]="'restock'">{{ 'adminUi.products.form.stockReason.restock' | translate }}</option>
                <option [ngValue]="'damage'">{{ 'adminUi.products.form.stockReason.damage' | translate }}</option>
                <option [ngValue]="'manual_correction'">{{ 'adminUi.products.form.stockReason.manual_correction' | translate }}</option>
              </select>
            </label>

            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'adminUi.inventory.bulkAdjust.delta' | translate }}
              <input
                type="number"
                step="1"
                class="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="bulkAdjustDelta"
                [disabled]="bulkAdjustBusy()"
                placeholder="+5"
              />
            </label>

            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'adminUi.inventory.bulkAdjust.note' | translate }}
              <textarea
                class="min-h-[2.5rem] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="bulkAdjustNote"
                [disabled]="bulkAdjustBusy()"
                rows="2"
                placeholder="—"
              ></textarea>
            </label>

            <app-button
              size="sm"
              [label]="bulkAdjustBusy() ? ('adminUi.inventory.bulkAdjust.applying' | translate) : ('adminUi.inventory.bulkAdjust.apply' | translate)"
              (action)="applyBulkStockAdjustment()"
              [disabled]="bulkAdjustBusy()"
            ></app-button>
          </div>

          <div
            *ngIf="bulkAdjustError()"
            class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-2 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
          >
            {{ bulkAdjustError() }}
          </div>
        </div>

        <app-error-state
          *ngIf="error()"
          [message]="error()!"
          [requestId]="errorRequestId()"
          [showRetry]="true"
          (retry)="retryLoad()"
        ></app-error-state>

        <ng-container *ngIf="loading(); else tableTpl">
          <div class="grid gap-2">
            <app-skeleton height="2.5rem"></app-skeleton>
            <app-skeleton height="2.5rem"></app-skeleton>
            <app-skeleton height="2.5rem"></app-skeleton>
            <app-skeleton height="2.5rem"></app-skeleton>
          </div>
        </ng-container>

        <ng-template #tableTpl>
          <div *ngIf="!rows().length" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'adminUi.inventory.empty' | translate }}
          </div>

          <div *ngIf="rows().length" class="overflow-x-auto">
            <table class="min-w-[1400px] w-full text-sm">
              <thead class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <tr>
                  <th class="text-left py-2 pr-4 w-10">
                    <input
                      type="checkbox"
                      class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/40 dark:border-slate-600"
                      [checked]="allSelectedOnPage()"
                      (change)="toggleSelectAll($event)"
                      [disabled]="bulkAdjustBusy()"
                      [attr.aria-label]="'adminUi.inventory.bulkAdjust.selectAll' | translate"
                    />
                  </th>
                  <th class="text-left py-2 pr-4">{{ 'adminUi.inventory.table.item' | translate }}</th>
                  <th class="text-right py-2 pr-4">{{ 'adminUi.inventory.table.stock' | translate }}</th>
                  <th class="text-right py-2 pr-4">{{ 'adminUi.inventory.table.reservedCarts' | translate }}</th>
                  <th class="text-right py-2 pr-4">{{ 'adminUi.inventory.table.reservedOrders' | translate }}</th>
                  <th class="text-right py-2 pr-4">{{ 'adminUi.inventory.table.available' | translate }}</th>
                  <th class="text-right py-2 pr-4">{{ 'adminUi.inventory.table.threshold' | translate }}</th>
                  <th class="text-left py-2 pr-4">{{ 'adminUi.inventory.table.supplier' | translate }}</th>
                  <th class="text-right py-2 pr-4">{{ 'adminUi.inventory.table.desiredQty' | translate }}</th>
                  <th class="text-left py-2 pr-4">{{ 'adminUi.inventory.table.note' | translate }}</th>
                  <th class="text-left py-2 pr-4">{{ 'adminUi.inventory.table.updated' | translate }}</th>
                  <th class="text-right py-2">{{ 'adminUi.inventory.table.actions' | translate }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200 dark:divide-slate-800/70">
                <tr *ngFor="let row of rows(); trackBy: trackByKey" [class.bg-rose-50]="row.is_critical" class="align-top">
                  <td class="py-3 pr-4">
                    <input
                      type="checkbox"
                      class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/40 dark:border-slate-600"
                      [checked]="isSelected(row)"
                      (change)="toggleSelectRow(row, $event)"
                      [disabled]="bulkAdjustBusy()"
                      [attr.aria-label]="'adminUi.inventory.bulkAdjust.selectRow' | translate"
                    />
                  </td>
                  <td class="py-3 pr-4">
                    <div class="font-semibold text-slate-900 dark:text-slate-50">
                      {{ row.product_name }}
                      <span *ngIf="row.variant_name" class="font-normal text-slate-600 dark:text-slate-300">— {{ row.variant_name }}</span>
                    </div>
                    <div class="text-xs text-slate-500 dark:text-slate-400">
                      <span class="font-mono">{{ row.sku }}</span>
                      <span class="px-2">·</span>
                      <span class="font-mono">{{ row.product_slug }}</span>
                      <span *ngIf="row.kind === 'variant'" class="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {{ row.kind }}
                      </span>
                    </div>
                  </td>
                  <td class="py-3 pr-4 text-right font-semibold text-slate-900 dark:text-slate-50">{{ row.stock_quantity }}</td>
                  <td class="py-3 pr-4 text-right text-slate-700 dark:text-slate-200">
                    <button
                      *ngIf="row.reserved_in_carts > 0; else cartsPlain"
                      type="button"
                      class="font-semibold underline decoration-dotted underline-offset-2 hover:text-slate-900 dark:hover:text-slate-50"
                      (click)="openReservations(row, 'carts')"
                      [disabled]="reservationsLoading()"
                      [attr.aria-label]="'adminUi.inventory.reservations.openCartsAria' | translate"
                    >
                      {{ row.reserved_in_carts }}
                    </button>
                    <ng-template #cartsPlain>{{ row.reserved_in_carts }}</ng-template>
                  </td>
                  <td class="py-3 pr-4 text-right text-slate-700 dark:text-slate-200">
                    <button
                      *ngIf="row.reserved_in_orders > 0; else ordersPlain"
                      type="button"
                      class="font-semibold underline decoration-dotted underline-offset-2 hover:text-slate-900 dark:hover:text-slate-50"
                      (click)="openReservations(row, 'orders')"
                      [disabled]="reservationsLoading()"
                      [attr.aria-label]="'adminUi.inventory.reservations.openOrdersAria' | translate"
                    >
                      {{ row.reserved_in_orders }}
                    </button>
                    <ng-template #ordersPlain>{{ row.reserved_in_orders }}</ng-template>
                  </td>
                  <td
                    class="py-3 pr-4 text-right font-semibold"
                    [class.text-rose-700]="row.is_critical || row.available_quantity <= 0"
                    [class.text-slate-900]="!row.is_critical && row.available_quantity > 0"
                    [class.dark:text-rose-200]="row.is_critical || row.available_quantity <= 0"
                    [class.dark:text-slate-50]="!row.is_critical && row.available_quantity > 0"
                  >
                    {{ row.available_quantity }}
                  </td>
                  <td class="py-3 pr-4 text-right text-slate-700 dark:text-slate-200">{{ row.threshold }}</td>
                  <td class="py-3 pr-4">
                    <input
                      class="h-9 w-44 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [(ngModel)]="row.draftSupplier"
                      (ngModelChange)="row.isDirty = true"
                      placeholder="—"
                    />
                  </td>
                  <td class="py-3 pr-4 text-right">
                    <input
                      class="h-9 w-24 rounded-lg border border-slate-200 bg-white px-3 text-sm text-right text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [(ngModel)]="row.draftDesiredQuantity"
                      (ngModelChange)="row.isDirty = true"
                      inputmode="numeric"
                      placeholder="—"
                    />
                  </td>
                  <td class="py-3 pr-4">
                    <textarea
                      class="min-h-[2.25rem] w-80 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [(ngModel)]="row.draftNote"
                      (ngModelChange)="row.isDirty = true"
                      rows="2"
                      placeholder="—"
                    ></textarea>
                  </td>
                  <td class="py-3 pr-4 text-xs text-slate-500 dark:text-slate-400">
                    {{ row.note_updated_at ? (row.note_updated_at | date: 'short') : '—' }}
                  </td>
                  <td class="py-3 text-right">
                    <div class="flex flex-col items-end gap-2">
                      <app-button
                        size="sm"
                        variant="ghost"
                        [label]="'adminUi.actions.open' | translate"
                        (action)="openProduct(row)"
                      ></app-button>
                      <app-button
                        size="sm"
                        [label]="row.isSaving ? ('adminUi.inventory.actions.saving' | translate) : ('adminUi.actions.save' | translate)"
                        (action)="saveNote(row)"
                        [disabled]="row.isSaving || !row.isDirty"
                      ></app-button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div *ngIf="meta()" class="flex items-center justify-between gap-4 pt-3 text-sm">
            <div class="text-slate-600 dark:text-slate-300">
              {{ meta()!.page }} / {{ meta()!.total_pages }} · {{ meta()!.total_items }}
            </div>
            <div class="flex items-center gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.actions.prev' | translate"
                (action)="goToPage(page - 1)"
                [disabled]="loading() || page <= 1"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.actions.next' | translate"
                (action)="goToPage(page + 1)"
                [disabled]="loading() || page >= meta()!.total_pages"
              ></app-button>
            </div>
          </div>
        </ng-template>
      </section>

      <app-modal
        [open]="reservationsOpen()"
        [title]="(reservationTitleKey() | translate)"
        [subtitle]="reservationSubtitle()"
        [showActions]="false"
        [closeLabel]="'adminUi.common.close' | translate"
        (closed)="closeReservations()"
      >
        <ng-container *ngIf="reservationsLoading()">
          <div class="grid gap-2">
            <app-skeleton height="2.5rem"></app-skeleton>
            <app-skeleton height="2.5rem"></app-skeleton>
            <app-skeleton height="2.5rem"></app-skeleton>
          </div>
        </ng-container>

        <div
          *ngIf="!reservationsLoading() && reservationsError()"
          class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
        >
          {{ reservationsError() }}
        </div>

        <ng-container *ngIf="!reservationsLoading() && !reservationsError()">
          <ng-container *ngIf="reservationsKind() === 'carts'">
            <p *ngIf="reservationsCutoff()" class="text-xs text-slate-500 dark:text-slate-400">
              {{ 'adminUi.inventory.reservations.cutoff' | translate: { cutoff: (reservationsCutoff() | date: 'short') } }}
            </p>

            <div *ngIf="reservationsCarts().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.inventory.reservations.emptyCarts' | translate }}
            </div>

            <div *ngIf="reservationsCarts().length > 0" class="overflow-x-auto">
              <table class="min-w-[560px] w-full text-sm">
                <thead class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <tr>
                    <th class="text-left py-2 pr-4">{{ 'adminUi.inventory.reservations.table.id' | translate }}</th>
                    <th class="text-left py-2 pr-4">{{ 'adminUi.inventory.reservations.table.updated' | translate }}</th>
                    <th class="text-left py-2 pr-4">{{ 'adminUi.inventory.reservations.table.customer' | translate }}</th>
                    <th class="text-right py-2">{{ 'adminUi.inventory.reservations.table.qty' | translate }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200 dark:divide-slate-800/70">
                  <tr *ngFor="let item of reservationsCarts()">
                    <td class="py-2 pr-4 font-mono text-xs text-slate-700 dark:text-slate-200">{{ item.cart_id }}</td>
                    <td class="py-2 pr-4 text-slate-700 dark:text-slate-200">{{ item.updated_at | date: 'short' }}</td>
                    <td class="py-2 pr-4 text-slate-700 dark:text-slate-200">{{ item.customer_email || ('adminUi.orders.guest' | translate) }}</td>
                    <td class="py-2 text-right font-semibold text-slate-900 dark:text-slate-50">{{ item.quantity }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </ng-container>

          <ng-container *ngIf="reservationsKind() === 'orders'">
            <div *ngIf="reservationsOrders().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.inventory.reservations.emptyOrders' | translate }}
            </div>

            <div *ngIf="reservationsOrders().length > 0" class="overflow-x-auto">
              <table class="min-w-[720px] w-full text-sm">
                <thead class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <tr>
                    <th class="text-left py-2 pr-4">{{ 'adminUi.inventory.reservations.table.id' | translate }}</th>
                    <th class="text-left py-2 pr-4">{{ 'adminUi.inventory.reservations.table.created' | translate }}</th>
                    <th class="text-left py-2 pr-4">{{ 'adminUi.inventory.reservations.table.customer' | translate }}</th>
                    <th class="text-left py-2 pr-4">{{ 'adminUi.inventory.reservations.table.status' | translate }}</th>
                    <th class="text-right py-2 pr-4">{{ 'adminUi.inventory.reservations.table.qty' | translate }}</th>
                    <th class="text-right py-2">{{ 'adminUi.inventory.reservations.table.actions' | translate }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200 dark:divide-slate-800/70">
                  <tr *ngFor="let item of reservationsOrders()">
                    <td class="py-2 pr-4 font-mono text-xs text-slate-700 dark:text-slate-200">
                      {{ item.reference_code || item.order_id }}
                    </td>
                    <td class="py-2 pr-4 text-slate-700 dark:text-slate-200">{{ item.created_at | date: 'short' }}</td>
                    <td class="py-2 pr-4 text-slate-700 dark:text-slate-200">{{ item.customer_email || ('adminUi.orders.guest' | translate) }}</td>
                    <td class="py-2 pr-4 text-slate-700 dark:text-slate-200">{{ ('adminUi.orders.' + item.status) | translate }}</td>
                    <td class="py-2 pr-4 text-right font-semibold text-slate-900 dark:text-slate-50">{{ item.quantity }}</td>
                    <td class="py-2 text-right">
                      <app-button size="sm" variant="ghost" [label]="'adminUi.actions.open' | translate" (action)="openOrder(item.order_id)"></app-button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </ng-container>
        </ng-container>
      </app-modal>
    </div>
  `
})
export class AdminInventoryComponent implements OnInit {
  readonly crumbs: Crumb[] = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.admin', url: '/admin/dashboard' },
    { label: 'adminUi.inventory.title' }
  ];

  loading = signal(true);
  error = signal<string | null>(null);
  errorRequestId = signal<string | null>(null);
  rows = signal<RestockRow[]>([]);
  meta = signal<RestockListResponse['meta'] | null>(null);

  includeVariants = true;
  defaultThreshold = 5;
  page = 1;
  limit = 50;
  exporting = false;

  piiReveal = signal(false);

  reservationsOpen = signal(false);
  reservationsKind = signal<'carts' | 'orders' | null>(null);
  reservationsLoading = signal(false);
  reservationsError = signal<string | null>(null);
  reservationsCutoff = signal<string | null>(null);
  reservationsCarts = signal<CartReservationItem[]>([]);
  reservationsOrders = signal<OrderReservationItem[]>([]);
  reservationsTarget = signal<{
    product_id: string;
    variant_id?: string;
    sku: string;
    product_name: string;
    variant_name?: string | null;
  } | null>(null);

  selected = new Set<string>();
  bulkAdjustBusy = signal(false);
  bulkAdjustError = signal<string | null>(null);
  bulkAdjustReason: StockAdjustmentReason = 'manual_correction';
  bulkAdjustDelta = '';
  bulkAdjustNote = '';

  constructor(
    private admin: AdminService,
    private toast: ToastService,
    private translate: TranslateService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.load();
  }

  trackByKey = (_: number, row: RestockRow) => `${row.kind}:${row.variant_id || row.product_id}`;

  private rowKey(row: RestockRow): string {
    return `${row.kind}:${row.variant_id || row.product_id}`;
  }

  isSelected(row: RestockRow): boolean {
    return this.selected.has(this.rowKey(row));
  }

  allSelectedOnPage(): boolean {
    const rows = this.rows();
    if (!rows.length) return false;
    return rows.every((row) => this.selected.has(this.rowKey(row)));
  }

  toggleSelectRow(row: RestockRow, event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const checked = Boolean(target?.checked);
    const key = this.rowKey(row);
    if (checked) this.selected.add(key);
    else this.selected.delete(key);
  }

  toggleSelectAll(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const checked = Boolean(target?.checked);
    const rows = this.rows();
    if (!checked) {
      for (const row of rows) this.selected.delete(this.rowKey(row));
      return;
    }
    for (const row of rows) this.selected.add(this.rowKey(row));
  }

  clearSelection(): void {
    this.selected.clear();
  }

  applyBulkStockAdjustment(): void {
    if (this.bulkAdjustBusy()) return;
    this.bulkAdjustError.set(null);

    const deltaRaw = String(this.bulkAdjustDelta ?? '').trim();
    const deltaParsed = Number(deltaRaw);
    if (!Number.isInteger(deltaParsed) || deltaParsed === 0) {
      this.bulkAdjustError.set(this.translate.instant('adminUi.inventory.bulkAdjust.errors.deltaInvalid'));
      return;
    }

    const note = (this.bulkAdjustNote || '').trim();
    if (!note) {
      this.bulkAdjustError.set(this.translate.instant('adminUi.inventory.bulkAdjust.errors.noteRequired'));
      return;
    }

    const selectedRows = this.rows().filter((row) => this.selected.has(this.rowKey(row)));
    if (!selectedRows.length) return;

    this.bulkAdjustBusy.set(true);

    from(selectedRows)
      .pipe(
        concatMap((row) =>
          this.admin
            .applyStockAdjustment({
              product_id: row.product_id,
              variant_id: row.kind === 'variant' ? row.variant_id : null,
              delta: deltaParsed,
              reason: this.bulkAdjustReason,
              note
            })
            .pipe(
              map(() => ({ ok: true })),
              catchError((err) => of({ ok: false, err }))
            )
        ),
        toArray()
      )
      .subscribe({
        next: (results) => {
          const okCount = results.filter((r) => r.ok).length;
          const failed = results.filter((r) => !r.ok);
          if (okCount) {
            this.toast.success(this.translate.instant('adminUi.inventory.bulkAdjust.success.applied', { count: okCount }));
          }
          if (failed.length) {
            this.bulkAdjustError.set(this.translate.instant('adminUi.inventory.bulkAdjust.errors.failed'));
            this.toast.error(this.translate.instant('adminUi.inventory.bulkAdjust.errors.failed'));
          }
          this.bulkAdjustBusy.set(false);
          this.bulkAdjustDelta = '';
          this.bulkAdjustNote = '';
          this.selected.clear();
          this.load();
        },
        error: () => {
          this.bulkAdjustBusy.set(false);
          this.bulkAdjustError.set(this.translate.instant('adminUi.inventory.bulkAdjust.errors.failed'));
        }
      });
  }

  applyFilters(): void {
    this.page = 1;
    this.load();
  }

  goToPage(page: number): void {
    this.page = Math.max(1, page);
    this.load();
  }

  openProduct(row: RestockRow): void {
    void this.router.navigate(['/admin/products'], { state: { editProductSlug: row.product_slug } });
  }

  togglePiiReveal(): void {
    this.piiReveal.set(!this.piiReveal());
    if (!this.reservationsOpen()) return;
    this.reloadReservations();
  }

  reservationTitleKey(): string {
    const kind = this.reservationsKind();
    if (kind === 'carts') return 'adminUi.inventory.reservations.cartsTitle';
    if (kind === 'orders') return 'adminUi.inventory.reservations.ordersTitle';
    return 'adminUi.inventory.title';
  }

  reservationSubtitle(): string {
    const target = this.reservationsTarget();
    if (!target) return '';
    const name = target.variant_name ? `${target.product_name} — ${target.variant_name}` : target.product_name;
    return `${name} · ${target.sku}`;
  }

  openReservations(row: RestockRow, kind: 'carts' | 'orders'): void {
    if (this.reservationsLoading()) return;
    this.reservationsOpen.set(true);
    this.reservationsKind.set(kind);
    this.reservationsTarget.set({
      product_id: row.product_id,
      variant_id: row.kind === 'variant' ? (row.variant_id ?? undefined) : undefined,
      sku: row.sku,
      product_name: row.product_name,
      variant_name: row.variant_name ?? null
    });
    this.reloadReservations();
  }

  closeReservations(): void {
    this.reservationsOpen.set(false);
    this.reservationsKind.set(null);
    this.reservationsTarget.set(null);
    this.reservationsError.set(null);
    this.reservationsCutoff.set(null);
    this.reservationsCarts.set([]);
    this.reservationsOrders.set([]);
  }

  openOrder(orderId: string): void {
    void this.router.navigate(['/admin/orders', orderId]);
  }

  exportCsv(): void {
    if (this.exporting) return;
    this.exporting = true;
    this.admin
      .exportRestockListCsv({
        include_variants: this.includeVariants,
        default_threshold: this.defaultThreshold
      })
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'restock-list.csv';
          a.click();
          URL.revokeObjectURL(url);
          this.toast.success(this.translate.instant('adminUi.inventory.exportReady'));
          this.exporting = false;
        },
        error: () => {
          this.toast.error(this.translate.instant('adminUi.inventory.errors.export'));
          this.exporting = false;
        }
      });
  }

  saveNote(row: RestockRow): void {
    if (row.isSaving || !row.isDirty) return;
    row.isSaving = true;

    const supplier = row.draftSupplier.trim();
    const note = row.draftNote.trim();
    const desiredQty = row.draftDesiredQuantity.trim();
    const desiredQuantity = desiredQty ? Number.parseInt(desiredQty, 10) : NaN;

    const payload: RestockNoteUpsert = {
      product_id: row.product_id,
      variant_id: row.variant_id || null,
      supplier: supplier ? supplier : null,
      desired_quantity: Number.isFinite(desiredQuantity) ? Math.max(0, desiredQuantity) : null,
      note: note ? note : null
    };

    this.admin.upsertRestockNote(payload).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('adminUi.inventory.success.noteSaved'));
        row.isSaving = false;
        row.isDirty = false;
        this.load();
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.inventory.errors.noteSave'));
        row.isSaving = false;
      }
    });
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.errorRequestId.set(null);

    this.admin
      .restockList({
        page: this.page,
        limit: this.limit,
        include_variants: this.includeVariants,
        default_threshold: this.defaultThreshold
      })
      .subscribe({
        next: (resp) => {
          const mapped = (resp.items || []).map((item) => ({
            ...item,
            draftSupplier: item.supplier || '',
            draftDesiredQuantity: item.desired_quantity !== null && item.desired_quantity !== undefined ? String(item.desired_quantity) : '',
            draftNote: item.note || '',
            isDirty: false,
            isSaving: false
          }));
          this.rows.set(mapped);
          this.pruneSelection(mapped);
          this.meta.set(resp.meta || null);
          this.page = resp.meta?.page ?? this.page;
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(this.translate.instant('adminUi.errors.generic'));
          this.errorRequestId.set(extractRequestId(err));
          this.rows.set([]);
          this.meta.set(null);
          this.loading.set(false);
        }
      });
  }

  private pruneSelection(rows: RestockRow[]): void {
    if (!this.selected.size) return;
    const present = new Set(rows.map((row) => this.rowKey(row)));
    for (const key of Array.from(this.selected)) {
      if (!present.has(key)) this.selected.delete(key);
    }
  }

  private reloadReservations(): void {
    const kind = this.reservationsKind();
    const target = this.reservationsTarget();
    if (!kind || !target) return;

    this.reservationsLoading.set(true);
    this.reservationsError.set(null);
    this.reservationsCutoff.set(null);
    this.reservationsCarts.set([]);
    this.reservationsOrders.set([]);

    const baseParams = {
      product_id: target.product_id,
      variant_id: target.variant_id,
      include_pii: this.piiReveal() ? true : undefined
    };

    if (kind === 'carts') {
      this.admin.reservedCarts(baseParams).subscribe({
        next: (res) => {
          this.reservationsCutoff.set(res.cutoff || null);
          this.reservationsCarts.set(res.items || []);
          this.reservationsLoading.set(false);
        },
        error: (err) => {
          if (err?.status === 403 && this.piiReveal()) {
            this.piiReveal.set(false);
            this.toast.error(this.translate.instant('adminUi.pii.notAuthorized'));
            this.reloadReservations();
            return;
          }
          this.reservationsError.set(this.translate.instant('adminUi.errors.generic'));
          this.reservationsLoading.set(false);
        }
      });
      return;
    }

    this.admin.reservedOrders(baseParams).subscribe({
      next: (res) => {
        this.reservationsOrders.set(res.items || []);
        this.reservationsLoading.set(false);
      },
      error: (err) => {
        if (err?.status === 403 && this.piiReveal()) {
          this.piiReveal.set(false);
          this.toast.error(this.translate.instant('adminUi.pii.notAuthorized'));
          this.reloadReservations();
          return;
        }
        this.reservationsError.set(this.translate.instant('adminUi.errors.generic'));
        this.reservationsLoading.set(false);
      }
    });
  }

  retryLoad(): void {
    this.load();
  }
}
