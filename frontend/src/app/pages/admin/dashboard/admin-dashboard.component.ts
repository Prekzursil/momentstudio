import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnInit, ViewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { BreadcrumbComponent, Crumb } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { CardComponent } from '../../../shared/card.component';
import { InputComponent } from '../../../shared/input.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { AuthService } from '../../../core/auth.service';
import {
  AdminAuditEntriesResponse,
  AdminAuditEntity,
  AdminAuditEntryUnified,
  AdminAuditRetentionResponse,
  AdminDashboardScheduledTasksResponse,
  AdminDashboardSearchResult,
  AdminDashboardSearchResultType,
  AdminDashboardWindowMetric,
  ScheduledPromoItem,
  ScheduledPublishItem,
  AdminService,
  AdminSummary
} from '../../../core/admin.service';
import { AdminOrdersService } from '../../../core/admin-orders.service';
import { ToastService } from '../../../core/toast.service';
import { LocalizedCurrencyPipe } from '../../../shared/localized-currency.pipe';

type MetricWidgetId = 'kpis' | 'counts' | 'range';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
    BreadcrumbComponent,
    CardComponent,
    ButtonComponent,
    InputComponent,
    SkeletonComponent,
    LocalizedCurrencyPipe
  ],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <div *ngIf="error()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
        {{ error() }}
      </div>

      <div *ngIf="loading(); else dashboardTpl">
        <app-skeleton [rows]="6"></app-skeleton>
      </div>

	      <ng-template #dashboardTpl>
	        <section class="grid gap-3">
	          <div class="flex items-center justify-between gap-3 flex-wrap">
	            <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.dashboardTitle' | translate }}</h1>
	            <app-button
	              size="sm"
	              variant="ghost"
	              [label]="'adminUi.dashboard.customizeWidgets' | translate"
	              (action)="toggleCustomizeWidgets()"
	            ></app-button>
	          </div>

	          <div class="grid gap-3">
	            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
	              {{ 'adminUi.dashboard.quickActionsTitle' | translate }}
	            </p>

	            <div class="grid gap-3 md:grid-cols-[1fr_auto] items-end">
	              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'adminUi.dashboard.globalSearchLabel' | translate }}</span>
	                <div class="relative">
	                  <input
                      #globalSearchInput
                      id="admin-global-search"
	                    class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                    [placeholder]="'adminUi.dashboard.globalSearchPlaceholder' | translate"
	                    [(ngModel)]="globalSearchQuery"
	                    (ngModelChange)="onGlobalSearchChange()"
	                    (focus)="openGlobalSearch()"
	                    (blur)="onGlobalSearchBlur()"
	                    (keydown)="onGlobalSearchKeydown($event)"
	                  />

	                  <div
	                    *ngIf="globalSearchOpen()"
	                    class="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900"
	                  >
	                    <div *ngIf="globalSearchLoading()" class="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
	                      {{ 'adminUi.dashboard.globalSearchLoading' | translate }}
	                    </div>
	                    <div *ngIf="globalSearchError" class="px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
	                      {{ globalSearchError }}
	                    </div>

	                    <ng-container *ngIf="!globalSearchLoading() && !globalSearchError">
	                      <div
	                        *ngIf="globalSearchResults().length === 0 && (globalSearchQuery || '').trim().length >= 2"
	                        class="px-3 py-2 text-xs text-slate-600 dark:text-slate-300"
	                      >
	                        {{ 'adminUi.dashboard.globalSearchEmpty' | translate }}
	                      </div>
	                      <div *ngIf="globalSearchResults().length > 0" class="max-h-72 overflow-auto">
	                        <button
	                          *ngFor="let item of globalSearchResults()"
	                          type="button"
	                          class="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60"
	                          (mousedown)="selectGlobalSearch(item)"
	                        >
	                          <div class="flex items-center justify-between gap-3">
	                            <span class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
	                              {{ globalSearchTypeLabel(item.type) }}
	                            </span>
	                            <span *ngIf="item.slug || item.email" class="text-xs text-slate-500 dark:text-slate-400 truncate">
	                              {{ item.slug || item.email }}
	                            </span>
	                          </div>
	                          <div class="mt-1 font-medium text-slate-900 dark:text-slate-50 truncate">{{ item.label }}</div>
	                          <div *ngIf="item.subtitle" class="text-xs text-slate-600 dark:text-slate-300 truncate">{{ item.subtitle }}</div>
	                        </button>
	                      </div>
	                    </ng-container>
	                  </div>
	                </div>
	              </label>

	              <div class="flex flex-wrap gap-2">
	                <app-button size="sm" [label]="'adminUi.dashboard.quickActions.createProduct' | translate" (action)="goToCreateProduct()"></app-button>
	                <app-button size="sm" [label]="'adminUi.dashboard.quickActions.createCoupon' | translate" (action)="goToCreateCoupon()"></app-button>
	                <app-button
	                  size="sm"
	                  variant="ghost"
	                  [label]="'adminUi.dashboard.quickActions.exportOrders' | translate"
	                  (action)="downloadOrdersExport()"
	                ></app-button>
	              </div>
	            </div>
	          </div>

	          <div
	            *ngIf="customizeWidgetsOpen()"
	            class="rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900"
	          >
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {{ 'adminUi.dashboard.widgetsTitle' | translate }}
            </p>
            <div class="mt-3 grid gap-2">
              <div
                *ngFor="let widget of metricWidgets(); let i = index"
                class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950"
              >
                <label class="flex items-center gap-2">
                  <input
                    type="checkbox"
                    class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-900"
                    [checked]="!isMetricWidgetHidden(widget)"
                    (change)="toggleMetricWidget(widget)"
                  />
                  <span class="text-slate-800 dark:text-slate-100">{{ metricWidgetLabel(widget) }}</span>
                </label>
                <div class="flex items-center gap-2">
                  <app-button
                    size="sm"
                    variant="ghost"
                    [disabled]="i === 0"
                    [label]="'adminUi.actions.up' | translate"
                    (action)="moveMetricWidget(widget, -1)"
                  ></app-button>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [disabled]="i === metricWidgets().length - 1"
                    [label]="'adminUi.actions.down' | translate"
                    (action)="moveMetricWidget(widget, 1)"
                  ></app-button>
                </div>
              </div>
            </div>
          </div>

          <ng-container *ngFor="let widget of metricWidgets()">
            <ng-container *ngIf="!isMetricWidgetHidden(widget)">
              <ng-container [ngSwitch]="widget">
                <div *ngSwitchCase="'kpis'" class="grid md:grid-cols-3 gap-4">
                  <app-card [title]="'adminUi.cards.ordersToday' | translate">
                    <div class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ summary()?.today_orders || 0 }}</div>
                    <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.cards.vsYesterday' | translate }}: {{ summary()?.yesterday_orders || 0 }} ·
                      {{ deltaLabel(summary()?.orders_delta_pct) }}
                    </div>
                  </app-card>
                  <app-card [title]="'adminUi.cards.salesToday' | translate">
                    <div class="text-2xl font-semibold text-slate-900 dark:text-slate-50">
                      {{ (summary()?.today_sales || 0) | localizedCurrency : 'RON' }}
                    </div>
                    <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.cards.vsYesterday' | translate }}: {{ (summary()?.yesterday_sales || 0) | localizedCurrency : 'RON' }} ·
                      {{ deltaLabel(summary()?.sales_delta_pct) }}
                    </div>
                  </app-card>
                  <app-card [title]="'adminUi.cards.refundsToday' | translate">
                    <div class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ summary()?.today_refunds || 0 }}</div>
                    <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.cards.vsYesterday' | translate }}: {{ summary()?.yesterday_refunds || 0 }} ·
                      {{ deltaLabel(summary()?.refunds_delta_pct) }}
                    </div>
                  </app-card>
                </div>

                <div *ngSwitchCase="'counts'" class="grid md:grid-cols-3 gap-4">
                  <app-card
                    [title]="'adminUi.cards.products' | translate"
                    [subtitle]="'adminUi.cards.countTotal' | translate: { count: summary()?.products || 0 }"
                  ></app-card>
                  <app-card
                    [title]="'adminUi.cards.orders' | translate"
                    [subtitle]="'adminUi.cards.countTotal' | translate: { count: summary()?.orders || 0 }"
                  ></app-card>
                  <app-card
                    [title]="'adminUi.cards.users' | translate"
                    [subtitle]="'adminUi.cards.countTotal' | translate: { count: summary()?.users || 0 }"
                  ></app-card>
                </div>

                <div *ngSwitchCase="'range'" class="grid gap-3">
                  <div class="flex flex-wrap items-end justify-between gap-3">
                    <div class="flex flex-wrap items-end gap-3">
                      <label class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                        <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'adminUi.dashboard.rangeLabel' | translate }}</span>
                        <select
                          class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
                          [(ngModel)]="rangePreset"
                          (ngModelChange)="onRangePresetChange()"
                        >
                          <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="7">
                            {{ 'adminUi.dashboard.lastDays' | translate: { days: 7 } }}
                          </option>
                          <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="30">
                            {{ 'adminUi.dashboard.lastDays' | translate: { days: 30 } }}
                          </option>
                          <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="90">
                            {{ 'adminUi.dashboard.lastDays' | translate: { days: 90 } }}
                          </option>
                          <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="custom">
                            {{ 'adminUi.dashboard.customRange' | translate }}
                          </option>
                        </select>
                      </label>

                      <label *ngIf="rangePreset === 'custom'" class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                        <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'adminUi.dashboard.rangeFrom' | translate }}</span>
                        <input
                          type="date"
                          class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
                          [(ngModel)]="rangeFrom"
                        />
                      </label>
                      <label *ngIf="rangePreset === 'custom'" class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                        <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'adminUi.dashboard.rangeTo' | translate }}</span>
                        <input
                          type="date"
                          class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
                          [(ngModel)]="rangeTo"
                        />
                      </label>

                      <app-button size="sm" [label]="'adminUi.dashboard.applyRange' | translate" (action)="applyRange()"></app-button>
                    </div>

                    <p *ngIf="summary()" class="text-xs text-slate-500 dark:text-slate-400">
                      {{ summary()?.range_from | date: 'mediumDate' }} → {{ summary()?.range_to | date: 'mediumDate' }}
                    </p>
                  </div>

                  <div *ngIf="rangeError" class="text-sm text-rose-700 dark:text-rose-300">
                    {{ rangeError }}
                  </div>

                  <div class="grid md:grid-cols-3 gap-4">
                    <app-card
                      [title]="'adminUi.cards.lowStock' | translate"
                      [subtitle]="'adminUi.cards.countItems' | translate: { count: summary()?.low_stock || 0 }"
                    ></app-card>
                    <app-card
                      [title]="'adminUi.cards.salesRange' | translate: { days: summary()?.range_days || 30 }"
                      [subtitle]="(summary()?.sales_range || 0) | localizedCurrency : 'RON'"
                    ></app-card>
                    <app-card
                      [title]="'adminUi.cards.ordersRange' | translate: { days: summary()?.range_days || 30 }"
                      [subtitle]="'adminUi.cards.countOrders' | translate: { count: summary()?.orders_range || 0 }"
                    ></app-card>
                  </div>
                </div>
              </ng-container>
            </ng-container>
	          </ng-container>
	        </section>

	        <section class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	          <div class="flex items-center justify-between gap-3 flex-wrap">
	            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.dashboard.alertsTitle' | translate }}</h2>
	          </div>

	          <div *ngIf="!hasAnomalyAlerts()" class="text-sm text-slate-600 dark:text-slate-300">
	            {{ 'adminUi.dashboard.alertsEmpty' | translate }}
	          </div>

	          <div *ngIf="hasAnomalyAlerts()" class="grid gap-4 md:grid-cols-3">
	            <div
	              *ngIf="failedPaymentsAlert() as failed"
	              class="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-slate-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
	            >
	              <p class="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700 dark:text-rose-200">
	                {{ 'adminUi.dashboard.alerts.failedPayments' | translate }}
	              </p>
	              <div class="mt-2 text-2xl font-semibold text-rose-900 dark:text-rose-50">{{ failed.current }}</div>
	              <p class="mt-1 text-xs text-rose-700 dark:text-rose-200">
	                {{ 'adminUi.dashboard.alerts.windowHours' | translate: { hours: failed.window_hours || 24 } }} ·
	                {{ 'adminUi.dashboard.alerts.vsPrevious' | translate }}: {{ failed.previous }} · {{ deltaLabel(failed.delta_pct) }}
	              </p>
	            </div>

	            <div
	              *ngIf="refundRequestsAlert() as refunds"
	              class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-slate-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
	            >
	              <p class="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-200">
	                {{ 'adminUi.dashboard.alerts.refundRequests' | translate }}
	              </p>
	              <div class="mt-2 text-2xl font-semibold text-amber-900 dark:text-amber-50">{{ refunds.current }}</div>
	              <p class="mt-1 text-xs text-amber-700 dark:text-amber-200">
	                {{ 'adminUi.dashboard.alerts.windowDays' | translate: { days: refunds.window_days || 7 } }} ·
	                {{ 'adminUi.dashboard.alerts.vsPrevious' | translate }}: {{ refunds.previous }} · {{ deltaLabel(refunds.delta_pct) }}
	              </p>
	            </div>

	            <div
	              *ngIf="stockoutsAlertCount() as stockouts"
	              class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-slate-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
	            >
	              <p class="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-200">
	                {{ 'adminUi.dashboard.alerts.stockouts' | translate }}
	              </p>
	              <div class="mt-2 text-2xl font-semibold text-amber-900 dark:text-amber-50">{{ stockouts }}</div>
	              <p class="mt-1 text-xs text-amber-700 dark:text-amber-200">
	                {{ 'adminUi.dashboard.alerts.stockoutsHint' | translate }}
	              </p>
	            </div>
	          </div>
	        </section>

	        <section class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	          <div class="flex items-center justify-between gap-3 flex-wrap">
	            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
	              {{ 'adminUi.dashboard.systemHealthTitle' | translate }}
	            </h2>
	          </div>

	          <div class="grid gap-3 md:grid-cols-2">
	            <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
	              <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
	                {{ 'adminUi.dashboard.systemHealth.db' | translate }}
	              </p>
	              <p class="mt-2 font-semibold text-slate-900 dark:text-slate-50">
	                {{
	                  summary()?.system?.db_ready
	                    ? ('adminUi.dashboard.systemHealth.ready' | translate)
	                    : ('adminUi.dashboard.systemHealth.unavailable' | translate)
	                }}
	              </p>
	            </div>

	            <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
	              <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
	                {{ 'adminUi.dashboard.systemHealth.backup' | translate }}
	              </p>
	              <ng-container *ngIf="summary()?.system?.backup_last_at as backupLastAt; else backupEmpty">
	                <p class="mt-2 font-semibold text-slate-900 dark:text-slate-50">{{ backupLastAt | date: 'medium' }}</p>
	              </ng-container>
	              <ng-template #backupEmpty>
	                <p class="mt-2 text-sm text-slate-600 dark:text-slate-300">
	                  {{ 'adminUi.dashboard.systemHealth.backupNotConfigured' | translate }}
	                </p>
	              </ng-template>
	            </div>
	          </div>
	        </section>

	        <section class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	          <div class="flex items-center justify-between gap-3 flex-wrap">
	            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.dashboard.scheduledTitle' | translate }}</h2>
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadScheduledTasks()"></app-button>
	          </div>

            <div *ngIf="scheduledError()" class="text-sm text-rose-700 dark:text-rose-300">
              {{ scheduledError() }}
            </div>

            <div *ngIf="scheduledLoading()" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.dashboard.scheduledLoading' | translate }}
            </div>

	          <div *ngIf="!scheduledLoading()" class="grid gap-4 lg:grid-cols-2">
              <div class="grid gap-2">
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.dashboard.scheduledPublishesTitle' | translate }}
                </p>

                <div *ngIf="scheduledTasks()?.publish_schedules?.length; else emptyPublishesTpl" class="grid gap-2">
                  <div
                    *ngFor="let item of scheduledTasks()?.publish_schedules"
                    class="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20"
                  >
                    <div class="min-w-0">
                      <p class="truncate font-semibold text-slate-900 dark:text-slate-50">{{ item.name }}</p>
                      <p class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        {{ 'adminUi.dashboard.scheduledFor' | translate }}: {{ item.scheduled_for | date: 'short' }}
                      </p>
                      <p *ngIf="item.sale_end_at" class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        {{ 'adminUi.dashboard.scheduledSaleEnds' | translate }}: {{ item.sale_end_at | date: 'short' }}
                      </p>
                    </div>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.actions.open' | translate"
                      (action)="openScheduledPublish(item)"
                    ></app-button>
                  </div>
                </div>

                <ng-template #emptyPublishesTpl>
                  <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.dashboard.scheduledEmptyPublishes' | translate }}</p>
                </ng-template>
              </div>

              <div class="grid gap-2">
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.dashboard.scheduledPromosTitle' | translate }}
                </p>

                <div *ngIf="scheduledTasks()?.promo_schedules?.length; else emptyPromosTpl" class="grid gap-2">
                  <div
                    *ngFor="let promo of scheduledTasks()?.promo_schedules"
                    class="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20"
                  >
                    <div class="min-w-0">
                      <p class="truncate font-semibold text-slate-900 dark:text-slate-50">{{ promo.name }}</p>
                      <p class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        {{
                          promo.next_event_type === 'starts_at'
                            ? ('adminUi.dashboard.promoStartsAt' | translate)
                            : ('adminUi.dashboard.promoEndsAt' | translate)
                        }}: {{ promo.next_event_at | date: 'short' }}
                      </p>
                      <p *ngIf="promo.starts_at || promo.ends_at" class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        <ng-container *ngIf="promo.starts_at">{{ 'adminUi.dashboard.promoStartsShort' | translate }} {{ promo.starts_at | date: 'short' }}</ng-container>
                        <ng-container *ngIf="promo.starts_at && promo.ends_at"> · </ng-container>
                        <ng-container *ngIf="promo.ends_at">{{ 'adminUi.dashboard.promoEndsShort' | translate }} {{ promo.ends_at | date: 'short' }}</ng-container>
                      </p>
                    </div>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.actions.open' | translate"
                      (action)="openScheduledPromo(promo)"
                    ></app-button>
                  </div>
                </div>

                <ng-template #emptyPromosTpl>
                  <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.dashboard.scheduledEmptyPromos' | translate }}</p>
                </ng-template>
              </div>
	          </div>
	        </section>

	        <section class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	          <div class="flex items-center justify-between gap-3 flex-wrap">
	            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.audit.title' | translate }}</h2>
            <div class="flex items-center gap-3 flex-wrap">
              <label class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-indigo-600"
                  [(ngModel)]="auditExportRedact"
                  [disabled]="!isOwner()"
                />
                {{ 'adminUi.audit.redactLabel' | translate }}
              </label>
              <span *ngIf="!isOwner()" class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.redactLocked' | translate }}</span>
              <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.audit.exportLimitNote' | translate }}</span>
              <app-button size="sm" [label]="'adminUi.audit.export' | translate" (action)="downloadAuditCsv()"></app-button>
            </div>
          </div>

          <div class="grid gap-3 md:grid-cols-[220px_1fr_1fr_auto] items-end">
            <label class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
              <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ 'adminUi.audit.filters.entity' | translate }}</span>
              <select
                class="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 [color-scheme:light] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:[color-scheme:dark]"
                [(ngModel)]="auditEntity"
                [attr.aria-label]="'adminUi.audit.filters.entity' | translate"
              >
                <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="all">
                  {{ 'adminUi.audit.entityAll' | translate }}
                </option>
                <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="product">
                  {{ 'adminUi.audit.products' | translate }}
                </option>
                <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="content">
                  {{ 'adminUi.audit.content' | translate }}
                </option>
                <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="security">
                  {{ 'adminUi.audit.security' | translate }}
                </option>
              </select>
            </label>

            <app-input
              [label]="'adminUi.audit.filters.action' | translate"
              [(value)]="auditAction"
              [placeholder]="'adminUi.audit.filters.actionPlaceholder' | translate"
              [ariaLabel]="'adminUi.audit.filters.action' | translate"
            ></app-input>

            <app-input
              [label]="'adminUi.audit.filters.user' | translate"
              [(value)]="auditUser"
              [placeholder]="'adminUi.audit.filters.userPlaceholder' | translate"
              [ariaLabel]="'adminUi.audit.filters.user' | translate"
            ></app-input>

            <app-button size="sm" [label]="'adminUi.audit.filters.apply' | translate" (action)="applyAuditFilters()"></app-button>
          </div>

          <div *ngIf="auditError()" class="text-sm text-rose-700 dark:text-rose-300">
            {{ auditError() }}
          </div>

          <div *ngIf="auditLoading(); else auditTpl">
            <app-skeleton [rows]="6"></app-skeleton>
          </div>

          <ng-template #auditTpl>
            <div *ngIf="auditEntries()?.items?.length; else auditEmptyTpl" class="grid gap-2">
              <div class="overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table class="min-w-[900px] w-full text-sm">
	                  <thead class="bg-slate-50 text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
	                    <tr>
	                      <th class="text-left px-3 py-2 font-semibold">{{ 'adminUi.audit.at' | translate }}</th>
	                      <th class="text-left px-3 py-2 font-semibold">{{ 'adminUi.audit.filters.entity' | translate }}</th>
	                      <th class="text-left px-3 py-2 font-semibold">{{ 'adminUi.audit.filters.action' | translate }}</th>
	                      <th class="text-left px-3 py-2 font-semibold">{{ 'adminUi.audit.actor' | translate }}</th>
	                      <th class="text-left px-3 py-2 font-semibold">{{ 'adminUi.audit.subject' | translate }}</th>
	                      <th class="text-left px-3 py-2 font-semibold">{{ 'adminUi.audit.reference' | translate }}</th>
	                      <th class="text-right px-3 py-2 font-semibold">{{ 'adminUi.actions.open' | translate }}</th>
	                    </tr>
	                  </thead>
	                  <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
	                    <tr *ngFor="let entry of auditEntries()?.items" class="text-slate-800 dark:text-slate-200">
                      <td class="px-3 py-2 whitespace-nowrap">{{ entry.created_at | date: 'short' }}</td>
                      <td class="px-3 py-2 whitespace-nowrap">
                        <span class="inline-flex rounded-full px-2 py-0.5 text-xs border border-slate-200 dark:border-slate-700">
                          {{ auditEntityLabel(entry.entity) }}
                        </span>
                      </td>
                      <td class="px-3 py-2">
                        <span *ngIf="entry.entity === 'security'; else rawActionTpl">
                          {{ ('adminUi.audit.securityActions.' + entry.action) | translate }}
                        </span>
                        <ng-template #rawActionTpl>{{ entry.action }}</ng-template>
                      </td>
                      <td class="px-3 py-2 whitespace-nowrap">{{ entry.actor_email || entry.actor_user_id || '—' }}</td>
                      <td class="px-3 py-2 whitespace-nowrap">{{ entry.subject_email || entry.subject_user_id || '—' }}</td>
	                      <td class="px-3 py-2">
	                        <span class="font-mono text-xs text-slate-600 dark:text-slate-400">
	                          {{ entry.ref_key || entry.ref_id || '—' }}
	                        </span>
	                      </td>
	                      <td class="px-3 py-2 text-right">
	                        <app-button
	                          size="sm"
	                          variant="ghost"
	                          [disabled]="!canOpenAuditEntry(entry)"
	                          [label]="'adminUi.actions.open' | translate"
	                          (action)="openAuditEntry(entry)"
	                        ></app-button>
	                      </td>
	                    </tr>
	                  </tbody>
	                </table>
	              </div>

              <div class="flex items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
                <span>
                  {{
                    'adminUi.audit.pagination' | translate: { page: auditEntries()?.meta?.page || 1, total: auditEntries()?.meta?.total_pages || 1 }
                  }}
                </span>
                <div class="flex items-center gap-2">
                  <app-button size="sm" [disabled]="!auditHasPrev()" [label]="'adminUi.audit.prev' | translate" (action)="auditPrev()"></app-button>
                  <app-button size="sm" [disabled]="!auditHasNext()" [label]="'adminUi.audit.next' | translate" (action)="auditNext()"></app-button>
                </div>
              </div>
            </div>

            <ng-template #auditEmptyTpl>
              <div class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.audit.empty' | translate }}</div>
            </ng-template>
          </ng-template>

          <div class="grid gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <h3 class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.audit.retention.title' | translate }}</h3>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.audit.retention.refresh' | translate"
                (action)="loadAuditRetention()"
              ></app-button>
            </div>
            <p class="text-xs text-slate-600 dark:text-slate-300">{{ 'adminUi.audit.retention.hint' | translate }}</p>

            <div *ngIf="auditRetentionError()" class="text-sm text-rose-700 dark:text-rose-300">
              {{ auditRetentionError() }}
            </div>

            <div *ngIf="auditRetentionLoading(); else retentionTpl">
              <app-skeleton [rows]="3"></app-skeleton>
            </div>

            <ng-template #retentionTpl>
              <div *ngIf="auditRetention() as retention" class="grid gap-2 md:grid-cols-3">
                <div class="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
                  <div class="font-medium text-slate-900 dark:text-slate-50">{{ 'adminUi.audit.products' | translate }}</div>
                  <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    <ng-container *ngIf="retention.policies.product.enabled; else productDisabledTpl">
                      {{ 'adminUi.audit.retention.enabled' | translate: { days: retention.policies.product.days } }}
                    </ng-container>
                    <ng-template #productDisabledTpl>{{ 'adminUi.audit.retention.disabled' | translate }}</ng-template>
                  </div>
                  <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    {{ 'adminUi.audit.retention.counts' | translate: { total: retention.counts.product.total, expired: retention.counts.product.expired } }}
                  </div>
                </div>

                <div class="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
                  <div class="font-medium text-slate-900 dark:text-slate-50">{{ 'adminUi.audit.content' | translate }}</div>
                  <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    <ng-container *ngIf="retention.policies.content.enabled; else contentDisabledTpl">
                      {{ 'adminUi.audit.retention.enabled' | translate: { days: retention.policies.content.days } }}
                    </ng-container>
                    <ng-template #contentDisabledTpl>{{ 'adminUi.audit.retention.disabled' | translate }}</ng-template>
                  </div>
                  <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    {{ 'adminUi.audit.retention.counts' | translate: { total: retention.counts.content.total, expired: retention.counts.content.expired } }}
                  </div>
                </div>

                <div class="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
                  <div class="font-medium text-slate-900 dark:text-slate-50">{{ 'adminUi.audit.security' | translate }}</div>
                  <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    <ng-container *ngIf="retention.policies.security.enabled; else securityDisabledTpl">
                      {{ 'adminUi.audit.retention.enabled' | translate: { days: retention.policies.security.days } }}
                    </ng-container>
                    <ng-template #securityDisabledTpl>{{ 'adminUi.audit.retention.disabled' | translate }}</ng-template>
                  </div>
                  <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    {{ 'adminUi.audit.retention.counts' | translate: { total: retention.counts.security.total, expired: retention.counts.security.expired } }}
                  </div>
                </div>

                <div *ngIf="isOwner()" class="grid gap-3 md:col-span-3">
                  <div *ngIf="auditRetentionPurgeError" class="text-sm text-rose-700 dark:text-rose-300">
                    {{ auditRetentionPurgeError }}
                  </div>
                  <div class="grid gap-3 md:grid-cols-[1fr_auto_auto] items-end text-sm">
                    <app-input
                      [label]="'adminUi.audit.retention.confirmLabel' | translate"
                      [(value)]="auditRetentionConfirm"
                      [placeholder]="'adminUi.audit.retention.confirmPlaceholder' | translate"
                      [ariaLabel]="'adminUi.audit.retention.confirmLabel' | translate"
                    ></app-input>
                    <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                      <input type="checkbox" class="h-4 w-4 accent-indigo-600" [(ngModel)]="auditRetentionDryRun" />
                      {{ 'adminUi.audit.retention.dryRun' | translate }}
                    </label>
                    <app-button
                      size="sm"
                      [disabled]="auditRetentionPurgeLoading || !auditRetentionConfirmOk()"
                      [label]="'adminUi.audit.retention.run' | translate"
                      (action)="purgeAuditRetention()"
                    ></app-button>
                  </div>
                </div>
              </div>
            </ng-template>
          </div>
        </section>

        <section
          *ngIf="isOwner()"
          class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.ownerTransfer.title' | translate }}</h2>
          </div>
          <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.ownerTransfer.description' | translate }}</p>

          <div class="grid gap-3 md:grid-cols-3 items-end text-sm">
            <app-input
              [label]="'adminUi.ownerTransfer.identifier' | translate"
              [(value)]="ownerTransferIdentifier"
              [placeholder]="'adminUi.ownerTransfer.identifierPlaceholder' | translate"
              [ariaLabel]="'adminUi.ownerTransfer.identifier' | translate"
            ></app-input>
            <app-input
              [label]="'adminUi.ownerTransfer.confirmLabel' | translate"
              [(value)]="ownerTransferConfirm"
              [placeholder]="'adminUi.ownerTransfer.confirmPlaceholder' | translate"
              [hint]="'adminUi.ownerTransfer.confirmHint' | translate"
              [ariaLabel]="'adminUi.ownerTransfer.confirmLabel' | translate"
            ></app-input>
            <app-input
              [label]="'auth.currentPassword' | translate"
              type="password"
              autocomplete="current-password"
              [(value)]="ownerTransferPassword"
              [ariaLabel]="'auth.currentPassword' | translate"
            ></app-input>
          </div>

          <div *ngIf="ownerTransferError" class="text-sm text-rose-700 dark:text-rose-300">
            {{ ownerTransferError }}
          </div>

          <div class="flex justify-end">
            <app-button
              size="sm"
              [disabled]="ownerTransferLoading"
              [label]="'adminUi.ownerTransfer.action' | translate"
              (action)="submitOwnerTransfer()"
            ></app-button>
          </div>
        </section>
      </ng-template>
    </div>
  `
})
export class AdminDashboardComponent implements OnInit, AfterViewInit {
  @ViewChild('globalSearchInput') globalSearchInput?: ElementRef<HTMLInputElement>;
  readonly crumbs: Crumb[] = [
    { label: 'adminUi.nav.dashboard', url: '/admin/dashboard' }
  ];

  loading = signal(true);
  error = signal('');
  summary = signal<AdminSummary | null>(null);

  customizeWidgetsOpen = signal(false);
  metricWidgetOrder = signal<MetricWidgetId[]>(['kpis', 'counts', 'range']);
  metricWidgetHidden = signal<Record<MetricWidgetId, boolean>>({ kpis: false, counts: false, range: false });

  rangePreset: '7' | '30' | '90' | 'custom' = '30';
  rangeFrom = '';
  rangeTo = '';
  rangeError = '';

  globalSearchQuery = '';
  globalSearchLoading = signal(false);
  globalSearchOpen = signal(false);
  globalSearchResults = signal<AdminDashboardSearchResult[]>([]);
  globalSearchError = '';
  private globalSearchDebounceHandle: number | null = null;
  private globalSearchBlurHandle: number | null = null;
  private globalSearchRequestId = 0;

  auditLoading = signal(false);
  auditError = signal('');
  auditEntries = signal<AdminAuditEntriesResponse | null>(null);
  auditEntity: AdminAuditEntity = 'all';
  auditAction = '';
  auditUser = '';
  auditExportRedact = true;
  auditRetentionLoading = signal(false);
  auditRetentionError = signal('');
  auditRetention = signal<AdminAuditRetentionResponse | null>(null);
  auditRetentionConfirm = '';
  auditRetentionDryRun = true;
  auditRetentionPurgeLoading = false;
  auditRetentionPurgeError = '';

  scheduledLoading = signal(false);
  scheduledError = signal('');
  scheduledTasks = signal<AdminDashboardScheduledTasksResponse | null>(null);

  ownerTransferIdentifier = '';
  ownerTransferConfirm = '';
  ownerTransferPassword = '';
  ownerTransferLoading = false;
  ownerTransferError = '';

  constructor(
    private admin: AdminService,
    private ordersApi: AdminOrdersService,
    private auth: AuthService,
    private router: Router,
    private toast: ToastService,
    private translate: TranslateService
  ) {}

  ngAfterViewInit(): void {
    const shouldFocus = Boolean((history.state as any)?.focusGlobalSearch);
    if (!shouldFocus) return;

    window.setTimeout(() => {
      this.globalSearchInput?.nativeElement?.focus();
      this.globalSearchInput?.nativeElement?.select();
      this.openGlobalSearch();
      try {
        const nextState = { ...(history.state as any) };
        delete nextState.focusGlobalSearch;
        history.replaceState(nextState, '');
      } catch {
        // Ignore history state write failures (e.g. sandboxed/blocked environments).
      }
    }, 0);
  }

  ngOnInit(): void {
    this.loadWidgetPrefs();
    this.loadSummary();
    this.loadScheduledTasks();
    this.loadAudit(1);
    this.loadAuditRetention();
  }

  isOwner(): boolean {
    return this.auth.role() === 'owner';
  }

  private loadSummary(): void {
    this.loading.set(true);
    this.error.set('');
    this.rangeError = '';
    this.admin.summary(this.buildSummaryParams()).subscribe({
      next: (data) => {
        this.summary.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.translate.instant('adminUi.errors.generic'));
        this.loading.set(false);
      }
    });
  }

  loadScheduledTasks(): void {
    this.scheduledLoading.set(true);
    this.scheduledError.set('');
    this.admin.scheduledTasks().subscribe({
      next: (resp) => {
        this.scheduledTasks.set(resp);
        this.scheduledLoading.set(false);
      },
      error: () => {
        this.scheduledTasks.set({ publish_schedules: [], promo_schedules: [] });
        this.scheduledError.set(this.translate.instant('adminUi.dashboard.scheduledError'));
        this.scheduledLoading.set(false);
      }
    });
  }

  onRangePresetChange(): void {
    if (this.rangePreset === 'custom') return;
    this.loadSummary();
  }

  applyRange(): void {
    if (this.rangePreset !== 'custom') {
      this.loadSummary();
      return;
    }
    const from = (this.rangeFrom || '').trim();
    const to = (this.rangeTo || '').trim();
    if (!from || !to) {
      this.rangeError = this.translate.instant('adminUi.dashboard.rangeErrors.missing');
      return;
    }
    if (to < from) {
      this.rangeError = this.translate.instant('adminUi.dashboard.rangeErrors.order');
      return;
    }
    this.loadSummary();
  }

  private buildSummaryParams(): { range_days?: number; range_from?: string; range_to?: string } | undefined {
    if (this.rangePreset === 'custom') {
      const from = (this.rangeFrom || '').trim();
      const to = (this.rangeTo || '').trim();
      if (!from || !to) return undefined;
      return { range_from: from, range_to: to };
    }
    const days = Number(this.rangePreset);
    if (!Number.isFinite(days) || days <= 0) return undefined;
    return { range_days: days };
  }

  deltaLabel(deltaPct: number | null | undefined): string {
    if (deltaPct === null || deltaPct === undefined) return '—';
    const rounded = Math.round(deltaPct * 10) / 10;
    const sign = rounded > 0 ? '+' : '';
    return `${sign}${rounded}%`;
  }

  openGlobalSearch(): void {
    if (this.globalSearchBlurHandle !== null) {
      clearTimeout(this.globalSearchBlurHandle);
      this.globalSearchBlurHandle = null;
    }
    this.globalSearchOpen.set(true);
  }

  onGlobalSearchBlur(): void {
    if (this.globalSearchBlurHandle !== null) clearTimeout(this.globalSearchBlurHandle);
    this.globalSearchBlurHandle = window.setTimeout(() => {
      this.globalSearchOpen.set(false);
      this.globalSearchBlurHandle = null;
    }, 150);
  }

  onGlobalSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.globalSearchOpen.set(false);
      return;
    }
    if (event.key !== 'Enter') return;
    const first = this.globalSearchResults()[0];
    if (!first) return;
    event.preventDefault();
    this.selectGlobalSearch(first);
  }

  onGlobalSearchChange(): void {
    const needle = (this.globalSearchQuery || '').trim();
    this.globalSearchError = '';

    if (this.globalSearchDebounceHandle !== null) {
      clearTimeout(this.globalSearchDebounceHandle);
      this.globalSearchDebounceHandle = null;
    }

    if (needle.length < 2) {
      this.globalSearchResults.set([]);
      this.globalSearchLoading.set(false);
      return;
    }

    this.globalSearchDebounceHandle = window.setTimeout(() => {
      this.globalSearchDebounceHandle = null;
      this.runGlobalSearch(needle);
    }, 250);
  }

  private runGlobalSearch(needle: string): void {
    this.openGlobalSearch();
    this.globalSearchLoading.set(true);
    const requestId = ++this.globalSearchRequestId;
    this.admin.globalSearch(needle).subscribe({
      next: (res) => {
        if (requestId !== this.globalSearchRequestId) return;
        this.globalSearchResults.set(Array.isArray(res?.items) ? res.items : []);
        this.globalSearchLoading.set(false);
      },
      error: () => {
        if (requestId !== this.globalSearchRequestId) return;
        this.globalSearchResults.set([]);
        this.globalSearchLoading.set(false);
        this.globalSearchError = this.translate.instant('adminUi.errors.generic');
      }
    });
  }

  globalSearchTypeLabel(type: AdminDashboardSearchResultType): string {
    return this.translate.instant(`adminUi.dashboard.globalSearchTypes.${type}`);
  }

  selectGlobalSearch(item: AdminDashboardSearchResult): void {
    this.globalSearchOpen.set(false);

    if (item.type === 'order') {
      void this.router.navigate(['/admin/orders', item.id]);
      return;
    }

    if (item.type === 'product') {
      const slug = (item.slug || '').trim();
      void this.router.navigate(['/admin/products'], { state: { editProductSlug: slug } });
      return;
    }

    const email = (item.email || '').trim();
    void this.router.navigate(['/admin/users'], { state: { prefillUserSearch: email, autoSelectFirst: true } });
  }

  goToCreateProduct(): void {
    void this.router.navigate(['/admin/products'], { state: { openNewProduct: true } });
  }

  goToCreateCoupon(): void {
    void this.router.navigate(['/admin/coupons'], { state: { openNewPromotion: true } });
  }

  downloadOrdersExport(): void {
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

  failedPaymentsAlert(): AdminDashboardWindowMetric | null {
    const metric = this.summary()?.anomalies?.failed_payments;
    if (!metric || !metric.current) return null;
    return metric;
  }

  refundRequestsAlert(): AdminDashboardWindowMetric | null {
    const metric = this.summary()?.anomalies?.refund_requests;
    if (!metric || !metric.current) return null;
    return metric;
  }

  stockoutsAlertCount(): number | null {
    const count = this.summary()?.anomalies?.stockouts?.count ?? 0;
    return count > 0 ? count : null;
  }

  hasAnomalyAlerts(): boolean {
    return Boolean(this.failedPaymentsAlert() || this.refundRequestsAlert() || this.stockoutsAlertCount() !== null);
  }

  toggleCustomizeWidgets(): void {
    this.customizeWidgetsOpen.set(!this.customizeWidgetsOpen());
  }

  metricWidgets(): MetricWidgetId[] {
    return this.metricWidgetOrder();
  }

  metricWidgetLabel(id: MetricWidgetId): string {
    if (id === 'kpis') return this.translate.instant('adminUi.dashboard.widgets.kpis');
    if (id === 'counts') return this.translate.instant('adminUi.dashboard.widgets.counts');
    return this.translate.instant('adminUi.dashboard.widgets.range');
  }

  isMetricWidgetHidden(id: MetricWidgetId): boolean {
    return Boolean(this.metricWidgetHidden()[id]);
  }

  toggleMetricWidget(id: MetricWidgetId): void {
    const nextHidden = { ...this.metricWidgetHidden() };
    nextHidden[id] = !nextHidden[id];
    this.metricWidgetHidden.set(nextHidden);
    this.saveWidgetPrefs();
  }

  moveMetricWidget(id: MetricWidgetId, direction: -1 | 1): void {
    const order = [...this.metricWidgetOrder()];
    const index = order.indexOf(id);
    if (index < 0) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= order.length) return;
    const next = [...order];
    next.splice(index, 1);
    next.splice(nextIndex, 0, id);
    this.metricWidgetOrder.set(next);
    this.saveWidgetPrefs();
  }

  private widgetPrefsKey(): string {
    const userId = this.auth.user()?.id || 'anon';
    return `admin_dashboard_widgets_v1:${userId}`;
  }

  private loadWidgetPrefs(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.widgetPrefsKey());
      if (!raw) return;
      const parsed = JSON.parse(raw) as { order?: MetricWidgetId[]; hidden?: Partial<Record<MetricWidgetId, boolean>> };
      const allowed: MetricWidgetId[] = ['kpis', 'counts', 'range'];
      const order = Array.isArray(parsed?.order) ? parsed.order.filter((x): x is MetricWidgetId => allowed.includes(x)) : [];
      const normalizedOrder = Array.from(new Set(order));
      allowed.forEach((id) => {
        if (!normalizedOrder.includes(id)) normalizedOrder.push(id);
      });
      this.metricWidgetOrder.set(normalizedOrder);
      const hidden = parsed?.hidden || {};
      this.metricWidgetHidden.set({
        kpis: Boolean(hidden.kpis),
        counts: Boolean(hidden.counts),
        range: Boolean(hidden.range)
      });
    } catch {
      // ignore
    }
  }

  private saveWidgetPrefs(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        this.widgetPrefsKey(),
        JSON.stringify({ order: this.metricWidgetOrder(), hidden: this.metricWidgetHidden() })
      );
    } catch {
      // ignore
    }
  }

  private loadAudit(page: number): void {
    this.auditLoading.set(true);
    this.auditError.set('');
    this.admin
      .auditEntries({
        entity: this.auditEntity,
        action: (this.auditAction || '').trim() || undefined,
        user: (this.auditUser || '').trim() || undefined,
        page,
        limit: 20
      })
      .subscribe({
        next: (resp) => {
          this.auditEntries.set(resp);
          this.auditLoading.set(false);
        },
        error: () => {
          this.auditEntries.set({ items: [], meta: { page: 1, limit: 20, total_items: 0, total_pages: 1 } });
          this.auditError.set(this.translate.instant('adminUi.audit.errors.loadCopy'));
          this.auditLoading.set(false);
        }
      });
  }

  loadAuditRetention(): void {
    this.auditRetentionLoading.set(true);
    this.auditRetentionError.set('');
    this.admin.auditRetention().subscribe({
      next: (resp) => {
        this.auditRetention.set(resp);
        this.auditRetentionLoading.set(false);
      },
      error: () => {
        this.auditRetention.set(null);
        this.auditRetentionError.set(this.translate.instant('adminUi.audit.retention.errors.load'));
        this.auditRetentionLoading.set(false);
      }
    });
  }

  auditRetentionConfirmOk(): boolean {
    return (this.auditRetentionConfirm || '').trim().toUpperCase() === 'PURGE';
  }

  purgeAuditRetention(): void {
    if (!this.isOwner()) return;
    this.auditRetentionPurgeError = '';
    this.auditRetentionPurgeLoading = true;
    this.admin
      .purgeAuditRetention({ confirm: this.auditRetentionConfirm, dry_run: this.auditRetentionDryRun })
      .subscribe({
        next: (resp) => {
          this.auditRetentionPurgeLoading = false;
          this.auditRetention.set(resp);
          this.auditRetentionConfirm = '';
          const deleted =
            (resp.deleted?.product || 0) + (resp.deleted?.content || 0) + (resp.deleted?.security || 0);
          this.toast.success(
            this.translate.instant('adminUi.audit.retention.successTitle'),
            this.translate.instant(resp.dry_run ? 'adminUi.audit.retention.successDryRunCopy' : 'adminUi.audit.retention.successCopy', {
              deleted
            })
          );
        },
        error: () => {
          this.auditRetentionPurgeLoading = false;
          this.auditRetentionPurgeError = this.translate.instant('adminUi.audit.retention.errors.purge');
        }
      });
  }

  applyAuditFilters(): void {
    this.loadAudit(1);
  }

  auditHasPrev(): boolean {
    const current = this.auditEntries()?.meta?.page || 1;
    return current > 1;
  }

  auditHasNext(): boolean {
    const meta = this.auditEntries()?.meta;
    if (!meta) return false;
    return meta.page < meta.total_pages;
  }

  auditPrev(): void {
    const meta = this.auditEntries()?.meta;
    if (!meta || meta.page <= 1) return;
    this.loadAudit(meta.page - 1);
  }

  auditNext(): void {
    const meta = this.auditEntries()?.meta;
    if (!meta || meta.page >= meta.total_pages) return;
    this.loadAudit(meta.page + 1);
  }

  auditEntityLabel(entity: AdminAuditEntity): string {
    if (entity === 'product') return this.translate.instant('adminUi.audit.products');
    if (entity === 'content') return this.translate.instant('adminUi.audit.content');
    if (entity === 'security') return this.translate.instant('adminUi.audit.security');
    return this.translate.instant('adminUi.audit.entityAll');
  }

  canOpenAuditEntry(entry: AdminAuditEntryUnified): boolean {
    if (entry.entity === 'product') return Boolean((entry.ref_key || '').trim());
    if (entry.entity === 'content') return Boolean((entry.ref_key || '').trim());
    return false;
  }

  openAuditEntry(entry: AdminAuditEntryUnified): void {
    if (entry.entity === 'product') {
      const slug = (entry.ref_key || '').trim();
      if (slug) void this.router.navigate(['/admin/products'], { state: { editProductSlug: slug } });
      return;
    }

    if (entry.entity === 'content') {
      const key = (entry.ref_key || '').trim();
      if (!key) return;
      const section = this.adminContentSectionForKey(key);
      void this.router.navigate(['/admin/content', section], { state: { openContentKey: key } });
    }
  }

  openScheduledPublish(item: ScheduledPublishItem): void {
    const slug = (item.slug || '').trim();
    if (!slug) return;
    void this.router.navigate(['/admin/products'], { state: { editProductSlug: slug } });
  }

  openScheduledPromo(item: ScheduledPromoItem): void {
    const id = (item.id || '').trim();
    if (!id) return;
    void this.router.navigate(['/admin/coupons'], { state: { editPromotionId: id } });
  }

  private adminContentSectionForKey(key: string): string {
    if (key.startsWith('page.')) return 'pages';
    if (key.startsWith('blog.')) return 'blog';
    if (key.startsWith('seo.')) return 'settings';
    if (key.startsWith('site.')) return 'settings';
    return 'home';
  }

  downloadAuditCsv(): void {
    const redact = this.isOwner() ? this.auditExportRedact : true;
    this.admin
      .exportAuditCsv({
        entity: this.auditEntity,
        action: (this.auditAction || '').trim() || undefined,
        user: (this.auditUser || '').trim() || undefined,
        redact,
      })
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `audit-${this.auditEntity || 'all'}.csv`;
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
        error: () => {
          this.toast.error(this.translate.instant('adminUi.audit.errors.loadTitle'), this.translate.instant('adminUi.audit.errors.loadCopy'));
        }
      });
  }

  submitOwnerTransfer(): void {
    const identifier = (this.ownerTransferIdentifier || '').trim();
    if (!identifier) {
      this.ownerTransferError = this.translate.instant('adminUi.ownerTransfer.errors.identifier');
      return;
    }
    this.ownerTransferError = '';
    this.ownerTransferLoading = true;
    this.admin
      .transferOwner({ identifier, confirm: this.ownerTransferConfirm, password: this.ownerTransferPassword })
      .subscribe({
        next: () => {
          this.ownerTransferLoading = false;
          this.ownerTransferIdentifier = '';
          this.ownerTransferConfirm = '';
          this.ownerTransferPassword = '';
          this.toast.success(
            this.translate.instant('adminUi.ownerTransfer.successTitle'),
            this.translate.instant('adminUi.ownerTransfer.successCopy')
          );
        },
        error: () => {
          this.ownerTransferLoading = false;
          this.ownerTransferError = this.translate.instant('adminUi.ownerTransfer.errors.generic');
        }
      });
  }
}
