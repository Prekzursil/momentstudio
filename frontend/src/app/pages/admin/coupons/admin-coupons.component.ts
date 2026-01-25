import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';

import {
  AdminCouponsV2Service,
  type CouponAnalyticsResponse,
  type CouponAssignmentRead,
  type CouponBulkJobRead,
  type CouponBulkResult,
  type CouponBulkSegmentPreview
} from '../../../core/admin-coupons-v2.service';
import { AdminProductsService, type AdminProductListItem } from '../../../core/admin-products.service';
import { type AdminCategory, AdminService } from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';
import type { CouponRead, CouponVisibility, PromotionDiscountType, PromotionRead } from '../../../core/coupons.service';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';

type PromotionForm = {
  key: string;
  name: string;
  description: string;
  discount_type: PromotionDiscountType;
  percentage_off: string | number;
  amount_off: string | number;
  max_discount_amount: string | number;
  min_subtotal: string | number;
  allow_on_sale_items: boolean;
  first_order_only: boolean;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  is_automatic: boolean;
  included_product_ids: string[];
  excluded_product_ids: string[];
  included_category_ids: string[];
  excluded_category_ids: string[];
};

type CouponForm = {
  promotion_id: string;
  code: string;
  visibility: CouponVisibility;
  is_active: boolean;
  starts_at: string;
  ends_at: string;
  global_max_redemptions: string | number;
  per_customer_max_redemptions: string | number;
};

type PromotionScheduleRow = {
  promotion: PromotionRead;
  leftPct: number;
  widthPct: number;
  conflictCount: number;
  conflictNames: string;
};

