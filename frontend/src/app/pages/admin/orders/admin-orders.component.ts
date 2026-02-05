import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { from, of } from 'rxjs';
import { catchError, concatMap, finalize, map, mergeMap, toArray } from 'rxjs/operators';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { extractRequestId } from '../../../shared/http-error';
import { InputComponent } from '../../../shared/input.component';
import { HelpPanelComponent } from '../../../shared/help-panel.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { ToastService } from '../../../core/toast.service';
import { LocalizedCurrencyPipe } from '../../../shared/localized-currency.pipe';
import { AdminOrderListItem, AdminOrderListResponse, AdminOrderTagStat, AdminOrdersService } from '../../../core/admin-orders.service';
import { orderStatusChipClass } from '../../../shared/order-status';
import { AuthService } from '../../../core/auth.service';
import { AdminFavoriteItem, AdminFavoritesService } from '../../../core/admin-favorites.service';
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
import { AdminPageHeaderComponent } from '../shared/admin-page-header.component';
import { adminFilterFavoriteKey } from '../shared/admin-filter-favorites';

import {
  TagColor,
  TAG_COLOR_PALETTE,
  normalizeTagKey,
  loadTagColorOverrides,
  persistTagColorOverrides,
  tagColorFor,
  tagChipColorClass as tagChipColorClassFromHelper
} from './order-tag-colors';

type OrderStatusFilter =
  | 'all'
  | 'sales'
  | 'pending'
  | 'pending_payment'
  | 'pending_acceptance'
  | 'paid'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

type SlaFilter = 'all' | 'any_overdue' | 'accept_overdue' | 'ship_overdue';
type FraudFilter = 'all' | 'queue' | 'flagged' | 'approved' | 'denied';

type AdminOrdersViewMode = 'table' | 'kanban';
type KanbanStatus = Exclude<OrderStatusFilter, 'all' | 'sales' | 'pending'>;

type AdminOrdersFilterPreset = {
  id: string;
  name: string;
  createdAt: string;
  filters: {
    q: string;
    status: OrderStatusFilter;
    sla: SlaFilter;
    fraud: FraudFilter;
    tag: string;
    fromDate: string;
    toDate: string;
    includeTestOrders: boolean;
    limit: number;
  };
};

type AdminOrdersExportTemplate = {
  id: string;
  name: string;
  createdAt: string;
  columns: string[];
};

type ShippingLabelsUploadStatus = 'pending' | 'uploading' | 'success' | 'error';

type ShippingLabelsUploadItem = {
  file: File;
  assignedOrderId: string | null;
  status: ShippingLabelsUploadStatus;
  error?: string | null;
};

