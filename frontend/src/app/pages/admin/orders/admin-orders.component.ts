import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { from, of } from 'rxjs';
import { catchError, finalize, map, mergeMap, toArray } from 'rxjs/operators';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { extractRequestId } from '../../../shared/http-error';
import { InputComponent } from '../../../shared/input.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { ToastService } from '../../../core/toast.service';
import { LocalizedCurrencyPipe } from '../../../shared/localized-currency.pipe';
import { AdminOrderListItem, AdminOrderListResponse, AdminOrdersService } from '../../../core/admin-orders.service';
import { orderStatusChipClass } from '../../../shared/order-status';
import { AuthService } from '../../../core/auth.service';
import {
  AdminTableLayoutV1,
  adminTableCellPaddingClass,
  adminTableLayoutStorageKey,
  defaultAdminTableLayout,
  loadAdminTableLayout,
  saveAdminTableLayout,
  visibleAdminTableColumnIds
} from '../shared/admin-table-layout';
import { AdminTableLayoutColumnDef, TableLayoutModalComponent } from '../shared/table-layout-modal.component';

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
    tag: string;
    fromDate: string;
    toDate: string;
    limit: number;
  };
};

type AdminOrdersExportTemplate = {
  id: string;
  name: string;
  createdAt: string;
  columns: string[];
};

const ORDERS_TABLE_COLUMNS: AdminTableLayoutColumnDef[] = [
  { id: 'select', labelKey: 'adminUi.orders.table.select', required: true },
  { id: 'reference', labelKey: 'adminUi.orders.table.reference', required: true },
  { id: 'customer', labelKey: 'adminUi.orders.table.customer' },
  { id: 'status', labelKey: 'adminUi.orders.table.status' },
  { id: 'tags', labelKey: 'adminUi.orders.table.tags' },
  { id: 'total', labelKey: 'adminUi.orders.table.total' },
  { id: 'created', labelKey: 'adminUi.orders.table.created' },
  { id: 'actions', labelKey: 'adminUi.orders.table.actions', required: true }
];