@Component({
  selector: 'app-admin-coupons',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
    BreadcrumbComponent,
    ButtonComponent,
    InputComponent,
    SkeletonComponent
  ],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <div class="grid gap-1">
        <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.couponsV2.title' | translate }}</h1>
        <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.couponsV2.subtitle' | translate }}</p>
      </div>

      <div class="grid gap-6 lg:grid-cols-2 items-start">
        <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-start justify-between gap-3">
            <div class="grid gap-1">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.couponsV2.promotions.title' | translate }}</h2>
              <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.couponsV2.promotions.hint' | translate }}</p>
            </div>
            <div class="flex items-center gap-2">
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadPromotions()"></app-button>
              <app-button size="sm" [label]="'adminUi.couponsV2.promotions.new' | translate" (action)="startNewPromotion()"></app-button>
            </div>
          </div>

          <div
            *ngIf="promotionsError()"
            class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
          >
            {{ promotionsError() }}
          </div>

          <div *ngIf="promotionsLoading(); else promoListTpl">
            <app-skeleton [rows]="5"></app-skeleton>
          </div>
          <ng-template #promoListTpl>
            <div *ngIf="promotions().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.couponsV2.promotions.empty' | translate }}
            </div>

            <div *ngIf="promotions().length > 0" class="grid gap-2">
              <button
                *ngFor="let p of promotions()"
                type="button"
                (click)="selectPromotion(p)"
                class="text-left rounded-xl border p-3 transition-colors dark:border-slate-800"
                [class.border-indigo-300]="selectedPromotion()?.id === p.id"
                [class.bg-indigo-50]="selectedPromotion()?.id === p.id"
                [class.border-slate-200]="selectedPromotion()?.id !== p.id"
                [class.bg-white]="selectedPromotion()?.id !== p.id"
                [class.dark:bg-slate-900]="selectedPromotion()?.id !== p.id"
                [class.dark:border-indigo-500]="selectedPromotion()?.id === p.id"
                [class.dark:bg-indigo-900]="selectedPromotion()?.id === p.id"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="font-semibold text-slate-900 dark:text-slate-50 truncate">{{ p.name }}</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {{ describePromotion(p) }}
                    </p>
                  </div>
                  <span
                    class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold"
                    [ngClass]="p.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100' : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'"
                  >
                    {{ p.is_active ? ('adminUi.couponsV2.common.active' | translate) : ('adminUi.couponsV2.common.inactive' | translate) }}
                  </span>
                </div>
              </button>
            </div>
          </ng-template>

          <div class="border-t border-slate-200 pt-4 grid gap-4 dark:border-slate-800">
            <div class="flex items-start justify-between gap-3">
              <div class="grid gap-1">
                <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">
                  {{ 'adminUi.couponsV2.calendar.title' | translate }}
                </h3>
                <p class="text-sm text-slate-600 dark:text-slate-300">
                  {{ 'adminUi.couponsV2.calendar.hint' | translate }}
                </p>
              </div>
              <label class="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                {{ 'adminUi.couponsV2.calendar.window' | translate }}
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="promotionCalendarDays"
                >
                  <option [ngValue]="30">{{ 'adminUi.couponsV2.calendar.window30' | translate }}</option>
                  <option [ngValue]="90">{{ 'adminUi.couponsV2.calendar.window90' | translate }}</option>
                  <option [ngValue]="180">{{ 'adminUi.couponsV2.calendar.window180' | translate }}</option>
                </select>
              </label>
            </div>

            <div class="text-xs text-slate-500 dark:text-slate-400">
              <span class="font-semibold">{{ promotionCalendarStartDate() | date: 'yyyy-MM-dd' }}</span>
              <span class="px-1">→</span>
              <span class="font-semibold">{{ promotionCalendarEndDate() | date: 'yyyy-MM-dd' }}</span>
            </div>

            <div *ngIf="promotionScheduleRows().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.couponsV2.calendar.empty' | translate }}
            </div>

            <div *ngIf="promotionScheduleRows().length" class="grid gap-3">
              <div
                *ngFor="let row of promotionScheduleRows()"
                class="grid gap-2 lg:grid-cols-[240px_1fr] items-center"
              >
                <button
                  type="button"
                  class="text-left rounded-lg px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  (click)="selectPromotion(row.promotion)"
                >
                  <div class="flex items-center gap-2">
                    <div class="font-semibold text-slate-900 dark:text-slate-50 truncate">
                      {{ row.promotion.name }}
                    </div>
                    <span
                      *ngIf="row.conflictCount"
                      class="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
                      [title]="row.conflictNames"
                    >
                      {{ 'adminUi.couponsV2.calendar.conflicts' | translate:{ count: row.conflictCount } }}
                    </span>
                  </div>
                  <div class="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {{
                      row.promotion.starts_at
                        ? (row.promotion.starts_at | date: 'yyyy-MM-dd')
                        : ('adminUi.couponsV2.calendar.startImmediate' | translate)
                    }}
                    <span class="px-1">→</span>
                    {{
                      row.promotion.ends_at ? (row.promotion.ends_at | date: 'yyyy-MM-dd') : ('adminUi.couponsV2.calendar.noEnd' | translate)
                    }}
                  </div>
                </button>

                <div class="relative h-10 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div class="absolute inset-y-2 left-0 right-0 border border-dashed border-slate-200 dark:border-slate-700 rounded-md"></div>
                  <div
                    class="absolute inset-y-2 rounded-md"
                    [style.left.%]="row.leftPct"
                    [style.width.%]="row.widthPct"
                    [ngClass]="
                      row.promotion.is_active
                        ? row.conflictCount
                          ? 'bg-indigo-600 ring-2 ring-rose-500/60'
                          : 'bg-indigo-600'
                        : 'bg-slate-400 dark:bg-slate-600'
                    "
                  ></div>
                </div>
              </div>
            </div>
          </div>

          <div class="border-t border-slate-200 pt-4 grid gap-4 dark:border-slate-800">
            <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">
              {{
                selectedPromotion()
                  ? ('adminUi.couponsV2.promotions.editTitle' | translate)
                  : ('adminUi.couponsV2.promotions.createTitle' | translate)
              }}
            </h3>

            <div class="grid gap-3">
              <div class="grid gap-3 lg:grid-cols-2">
                <app-input [label]="'adminUi.couponsV2.fields.key' | translate" [(value)]="promotionForm.key"></app-input>
                <app-input [label]="'adminUi.couponsV2.fields.name' | translate" [(value)]="promotionForm.name"></app-input>
              </div>

              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.couponsV2.fields.description' | translate }}
                <textarea
                  rows="3"
                  class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="promotionForm.description"
                ></textarea>
              </label>

              <div class="grid gap-3 lg:grid-cols-2">
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.couponsV2.fields.discountType' | translate }}
                  <select
                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="promotionForm.discount_type"
                    (ngModelChange)="onDiscountTypeChange()"
                  >
                    <option value="percent">{{ 'adminUi.couponsV2.discountTypes.percent' | translate }}</option>
                    <option value="amount">{{ 'adminUi.couponsV2.discountTypes.amount' | translate }}</option>
                    <option value="free_shipping">{{ 'adminUi.couponsV2.discountTypes.free_shipping' | translate }}</option>
                  </select>
                </label>

                <div class="grid gap-3 lg:grid-cols-2">
                  <app-input
                    *ngIf="promotionForm.discount_type === 'percent'"
                    [label]="'adminUi.couponsV2.fields.percentageOff' | translate"
                    type="number"
                    [min]="0"
                    [max]="100"
                    [step]="0.01"
                    [(value)]="promotionForm.percentage_off"
                  ></app-input>
                  <app-input
                    *ngIf="promotionForm.discount_type === 'amount'"
                    [label]="'adminUi.couponsV2.fields.amountOff' | translate"
                    type="number"
                    [min]="0"
                    [step]="0.01"
                    [(value)]="promotionForm.amount_off"
                  ></app-input>
                </div>
              </div>

              <div class="grid gap-3 lg:grid-cols-4">
                <app-input
                  [label]="'adminUi.couponsV2.fields.maxDiscount' | translate"
                  type="number"
                  [min]="0"
                  [step]="0.01"
                  [(value)]="promotionForm.max_discount_amount"
                ></app-input>
                <app-input
                  [label]="'adminUi.couponsV2.fields.minSubtotal' | translate"
                  type="number"
                  [min]="0"
                  [step]="0.01"
                  [(value)]="promotionForm.min_subtotal"
                ></app-input>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.couponsV2.fields.allowOnSale' | translate }}
                  <input
                    type="checkbox"
                    class="h-5 w-5 accent-indigo-600"
                    [(ngModel)]="promotionForm.allow_on_sale_items"
                  />
                </label>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.couponsV2.fields.firstOrderOnly' | translate }}
                  <input
                    type="checkbox"
                    class="h-5 w-5 accent-indigo-600"
                    [(ngModel)]="promotionForm.first_order_only"
                  />
                </label>
              </div>

              <div class="grid gap-3 lg:grid-cols-2">
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.couponsV2.fields.startsAt' | translate }}
                  <input
                    type="datetime-local"
                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="promotionForm.starts_at"
                  />
                </label>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.couponsV2.fields.endsAt' | translate }}
                  <input
                    type="datetime-local"
                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="promotionForm.ends_at"
                  />
                </label>
              </div>

              <div class="grid gap-3 lg:grid-cols-2">
                <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <input type="checkbox" class="h-5 w-5 accent-indigo-600" [(ngModel)]="promotionForm.is_active" />
                  {{ 'adminUi.couponsV2.fields.active' | translate }}
                </label>
                <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <input type="checkbox" class="h-5 w-5 accent-indigo-600" [(ngModel)]="promotionForm.is_automatic" />
                  {{ 'adminUi.couponsV2.fields.automatic' | translate }}
                </label>
              </div>

              <div class="rounded-xl border border-slate-200 p-3 grid gap-3 dark:border-slate-800">
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {{ 'adminUi.couponsV2.stacking.title' | translate }}
                </div>
                <p class="text-sm text-slate-600 dark:text-slate-300">
                  {{ 'adminUi.couponsV2.stacking.hint' | translate }}
                </p>

                <div class="grid gap-3 lg:grid-cols-3 items-end">
                  <app-input
                    [label]="'adminUi.couponsV2.stacking.sampleSubtotal' | translate"
                    type="number"
                    [min]="0"
                    [step]="0.01"
                    [(value)]="stackingSampleSubtotal"
                  ></app-input>
                  <div class="text-xs text-slate-600 dark:text-slate-300 lg:col-span-2">
                    {{ promotionForm.allow_on_sale_items ? ('adminUi.couponsV2.stacking.saleAllowed' | translate) : ('adminUi.couponsV2.stacking.saleBlocked' | translate) }}
                    ·
                    {{
                      promotionForm.discount_type === 'free_shipping'
                        ? ('adminUi.couponsV2.stacking.shippingFree' | translate)
                        : ('adminUi.couponsV2.stacking.shippingNone' | translate)
                    }}
                  </div>
                </div>

                <div *ngIf="promotionForm.discount_type !== 'free_shipping'" class="grid gap-2 text-sm">
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-slate-600 dark:text-slate-300">{{ 'adminUi.couponsV2.stacking.regularItems' | translate }}</span>
                    <span class="font-semibold text-slate-900 dark:text-slate-50">{{ formatRon(stackingPreviewProductDiscount(false)) }}</span>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-slate-600 dark:text-slate-300">{{ 'adminUi.couponsV2.stacking.saleItems' | translate }}</span>
                    <span class="font-semibold text-slate-900 dark:text-slate-50">{{ formatRon(stackingPreviewProductDiscount(true)) }}</span>
                  </div>
                </div>

                <div
                  *ngIf="stackingMinSubtotalBlocked()"
                  class="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 dark:bg-amber-950/30 dark:text-amber-100 dark:border-amber-900/40"
                >
                  {{ 'adminUi.couponsV2.stacking.minSubtotalWarning' | translate:{ min: promotionForm.min_subtotal } }}
                </div>

                <div class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.couponsV2.stacking.scopeNote' | translate }}
                </div>
              </div>

              <div class="rounded-xl border border-slate-200 p-3 grid gap-3 dark:border-slate-800">
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {{ 'adminUi.couponsV2.scopes.title' | translate }}
                </div>

                <div class="grid gap-3 lg:grid-cols-2">
                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.couponsV2.scopes.includedCategories' | translate }}
                    <select
                      multiple
                      class="min-h-32 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [(ngModel)]="promotionForm.included_category_ids"
                      (ngModelChange)="syncCategoryScopes('included')"
                    >
                      <option *ngFor="let c of categories()" [value]="c.id">{{ c.name }} ({{ c.slug }})</option>
                    </select>
                  </label>
                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.couponsV2.scopes.excludedCategories' | translate }}
                    <select
                      multiple
                      class="min-h-32 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [(ngModel)]="promotionForm.excluded_category_ids"
                      (ngModelChange)="syncCategoryScopes('excluded')"
                    >
                      <option *ngFor="let c of categories()" [value]="c.id">{{ c.name }} ({{ c.slug }})</option>
                    </select>
                  </label>
                </div>

                <div class="grid gap-2">
                  <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <app-input [label]="'adminUi.couponsV2.scopes.searchProducts' | translate" [(value)]="productQuery"></app-input>
                    <div class="flex items-center gap-2">
                      <app-button size="sm" variant="ghost" [label]="'adminUi.actions.search' | translate" (action)="searchProducts()"></app-button>
                      <app-button
                        size="sm"
                        variant="ghost"
                        [label]="'adminUi.actions.reset' | translate"
                        (action)="resetProductSearch()"
                      ></app-button>
                    </div>
                  </div>

                  <div *ngIf="productsError()" class="text-sm text-rose-700 dark:text-rose-200">
                    {{ productsError() }}
                  </div>

                  <div *ngIf="productsLoading()" class="text-sm text-slate-600 dark:text-slate-300">
                    {{ 'adminUi.couponsV2.scopes.loadingProducts' | translate }}
                  </div>

                  <div *ngIf="!productsLoading() && products().length" class="rounded-xl border border-slate-200 dark:border-slate-800">
                    <div
                      *ngFor="let p of products()"
                      class="flex items-center justify-between gap-3 border-t border-slate-200 p-3 text-sm first:border-t-0 dark:border-slate-800"
                    >
                      <div class="min-w-0">
                        <div class="font-medium text-slate-900 dark:text-slate-50 truncate">
                          {{ p.name }}
                        </div>
                        <div class="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {{ p.sku }} · {{ p.slug }}
                        </div>
                      </div>
                      <div class="flex items-center gap-2 shrink-0">
                        <app-button
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.couponsV2.scopes.include' | translate"
                          (action)="addScopeProduct('include', p)"
                          [disabled]="promotionForm.included_product_ids.includes(p.id)"
                        ></app-button>
                        <app-button
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.couponsV2.scopes.exclude' | translate"
                          (action)="addScopeProduct('exclude', p)"
                          [disabled]="promotionForm.excluded_product_ids.includes(p.id)"
                        ></app-button>
                      </div>
                    </div>
                  </div>

                  <div *ngIf="scopeProductsLoading()" class="text-sm text-slate-600 dark:text-slate-300">
                    {{ 'adminUi.couponsV2.scopes.resolvingProducts' | translate }}
                  </div>
                  <div *ngIf="scopeProductsError()" class="text-sm text-rose-700 dark:text-rose-200">
                    {{ scopeProductsError() }}
                  </div>

                  <div class="grid gap-3 lg:grid-cols-2">
                    <div class="grid gap-2">
                      <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                        {{ 'adminUi.couponsV2.scopes.includedProducts' | translate }}
                      </div>
                      <div *ngIf="promotionForm.included_product_ids.length === 0" class="text-sm text-slate-600 dark:text-slate-300">
                        {{ 'adminUi.couponsV2.scopes.none' | translate }}
                      </div>
                      <div class="flex flex-wrap gap-2" *ngIf="promotionForm.included_product_ids.length">
                        <button
                          type="button"
                          *ngFor="let id of promotionForm.included_product_ids"
                          class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          (click)="removeScopeProduct('include', id)"
                        >
                          <span class="truncate max-w-[220px]">{{ productLabel(id) }}</span>
                          <span class="text-slate-400 dark:text-slate-300">×</span>
                        </button>
                      </div>
                    </div>

                    <div class="grid gap-2">
                      <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                        {{ 'adminUi.couponsV2.scopes.excludedProducts' | translate }}
                      </div>
                      <div *ngIf="promotionForm.excluded_product_ids.length === 0" class="text-sm text-slate-600 dark:text-slate-300">
                        {{ 'adminUi.couponsV2.scopes.none' | translate }}
                      </div>
                      <div class="flex flex-wrap gap-2" *ngIf="promotionForm.excluded_product_ids.length">
                        <button
                          type="button"
                          *ngFor="let id of promotionForm.excluded_product_ids"
                          class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          (click)="removeScopeProduct('exclude', id)"
                        >
                          <span class="truncate max-w-[220px]">{{ productLabel(id) }}</span>
                          <span class="text-slate-400 dark:text-slate-300">×</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-2">
                <app-button
                  size="sm"
                  [label]="selectedPromotion() ? ('adminUi.couponsV2.promotions.save' | translate) : ('adminUi.couponsV2.promotions.create' | translate)"
                  [disabled]="promotionSaving()"
                  (action)="savePromotion()"
                ></app-button>
                <span *ngIf="promotionSaving()" class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.couponsV2.common.saving' | translate }}</span>
              </div>
            </div>
          </div>
        </section>

        <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-start justify-between gap-3">
            <div class="grid gap-1">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.couponsV2.coupons.title' | translate }}</h2>
              <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.couponsV2.coupons.hint' | translate }}</p>
            </div>
            <div class="flex items-center gap-2">
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadCoupons()"></app-button>
              <app-button size="sm" [label]="'adminUi.couponsV2.coupons.new' | translate" (action)="startNewCoupon()"></app-button>
            </div>
          </div>

          <div class="grid gap-3 lg:grid-cols-[1fr_auto] items-end">
            <app-input [label]="'adminUi.couponsV2.coupons.search' | translate" [(value)]="couponQuery"></app-input>
            <app-button size="sm" variant="ghost" [label]="'adminUi.actions.search' | translate" (action)="loadCoupons()"></app-button>
          </div>

          <div
            *ngIf="couponsError()"
            class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
          >
            {{ couponsError() }}
          </div>

          <div *ngIf="couponsLoading(); else couponListTpl">
            <app-skeleton [rows]="6"></app-skeleton>
          </div>
          <ng-template #couponListTpl>
            <div *ngIf="coupons().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
              {{ selectedPromotion() ? ('adminUi.couponsV2.coupons.empty' | translate) : ('adminUi.couponsV2.coupons.selectPromotion' | translate) }}
            </div>

            <div *ngIf="coupons().length" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table class="min-w-[780px] w-full text-sm">
                <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                  <tr>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.couponsV2.coupons.table.code' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.couponsV2.coupons.table.visibility' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.couponsV2.coupons.table.active' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.couponsV2.coupons.table.ends' | translate }}</th>
                    <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.couponsV2.coupons.table.actions' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    *ngFor="let c of coupons()"
                    class="border-t border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                    [class.bg-indigo-50]="selectedCoupon()?.id === c.id"
                    [class.dark:bg-indigo-900]="selectedCoupon()?.id === c.id"
                  >
                    <td class="px-3 py-2 font-mono text-slate-900 dark:text-slate-50">{{ c.code }}</td>
                    <td class="px-3 py-2">{{ c.visibility }}</td>
                    <td class="px-3 py-2">
                      <span
                        class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold"
                        [ngClass]="c.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100' : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'"
                      >
                        {{ c.is_active ? ('adminUi.couponsV2.common.active' | translate) : ('adminUi.couponsV2.common.inactive' | translate) }}
                      </span>
                    </td>
                    <td class="px-3 py-2 text-slate-600 dark:text-slate-300">{{ c.ends_at ? (c.ends_at | date: 'yyyy-MM-dd') : '—' }}</td>
                    <td class="px-3 py-2 text-right">
                      <app-button size="sm" variant="ghost" [label]="'adminUi.actions.edit' | translate" (action)="selectCoupon(c)"></app-button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </ng-template>

          <div class="border-t border-slate-200 pt-4 grid gap-4 dark:border-slate-800">
            <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">
              {{
                selectedCoupon()
                  ? ('adminUi.couponsV2.coupons.editTitle' | translate)
                  : ('adminUi.couponsV2.coupons.createTitle' | translate)
              }}
            </h3>

            <div class="grid gap-3">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.couponsV2.coupons.fields.promotion' | translate }}
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="couponForm.promotion_id"
                  [disabled]="!!selectedCoupon()"
                >
                  <option *ngFor="let p of promotions()" [value]="p.id">{{ p.name }}</option>
                </select>
              </label>

              <div class="grid gap-3 lg:grid-cols-2">
                <app-input
                  [label]="'adminUi.couponsV2.coupons.fields.code' | translate"
                  [(value)]="couponForm.code"
                  [disabled]="!!selectedCoupon()"
                ></app-input>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.couponsV2.coupons.fields.visibility' | translate }}
                  <select
                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="couponForm.visibility"
                    [disabled]="!!selectedCoupon()"
                  >
                    <option value="public">{{ 'adminUi.couponsV2.coupons.visibility.public' | translate }}</option>
                    <option value="assigned">{{ 'adminUi.couponsV2.coupons.visibility.assigned' | translate }}</option>
                  </select>
                </label>
              </div>

              <div *ngIf="!selectedCoupon()" class="grid gap-3 lg:grid-cols-4 items-end">
                <app-input [label]="'adminUi.couponsV2.coupons.generator.prefix' | translate" [(value)]="couponCodeGen.prefix"></app-input>
                <app-input
                  [label]="'adminUi.couponsV2.coupons.generator.pattern' | translate"
                  [(value)]="couponCodeGen.pattern"
                  [hint]="'adminUi.couponsV2.coupons.generator.patternHint' | translate"
                ></app-input>
                <app-input
                  [label]="'adminUi.couponsV2.coupons.generator.length' | translate"
                  type="number"
                  [min]="4"
                  [step]="1"
                  [(value)]="couponCodeGen.length"
                ></app-input>
                <div class="flex justify-end">
                  <app-button
                    size="sm"
                    [disabled]="couponCodeGenerating()"
                    [label]="'adminUi.couponsV2.coupons.generator.generate' | translate"
                    (action)="generateCouponCode()"
                  ></app-button>
                </div>
              </div>

              <div class="grid gap-3 lg:grid-cols-2">
                <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <input type="checkbox" class="h-5 w-5 accent-indigo-600" [(ngModel)]="couponForm.is_active" />
                  {{ 'adminUi.couponsV2.coupons.fields.active' | translate }}
                </label>
              </div>

              <div class="grid gap-3 lg:grid-cols-2">
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.couponsV2.coupons.fields.startsAt' | translate }}
                  <input
                    type="datetime-local"
                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="couponForm.starts_at"
                  />
                </label>
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.couponsV2.coupons.fields.endsAt' | translate }}
                  <input
                    type="datetime-local"
                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="couponForm.ends_at"
                  />
                </label>
              </div>

              <div class="grid gap-3 lg:grid-cols-2">
                <app-input
                  [label]="'adminUi.couponsV2.coupons.fields.globalMax' | translate"
                  type="number"
                  [min]="1"
                  [step]="1"
                  [(value)]="couponForm.global_max_redemptions"
                ></app-input>
                <app-input
                  [label]="'adminUi.couponsV2.coupons.fields.perCustomerMax' | translate"
                  type="number"
                  [min]="1"
                  [step]="1"
                  [(value)]="couponForm.per_customer_max_redemptions"
                ></app-input>
              </div>

              <div class="flex items-center gap-2">
                <app-button
                  size="sm"
                  [label]="selectedCoupon() ? ('adminUi.couponsV2.coupons.save' | translate) : ('adminUi.couponsV2.coupons.create' | translate)"
                  [disabled]="couponSaving()"
                  (action)="saveCoupon()"
                ></app-button>
                <span *ngIf="couponSaving()" class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.couponsV2.common.saving' | translate }}</span>
              </div>
            </div>
          </div>

          <div *ngIf="selectedPromotion()" class="border-t border-slate-200 pt-4 grid gap-4 dark:border-slate-800">
            <div class="flex items-start justify-between gap-3">
              <div class="grid gap-1">
                <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.couponsV2.analytics.title' | translate }}</h3>
                <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.couponsV2.analytics.hint' | translate }}</p>
              </div>
              <div class="flex flex-wrap items-end gap-3 justify-end">
                <label class="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                  {{ 'adminUi.couponsV2.analytics.window' | translate }}
                  <select
                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="analyticsDays"
                    (ngModelChange)="loadAnalytics()"
                  >
                    <option [ngValue]="7">{{ 'adminUi.couponsV2.analytics.window7' | translate }}</option>
                    <option [ngValue]="30">{{ 'adminUi.couponsV2.analytics.window30' | translate }}</option>
                    <option [ngValue]="90">{{ 'adminUi.couponsV2.analytics.window90' | translate }}</option>
                  </select>
                </label>
                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadAnalytics()"></app-button>
              </div>
            </div>

            <label *ngIf="selectedCoupon()" class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                class="h-5 w-5 accent-indigo-600"
                [(ngModel)]="analyticsOnlySelectedCoupon"
                (ngModelChange)="loadAnalytics()"
              />
              {{ 'adminUi.couponsV2.analytics.onlySelectedCoupon' | translate }}
            </label>

            <div
              *ngIf="analyticsError()"
              class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
            >
              {{ analyticsError() }}
            </div>

            <div *ngIf="analyticsLoading(); else analyticsTpl">
              <app-skeleton [rows]="4"></app-skeleton>
            </div>
            <ng-template #analyticsTpl>
              <div *ngIf="!analytics() || analytics()!.summary.redemptions === 0" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'adminUi.couponsV2.analytics.empty' | translate }}
              </div>

              <div *ngIf="analytics()" class="grid gap-4">
                <div class="grid gap-3 lg:grid-cols-3">
                  <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 grid gap-1 dark:border-slate-800 dark:bg-slate-950/40">
                    <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.couponsV2.analytics.summary.redemptions' | translate }}
                    </div>
                    <div class="text-lg font-semibold text-slate-900 dark:text-slate-50">
                      {{ analytics()!.summary.redemptions }}
                    </div>
                  </div>
                  <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 grid gap-1 dark:border-slate-800 dark:bg-slate-950/40">
                    <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.couponsV2.analytics.summary.totalDiscount' | translate }}
                    </div>
                    <div class="text-lg font-semibold text-slate-900 dark:text-slate-50">
                      {{ formatRonString(analytics()!.summary.total_discount_ron) }}
                    </div>
                  </div>
                  <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 grid gap-1 dark:border-slate-800 dark:bg-slate-950/40">
                    <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.couponsV2.analytics.summary.shippingDiscount' | translate }}
                    </div>
                    <div class="text-lg font-semibold text-slate-900 dark:text-slate-50">
                      {{ formatRonString(analytics()!.summary.total_shipping_discount_ron) }}
                    </div>
                  </div>
                </div>

                <div class="grid gap-3 lg:grid-cols-3">
                  <div class="rounded-xl border border-slate-200 p-3 grid gap-1 dark:border-slate-800">
                    <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.couponsV2.analytics.summary.avgWith' | translate }}
                    </div>
                    <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {{ formatRonString(analytics()!.summary.avg_order_total_with_coupon) }}
                    </div>
                  </div>
                  <div class="rounded-xl border border-slate-200 p-3 grid gap-1 dark:border-slate-800">
                    <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.couponsV2.analytics.summary.avgWithout' | translate }}
                    </div>
                    <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {{ formatRonString(analytics()!.summary.avg_order_total_without_coupon) }}
                    </div>
                  </div>
                  <div class="rounded-xl border border-slate-200 p-3 grid gap-1 dark:border-slate-800">
                    <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.couponsV2.analytics.summary.lift' | translate }}
                    </div>
                    <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {{ formatRonString(analytics()!.summary.aov_lift) }}
                    </div>
                  </div>
                </div>

                <div *ngIf="analytics()!.daily.length" class="rounded-xl border border-slate-200 overflow-x-auto dark:border-slate-800">
                  <div class="px-3 py-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
                    {{ 'adminUi.couponsV2.analytics.daily.title' | translate }}
                  </div>
                  <table class="min-w-[520px] w-full text-sm">
                    <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                      <tr>
                        <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.couponsV2.analytics.daily.table.date' | translate }}</th>
                        <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.couponsV2.analytics.daily.table.redemptions' | translate }}</th>
                        <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.couponsV2.analytics.daily.table.discount' | translate }}</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
                      <tr *ngFor="let row of analytics()!.daily">
                        <td class="px-3 py-2 text-slate-900 dark:text-slate-50">{{ row.date }}</td>
                        <td class="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{{ row.redemptions }}</td>
                        <td class="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{{ formatRonString(row.discount_ron) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div *ngIf="analytics()!.top_products.length" class="rounded-xl border border-slate-200 overflow-x-auto dark:border-slate-800">
                  <div class="px-3 py-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
                    {{ 'adminUi.couponsV2.analytics.topProducts.title' | translate }}
                  </div>
                  <table class="min-w-[720px] w-full text-sm">
                    <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                      <tr>
                        <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.couponsV2.analytics.topProducts.table.product' | translate }}</th>
                        <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.couponsV2.analytics.topProducts.table.orders' | translate }}</th>
                        <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.couponsV2.analytics.topProducts.table.quantity' | translate }}</th>
                        <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.couponsV2.analytics.topProducts.table.gross' | translate }}</th>
                        <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.couponsV2.analytics.topProducts.table.allocated' | translate }}</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
                      <tr *ngFor="let row of analytics()!.top_products">
                        <td class="px-3 py-2 min-w-[240px]">
                          <div class="font-medium text-slate-900 dark:text-slate-50">{{ row.product_name }}</div>
                          <div *ngIf="row.product_slug" class="text-xs text-slate-500 dark:text-slate-400">{{ row.product_slug }}</div>
                        </td>
                        <td class="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{{ row.orders_count }}</td>
                        <td class="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{{ row.quantity }}</td>
                        <td class="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{{ formatRonString(row.gross_sales_ron) }}</td>
                        <td class="px-3 py-2 text-right font-semibold text-slate-900 dark:text-slate-50">
                          {{ formatRonString(row.allocated_discount_ron) }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </ng-template>
          </div>

          <div *ngIf="selectedCoupon()" class="border-t border-slate-200 pt-4 grid gap-4 dark:border-slate-800">
            <div class="flex items-start justify-between gap-3">
              <div class="grid gap-1">
                <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.couponsV2.assignments.title' | translate }}</h3>
                <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.couponsV2.assignments.hint' | translate }}</p>
              </div>
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.refresh' | translate" (action)="loadAssignments()"></app-button>
            </div>

            <div class="grid gap-3 lg:grid-cols-2">
              <div class="rounded-xl border border-slate-200 p-3 grid gap-3 dark:border-slate-800">
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.couponsV2.assignments.assignTitle' | translate }}</div>
                <app-input [label]="'adminUi.couponsV2.assignments.email' | translate" type="email" [(value)]="assignEmail"></app-input>
                <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <input type="checkbox" class="h-5 w-5 accent-indigo-600" [(ngModel)]="assignSendEmail" />
                  {{ 'adminUi.couponsV2.assignments.sendEmail' | translate }}
                </label>
                <app-button size="sm" [label]="'adminUi.couponsV2.assignments.assign' | translate" (action)="assign()"></app-button>
              </div>

              <div class="rounded-xl border border-slate-200 p-3 grid gap-3 dark:border-slate-800">
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.couponsV2.assignments.revokeTitle' | translate }}</div>
                <app-input [label]="'adminUi.couponsV2.assignments.email' | translate" type="email" [(value)]="revokeEmail"></app-input>
                <app-input [label]="'adminUi.couponsV2.assignments.reason' | translate" [(value)]="revokeReason"></app-input>
                <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <input type="checkbox" class="h-5 w-5 accent-indigo-600" [(ngModel)]="revokeSendEmail" />
                  {{ 'adminUi.couponsV2.assignments.sendEmail' | translate }}
                </label>
                <app-button size="sm" variant="ghost" [label]="'adminUi.couponsV2.assignments.revoke' | translate" (action)="revoke()"></app-button>
              </div>
            </div>

            <div class="rounded-xl border border-slate-200 p-3 grid gap-3 dark:border-slate-800">
              <div class="flex items-start justify-between gap-3">
                <div class="grid gap-1">
                  <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.couponsV2.bulk.title' | translate }}</div>
                  <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.couponsV2.bulk.hint' | translate }}</p>
                </div>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.couponsV2.bulk.clear' | translate"
                  [disabled]="bulkBusy()"
                  (action)="clearBulkSelection(bulkFile)"
                ></app-button>
              </div>

              <input
                #bulkFile
                type="file"
                accept=".csv,text/csv"
                class="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-900 hover:file:bg-slate-200 dark:text-slate-200 dark:file:bg-slate-800 dark:file:text-slate-100 dark:hover:file:bg-slate-700"
                (change)="onBulkFileChange($event)"
              />

              <div *ngIf="bulkParseError" class="text-sm text-rose-700 dark:text-rose-200">
                {{ bulkParseError }}
              </div>

              <div *ngIf="bulkEmails.length" class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                <div>
                  {{ 'adminUi.couponsV2.bulk.parsed' | translate:{ count: bulkEmails.length } }}
                  <span *ngIf="bulkDuplicates" class="text-slate-500 dark:text-slate-400">
                    · {{ 'adminUi.couponsV2.bulk.duplicates' | translate:{ count: bulkDuplicates } }}
                  </span>
                  <span *ngIf="bulkInvalid.length" class="text-slate-500 dark:text-slate-400">
                    · {{ 'adminUi.couponsV2.bulk.invalid' | translate:{ count: bulkInvalid.length } }}
                  </span>
                  <span *ngIf="bulkTruncated" class="text-amber-700 dark:text-amber-200">
                    · {{ 'adminUi.couponsV2.bulk.truncated' | translate:{ count: bulkTruncated } }}
                  </span>
                </div>
                <div class="text-xs text-slate-500 dark:text-slate-400">
                  {{ bulkEmailsPreview() }}
                </div>
              </div>

              <app-input [label]="'adminUi.couponsV2.bulk.revokeReason' | translate" [(value)]="bulkRevokeReason"></app-input>

              <div class="grid gap-3 lg:grid-cols-2">
                <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <input type="checkbox" class="h-5 w-5 accent-indigo-600" [(ngModel)]="bulkAssignSendEmail" />
                  {{ 'adminUi.couponsV2.bulk.sendEmailAssign' | translate }}
                </label>
                <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <input type="checkbox" class="h-5 w-5 accent-indigo-600" [(ngModel)]="bulkRevokeSendEmail" />
                  {{ 'adminUi.couponsV2.bulk.sendEmailRevoke' | translate }}
                </label>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <app-button size="sm" [disabled]="bulkBusy() || bulkEmails.length === 0" [label]="'adminUi.couponsV2.bulk.assign' | translate" (action)="bulkAssign()"></app-button>
                <app-button size="sm" variant="ghost" [disabled]="bulkBusy() || bulkEmails.length === 0" [label]="'adminUi.couponsV2.bulk.revoke' | translate" (action)="bulkRevoke()"></app-button>
                <span *ngIf="bulkBusy()" class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.couponsV2.common.saving' | translate }}</span>
              </div>

              <div *ngIf="bulkResult()" class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
                <div class="font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.couponsV2.bulk.resultTitle' | translate }}</div>
                <div class="mt-1 grid gap-1">
                  <div *ngIf="bulkResult()!.created">{{ 'adminUi.couponsV2.bulk.resultCreated' | translate:{ count: bulkResult()!.created } }}</div>
                  <div *ngIf="bulkResult()!.restored">{{ 'adminUi.couponsV2.bulk.resultRestored' | translate:{ count: bulkResult()!.restored } }}</div>
                  <div *ngIf="bulkResult()!.already_active">{{ 'adminUi.couponsV2.bulk.resultAlreadyActive' | translate:{ count: bulkResult()!.already_active } }}</div>
                  <div *ngIf="bulkResult()!.revoked">{{ 'adminUi.couponsV2.bulk.resultRevoked' | translate:{ count: bulkResult()!.revoked } }}</div>
                  <div *ngIf="bulkResult()!.already_revoked">{{ 'adminUi.couponsV2.bulk.resultAlreadyRevoked' | translate:{ count: bulkResult()!.already_revoked } }}</div>
                  <div *ngIf="bulkResult()!.not_assigned">{{ 'adminUi.couponsV2.bulk.resultNotAssigned' | translate:{ count: bulkResult()!.not_assigned } }}</div>
                  <div *ngIf="bulkResult()!.not_found_emails?.length">{{ 'adminUi.couponsV2.bulk.resultNotFound' | translate:{ count: bulkResult()!.not_found_emails.length } }}</div>
                  <div *ngIf="bulkResult()!.invalid_emails?.length">{{ 'adminUi.couponsV2.bulk.resultInvalid' | translate:{ count: bulkResult()!.invalid_emails.length } }}</div>
                </div>
              </div>

              <div class="border-t border-slate-200 pt-4 grid gap-3 dark:border-slate-800">
                <div class="grid gap-1">
                  <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.couponsV2.bulk.segment.title' | translate }}</div>
                  <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.couponsV2.bulk.segment.hint' | translate }}</p>
                </div>

                <div class="grid gap-2 lg:grid-cols-2">
                  <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <input type="checkbox" class="h-5 w-5 accent-indigo-600" [(ngModel)]="segmentRequireMarketingOptIn" />
                    {{ 'adminUi.couponsV2.bulk.segment.filterMarketing' | translate }}
                  </label>
                  <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <input type="checkbox" class="h-5 w-5 accent-indigo-600" [(ngModel)]="segmentRequireEmailVerified" />
                    {{ 'adminUi.couponsV2.bulk.segment.filterVerified' | translate }}
                  </label>
                </div>

                <app-input [label]="'adminUi.couponsV2.bulk.revokeReason' | translate" [(value)]="segmentRevokeReason"></app-input>

                <div class="grid gap-3 lg:grid-cols-2">
                  <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <input type="checkbox" class="h-5 w-5 accent-indigo-600" [(ngModel)]="segmentAssignSendEmail" />
                    {{ 'adminUi.couponsV2.bulk.sendEmailAssign' | translate }}
                  </label>
                  <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                    <input type="checkbox" class="h-5 w-5 accent-indigo-600" [(ngModel)]="segmentRevokeSendEmail" />
                    {{ 'adminUi.couponsV2.bulk.sendEmailRevoke' | translate }}
                  </label>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <app-button
                    size="sm"
                    variant="ghost"
                    [disabled]="segmentPreviewBusy() || segmentJobInProgress()"
                    [label]="'adminUi.couponsV2.bulk.segment.preview' | translate"
                    (action)="segmentPreview()"
                  ></app-button>
                  <app-button
                    size="sm"
                    [disabled]="segmentJobInProgress()"
                    [label]="'adminUi.couponsV2.bulk.segment.assign' | translate"
                    (action)="segmentAssign()"
                  ></app-button>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [disabled]="segmentJobInProgress()"
                    [label]="'adminUi.couponsV2.bulk.segment.revoke' | translate"
                    (action)="segmentRevoke()"
                  ></app-button>
                  <span *ngIf="segmentPreviewBusy() || segmentJobInProgress()" class="text-sm text-slate-600 dark:text-slate-300">{{
                    'adminUi.couponsV2.common.saving' | translate
                  }}</span>
                </div>

                <div
                  *ngIf="segmentPreviewAssign() || segmentPreviewRevoke()"
                  class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200"
                >
                  <div class="font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.couponsV2.bulk.segment.previewTitle' | translate }}</div>
                  <div class="mt-1 grid gap-1">
                    <div>{{ 'adminUi.couponsV2.bulk.segment.candidates' | translate:{ count: segmentCandidatesCount() } }}</div>
                    <div *ngIf="segmentPreviewAssign()">
                      {{ 'adminUi.couponsV2.bulk.resultCreated' | translate:{ count: segmentPreviewAssign()!.created } }} ·
                      {{ 'adminUi.couponsV2.bulk.resultRestored' | translate:{ count: segmentPreviewAssign()!.restored } }} ·
                      {{ 'adminUi.couponsV2.bulk.resultAlreadyActive' | translate:{ count: segmentPreviewAssign()!.already_active } }}
                    </div>
                    <div *ngIf="segmentPreviewRevoke()">
                      {{ 'adminUi.couponsV2.bulk.resultRevoked' | translate:{ count: segmentPreviewRevoke()!.revoked } }} ·
                      {{ 'adminUi.couponsV2.bulk.resultAlreadyRevoked' | translate:{ count: segmentPreviewRevoke()!.already_revoked } }} ·
                      {{ 'adminUi.couponsV2.bulk.resultNotAssigned' | translate:{ count: segmentPreviewRevoke()!.not_assigned } }}
                    </div>
                    <div *ngIf="segmentPreviewSample()" class="text-xs text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.couponsV2.bulk.segment.sample' | translate:{ emails: segmentPreviewSample() } }}
                    </div>
                  </div>
                </div>

                <div
                  *ngIf="segmentJob()"
                  class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.couponsV2.bulk.segment.jobTitle' | translate }}</div>
                    <div class="flex items-center gap-2">
                      <app-button
                        *ngIf="segmentJobInProgress()"
                        size="xs"
                        variant="ghost"
                        [disabled]="segmentJobsBusy()"
                        [label]="'adminUi.actions.cancel' | translate"
                        (action)="cancelSegmentJob(segmentJob()!)"
                      ></app-button>
                      <app-button
                        *ngIf="segmentJob()!.status === 'failed' || segmentJob()!.status === 'cancelled'"
                        size="xs"
                        variant="ghost"
                        [disabled]="segmentJobInProgress() || segmentJobsBusy()"
                        [label]="'adminUi.actions.retry' | translate"
                        (action)="retrySegmentJob(segmentJob()!)"
                      ></app-button>
                    </div>
                  </div>
                  <div class="mt-1 grid gap-1">
                    <div>{{ 'adminUi.couponsV2.bulk.segment.jobStatus' | translate:{ status: segmentJob()!.status } }}</div>
                    <div>
                      {{ 'adminUi.couponsV2.bulk.segment.jobProgress' | translate:{ processed: segmentJob()!.processed, total: segmentJob()!.total_candidates } }}
                    </div>
                    <div *ngIf="segmentJob()!.created">{{ 'adminUi.couponsV2.bulk.resultCreated' | translate:{ count: segmentJob()!.created } }}</div>
                    <div *ngIf="segmentJob()!.restored">{{ 'adminUi.couponsV2.bulk.resultRestored' | translate:{ count: segmentJob()!.restored } }}</div>
                    <div *ngIf="segmentJob()!.already_active">{{ 'adminUi.couponsV2.bulk.resultAlreadyActive' | translate:{ count: segmentJob()!.already_active } }}</div>
                    <div *ngIf="segmentJob()!.revoked">{{ 'adminUi.couponsV2.bulk.resultRevoked' | translate:{ count: segmentJob()!.revoked } }}</div>
                    <div *ngIf="segmentJob()!.already_revoked">{{ 'adminUi.couponsV2.bulk.resultAlreadyRevoked' | translate:{ count: segmentJob()!.already_revoked } }}</div>
                    <div *ngIf="segmentJob()!.not_assigned">{{ 'adminUi.couponsV2.bulk.resultNotAssigned' | translate:{ count: segmentJob()!.not_assigned } }}</div>
                    <div *ngIf="segmentJob()!.error_message" class="text-xs text-rose-700 dark:text-rose-200">
                      {{ segmentJob()!.error_message }}
                    </div>
                  </div>
                </div>

                <div
                  class="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.couponsV2.bulk.segment.jobsTitle' | translate }}</div>
                    <app-button
                      size="xs"
                      variant="ghost"
                      [disabled]="segmentJobsLoading() || segmentJobsBusy()"
                      [label]="'adminUi.actions.refresh' | translate"
                      (action)="loadSegmentJobs()"
                    ></app-button>
                  </div>

                  <div *ngIf="segmentJobsError()" class="mt-2 text-xs text-rose-700 dark:text-rose-200">
                    {{ segmentJobsError() }}
                  </div>
                  <div *ngIf="segmentJobsLoading()" class="mt-2 text-sm text-slate-600 dark:text-slate-300">
                    {{ 'adminUi.couponsV2.bulk.segment.jobsLoading' | translate }}
                  </div>
                  <div *ngIf="!segmentJobsLoading() && segmentJobs().length === 0" class="mt-2 text-sm text-slate-600 dark:text-slate-300">
                    {{ 'adminUi.couponsV2.bulk.segment.jobsEmpty' | translate }}
                  </div>

                  <div *ngFor="let j of segmentJobs(); let idx = index" class="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800" [class.border-t-0]="idx === 0" [class.pt-0]="idx === 0">
                    <div class="flex items-start justify-between gap-3">
                      <div class="grid gap-1">
                        <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {{ j.action | uppercase }} · {{ j.status }}
                        </div>
                        <div class="text-xs text-slate-500 dark:text-slate-400">{{ j.created_at | date: 'short' }}</div>
                        <div class="text-xs text-slate-600 dark:text-slate-300">
                          {{ 'adminUi.couponsV2.bulk.segment.jobProgress' | translate:{ processed: j.processed, total: j.total_candidates } }}
                        </div>
                        <div *ngIf="j.action === 'assign'" class="text-xs text-slate-600 dark:text-slate-300">
                          {{ 'adminUi.couponsV2.bulk.resultCreated' | translate:{ count: j.created } }} ·
                          {{ 'adminUi.couponsV2.bulk.resultRestored' | translate:{ count: j.restored } }} ·
                          {{ 'adminUi.couponsV2.bulk.resultAlreadyActive' | translate:{ count: j.already_active } }}
                        </div>
                        <div *ngIf="j.action === 'revoke'" class="text-xs text-slate-600 dark:text-slate-300">
                          {{ 'adminUi.couponsV2.bulk.resultRevoked' | translate:{ count: j.revoked } }} ·
                          {{ 'adminUi.couponsV2.bulk.resultAlreadyRevoked' | translate:{ count: j.already_revoked } }} ·
                          {{ 'adminUi.couponsV2.bulk.resultNotAssigned' | translate:{ count: j.not_assigned } }}
                        </div>
                        <div *ngIf="j.error_message" class="text-xs text-rose-700 dark:text-rose-200">
                          {{ j.error_message }}
                        </div>
                      </div>
                      <div class="flex items-center gap-2">
                        <app-button
                          *ngIf="j.status === 'pending' || j.status === 'running'"
                          size="xs"
                          variant="ghost"
                          [disabled]="segmentJobsBusy()"
                          [label]="'adminUi.actions.cancel' | translate"
                          (action)="cancelSegmentJob(j)"
                        ></app-button>
                        <app-button
                          *ngIf="j.status === 'failed' || j.status === 'cancelled'"
                          size="xs"
                          variant="ghost"
                          [disabled]="segmentJobInProgress() || segmentJobsBusy()"
                          [label]="'adminUi.actions.retry' | translate"
                          (action)="retrySegmentJob(j)"
                        ></app-button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="rounded-xl border border-slate-200 p-3 grid gap-3 dark:border-slate-800">
              <div class="grid gap-1">
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.couponsV2.ab.title' | translate }}</div>
                <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.couponsV2.ab.hint' | translate }}</p>
              </div>

              <div *ngIf="!abCanRun()" class="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 dark:bg-amber-950/30 dark:text-amber-100 dark:border-amber-900/40">
                {{ 'adminUi.couponsV2.ab.requiresAssigned' | translate }}
              </div>

              <div class="grid gap-3 lg:grid-cols-[1fr_auto] items-end">
                <app-input [label]="'adminUi.couponsV2.ab.couponB' | translate" [(value)]="abCouponQuery"></app-input>
                <app-button size="sm" variant="ghost" [label]="'adminUi.actions.search' | translate" (action)="abSearchCoupons()"></app-button>
              </div>

              <div *ngIf="abCouponError()" class="text-sm text-rose-700 dark:text-rose-200">{{ abCouponError() }}</div>
              <div *ngIf="abCouponLoading()" class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.couponsV2.ab.searching' | translate }}</div>

              <div *ngIf="abCouponResults().length" class="rounded-lg border border-slate-200 bg-white text-sm dark:border-slate-800 dark:bg-slate-900">
                <button
                  *ngFor="let c of abCouponResults()"
                  type="button"
                  class="w-full text-left border-t border-slate-200 px-3 py-2 hover:bg-slate-50 first:border-t-0 dark:border-slate-800 dark:hover:bg-slate-800/40"
                  (click)="selectAbCouponB(c)"
                >
                  <div class="font-semibold text-slate-900 dark:text-slate-50">{{ c.code }}</div>
                  <div class="text-xs text-slate-500 dark:text-slate-400">{{ c.promotion?.name || c.promotion_id }}</div>
                </button>
              </div>

              <div *ngIf="abCouponB()" class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
                <div class="font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.couponsV2.ab.selectedB' | translate }}</div>
                <div class="mt-1">
                  <span class="font-semibold">{{ abCouponB()!.code }}</span>
                  <span class="text-slate-500 dark:text-slate-400">· {{ abCouponB()!.promotion?.name || abCouponB()!.promotion_id }}</span>
                </div>
                <div *ngIf="abCouponB()!.visibility !== 'assigned'" class="mt-2 text-xs text-amber-800 dark:text-amber-200">
                  {{ 'adminUi.couponsV2.ab.publicWarning' | translate }}
                </div>
              </div>

              <div class="grid gap-2 lg:grid-cols-2">
                <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <input type="checkbox" class="h-5 w-5 accent-indigo-600" [(ngModel)]="abRequireMarketingOptIn" />
                  {{ 'adminUi.couponsV2.bulk.segment.filterMarketing' | translate }}
                </label>
                <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <input type="checkbox" class="h-5 w-5 accent-indigo-600" [(ngModel)]="abRequireEmailVerified" />
                  {{ 'adminUi.couponsV2.bulk.segment.filterVerified' | translate }}
                </label>
              </div>

              <label class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                <input type="checkbox" class="h-5 w-5 accent-indigo-600" [(ngModel)]="abSendEmail" />
                {{ 'adminUi.couponsV2.bulk.sendEmailAssign' | translate }}
              </label>

                <div class="grid gap-3 lg:grid-cols-[1fr_auto] items-end">
                  <app-input [label]="'adminUi.couponsV2.ab.seed' | translate" [(value)]="abBucketSeed"></app-input>
                <app-button
                  size="sm"
                  [disabled]="abBusy() || !abCouponB() || !abCanRun()"
                  [label]="'adminUi.couponsV2.ab.start' | translate"
                  (action)="startAbTest()"
                ></app-button>
                </div>

              <div *ngIf="abJobA() || abJobB()" class="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                <div class="font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.couponsV2.ab.jobsTitle' | translate }}</div>
                <div class="mt-2 grid gap-2">
                  <div *ngIf="abJobA()" class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <div class="font-semibold text-slate-900 dark:text-slate-50">{{ selectedCoupon()!.code }} · A</div>
                      <div class="text-xs text-slate-500 dark:text-slate-400">
                        {{ 'adminUi.couponsV2.bulk.segment.jobProgress' | translate:{ processed: abJobA()!.processed, total: abJobA()!.total_candidates } }}
                      </div>
                    </div>
                    <div class="text-xs font-semibold text-slate-600 dark:text-slate-300">{{ abJobA()!.status }}</div>
                  </div>
                  <div *ngIf="abJobB()" class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <div class="font-semibold text-slate-900 dark:text-slate-50">{{ abCouponB()!.code }} · B</div>
                      <div class="text-xs text-slate-500 dark:text-slate-400">
                        {{ 'adminUi.couponsV2.bulk.segment.jobProgress' | translate:{ processed: abJobB()!.processed, total: abJobB()!.total_candidates } }}
                      </div>
                    </div>
                    <div class="text-xs font-semibold text-slate-600 dark:text-slate-300">{{ abJobB()!.status }}</div>
                  </div>
                </div>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3">
                <label class="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                  {{ 'adminUi.couponsV2.ab.window' | translate }}
                  <select
                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="abAnalyticsDays"
                    (ngModelChange)="loadAbAnalytics()"
                  >
                    <option [ngValue]="7">{{ 'adminUi.couponsV2.analytics.window7' | translate }}</option>
                    <option [ngValue]="30">{{ 'adminUi.couponsV2.analytics.window30' | translate }}</option>
                    <option [ngValue]="90">{{ 'adminUi.couponsV2.analytics.window90' | translate }}</option>
                  </select>
                </label>
                <app-button size="sm" variant="ghost" [disabled]="!abCouponB()" [label]="'adminUi.actions.refresh' | translate" (action)="loadAbAnalytics()"></app-button>
              </div>

              <div *ngIf="abAnalyticsError()" class="text-sm text-rose-700 dark:text-rose-200">{{ abAnalyticsError() }}</div>
              <div *ngIf="abAnalyticsLoading()" class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.couponsV2.ab.loading' | translate }}</div>

              <div *ngIf="abAnalyticsA() && abAnalyticsB()" class="grid gap-3 lg:grid-cols-2">
                <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                  <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ selectedCoupon()!.code }} · A</div>
                  <div class="mt-2 grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                    <div>{{ 'adminUi.couponsV2.analytics.summary.redemptions' | translate }}: {{ abAnalyticsA()!.summary.redemptions }}</div>
                    <div>{{ 'adminUi.couponsV2.analytics.summary.totalDiscount' | translate }}: {{ formatRonString(abAnalyticsA()!.summary.total_discount_ron) }}</div>
                    <div>{{ 'adminUi.couponsV2.analytics.summary.lift' | translate }}: {{ formatRonString(abAnalyticsA()!.summary.aov_lift) }}</div>
                  </div>
                </div>
                <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                  <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ abCouponB()!.code }} · B</div>
                  <div class="mt-2 grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                    <div>{{ 'adminUi.couponsV2.analytics.summary.redemptions' | translate }}: {{ abAnalyticsB()!.summary.redemptions }}</div>
                    <div>{{ 'adminUi.couponsV2.analytics.summary.totalDiscount' | translate }}: {{ formatRonString(abAnalyticsB()!.summary.total_discount_ron) }}</div>
                    <div>{{ 'adminUi.couponsV2.analytics.summary.lift' | translate }}: {{ formatRonString(abAnalyticsB()!.summary.aov_lift) }}</div>
                  </div>
                </div>
              </div>
            </div>

            <div
              *ngIf="assignmentsError()"
              class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
            >
              {{ assignmentsError() }}
            </div>

            <div *ngIf="assignmentsLoading()" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.couponsV2.assignments.loading' | translate }}
            </div>

            <div *ngIf="!assignmentsLoading() && assignments().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.couponsV2.assignments.empty' | translate }}
            </div>

            <div *ngIf="!assignmentsLoading() && assignments().length" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table class="min-w-[780px] w-full text-sm">
                <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                  <tr>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.couponsV2.assignments.table.user' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.couponsV2.assignments.table.issued' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.couponsV2.assignments.table.status' | translate }}</th>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.couponsV2.assignments.table.reason' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    *ngFor="let a of assignments()"
                    class="border-t border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                  >
                    <td class="px-3 py-2 text-slate-900 dark:text-slate-50">
                      <div class="font-medium">{{ a.user_email || a.user_id }}</div>
                      <div *ngIf="a.user_username" class="text-xs text-slate-500 dark:text-slate-400">@{{ a.user_username }}</div>
                    </td>
                    <td class="px-3 py-2 text-slate-600 dark:text-slate-300">{{ a.issued_at | date: 'short' }}</td>
                    <td class="px-3 py-2">
                      <span
                        class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold"
                        [ngClass]="a.revoked_at ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100' : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100'"
                      >
                        {{ a.revoked_at ? ('adminUi.couponsV2.assignments.revoked' | translate) : ('adminUi.couponsV2.assignments.active' | translate) }}
                      </span>
                    </td>
                    <td class="px-3 py-2 text-slate-600 dark:text-slate-300">{{ a.revoked_reason || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  `
})
export class AdminCouponsComponent implements OnInit, OnDestroy {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.admin', url: '/admin/dashboard' },
    { label: 'adminUi.couponsV2.title' }
  ];

  promotionsLoading = signal(true);
  promotionsError = signal<string | null>(null);
  promotions = signal<PromotionRead[]>([]);
  selectedPromotion = signal<PromotionRead | null>(null);
  promotionSaving = signal(false);

  categories = signal<AdminCategory[]>([]);

  productQuery = '';
  productsLoading = signal(false);
  productsError = signal<string | null>(null);
  products = signal<AdminProductListItem[]>([]);
  private productCache: Record<string, AdminProductListItem> = {};
  scopeProductsLoading = signal(false);
  scopeProductsError = signal<string | null>(null);

  promotionCalendarDays = 90;

  couponsLoading = signal(false);
  couponsError = signal<string | null>(null);
  coupons = signal<CouponRead[]>([]);
  selectedCoupon = signal<CouponRead | null>(null);
  couponSaving = signal(false);
  couponQuery = '';

  assignmentsLoading = signal(false);
  assignmentsError = signal<string | null>(null);
  assignments = signal<CouponAssignmentRead[]>([]);

  assignEmail = '';
  assignSendEmail = true;
  revokeEmail = '';
  revokeReason = '';
  revokeSendEmail = true;

  bulkEmails: string[] = [];
  bulkInvalid: string[] = [];
  bulkDuplicates = 0;
  bulkTruncated = 0;
  bulkParseError = '';
  bulkBusy = signal(false);
  bulkResult = signal<CouponBulkResult | null>(null);
  bulkAssignSendEmail = true;
  bulkRevokeSendEmail = true;
  bulkRevokeReason = '';

  segmentRequireMarketingOptIn = false;
  segmentRequireEmailVerified = false;
  segmentAssignSendEmail = true;
  segmentRevokeSendEmail = true;
  segmentRevokeReason = '';
  segmentPreviewBusy = signal(false);
  segmentPreviewAssign = signal<CouponBulkSegmentPreview | null>(null);
  segmentPreviewRevoke = signal<CouponBulkSegmentPreview | null>(null);
  segmentJob = signal<CouponBulkJobRead | null>(null);
  segmentJobsLoading = signal(false);
  segmentJobsError = signal<string | null>(null);
  segmentJobs = signal<CouponBulkJobRead[]>([]);
  segmentJobsBusy = signal(false);
  private segmentJobPollHandle: number | null = null;
  private segmentJobLastStatus: string | null = null;

  analyticsLoading = signal(false);
  analyticsError = signal<string | null>(null);
  analytics = signal<CouponAnalyticsResponse | null>(null);
  analyticsDays = 30;
  analyticsTopLimit = 10;
  analyticsOnlySelectedCoupon = false;

  abCouponQuery = '';
  abCouponLoading = signal(false);
  abCouponError = signal<string | null>(null);
  abCouponResults = signal<CouponRead[]>([]);
  abCouponB = signal<CouponRead | null>(null);
  abRequireMarketingOptIn = false;
  abRequireEmailVerified = false;
  abSendEmail = true;
  abBucketSeed = '';
  abBusy = signal(false);
  abJobA = signal<CouponBulkJobRead | null>(null);
  abJobB = signal<CouponBulkJobRead | null>(null);
  private abPollHandle: number | null = null;

  abAnalyticsDays = 30;
  abAnalyticsLoading = signal(false);
  abAnalyticsError = signal<string | null>(null);
  abAnalyticsA = signal<CouponAnalyticsResponse | null>(null);
  abAnalyticsB = signal<CouponAnalyticsResponse | null>(null);

  promotionForm: PromotionForm = this.blankPromotionForm();
  couponForm: CouponForm = this.blankCouponForm();
  couponCodeGen = { prefix: '', pattern: '', length: 12 };
  couponCodeGenerating = signal(false);
  stackingSampleSubtotal: string | number = 200;

  private autoStartNewPromotion = false;
  private preselectPromotionId: string | null = null;

  constructor(
    private adminCoupons: AdminCouponsV2Service,
    private adminProducts: AdminProductsService,
    private admin: AdminService,
    private toast: ToastService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    const state = history.state as any;
    this.autoStartNewPromotion = Boolean(state?.openNewPromotion);
    this.preselectPromotionId = String(state?.editPromotionId || '').trim() || null;
    this.loadCategories();
    this.loadPromotions();
  }

  ngOnDestroy(): void {
    this.stopSegmentPolling();
    this.stopAbPolling();
  }

  loadCategories(): void {
    this.admin.getCategories().subscribe({
      next: (cats) => this.categories.set(cats ?? []),
      error: () => this.categories.set([])
    });
  }

  loadPromotions(): void {
    const currentId = this.selectedPromotion()?.id || null;
    this.promotionsLoading.set(true);
    this.promotionsError.set(null);
    this.adminCoupons.listPromotions().subscribe({
      next: (promos) => {
        const list = Array.isArray(promos) ? promos : [];
        this.promotions.set(list);
        this.promotionsLoading.set(false);

        if (this.autoStartNewPromotion) {
          this.autoStartNewPromotion = false;
          this.startNewPromotion();
          return;
        }

        if (this.preselectPromotionId) {
          const desiredId = this.preselectPromotionId;
          this.preselectPromotionId = null;
          const found = list.find((p) => p.id === desiredId) || null;
          if (found) {
            this.selectPromotion(found);
            return;
          }
        }

        if (currentId) {
          const found = list.find((p) => p.id === currentId) || null;
          if (found) {
            this.selectPromotion(found);
            return;
          }
        }
        if (list.length) {
          this.selectPromotion(list[0]);
        } else {
          this.startNewPromotion();
        }
      },
      error: (err) => {
        this.promotionsLoading.set(false);
        this.promotionsError.set(err?.error?.detail || this.t('adminUi.couponsV2.errors.loadPromotions'));
      }
    });
  }

  selectPromotion(promo: PromotionRead): void {
    this.selectedPromotion.set(promo);
    this.promotionForm = this.promotionToForm(promo);
    this.couponQuery = '';
    this.resetProductSearch();
    this.loadScopedProducts();
    this.startNewCoupon();
    this.loadCoupons();
    this.loadAnalytics();
  }

  startNewPromotion(): void {
    this.selectedPromotion.set(null);
    this.promotionForm = this.blankPromotionForm();
    this.couponQuery = '';
    this.resetProductSearch();
    this.scopeProductsError.set(null);
    this.scopeProductsLoading.set(false);
    this.coupons.set([]);
    this.selectedCoupon.set(null);
    this.assignments.set([]);
    this.analytics.set(null);
    this.analyticsError.set(null);
    this.analyticsLoading.set(false);
    this.resetAbState();
  }

  onDiscountTypeChange(): void {
    if (this.promotionForm.discount_type === 'percent') {
      this.promotionForm.amount_off = '';
      return;
    }
    if (this.promotionForm.discount_type === 'amount') {
      this.promotionForm.percentage_off = '';
      return;
    }
    this.promotionForm.percentage_off = '';
    this.promotionForm.amount_off = '';
  }

  savePromotion(): void {
    const validationError = this.validatePromotionForm();
    if (validationError) {
      this.toast.error(this.t('adminUi.couponsV2.errors.validation'), validationError);
      return;
    }

    const payload = this.promotionPayloadFromForm();
    const promoId = this.selectedPromotion()?.id;
    this.promotionSaving.set(true);
    const op = promoId ? this.adminCoupons.updatePromotion(promoId, payload) : this.adminCoupons.createPromotion(payload);
    op.subscribe({
      next: (promo) => {
        this.promotionSaving.set(false);
        this.toast.success(this.t('adminUi.couponsV2.success.savePromotion'));
        const id = promo?.id;
        this.loadPromotionsAfterMutation(id || promoId || null);
      },
      error: (err) => {
        this.promotionSaving.set(false);
        this.toast.error(this.t('adminUi.couponsV2.errors.savePromotion'), err?.error?.detail || undefined);
      }
    });
  }

  loadPromotionsAfterMutation(selectId: string | null): void {
    this.promotionsLoading.set(true);
    this.promotionsError.set(null);
    this.adminCoupons.listPromotions().subscribe({
      next: (promos) => {
        const list = Array.isArray(promos) ? promos : [];
        this.promotions.set(list);
        this.promotionsLoading.set(false);
        if (selectId) {
          const found = list.find((p) => p.id === selectId);
          if (found) {
            this.selectPromotion(found);
            return;
          }
        }
        if (list.length) this.selectPromotion(list[0]);
      },
      error: (err) => {
        this.promotionsLoading.set(false);
        this.promotionsError.set(err?.error?.detail || this.t('adminUi.couponsV2.errors.loadPromotions'));
      }
    });
  }

  loadCoupons(): void {
    const promoId = this.selectedPromotion()?.id || null;
    if (!promoId) {
      this.coupons.set([]);
      return;
    }
    this.couponsLoading.set(true);
    this.couponsError.set(null);
    const q = (this.couponQuery || '').trim();
    this.adminCoupons.listCoupons({ promotion_id: promoId, q: q || undefined }).subscribe({
      next: (coupons) => {
        const list = Array.isArray(coupons) ? coupons : [];
        this.coupons.set(list);
        this.couponsLoading.set(false);
        const currentId = this.selectedCoupon()?.id;
        if (currentId && !list.some((c) => c.id === currentId)) {
          this.selectedCoupon.set(null);
          this.assignments.set([]);
        }
      },
      error: (err) => {
        this.couponsLoading.set(false);
        this.couponsError.set(err?.error?.detail || this.t('adminUi.couponsV2.errors.loadCoupons'));
      }
    });
  }

  loadAnalytics(): void {
    const promoId = this.selectedPromotion()?.id || null;
    if (!promoId) {
      this.analytics.set(null);
      this.analyticsError.set(null);
      this.analyticsLoading.set(false);
      return;
    }

    const couponId = this.analyticsOnlySelectedCoupon && this.selectedCoupon() ? this.selectedCoupon()!.id : null;
    this.analyticsLoading.set(true);
    this.analyticsError.set(null);
    this.adminCoupons
      .getAnalytics({
        promotion_id: promoId,
        coupon_id: couponId || undefined,
        days: this.analyticsDays,
        top_limit: this.analyticsTopLimit
      })
      .subscribe({
        next: (data) => {
          this.analyticsLoading.set(false);
          this.analytics.set(data || null);
        },
        error: (err) => {
          this.analyticsLoading.set(false);
          this.analytics.set(null);
          this.analyticsError.set(err?.error?.detail || this.t('adminUi.couponsV2.errors.loadAnalytics'));
        }
      });
  }

  abCanRun(): boolean {
    const couponA = this.selectedCoupon();
    if (!couponA) return false;
    if (couponA.visibility !== 'assigned') return false;
    const couponB = this.abCouponB();
    if (couponB && couponB.visibility !== 'assigned') return false;
    return true;
  }

  abSearchCoupons(): void {
    const q = (this.abCouponQuery || '').trim();
    if (!q) {
      this.abCouponResults.set([]);
      this.abCouponError.set(null);
      this.abCouponLoading.set(false);
      return;
    }
    this.abCouponLoading.set(true);
    this.abCouponError.set(null);
    const currentId = this.selectedCoupon()?.id || null;
    this.adminCoupons.listCoupons({ q }).subscribe({
      next: (list) => {
        this.abCouponLoading.set(false);
        const results = (Array.isArray(list) ? list : []).filter((c) => c.id !== currentId);
        this.abCouponResults.set(results.slice(0, 10));
      },
      error: (err) => {
        this.abCouponLoading.set(false);
        this.abCouponResults.set([]);
        this.abCouponError.set(err?.error?.detail || this.t('adminUi.couponsV2.ab.searchError'));
      }
    });
  }

  selectAbCouponB(coupon: CouponRead): void {
    if (!coupon?.id) return;
    const currentId = this.selectedCoupon()?.id || null;
    if (currentId && coupon.id === currentId) return;
    this.abCouponB.set(coupon);
    this.abCouponResults.set([]);
    this.abCouponError.set(null);
    this.abCouponQuery = coupon.code || this.abCouponQuery;
    if (!this.abBucketSeed.trim()) {
      this.abBucketSeed = this.defaultAbBucketSeed();
    }
    this.loadAbAnalytics();
  }

  startAbTest(): void {
    const couponA = this.selectedCoupon();
    const couponB = this.abCouponB();
    if (!couponA || !couponB) return;
    if (!this.abCanRun()) {
      this.toast.error(this.t('adminUi.couponsV2.errors.validation'), this.t('adminUi.couponsV2.ab.requiresAssigned'));
      return;
    }

    const seed = (this.abBucketSeed || '').trim() || this.defaultAbBucketSeed();
    this.abBucketSeed = seed;

    this.abBusy.set(true);
    this.abJobA.set(null);
    this.abJobB.set(null);
    this.abAnalyticsError.set(null);
    this.stopAbPolling();

    const basePayload = {
      require_marketing_opt_in: this.abRequireMarketingOptIn,
      require_email_verified: this.abRequireEmailVerified,
      send_email: this.abSendEmail,
      bucket_total: 2,
      bucket_seed: seed
    };

    forkJoin({
      a: this.adminCoupons.startSegmentAssignJob(couponA.id, { ...basePayload, bucket_index: 0 }),
      b: this.adminCoupons.startSegmentAssignJob(couponB.id, { ...basePayload, bucket_index: 1 })
    }).subscribe({
      next: ({ a, b }) => {
        this.abBusy.set(false);
        this.abJobA.set(a);
        this.abJobB.set(b);
        this.toast.success(this.t('adminUi.couponsV2.ab.started'));
        this.startAbPolling();
      },
      error: (err) => {
        this.abBusy.set(false);
        this.toast.error(this.t('adminUi.couponsV2.ab.startError'), err?.error?.detail || undefined);
      }
    });
  }

  loadAbAnalytics(): void {
    const couponA = this.selectedCoupon();
    const couponB = this.abCouponB();
    if (!couponA || !couponB) {
      this.abAnalyticsA.set(null);
      this.abAnalyticsB.set(null);
      this.abAnalyticsError.set(null);
      this.abAnalyticsLoading.set(false);
      return;
    }

    this.abAnalyticsLoading.set(true);
    this.abAnalyticsError.set(null);
    forkJoin({
      a: this.adminCoupons.getAnalytics({ promotion_id: couponA.promotion_id, coupon_id: couponA.id, days: this.abAnalyticsDays }),
      b: this.adminCoupons.getAnalytics({ promotion_id: couponB.promotion_id, coupon_id: couponB.id, days: this.abAnalyticsDays })
    }).subscribe({
      next: ({ a, b }) => {
        this.abAnalyticsLoading.set(false);
        this.abAnalyticsA.set(a);
        this.abAnalyticsB.set(b);
      },
      error: (err) => {
        this.abAnalyticsLoading.set(false);
        this.abAnalyticsA.set(null);
        this.abAnalyticsB.set(null);
        this.abAnalyticsError.set(err?.error?.detail || this.t('adminUi.couponsV2.errors.loadAnalytics'));
      }
    });
  }

  selectCoupon(coupon: CouponRead): void {
    this.selectedCoupon.set(coupon);
    this.couponForm = this.couponToForm(coupon);
    this.assignEmail = '';
    this.revokeEmail = '';
    this.revokeReason = '';
    this.resetBulkState();
    this.resetSegmentState();
    this.resetAbState();
    this.loadAssignments();
    this.loadSegmentJobs();
    if (this.analyticsOnlySelectedCoupon) this.loadAnalytics();
  }

  startNewCoupon(): void {
    this.selectedCoupon.set(null);
    this.couponForm = this.blankCouponForm();
    const promoId = this.selectedPromotion()?.id;
    if (promoId) this.couponForm.promotion_id = promoId;
    this.couponCodeGen = { prefix: this.suggestedCouponPrefix(), pattern: '', length: 12 };
    this.assignments.set([]);
    this.resetBulkState();
    this.resetSegmentState();
    this.resetAbState();
  }

  private suggestedCouponPrefix(): string {
    const promo = this.selectedPromotion();
    const candidate = (promo?.key || promo?.name || 'COUPON').trim();
    return candidate || 'COUPON';
  }

  generateCouponCode(): void {
    if (this.selectedCoupon()) return;
    const prefix = (this.couponCodeGen.prefix || '').trim() || this.suggestedCouponPrefix();
    const pattern = (this.couponCodeGen.pattern || '').trim() || null;
    const lengthRaw = Number(this.couponCodeGen.length);
    const length = Number.isFinite(lengthRaw) && lengthRaw > 0 ? lengthRaw : 12;

    this.couponCodeGenerating.set(true);
    this.adminCoupons.generateCouponCode({ prefix, pattern, length }).subscribe({
      next: (res) => {
        this.couponCodeGenerating.set(false);
        this.couponForm.code = String(res?.code || '').trim().toUpperCase();
        if (this.couponForm.code) this.toast.success(this.t('adminUi.couponsV2.success.codeGenerated'));
      },
      error: (err) => {
        this.couponCodeGenerating.set(false);
        this.toast.error(this.t('adminUi.couponsV2.errors.validation'), err?.error?.detail || this.t('adminUi.couponsV2.errors.codeGenerate'));
      }
    });
  }

  saveCoupon(): void {
    const promoId = (this.couponForm.promotion_id || '').trim();
    if (!promoId) {
      this.toast.error(this.t('adminUi.couponsV2.errors.validation'), this.t('adminUi.couponsV2.errors.couponPromotionRequired'));
      return;
    }
    const code = (this.couponForm.code || '').trim().toUpperCase();
    if (!this.selectedCoupon() && !code) {
      this.toast.error(this.t('adminUi.couponsV2.errors.validation'), this.t('adminUi.couponsV2.errors.couponCodeRequired'));
      return;
    }

    this.couponSaving.set(true);
    const existingId = this.selectedCoupon()?.id || null;
    const payload: any = {
      is_active: !!this.couponForm.is_active,
      starts_at: this.couponForm.starts_at ? new Date(this.couponForm.starts_at).toISOString() : null,
      ends_at: this.couponForm.ends_at ? new Date(this.couponForm.ends_at).toISOString() : null,
      global_max_redemptions: this.optionalInt(this.couponForm.global_max_redemptions),
      per_customer_max_redemptions: this.optionalInt(this.couponForm.per_customer_max_redemptions)
    };

    const op = existingId
      ? this.adminCoupons.updateCoupon(existingId, payload)
      : this.adminCoupons.createCoupon({
          promotion_id: promoId,
          code,
          visibility: this.couponForm.visibility,
          is_active: !!this.couponForm.is_active,
          starts_at: payload.starts_at,
          ends_at: payload.ends_at,
          global_max_redemptions: payload.global_max_redemptions,
          per_customer_max_redemptions: payload.per_customer_max_redemptions
        });

    op.subscribe({
      next: (coupon) => {
        this.couponSaving.set(false);
        this.toast.success(this.t('adminUi.couponsV2.success.saveCoupon'));
        this.loadCouponsAfterMutation(coupon?.id || existingId);
      },
      error: (err) => {
        this.couponSaving.set(false);
        this.toast.error(this.t('adminUi.couponsV2.errors.saveCoupon'), err?.error?.detail || undefined);
      }
    });
  }

  loadCouponsAfterMutation(selectId: string | null): void {
    const promoId = this.selectedPromotion()?.id || null;
    if (!promoId) {
      this.coupons.set([]);
      return;
    }
    this.couponsLoading.set(true);
    this.couponsError.set(null);
    this.adminCoupons.listCoupons({ promotion_id: promoId }).subscribe({
      next: (coupons) => {
        const list = Array.isArray(coupons) ? coupons : [];
        this.coupons.set(list);
        this.couponsLoading.set(false);
        if (selectId) {
          const found = list.find((c) => c.id === selectId);
          if (found) this.selectCoupon(found);
        }
      },
      error: (err) => {
        this.couponsLoading.set(false);
        this.couponsError.set(err?.error?.detail || this.t('adminUi.couponsV2.errors.loadCoupons'));
      }
    });
  }

  loadAssignments(): void {
    const couponId = this.selectedCoupon()?.id;
    if (!couponId) {
      this.assignments.set([]);
      return;
    }
    this.assignmentsLoading.set(true);
    this.assignmentsError.set(null);
    this.adminCoupons.listAssignments(couponId).subscribe({
      next: (rows) => {
        this.assignments.set(Array.isArray(rows) ? rows : []);
        this.assignmentsLoading.set(false);
      },
      error: (err) => {
        this.assignmentsLoading.set(false);
        this.assignmentsError.set(err?.error?.detail || this.t('adminUi.couponsV2.errors.loadAssignments'));
      }
    });
  }

  assign(): void {
    const couponId = this.selectedCoupon()?.id;
    if (!couponId) return;
    const email = (this.assignEmail || '').trim();
    if (!email) {
      this.toast.error(this.t('adminUi.couponsV2.errors.validation'), this.t('adminUi.couponsV2.errors.emailRequired'));
      return;
    }
    this.adminCoupons.assignCoupon(couponId, { email, send_email: this.assignSendEmail }).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.couponsV2.success.assign'));
        this.assignEmail = '';
        this.loadAssignments();
      },
      error: (err) => this.toast.error(this.t('adminUi.couponsV2.errors.assign'), err?.error?.detail || undefined)
    });
  }

  revoke(): void {
    const couponId = this.selectedCoupon()?.id;
    if (!couponId) return;
    const email = (this.revokeEmail || '').trim();
    if (!email) {
      this.toast.error(this.t('adminUi.couponsV2.errors.validation'), this.t('adminUi.couponsV2.errors.emailRequired'));
      return;
    }
    const reason = (this.revokeReason || '').trim();
    this.adminCoupons
      .revokeCoupon(couponId, { email, reason: reason || null, send_email: this.revokeSendEmail })
      .subscribe({
        next: () => {
          this.toast.success(this.t('adminUi.couponsV2.success.revoke'));
          this.revokeEmail = '';
          this.revokeReason = '';
          this.loadAssignments();
        },
        error: (err) => this.toast.error(this.t('adminUi.couponsV2.errors.revoke'), err?.error?.detail || undefined)
      });
  }

  searchProducts(): void {
    const q = (this.productQuery || '').trim();
    if (!q) {
      this.products.set([]);
      return;
    }
    this.productsLoading.set(true);
    this.productsError.set(null);
    this.adminProducts.search({ q, page: 1, limit: 20 }).subscribe({
      next: (res) => {
        const items = (res?.items ?? []) as AdminProductListItem[];
        this.products.set(items);
        for (const it of items) {
          if (it?.id) this.productCache[it.id] = it;
        }
        this.productsLoading.set(false);
      },
      error: (err) => {
        this.productsLoading.set(false);
        this.productsError.set(err?.error?.detail || this.t('adminUi.couponsV2.errors.searchProducts'));
      }
    });
  }

  resetProductSearch(): void {
    this.productQuery = '';
    this.products.set([]);
    this.productsError.set(null);
    this.productsLoading.set(false);
  }

  addScopeProduct(mode: 'include' | 'exclude', product: AdminProductListItem): void {
    const id = (product?.id || '').toString();
    if (!id) return;
    this.productCache[id] = product;
    if (mode === 'include') {
      if (!this.promotionForm.included_product_ids.includes(id)) {
        this.promotionForm.included_product_ids = [...this.promotionForm.included_product_ids, id];
      }
      this.promotionForm.excluded_product_ids = this.promotionForm.excluded_product_ids.filter((x) => x !== id);
    } else {
      if (!this.promotionForm.excluded_product_ids.includes(id)) {
        this.promotionForm.excluded_product_ids = [...this.promotionForm.excluded_product_ids, id];
      }
      this.promotionForm.included_product_ids = this.promotionForm.included_product_ids.filter((x) => x !== id);
    }
  }

  removeScopeProduct(mode: 'include' | 'exclude', id: string): void {
    if (mode === 'include') {
      this.promotionForm.included_product_ids = this.promotionForm.included_product_ids.filter((x) => x !== id);
      return;
    }
    this.promotionForm.excluded_product_ids = this.promotionForm.excluded_product_ids.filter((x) => x !== id);
  }

  syncCategoryScopes(changed: 'included' | 'excluded'): void {
    const included = this.uniqueIds(this.promotionForm.included_category_ids);
    const excluded = this.uniqueIds(this.promotionForm.excluded_category_ids);
    if (changed === 'included') {
      const includedSet = new Set(included);
      this.promotionForm.included_category_ids = included;
      this.promotionForm.excluded_category_ids = excluded.filter((id) => !includedSet.has(id));
      return;
    }
    const excludedSet = new Set(excluded);
    this.promotionForm.excluded_category_ids = excluded;
    this.promotionForm.included_category_ids = included.filter((id) => !excludedSet.has(id));
  }

  describePromotion(promo: PromotionRead): string {
    if (!promo) return '';
    if (promo.discount_type === 'free_shipping') return this.t('adminUi.couponsV2.discountSummary.freeShipping');
    if (promo.discount_type === 'amount') {
      const value = promo.amount_off ?? '0';
      return this.t('adminUi.couponsV2.discountSummary.amountOff', { value });
    }
    const value = promo.percentage_off ?? '0';
    return this.t('adminUi.couponsV2.discountSummary.percentOff', { value });
  }

  promotionCalendarStartDate(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  promotionCalendarEndDate(): Date {
    const start = this.promotionCalendarStartDate();
    return new Date(start.getTime() + this.promotionCalendarDays * 86_400_000);
  }

  promotionScheduleRows(): PromotionScheduleRow[] {
    const promos = this.promotions();
    if (!promos.length) return [];

    const startDate = this.promotionCalendarStartDate();
    const windowStart = startDate.getTime();
    const windowEnd = windowStart + this.promotionCalendarDays * 86_400_000;
    const duration = windowEnd - windowStart;

    const parseEpoch = (value: string | null | undefined, fallback: number) => {
      if (!value) return fallback;
      const ms = Date.parse(value);
      return Number.isNaN(ms) ? fallback : ms;
    };

    const visible: Array<{
      promotion: PromotionRead;
      startMs: number;
      endMs: number;
      visibleStartMs: number;
      visibleEndMs: number;
    }> = [];

    for (const promo of promos) {
      const startMs = parseEpoch(promo.starts_at ?? null, Number.NEGATIVE_INFINITY);
      const endMs = parseEpoch(promo.ends_at ?? null, Number.POSITIVE_INFINITY);
      const visibleStartMs = Math.max(startMs, windowStart);
      const visibleEndMs = Math.min(endMs, windowEnd);
      if (!(visibleEndMs > windowStart && visibleStartMs < windowEnd)) continue;
      if (!(visibleEndMs > visibleStartMs)) continue;
      visible.push({ promotion: promo, startMs, endMs, visibleStartMs, visibleEndMs });
    }

    if (!visible.length) return [];

    const conflicts = new Map<string, { names: Set<string> }>();
    for (const row of visible) {
      conflicts.set(row.promotion.id, { names: new Set() });
    }

    for (let i = 0; i < visible.length; i += 1) {
      const a = visible[i];
      if (!a.promotion.is_active) continue;
      for (let j = i + 1; j < visible.length; j += 1) {
        const b = visible[j];
        if (!b.promotion.is_active) continue;
        const overlaps = a.visibleStartMs < b.visibleEndMs && b.visibleStartMs < a.visibleEndMs;
        if (!overlaps) continue;
        conflicts.get(a.promotion.id)?.names.add(b.promotion.name);
        conflicts.get(b.promotion.id)?.names.add(a.promotion.name);
      }
    }

    visible.sort((a, b) => a.visibleStartMs - b.visibleStartMs);

    const rows: PromotionScheduleRow[] = [];
    for (const row of visible) {
      const leftPct = Math.max(0, Math.min(100, ((row.visibleStartMs - windowStart) / duration) * 100));
      let widthPct = Math.max(0, ((row.visibleEndMs - row.visibleStartMs) / duration) * 100);
      widthPct = Math.max(widthPct, 1);
      widthPct = Math.min(widthPct, 100 - leftPct);

      const conflictNames = Array.from(conflicts.get(row.promotion.id)?.names ?? []);
      const preview = conflictNames.slice(0, 6);
      const conflictNamesLabel =
        conflictNames.length > preview.length ? `${preview.join(', ')} +${conflictNames.length - preview.length}` : preview.join(', ');

      rows.push({
        promotion: row.promotion,
        leftPct,
        widthPct,
        conflictCount: conflictNames.length,
        conflictNames: conflictNamesLabel
      });
    }

    return rows;
  }

  productLabel(id: string): string {
    const hit = this.productCache[id];
    if (hit?.name) return hit.name;
    return id;
  }

  private loadScopedProducts(): void {
    const ids = this.uniqueIds([...this.promotionForm.included_product_ids, ...this.promotionForm.excluded_product_ids]);
    const missing = ids.filter((id) => !this.productCache[id]);
    if (missing.length === 0) {
      this.scopeProductsLoading.set(false);
      this.scopeProductsError.set(null);
      return;
    }

    this.scopeProductsLoading.set(true);
    this.scopeProductsError.set(null);
    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += 200) {
      chunks.push(missing.slice(i, i + 200));
    }
    let remaining = chunks.length;
    const done = () => {
      remaining -= 1;
      if (remaining <= 0) this.scopeProductsLoading.set(false);
    };

    for (const chunk of chunks) {
      this.adminProducts.byIds(chunk).subscribe({
        next: (items) => {
          for (const it of items ?? []) {
            if (it?.id) this.productCache[it.id] = it;
          }
        },
        error: () => {
          this.scopeProductsError.set(this.t('adminUi.couponsV2.errors.resolveProducts'));
          done();
        },
        complete: () => done()
      });
    }
  }

  private validatePromotionForm(): string | null {
    const name = (this.promotionForm.name || '').trim();
    if (!name) return this.t('adminUi.couponsV2.errors.promotionNameRequired');

    const starts = this.promotionForm.starts_at ? Date.parse(new Date(this.promotionForm.starts_at).toISOString()) : null;
    const ends = this.promotionForm.ends_at ? Date.parse(new Date(this.promotionForm.ends_at).toISOString()) : null;
    if (starts && ends && ends < starts) return this.t('adminUi.couponsV2.errors.invalidDateRange');

    if (this.promotionForm.discount_type === 'percent') {
      const pct = this.optionalNumber(this.promotionForm.percentage_off);
      if (pct === null || pct <= 0 || pct > 100) return this.t('adminUi.couponsV2.errors.percentRequired');
    }

    if (this.promotionForm.discount_type === 'amount') {
      const amount = this.optionalNumber(this.promotionForm.amount_off);
      if (amount === null || amount <= 0) return this.t('adminUi.couponsV2.errors.amountRequired');
    }

    return null;
  }

  private promotionPayloadFromForm(): any {
    const key = (this.promotionForm.key || '').trim();
    const description = (this.promotionForm.description || '').trim();
    return {
      key: key || null,
      name: (this.promotionForm.name || '').trim(),
      description: description || null,
      discount_type: this.promotionForm.discount_type,
      percentage_off: this.promotionForm.discount_type === 'percent' ? this.optionalDecimalString(this.promotionForm.percentage_off) : null,
      amount_off: this.promotionForm.discount_type === 'amount' ? this.optionalDecimalString(this.promotionForm.amount_off) : null,
      max_discount_amount: this.optionalDecimalString(this.promotionForm.max_discount_amount),
      min_subtotal: this.optionalDecimalString(this.promotionForm.min_subtotal),
      included_product_ids: this.uniqueIds(this.promotionForm.included_product_ids),
      excluded_product_ids: this.uniqueIds(this.promotionForm.excluded_product_ids),
      included_category_ids: this.uniqueIds(this.promotionForm.included_category_ids),
      excluded_category_ids: this.uniqueIds(this.promotionForm.excluded_category_ids),
      allow_on_sale_items: !!this.promotionForm.allow_on_sale_items,
      first_order_only: !!this.promotionForm.first_order_only,
      is_active: !!this.promotionForm.is_active,
      starts_at: this.promotionForm.starts_at ? new Date(this.promotionForm.starts_at).toISOString() : null,
      ends_at: this.promotionForm.ends_at ? new Date(this.promotionForm.ends_at).toISOString() : null,
      is_automatic: !!this.promotionForm.is_automatic
    };
  }

  private promotionToForm(promo: PromotionRead): PromotionForm {
    return {
      key: (promo.key || '').toString(),
      name: (promo.name || '').toString(),
      description: (promo.description || '').toString(),
      discount_type: promo.discount_type,
      percentage_off: (promo.percentage_off ?? '').toString(),
      amount_off: (promo.amount_off ?? '').toString(),
      max_discount_amount: (promo.max_discount_amount ?? '').toString(),
      min_subtotal: (promo.min_subtotal ?? '').toString(),
      allow_on_sale_items: promo.allow_on_sale_items !== false,
      first_order_only: promo.first_order_only === true,
      starts_at: promo.starts_at ? this.toLocalDateTime(promo.starts_at) : '',
      ends_at: promo.ends_at ? this.toLocalDateTime(promo.ends_at) : '',
      is_active: promo.is_active !== false,
      is_automatic: !!promo.is_automatic,
      included_product_ids: Array.isArray(promo.included_product_ids) ? promo.included_product_ids : [],
      excluded_product_ids: Array.isArray(promo.excluded_product_ids) ? promo.excluded_product_ids : [],
      included_category_ids: Array.isArray(promo.included_category_ids) ? promo.included_category_ids : [],
      excluded_category_ids: Array.isArray(promo.excluded_category_ids) ? promo.excluded_category_ids : []
    };
  }

  private couponToForm(coupon: CouponRead): CouponForm {
    return {
      promotion_id: coupon.promotion_id,
      code: coupon.code,
      visibility: coupon.visibility,
      is_active: coupon.is_active !== false,
      starts_at: coupon.starts_at ? this.toLocalDateTime(coupon.starts_at) : '',
      ends_at: coupon.ends_at ? this.toLocalDateTime(coupon.ends_at) : '',
      global_max_redemptions: coupon.global_max_redemptions ?? '',
      per_customer_max_redemptions: coupon.per_customer_max_redemptions ?? ''
    };
  }

  private blankPromotionForm(): PromotionForm {
    return {
      key: '',
      name: '',
      description: '',
      discount_type: 'percent',
      percentage_off: 0,
      amount_off: '',
      max_discount_amount: '',
      min_subtotal: '',
      allow_on_sale_items: true,
      first_order_only: false,
      starts_at: '',
      ends_at: '',
      is_active: true,
      is_automatic: false,
      included_product_ids: [],
      excluded_product_ids: [],
      included_category_ids: [],
      excluded_category_ids: []
    };
  }

  private blankCouponForm(): CouponForm {
    return {
      promotion_id: '',
      code: '',
      visibility: 'public',
      is_active: true,
      starts_at: '',
      ends_at: '',
      global_max_redemptions: '',
      per_customer_max_redemptions: ''
    };
  }

  stackingMinSubtotalBlocked(): boolean {
    const min = this.optionalNumber(this.promotionForm.min_subtotal);
    if (min === null || min <= 0) return false;
    const subtotal = this.optionalNumber(this.stackingSampleSubtotal);
    if (subtotal === null) return false;
    return subtotal < min;
  }

  stackingPreviewProductDiscount(assumeAllItemsOnSale: boolean): number | null {
    if (this.promotionForm.discount_type === 'free_shipping') return null;
    const subtotal = this.optionalNumber(this.stackingSampleSubtotal);
    if (subtotal === null || subtotal <= 0) return 0;

    if (this.stackingMinSubtotalBlocked()) return 0;

    const eligibleSubtotal = assumeAllItemsOnSale && !this.promotionForm.allow_on_sale_items ? 0 : subtotal;
    if (eligibleSubtotal <= 0) return 0;

    let discount = 0;
    if (this.promotionForm.discount_type === 'percent') {
      const pct = this.optionalNumber(this.promotionForm.percentage_off);
      if (pct === null || pct <= 0) return 0;
      discount = (eligibleSubtotal * pct) / 100;
    } else if (this.promotionForm.discount_type === 'amount') {
      const amount = this.optionalNumber(this.promotionForm.amount_off);
      if (amount === null || amount <= 0) return 0;
      discount = Math.min(amount, eligibleSubtotal);
    }

    const cap = this.optionalNumber(this.promotionForm.max_discount_amount);
    if (cap !== null && cap >= 0) {
      discount = Math.min(discount, cap);
    }
    discount = Math.min(discount, eligibleSubtotal);

    return Math.round(discount * 100) / 100;
  }

  formatRon(value: number | null): string {
    if (value === null) return '—';
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    return `${num.toFixed(2)} RON`;
  }

  formatRonString(value: string | null | undefined): string {
    return this.formatRon(this.optionalNumber(value));
  }

  private uniqueIds(ids: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of ids ?? []) {
      const id = (raw || '').toString();
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  private optionalDecimalString(value: unknown): string | null {
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    }
    return null;
  }

  private optionalNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const num = Number(trimmed);
      return Number.isFinite(num) ? num : null;
    }
    return null;
  }

  private optionalInt(value: unknown): number | null {
    const num = this.optionalNumber(value);
    if (num === null) return null;
    const n = Math.trunc(num);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private toLocalDateTime(value: string): string {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private t(key: string, params?: Record<string, any>): string {
    return this.translate.instant(key, params) as string;
  }

  async onBulkFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;
    this.resetBulkState();
    try {
      const text = await file.text();
      const { emails, invalid, duplicates, truncated } = this.parseEmailsFromCsv(text);
      this.bulkEmails = emails;
      this.bulkInvalid = invalid;
      this.bulkDuplicates = duplicates;
      this.bulkTruncated = truncated;
    } catch {
      this.bulkParseError = this.t('adminUi.couponsV2.bulk.parseError');
    }
  }

  clearBulkSelection(fileInput?: HTMLInputElement): void {
    if (fileInput) fileInput.value = '';
    this.resetBulkState();
  }

  bulkEmailsPreview(): string {
    const preview = this.bulkEmails.slice(0, 6);
    if (preview.length === 0) return '';
    const suffix = this.bulkEmails.length > preview.length ? '…' : '';
    return `${preview.join(', ')}${suffix}`;
  }

  bulkAssign(): void {
    const couponId = this.selectedCoupon()?.id;
    if (!couponId) return;
    const emails = this.bulkEmails.slice(0, 500);
    if (emails.length === 0) {
      this.toast.error(this.t('adminUi.couponsV2.errors.validation'), this.t('adminUi.couponsV2.bulk.noEmails'));
      return;
    }

    this.bulkBusy.set(true);
    this.bulkResult.set(null);
    this.adminCoupons.bulkAssignCoupon(couponId, { emails, send_email: this.bulkAssignSendEmail }).subscribe({
      next: (res) => {
        this.bulkBusy.set(false);
        this.bulkResult.set(res);
        this.toast.success(this.t('adminUi.couponsV2.bulk.successAssign'));
        this.loadAssignments();
      },
      error: (err) => {
        this.bulkBusy.set(false);
        this.toast.error(this.t('adminUi.couponsV2.errors.assign'), err?.error?.detail || undefined);
      }
    });
  }

  bulkRevoke(): void {
    const couponId = this.selectedCoupon()?.id;
    if (!couponId) return;
    const emails = this.bulkEmails.slice(0, 500);
    if (emails.length === 0) {
      this.toast.error(this.t('adminUi.couponsV2.errors.validation'), this.t('adminUi.couponsV2.bulk.noEmails'));
      return;
    }

    const reason = (this.bulkRevokeReason || '').trim();
    this.bulkBusy.set(true);
    this.bulkResult.set(null);
    this.adminCoupons
      .bulkRevokeCoupon(couponId, { emails, reason: reason || null, send_email: this.bulkRevokeSendEmail })
      .subscribe({
        next: (res) => {
          this.bulkBusy.set(false);
          this.bulkResult.set(res);
          this.toast.success(this.t('adminUi.couponsV2.bulk.successRevoke'));
          this.loadAssignments();
        },
        error: (err) => {
          this.bulkBusy.set(false);
          this.toast.error(this.t('adminUi.couponsV2.errors.revoke'), err?.error?.detail || undefined);
        }
      });
  }

  segmentJobInProgress(): boolean {
    const status = this.segmentJob()?.status;
    return status === 'pending' || status === 'running';
  }

  segmentCandidatesCount(): number {
    return (
      this.segmentPreviewAssign()?.total_candidates ??
      this.segmentPreviewRevoke()?.total_candidates ??
      this.segmentJob()?.total_candidates ??
      0
    );
  }

  segmentPreviewSample(): string {
    const sample =
      this.segmentPreviewAssign()?.sample_emails ??
      this.segmentPreviewRevoke()?.sample_emails ??
      [];
    const preview = sample.slice(0, 6);
    const suffix = sample.length > preview.length ? '…' : '';
    return preview.length ? `${preview.join(', ')}${suffix}` : '';
  }

  loadSegmentJobs(): void {
    const couponId = this.selectedCoupon()?.id;
    if (!couponId) return;
    this.segmentJobsLoading.set(true);
    this.segmentJobsError.set(null);
    this.adminCoupons.listBulkJobs(couponId, { limit: 10 }).subscribe({
      next: (jobs) => {
        this.segmentJobsLoading.set(false);
        this.segmentJobs.set(Array.isArray(jobs) ? jobs : []);
      },
      error: (err) => {
        this.segmentJobsLoading.set(false);
        this.segmentJobsError.set(err?.error?.detail || this.t('adminUi.couponsV2.bulk.segment.jobsLoadError'));
        this.segmentJobs.set([]);
      }
    });
  }

  segmentPreview(): void {
    const couponId = this.selectedCoupon()?.id;
    if (!couponId) return;
    this.segmentPreviewBusy.set(true);
    this.segmentPreviewAssign.set(null);
    this.segmentPreviewRevoke.set(null);

    const payloadBase = {
      require_marketing_opt_in: this.segmentRequireMarketingOptIn,
      require_email_verified: this.segmentRequireEmailVerified
    };
    forkJoin({
      assign: this.adminCoupons.previewSegmentAssign(couponId, { ...payloadBase, send_email: this.segmentAssignSendEmail }),
      revoke: this.adminCoupons.previewSegmentRevoke(couponId, {
        ...payloadBase,
        reason: (this.segmentRevokeReason || '').trim() || null,
        send_email: this.segmentRevokeSendEmail
      })
    }).subscribe({
      next: ({ assign, revoke }) => {
        this.segmentPreviewBusy.set(false);
        this.segmentPreviewAssign.set(assign);
        this.segmentPreviewRevoke.set(revoke);
      },
      error: (err) => {
        this.segmentPreviewBusy.set(false);
        this.toast.error(this.t('adminUi.couponsV2.bulk.segment.previewError'), err?.error?.detail || undefined);
      }
    });
  }

  segmentAssign(): void {
    const couponId = this.selectedCoupon()?.id;
    if (!couponId) return;
    this.segmentJob.set(null);
    this.segmentJobLastStatus = null;
    this.segmentPreviewAssign.set(null);
    this.segmentPreviewRevoke.set(null);

    this.adminCoupons
      .startSegmentAssignJob(couponId, {
        require_marketing_opt_in: this.segmentRequireMarketingOptIn,
        require_email_verified: this.segmentRequireEmailVerified,
        send_email: this.segmentAssignSendEmail
      })
      .subscribe({
        next: (job) => {
          this.segmentJob.set(job);
          this.upsertSegmentJob(job, { promote: true });
          this.toast.success(this.t('adminUi.couponsV2.bulk.segment.started'));
          this.startSegmentPolling(job.id);
        },
        error: (err) => {
          this.toast.error(this.t('adminUi.couponsV2.errors.assign'), err?.error?.detail || undefined);
        }
      });
  }

  segmentRevoke(): void {
    const couponId = this.selectedCoupon()?.id;
    if (!couponId) return;
    this.segmentJob.set(null);
    this.segmentJobLastStatus = null;
    this.segmentPreviewAssign.set(null);
    this.segmentPreviewRevoke.set(null);

    this.adminCoupons
      .startSegmentRevokeJob(couponId, {
        require_marketing_opt_in: this.segmentRequireMarketingOptIn,
        require_email_verified: this.segmentRequireEmailVerified,
        reason: (this.segmentRevokeReason || '').trim() || null,
        send_email: this.segmentRevokeSendEmail
      })
      .subscribe({
        next: (job) => {
          this.segmentJob.set(job);
          this.upsertSegmentJob(job, { promote: true });
          this.toast.success(this.t('adminUi.couponsV2.bulk.segment.started'));
          this.startSegmentPolling(job.id);
        },
        error: (err) => {
          this.toast.error(this.t('adminUi.couponsV2.errors.revoke'), err?.error?.detail || undefined);
        }
      });
  }

  cancelSegmentJob(job: CouponBulkJobRead): void {
    if (!job?.id) return;
    if (job.status !== 'pending' && job.status !== 'running') return;
    this.segmentJobsBusy.set(true);
    this.adminCoupons.cancelBulkJob(job.id).subscribe({
      next: (updated) => {
        this.segmentJobsBusy.set(false);
        this.upsertSegmentJob(updated);
        if (this.segmentJob()?.id === updated.id) {
          this.segmentJob.set(updated);
          this.stopSegmentPolling();
        }
        this.toast.success(this.t('adminUi.couponsV2.bulk.segment.cancelled'));
      },
      error: (err) => {
        this.segmentJobsBusy.set(false);
        this.toast.error(this.t('adminUi.couponsV2.bulk.segment.cancelError'), err?.error?.detail || undefined);
      }
    });
  }

  retrySegmentJob(job: CouponBulkJobRead): void {
    if (!job?.id) return;
    if (job.status !== 'failed' && job.status !== 'cancelled') return;
    if (this.segmentJobInProgress()) return;
    this.segmentJobsBusy.set(true);
    this.adminCoupons.retryBulkJob(job.id).subscribe({
      next: (newJob) => {
        this.segmentJobsBusy.set(false);
        this.segmentJob.set(newJob);
        this.upsertSegmentJob(newJob, { promote: true });
        this.toast.success(this.t('adminUi.couponsV2.bulk.segment.started'));
        this.startSegmentPolling(newJob.id);
      },
      error: (err) => {
        this.segmentJobsBusy.set(false);
        this.toast.error(this.t('adminUi.couponsV2.bulk.segment.retryError'), err?.error?.detail || undefined);
      }
    });
  }

  private startSegmentPolling(jobId: string): void {
    this.stopSegmentPolling();
    this.refreshSegmentJob(jobId);
    this.segmentJobPollHandle = window.setInterval(() => this.refreshSegmentJob(jobId), 2000);
  }

  private stopSegmentPolling(): void {
    if (this.segmentJobPollHandle !== null) {
      window.clearInterval(this.segmentJobPollHandle);
      this.segmentJobPollHandle = null;
    }
  }

  private startAbPolling(): void {
    this.stopAbPolling();
    this.refreshAbJobs();
    this.abPollHandle = window.setInterval(() => this.refreshAbJobs(), 2000);
  }

  private stopAbPolling(): void {
    if (this.abPollHandle !== null) {
      window.clearInterval(this.abPollHandle);
      this.abPollHandle = null;
    }
  }

  private refreshAbJobs(): void {
    const jobA = this.abJobA();
    const jobB = this.abJobB();
    const terminal = (status: string) => status === 'succeeded' || status === 'failed' || status === 'cancelled';

    const requests: Record<string, any> = {};
    if (jobA && !terminal(jobA.status)) requests['a'] = this.adminCoupons.getBulkJob(jobA.id);
    if (jobB && !terminal(jobB.status)) requests['b'] = this.adminCoupons.getBulkJob(jobB.id);

    if (Object.keys(requests).length === 0) {
      this.stopAbPolling();
      return;
    }

    forkJoin(requests).subscribe({
      next: (data: any) => {
        if (data?.['a']) this.abJobA.set(data['a']);
        if (data?.['b']) this.abJobB.set(data['b']);
        const nextA = this.abJobA();
        const nextB = this.abJobB();
        if (nextA && nextB && terminal(nextA.status) && terminal(nextB.status)) {
          this.stopAbPolling();
          this.loadAssignments();
        }
      },
      error: () => this.stopAbPolling()
    });
  }

  private refreshSegmentJob(jobId: string): void {
    this.adminCoupons.getBulkJob(jobId).subscribe({
      next: (job) => {
        const prev = this.segmentJobLastStatus;
        this.segmentJobLastStatus = job.status;
        this.segmentJob.set(job);
        this.upsertSegmentJob(job);

        if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
          this.stopSegmentPolling();
        }
        if (prev && prev !== job.status && job.status === 'succeeded') {
          this.toast.success(this.t('adminUi.couponsV2.bulk.segment.completed'));
          this.loadAssignments();
        }
      },
      error: () => {
        this.stopSegmentPolling();
      }
    });
  }

  private upsertSegmentJob(job: CouponBulkJobRead, opts?: { promote?: boolean }): void {
    if (!job?.id) return;
    const list = this.segmentJobs();
    const idx = list.findIndex((j) => j.id === job.id);
    let next: CouponBulkJobRead[];
    if (idx === -1) {
      next = opts?.promote ? [job, ...list] : [...list, job];
    } else {
      next = list.map((j) => (j.id === job.id ? job : j));
      if (opts?.promote && idx > 0) {
        next = [job, ...next.filter((j) => j.id !== job.id)];
      }
    }
    this.segmentJobs.set(next.slice(0, 10));
  }

  private resetBulkState(): void {
    this.bulkEmails = [];
    this.bulkInvalid = [];
    this.bulkDuplicates = 0;
    this.bulkTruncated = 0;
    this.bulkParseError = '';
    this.bulkRevokeReason = '';
    this.bulkResult.set(null);
  }

  private resetSegmentState(): void {
    this.stopSegmentPolling();
    this.segmentPreviewAssign.set(null);
    this.segmentPreviewRevoke.set(null);
    this.segmentJob.set(null);
    this.segmentJobLastStatus = null;
    this.segmentRevokeReason = '';
    this.segmentJobsLoading.set(false);
    this.segmentJobsError.set(null);
    this.segmentJobs.set([]);
    this.segmentJobsBusy.set(false);
  }

  private resetAbState(): void {
    this.stopAbPolling();
    this.abCouponQuery = '';
    this.abCouponLoading.set(false);
    this.abCouponError.set(null);
    this.abCouponResults.set([]);
    this.abCouponB.set(null);
    this.abBucketSeed = '';
    this.abBusy.set(false);
    this.abJobA.set(null);
    this.abJobB.set(null);
    this.abAnalyticsLoading.set(false);
    this.abAnalyticsError.set(null);
    this.abAnalyticsA.set(null);
    this.abAnalyticsB.set(null);
  }

  private defaultAbBucketSeed(): string {
    const couponA = this.selectedCoupon()?.id || '';
    const couponB = this.abCouponB()?.id || '';
    if (!couponA || !couponB) return 'ab-test';
    return `ab:${couponA}:${couponB}`;
  }

  private parseEmailsFromCsv(text: string): { emails: string[]; invalid: string[]; duplicates: number; truncated: number } {
    const lines = (text || '').split(/\r?\n/);
    const emails: string[] = [];
    const invalid: string[] = [];
    const seen = new Set<string>();
    let duplicates = 0;

    for (let idx = 0; idx < lines.length; idx += 1) {
      const rawLine = (lines[idx] || '').trim();
      if (!rawLine) continue;
      const firstCell = rawLine.split(/[,;\t]/)[0] ?? '';
      const cell = firstCell.trim().replace(/^"|"$/g, '');
      if (!cell) continue;
      if (idx === 0 && cell.toLowerCase().includes('email')) continue;

      const email = cell.trim().toLowerCase();
      if (!this.isValidEmail(email)) {
        invalid.push(cell);
        continue;
      }
      if (seen.has(email)) {
        duplicates += 1;
        continue;
      }
      seen.add(email);
      emails.push(email);
    }

    const max = 500;
    const truncated = emails.length > max ? emails.length - max : 0;
    return { emails: emails.slice(0, max), invalid, duplicates, truncated };
  }

  private isValidEmail(email: string): boolean {
    const value = (email || '').trim();
    if (!value || value.length > 255) return false;
    const at = value.indexOf('@');
    if (at <= 0 || at === value.length - 1) return false;
    const domain = value.slice(at + 1);
    if (!domain.includes('.')) return false;
    return true;
  }
}
