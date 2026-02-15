import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { catchError, forkJoin, of } from 'rxjs';
import { AdminService, MediaTelemetryResponse } from '../../../core/admin.service';
import {
  OpsService,
  BannerLevel,
  MaintenanceBannerRead,
  ShippingMethodRead,
  ShippingSimulationResult,
  OpsDiagnosticsRead,
  EmailFailureRead,
  WebhookEventRead,
  WebhookEventDetail
} from '../../../core/ops.service';
import { appConfig } from '../../../core/app-config';
import { HealthService } from '../../../core/health.service';
import { ToastService } from '../../../core/toast.service';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { AdminPageHeaderComponent } from '../shared/admin-page-header.component';

@Component({
  selector: 'app-admin-ops',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, BreadcrumbComponent, ButtonComponent, SkeletonComponent, AdminPageHeaderComponent],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs()"></app-breadcrumb>

      <app-admin-page-header [titleKey]="'adminUi.ops.title'" [hintKey]="'adminUi.ops.subtitle'"></app-admin-page-header>

      <div class="grid gap-6">
        <div class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.ops.health.title' | translate }}</div>
              <div class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.ops.health.hint' | translate }}</div>
            </div>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'adminUi.actions.refresh' | translate"
              [disabled]="healthLoading()"
              (action)="loadHealthDashboard()"
            ></app-button>
          </div>

          <div *ngIf="healthLoading()" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <app-skeleton [rows]="2"></app-skeleton>
          </div>

          <div
            *ngIf="!healthLoading() && healthError()"
            class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
          >
            {{ healthError() }}
          </div>

          <div *ngIf="!healthLoading()" class="grid gap-3 md:grid-cols-4">
            <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
              <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {{ 'adminUi.ops.health.backend' | translate }}
              </p>
              <p class="mt-2 font-semibold text-slate-900 dark:text-slate-50">
                {{
                  backendReady()
                    ? ('adminUi.dashboard.systemHealth.ready' | translate)
                    : ('adminUi.dashboard.systemHealth.unavailable' | translate)
                }}
              </p>
            </div>

            <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
              <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {{ 'adminUi.ops.health.webhooksFailed' | translate }}
              </p>
              <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ webhookFailures24h() }}</p>
              <p class="mt-1 text-xs text-slate-600 dark:text-slate-300">{{ 'adminUi.ops.health.lastHours' | translate: { hours: 24 } }}</p>
            </div>

            <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
              <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {{ 'adminUi.ops.health.webhooksBacklog' | translate }}
              </p>
              <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ webhookBacklog24h() }}</p>
              <p class="mt-1 text-xs text-slate-600 dark:text-slate-300">{{ 'adminUi.ops.health.lastHours' | translate: { hours: 24 } }}</p>
            </div>

            <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
              <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {{ 'adminUi.ops.health.emailFailures' | translate }}
              </p>
              <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ emailFailures24h() }}</p>
              <p class="mt-1 text-xs text-slate-600 dark:text-slate-300">{{ 'adminUi.ops.health.lastHours' | translate: { hours: 24 } }}</p>
            </div>
          </div>

          <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20 grid gap-2">
            <div class="flex items-center justify-between gap-2">
              <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">DAM telemetry</p>
              <button
                type="button"
                class="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                [disabled]="damTelemetryLoading()"
                (click)="loadDamTelemetry()"
              >
                Refresh
              </button>
            </div>
            <div *ngIf="damTelemetryLoading()" class="text-xs text-slate-500 dark:text-slate-400">Loading DAM telemetry…</div>
            <div *ngIf="damTelemetryError()" class="text-xs text-rose-700 dark:text-rose-300">{{ damTelemetryError() }}</div>
            <div *ngIf="damTelemetry() as dam" class="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
              <div class="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900">
                <p class="text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Queue</p>
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ dam.queue_depth }}</p>
              </div>
              <div class="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900">
                <p class="text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Workers</p>
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ dam.online_workers }}</p>
              </div>
              <div class="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900">
                <p class="text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Stale</p>
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ dam.stale_processing_count }}</p>
              </div>
              <div class="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900">
                <p class="text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Oldest queued</p>
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ formatDamAge(dam.oldest_queued_age_seconds) }}</p>
              </div>
              <div class="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900">
                <p class="text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Dead-letter</p>
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ dam.dead_letter_count }}</p>
              </div>
              <div class="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900">
                <p class="text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">SLA breaches</p>
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ dam.sla_breached_count }}</p>
              </div>
              <div class="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900">
                <p class="text-[10px] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Retry scheduled</p>
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ dam.retry_scheduled_count }}</p>
              </div>
            </div>
          </div>

	          <p *ngIf="healthCheckedAt() as checkedAt" class="text-xs text-slate-500 dark:text-slate-400">
	            {{ 'adminUi.ops.health.lastChecked' | translate }}: {{ checkedAt | date: 'short' }}
	          </p>
	        </div>

	        <div class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
	          <div class="flex items-center justify-between gap-3 flex-wrap">
	            <div>
	              <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.ops.diagnostics.title' | translate }}</div>
	              <div class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.ops.diagnostics.hint' | translate }}</div>
	            </div>
	            <app-button
	              size="sm"
	              variant="ghost"
	              [label]="'adminUi.actions.refresh' | translate"
	              [disabled]="diagnosticsLoading()"
	              (action)="loadDiagnostics()"
	            ></app-button>
	          </div>

	          <div *ngIf="diagnosticsLoading()" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
	            <app-skeleton [rows]="2"></app-skeleton>
	          </div>

	          <div
	            *ngIf="!diagnosticsLoading() && diagnosticsError()"
	            class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
	          >
	            {{ diagnosticsError() }}
	          </div>

	          <div *ngIf="!diagnosticsLoading() && diagnostics() as diag" class="grid gap-3">
	            <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
	              <div>
	                {{ 'adminUi.ops.diagnostics.environment' | translate }}:
	                <span class="font-mono text-slate-700 dark:text-slate-200">{{ diag.environment }}</span>
	                · {{ 'adminUi.ops.diagnostics.backendBuild' | translate }}:
	                <span class="font-mono text-slate-700 dark:text-slate-200">{{ diag.app_version || 'n/a' }}</span>
	                · {{ 'adminUi.ops.diagnostics.frontendBuild' | translate }}:
	                <span class="font-mono text-slate-700 dark:text-slate-200">{{ frontendBuildVersion }}</span>
	                · {{ 'adminUi.ops.diagnostics.paymentsProvider' | translate }}:
	                <span class="font-mono text-slate-700 dark:text-slate-200">{{ diag.payments_provider }}</span>
	              </div>
	              <div>{{ 'adminUi.ops.diagnostics.lastChecked' | translate }}: {{ diag.checked_at | date: 'short' }}</div>
	            </div>

	            <div class="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
	              <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
	                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
	                  {{ 'adminUi.ops.diagnostics.smtp' | translate }}
	                </p>
	                <div class="mt-2 flex items-center gap-2">
	                  <span class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold" [ngClass]="diagnosticsBadgeClass(diag.smtp.status)">
	                    {{ ('adminUi.ops.diagnostics.status.' + diag.smtp.status) | translate }}
	                  </span>
	                </div>
	                <p *ngIf="diag.smtp.message" class="mt-1 text-xs text-slate-600 dark:text-slate-300">{{ diag.smtp.message }}</p>
	              </div>

	              <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
	                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
	                  {{ 'adminUi.ops.diagnostics.redis' | translate }}
	                </p>
	                <div class="mt-2 flex items-center gap-2">
	                  <span class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold" [ngClass]="diagnosticsBadgeClass(diag.redis.status)">
	                    {{ ('adminUi.ops.diagnostics.status.' + diag.redis.status) | translate }}
	                  </span>
	                </div>
	                <p *ngIf="diag.redis.message" class="mt-1 text-xs text-slate-600 dark:text-slate-300">{{ diag.redis.message }}</p>
	              </div>

	              <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
	                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
	                  {{ 'adminUi.ops.diagnostics.storage' | translate }}
	                </p>
	                <div class="mt-2 flex items-center gap-2">
	                  <span class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold" [ngClass]="diagnosticsBadgeClass(diag.storage.status)">
	                    {{ ('adminUi.ops.diagnostics.status.' + diag.storage.status) | translate }}
	                  </span>
	                </div>
	                <p *ngIf="diag.storage.message" class="mt-1 text-xs text-slate-600 dark:text-slate-300">{{ diag.storage.message }}</p>
	              </div>

	              <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
	                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
	                  {{ 'adminUi.ops.diagnostics.stripe' | translate }}
	                </p>
	                <div class="mt-2 flex items-center gap-2">
	                  <span class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold" [ngClass]="diagnosticsBadgeClass(diag.stripe.status)">
	                    {{ ('adminUi.ops.diagnostics.status.' + diag.stripe.status) | translate }}
	                  </span>
	                </div>
	                <p *ngIf="diag.stripe.message" class="mt-1 text-xs text-slate-600 dark:text-slate-300">{{ diag.stripe.message }}</p>
	              </div>

	              <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
	                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
	                  {{ 'adminUi.ops.diagnostics.paypal' | translate }}
	                </p>
	                <div class="mt-2 flex items-center gap-2">
	                  <span class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold" [ngClass]="diagnosticsBadgeClass(diag.paypal.status)">
	                    {{ ('adminUi.ops.diagnostics.status.' + diag.paypal.status) | translate }}
	                  </span>
	                </div>
	                <p *ngIf="diag.paypal.message" class="mt-1 text-xs text-slate-600 dark:text-slate-300">{{ diag.paypal.message }}</p>
	              </div>

	              <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
	                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
	                  {{ 'adminUi.ops.diagnostics.netopia' | translate }}
	                </p>
	                <div class="mt-2 flex items-center gap-2">
	                  <span class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold" [ngClass]="diagnosticsBadgeClass(diag.netopia.status)">
	                    {{ ('adminUi.ops.diagnostics.status.' + diag.netopia.status) | translate }}
	                  </span>
	                </div>
	                <p *ngIf="diag.netopia.message" class="mt-1 text-xs text-slate-600 dark:text-slate-300">{{ diag.netopia.message }}</p>
	              </div>
	            </div>
	          </div>
	        </div>

	        <div class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
	          <div class="flex items-center justify-between gap-3 flex-wrap">
	            <div>
	              <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.ops.newsletter.title' | translate }}</div>
              <div class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.ops.newsletter.hint' | translate }}</div>
            </div>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'adminUi.ops.newsletter.download' | translate"
              [disabled]="newsletterExporting()"
              (action)="downloadNewsletterExport()"
            ></app-button>
          </div>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.ops.banner.title' | translate }}</div>
              <div class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.ops.banner.hint' | translate }}</div>
            </div>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'adminUi.ops.banner.new' | translate"
              [disabled]="bannerSaving()"
              (action)="resetBannerForm()"
            ></app-button>
          </div>

          <div *ngIf="bannersLoading()" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <app-skeleton [rows]="5"></app-skeleton>
          </div>

          <div *ngIf="!bannersLoading() && bannersError()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
            {{ bannersError() }}
          </div>

          <div class="grid lg:grid-cols-[1fr_1fr] gap-4">
            <div class="grid gap-3">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.ops.banner.level' | translate }}
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="bannerLevel"
                >
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="info">
                    {{ 'adminUi.ops.banner.levelInfo' | translate }}
                  </option>
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="warning">
                    {{ 'adminUi.ops.banner.levelWarning' | translate }}
                  </option>
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="promo">
                    {{ 'adminUi.ops.banner.levelPromo' | translate }}
                  </option>
                </select>
              </label>

              <div class="grid sm:grid-cols-2 gap-3">
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.ops.banner.startsAt' | translate }}
                  <input
                    type="datetime-local"
                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="bannerStartsAtLocal"
                  />
                </label>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.ops.banner.endsAt' | translate }}
                  <input
                    type="datetime-local"
                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="bannerEndsAtLocal"
                  />
                </label>
              </div>

              <label class="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" [(ngModel)]="bannerIsActive" />
                <span class="font-medium">{{ 'adminUi.ops.banner.active' | translate }}</span>
              </label>
            </div>

            <div class="grid gap-3">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.ops.banner.messageEn' | translate }}
                <textarea
                  class="min-h-[110px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                  [(ngModel)]="bannerMessageEn"
                  [placeholder]="'adminUi.ops.banner.messagePh' | translate"
                ></textarea>
              </label>
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.ops.banner.messageRo' | translate }}
                <textarea
                  class="min-h-[110px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                  [(ngModel)]="bannerMessageRo"
                  [placeholder]="'adminUi.ops.banner.messagePh' | translate"
                ></textarea>
              </label>

              <div class="grid sm:grid-cols-2 gap-3">
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.ops.banner.linkUrl' | translate }}
                  <input
                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="bannerLinkUrl"
                    [placeholder]="'adminUi.ops.banner.linkUrlPh' | translate"
                  />
                </label>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.ops.banner.linkLabelEn' | translate }}
                  <input
                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="bannerLinkLabelEn"
                    [placeholder]="'adminUi.ops.banner.linkLabelPh' | translate"
                  />
                </label>
              </div>

              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.ops.banner.linkLabelRo' | translate }}
                <input
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="bannerLinkLabelRo"
                  [placeholder]="'adminUi.ops.banner.linkLabelPh' | translate"
                />
              </label>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div class="text-xs text-slate-500 dark:text-slate-400">
              <span *ngIf="editingBannerId">{{ 'adminUi.ops.banner.editing' | translate }} · {{ editingBannerId.slice(0, 8) }}</span>
              <span *ngIf="!editingBannerId">{{ 'adminUi.ops.banner.creating' | translate }}</span>
            </div>
            <div class="flex items-center gap-2">
              <app-button
                size="sm"
                variant="ghost"
                *ngIf="editingBannerId"
                [label]="'adminUi.ops.banner.delete' | translate"
                [disabled]="bannerSaving()"
                (action)="deleteBanner(editingBannerId)"
              ></app-button>
              <app-button
                size="sm"
                [label]="(editingBannerId ? 'adminUi.ops.banner.save' : 'adminUi.ops.banner.create') | translate"
                [disabled]="bannerSaving()"
                (action)="saveBanner()"
              ></app-button>
            </div>
          </div>

          <div *ngIf="!bannersLoading() && banners().length" class="grid gap-2">
            <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
              {{ 'adminUi.ops.banner.listTitle' | translate }}
            </div>
            <div class="grid gap-2">
              <button
                type="button"
                *ngFor="let b of banners()"
                class="text-left rounded-xl border border-slate-200 bg-white p-3 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/60"
                [ngClass]="b.id === editingBannerId ? 'ring-2 ring-indigo-500/40' : ''"
                (click)="selectBanner(b)"
              >
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {{ ('adminUi.ops.banner.status.' + bannerStatus(b)) | translate }}
                      <span class="text-xs font-normal text-slate-500 dark:text-slate-400">·</span>
                      <span class="text-xs font-medium text-slate-600 dark:text-slate-300">{{ b.level }}</span>
                    </div>
                    <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      {{ b.starts_at | date: 'short' }}<span *ngIf="b.ends_at"> → {{ b.ends_at | date: 'short' }}</span>
                    </div>
                  </div>
                  <div class="text-xs text-slate-500 dark:text-slate-400 shrink-0">{{ b.id.slice(0, 8) }}</div>
                </div>
                <div class="mt-2 grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                  <div class="truncate">{{ b.message_en }}</div>
                  <div class="truncate text-slate-500 dark:text-slate-400">{{ b.message_ro }}</div>
                </div>
              </button>
            </div>
          </div>
        </div>

        <div class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.ops.shipping.title' | translate }}</div>
            <div class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.ops.shipping.hint' | translate }}</div>
          </div>

          <div *ngIf="shippingMethodsLoading()" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <app-skeleton [rows]="3"></app-skeleton>
          </div>

          <div class="grid md:grid-cols-[1fr_auto] gap-3 items-end">
            <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.ops.shipping.subtotal' | translate }}
                <input
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="simSubtotal"
                  placeholder="100.00"
                />
              </label>
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.ops.shipping.discount' | translate }}
                <input
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="simDiscount"
                  placeholder="0.00"
                />
              </label>
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.ops.shipping.method' | translate }}
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="simShippingMethodId"
                >
                  <option class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" value="">
                    {{ 'adminUi.ops.shipping.methodAuto' | translate }}
                  </option>
                  <option
                    *ngFor="let m of shippingMethods()"
                    class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"
                    [value]="m.id"
                  >
                    {{ m.name }}
                  </option>
                </select>
              </label>
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.ops.shipping.postalCode' | translate }}
                <input
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="simPostalCode"
                  placeholder="000000"
                />
              </label>
            </div>

            <app-button size="sm" [label]="'adminUi.ops.shipping.run' | translate" [disabled]="simLoading()" (action)="runSimulation()"></app-button>
          </div>

          <div *ngIf="simError()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
            {{ simError() }}
          </div>

          <div *ngIf="simResult()" class="grid gap-3 text-sm text-slate-700 dark:text-slate-200">
            <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.ops.shipping.result.subtotal' | translate }}</div>
                <div class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ simResult()!.subtotal_ron }} RON</div>
              </div>
              <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.ops.shipping.result.shipping' | translate }}</div>
                <div class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ simResult()!.shipping_ron }} RON</div>
              </div>
              <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.ops.shipping.result.vat' | translate }}</div>
                <div class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ simResult()!.vat_ron }} RON</div>
              </div>
              <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.ops.shipping.result.total' | translate }}</div>
                <div class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ simResult()!.total_ron }} RON</div>
              </div>
            </div>

            <div class="rounded-xl border border-slate-200 p-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
              <div>{{ 'adminUi.ops.shipping.result.settingsTitle' | translate }}</div>
              <div class="mt-1">
                {{ 'adminUi.ops.shipping.result.settingsLine' | translate: { fee: simResult()!.shipping_fee_ron ?? '—', threshold: simResult()!.free_shipping_threshold_ron ?? '—' } }}
              </div>
            </div>

	            <div *ngIf="simResult()!.methods?.length" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
	              <table class="min-w-[760px] w-full text-sm">
	                <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
	                  <tr>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.ops.shipping.table.method' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.ops.shipping.table.rateFlat' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.ops.shipping.table.ratePerKg' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.ops.shipping.table.computed' | translate }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
                  <tr *ngFor="let m of simResult()!.methods">
                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ m.name }}</td>
                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ m.rate_flat ?? '—' }}</td>
                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ m.rate_per_kg ?? '—' }}</td>
                    <td class="px-3 py-2 font-semibold text-slate-900 dark:text-slate-50">{{ m.computed_shipping_ron }} RON</td>
                  </tr>
                </tbody>
	              </table>
	            </div>
	          </div>
	        </div>

        <div
          id="admin-ops-email-failures"
          class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.ops.emailFailures.title' | translate }}</div>
              <div class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.ops.emailFailures.hint' | translate }}</div>
            </div>
            <div class="flex items-center gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.ops.emailFailures.refresh' | translate"
                [disabled]="emailFailuresLoading()"
                (action)="loadEmailFailures()"
              ></app-button>
            </div>
          </div>

          <div class="flex flex-wrap items-end gap-2">
            <label class="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
              {{ 'adminUi.ops.emailFailures.filters.to' | translate }}
              <input
                class="h-10 w-[min(360px,100%)] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="emailFailuresTo"
                [placeholder]="'adminUi.ops.emailFailures.filters.toPlaceholder' | translate"
              />
            </label>
            <label class="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
              {{ 'adminUi.ops.emailFailures.filters.sinceHours' | translate }}
              <input
                type="number"
                min="1"
                max="168"
                class="h-10 w-28 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="emailFailuresSinceHours"
              />
            </label>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'adminUi.actions.apply' | translate"
              [disabled]="emailFailuresLoading()"
              (action)="loadEmailFailures()"
            ></app-button>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'adminUi.actions.reset' | translate"
              [disabled]="emailFailuresLoading()"
              (action)="resetEmailFailureFilters()"
            ></app-button>
          </div>

          <div *ngIf="emailFailuresLoading()" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <app-skeleton [rows]="4"></app-skeleton>
          </div>

          <div
            *ngIf="!emailFailuresLoading() && emailFailuresError()"
            class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
          >
            {{ emailFailuresError() }}
          </div>

          <div
            *ngIf="!emailFailuresLoading() && !emailFailuresError() && !emailFailures().length"
            class="text-sm text-slate-600 dark:text-slate-300"
          >
            {{ 'adminUi.ops.emailFailures.empty' | translate }}
          </div>

          <div
            *ngIf="!emailFailuresLoading() && emailFailures().length"
            class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800"
          >
            <table class="min-w-[980px] w-full text-sm">
              <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                <tr>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.ops.emailFailures.table.to' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.ops.emailFailures.table.subject' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.ops.emailFailures.table.at' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.ops.emailFailures.table.error' | translate }}</th>
                  <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.ops.emailFailures.table.actions' | translate }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
                <tr *ngFor="let row of emailFailures()">
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ row.to_email }}</td>
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200 max-w-[360px] truncate">{{ row.subject }}</td>
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ row.created_at | date: 'short' }}</td>
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200 max-w-[360px] truncate">{{ row.error_message || '—' }}</td>
                  <td class="px-3 py-2">
                    <div class="flex justify-end items-center gap-2">
                      <app-button
                        size="sm"
                        variant="ghost"
                        [label]="'adminUi.ops.emailFailures.view' | translate"
                        (action)="viewEmailFailure(row)"
                      ></app-button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div *ngIf="selectedEmailFailure()" class="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                {{ 'adminUi.ops.emailFailures.detailTitle' | translate }} · {{ selectedEmailFailure()!.to_email }}
              </div>
              <app-button size="sm" variant="ghost" [label]="'adminUi.ops.emailFailures.close' | translate" (action)="closeEmailFailureDetail()"></app-button>
            </div>

            <div class="mt-2 text-xs text-slate-600 dark:text-slate-300">
              {{ selectedEmailFailure()!.subject }}
            </div>

            <pre
              *ngIf="selectedEmailFailure()!.error_message"
              class="mt-3 max-h-[220px] overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-950/30 dark:text-slate-200"
            >{{ selectedEmailFailure()!.error_message }}</pre>
          </div>
        </div>

        <div
          id="admin-ops-webhooks"
          class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.ops.webhooks.title' | translate }}</div>
              <div class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.ops.webhooks.hint' | translate }}</div>
            </div>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'adminUi.ops.webhooks.refresh' | translate"
              [disabled]="webhooksLoading()"
              (action)="loadWebhooks()"
            ></app-button>
          </div>

          <div *ngIf="webhooksLoading()" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <app-skeleton [rows]="4"></app-skeleton>
          </div>

          <div *ngIf="!webhooksLoading() && webhooksError()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
            {{ webhooksError() }}
          </div>

          <div
            *ngIf="!webhooksLoading() && !webhooksError() && !webhooks().length"
            class="text-sm text-slate-600 dark:text-slate-300"
          >
            {{ 'adminUi.ops.webhooks.empty' | translate }}
          </div>

          <div *ngIf="!webhooksLoading() && webhooks().length" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table class="min-w-[980px] w-full text-sm">
              <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                <tr>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.ops.webhooks.table.provider' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.ops.webhooks.table.eventType' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.ops.webhooks.table.status' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.ops.webhooks.table.attempts' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.ops.webhooks.table.lastAttempt' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.ops.webhooks.table.error' | translate }}</th>
                  <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.ops.webhooks.table.actions' | translate }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
                <tr *ngFor="let w of webhooks()">
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
                    {{ ('adminUi.ops.webhooks.provider.' + w.provider) | translate }}
                  </td>
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
                    {{ w.event_type || '—' }}
                  </td>
                  <td class="px-3 py-2">
                    <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold" [ngClass]="webhookStatusClasses(w.status)">
                      {{ ('adminUi.ops.webhooks.status.' + w.status) | translate }}
                    </span>
                  </td>
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ w.attempts }}</td>
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ w.last_attempt_at | date: 'short' }}</td>
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200 max-w-[360px] truncate">{{ w.last_error || '—' }}</td>
                  <td class="px-3 py-2">
                    <div class="flex justify-end items-center gap-2">
                      <app-button size="sm" variant="ghost" [label]="'adminUi.ops.webhooks.view' | translate" (action)="viewWebhook(w)"></app-button>
                      <app-button
                        *ngIf="w.status !== 'processed'"
                        size="sm"
                        variant="ghost"
                        [label]="'adminUi.ops.webhooks.retry' | translate"
                        [disabled]="webhookRetrying() === w.provider + ':' + w.event_id"
                        (action)="retryWebhook(w)"
                      ></app-button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div *ngIf="selectedWebhook()" class="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                {{ 'adminUi.ops.webhooks.detailTitle' | translate }} · {{ selectedWebhook()!.provider }} · {{ selectedWebhook()!.event_id }}
              </div>
              <app-button size="sm" variant="ghost" [label]="'adminUi.ops.webhooks.close' | translate" (action)="closeWebhookDetail()"></app-button>
            </div>

            <div
              *ngIf="selectedWebhook()!.last_error"
              class="mt-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
            >
              {{ selectedWebhook()!.last_error }}
            </div>

            <pre class="mt-3 max-h-[320px] overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-950/30 dark:text-slate-200">{{ selectedWebhook()!.payload | json }}</pre>
          </div>
        </div>
	      </div>
	    </div>
	  `
})
export class AdminOpsComponent implements OnInit {
  readonly frontendBuildVersion = (appConfig.appVersion || '').trim() || 'n/a';
  healthLoading = signal(true);
  healthError = signal<string | null>(null);
  backendReady = signal(false);
  webhookFailures24h = signal(0);
  webhookBacklog24h = signal(0);
  emailFailures24h = signal(0);
  healthCheckedAt = signal<Date | null>(null);
  newsletterExporting = signal(false);

  diagnosticsLoading = signal(true);
  diagnosticsError = signal<string | null>(null);
  diagnostics = signal<OpsDiagnosticsRead | null>(null);
  damTelemetryLoading = signal(false);
  damTelemetryError = signal<string | null>(null);
  damTelemetry = signal<MediaTelemetryResponse | null>(null);

  bannersLoading = signal(true);
  bannersError = signal<string | null>(null);
  banners = signal<MaintenanceBannerRead[]>([]);
  bannerSaving = signal(false);

  editingBannerId: string | null = null;
  bannerIsActive = true;
  bannerLevel: BannerLevel = 'info';
  bannerStartsAtLocal = '';
  bannerEndsAtLocal = '';
  bannerMessageEn = '';
  bannerMessageRo = '';
  bannerLinkUrl = '';
  bannerLinkLabelEn = '';
  bannerLinkLabelRo = '';

  shippingMethodsLoading = signal(true);
  shippingMethods = signal<ShippingMethodRead[]>([]);

  simSubtotal = '100.00';
  simDiscount = '0.00';
  simShippingMethodId = '';
  simPostalCode = '';
  simLoading = signal(false);
  simError = signal<string | null>(null);
  simResult = signal<ShippingSimulationResult | null>(null);

  emailFailuresLoading = signal(true);
  emailFailuresError = signal<string | null>(null);
  emailFailures = signal<EmailFailureRead[]>([]);
  selectedEmailFailure = signal<EmailFailureRead | null>(null);
  emailFailuresTo = '';
  emailFailuresSinceHours = 24;

  webhooksLoading = signal(true);
  webhooksError = signal<string | null>(null);
  webhooks = signal<WebhookEventRead[]>([]);
  selectedWebhook = signal<WebhookEventDetail | null>(null);
  webhookRetrying = signal<string | null>(null);

  constructor(
    private adminService: AdminService,
    private health: HealthService,
    private ops: OpsService,
    private toast: ToastService,
    private translate: TranslateService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.resetBannerForm();
    this.loadHealthDashboard();
    this.loadDiagnostics();
    this.loadDamTelemetry();
    this.loadBanners();
    this.loadShippingMethods();
    this.applyEmailFailuresDeepLink();
    this.loadEmailFailures();
    this.loadWebhooks();
    this.maybeFocusSection();
  }

  loadHealthDashboard(): void {
    this.healthLoading.set(true);
    this.healthError.set(null);
    const sinceHours = 24;

    forkJoin({
      ready: this.health.ready().pipe(catchError(() => of(null))),
      webhooksFailed: this.ops.getWebhookFailureStats({ since_hours: sinceHours }).pipe(catchError(() => of(null))),
      webhooksBacklog: this.ops.getWebhookBacklogStats({ since_hours: sinceHours }).pipe(catchError(() => of(null))),
      emailsFailed: this.ops.getEmailFailureStats({ since_hours: sinceHours }).pipe(catchError(() => of(null)))
    }).subscribe({
      next: (res) => {
        this.backendReady.set(Boolean(res.ready));

        if (res.webhooksFailed) {
          const count = Number((res.webhooksFailed as any)?.failed ?? 0);
          this.webhookFailures24h.set(Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0);
        }
        if (res.webhooksBacklog) {
          const count = Number((res.webhooksBacklog as any)?.pending ?? 0);
          this.webhookBacklog24h.set(Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0);
        }
        if (res.emailsFailed) {
          const count = Number((res.emailsFailed as any)?.failed ?? 0);
          this.emailFailures24h.set(Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0);
        }

        const failedCalls = [
          res.ready == null,
          res.webhooksFailed == null,
          res.webhooksBacklog == null,
          res.emailsFailed == null
        ].some(Boolean);
        if (failedCalls) {
          this.healthError.set(this.translate.instant('adminUi.ops.health.errors.load'));
        }
        this.healthCheckedAt.set(new Date());
        this.healthLoading.set(false);
      },
      error: () => {
        this.backendReady.set(false);
        this.healthError.set(this.translate.instant('adminUi.ops.health.errors.load'));
        this.healthCheckedAt.set(new Date());
        this.healthLoading.set(false);
      }
    });
  }

  loadDiagnostics(): void {
    this.diagnosticsLoading.set(true);
    this.diagnosticsError.set(null);

    this.ops.getDiagnostics().subscribe({
      next: (res) => {
        this.diagnostics.set(res);
        this.diagnosticsLoading.set(false);
      },
      error: () => {
        this.diagnosticsError.set(this.translate.instant('adminUi.ops.diagnostics.errors.load'));
        this.diagnosticsLoading.set(false);
      }
    });
  }

  loadDamTelemetry(): void {
    this.damTelemetryLoading.set(true);
    this.damTelemetryError.set(null);
    this.adminService.getMediaTelemetry().subscribe({
      next: (res) => {
        this.damTelemetry.set(res);
        this.damTelemetryLoading.set(false);
      },
      error: () => {
        this.damTelemetryError.set('Failed to load DAM telemetry.');
        this.damTelemetryLoading.set(false);
      }
    });
  }

  formatDamAge(ageSeconds?: number | null): string {
    if (ageSeconds == null) return 'n/a';
    if (ageSeconds < 60) return `${ageSeconds}s`;
    if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m`;
    return `${Math.floor(ageSeconds / 3600)}h`;
  }

  diagnosticsBadgeClass(status: string): string {
    const key = (status || '').trim().toLowerCase();
    if (key === 'ok') return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100';
    if (key === 'warning') return 'bg-amber-100 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100';
    if (key === 'error') return 'bg-rose-100 text-rose-900 dark:bg-rose-950/30 dark:text-rose-100';
    return 'bg-slate-100 text-slate-900 dark:bg-slate-800/70 dark:text-slate-100';
  }

  crumbs(): { label: string; url?: string }[] {
    return [
      { label: 'nav.home', url: '/' },
      { label: 'nav.admin', url: '/admin/dashboard' },
      { label: 'adminUi.nav.ops' }
    ];
  }

  downloadNewsletterExport(): void {
    this.newsletterExporting.set(true);
    this.ops.downloadNewsletterConfirmedSubscribersExport().subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const stamp = new Date().toISOString().slice(0, 10);
        const link = document.createElement('a');
        link.href = url;
        link.download = `newsletter-confirmed-subscribers-${stamp}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        this.toast.success(this.translate.instant('adminUi.ops.newsletter.success'));
        this.newsletterExporting.set(false);
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.ops.newsletter.error'));
        this.newsletterExporting.set(false);
      }
    });
  }

  bannerStatus(b: MaintenanceBannerRead): string {
    if (!b.is_active) return 'disabled';
    const now = Date.now();
    const starts = new Date(b.starts_at).getTime();
    const ends = b.ends_at ? new Date(b.ends_at).getTime() : null;
    if (Number.isFinite(starts) && starts > now) return 'scheduled';
    if (ends != null && Number.isFinite(ends) && ends <= now) return 'expired';
    return 'active';
  }

  selectBanner(b: MaintenanceBannerRead): void {
    this.editingBannerId = b.id;
    this.bannerIsActive = b.is_active;
    this.bannerLevel = b.level;
    this.bannerStartsAtLocal = this.toLocalInput(b.starts_at);
    this.bannerEndsAtLocal = b.ends_at ? this.toLocalInput(b.ends_at) : '';
    this.bannerMessageEn = b.message_en || '';
    this.bannerMessageRo = b.message_ro || '';
    this.bannerLinkUrl = b.link_url || '';
    this.bannerLinkLabelEn = b.link_label_en || '';
    this.bannerLinkLabelRo = b.link_label_ro || '';
  }

  resetBannerForm(): void {
    this.editingBannerId = null;
    this.bannerIsActive = true;
    this.bannerLevel = 'info';
    this.bannerStartsAtLocal = this.nowLocalInput();
    this.bannerEndsAtLocal = '';
    this.bannerMessageEn = '';
    this.bannerMessageRo = '';
    this.bannerLinkUrl = '';
    this.bannerLinkLabelEn = '';
    this.bannerLinkLabelRo = '';
  }

  saveBanner(): void {
    const startsAtIso = this.fromLocalInput(this.bannerStartsAtLocal);
    if (!startsAtIso) {
      this.toast.error(this.translate.instant('adminUi.ops.banner.errors.startsAtRequired'));
      return;
    }
    const endsAtIso = this.bannerEndsAtLocal ? this.fromLocalInput(this.bannerEndsAtLocal) : null;
    if (this.bannerMessageEn.trim().length === 0 || this.bannerMessageRo.trim().length === 0) {
      this.toast.error(this.translate.instant('adminUi.ops.banner.errors.messageRequired'));
      return;
    }
    this.bannerSaving.set(true);
    const payload: any = {
      is_active: this.bannerIsActive,
      level: this.bannerLevel,
      message_en: this.bannerMessageEn.trim(),
      message_ro: this.bannerMessageRo.trim(),
      link_url: this.bannerLinkUrl.trim() || null,
      link_label_en: this.bannerLinkLabelEn.trim() || null,
      link_label_ro: this.bannerLinkLabelRo.trim() || null,
      starts_at: startsAtIso,
      ends_at: endsAtIso
    };

    const req = this.editingBannerId
      ? this.ops.updateBanner(this.editingBannerId, payload)
      : this.ops.createBanner(payload);

    req.subscribe({
      next: () => {
        this.toast.success(this.translate.instant('adminUi.ops.banner.saved'));
        this.bannerSaving.set(false);
        this.loadBanners();
        this.resetBannerForm();
      },
      error: (err) => {
        this.bannerSaving.set(false);
        const msg = err?.error?.detail || this.translate.instant('adminUi.ops.banner.errors.save');
        this.toast.error(msg);
      }
    });
  }

  deleteBanner(id: string): void {
    if (!id) return;
    if (!confirm(this.translate.instant('adminUi.ops.banner.confirmDelete'))) return;
    this.bannerSaving.set(true);
    this.ops.deleteBanner(id).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('adminUi.ops.banner.deleted'));
        this.bannerSaving.set(false);
        this.loadBanners();
        this.resetBannerForm();
      },
      error: (err) => {
        this.bannerSaving.set(false);
        const msg = err?.error?.detail || this.translate.instant('adminUi.ops.banner.errors.delete');
        this.toast.error(msg);
      }
    });
  }

  runSimulation(): void {
    const subtotal = this.simSubtotal.trim();
    if (!subtotal) {
      this.toast.error(this.translate.instant('adminUi.ops.shipping.errors.subtotalRequired'));
      return;
    }
    this.simLoading.set(true);
    this.simError.set(null);
    this.simResult.set(null);
    this.ops
      .simulateShipping({
        subtotal_ron: subtotal,
        discount_ron: this.simDiscount.trim() || '0.00',
        shipping_method_id: this.simShippingMethodId || undefined,
        postal_code: this.simPostalCode.trim() || undefined
      })
      .subscribe({
        next: (res) => {
          this.simResult.set(res);
          this.simLoading.set(false);
        },
        error: (err) => {
          const msg = err?.error?.detail || this.translate.instant('adminUi.ops.shipping.errors.run');
          this.simError.set(msg);
          this.simLoading.set(false);
        }
      });
  }

  webhookStatusClasses(status: string): string {
    const s = (status || '').toLowerCase();
    if (s === 'failed') {
      return 'bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-100';
    }
    if (s === 'processed') {
      return 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100';
    }
    return 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200';
  }

  viewWebhook(w: WebhookEventRead): void {
    if (!w?.provider || !w?.event_id) return;
    this.webhooksError.set(null);
    this.ops.getWebhookDetail(w.provider, w.event_id).subscribe({
      next: (detail) => this.selectedWebhook.set(detail),
      error: () => this.toast.error(this.translate.instant('adminUi.ops.webhooks.errors.detail'))
    });
  }

  closeWebhookDetail(): void {
    this.selectedWebhook.set(null);
  }

  retryWebhook(w: WebhookEventRead): void {
    if (!w?.provider || !w?.event_id) return;
    const key = `${w.provider}:${w.event_id}`;
    this.webhookRetrying.set(key);
    this.ops.retryWebhook(w.provider, w.event_id).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('adminUi.ops.webhooks.success.retried'));
        this.webhookRetrying.set(null);
        this.loadWebhooks();
        if (this.selectedWebhook()?.provider === w.provider && this.selectedWebhook()?.event_id === w.event_id) {
          this.viewWebhook(w);
        }
      },
      error: (err) => {
        this.webhookRetrying.set(null);
        const msg = err?.error?.detail || this.translate.instant('adminUi.ops.webhooks.errors.retry');
        this.toast.error(msg);
      }
    });
  }

  private loadBanners(): void {
    this.bannersLoading.set(true);
    this.bannersError.set(null);
    this.ops.listBanners().subscribe({
      next: (rows) => {
        this.banners.set(rows || []);
        this.bannersLoading.set(false);
      },
      error: () => {
        this.bannersError.set(this.translate.instant('adminUi.ops.banner.errors.load'));
        this.bannersLoading.set(false);
      }
    });
  }

  private loadShippingMethods(): void {
    this.shippingMethodsLoading.set(true);
    this.ops.listShippingMethods().subscribe({
      next: (rows) => {
        this.shippingMethods.set(rows || []);
        this.shippingMethodsLoading.set(false);
      },
      error: () => {
        this.shippingMethods.set([]);
        this.shippingMethodsLoading.set(false);
      }
    });
  }

  loadWebhooks(): void {
    this.webhooksLoading.set(true);
    this.webhooksError.set(null);
    this.ops.listWebhooks().subscribe({
      next: (rows) => {
        this.webhooks.set(rows || []);
        this.webhooksLoading.set(false);
      },
      error: () => {
        this.webhooksError.set(this.translate.instant('adminUi.ops.webhooks.errors.load'));
        this.webhooksLoading.set(false);
      }
    });
  }

  loadEmailFailures(): void {
    this.selectedEmailFailure.set(null);
    this.emailFailuresLoading.set(true);
    this.emailFailuresError.set(null);
    const toEmail = (this.emailFailuresTo || '').trim();
    const sinceHours = Number(this.emailFailuresSinceHours || 24);
    this.ops
      .listEmailFailures({
        limit: 50,
        since_hours: Number.isFinite(sinceHours) ? Math.max(1, Math.min(168, sinceHours)) : 24,
        to_email: toEmail ? toEmail : undefined
      })
      .subscribe({
      next: (rows) => {
        this.emailFailures.set(rows || []);
        this.emailFailuresLoading.set(false);
      },
      error: () => {
        this.emailFailuresError.set(this.translate.instant('adminUi.ops.emailFailures.errors.load'));
        this.emailFailuresLoading.set(false);
      }
    });
  }

  resetEmailFailureFilters(): void {
    this.emailFailuresTo = '';
    this.emailFailuresSinceHours = 24;
    this.loadEmailFailures();
  }

  viewEmailFailure(row: EmailFailureRead): void {
    this.selectedEmailFailure.set(row);
  }

  closeEmailFailureDetail(): void {
    this.selectedEmailFailure.set(null);
  }

  private maybeFocusSection(): void {
    const state = history.state as any;
    const focus = (state?.focusOpsSection || '').toString();
    const id =
      focus === 'emails' ? 'admin-ops-email-failures' : focus === 'webhooks' ? 'admin-ops-webhooks' : '';
    if (!id) return;
    window.setTimeout(() => {
      if (typeof document === 'undefined') return;
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      try {
        const nextState = { ...(history.state as any) };
        delete nextState.focusOpsSection;
        history.replaceState(nextState, '');
      } catch {
        // Ignore history state write failures.
      }
    }, 0);
  }

  private applyEmailFailuresDeepLink(): void {
    const qp = this.route.snapshot.queryParamMap;
    const toEmail = (qp.get('to_email') || qp.get('email') || '').trim();
    if (toEmail) this.emailFailuresTo = toEmail;
    const sinceRaw = (qp.get('since_hours') || '').trim();
    if (sinceRaw) {
      const parsed = Number.parseInt(sinceRaw, 10);
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 168) this.emailFailuresSinceHours = parsed;
    }
  }

  private nowLocalInput(): string {
    const d = new Date();
    d.setSeconds(0, 0);
    return this.toLocalInput(d.toISOString());
  }

  private toLocalInput(value: string): string {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private fromLocalInput(value: string): string | null {
    const trimmed = (value || '').trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString();
  }
}
