import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { BreadcrumbComponent, Crumb } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { CardComponent } from '../../../shared/card.component';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { InputComponent } from '../../../shared/input.component';
import { ModalComponent } from '../../../shared/modal.component';
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
  AdminChannelBreakdownResponse,
  AdminFunnelMetricsResponse,
  ScheduledPromoItem,
  ScheduledPublishItem,
  AdminService,
  AdminSummary
} from '../../../core/admin.service';
import { AdminOrdersService } from '../../../core/admin-orders.service';
import { AdminCouponsV2Service, CouponBulkJobRead } from '../../../core/admin-coupons-v2.service';
import { ToastService } from '../../../core/toast.service';
import { AdminGdprExportJobItem, AdminUsersService } from '../../../core/admin-users.service';
import { LocalizedCurrencyPipe } from '../../../shared/localized-currency.pipe';
import { extractRequestId } from '../../../shared/http-error';
import { AdminRecentItem, AdminRecentService } from '../../../core/admin-recent.service';
import { AdminFavoriteItem, AdminFavoritesService } from '../../../core/admin-favorites.service';
import { MarkdownService } from '../../../core/markdown.service';

type MetricWidgetId = 'kpis' | 'counts' | 'range';
type AdminOnboardingState = { completed_at?: string | null; dismissed_at?: string | null };

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
    ErrorStateComponent,
    ModalComponent,
    LocalizedCurrencyPipe
  ],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <app-error-state
        *ngIf="error()"
        [message]="error()!"
        [requestId]="errorRequestId()"
        [showRetry]="true"
        (retry)="retryDashboard()"
      ></app-error-state>

      <div *ngIf="loading(); else dashboardTpl">
        <app-skeleton [rows]="6"></app-skeleton>
      </div>

	      <ng-template #dashboardTpl>
	        <section class="grid gap-3">
	          <div class="flex items-center justify-between gap-3 flex-wrap">
	            <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.dashboardTitle' | translate }}</h1>
              <div class="flex items-center gap-2">
                <span *ngIf="lastUpdatedAt()" class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.dashboard.liveRefresh.lastUpdated' | translate }}: {{ lastUpdatedAt() | date: 'shortTime' }}
                </span>
                <div
                  role="radiogroup"
                  class="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-white/70 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-800/70"
                  [attr.aria-label]="'adminUi.dashboard.salesMetric.aria' | translate"
                  [attr.title]="'adminUi.dashboard.salesMetric.tooltip' | translate"
                >
                  <button
                    type="button"
                    role="radio"
                    [attr.aria-checked]="salesMetric() === 'net'"
                    [attr.tabindex]="salesMetric() === 'net' ? 0 : -1"
                    class="min-h-9 rounded-full px-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                    [ngClass]="
                      salesMetric() === 'net'
                        ? 'bg-slate-900 text-white hover:bg-slate-900 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-50'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700/50'
                    "
                    (click)="setSalesMetric('net')"
                  >
                    {{ 'adminUi.dashboard.salesMetric.net' | translate }}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    [attr.aria-checked]="salesMetric() === 'gross'"
                    [attr.tabindex]="salesMetric() === 'gross' ? 0 : -1"
                    class="min-h-9 rounded-full px-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                    [ngClass]="
                      salesMetric() === 'gross'
                        ? 'bg-slate-900 text-white hover:bg-slate-900 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-50'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700/50'
                    "
                    (click)="setSalesMetric('gross')"
                  >
                    {{ 'adminUi.dashboard.salesMetric.gross' | translate }}
                  </button>
                </div>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="(liveRefreshEnabled() ? 'adminUi.dashboard.liveRefresh.pause' : 'adminUi.dashboard.liveRefresh.resume') | translate"
                  (action)="toggleLiveRefresh()"
                ></app-button>
                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="refreshNow()"></app-button>
	              <app-button
	                *ngIf="isOwner()"
	                size="sm"
	                variant="ghost"
	                [label]="'adminUi.onboarding.open' | translate"
	                (action)="openOnboarding()"
	              ></app-button>
	              <app-button
	                size="sm"
	                variant="ghost"
	                [label]="'adminUi.dashboard.customizeWidgets' | translate"
	                (action)="toggleCustomizeWidgets()"
	              ></app-button>
	              </div>
		          </div>

              <app-card
                [title]="'adminUi.dashboard.whatsNew.title' | translate"
                [subtitle]="'adminUi.dashboard.whatsNew.subtitle' | translate"
              >
                <div class="flex justify-end">
                  <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadWhatsNew(true)"></app-button>
                </div>

                <div *ngIf="whatsNewLoading()" class="mt-3">
                  <app-skeleton [rows]="3"></app-skeleton>
                </div>

                <div *ngIf="whatsNewError()" class="mt-3 text-sm text-rose-700 dark:text-rose-200">
                  {{ whatsNewError() }}
                </div>

                <div
                  *ngIf="!whatsNewLoading() && !whatsNewError() && whatsNewHtml()"
                  class="mt-3 grid gap-2 text-sm text-slate-700 dark:text-slate-200"
                  [innerHTML]="whatsNewHtml()"
                ></div>
              </app-card>

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
                      role="combobox"
                      aria-autocomplete="list"
                      [attr.aria-expanded]="globalSearchOpen() ? 'true' : 'false'"
                      [attr.aria-controls]="'admin-global-search-listbox'"
                      [attr.aria-activedescendant]="globalSearchActiveDescendant()"
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
                      <div id="admin-global-search-listbox" role="listbox" class="max-h-72 overflow-auto">
                        <div
                          *ngIf="globalSearchLoading()"
                          role="option"
                          aria-disabled="true"
                          class="px-3 py-2 text-xs text-slate-600 dark:text-slate-300"
                        >
                          {{ 'adminUi.dashboard.globalSearchLoading' | translate }}
                        </div>
                        <div
                          *ngIf="globalSearchError"
                          role="option"
                          aria-disabled="true"
                          class="px-3 py-2 text-xs text-rose-700 dark:text-rose-300"
                        >
                          {{ globalSearchError }}
                        </div>

                        <ng-container *ngIf="!globalSearchLoading() && !globalSearchError">
                          <div
                            *ngIf="globalSearchResults().length === 0 && (globalSearchQuery || '').trim().length >= 2"
                            role="option"
                            aria-disabled="true"
                            class="px-3 py-2 text-xs text-slate-600 dark:text-slate-300"
                          >
                            {{ 'adminUi.dashboard.globalSearchEmpty' | translate }}
                          </div>
                          <button
                            *ngFor="let item of globalSearchResults(); let i = index"
                            type="button"
                            role="option"
                            tabindex="-1"
                            [id]="'admin-global-search-option-' + i"
                            [attr.aria-selected]="i === globalSearchActiveIndex() ? 'true' : 'false'"
                            class="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60"
                            [class.bg-slate-50]="i === globalSearchActiveIndex()"
                            [class.dark:bg-slate-800/60]="i === globalSearchActiveIndex()"
                            (mousedown)="selectGlobalSearch(item, $event)"
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
                        </ng-container>
                      </div>
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

            <div class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-3 dark:border-slate-800 dark:bg-slate-900">
              <div class="flex items-start justify-between gap-3">
                <div class="grid gap-1">
                  <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.favorites.title' | translate }}</div>
                  <div class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.favorites.hint' | translate }}</div>
                </div>
                <app-button
                  *ngIf="favorites.items().length"
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.favorites.clear' | translate"
                  [disabled]="favorites.loading()"
                  (action)="clearFavorites()"
                ></app-button>
              </div>

              <div *ngIf="favorites.items().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'adminUi.favorites.empty' | translate }}
              </div>

              <div *ngIf="favorites.items().length" class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <div
                  *ngFor="let item of favorites.items()"
                  class="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/40"
                >
                  <button type="button" class="min-w-0 text-left" (click)="openFavorite(item)">
                    <div class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      {{ ('adminUi.favorites.types.' + item.type) | translate }}
                    </div>
                    <div class="mt-1 font-semibold text-slate-900 dark:text-slate-50 truncate">{{ item.label }}</div>
                    <div *ngIf="item.subtitle" class="text-xs text-slate-600 dark:text-slate-300 truncate">{{ item.subtitle }}</div>
                  </button>

                  <button
                    type="button"
                    class="shrink-0 h-9 w-9 rounded-lg border border-transparent text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                    [attr.aria-label]="'adminUi.favorites.unpin' | translate"
                    [disabled]="favorites.loading()"
                    (click)="toggleFavorite(item, $event)"
                  >
                    <span aria-hidden="true" class="text-base leading-none">★</span>
                  </button>
                </div>
              </div>
            </div>

            <div class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-3 dark:border-slate-800 dark:bg-slate-900">
              <div class="flex items-start justify-between gap-3">
                <div class="grid gap-1">
                  <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.recent.title' | translate }}</div>
                  <div class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.recent.hint' | translate }}</div>
                </div>
                <app-button
                  *ngIf="recent.items().length"
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.recent.clear' | translate"
                  (action)="clearRecent()"
                ></app-button>
              </div>

              <div *ngIf="recent.items().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'adminUi.recent.empty' | translate }}
              </div>

              <div *ngIf="recent.items().length" class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <div
                  *ngFor="let item of recent.items()"
                  class="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/40"
                >
                  <button type="button" class="min-w-0 text-left" (click)="openRecent(item)">
                    <div class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      {{ ('adminUi.recent.types.' + item.type) | translate }}
                    </div>
                    <div class="mt-1 font-semibold text-slate-900 dark:text-slate-50 truncate">{{ item.label }}</div>
                    <div *ngIf="item.subtitle" class="text-xs text-slate-600 dark:text-slate-300 truncate">{{ item.subtitle }}</div>
                  </button>

                  <button
                    type="button"
                    class="shrink-0 h-9 w-9 rounded-lg border border-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                    [attr.aria-label]="(favorites.isFavorite(item.key) ? 'adminUi.favorites.unpin' : 'adminUi.favorites.pin') | translate"
                    [disabled]="favorites.loading()"
                    (click)="toggleFavorite(item, $event)"
                  >
                    <span aria-hidden="true" class="text-base leading-none" [class.text-amber-500]="favorites.isFavorite(item.key)">
                      {{ favorites.isFavorite(item.key) ? '★' : '☆' }}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <div
              *ngIf="shouldShowJobsPanel()"
              class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="grid gap-1">
                  <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.jobs.title' | translate }}</div>
                  <div class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.jobs.hint' | translate }}</div>
                </div>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.actions.refresh' | translate"
                  [disabled]="jobsLoading()"
                  (action)="loadBackgroundJobs()"
                ></app-button>
              </div>

              <div *ngIf="jobsError()" class="text-sm text-rose-700 dark:text-rose-200">
                {{ jobsError() }}
              </div>

              <div *ngIf="jobsLoading(); else jobsTpl">
                <app-skeleton [rows]="4"></app-skeleton>
              </div>

              <ng-template #jobsTpl>
                <div *ngIf="gdprExportJobs().length === 0 && couponBulkJobs().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
                  {{ 'adminUi.jobs.empty' | translate }}
                </div>

                <div *ngIf="gdprExportJobs().length" class="grid gap-2">
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.jobs.sections.gdprExports' | translate }}
                    </div>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.jobs.actions.openGdpr' | translate"
                      (action)="goToGdprJobs()"
                    ></app-button>
                  </div>

                  <div class="grid gap-2">
                    <div
                      *ngFor="let job of gdprExportJobs()"
                      class="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <div class="font-semibold text-slate-900 dark:text-slate-50 truncate">{{ job.user.email }}</div>
                          <div class="text-xs text-slate-500 dark:text-slate-400">
                            {{ ('adminUi.jobs.status.' + job.status) | translate }} · {{ progressPct(job.progress) }}%
                          </div>
                        </div>
                        <div class="flex items-center gap-2">
                          <app-button
                            *ngIf="canManageGdprJobs() && job.status === 'failed'"
                            size="sm"
                            variant="ghost"
                            [label]="'adminUi.actions.retry' | translate"
                            [disabled]="gdprJobBusyId() === job.id"
                            (action)="retryGdprExport(job)"
                          ></app-button>
                          <app-button
                            *ngIf="canManageGdprJobs() && job.status === 'succeeded' && job.has_file"
                            size="sm"
                            variant="ghost"
                            [label]="'adminUi.jobs.actions.download' | translate"
                            [disabled]="gdprJobBusyId() === job.id"
                            (action)="downloadGdprExport(job)"
                          ></app-button>
                        </div>
                      </div>

                      <div class="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                        <div class="h-2 bg-indigo-500" [style.width.%]="progressPct(job.progress)"></div>
                      </div>
                    </div>
                  </div>
                </div>

                <div *ngIf="couponBulkJobs().length" class="grid gap-2">
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.jobs.sections.couponJobs' | translate }}
                    </div>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.jobs.actions.openCoupons' | translate"
                      (action)="goToCoupons()"
                    ></app-button>
                  </div>

                  <div class="grid gap-2">
                    <div
                      *ngFor="let job of couponBulkJobs()"
                      class="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <div class="font-semibold text-slate-900 dark:text-slate-50 truncate">
                            {{ ('adminUi.jobs.couponActions.' + job.action) | translate }}
                          </div>
                          <div class="text-xs text-slate-500 dark:text-slate-400">
                            {{ ('adminUi.jobs.status.' + job.status) | translate }} · {{ job.processed || 0 }}/{{ job.total_candidates || 0 }}
                          </div>
                          <div *ngIf="job.error_message" class="mt-1 text-xs text-rose-700 dark:text-rose-200 truncate">
                            {{ job.error_message }}
                          </div>
                        </div>
                        <div class="flex items-center gap-2">
                          <app-button
                            *ngIf="canManageCouponJobs() && (job.status === 'pending' || job.status === 'running')"
                            size="sm"
                            variant="ghost"
                            [label]="'adminUi.actions.cancel' | translate"
                            [disabled]="couponJobBusyId() === job.id"
                            (action)="cancelCouponJob(job)"
                          ></app-button>
                          <app-button
                            *ngIf="canManageCouponJobs() && (job.status === 'failed' || job.status === 'cancelled')"
                            size="sm"
                            variant="ghost"
                            [label]="'adminUi.actions.retry' | translate"
                            [disabled]="couponJobBusyId() === job.id"
                            (action)="retryCouponJob(job)"
                          ></app-button>
                        </div>
                      </div>

                      <div class="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                        <div class="h-2 bg-indigo-500" [style.width.%]="couponProgressPct(job)"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </ng-template>
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
                  <app-card [title]="'adminUi.cards.ordersToday' | translate" [clickable]="true" (action)="openOrdersToday()">
                    <div class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ summary()?.today_orders || 0 }}</div>
                    <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.cards.vsYesterday' | translate }}: {{ summary()?.yesterday_orders || 0 }} ·
                      {{ deltaLabel(summary()?.orders_delta_pct) }}
                    </div>
                  </app-card>
                  <app-card [title]="'adminUi.cards.salesToday' | translate" [clickable]="true" (action)="openSalesToday()">
                    <div class="text-2xl font-semibold text-slate-900 dark:text-slate-50">
                      {{ (todaySales() || 0) | localizedCurrency : 'RON' }}
                    </div>
                    <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.cards.vsYesterday' | translate }}: {{ (yesterdaySales() || 0) | localizedCurrency : 'RON' }} ·
                      {{ deltaLabel(salesDeltaPct()) }}
                    </div>
                  </app-card>
                  <app-card [title]="'adminUi.cards.refundsToday' | translate" [clickable]="true" (action)="openRefunds()">
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
                    [clickable]="true"
                    (action)="openProducts()"
                  ></app-card>
                  <app-card
                    [title]="'adminUi.cards.orders' | translate"
                    [subtitle]="'adminUi.cards.countTotal' | translate: { count: summary()?.orders || 0 }"
                    [clickable]="true"
                    (action)="openOrders()"
                  ></app-card>
                  <app-card
                    [title]="'adminUi.cards.users' | translate"
                    [subtitle]="'adminUi.cards.countTotal' | translate: { count: summary()?.users || 0 }"
                    [clickable]="true"
                    (action)="openUsers()"
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
                      [clickable]="true"
                      (action)="openInventory()"
                    ></app-card>
                    <app-card
                      [title]="'adminUi.cards.salesRange' | translate: { days: summary()?.range_days || 30 }"
                      [subtitle]="(rangeSales() || 0) | localizedCurrency : 'RON'"
                      [clickable]="true"
                      (action)="openSalesRange()"
                    ></app-card>
                    <app-card
                      [title]="'adminUi.cards.ordersRange' | translate: { days: summary()?.range_days || 30 }"
                      [subtitle]="'adminUi.cards.countOrders' | translate: { count: summary()?.orders_range || 0 }"
                      [clickable]="true"
                      (action)="openOrdersRange()"
                    ></app-card>
                  </div>

                  <div class="mt-4">
                    <app-card [title]="'adminUi.dashboard.funnel.title' | translate">
                      <p class="text-xs text-slate-500 dark:text-slate-400">
                        {{ 'adminUi.dashboard.funnel.note' | translate }}
                      </p>

                      <div *ngIf="funnelLoading()" class="mt-3">
                        <app-skeleton [rows]="2"></app-skeleton>
                      </div>

                      <div
                        *ngIf="funnelError()"
                        class="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
                      >
                        {{ funnelError() }}
                      </div>

                      <div *ngIf="!funnelLoading() && !funnelError() && funnelMetrics() as funnel" class="mt-3 grid gap-4 md:grid-cols-2">
                        <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
                          <div class="flex items-center justify-between">
                            <span>{{ 'adminUi.dashboard.funnel.sessions' | translate }}</span>
                            <span class="font-semibold text-slate-900 dark:text-slate-50">{{ funnel.counts.sessions | number: '1.0-0' }}</span>
                          </div>
                          <div class="flex items-center justify-between">
                            <span>{{ 'adminUi.dashboard.funnel.carts' | translate }}</span>
                            <span class="font-semibold text-slate-900 dark:text-slate-50">{{ funnel.counts.carts | number: '1.0-0' }}</span>
                          </div>
                          <div class="flex items-center justify-between">
                            <span>{{ 'adminUi.dashboard.funnel.checkouts' | translate }}</span>
                            <span class="font-semibold text-slate-900 dark:text-slate-50">{{ funnel.counts.checkouts | number: '1.0-0' }}</span>
                          </div>
                          <div class="flex items-center justify-between">
                            <span>{{ 'adminUi.dashboard.funnel.orders' | translate }}</span>
                            <span class="font-semibold text-slate-900 dark:text-slate-50">{{ funnel.counts.orders | number: '1.0-0' }}</span>
                          </div>
                        </div>

                        <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
                          <div class="flex items-center justify-between">
                            <span>{{ 'adminUi.dashboard.funnel.toCart' | translate }}</span>
                            <span class="font-semibold text-slate-900 dark:text-slate-50">
                              {{ funnel.conversions.to_cart === null ? '—' : (funnel.conversions.to_cart | percent: '1.0-0') }}
                            </span>
                          </div>
                          <div class="flex items-center justify-between">
                            <span>{{ 'adminUi.dashboard.funnel.toCheckout' | translate }}</span>
                            <span class="font-semibold text-slate-900 dark:text-slate-50">
                              {{ funnel.conversions.to_checkout === null ? '—' : (funnel.conversions.to_checkout | percent: '1.0-0') }}
                            </span>
                          </div>
                          <div class="flex items-center justify-between">
                            <span>{{ 'adminUi.dashboard.funnel.toOrder' | translate }}</span>
                            <span class="font-semibold text-slate-900 dark:text-slate-50">
                              {{ funnel.conversions.to_order === null ? '—' : (funnel.conversions.to_order | percent: '1.0-0') }}
                            </span>
                          </div>
                        </div>
                      </div>
                    </app-card>
                  </div>

                  <div class="grid gap-3">
                    <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.dashboard.channelBreakdown.title' | translate }}
                    </p>

                    <div *ngIf="channelBreakdownLoading()">
                      <app-skeleton [rows]="3"></app-skeleton>
                    </div>

                    <div
                      *ngIf="channelBreakdownError()"
                      class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
                    >
                      {{ channelBreakdownError() }}
                    </div>

                    <div
                      *ngIf="!channelBreakdownLoading() && !channelBreakdownError() && channelBreakdown() as breakdown"
                      class="grid gap-4 md:grid-cols-3"
                    >
                      <div class="rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900">
                        <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {{ 'adminUi.dashboard.channelBreakdown.paymentMethods' | translate }}
                        </div>
                        <div *ngIf="(breakdown.payment_methods || []).length === 0" class="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          {{ 'adminUi.dashboard.channelBreakdown.empty' | translate }}
                        </div>
                        <table *ngIf="(breakdown.payment_methods || []).length" class="mt-3 w-full text-xs">
                          <thead>
                            <tr class="text-left text-slate-500 dark:text-slate-400">
                              <th class="py-1">{{ 'adminUi.dashboard.channelBreakdown.table.channel' | translate }}</th>
                              <th class="py-1 text-right">{{ 'adminUi.dashboard.channelBreakdown.table.orders' | translate }}</th>
                              <th class="py-1 text-right">{{ 'adminUi.dashboard.channelBreakdown.table.sales' | translate }}</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr *ngFor="let row of breakdown.payment_methods" class="border-t border-slate-100 dark:border-slate-800">
                              <td class="py-1.5 pr-2 text-slate-700 dark:text-slate-200">{{ formatChannelKey(row.key) }}</td>
                              <td class="py-1.5 text-right text-slate-700 dark:text-slate-200">{{ row.orders }}</td>
                              <td class="py-1.5 text-right text-slate-700 dark:text-slate-200">
                                {{ channelSales(row) | localizedCurrency : 'RON' }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <div class="rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900">
                        <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {{ 'adminUi.dashboard.channelBreakdown.couriers' | translate }}
                        </div>
                        <div *ngIf="(breakdown.couriers || []).length === 0" class="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          {{ 'adminUi.dashboard.channelBreakdown.empty' | translate }}
                        </div>
                        <table *ngIf="(breakdown.couriers || []).length" class="mt-3 w-full text-xs">
                          <thead>
                            <tr class="text-left text-slate-500 dark:text-slate-400">
                              <th class="py-1">{{ 'adminUi.dashboard.channelBreakdown.table.channel' | translate }}</th>
                              <th class="py-1 text-right">{{ 'adminUi.dashboard.channelBreakdown.table.orders' | translate }}</th>
                              <th class="py-1 text-right">{{ 'adminUi.dashboard.channelBreakdown.table.sales' | translate }}</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr *ngFor="let row of breakdown.couriers" class="border-t border-slate-100 dark:border-slate-800">
                              <td class="py-1.5 pr-2 text-slate-700 dark:text-slate-200">{{ formatChannelKey(row.key) }}</td>
                              <td class="py-1.5 text-right text-slate-700 dark:text-slate-200">{{ row.orders }}</td>
                              <td class="py-1.5 text-right text-slate-700 dark:text-slate-200">
                                {{ channelSales(row) | localizedCurrency : 'RON' }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <div class="rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900">
                        <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {{ 'adminUi.dashboard.channelBreakdown.deliveryTypes' | translate }}
                        </div>
                        <div *ngIf="(breakdown.delivery_types || []).length === 0" class="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          {{ 'adminUi.dashboard.channelBreakdown.empty' | translate }}
                        </div>
                        <table *ngIf="(breakdown.delivery_types || []).length" class="mt-3 w-full text-xs">
                          <thead>
                            <tr class="text-left text-slate-500 dark:text-slate-400">
                              <th class="py-1">{{ 'adminUi.dashboard.channelBreakdown.table.channel' | translate }}</th>
                              <th class="py-1 text-right">{{ 'adminUi.dashboard.channelBreakdown.table.orders' | translate }}</th>
                              <th class="py-1 text-right">{{ 'adminUi.dashboard.channelBreakdown.table.sales' | translate }}</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr *ngFor="let row of breakdown.delivery_types" class="border-t border-slate-100 dark:border-slate-800">
                              <td class="py-1.5 pr-2 text-slate-700 dark:text-slate-200">{{ formatChannelKey(row.key) }}</td>
                              <td class="py-1.5 text-right text-slate-700 dark:text-slate-200">{{ row.orders }}</td>
                              <td class="py-1.5 text-right text-slate-700 dark:text-slate-200">
                                {{ channelSales(row) | localizedCurrency : 'RON' }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
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

          <app-modal
            [open]="onboardingOpen()"
            [title]="'adminUi.onboarding.title' | translate"
            [subtitle]="'adminUi.onboarding.subtitle' | translate"
            [showActions]="false"
            [closeLabel]="'adminUi.actions.cancel' | translate"
            (closed)="dismissOnboarding()"
          >
            <div class="grid gap-4">
              <p class="text-sm text-slate-700 dark:text-slate-200">
                {{ 'adminUi.onboarding.intro' | translate }}
              </p>

              <div class="grid gap-2">
                <div class="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                  <div class="flex items-start justify-between gap-3">
                    <div class="grid gap-0.5 min-w-0">
                      <div class="font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.onboarding.steps.contentTitle' | translate }}</div>
                      <div class="text-xs text-slate-600 dark:text-slate-300">{{ 'adminUi.onboarding.steps.contentCopy' | translate }}</div>
                    </div>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.actions.open' | translate"
                      (action)="goToOnboarding('/admin/content/home')"
                    ></app-button>
                  </div>
                </div>

                <div class="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                  <div class="flex items-start justify-between gap-3">
                    <div class="grid gap-0.5 min-w-0">
                      <div class="font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.onboarding.steps.shippingTitle' | translate }}</div>
                      <div class="text-xs text-slate-600 dark:text-slate-300">{{ 'adminUi.onboarding.steps.shippingCopy' | translate }}</div>
                    </div>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.actions.open' | translate"
                      (action)="goToOnboarding('/admin/ops')"
                    ></app-button>
                  </div>
                </div>

                <div class="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                  <div class="flex items-start justify-between gap-3">
                    <div class="grid gap-0.5 min-w-0">
                      <div class="font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.onboarding.steps.paymentsTitle' | translate }}</div>
                      <div class="text-xs text-slate-600 dark:text-slate-300">{{ 'adminUi.onboarding.steps.paymentsCopy' | translate }}</div>
                    </div>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.actions.open' | translate"
                      (action)="goToOnboarding('/admin/ops')"
                    ></app-button>
                  </div>
                </div>

                <div class="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                  <div class="flex items-start justify-between gap-3">
                    <div class="grid gap-0.5 min-w-0">
                      <div class="font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.onboarding.steps.taxesTitle' | translate }}</div>
                      <div class="text-xs text-slate-600 dark:text-slate-300">{{ 'adminUi.onboarding.steps.taxesCopy' | translate }}</div>
                    </div>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.actions.open' | translate"
                      (action)="goToOnboarding('/admin/content/settings')"
                    ></app-button>
                  </div>
                </div>
              </div>

              <div class="flex items-center justify-end gap-2 pt-1">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.onboarding.actions.later' | translate"
                  (action)="dismissOnboarding()"
                ></app-button>
                <app-button
                  size="sm"
                  [label]="'adminUi.onboarding.actions.done' | translate"
                  (action)="completeOnboarding()"
                ></app-button>
              </div>
            </div>
          </app-modal>
	      </ng-template>
    </div>
  `
})
export class AdminDashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('globalSearchInput') globalSearchInput?: ElementRef<HTMLInputElement>;
  readonly crumbs: Crumb[] = [
    { label: 'adminUi.nav.dashboard', url: '/admin/dashboard' }
  ];

  loading = signal(true);
  error = signal<string | null>(null);
  errorRequestId = signal<string | null>(null);
  whatsNewLoading = signal(false);
  whatsNewError = signal<string | null>(null);
  whatsNewHtml = signal('');
  summary = signal<AdminSummary | null>(null);
  channelBreakdown = signal<AdminChannelBreakdownResponse | null>(null);
  channelBreakdownLoading = signal(false);
  channelBreakdownError = signal<string | null>(null);
  funnelMetrics = signal<AdminFunnelMetricsResponse | null>(null);
  funnelLoading = signal(false);
  funnelError = signal<string | null>(null);
  lastUpdatedAt = signal<string | null>(null);
  liveRefreshEnabled = signal(false);
  salesMetric = signal<'gross' | 'net'>('net');
  private liveRefreshTimerId: number | null = null;
  private readonly liveRefreshStorageKey = 'admin.dashboard.liveRefresh.v1';
  private readonly salesMetricStorageKey = 'admin.dashboard.salesMetric.v1';

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
  globalSearchActiveIndex = signal(-1);
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

  jobsLoading = signal(false);
  jobsError = signal('');
  gdprExportJobs = signal<AdminGdprExportJobItem[]>([]);
  couponBulkJobs = signal<CouponBulkJobRead[]>([]);
  gdprJobBusyId = signal<string | null>(null);
  couponJobBusyId = signal<string | null>(null);

  ownerTransferIdentifier = '';
  ownerTransferConfirm = '';
  ownerTransferPassword = '';
  ownerTransferLoading = false;
  ownerTransferError = '';

  constructor(
    private admin: AdminService,
    private ordersApi: AdminOrdersService,
    private usersApi: AdminUsersService,
    private couponsApi: AdminCouponsV2Service,
    private auth: AuthService,
    public favorites: AdminFavoritesService,
    public recent: AdminRecentService,
    private router: Router,
    private toast: ToastService,
    private translate: TranslateService,
    private http: HttpClient,
    private markdown: MarkdownService
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
	    this.loadLiveRefreshPreference();
	    this.loadSalesMetricPreference();
	    this.loadSummary();
      this.loadWhatsNew();
	    this.loadFunnelMetrics();
	    this.loadChannelBreakdown();
	    this.loadScheduledTasks();
	    this.loadBackgroundJobs();
	    this.loadAudit(1);
	    this.loadAuditRetention();
	    this.maybeShowOnboarding();
	  }

  clearRecent(): void {
    this.recent.clear();
  }

  openRecent(item: AdminRecentItem): void {
    const url = (item?.url || '').trim();
    if (!url) return;
    const state = item?.state && typeof item.state === 'object' ? item.state : null;
    void this.router.navigateByUrl(url, state ? { state } : undefined);
  }

  clearFavorites(): void {
    this.favorites.clear();
  }

  openFavorite(item: AdminFavoriteItem): void {
    const url = (item?.url || '').trim();
    if (!url) return;
    const state = item?.state && typeof item.state === 'object' ? item.state : null;
    void this.router.navigateByUrl(url, state ? { state } : undefined);
  }

  toggleFavorite(item: AdminFavoriteItem, event?: MouseEvent): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.favorites.toggle(item);
  }

  isOwner(): boolean {
    return this.auth.role() === 'owner';
  }

  openProducts(): void {
    void this.router.navigateByUrl('/admin/products');
  }

  openOrders(): void {
    void this.router.navigateByUrl('/admin/orders');
  }

  openUsers(): void {
    void this.router.navigateByUrl('/admin/users');
  }

  openInventory(): void {
    void this.router.navigateByUrl('/admin/inventory');
  }

  openOrdersToday(): void {
    const today = new Date().toISOString().slice(0, 10);
    this.openOrdersWithFilters({ q: '', status: 'all', tag: '', fromDate: today, toDate: today, includeTestOrders: false, limit: 20 });
  }

  openSalesToday(): void {
    const today = new Date().toISOString().slice(0, 10);
    this.openOrdersWithFilters({ q: '', status: 'sales', tag: '', fromDate: today, toDate: today, includeTestOrders: false, limit: 20 });
  }

  openRefunds(): void {
    this.openOrdersWithFilters({ q: '', status: 'refunded', tag: '', fromDate: '', toDate: '', includeTestOrders: false, limit: 20 });
  }

  openOrdersRange(): void {
    const sum = this.summary();
    const fromDate = sum?.range_from || '';
    const toDate = sum?.range_to || '';
    if (!fromDate || !toDate) {
      this.openOrders();
      return;
    }
    this.openOrdersWithFilters({ q: '', status: 'all', tag: '', fromDate, toDate, includeTestOrders: false, limit: 20 });
  }

  openSalesRange(): void {
    const sum = this.summary();
    const fromDate = sum?.range_from || '';
    const toDate = sum?.range_to || '';
    if (!fromDate || !toDate) {
      this.openOrders();
      return;
    }
    this.openOrdersWithFilters({ q: '', status: 'sales', tag: '', fromDate, toDate, includeTestOrders: false, limit: 20 });
  }

  refreshNow(): void {
    if (this.loading()) return;
    this.refreshSummarySilent();
    this.refreshChannelBreakdownSilent();
    this.refreshFunnelSilent();
    this.loadScheduledTasks();
    this.loadBackgroundJobs();
  }

  toggleLiveRefresh(): void {
    const next = !this.liveRefreshEnabled();
    this.liveRefreshEnabled.set(next);
    this.persistLiveRefreshPreference(next);
    if (next) this.startLiveRefresh();
    else this.stopLiveRefresh();
  }

  private openOrdersWithFilters(filters: any): void {
    void this.router.navigateByUrl('/admin/orders', {
      state: { adminFilterScope: 'orders', adminFilters: filters }
    });
  }

  setSalesMetric(metric: 'gross' | 'net'): void {
    this.salesMetric.set(metric);
    this.persistSalesMetricPreference(metric);
  }

  todaySales(): number {
    const sum = this.summary();
    if (!sum) return 0;
    return this.salesMetric() === 'gross' ? sum.gross_today_sales : sum.net_today_sales;
  }

  yesterdaySales(): number {
    const sum = this.summary();
    if (!sum) return 0;
    return this.salesMetric() === 'gross' ? sum.gross_yesterday_sales : sum.net_yesterday_sales;
  }

  salesDeltaPct(): number | null {
    const sum = this.summary();
    if (!sum) return null;
    return this.salesMetric() === 'gross' ? sum.gross_sales_delta_pct : sum.net_sales_delta_pct;
  }

  rangeSales(): number {
    const sum = this.summary();
    if (!sum) return 0;
    return this.salesMetric() === 'gross' ? sum.gross_sales_range : sum.net_sales_range;
  }

  channelSales(row: { gross_sales: number; net_sales: number }): number {
    return this.salesMetric() === 'gross' ? Number(row?.gross_sales ?? 0) : Number(row?.net_sales ?? 0);
  }

  formatChannelKey(key: string): string {
    const cleaned = String(key ?? '').trim();
    if (!cleaned) return '—';
    return cleaned.replace(/_/g, ' ');
  }

  ngOnDestroy(): void {
    this.stopLiveRefresh();
  }

  shouldShowJobsPanel(): boolean {
    return this.auth.canAccessAdminSection('users') || this.auth.canAccessAdminSection('coupons');
  }

  canManageGdprJobs(): boolean {
    return this.auth.isAdmin();
  }

  canManageCouponJobs(): boolean {
    return this.auth.canAccessAdminSection('coupons');
  }

  loadBackgroundJobs(): void {
    if (!this.shouldShowJobsPanel()) {
      this.gdprExportJobs.set([]);
      this.couponBulkJobs.set([]);
      return;
    }

    this.jobsLoading.set(true);
    this.jobsError.set('');

    let pending = 0;
    const done = (): void => {
      pending -= 1;
      if (pending <= 0) this.jobsLoading.set(false);
    };

    if (this.auth.canAccessAdminSection('users')) {
      pending += 1;
      this.usersApi.listGdprExportJobs({ page: 1, limit: 5 }).subscribe({
        next: (res) => {
          const items = Array.isArray(res?.items) ? res.items : [];
          this.gdprExportJobs.set(items.slice(0, 5));
        },
        error: () => {
          this.jobsError.set(this.translate.instant('adminUi.jobs.errors.load'));
          done();
        },
        complete: done
      });
    } else {
      this.gdprExportJobs.set([]);
    }

    if (this.auth.canAccessAdminSection('coupons')) {
      pending += 1;
      this.couponsApi.listAllBulkJobs({ limit: 5 }).subscribe({
        next: (items) => {
          const rows = Array.isArray(items) ? items : [];
          this.couponBulkJobs.set(rows.slice(0, 5));
        },
        error: () => {
          this.jobsError.set(this.translate.instant('adminUi.jobs.errors.load'));
          done();
        },
        complete: done
      });
    } else {
      this.couponBulkJobs.set([]);
    }

    if (pending === 0) this.jobsLoading.set(false);
  }

  goToGdprJobs(): void {
    void this.router.navigateByUrl('/admin/users/gdpr');
  }

  goToCoupons(): void {
    void this.router.navigateByUrl('/admin/coupons');
  }

  progressPct(value: unknown): number {
    const pct = Number(value ?? 0);
    if (!Number.isFinite(pct)) return 0;
    return Math.max(0, Math.min(100, pct));
  }

  couponProgressPct(job: CouponBulkJobRead): number {
    const processed = Number(job?.processed ?? 0);
    const total = Number(job?.total_candidates ?? 0);
    if (!Number.isFinite(processed) || !Number.isFinite(total) || total <= 0) return 0;
    return this.progressPct((processed / total) * 100);
  }

  retryGdprExport(job: AdminGdprExportJobItem): void {
    if (!this.canManageGdprJobs()) return;
    if (!job?.id) return;
    if (!window.confirm(this.translate.instant('adminUi.jobs.confirms.retry'))) return;
    this.gdprJobBusyId.set(job.id);
    this.usersApi.retryGdprExportJob(job.id).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('adminUi.jobs.success.retry'));
        this.loadBackgroundJobs();
        this.gdprJobBusyId.set(null);
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.jobs.errors.retry'));
        this.gdprJobBusyId.set(null);
      }
    });
  }

  downloadGdprExport(job: AdminGdprExportJobItem): void {
    if (!this.canManageGdprJobs()) return;
    if (!job?.id) return;
    this.gdprJobBusyId.set(job.id);
    this.usersApi.downloadGdprExportJob(job.id).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `gdpr-export-${stamp}.json`;
        a.click();
        window.URL.revokeObjectURL(url);
        this.toast.success(this.translate.instant('adminUi.jobs.success.download'));
        this.gdprJobBusyId.set(null);
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.jobs.errors.download'));
        this.gdprJobBusyId.set(null);
      }
    });
  }

  cancelCouponJob(job: CouponBulkJobRead): void {
    if (!this.canManageCouponJobs()) return;
    if (!job?.id) return;
    if (!window.confirm(this.translate.instant('adminUi.jobs.confirms.cancel'))) return;
    this.couponJobBusyId.set(job.id);
    this.couponsApi.cancelBulkJob(job.id).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('adminUi.jobs.success.cancel'));
        this.loadBackgroundJobs();
        this.couponJobBusyId.set(null);
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.jobs.errors.cancel'));
        this.couponJobBusyId.set(null);
      }
    });
  }

  retryCouponJob(job: CouponBulkJobRead): void {
    if (!this.canManageCouponJobs()) return;
    if (!job?.id) return;
    if (!window.confirm(this.translate.instant('adminUi.jobs.confirms.retry'))) return;
    this.couponJobBusyId.set(job.id);
    this.couponsApi.retryBulkJob(job.id).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('adminUi.jobs.success.retry'));
        this.loadBackgroundJobs();
        this.couponJobBusyId.set(null);
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.jobs.errors.retry'));
        this.couponJobBusyId.set(null);
      }
    });
  }

	  onboardingOpen = signal(false);
	  private readonly onboardingStorageKey = 'admin.onboarding.v1';

    loadWhatsNew(force = false): void {
      if (this.whatsNewLoading()) return;
      if (!force && this.whatsNewHtml()) return;
      this.whatsNewLoading.set(true);
      this.whatsNewError.set(null);
      this.http.get('assets/whats-new.md', { responseType: 'text' }).subscribe({
        next: (md) => {
          const raw = (md || '').trim();
          this.whatsNewHtml.set(raw ? this.markdown.render(md) : '');
          this.whatsNewLoading.set(false);
        },
        error: () => {
          this.whatsNewHtml.set('');
          this.whatsNewError.set(this.translate.instant('adminUi.dashboard.whatsNew.errors.load'));
          this.whatsNewLoading.set(false);
        }
      });
    }

	  private loadSummary(): void {
	    this.loading.set(true);
	    this.error.set(null);
	    this.errorRequestId.set(null);
    this.rangeError = '';
    this.admin.summary(this.buildSummaryParams()).subscribe({
      next: (data) => {
        this.summary.set(data);
        this.lastUpdatedAt.set(new Date().toISOString());
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(this.translate.instant('adminUi.errors.generic'));
        this.errorRequestId.set(extractRequestId(err));
        this.loading.set(false);
      }
    });
  }

  private refreshSummarySilent(): void {
    this.admin.summary(this.buildSummaryParams()).subscribe({
      next: (data) => {
        this.summary.set(data);
        this.lastUpdatedAt.set(new Date().toISOString());
      },
      error: () => {
        // ignore background refresh failures
      }
    });
  }

  private loadChannelBreakdown(): void {
    this.channelBreakdownLoading.set(true);
    this.channelBreakdownError.set(null);
    this.admin.channelBreakdown(this.buildSummaryParams()).subscribe({
      next: (data) => {
        this.channelBreakdown.set(data);
        this.channelBreakdownLoading.set(false);
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant('adminUi.dashboard.channelBreakdown.error');
        this.channelBreakdownError.set(msg);
        this.channelBreakdownLoading.set(false);
      }
    });
  }

  private refreshChannelBreakdownSilent(): void {
    this.admin.channelBreakdown(this.buildSummaryParams()).subscribe({
      next: (data) => {
        this.channelBreakdown.set(data);
      },
      error: () => {
        // ignore background refresh failures
      }
    });
  }

  private loadFunnelMetrics(): void {
    this.funnelLoading.set(true);
    this.funnelError.set(null);
    this.admin.funnel(this.buildSummaryParams()).subscribe({
      next: (data) => {
        this.funnelMetrics.set(data);
        this.funnelLoading.set(false);
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant('adminUi.dashboard.funnel.error');
        this.funnelError.set(msg);
        this.funnelLoading.set(false);
      }
    });
  }

  private refreshFunnelSilent(): void {
    this.admin.funnel(this.buildSummaryParams()).subscribe({
      next: (data) => {
        this.funnelMetrics.set(data);
      },
      error: () => {
        // ignore background refresh failures
      }
    });
  }

  private startLiveRefresh(): void {
    this.stopLiveRefresh();
    this.refreshNow();
    this.liveRefreshTimerId = window.setInterval(() => this.refreshNow(), 60 * 1000);
  }

  private stopLiveRefresh(): void {
    if (this.liveRefreshTimerId === null) return;
    window.clearInterval(this.liveRefreshTimerId);
    this.liveRefreshTimerId = null;
  }

  private loadLiveRefreshPreference(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.liveRefreshStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const enabled = Boolean((parsed as any)?.enabled);
      this.liveRefreshEnabled.set(enabled);
      if (enabled) this.startLiveRefresh();
    } catch {
      // ignore
    }
  }

  private loadSalesMetricPreference(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.salesMetricStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const metric = (parsed as any)?.metric;
      if (metric === 'gross' || metric === 'net') this.salesMetric.set(metric);
    } catch {
      // ignore
    }
  }

  private persistLiveRefreshPreference(enabled: boolean): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.liveRefreshStorageKey, JSON.stringify({ enabled }));
    } catch {
      // ignore
    }
  }

  private persistSalesMetricPreference(metric: 'gross' | 'net'): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.salesMetricStorageKey, JSON.stringify({ metric }));
    } catch {
      // ignore
    }
  }

  retryDashboard(): void {
    this.loadSummary();
    this.loadChannelBreakdown();
  }

  openOnboarding(): void {
    this.onboardingOpen.set(true);
  }

  dismissOnboarding(): void {
    this.saveOnboardingState({ dismissed_at: new Date().toISOString() });
    this.onboardingOpen.set(false);
  }

  completeOnboarding(): void {
    this.saveOnboardingState({ completed_at: new Date().toISOString() });
    this.onboardingOpen.set(false);
  }

  goToOnboarding(url: string): void {
    this.onboardingOpen.set(false);
    void this.router.navigateByUrl(url);
  }

  private maybeShowOnboarding(): void {
    if (!this.isOwner()) return;
    const state = this.loadOnboardingState();
    if (state.completed_at) return;
    const dismissedAt = (state.dismissed_at || '').trim();
    if (dismissedAt) {
      const dismissedMs = Date.parse(dismissedAt);
      if (Number.isFinite(dismissedMs)) {
        const ageMs = Date.now() - dismissedMs;
        if (ageMs < 7 * 24 * 60 * 60 * 1000) return;
      }
    }
    this.onboardingOpen.set(true);
  }

  private loadOnboardingState(): AdminOnboardingState {
    try {
      const raw = localStorage.getItem(this.onboardingStorageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed ? (parsed as AdminOnboardingState) : {};
    } catch {
      return {};
    }
  }

  private saveOnboardingState(update: AdminOnboardingState): void {
    try {
      const current = this.loadOnboardingState();
      const next: AdminOnboardingState = { ...current, ...update };
      localStorage.setItem(this.onboardingStorageKey, JSON.stringify(next));
    } catch {
      // Ignore storage errors (e.g. private mode / disabled storage).
    }
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
    this.loadFunnelMetrics();
    this.loadChannelBreakdown();
  }

  applyRange(): void {
    if (this.rangePreset !== 'custom') {
      this.loadSummary();
      this.loadFunnelMetrics();
      this.loadChannelBreakdown();
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
    this.loadFunnelMetrics();
    this.loadChannelBreakdown();
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
    if (this.globalSearchActiveIndex() === -1 && this.globalSearchResults().length > 0) {
      this.globalSearchActiveIndex.set(0);
    }
  }

  onGlobalSearchBlur(): void {
    if (this.globalSearchBlurHandle !== null) clearTimeout(this.globalSearchBlurHandle);
    this.globalSearchBlurHandle = window.setTimeout(() => {
      this.globalSearchOpen.set(false);
      this.globalSearchActiveIndex.set(-1);
      this.globalSearchBlurHandle = null;
    }, 150);
  }

  onGlobalSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.globalSearchOpen.set(false);
      this.globalSearchActiveIndex.set(-1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.openGlobalSearch();
      this.moveGlobalSearchActive(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.openGlobalSearch();
      this.moveGlobalSearchActive(-1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      this.setGlobalSearchActive(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      this.setGlobalSearchActive(this.globalSearchResults().length - 1);
      return;
    }
    if (event.key !== 'Enter') return;
    const selected = this.getGlobalSearchActive() || this.globalSearchResults()[0];
    if (!selected) return;
    event.preventDefault();
    this.selectGlobalSearch(selected);
  }

  onGlobalSearchChange(): void {
    const needle = (this.globalSearchQuery || '').trim();
    this.globalSearchError = '';
    this.globalSearchActiveIndex.set(-1);

    if (this.globalSearchDebounceHandle !== null) {
      clearTimeout(this.globalSearchDebounceHandle);
      this.globalSearchDebounceHandle = null;
    }

    if (needle.length < 2) {
      this.globalSearchResults.set([]);
      this.globalSearchLoading.set(false);
      this.globalSearchActiveIndex.set(-1);
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
        const items = Array.isArray(res?.items) ? res.items : [];
        this.globalSearchResults.set(items);
        this.globalSearchActiveIndex.set(items.length > 0 ? 0 : -1);
        this.globalSearchLoading.set(false);
      },
      error: () => {
        if (requestId !== this.globalSearchRequestId) return;
        this.globalSearchResults.set([]);
        this.globalSearchLoading.set(false);
        this.globalSearchActiveIndex.set(-1);
        this.globalSearchError = this.translate.instant('adminUi.errors.generic');
      }
    });
  }

  globalSearchActiveDescendant(): string | null {
    if (!this.globalSearchOpen()) return null;
    const idx = this.globalSearchActiveIndex();
    if (idx < 0 || idx >= this.globalSearchResults().length) return null;
    return `admin-global-search-option-${idx}`;
  }

  private getGlobalSearchActive(): AdminDashboardSearchResult | null {
    const idx = this.globalSearchActiveIndex();
    const items = this.globalSearchResults();
    if (idx < 0 || idx >= items.length) return null;
    return items[idx];
  }

  private moveGlobalSearchActive(delta: number): void {
    const items = this.globalSearchResults();
    if (items.length === 0) {
      this.globalSearchActiveIndex.set(-1);
      return;
    }
    const current = this.globalSearchActiveIndex();
    const next = Math.max(0, Math.min(items.length - 1, (current < 0 ? 0 : current) + delta));
    this.setGlobalSearchActive(next);
  }

  private setGlobalSearchActive(index: number): void {
    const items = this.globalSearchResults();
    if (items.length === 0) {
      this.globalSearchActiveIndex.set(-1);
      return;
    }
    const bounded = Math.max(0, Math.min(items.length - 1, index));
    this.globalSearchActiveIndex.set(bounded);
    const id = `admin-global-search-option-${bounded}`;
    window.setTimeout(() => {
      if (typeof document === 'undefined') return;
      document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
    }, 0);
  }

  globalSearchTypeLabel(type: AdminDashboardSearchResultType): string {
    return this.translate.instant(`adminUi.dashboard.globalSearchTypes.${type}`);
  }

  selectGlobalSearch(item: AdminDashboardSearchResult, event?: MouseEvent): void {
    if (event) event.preventDefault();
    this.globalSearchOpen.set(false);
    this.globalSearchActiveIndex.set(-1);

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
