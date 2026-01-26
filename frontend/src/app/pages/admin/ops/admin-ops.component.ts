import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  OpsService,
  BannerLevel,
  MaintenanceBannerRead,
  ShippingMethodRead,
  ShippingSimulationResult,
  WebhookEventRead,
  WebhookEventDetail
} from '../../../core/ops.service';
import { ToastService } from '../../../core/toast.service';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';

@Component({
  selector: 'app-admin-ops',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, BreadcrumbComponent, ButtonComponent, SkeletonComponent],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs()"></app-breadcrumb>

      <div class="grid gap-6">
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

        <div class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
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

  webhooksLoading = signal(true);
  webhooksError = signal<string | null>(null);
  webhooks = signal<WebhookEventRead[]>([]);
  selectedWebhook = signal<WebhookEventDetail | null>(null);
  webhookRetrying = signal<string | null>(null);

  constructor(private ops: OpsService, private toast: ToastService, private translate: TranslateService) {}

  ngOnInit(): void {
    this.resetBannerForm();
    this.loadBanners();
    this.loadShippingMethods();
    this.loadWebhooks();
  }

  crumbs(): { label: string; url?: string }[] {
    return [
      { label: 'nav.home', url: '/' },
      { label: 'nav.admin', url: '/admin/dashboard' },
      { label: 'adminUi.nav.ops' }
    ];
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