@Component({
  selector: 'app-admin-orders',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ScrollingModule,
    TranslateModule,
    BreadcrumbComponent,
    ButtonComponent,
    ErrorStateComponent,
    InputComponent,
    SkeletonComponent,
    LocalizedCurrencyPipe,
    TableLayoutModalComponent
  ],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

        <div class="flex items-start justify-between gap-4">
          <div class="grid gap-1">
          <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.orders.title' | translate }}</h1>
          <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.orders.hint' | translate }}</p>
        </div>
        <div class="flex items-center gap-2">
          <app-button size="sm" variant="ghost" [label]="'adminUi.orders.export' | translate" (action)="openExportModal()"></app-button>
          <app-button size="sm" variant="ghost" [label]="densityToggleLabelKey() | translate" (action)="toggleDensity()"></app-button>
          <app-button size="sm" variant="ghost" [label]="'adminUi.tableLayout.title' | translate" (action)="openLayoutModal()"></app-button>
        </div>
      </div>

      <app-table-layout-modal
        [open]="layoutModalOpen()"
        [columns]="tableColumns"
        [layout]="tableLayout()"
        (closed)="closeLayoutModal()"
        (applied)="applyTableLayout($event)"
      ></app-table-layout-modal>

      <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
	        <div class="grid gap-3 lg:grid-cols-[1fr_220px_220px_220px_220px_auto] items-end">
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
            {{ 'adminUi.orders.tagFilter' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="tag"
            >
              <option value="">{{ 'adminUi.orders.tags.all' | translate }}</option>
              <option *ngFor="let tagOption of tagOptions()" [value]="tagOption">{{ tagLabel(tagOption) }}</option>
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

	        <app-error-state
            *ngIf="error()"
            [message]="error()!"
            [requestId]="errorRequestId()"
            [showRetry]="true"
            (retry)="retryLoad()"
          ></app-error-state>

        <div *ngIf="loading(); else tableTpl">
          <app-skeleton [rows]="8"></app-skeleton>
        </div>
	        <ng-template #tableTpl>
	          <div *ngIf="orders().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
	            {{ 'adminUi.orders.empty' | translate }}
	          </div>

            <div
              *ngIf="selectedIds.size"
              id="admin-orders-bulk-actions"
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
            <ng-template #ordersTableHeader>
              <tr>
                <ng-container *ngFor="let colId of visibleColumnIds(); trackBy: trackColumnId" [ngSwitch]="colId">
                  <th *ngSwitchCase="'select'" class="text-left font-semibold w-10" [ngClass]="cellPaddingClass()">
                    <input
                      type="checkbox"
                      [checked]="allSelectedOnPage()"
                      [indeterminate]="someSelectedOnPage()"
                      (change)="toggleSelectAllOnPage($any($event.target).checked)"
                      [disabled]="bulkBusy"
                      aria-label="Select all orders on page"
                    />
                  </th>
                  <th *ngSwitchCase="'reference'" class="text-left font-semibold" [ngClass]="cellPaddingClass()">
                    {{ 'adminUi.orders.table.reference' | translate }}
                  </th>
                  <th *ngSwitchCase="'customer'" class="text-left font-semibold" [ngClass]="cellPaddingClass()">
                    {{ 'adminUi.orders.table.customer' | translate }}
                  </th>
                  <th *ngSwitchCase="'status'" class="text-left font-semibold" [ngClass]="cellPaddingClass()">
                    {{ 'adminUi.orders.table.status' | translate }}
                  </th>
                  <th *ngSwitchCase="'tags'" class="text-left font-semibold" [ngClass]="cellPaddingClass()">
                    {{ 'adminUi.orders.table.tags' | translate }}
                  </th>
                  <th *ngSwitchCase="'total'" class="text-left font-semibold" [ngClass]="cellPaddingClass()">
                    {{ 'adminUi.orders.table.total' | translate }}
                  </th>
                  <th *ngSwitchCase="'created'" class="text-left font-semibold" [ngClass]="cellPaddingClass()">
                    {{ 'adminUi.orders.table.created' | translate }}
                  </th>
                  <th *ngSwitchCase="'actions'" class="text-right font-semibold" [ngClass]="cellPaddingClass()">
                    {{ 'adminUi.orders.table.actions' | translate }}
                  </th>
                </ng-container>
              </tr>
            </ng-template>

            <ng-template #ordersTableRow let-order>
              <tr class="border-t border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
                <ng-container *ngFor="let colId of visibleColumnIds(); trackBy: trackColumnId" [ngSwitch]="colId">
                  <td *ngSwitchCase="'select'" [ngClass]="cellPaddingClass()">
                    <input
                      type="checkbox"
                      [checked]="selectedIds.has(order.id)"
                      (change)="toggleSelected(order.id, $any($event.target).checked)"
                      [disabled]="bulkBusy"
                      [attr.aria-label]="'Select order ' + (order.reference_code || (order.id | slice: 0:8))"
                    />
                  </td>
                  <td
                    *ngSwitchCase="'reference'"
                    class="font-medium text-slate-900 dark:text-slate-50"
                    [ngClass]="cellPaddingClass()"
                  >
                    {{ order.reference_code || (order.id | slice: 0:8) }}
                  </td>
                  <td *ngSwitchCase="'customer'" class="text-slate-700 dark:text-slate-200" [ngClass]="cellPaddingClass()">
                    {{ customerLabel(order) }}
                  </td>
                  <td *ngSwitchCase="'status'" [ngClass]="cellPaddingClass()">
                    <span [ngClass]="statusPillClass(order.status)" class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold">
                      {{ ('adminUi.orders.' + order.status) | translate }}
                    </span>
                  </td>
                  <td *ngSwitchCase="'tags'" [ngClass]="cellPaddingClass()">
                    <div class="flex flex-wrap gap-1">
                      <ng-container *ngFor="let tagValue of order.tags || []">
                        <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs border border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200">
                          {{ tagLabel(tagValue) }}
                        </span>
                      </ng-container>
                      <span *ngIf="(order.tags || []).length === 0" class="text-xs text-slate-400">—</span>
                    </div>
                  </td>
                  <td *ngSwitchCase="'total'" class="text-slate-700 dark:text-slate-200" [ngClass]="cellPaddingClass()">
                    {{ order.total_amount | localizedCurrency : order.currency }}
                  </td>
                  <td *ngSwitchCase="'created'" class="text-slate-600 dark:text-slate-300" [ngClass]="cellPaddingClass()">
                    {{ order.created_at | date: 'short' }}
                  </td>
                  <td *ngSwitchCase="'actions'" class="text-right" [ngClass]="cellPaddingClass()">
                    <app-button size="sm" variant="ghost" [label]="'adminUi.orders.view' | translate" (action)="open(order.id)"></app-button>
                  </td>
                </ng-container>
              </tr>
            </ng-template>

            <ng-container *ngIf="orders().length > 100; else ordersTableStandard">
              <cdk-virtual-scroll-viewport
                class="block h-[min(70vh,720px)]"
                [itemSize]="orderRowHeight"
                [minBufferPx]="orderRowHeight * 10"
                [maxBufferPx]="orderRowHeight * 20"
              >
                <table class="min-w-[1050px] w-full text-sm">
                  <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                    <ng-container [ngTemplateOutlet]="ordersTableHeader"></ng-container>
                  </thead>
                  <tbody>
                    <ng-container *cdkVirtualFor="let order of orders(); trackBy: trackOrderId">
                      <ng-container
                        [ngTemplateOutlet]="ordersTableRow"
                        [ngTemplateOutletContext]="{ $implicit: order }"
                      ></ng-container>
                    </ng-container>
                  </tbody>
                </table>
              </cdk-virtual-scroll-viewport>
            </ng-container>
            <ng-template #ordersTableStandard>
              <table class="min-w-[1050px] w-full text-sm">
                <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                  <ng-container [ngTemplateOutlet]="ordersTableHeader"></ng-container>
                </thead>
                <tbody>
                  <ng-container *ngFor="let order of orders(); trackBy: trackOrderId">
                    <ng-container
                      [ngTemplateOutlet]="ordersTableRow"
                      [ngTemplateOutletContext]="{ $implicit: order }"
                    ></ng-container>
                  </ng-container>
                </tbody>
              </table>
            </ng-template>
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

      <ng-container *ngIf="exportModalOpen()">
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" (click)="closeExportModal()">
          <div
            class="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            (click)="$event.stopPropagation()"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="grid gap-1">
                <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">
                  {{ 'adminUi.orders.exportModal.title' | translate }}
                </h3>
                <div class="text-xs text-slate-600 dark:text-slate-300">
                  {{ 'adminUi.orders.exportModal.hint' | translate }}
                </div>
              </div>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50"
                (click)="closeExportModal()"
                [attr.aria-label]="'adminUi.actions.cancel' | translate"
              >
                ✕
              </button>
            </div>

            <div class="mt-4 grid gap-4">
              <div class="flex flex-wrap items-end justify-between gap-3">
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.orders.exportModal.template' | translate }}
                  <select
                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="selectedExportTemplateId"
                    (ngModelChange)="applyExportTemplate($event)"
                  >
                    <option value="">{{ 'adminUi.orders.exportModal.custom' | translate }}</option>
                    <option *ngFor="let tpl of exportTemplates" [value]="tpl.id">{{ tpl.name }}</option>
                  </select>
                </label>

                <div class="flex items-center gap-2">
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.orders.exportModal.saveTemplate' | translate"
                    (action)="saveExportTemplate()"
                  ></app-button>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.orders.exportModal.deleteTemplate' | translate"
                    [disabled]="!selectedExportTemplateId"
                    (action)="deleteExportTemplate()"
                  ></app-button>
                </div>
              </div>

              <div class="grid gap-2">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.orders.exportModal.columnsTitle' | translate }}
                </div>
                <div class="grid gap-2 sm:grid-cols-2">
                  <label
                    *ngFor="let col of exportColumnOptions"
                    class="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200"
                  >
                    <input
                      type="checkbox"
                      class="h-4 w-4"
                      [checked]="!!exportColumns[col]"
                      (change)="toggleExportColumn(col, $any($event.target).checked)"
                    />
                    <span class="font-medium text-slate-900 dark:text-slate-50">
                      {{ ('adminUi.orders.exportColumns.' + col) | translate }}
                    </span>
                  </label>
                </div>
              </div>

              <div class="flex justify-end gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.actions.cancel' | translate"
                  (action)="closeExportModal()"
                ></app-button>
                <app-button
                  size="sm"
                  [label]="'adminUi.orders.exportModal.download' | translate"
                  (action)="downloadExport()"
                ></app-button>
              </div>
            </div>
          </div>
        </div>
      </ng-container>

      <div *ngIf="selectedIds.size" class="h-24"></div>

      <div *ngIf="selectedIds.size" class="fixed inset-x-0 bottom-4 z-40 px-4 sm:px-6">
        <div class="max-w-6xl mx-auto">
          <div
            class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 text-sm text-slate-700 shadow-lg backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-200 dark:shadow-none"
          >
            <div class="font-medium">
              {{ 'adminUi.orders.bulk.selected' | translate: { count: selectedIds.size } }}
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.bulkActions' | translate" (action)="scrollToBulkActions()"></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.orders.bulk.clearSelection' | translate"
                [disabled]="bulkBusy"
                (action)="clearSelection()"
              ></app-button>
            </div>
          </div>
        </div>
      </div>
	    </div>
	  `
})
export class AdminOrdersComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.admin', url: '/admin/dashboard' },
    { label: 'adminUi.orders.title' }
  ];

  readonly orderRowHeight = 44;
  readonly tableColumns = ORDERS_TABLE_COLUMNS;

  layoutModalOpen = signal(false);
  tableLayout = signal<AdminTableLayoutV1>(defaultAdminTableLayout(ORDERS_TABLE_COLUMNS));

  loading = signal(true);
  error = signal<string | null>(null);
  errorRequestId = signal<string | null>(null);
  orders = signal<AdminOrderListItem[]>([]);
  meta = signal<AdminOrderListResponse['meta'] | null>(null);

  q = '';
  status: OrderStatusFilter = 'all';
  tag = '';
  fromDate = '';
  toDate = '';
  page = 1;
  limit = 20;

  presets: AdminOrdersFilterPreset[] = [];
  selectedPresetId = '';
  tagOptions = signal<string[]>(['vip', 'fraud_risk', 'gift']);

  exportModalOpen = signal(false);
  exportTemplates: AdminOrdersExportTemplate[] = [];
  selectedExportTemplateId = '';
  exportColumns: Record<string, boolean> = {};
  exportColumnOptions: string[] = [
    'id',
    'reference_code',
    'status',
    'customer_email',
    'customer_name',
    'total_amount',
    'currency',
    'tax_amount',
    'shipping_amount',
    'fee_amount',
    'payment_method',
    'promo_code',
    'courier',
    'delivery_type',
    'tracking_number',
    'tracking_url',
    'shipping_method',
    'invoice_company',
    'invoice_vat_id',
    'locker_name',
    'locker_address',
    'user_id',
    'created_at',
    'updated_at'
  ];

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
    this.tableLayout.set(loadAdminTableLayout(this.tableLayoutStorageKey(), this.tableColumns));
    this.presets = this.loadPresets();
    this.loadExportState();
    this.ordersApi.listOrderTags().subscribe({
      next: (tags) => {
        const merged = new Set<string>(['vip', 'fraud_risk', 'gift']);
        for (const t of tags) merged.add(t);
        this.tagOptions.set(Array.from(merged).sort());
      },
      error: () => {
        // ignore
      }
    });
    this.load();
  }

  openLayoutModal(): void {
    this.layoutModalOpen.set(true);
  }

  closeLayoutModal(): void {
    this.layoutModalOpen.set(false);
  }

  applyTableLayout(layout: AdminTableLayoutV1): void {
    this.tableLayout.set(layout);
    saveAdminTableLayout(this.tableLayoutStorageKey(), layout);
  }

  toggleDensity(): void {
    const current = this.tableLayout();
    const next: AdminTableLayoutV1 = {
      ...current,
      density: current.density === 'compact' ? 'comfortable' : 'compact',
    };
    this.applyTableLayout(next);
  }

  densityToggleLabelKey(): string {
    return this.tableLayout().density === 'compact'
      ? 'adminUi.tableLayout.densityToggle.toComfortable'
      : 'adminUi.tableLayout.densityToggle.toCompact';
  }

  scrollToBulkActions(): void {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('admin-orders-bulk-actions');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      const focusable = el.querySelector<HTMLElement>('select, input, button, [href], [tabindex]:not([tabindex="-1"])');
      focusable?.focus();
    }, 0);
  }

  visibleColumnIds(): string[] {
    return visibleAdminTableColumnIds(this.tableLayout(), this.tableColumns);
  }

  trackColumnId(_: number, colId: string): string {
    return colId;
  }

  cellPaddingClass(): string {
    return adminTableCellPaddingClass(this.tableLayout().density);
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
    this.tag = '';
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
    this.tag = preset.filters.tag;
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
        tag: this.tag,
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

  trackOrderId(_: number, order: AdminOrderListItem): string {
    return order.id;
  }

  open(orderId: string): void {
    void this.router.navigate(['/admin/orders', orderId]);
  }

  openExportModal(): void {
    this.exportModalOpen.set(true);
  }

  closeExportModal(): void {
    this.exportModalOpen.set(false);
  }

  toggleExportColumn(column: string, checked: boolean): void {
    if (!this.exportColumnOptions.includes(column)) return;
    this.exportColumns = { ...this.exportColumns, [column]: checked };
    this.selectedExportTemplateId = '';
    this.persistExportState();
  }

  applyExportTemplate(templateId: string): void {
    this.selectedExportTemplateId = templateId || '';
    if (!this.selectedExportTemplateId) {
      this.persistExportState();
      return;
    }
    const tpl = this.exportTemplates.find((candidate) => candidate.id === this.selectedExportTemplateId);
    if (!tpl) return;
    const cols = (tpl.columns || []).filter((c) => this.exportColumnOptions.includes(c));
    this.exportColumns = {};
    this.exportColumnOptions.forEach((c) => (this.exportColumns[c] = cols.includes(c)));
    this.persistExportState();
  }

  private selectedExportColumns(): string[] {
    return this.exportColumnOptions.filter((c) => !!this.exportColumns[c]);
  }

  downloadExport(): void {
    const columns = this.selectedExportColumns();
    if (!columns.length) {
      this.toast.error(this.translate.instant('adminUi.orders.exportModal.errors.noColumns'));
      return;
    }
    this.ordersApi.downloadExport(columns).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'orders.csv';
        a.click();
        URL.revokeObjectURL(url);
        this.closeExportModal();
      },
      error: () => this.toast.error(this.translate.instant('adminUi.orders.errors.export'))
    });
  }

  saveExportTemplate(): void {
    const columns = this.selectedExportColumns();
    if (!columns.length) {
      this.toast.error(this.translate.instant('adminUi.orders.exportModal.errors.noColumns'));
      return;
    }
    const name = (window.prompt(this.translate.instant('adminUi.orders.exportModal.templatePrompt')) ?? '').trim();
    if (!name) {
      this.toast.error(this.translate.instant('adminUi.orders.exportModal.errors.templateNameRequired'));
      return;
    }

    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const template: AdminOrdersExportTemplate = {
      id,
      name,
      createdAt: new Date().toISOString(),
      columns
    };
    this.exportTemplates = [template, ...this.exportTemplates].slice(0, 20);
    this.selectedExportTemplateId = template.id;
    this.persistExportState();
    this.toast.success(this.translate.instant('adminUi.orders.exportModal.success.saved'));
  }

  deleteExportTemplate(): void {
    const tpl = this.exportTemplates.find((candidate) => candidate.id === this.selectedExportTemplateId);
    if (!tpl) return;
    const ok = window.confirm(
      this.translate.instant('adminUi.orders.exportModal.confirmDelete', {
        name: tpl.name
      })
    );
    if (!ok) return;
    this.exportTemplates = this.exportTemplates.filter((candidate) => candidate.id !== tpl.id);
    this.selectedExportTemplateId = '';
    this.persistExportState();
    this.toast.success(this.translate.instant('adminUi.orders.exportModal.success.deleted'));
  }

  customerLabel(order: AdminOrderListItem): string {
    const email = (order.customer_email ?? '').trim();
    const username = (order.customer_username ?? '').trim();
    if (email && username) return `${email} (${username})`;
    return email || username || this.translate.instant('adminUi.orders.guest');
  }

  tagLabel(tag: string): string {
    const key = `adminUi.orders.tags.${tag}`;
    const translated = this.translate.instant(key);
    return translated === key ? tag : translated;
  }

  statusPillClass(status: string): string {
    return orderStatusChipClass(status);
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.errorRequestId.set(null);

    const params: Parameters<AdminOrdersService['search']>[0] = {
      page: this.page,
      limit: this.limit
    };
    const q = this.q.trim();
    if (q) params.q = q;
    if (this.status !== 'all') params.status = this.status;
    const tag = this.tag.trim();
    if (tag) params.tag = tag;
    if (this.fromDate) params.from = `${this.fromDate}T00:00:00Z`;
    if (this.toDate) params.to = `${this.toDate}T23:59:59Z`;

    this.ordersApi.search(params).subscribe({
      next: (res) => {
        this.orders.set(res.items);
        this.meta.set(res.meta);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(this.translate.instant('adminUi.orders.errors.load'));
        this.errorRequestId.set(extractRequestId(err));
        this.loading.set(false);
      }
    });
  }

  retryLoad(): void {
    this.load();
  }

  private tableLayoutStorageKey(): string {
    return adminTableLayoutStorageKey('orders', this.auth.user()?.id);
  }

  private storageKey(): string {
    const userId = (this.auth.user()?.id ?? '').trim();
    return `admin.orders.filters.v1:${userId || 'anonymous'}`;
  }

  private exportStorageKey(): string {
    const userId = (this.auth.user()?.id ?? '').trim();
    return `admin.orders.export.v1:${userId || 'anonymous'}`;
  }

  private loadExportState(): void {
    const defaultColumns = ['id', 'reference_code', 'status', 'total_amount', 'currency', 'user_id', 'created_at'];
    try {
      const raw = localStorage.getItem(this.exportStorageKey());
      if (!raw) {
        this.exportTemplates = [];
        this.selectedExportTemplateId = '';
        this.exportColumns = {};
        this.exportColumnOptions.forEach((c) => (this.exportColumns[c] = defaultColumns.includes(c)));
        return;
      }
      const parsed = JSON.parse(raw);
      const templates = Array.isArray(parsed?.templates) ? parsed.templates : [];
      this.exportTemplates = templates
        .filter((candidate: any) => typeof candidate?.id === 'string' && typeof candidate?.name === 'string')
        .map((candidate: any) => ({
          id: String(candidate.id),
          name: String(candidate.name),
          createdAt: String(candidate.createdAt ?? ''),
          columns: Array.isArray(candidate.columns) ? candidate.columns.map((c: any) => String(c)) : []
        })) as AdminOrdersExportTemplate[];

      this.selectedExportTemplateId = typeof parsed?.selectedTemplateId === 'string' ? parsed.selectedTemplateId : '';
      let columns: string[] = Array.isArray(parsed?.columns) ? parsed.columns.map((c: any) => String(c)) : [];

      if (this.selectedExportTemplateId) {
        const tpl = this.exportTemplates.find((candidate) => candidate.id === this.selectedExportTemplateId);
        if (tpl && Array.isArray(tpl.columns) && tpl.columns.length) {
          columns = tpl.columns.slice();
        }
      }

      columns = columns
        .map((c: string) => c.trim())
        .filter((c: string) => c && this.exportColumnOptions.includes(c));
      if (!columns.length) columns = defaultColumns;

      this.exportColumns = {};
      this.exportColumnOptions.forEach((c) => (this.exportColumns[c] = columns.includes(c)));
    } catch {
      this.exportTemplates = [];
      this.selectedExportTemplateId = '';
      this.exportColumns = {};
      this.exportColumnOptions.forEach((c) => (this.exportColumns[c] = defaultColumns.includes(c)));
    }
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
            tag: String(candidate?.filters?.tag ?? ''),
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

  private persistExportState(): void {
    try {
      localStorage.setItem(
        this.exportStorageKey(),
        JSON.stringify({
          templates: this.exportTemplates,
          selectedTemplateId: this.selectedExportTemplateId,
          columns: this.selectedExportColumns()
        })
      );
    } catch {
      // ignore
    }
  }
}