type ShippingLabelsOrderOption = {
  id: string;
  ref: string;
  shortId: string;
  label: string;
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

const defaultOrdersTableLayout = (): AdminTableLayoutV1 => ({
  ...defaultAdminTableLayout(ORDERS_TABLE_COLUMNS),
  hidden: ['tags']
});

  @Component({
    selector: 'app-admin-orders',
    standalone: true,
		  imports: [
		    CommonModule,
		    FormsModule,
        DragDropModule,
		    ScrollingModule,
		    TranslateModule,
		    BreadcrumbComponent,
		    ButtonComponent,
		    ErrorStateComponent,
	    InputComponent,
	    HelpPanelComponent,
	    SkeletonComponent,
	    LocalizedCurrencyPipe,
	    TableLayoutModalComponent,
      AdminPageHeaderComponent
	  ],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

	      <app-admin-page-header [titleKey]="'adminUi.orders.title'" [hintKey]="'adminUi.orders.hint'">
	        <ng-template #primaryActions>
	          <app-button size="sm" variant="ghost" [label]="'adminUi.orders.export' | translate" (action)="openExportModal()"></app-button>
	          <app-button size="sm" variant="ghost" [label]="'adminUi.orders.exports.nav' | translate" (action)="openExports()"></app-button>
	        </ng-template>

		        <ng-template #secondaryActions>
		          <app-button size="sm" variant="ghost" [label]="viewToggleLabelKey() | translate" (action)="toggleViewMode()"></app-button>
		          <app-button size="sm" variant="ghost" [label]="densityToggleLabelKey() | translate" (action)="toggleDensity()"></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.orders.tags.manage' | translate"
                (action)="openTagManager()"
              ></app-button>
		          <app-button size="sm" variant="ghost" [label]="'adminUi.tableLayout.title' | translate" (action)="openLayoutModal()"></app-button>
		        </ng-template>
	      </app-admin-page-header>

      <app-table-layout-modal
        [open]="layoutModalOpen()"
        [columns]="tableColumns"
        [layout]="tableLayout()"
        [defaults]="tableDefaults"
        (closed)="closeLayoutModal()"
        (applied)="applyTableLayout($event)"
      ></app-table-layout-modal>

      <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
        <app-help-panel
          [titleKey]="'adminUi.help.title'"
          [subtitleKey]="'adminUi.orders.help.subtitle'"
          [mediaSrc]="'assets/help/admin-orders-help.svg'"
          [mediaAltKey]="'adminUi.orders.help.mediaAlt'"
        >
          <ul class="list-disc pl-5 text-xs text-slate-600 dark:text-slate-300">
            <li>{{ 'adminUi.orders.help.points.status' | translate }}</li>
            <li>{{ 'adminUi.orders.help.points.tags' | translate }}</li>
            <li>{{ 'adminUi.orders.help.points.export' | translate }}</li>
          </ul>
        </app-help-panel>

	        <div class="grid gap-3 lg:grid-cols-[1fr_220px_220px_220px_220px_auto] items-end">
	          <app-input [label]="'adminUi.orders.search' | translate" [(value)]="q"></app-input>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.orders.statusFilter' | translate }}
	            <select
	              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	              [(ngModel)]="status"
	            >
	              <option value="all">{{ 'adminUi.orders.all' | translate }}</option>
	              <option value="sales">{{ 'adminUi.orders.sales' | translate }}</option>
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
            {{ 'adminUi.orders.sla.filter' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="sla"
            >
              <option value="all">{{ 'adminUi.orders.sla.options.all' | translate }}</option>
              <option value="any_overdue">{{ 'adminUi.orders.sla.options.any_overdue' | translate }}</option>
              <option value="accept_overdue">{{ 'adminUi.orders.sla.options.accept_overdue' | translate }}</option>
              <option value="ship_overdue">{{ 'adminUi.orders.sla.options.ship_overdue' | translate }}</option>
            </select>
          </label>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.orders.fraud.filter' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="fraud"
            >
              <option value="all">{{ 'adminUi.orders.fraud.options.all' | translate }}</option>
              <option value="queue">{{ 'adminUi.orders.fraud.options.queue' | translate }}</option>
              <option value="flagged">{{ 'adminUi.orders.fraud.options.flagged' | translate }}</option>
              <option value="approved">{{ 'adminUi.orders.fraud.options.approved' | translate }}</option>
              <option value="denied">{{ 'adminUi.orders.fraud.options.denied' | translate }}</option>
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
            {{ 'adminUi.orders.testOrdersFilter' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="includeTestOrders"
            >
              <option [ngValue]="true">{{ 'adminUi.orders.testOrders.include' | translate }}</option>
              <option [ngValue]="false">{{ 'adminUi.orders.testOrders.exclude' | translate }}</option>
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

          <div class="flex flex-wrap items-end justify-between gap-3">
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 w-full sm:w-auto">
              {{ 'adminUi.favorites.savedViews.label' | translate }}
              <select
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 min-w-[220px]"
                [(ngModel)]="selectedSavedViewKey"
                (ngModelChange)="applySavedView($event)"
              >
                <option value="">{{ 'adminUi.favorites.savedViews.none' | translate }}</option>
                <option *ngFor="let view of savedViews()" [value]="view.key">{{ view.label }}</option>
              </select>
            </label>

            <div class="flex flex-wrap items-center gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="(isCurrentViewPinned() ? 'adminUi.favorites.savedViews.unpinCurrent' : 'adminUi.favorites.savedViews.pinCurrent') | translate"
                [disabled]="favorites.loading()"
                (action)="toggleCurrentViewPin()"
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
              <ng-container *ngIf="viewMode() === 'kanban'; else listTpl">
                <div class="grid gap-3">
                  <div class="text-xs text-slate-600 dark:text-slate-300">
                    {{ 'adminUi.orders.kanban.hint' | translate }}
                  </div>

                  <div *ngIf="kanbanTotalCards() === 0" class="text-sm text-slate-600 dark:text-slate-300">
                    {{ 'adminUi.orders.empty' | translate }}
                  </div>

                  <div *ngIf="kanbanTotalCards() > 0" class="overflow-x-auto pb-2">
                    <div class="flex gap-4 min-w-[900px]" cdkDropListGroup>
                      <ng-container *ngFor="let colStatus of kanbanColumnStatuses(); trackBy: trackKanbanStatus">
                        <div
                          class="w-[320px] shrink-0 rounded-2xl border border-slate-200 bg-slate-50 shadow-sm dark:border-slate-800 dark:bg-slate-950/30"
                        >
                          <div class="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
                            <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                              {{ ('adminUi.orders.' + colStatus) | translate }}
                            </div>
                            <div class="text-xs text-slate-500 dark:text-slate-300">
                              {{ kanbanTotalsByStatus()[colStatus] ?? (kanbanItemsByStatus()[colStatus]?.length || 0) }}
                            </div>
                          </div>

                          <div
                            cdkDropList
                            [cdkDropListData]="kanbanItemsByStatus()[colStatus] || []"
                            (cdkDropListDropped)="onKanbanDrop($event, colStatus)"
                            class="min-h-[160px] p-3 grid gap-2"
                          >
                            <ng-container
                              *ngFor="let order of kanbanItemsByStatus()[colStatus] || []; trackBy: trackOrderId"
                            >
                              <div
                                cdkDrag
                                [cdkDragData]="order"
                                [cdkDragDisabled]="kanbanBusy()"
                                class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm cursor-grab active:cursor-grabbing dark:border-slate-800 dark:bg-slate-900"
                              >
                                <div class="flex items-start justify-between gap-2">
                                  <div class="min-w-0">
                                    <div class="flex flex-wrap items-center gap-2 min-w-0">
                                      <div class="font-semibold text-slate-900 dark:text-slate-50 truncate">
                                        {{ order.reference_code || (order.id | slice: 0:8) }}
                                      </div>
                                      <ng-container *ngIf="slaBadge(order) as badge">
                                        <span
                                          class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                                          [ngClass]="badge.className"
                                          [attr.title]="badge.title"
                                        >
                                          {{ badge.label }}
                                        </span>
                                      </ng-container>
                                      <ng-container *ngIf="fraudBadge(order) as fraud">
                                        <span
                                          class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                                          [ngClass]="fraud.className"
                                          [attr.title]="fraud.title"
                                        >
                                          {{ fraud.label }}
                                        </span>
                                      </ng-container>
                                    </div>
                                    <div class="text-xs text-slate-600 dark:text-slate-300 truncate">
                                      {{ customerLabel(order) }}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    class="shrink-0 rounded-md px-2 py-1 text-xs text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50"
                                    (click)="$event.stopPropagation(); open(order.id)"
                                    [attr.aria-label]="'adminUi.orders.view' | translate"
                                  >
                                    {{ 'adminUi.orders.view' | translate }}
                                  </button>
                                </div>

                                <div class="mt-2 flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
                                  <span class="font-medium text-slate-700 dark:text-slate-200">
                                    {{ order.total_amount | localizedCurrency : order.currency }}
                                  </span>
                                  <span>{{ order.created_at | date: 'short' }}</span>
                                </div>

                                <div class="mt-2 flex flex-wrap gap-1">
                                  <span
                                    *ngIf="order.payment_method"
                                    class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] border border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200"
                                  >
                                    {{ order.payment_method }}
                                  </span>
                                  <ng-container *ngFor="let tagValue of order.tags || []">
                                    <span
                                      class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] border"
                                      [ngClass]="tagChipColorClass(tagValue)"
                                    >
                                      {{ tagLabel(tagValue) }}
                                    </span>
                                  </ng-container>
                                </div>
                              </div>
                            </ng-container>
                          </div>
                        </div>
                      </ng-container>
                    </div>
                  </div>
                </div>
              </ng-container>

              <ng-template #listTpl>
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
                  {{ 'adminUi.orders.bulk.tagAdd' | translate }}
                  <input
                    class="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    type="text"
                    [placeholder]="'vip'"
                    [(ngModel)]="bulkTagAdd"
                    [disabled]="bulkBusy"
                  />
                </label>

                <label class="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.orders.bulk.tagRemove' | translate }}
                  <input
                    class="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    type="text"
                    [placeholder]="'test'"
                    [(ngModel)]="bulkTagRemove"
                    [disabled]="bulkBusy"
                  />
                </label>

                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.orders.bulk.applyTags' | translate"
                  [disabled]="bulkBusy || (!bulkTagAdd.trim() && !bulkTagRemove.trim())"
                  (action)="applyBulkTags()"
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
	                  [label]="'adminUi.orders.bulk.pickListCsv' | translate"
	                  [disabled]="bulkBusy"
	                  (action)="downloadPickListCsv()"
	                ></app-button>
	                <app-button
	                  size="sm"
	                  variant="ghost"
	                  [label]="'adminUi.orders.bulk.pickListPdf' | translate"
	                  [disabled]="bulkBusy"
	                  (action)="downloadPickListPdf()"
	                ></app-button>
	                <app-button
	                  size="sm"
	                  variant="ghost"
	                  [label]="'adminUi.orders.bulk.shippingLabels' | translate"
	                  [disabled]="bulkBusy"
	                  (action)="openShippingLabelsModal()"
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
                      [attr.aria-label]="'adminUi.orders.a11y.selectAllOnPage' | translate"
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
                      [attr.aria-label]="'adminUi.orders.a11y.selectOrder' | translate: { ref: order.reference_code || (order.id | slice: 0:8) }"
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
                    <div class="flex flex-wrap items-center gap-2">
                      <span
                        [ngClass]="statusPillClass(order.status)"
                        class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold"
                      >
                        {{ ('adminUi.orders.' + order.status) | translate }}
                      </span>
                      <ng-container *ngIf="slaBadge(order) as badge">
                        <span
                          class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                          [ngClass]="badge.className"
                          [attr.title]="badge.title"
                        >
                          {{ badge.label }}
                        </span>
                      </ng-container>
                      <ng-container *ngIf="fraudBadge(order) as fraud">
                        <span
                          class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                          [ngClass]="fraud.className"
                          [attr.title]="fraud.title"
                        >
                          {{ fraud.label }}
                        </span>
                      </ng-container>
                    </div>
                  </td>
                  <td *ngSwitchCase="'tags'" [ngClass]="cellPaddingClass()">
                    <div class="flex flex-wrap gap-1">
                      <ng-container *ngFor="let tagValue of order.tags || []">
                        <span
                          class="inline-flex items-center rounded-full px-2 py-0.5 text-xs border"
                          [ngClass]="tagChipColorClass(tagValue)"
                        >
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
	          </ng-template>
			      </section>

        <ng-container *ngIf="shippingLabelsModalOpen()">
          <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" (click)="closeShippingLabelsModal()">
            <div
              class="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900"
              (click)="$event.stopPropagation()"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="grid gap-1">
                  <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">
                    {{ 'adminUi.orders.shippingLabelsModal.title' | translate }}
                  </h3>
                  <div class="text-xs text-slate-600 dark:text-slate-300">
                    {{ 'adminUi.orders.shippingLabelsModal.hint' | translate: { count: selectedIds.size } }}
                  </div>
                </div>
                <button
                  type="button"
                  class="rounded-md px-2 py-1 text-slate-500 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-50"
                  (click)="closeShippingLabelsModal()"
                  [disabled]="shippingLabelsBusy"
                  [attr.aria-label]="'adminUi.actions.cancel' | translate"
                >
                  ✕
                </button>
              </div>

              <div class="mt-4 grid gap-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <label class="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                    <input type="file" class="hidden" multiple (change)="onShippingLabelsSelected($event)" />
                    <span class="font-medium text-slate-900 dark:text-slate-50">{{ 'adminUi.orders.shippingLabelsModal.chooseFiles' | translate }}</span>
                    <span class="text-xs text-slate-500 dark:text-slate-300">{{ 'adminUi.orders.shippingLabelsModal.chooseFilesHint' | translate }}</span>
                  </label>

                  <div class="flex items-center gap-2">
                    <app-button
                      size="sm"
                      [label]="'adminUi.orders.shippingLabelsModal.uploadAll' | translate"
                      [disabled]="shippingLabelsBusy || shippingLabelsUploads.length === 0"
                      (action)="uploadAllShippingLabels()"
                    ></app-button>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.orders.shippingLabelsModal.downloadZip' | translate"
                      [disabled]="shippingLabelsBusy"
                      (action)="downloadSelectedShippingLabelsZip()"
                    ></app-button>
                  </div>
                </div>

                <div *ngIf="shippingLabelsUploads.length === 0" class="text-sm text-slate-600 dark:text-slate-300">
                  {{ 'adminUi.orders.shippingLabelsModal.empty' | translate }}
                </div>

                <div
                  *ngIf="shippingLabelsUploads.length > 0"
                  class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800"
                >
                  <table class="min-w-[900px] w-full text-sm">
                    <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                      <tr>
                        <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.orders.shippingLabelsModal.table.file' | translate }}</th>
                        <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.orders.shippingLabelsModal.table.order' | translate }}</th>
                        <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.orders.shippingLabelsModal.table.status' | translate }}</th>
                        <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.orders.shippingLabelsModal.table.actions' | translate }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        *ngFor="let row of shippingLabelsUploads; let idx = index"
                        class="border-t border-slate-200 dark:border-slate-800"
                      >
                        <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
                          <div class="font-medium truncate max-w-[420px]">{{ row.file.name }}</div>
                          <div
                            *ngIf="row.error"
                            class="mt-1 text-xs text-rose-700 dark:text-rose-300"
                          >
                            {{ row.error }}
                          </div>
                        </td>
                        <td class="px-3 py-2">
                          <select
                            class="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            [(ngModel)]="shippingLabelsUploads[idx].assignedOrderId"
                            [disabled]="shippingLabelsBusy"
                          >
                            <option [ngValue]="null">{{ 'adminUi.orders.shippingLabelsModal.unassigned' | translate }}</option>
                            <option *ngFor="let opt of shippingLabelsOrderOptions" [value]="opt.id">{{ opt.label }}</option>
                          </select>
                        </td>
                        <td class="px-3 py-2">
                          <span
                            class="inline-flex items-center rounded-full px-2 py-0.5 text-xs border"
                            [ngClass]="shippingLabelStatusPillClass(row.status)"
                          >
                            {{ shippingLabelStatusLabelKey(row.status) | translate }}
                          </span>
                        </td>
                        <td class="px-3 py-2 text-right">
                          <app-button
                            *ngIf="row.status === 'error'"
                            size="sm"
                            variant="ghost"
                            [label]="'adminUi.actions.retry' | translate"
                            [disabled]="shippingLabelsBusy"
                            (action)="retryShippingLabelUpload(idx)"
                          ></app-button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div class="flex justify-end">
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.common.close' | translate"
                    [disabled]="shippingLabelsBusy"
                    (action)="closeShippingLabelsModal()"
                  ></app-button>
                </div>
              </div>
            </div>
          </div>
        </ng-container>

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

      <ng-container *ngIf="tagManagerOpen()">
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" (click)="closeTagManager()">
          <div
            class="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            (click)="$event.stopPropagation()"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="grid gap-1">
                <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">
                  {{ 'adminUi.orders.tags.manageTitle' | translate }}
                </h3>
                <div class="text-xs text-slate-600 dark:text-slate-300">
                  {{ 'adminUi.orders.tags.manageHint' | translate }}
                </div>
              </div>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50"
                (click)="closeTagManager()"
                [attr.aria-label]="'adminUi.actions.cancel' | translate"
              >
                ✕
              </button>
            </div>

            <div class="mt-4 grid gap-4">
              <div class="flex flex-wrap items-end justify-between gap-3">
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.actions.search' | translate }}
                  <input
                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    type="text"
                    [(ngModel)]="tagManagerQuery"
                    [placeholder]="'adminUi.orders.tags.searchPlaceholder' | translate"
                  />
                </label>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.actions.refresh' | translate"
                  [disabled]="tagManagerLoading()"
                  (action)="reloadTagManager()"
                ></app-button>
              </div>

              <div *ngIf="tagManagerLoading()" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <app-skeleton [rows]="3"></app-skeleton>
              </div>

              <div
                *ngIf="!tagManagerLoading() && tagManagerError()"
                class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
              >
                {{ tagManagerError() }}
              </div>

              <div
                *ngIf="!tagManagerLoading() && !tagManagerError() && filteredTagManagerRows().length === 0"
                class="text-sm text-slate-600 dark:text-slate-300"
              >
                {{ 'adminUi.orders.tags.empty' | translate }}
              </div>

              <div *ngIf="!tagManagerLoading() && !tagManagerError() && filteredTagManagerRows().length" class="overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table class="min-w-[720px] w-full text-sm">
                  <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                    <tr>
                      <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.orders.tags.table.tag' | translate }}</th>
                      <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.orders.tags.table.count' | translate }}</th>
                      <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.orders.tags.table.color' | translate }}</th>
                      <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.orders.tags.table.actions' | translate }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      *ngFor="let row of filteredTagManagerRows()"
                      class="border-t border-slate-200 dark:border-slate-800"
                    >
                      <td class="px-3 py-2">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs border" [ngClass]="tagChipColorClass(row.tag)">
                            {{ tagLabel(row.tag) }}
                          </span>
                          <span class="text-xs text-slate-500 dark:text-slate-400 font-mono">{{ row.tag }}</span>
                        </div>
                      </td>
                      <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
                        {{ row.count }}
                      </td>
                      <td class="px-3 py-2">
                        <select
                          class="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          [ngModel]="tagColorValue(row.tag)"
                          (ngModelChange)="setTagColor(row.tag, $event)"
                        >
                          <option *ngFor="let c of tagColorPalette" [value]="c">
                            {{ ('adminUi.orders.tags.colors.' + c) | translate }}
                          </option>
                        </select>
                      </td>
                      <td class="px-3 py-2 text-right">
                        <app-button
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.orders.tags.resetColor' | translate"
                          (action)="resetTagColor(row.tag)"
                        ></app-button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.orders.tags.renameTitle' | translate }}</div>
                <div class="mt-2 grid gap-3 md:grid-cols-[1fr_1fr_auto] items-end">
                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.orders.tags.renameFrom' | translate }}
                    <select
                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [(ngModel)]="tagRenameFrom"
                      [disabled]="tagRenameBusy"
                    >
                      <option value="">{{ 'adminUi.orders.tags.renameFromPlaceholder' | translate }}</option>
                      <option *ngFor="let t of tagOptions()" [value]="t">{{ tagLabel(t) }}</option>
                    </select>
                  </label>

                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.orders.tags.renameTo' | translate }}
                    <input
                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      type="text"
                      [(ngModel)]="tagRenameTo"
                      [placeholder]="'priority'"
                      [disabled]="tagRenameBusy"
                    />
                  </label>

                  <app-button
                    size="sm"
                    [label]="'adminUi.orders.tags.rename' | translate"
                    [disabled]="tagRenameBusy || !tagRenameFrom.trim() || !tagRenameTo.trim()"
                    (action)="renameTag()"
                  ></app-button>
                </div>
                <div *ngIf="tagRenameError" class="mt-2 text-sm text-rose-700 dark:text-rose-300">{{ tagRenameError }}</div>
              </div>

              <div class="flex justify-end">
                <app-button size="sm" variant="ghost" [label]="'adminUi.common.close' | translate" (action)="closeTagManager()"></app-button>
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
  readonly tableDefaults = defaultOrdersTableLayout();

  layoutModalOpen = signal(false);
  tableLayout = signal<AdminTableLayoutV1>(defaultOrdersTableLayout());

  loading = signal(true);
  error = signal<string | null>(null);
  errorRequestId = signal<string | null>(null);
  orders = signal<AdminOrderListItem[]>([]);
  meta = signal<AdminOrderListResponse['meta'] | null>(null);

  viewMode = signal<AdminOrdersViewMode>('table');
  kanbanBusy = signal(false);
  kanbanItemsByStatus = signal<Record<string, AdminOrderListItem[]>>({});
  kanbanTotalsByStatus = signal<Record<string, number>>({});

  q = '';
  status: OrderStatusFilter = 'all';
  sla: SlaFilter = 'all';
  fraud: FraudFilter = 'all';
  tag = '';
  fromDate = '';
  toDate = '';
  includeTestOrders = true;
  page = 1;
  limit = 20;

  presets: AdminOrdersFilterPreset[] = [];
  selectedPresetId = '';
  selectedSavedViewKey = '';
  tagOptions = signal<string[]>(['vip', 'fraud_risk', 'fraud_approved', 'fraud_denied', 'gift']);

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
  bulkTagAdd = '';
  bulkTagRemove = '';
  bulkBusy = false;

  shippingLabelsModalOpen = signal(false);
  shippingLabelsOrderOptions: ShippingLabelsOrderOption[] = [];
  shippingLabelsUploads: ShippingLabelsUploadItem[] = [];
  shippingLabelsBusy = false;

  tagManagerOpen = signal(false);
  tagManagerLoading = signal(false);
  tagManagerError = signal<string | null>(null);
  tagManagerQuery = '';
  tagManagerRows = signal<AdminOrderTagStat[]>([]);
  tagRenameFrom = '';
  tagRenameTo = '';
  tagRenameBusy = false;
  tagRenameError = '';

  readonly tagColorPalette: TagColor[] = TAG_COLOR_PALETTE;
  private tagColorOverrides: Record<string, TagColor> = {};

  constructor(
    private ordersApi: AdminOrdersService,
    private router: Router,
    private toast: ToastService,
    private translate: TranslateService,
    private auth: AuthService,
    public favorites: AdminFavoritesService
  ) {}

  ngOnInit(): void {
    this.tagColorOverrides = loadTagColorOverrides();
    this.favorites.init();
    this.tableLayout.set(loadAdminTableLayout(this.tableLayoutStorageKey(), this.tableColumns, this.tableDefaults));
    this.viewMode.set(this.loadViewMode());
    this.presets = this.loadPresets();
    this.loadExportState();
    this.maybeApplyFiltersFromState();
    this.refreshTagOptions();
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

  viewToggleLabelKey(): string {
    return this.viewMode() === 'kanban' ? 'adminUi.orders.viewMode.table' : 'adminUi.orders.viewMode.kanban';
  }

  toggleViewMode(): void {
    const next: AdminOrdersViewMode = this.viewMode() === 'kanban' ? 'table' : 'kanban';
    this.viewMode.set(next);
    this.persistViewMode();
    this.clearSelection();
    this.load();
  }

  kanbanColumnStatuses(): KanbanStatus[] {
    if (this.status === 'pending') return ['pending_payment', 'pending_acceptance'];
    if (this.status === 'sales') return ['paid', 'shipped', 'delivered', 'refunded'];
    if (this.status === 'all')
      return ['pending_payment', 'pending_acceptance', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded'];
    return [this.status as KanbanStatus];
  }

  trackKanbanStatus(_: number, status: KanbanStatus): string {
    return status;
  }

  kanbanTotalCards(): number {
    const items = this.kanbanItemsByStatus();
    return this.kanbanColumnStatuses().reduce((sum, status) => sum + (items[status]?.length ?? 0), 0);
  }

  onKanbanDrop(event: CdkDragDrop<AdminOrderListItem[]>, targetStatus: KanbanStatus): void {
    if (this.kanbanBusy()) return;
    const order = event.item.data as AdminOrderListItem;
    const sourceStatus = (order?.status ?? '').toString() as KanbanStatus;
    if (!order?.id || !sourceStatus) return;

    if (sourceStatus === targetStatus) {
      const itemsByStatus = this.kanbanItemsByStatus();
      const columnItems = [...(itemsByStatus[sourceStatus] ?? [])];
      moveItemInArray(columnItems, event.previousIndex, event.currentIndex);
      this.kanbanItemsByStatus.set({ ...itemsByStatus, [sourceStatus]: columnItems });
      return;
    }

    const allowed = this.allowedKanbanTransitions(order);
    if (!allowed.includes(targetStatus)) {
      this.toast.error(this.translate.instant('adminUi.orders.kanban.errors.invalidTransition'));
      return;
    }

    let cancelReason: string | null | undefined = undefined;
    if (targetStatus === 'cancelled') {
      cancelReason = (window.prompt(this.translate.instant('adminUi.orders.kanban.cancelPrompt')) ?? '').trim();
      if (!cancelReason) {
        this.toast.error(this.translate.instant('adminUi.orders.kanban.errors.cancelReasonRequired'));
        return;
      }
    }

    if (targetStatus === 'refunded') {
      const ok = window.confirm(this.translate.instant('adminUi.orders.kanban.refundConfirm'));
      if (!ok) return;
    }

    const prevItemsByStatus = this.kanbanItemsByStatus();
    const prevTotalsByStatus = this.kanbanTotalsByStatus();
    const sourceItems = [...(prevItemsByStatus[sourceStatus] ?? [])];
    const targetItems = [...(prevItemsByStatus[targetStatus] ?? [])];
    transferArrayItem(sourceItems, targetItems, event.previousIndex, event.currentIndex);
    order.status = targetStatus;
    this.kanbanItemsByStatus.set({
      ...prevItemsByStatus,
      [sourceStatus]: sourceItems,
      [targetStatus]: targetItems,
    });
    this.kanbanTotalsByStatus.set({
      ...prevTotalsByStatus,
      [sourceStatus]: Math.max(0, (prevTotalsByStatus[sourceStatus] ?? sourceItems.length + 1) - 1),
      [targetStatus]: (prevTotalsByStatus[targetStatus] ?? Math.max(0, targetItems.length - 1)) + 1,
    });

    this.kanbanBusy.set(true);
    this.ordersApi
      .update(order.id, { status: targetStatus, cancel_reason: cancelReason ?? undefined })
      .pipe(
        finalize(() => {
          this.kanbanBusy.set(false);
        })
      )
      .subscribe({
        next: (updated) => {
          order.status = (updated?.status ?? targetStatus) as any;
          this.toast.success(this.translate.instant('adminUi.orders.kanban.success.updated'));
        },
        error: () => {
          order.status = sourceStatus;
          this.kanbanItemsByStatus.set(prevItemsByStatus);
          this.kanbanTotalsByStatus.set(prevTotalsByStatus);
          this.toast.error(this.translate.instant('adminUi.orders.kanban.errors.updateFailed'));
        }
      });
  }

  private allowedKanbanTransitions(order: AdminOrderListItem): KanbanStatus[] {
    const current = (order?.status ?? '').toString() as KanbanStatus;
    const base: Record<string, KanbanStatus[]> = {
      pending_payment: ['pending_acceptance', 'cancelled'],
      pending_acceptance: ['paid', 'cancelled'],
      paid: ['shipped', 'refunded', 'cancelled'],
      shipped: ['delivered', 'refunded'],
      delivered: ['refunded'],
      cancelled: [],
      refunded: []
    };
    const allowed = [...(base[current] ?? [])];
    const method = order.payment_method ? String(order.payment_method).trim().toLowerCase() : '';
    if (method === 'cod' && current === 'pending_acceptance') {
      allowed.push('shipped', 'delivered');
    }
    return Array.from(new Set(allowed));
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
    this.sla = 'all';
    this.fraud = 'all';
    this.tag = '';
    this.fromDate = '';
    this.toDate = '';
    this.includeTestOrders = true;
    this.page = 1;
    this.selectedPresetId = '';
    this.selectedSavedViewKey = '';
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
    this.sla = preset.filters.sla ?? 'all';
    this.fraud = preset.filters.fraud ?? 'all';
    this.tag = preset.filters.tag;
    this.fromDate = preset.filters.fromDate;
    this.toDate = preset.filters.toDate;
    this.includeTestOrders = Boolean(preset.filters.includeTestOrders);
    this.limit = preset.filters.limit;
    this.page = 1;
    this.selectedSavedViewKey = '';
    this.clearSelection();
    this.load();
  }

  savedViews(): AdminFavoriteItem[] {
    return this.favorites
      .items()
      .filter((item) => item?.type === 'filter' && (item?.state as any)?.adminFilterScope === 'orders');
  }

  applySavedView(key: string): void {
    this.selectedSavedViewKey = key;
    if (!key) return;
    const view = this.savedViews().find((item) => item.key === key);
    const filters = view?.state && typeof view.state === 'object' ? (view.state as any).adminFilters : null;
    if (!filters || typeof filters !== 'object') return;

    this.q = String(filters.q ?? '');
    this.status = (filters.status ?? 'all') as OrderStatusFilter;
    this.sla = (filters.sla ?? 'all') as SlaFilter;
    this.fraud = (filters.fraud ?? 'all') as FraudFilter;
    this.tag = String(filters.tag ?? '');
    this.fromDate = String(filters.fromDate ?? '');
    this.toDate = String(filters.toDate ?? '');
    this.includeTestOrders = Boolean(filters.includeTestOrders ?? true);
    const nextLimit = typeof filters.limit === 'number' && Number.isFinite(filters.limit) ? filters.limit : 20;
    this.limit = nextLimit;
    this.page = 1;
    this.selectedPresetId = '';
    this.clearSelection();
    this.load();
  }

  isCurrentViewPinned(): boolean {
    return this.favorites.isFavorite(this.currentViewFavoriteKey());
  }

  toggleCurrentViewPin(): void {
    const key = this.currentViewFavoriteKey();
    if (this.favorites.isFavorite(key)) {
      this.favorites.remove(key);
      if (this.selectedSavedViewKey === key) this.selectedSavedViewKey = '';
      return;
    }

    const name = (window.prompt(this.translate.instant('adminUi.favorites.savedViews.prompt')) ?? '').trim();
    if (!name) {
      this.toast.error(this.translate.instant('adminUi.favorites.savedViews.errors.nameRequired'));
      return;
    }

    const filters = this.currentViewFilters();
    this.favorites.add({
      key,
      type: 'filter',
      label: name,
      subtitle: '',
      url: '/admin/orders',
      state: { adminFilterScope: 'orders', adminFilters: filters }
    });
    this.selectedSavedViewKey = key;
  }

  private maybeApplyFiltersFromState(): void {
    const state = history.state as any;
    const scope = (state?.adminFilterScope || '').toString();
    if (scope !== 'orders') return;
    const filters = state?.adminFilters;
    if (!filters || typeof filters !== 'object') return;

    this.q = String(filters.q ?? '');
    this.status = (filters.status ?? 'all') as OrderStatusFilter;
    this.sla = (filters.sla ?? 'all') as SlaFilter;
    this.fraud = (filters.fraud ?? 'all') as FraudFilter;
    this.tag = String(filters.tag ?? '');
    this.fromDate = String(filters.fromDate ?? '');
    this.toDate = String(filters.toDate ?? '');
    this.includeTestOrders = Boolean(filters.includeTestOrders ?? true);
    const nextLimit = typeof filters.limit === 'number' && Number.isFinite(filters.limit) ? filters.limit : this.limit;
    this.limit = nextLimit;
    this.page = 1;
    this.selectedPresetId = '';
    this.selectedSavedViewKey = this.currentViewFavoriteKey();
  }

  private currentViewFilters(): AdminOrdersFilterPreset['filters'] {
    return {
      q: this.q,
      status: this.status,
      sla: this.sla,
      fraud: this.fraud,
      tag: this.tag,
      fromDate: this.fromDate,
      toDate: this.toDate,
      includeTestOrders: this.includeTestOrders,
      limit: this.limit
    };
  }

  private currentViewFavoriteKey(): string {
    return adminFilterFavoriteKey('orders', this.currentViewFilters());
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
        sla: this.sla,
        fraud: this.fraud,
        tag: this.tag,
        fromDate: this.fromDate,
        toDate: this.toDate,
        includeTestOrders: this.includeTestOrders,
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
        this.downloadBlob(blob, 'packing-slips.pdf');
        this.toast.success(this.translate.instant('adminUi.orders.bulk.packingSlipsReady'));
        this.bulkBusy = false;
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.orders.bulk.errors.packingSlips'));
        this.bulkBusy = false;
      }
    });
  }

  downloadPickListCsv(): void {
    if (!this.selectedIds.size) return;
    const ids = Array.from(this.selectedIds);
    this.bulkBusy = true;
    this.ordersApi.downloadPickListCsv(ids).subscribe({
      next: (blob) => {
        this.downloadBlob(blob, 'pick-list.csv');
        this.toast.success(this.translate.instant('adminUi.orders.bulk.pickListReady'));
        this.bulkBusy = false;
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.orders.bulk.errors.pickList'));
        this.bulkBusy = false;
      }
    });
  }

  downloadPickListPdf(): void {
    if (!this.selectedIds.size) return;
    const ids = Array.from(this.selectedIds);
    this.bulkBusy = true;
    this.ordersApi.downloadPickListPdf(ids).subscribe({
      next: (blob) => {
        this.downloadBlob(blob, 'pick-list.pdf');
        this.toast.success(this.translate.instant('adminUi.orders.bulk.pickListReady'));
        this.bulkBusy = false;
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.orders.bulk.errors.pickList'));
        this.bulkBusy = false;
      }
    });
  }

  openShippingLabelsModal(): void {
    if (!this.selectedIds.size) return;
    this.shippingLabelsOrderOptions = this.buildShippingLabelsOrderOptions();
    this.shippingLabelsUploads = [];
    this.shippingLabelsModalOpen.set(true);
  }

  closeShippingLabelsModal(): void {
    if (this.shippingLabelsBusy) return;
    this.shippingLabelsModalOpen.set(false);
    this.shippingLabelsUploads = [];
    this.shippingLabelsOrderOptions = [];
  }

  onShippingLabelsSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const files = input?.files ? Array.from(input.files) : [];
    if (!files.length) return;
    const nextUploads: ShippingLabelsUploadItem[] = files.map((file) => ({
      file,
      assignedOrderId: this.autoAssignShippingLabel(file),
      status: 'pending',
      error: null
    }));
    this.shippingLabelsUploads = [...this.shippingLabelsUploads, ...nextUploads].slice(0, 50);
    if (input) input.value = '';
  }

  uploadAllShippingLabels(): void {
    if (this.shippingLabelsBusy) return;
    if (!this.shippingLabelsUploads.length) return;

    const uploadTargets = this.shippingLabelsUploads
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status !== 'success');
    if (!uploadTargets.length) return;

    this.shippingLabelsBusy = true;
    from(uploadTargets)
      .pipe(
        mergeMap(
          ({ item, index }) => {
            const orderId = (item.assignedOrderId ?? '').trim();
            if (!orderId) {
              this.updateShippingLabelUpload(index, {
                status: 'error',
                error: this.translate.instant('adminUi.orders.shippingLabelsModal.errors.missingOrder')
              });
              return of({ index, ok: false as const });
            }
            this.updateShippingLabelUpload(index, { status: 'uploading', error: null });
            return this.ordersApi.uploadShippingLabel(orderId, item.file).pipe(
              map(() => ({ index, ok: true as const })),
              catchError((err) => of({ index, ok: false as const, err }))
            );
          },
          2
        ),
        toArray(),
        finalize(() => {
          this.shippingLabelsBusy = false;
        })
      )
      .subscribe((results) => {
        const failed = results.filter((r) => !r.ok);
        for (const result of results) {
          if (result.ok) {
            this.updateShippingLabelUpload(result.index, { status: 'success', error: null });
            continue;
          }
          const requestId = extractRequestId((result as any).err);
          const suffix = requestId ? ` (${requestId})` : '';
          this.updateShippingLabelUpload(result.index, {
            status: 'error',
            error: `${this.translate.instant('adminUi.orders.shippingLabelsModal.errors.uploadFailed')}${suffix}`
          });
        }
        if (failed.length) {
          this.toast.error(
            this.translate.instant('adminUi.orders.shippingLabelsModal.errors.partial', {
              success: results.length - failed.length,
              total: results.length
            })
          );
          return;
        }
        this.toast.success(this.translate.instant('adminUi.orders.shippingLabelsModal.success.uploaded'));
      });
  }

  retryShippingLabelUpload(index: number): void {
    const item = this.shippingLabelsUploads[index];
    if (!item || this.shippingLabelsBusy) return;
    const orderId = (item.assignedOrderId ?? '').trim();
    if (!orderId) {
      this.updateShippingLabelUpload(index, {
        status: 'error',
        error: this.translate.instant('adminUi.orders.shippingLabelsModal.errors.missingOrder')
      });
      return;
    }
    this.shippingLabelsBusy = true;
    this.updateShippingLabelUpload(index, { status: 'uploading', error: null });
    this.ordersApi
      .uploadShippingLabel(orderId, item.file)
      .pipe(
        finalize(() => {
          this.shippingLabelsBusy = false;
        })
      )
      .subscribe({
        next: () => {
          this.updateShippingLabelUpload(index, { status: 'success', error: null });
          this.toast.success(this.translate.instant('adminUi.orders.shippingLabelsModal.success.uploaded'));
        },
        error: (err) => {
          const requestId = extractRequestId(err);
          const suffix = requestId ? ` (${requestId})` : '';
          this.updateShippingLabelUpload(index, {
            status: 'error',
            error: `${this.translate.instant('adminUi.orders.shippingLabelsModal.errors.uploadFailed')}${suffix}`
          });
          this.toast.error(this.translate.instant('adminUi.orders.shippingLabelsModal.errors.uploadFailed'));
        }
      });
  }

  downloadSelectedShippingLabelsZip(): void {
    if (!this.selectedIds.size || this.shippingLabelsBusy) return;
    const ids = Array.from(this.selectedIds);
    this.shippingLabelsBusy = true;
    this.ordersApi.downloadBatchShippingLabelsZip(ids).subscribe({
      next: (blob) => {
        this.downloadBlob(blob, 'shipping-labels.zip');
        this.toast.success(this.translate.instant('adminUi.orders.shippingLabelsModal.success.zipReady'));
        this.shippingLabelsBusy = false;
      },
      error: (err) => {
        const detail = (err?.error?.detail ?? null) as any;
        const missing: string[] = Array.isArray(detail?.missing_shipping_label_order_ids)
          ? detail.missing_shipping_label_order_ids
          : [];
        if (missing.length) {
          this.toast.error(
            this.translate.instant('adminUi.orders.shippingLabelsModal.errors.missingLabels', { count: missing.length })
          );
        } else {
          this.toast.error(this.translate.instant('adminUi.orders.shippingLabelsModal.errors.zipFailed'));
        }
        this.shippingLabelsBusy = false;
      }
    });
  }

  shippingLabelStatusLabelKey(status: ShippingLabelsUploadStatus): string {
    return `adminUi.orders.shippingLabelsModal.status.${status}`;
  }

  shippingLabelStatusPillClass(status: ShippingLabelsUploadStatus): string {
    switch (status) {
      case 'success':
        return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200';
      case 'uploading':
        return 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-200';
      case 'error':
        return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200';
      default:
        return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200';
    }
  }

  private updateShippingLabelUpload(index: number, patch: Partial<ShippingLabelsUploadItem>): void {
    const next = this.shippingLabelsUploads.slice();
    if (!next[index]) return;
    next[index] = { ...next[index], ...patch };
    this.shippingLabelsUploads = next;
  }

  private autoAssignShippingLabel(file: File): string | null {
    const name = (file?.name ?? '').toLowerCase();
    for (const opt of this.shippingLabelsOrderOptions) {
      if (opt.ref && name.includes(opt.ref.toLowerCase())) return opt.id;
    }
    for (const opt of this.shippingLabelsOrderOptions) {
      if (opt.shortId && name.includes(opt.shortId.toLowerCase())) return opt.id;
    }
    return null;
  }

  private buildShippingLabelsOrderOptions(): ShippingLabelsOrderOption[] {
    const orders = this.orders();
    const byId = new Map<string, AdminOrderListItem>();
    for (const order of orders) byId.set(order.id, order);
    return Array.from(this.selectedIds).map((id) => {
      const order = byId.get(id);
      const ref = (order?.reference_code ?? '').toString().trim();
      const shortId = id.slice(0, 8);
      const label = ref ? `${ref} (${shortId})` : shortId;
      return { id, ref, shortId, label };
    });
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  goToPage(page: number): void {
    this.page = page;
    this.load();
  }

  trackOrderId(_: number, order: AdminOrderListItem): string {
    return order.id;
  }

  open(orderId: string): void {
    const queryParams: Record<string, string | number | boolean> = {
      nav: 1,
      nav_page: this.page,
      nav_limit: this.limit
    };
    const q = this.q.trim();
    if (q) queryParams['nav_q'] = q;
    if (this.status !== 'all') queryParams['nav_status'] = this.status;
    if (this.sla !== 'all') queryParams['nav_sla'] = this.sla;
    if (this.fraud !== 'all') queryParams['nav_fraud'] = this.fraud;
    const tag = this.tag.trim();
    if (tag) queryParams['nav_tag'] = tag;
    if (!this.includeTestOrders) queryParams['nav_include_test'] = 0;
    if (this.fromDate) queryParams['nav_from'] = `${this.fromDate}T00:00:00Z`;
    if (this.toDate) queryParams['nav_to'] = `${this.toDate}T23:59:59Z`;

    void this.router.navigate(['/admin/orders', orderId], { queryParams });
  }

  openExports(): void {
    void this.router.navigate(['/admin/orders/exports']);
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

  tagChipColorClass(tag: string): string {
    return tagChipColorClassFromHelper(tag, this.tagColorOverrides);
  }

  openTagManager(): void {
    this.tagManagerOpen.set(true);
    this.tagManagerError.set(null);
    this.tagRenameError = '';
    this.tagRenameFrom = '';
    this.tagRenameTo = '';
    this.reloadTagManager();
  }

  closeTagManager(): void {
    this.tagManagerOpen.set(false);
    this.tagManagerError.set(null);
    this.tagManagerQuery = '';
    this.tagManagerRows.set([]);
    this.tagRenameError = '';
  }

  reloadTagManager(): void {
    this.tagManagerLoading.set(true);
    this.tagManagerError.set(null);
    this.ordersApi.listOrderTagStats().subscribe({
      next: (rows) => {
        this.tagManagerRows.set(rows || []);
        this.tagManagerLoading.set(false);
      },
      error: () => {
        this.tagManagerError.set(this.translate.instant('adminUi.orders.tags.errors.load'));
        this.tagManagerLoading.set(false);
      }
    });
    this.refreshTagOptions();
  }

  filteredTagManagerRows(): AdminOrderTagStat[] {
    const rows = this.tagManagerRows();
    const q = (this.tagManagerQuery || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const tag = (row.tag || '').toLowerCase();
      const label = (this.tagLabel(row.tag) || '').toLowerCase();
      return tag.includes(q) || label.includes(q);
    });
  }

  tagColorValue(tag: string): TagColor {
    return tagColorFor(tag, this.tagColorOverrides);
  }

  setTagColor(tag: string, value: string): void {
    const normalizedTag = normalizeTagKey(tag);
    const color = (value || '').toString().trim() as TagColor;
    if (!normalizedTag || !this.tagColorPalette.includes(color)) return;
    this.tagColorOverrides[normalizedTag] = color;
    persistTagColorOverrides(this.tagColorOverrides);
  }

  resetTagColor(tag: string): void {
    const normalizedTag = normalizeTagKey(tag);
    if (!normalizedTag) return;
    delete this.tagColorOverrides[normalizedTag];
    persistTagColorOverrides(this.tagColorOverrides);
  }

  applyBulkTags(): void {
    if (!this.selectedIds.size) return;
    const addTag = (this.bulkTagAdd || '').trim();
    const removeTag = (this.bulkTagRemove || '').trim();
    if (!addTag && !removeTag) {
      this.toast.error(this.translate.instant('adminUi.orders.bulk.errors.chooseTagAction'));
      return;
    }

    const ops: { kind: 'add' | 'remove'; tag: string }[] = [];
    if (removeTag) ops.push({ kind: 'remove', tag: removeTag });
    if (addTag) ops.push({ kind: 'add', tag: addTag });

    const ids = Array.from(this.selectedIds);
    this.bulkBusy = true;
    from(ids)
      .pipe(
        mergeMap(
          (id) =>
            from(ops).pipe(
              concatMap((op) =>
                op.kind === 'add'
                  ? this.ordersApi.addOrderTag(id, op.tag).pipe(
                      map(() => true),
                      catchError(() => of(false))
                    )
                  : this.ordersApi.removeOrderTag(id, op.tag).pipe(
                      map(() => true),
                      catchError(() => of(false))
                    )
              ),
              toArray(),
              map((results) => ({ id, ok: results.every(Boolean) }))
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
        this.bulkTagAdd = '';
        this.bulkTagRemove = '';
        this.refreshTagOptions();
        this.load();
      });
  }

  renameTag(): void {
    if (this.tagRenameBusy) return;
    const fromTag = (this.tagRenameFrom || '').trim();
    const toTag = (this.tagRenameTo || '').trim();
    if (!fromTag || !toTag) {
      this.tagRenameError = this.translate.instant('adminUi.orders.tags.errors.renameRequired');
      return;
    }
    const ok = window.confirm(
      this.translate.instant('adminUi.orders.tags.renameConfirm', { from: fromTag, to: toTag })
    );
    if (!ok) return;

    this.tagRenameBusy = true;
    this.tagRenameError = '';
    this.ordersApi.renameOrderTag({ from_tag: fromTag, to_tag: toTag }).subscribe({
      next: (res) => {
        const fromKey = normalizeTagKey(res.from_tag || fromTag);
        const toKey = normalizeTagKey(res.to_tag || toTag);
        if (fromKey && toKey && this.tagColorOverrides[fromKey] && !this.tagColorOverrides[toKey]) {
          this.tagColorOverrides[toKey] = this.tagColorOverrides[fromKey];
        }
        if (fromKey) delete this.tagColorOverrides[fromKey];
        persistTagColorOverrides(this.tagColorOverrides);

        if (this.tag === fromKey) this.tag = toKey;
        this.toast.success(this.translate.instant('adminUi.orders.tags.renamed', { count: res.total }));
        this.tagRenameFrom = '';
        this.tagRenameTo = '';
        this.reloadTagManager();
        this.load();
      },
      error: (err) => {
        this.tagRenameError = err?.error?.detail || this.translate.instant('adminUi.orders.tags.errors.rename');
      },
      complete: () => {
        this.tagRenameBusy = false;
      }
    });
  }

  private refreshTagOptions(): void {
    this.ordersApi.listOrderTags().subscribe({
      next: (tags) => {
        const merged = new Set<string>(['vip', 'fraud_risk', 'fraud_approved', 'fraud_denied', 'gift', 'test']);
        for (const t of tags) merged.add(t);
        this.tagOptions.set(Array.from(merged).sort());
      },
      error: () => {
        // ignore
      }
    });
  }

  statusPillClass(status: string): string {
    return orderStatusChipClass(status);
  }

  slaBadge(
    order: AdminOrderListItem
  ): { label: string; title: string; className: string } | null {
    const kind = (order?.sla_kind ?? '').toString().trim().toLowerCase();
    const dueRaw = (order?.sla_due_at ?? '').toString().trim();
    if (!kind || !dueRaw) return null;
    const dueTs = Date.parse(dueRaw);
    if (!Number.isFinite(dueTs)) return null;

    const kindKey =
      kind === 'accept'
        ? 'adminUi.orders.sla.badges.accept'
        : kind === 'ship'
          ? 'adminUi.orders.sla.badges.ship'
          : null;
    if (!kindKey) return null;

    const kindLabel = this.translate.instant(kindKey);
    const now = Date.now();
    const diffMs = dueTs - now;
    const time = this.formatDurationShort(Math.abs(diffMs));
    const dueSoonMs = 4 * 60 * 60 * 1000;

    if (diffMs <= 0) {
      const label = this.translate.instant('adminUi.orders.sla.badges.overdue', { kind: kindLabel, time });
      return {
        label,
        title: label,
        className:
          'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-100'
      };
    }

    if (diffMs <= dueSoonMs) {
      const label = this.translate.instant('adminUi.orders.sla.badges.dueSoon', { kind: kindLabel, time });
      return {
        label,
        title: label,
        className:
          'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100'
      };
    }

    return null;
  }

  fraudBadge(
    order: AdminOrderListItem
  ): { label: string; title: string; className: string } | null {
    const severity = (order?.fraud_severity ?? '').toString().trim().toLowerCase();
    if (!severity) return null;

    const severityKey = `adminUi.orders.fraudSignals.severity.${severity}`;
    const translatedSeverity = this.translate.instant(severityKey);
    const severityLabel = translatedSeverity === severityKey ? severity : translatedSeverity;
    const label = this.translate.instant('adminUi.orders.fraud.badges.label', { severity: severityLabel });

    const className =
      severity === 'high'
        ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-100'
        : severity === 'medium'
          ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100'
          : severity === 'low'
            ? 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-950/30 dark:text-sky-100'
            : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-100';

    return { label, title: label, className };
  }

  private formatDurationShort(ms: number): string {
    const minutes = Math.max(0, Math.round(ms / 60_000));
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours}h`;
    const days = Math.round(hours / 24);
    return `${days}d`;
  }

  private load(): void {
    if (this.viewMode() === 'kanban') {
      this.loadKanban();
      return;
    }

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
    if (this.sla !== 'all') params.sla = this.sla;
    if (this.fraud !== 'all') params.fraud = this.fraud;
    const tag = this.tag.trim();
    if (tag) params.tag = tag;
    if (!this.includeTestOrders) params.include_test = false;
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

  private loadKanban(): void {
    this.loading.set(true);
    this.error.set(null);
    this.errorRequestId.set(null);
    this.orders.set([]);
    this.meta.set(null);

    const statuses = this.kanbanColumnStatuses();
    const baseParams: Parameters<AdminOrdersService['search']>[0] = {
      page: 1,
      limit: this.limit
    };
    const q = this.q.trim();
    if (q) baseParams.q = q;
    const tag = this.tag.trim();
    if (tag) baseParams.tag = tag;
    if (this.sla !== 'all') baseParams.sla = this.sla;
    if (this.fraud !== 'all') baseParams.fraud = this.fraud;
    if (!this.includeTestOrders) baseParams.include_test = false;
    if (this.fromDate) baseParams.from = `${this.fromDate}T00:00:00Z`;
    if (this.toDate) baseParams.to = `${this.toDate}T23:59:59Z`;

    from(statuses)
      .pipe(
        mergeMap(
          (statusValue) =>
            this.ordersApi.search({ ...baseParams, status: statusValue }).pipe(
              map((res) => ({ status: statusValue, res })),
              catchError((err) => of({ status: statusValue, err, res: null as any }))
            ),
          4
        ),
        toArray()
      )
      .subscribe({
        next: (results) => {
          const itemsByStatus: Record<string, AdminOrderListItem[]> = {};
          const totalsByStatus: Record<string, number> = {};
          let firstError: any = null;

          for (const result of results) {
            if (result?.res) {
              itemsByStatus[result.status] = result.res.items ?? [];
              totalsByStatus[result.status] = result.res.meta?.total_items ?? (result.res.items ?? []).length;
              continue;
            }
            itemsByStatus[result.status] = [];
            totalsByStatus[result.status] = 0;
            if (!firstError) firstError = (result as any).err;
          }

          this.kanbanItemsByStatus.set(itemsByStatus);
          this.kanbanTotalsByStatus.set(totalsByStatus);
          if (firstError) {
            this.error.set(this.translate.instant('adminUi.orders.errors.load'));
            this.errorRequestId.set(extractRequestId(firstError));
          }
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

  private viewModeStorageKey(): string {
    const userId = (this.auth.user()?.id ?? '').trim();
    return `admin.orders.view.v1:${userId || 'anonymous'}`;
  }

  private loadViewMode(): AdminOrdersViewMode {
    try {
      const raw = localStorage.getItem(this.viewModeStorageKey());
      return raw === 'kanban' || raw === 'table' ? raw : 'table';
    } catch {
      return 'table';
    }
  }

  private persistViewMode(): void {
    try {
      localStorage.setItem(this.viewModeStorageKey(), this.viewMode());
    } catch {
      // ignore
    }
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
            sla: ((): SlaFilter => {
              const raw = String(candidate?.filters?.sla ?? 'all');
              return raw === 'any_overdue' || raw === 'accept_overdue' || raw === 'ship_overdue' ? raw : 'all';
            })(),
            fraud: ((): FraudFilter => {
              const raw = String(candidate?.filters?.fraud ?? 'all');
              return raw === 'queue' || raw === 'flagged' || raw === 'approved' || raw === 'denied' ? raw : 'all';
            })(),
            tag: String(candidate?.filters?.tag ?? ''),
            fromDate: String(candidate?.filters?.fromDate ?? ''),
            toDate: String(candidate?.filters?.toDate ?? ''),
            includeTestOrders:
              typeof candidate?.filters?.includeTestOrders === 'boolean' ? candidate.filters.includeTestOrders : true,
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
