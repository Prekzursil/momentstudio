import { CommonModule } from '@angular/common';
import { Component, EffectRef, OnDestroy, OnInit, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { CatalogService, Category, PaginationMeta, Product, SortOption } from '../../core/catalog.service';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { InputComponent } from '../../shared/input.component';
import { ProductCardComponent } from '../../shared/product-card.component';
import { ProductQuickViewModalComponent } from '../../shared/product-quick-view-modal.component';
import { AdminCategoryDeletePreview, AdminCategoryMergePreview, AdminService } from '../../core/admin.service';
import { StorefrontAdminModeService } from '../../core/storefront-admin-mode.service';
import { ToastService } from '../../core/toast.service';
import { PageHeaderComponent } from '../../shared/page-header.component';
import { InlineErrorCardComponent } from '../../shared/inline-error-card.component';
import { EmptyStateComponent } from '../../shared/empty-state.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription, combineLatest, forkJoin, map, switchMap } from 'rxjs';
import { Meta, Title } from '@angular/platform-browser';
import { SeoHeadLinksService } from '../../core/seo-head-links.service';
import { StructuredDataService } from '../../core/structured-data.service';
import { resolveRouteSeoDescription } from '../../core/route-seo-defaults';

type ShopFilterChipType = 'category' | 'subcategory' | 'price' | 'tag' | 'search';

interface ShopFilterChip {
  id: string;
  type: ShopFilterChipType;
  label: string;
  value?: string;
}

@Component({
  selector: 'app-shop',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ContainerComponent,
    ButtonComponent,
    InputComponent,
    ProductCardComponent,
    ProductQuickViewModalComponent,
    PageHeaderComponent,
    InlineErrorCardComponent,
    EmptyStateComponent,
    LoadingStateComponent,
    TranslateModule
  ],
  template: `
	    <app-container classes="pt-10 pb-24 lg:pb-10 grid gap-6">
      <app-page-header [crumbs]="crumbs" [titleKey]="'nav.shop'"></app-page-header>
      <div class="grid gap-8 lg:grid-cols-[280px_1fr]">
        <aside id="shop-filters" class="border border-slate-200 rounded-2xl p-4 bg-white h-fit space-y-6 scroll-mt-24 dark:border-slate-800 dark:bg-slate-900">
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'shop.filters' | translate }}</h2>
              <button class="text-sm text-indigo-600 font-medium dark:text-indigo-300" type="button" (click)="resetFilters()">
                {{ 'shop.reset' | translate }}
              </button>
            </div>
            <app-input
              [label]="'shop.search' | translate"
              [placeholder]="'shop.searchPlaceholder' | translate"
              [value]="filters.search"
              (valueChange)="onSidebarSearchChange($event)"
            >
            </app-input>
          </div>

		          <div class="space-y-3">
		            <div class="flex items-center justify-between gap-2">
		              <p class="text-sm font-semibold text-slate-800 dark:text-slate-200">{{ 'shop.categories' | translate }}</p>
		              <button
		                *ngIf="canEditCategories()"
		                type="button"
		                class="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
		                [disabled]="reorderSaving() || renameSaving || renameLoading || createSaving"
		                (click)="toggleCreateRootCategory()"
		              >
		                {{ isCreatingRootCategory() ? ('adminUi.common.cancel' | translate) : ('adminUi.storefront.categories.addRoot' | translate) }}
		              </button>
		            </div>
		            <p *ngIf="canEditCategories()" class="text-xs text-slate-500 dark:text-slate-400">
		              {{ 'adminUi.storefront.categories.dragHint' | translate }}
		            </p>
		            <div class="space-y-2 max-h-48 overflow-auto pr-1">
		              <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
		                <input
		                  type="radio"
	                  name="category"
	                  class="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
	                  value=""
	                  [(ngModel)]="categorySelection"
	                  (change)="onCategorySelected()"
	                />
	                <span>{{ 'shop.allCategories' | translate }}</span>
	              </label>
	              <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
	                <input
	                  type="radio"
	                  name="category"
	                  class="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
	                  value="sale"
	                  [(ngModel)]="categorySelection"
	                  (change)="onCategorySelected()"
	                />
	                <span>{{ 'shop.sale' | translate }}</span>
	              </label>
		              <div
		                *ngIf="isCreatingRootCategory()"
		                class="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
		              >
		                <app-input
		                  [label]="'adminUi.storefront.categories.nameRo' | translate"
		                  [value]="createNameRo"
		                  [disabled]="createSaving"
		                  (valueChange)="createNameRo = String($event ?? '')"
		                ></app-input>
		                <app-input
		                  [label]="'adminUi.storefront.categories.nameEn' | translate"
		                  [value]="createNameEn"
		                  [disabled]="createSaving"
		                  (valueChange)="createNameEn = String($event ?? '')"
		                ></app-input>
		                <p *ngIf="createError" class="text-xs text-rose-700 dark:text-rose-300">{{ createError }}</p>
		                <div class="flex flex-wrap justify-end gap-2">
		                  <app-button
		                    [label]="'adminUi.common.cancel' | translate"
		                    size="sm"
		                    variant="ghost"
		                    [disabled]="createSaving"
		                    (action)="cancelCreateCategory()"
		                  ></app-button>
		                  <app-button
		                    [label]="createSaving ? ('adminUi.common.saving' | translate) : ('adminUi.common.save' | translate)"
		                    size="sm"
		                    [disabled]="createSaving || !canSaveCreateCategory()"
		                    (action)="saveCreateCategory()"
		                  ></app-button>
		                </div>
		              </div>
		              <label
		                *ngFor="let category of rootCategories"
		                class="grid gap-2"
		                [ngClass]="dragOverRootCategorySlug === category.slug ? 'rounded-lg bg-slate-50 dark:bg-slate-800/60' : ''"
		                [attr.draggable]="canEditCategories() && editingCategorySlug !== category.slug && !isCreatingAnyCategory() ? 'true' : null"
		                (dragstart)="onRootCategoryDragStart($event, category.slug)"
		                (dragover)="onRootCategoryDragOver($event, category.slug)"
		                (drop)="onRootCategoryDrop($event, category.slug)"
		                (dragend)="onRootCategoryDragEnd()"
		              >
		                <span class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
		                  <span
		                    *ngIf="canEditCategories()"
		                    class="text-slate-400 dark:text-slate-500 select-none cursor-grab"
		                    aria-hidden="true"
		                  >
		                    ⋮⋮
		                  </span>
			                  <input
			                    type="radio"
			                    name="category"
			                    class="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
			                    [value]="category.slug"
			                    [(ngModel)]="categorySelection"
			                    (change)="onCategorySelected()"
			                  />
			                  <span class="truncate">{{ category.name }}</span>
			                  <span
			                    *ngIf="canEditCategories() && category.is_visible === false"
			                    class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-200"
			                  >
			                    {{ 'adminUi.storefront.categories.hidden' | translate }}
			                  </span>
			                  <div *ngIf="canEditCategories()" class="ml-auto flex items-center gap-2">
			                    <button
			                      type="button"
			                      class="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
			                      [disabled]="reorderSaving() || renameSaving || renameLoading || createSaving || visibilitySavingSlug === category.slug"
			                      (click)="toggleCategoryVisibility($event, category)"
			                    >
			                      {{
			                        visibilitySavingSlug === category.slug
			                          ? ('adminUi.common.saving' | translate)
			                          : (category.is_visible === false
			                            ? ('adminUi.storefront.categories.show' | translate)
			                            : ('adminUi.storefront.categories.hide' | translate))
			                      }}
			                    </button>
			                    <button
			                      type="button"
			                      class="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
			                      [disabled]="reorderSaving() || createSaving || visibilitySavingSlug === category.slug"
			                      (click)="startRenameCategory($event, category)"
			                    >
			                      {{ 'adminUi.common.edit' | translate }}
			                    </button>
			                  </div>
			                </span>

		                <div
		                  *ngIf="editingCategorySlug === category.slug"
		                  class="ml-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
		                  (click)="$event.stopPropagation()"
		                >
		                  <div *ngIf="renameLoading" class="text-xs text-slate-600 dark:text-slate-300">
		                    {{ 'adminUi.common.loading' | translate }}
		                  </div>

			                  <div *ngIf="!renameLoading" class="grid gap-3">
			                    <app-input
			                      [label]="'adminUi.storefront.categories.nameRo' | translate"
			                      [value]="renameNameRo"
			                      [disabled]="renameSaving"
			                      (valueChange)="renameNameRo = String($event ?? '')"
			                    ></app-input>
			                    <app-input
			                      [label]="'adminUi.storefront.categories.nameEn' | translate"
			                      [value]="renameNameEn"
			                      [disabled]="renameSaving"
			                      (valueChange)="renameNameEn = String($event ?? '')"
			                    ></app-input>
			                    <div class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/40">
			                      <p class="text-xs font-semibold text-slate-700 dark:text-slate-200">
			                        {{ 'adminUi.storefront.categories.images' | translate }}
			                      </p>
			                      <div class="grid gap-3">
			                        <div class="grid gap-2">
			                          <p class="text-xs font-semibold text-slate-600 dark:text-slate-300">
			                            {{ 'adminUi.storefront.categories.thumbnail' | translate }}
			                          </p>
			                          <div class="flex items-center gap-3">
			                            <img
			                              *ngIf="category.thumbnail_url"
			                              [src]="category.thumbnail_url"
			                              class="h-12 w-12 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
			                              [alt]="category.name"
			                            />
			                            <input
			                              type="file"
			                              accept="image/*"
			                              class="block w-full text-xs text-slate-700 file:mr-3 file:rounded-full file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-800 dark:text-slate-200 dark:file:bg-slate-50 dark:file:text-slate-900 dark:hover:file:bg-white"
			                              [disabled]="renameSaving || createSaving || categoryImageSavingSlug === category.slug"
			                              (change)="onCategoryImageSelected($event, category.slug, 'thumbnail')"
			                            />
			                          </div>
			                        </div>
			                        <div class="grid gap-2">
			                          <p class="text-xs font-semibold text-slate-600 dark:text-slate-300">
			                            {{ 'adminUi.storefront.categories.banner' | translate }}
			                          </p>
			                          <input
			                            type="file"
			                            accept="image/*"
			                            class="block w-full text-xs text-slate-700 file:mr-3 file:rounded-full file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-slate-800 dark:text-slate-200 dark:file:bg-slate-50 dark:file:text-slate-900 dark:hover:file:bg-white"
			                            [disabled]="renameSaving || createSaving || categoryImageSavingSlug === category.slug"
			                            (change)="onCategoryImageSelected($event, category.slug, 'banner')"
			                          />
			                          <p *ngIf="category.banner_url" class="text-xs text-slate-600 dark:text-slate-300">
			                            {{ 'adminUi.storefront.categories.currentBanner' | translate }}
			                          </p>
			                        </div>
			                      </div>
			                      <p *ngIf="categoryImageError" class="text-xs text-rose-700 dark:text-rose-300">{{ categoryImageError }}</p>
			                    </div>
			                    <p *ngIf="renameError" class="text-xs text-rose-700 dark:text-rose-300">{{ renameError }}</p>
			                    <div class="flex flex-wrap justify-end gap-2">
		                      <app-button
		                        [label]="'adminUi.common.cancel' | translate"
		                        size="sm"
		                        variant="ghost"
		                        [disabled]="renameSaving"
		                        (action)="cancelRenameCategory()"
		                      ></app-button>
			                      <app-button
			                        [label]="renameSaving ? ('adminUi.common.saving' | translate) : ('adminUi.common.save' | translate)"
			                        size="sm"
			                        [disabled]="renameSaving || !canSaveRename()"
			                        (action)="saveRenameCategory()"
			                      ></app-button>
			                    </div>
			                    <div class="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
			                      <p class="text-xs font-semibold text-slate-800 dark:text-slate-100">
			                        {{ 'adminUi.storefront.categories.mergeTitle' | translate }}
			                      </p>
			                      <label class="grid gap-1">
			                        <span class="text-xs font-semibold text-slate-600 dark:text-slate-300">
			                          {{ 'adminUi.storefront.categories.mergeInto' | translate }}
			                        </span>
			                        <select
			                          class="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
			                          [(ngModel)]="mergeTargetSlug"
			                          (ngModelChange)="onMergeTargetChange()"
			                          [disabled]="mergePreviewLoading || mergeSaving || deletePreviewLoading || deleteSaving"
			                        >
			                          <option value="">{{ 'adminUi.storefront.categories.mergeSelectPlaceholder' | translate }}</option>
			                          <option
			                            *ngFor="let target of rootCategories"
			                            [value]="target.slug"
			                            [disabled]="target.slug === category.slug"
			                          >
			                            {{ target.name }}
			                          </option>
			                        </select>
			                      </label>
			                      <p *ngIf="mergePreview" class="text-xs text-slate-600 dark:text-slate-300">
			                        {{
			                          'adminUi.storefront.categories.mergePreviewInfo'
			                            | translate : { products: mergePreview.product_count, children: mergePreview.child_count }
			                        }}
			                      </p>
			                      <p *ngIf="mergeError" class="text-xs text-rose-700 dark:text-rose-300">{{ mergeError }}</p>
			                      <div class="flex flex-wrap justify-end gap-2">
			                        <app-button
			                          [label]="mergePreviewLoading ? ('adminUi.common.loading' | translate) : ('adminUi.storefront.categories.mergePreview' | translate)"
			                          size="sm"
			                          variant="ghost"
			                          [disabled]="mergePreviewLoading || mergeSaving || !mergeTargetSlug"
			                          (action)="previewCategoryMerge(category)"
			                        ></app-button>
			                        <app-button
			                          [label]="mergeSaving ? ('adminUi.common.saving' | translate) : ('adminUi.storefront.categories.mergeAction' | translate)"
			                          size="sm"
			                          [disabled]="mergeSaving || !mergePreview?.can_merge"
			                          (action)="mergeCategory(category)"
			                        ></app-button>
			                      </div>
			                    </div>
			                    <div class="grid gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/40 dark:bg-rose-950/30">
			                      <p class="text-xs font-semibold text-rose-900 dark:text-rose-100">
			                        {{ 'adminUi.storefront.categories.deleteTitle' | translate }}
			                      </p>
			                      <p *ngIf="deletePreview" class="text-xs text-rose-800 dark:text-rose-200">
			                        {{
			                          'adminUi.storefront.categories.deletePreviewInfo'
			                            | translate : { products: deletePreview.product_count, children: deletePreview.child_count }
			                        }}
			                      </p>
			                      <p *ngIf="deleteError" class="text-xs text-rose-800 dark:text-rose-200">{{ deleteError }}</p>
			                      <div class="flex flex-wrap justify-end gap-2">
			                        <app-button
			                          [label]="deletePreviewLoading ? ('adminUi.common.loading' | translate) : ('adminUi.storefront.categories.deletePreview' | translate)"
			                          size="sm"
			                          variant="ghost"
			                          [disabled]="deletePreviewLoading || deleteSaving"
			                          (action)="previewCategoryDelete(category)"
			                        ></app-button>
			                        <app-button
			                          [label]="deleteSaving ? ('adminUi.common.saving' | translate) : ('adminUi.storefront.categories.deleteAction' | translate)"
			                          size="sm"
			                          [disabled]="deleteSaving || !deletePreview?.can_delete"
			                          (action)="deleteCategorySafe(category)"
			                        ></app-button>
			                      </div>
			                    </div>
			                  </div>
			                </div>
		                <div
		                  *ngIf="categorySelection === category.slug && (getSubcategories(category).length || canEditCategories())"
		                  class="ml-6 grid gap-2"
		                >
		                  <div class="flex items-center justify-between gap-2">
		                    <p class="text-xs font-semibold text-slate-600 dark:text-slate-300">{{ 'shop.subcategories' | translate }}</p>
		                    <button
		                      *ngIf="canEditCategories()"
		                      type="button"
		                      class="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
		                      [disabled]="reorderSaving() || renameSaving || renameLoading || createSaving"
		                      (click)="toggleCreateSubcategory($event, category)"
		                    >
		                      {{ isCreatingSubcategory(category.slug) ? ('adminUi.common.cancel' | translate) : ('adminUi.storefront.categories.addSub' | translate) }}
		                    </button>
		                  </div>
		                  <div
		                    *ngIf="isCreatingSubcategory(category.slug)"
		                    class="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
		                    (click)="$event.stopPropagation()"
		                  >
		                    <app-input
		                      [label]="'adminUi.storefront.categories.nameRo' | translate"
		                      [value]="createNameRo"
		                      [disabled]="createSaving"
		                      (valueChange)="createNameRo = String($event ?? '')"
		                    ></app-input>
		                    <app-input
		                      [label]="'adminUi.storefront.categories.nameEn' | translate"
		                      [value]="createNameEn"
		                      [disabled]="createSaving"
		                      (valueChange)="createNameEn = String($event ?? '')"
		                    ></app-input>
		                    <p *ngIf="createError" class="text-xs text-rose-700 dark:text-rose-300">{{ createError }}</p>
		                    <div class="flex flex-wrap justify-end gap-2">
		                      <app-button
		                        [label]="'adminUi.common.cancel' | translate"
		                        size="sm"
		                        variant="ghost"
		                        [disabled]="createSaving"
		                        (action)="cancelCreateCategory()"
		                      ></app-button>
		                      <app-button
		                        [label]="createSaving ? ('adminUi.common.saving' | translate) : ('adminUi.common.save' | translate)"
		                        size="sm"
		                        [disabled]="createSaving || !canSaveCreateCategory()"
		                        (action)="saveCreateCategory()"
		                      ></app-button>
		                    </div>
		                  </div>
		                  <div *ngIf="getSubcategories(category).length" class="flex flex-wrap gap-2">
		                    <button
		                      type="button"
		                      class="rounded-full border px-3 py-1 text-xs font-medium transition"
		                      [ngClass]="!activeSubcategorySlug ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-50 dark:text-slate-900 dark:border-slate-50' : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-slate-50'"
		                      (click)="setSubcategory('')"
		                    >
		                      {{ 'shop.all' | translate }}
		                    </button>
		                    <button
		                      *ngFor="let sub of getSubcategories(category)"
		                      type="button"
		                      class="rounded-full border px-3 py-1 text-xs font-medium transition"
		                      [ngClass]="activeSubcategorySlug === sub.slug ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-50 dark:text-slate-900 dark:border-slate-50' : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-slate-50'"
		                      (click)="setSubcategory(sub.slug)"
		                    >
		                      {{ sub.name }}
		                    </button>
		                  </div>
		                </div>
		              </label>
		            </div>
		          </div>

          <div class="space-y-3">
            <p class="text-sm font-semibold text-slate-800 dark:text-slate-200">{{ 'shop.priceRange' | translate }}</p>
            <div class="grid gap-3">
              <p id="shop-price-status" class="sr-only">
                {{ 'shop.priceRangeStatus' | translate : { min: filters.min_price, max: filters.max_price } }}
              </p>
              <div class="grid gap-2 overflow-hidden">
                <input
                  type="range"
                  [min]="priceMinBound"
                  [max]="priceMaxBound"
                  [step]="priceStep"
                  class="block w-full max-w-full accent-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  [(ngModel)]="filters.min_price"
                  (change)="onPriceCommit('min')"
                  [attr.aria-label]="'shop.ariaMinPrice' | translate"
                  aria-describedby="shop-price-status shop-price-hint"
                  [attr.aria-valuetext]="filters.min_price + ' RON'"
                />
                <input
                  type="range"
                  [min]="priceMinBound"
                  [max]="priceMaxBound"
                  [step]="priceStep"
                  class="block w-full max-w-full accent-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  [(ngModel)]="filters.max_price"
                  (change)="onPriceCommit('max')"
                  [attr.aria-label]="'shop.ariaMaxPrice' | translate"
                  aria-describedby="shop-price-status shop-price-hint"
                  [attr.aria-valuetext]="filters.max_price + ' RON'"
                />
              </div>
              <div class="grid grid-cols-2 gap-3">
                <app-input
                  [label]="'shop.min' | translate"
                  type="number"
                  [value]="filters.min_price"
                  (valueChange)="onPriceTextChange('min', $event)"
                  [min]="priceMinBound"
                  [max]="priceMaxBound"
                  [step]="priceStep"
                  inputMode="numeric"
                ></app-input>
                <app-input
                  [label]="'shop.max' | translate"
                  type="number"
                  [value]="filters.max_price"
                  (valueChange)="onPriceTextChange('max', $event)"
                  [min]="priceMinBound"
                  [max]="priceMaxBound"
                  [step]="priceStep"
                  inputMode="numeric"
                ></app-input>
              </div>
              <p id="shop-price-hint" class="text-xs text-slate-500 dark:text-slate-400">
                {{ 'shop.priceHint' | translate }}
              </p>
            </div>
          </div>

          <div class="space-y-3" *ngIf="allTags.length">
            <p class="text-sm font-semibold text-slate-800 dark:text-slate-200">{{ 'shop.tags' | translate }}</p>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="rounded-full border px-3 py-1 text-xs font-medium transition"
                [ngClass]="filters.tags.has(tag.slug) ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-50 dark:text-slate-900 dark:border-slate-50' : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-slate-50'"
                *ngFor="let tag of allTags"
                (click)="toggleTag(tag.slug)"
              >
                {{ tag.name }}
              </button>
            </div>
          </div>
        </aside>

        <section class="grid gap-6">
          <div id="shop-actions" class="flex flex-col sm:flex-row sm:items-center gap-3 justify-between scroll-mt-24">
            <div class="flex items-center gap-3">
              <input
                class="w-64 max-w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                [placeholder]="'shop.searchPlaceholder' | translate"
                [(ngModel)]="filters.search"
                (keyup.enter)="onSearch()"
              />
              <app-button [label]="'shop.search' | translate" size="sm" (action)="onSearch()"></app-button>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-3">
              <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <span>{{ 'shop.sort' | translate }}</span>
                <select
                  id="shop-sort-select"
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="filters.sort"
                  (change)="applyFilters()"
                >
                  <option *ngFor="let option of sortOptions" [value]="option.value">{{ option.label | translate }}</option>
                </select>
              </label>
              <button
                *ngIf="canEditProducts()"
                type="button"
                class="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                [disabled]="bulkSaving()"
                (click)="toggleBulkSelectMode()"
              >
                {{ bulkSelectMode() ? ('adminUi.storefront.products.bulkDone' | translate) : ('adminUi.storefront.products.bulkSelect' | translate) }}
              </button>
            </div>
          </div>

          <div class="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <ng-container *ngIf="filterChips() as chips">
              <div *ngIf="chips.length" class="flex flex-wrap items-center gap-2">
                <p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  {{ 'shop.activeFilters' | translate }}
                </p>
                <button
                  *ngFor="let chip of chips; trackBy: trackChip"
                  type="button"
                  class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-800 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800"
                  (click)="removeChip(chip)"
                  [attr.aria-label]="'shop.removeFilter' | translate : { filter: chip.label }"
                >
                  <span>{{ chip.label }}</span>
                  <span aria-hidden="true" class="text-slate-500 dark:text-slate-400">×</span>
                </button>
                <button
                  type="button"
                  class="ml-1 text-xs font-semibold text-indigo-700 hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-indigo-200"
                  (click)="resetFilters()"
                >
                  {{ 'shop.clearAll' | translate }}
                </button>
              </div>
            </ng-container>

            <div *ngIf="!loading() && !hasError() && resultsMetaParams() as meta" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'shop.resultsMeta' | translate : meta }}
            </div>
          </div>

          <div
            *ngIf="canEditProducts() && bulkSelectMode()"
            class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div class="flex flex-wrap items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <span class="font-semibold">{{ 'adminUi.products.bulk.selected' | translate : { count: bulkSelectedCount() } }}</span>
                <button
                  type="button"
                  class="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  [disabled]="bulkSaving() || products.length === 0"
                  (click)="selectAllProductsOnPage()"
                >
                  {{ 'adminUi.storefront.products.bulkSelectPage' | translate }}
                </button>
                <button
                  type="button"
                  class="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  [disabled]="bulkSaving() || bulkSelectedCount() === 0"
                  (click)="clearBulkSelection()"
                >
                  {{ 'adminUi.storefront.products.bulkClear' | translate }}
                </button>
              </div>
              <app-button
                [label]="'adminUi.storefront.products.bulkApply' | translate"
                size="sm"
                [disabled]="bulkSaving() || bulkSelectedCount() === 0 || !bulkHasPendingEdits()"
                (action)="applyBulkProductEdits()"
              ></app-button>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label class="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <span>{{ 'adminUi.storefront.products.bulkStatus' | translate }}</span>
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [disabled]="bulkSaving()"
                  [(ngModel)]="bulkStatus"
                >
                  <option value="">{{ 'adminUi.storefront.products.bulkStatusPlaceholder' | translate }}</option>
                  <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
                  <option value="published">{{ 'adminUi.status.published' | translate }}</option>
                  <option value="archived">{{ 'adminUi.status.archived' | translate }}</option>
                </select>
              </label>

              <label class="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <span>{{ 'adminUi.storefront.products.bulkCategory' | translate }}</span>
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [disabled]="bulkSaving()"
                  [(ngModel)]="bulkCategoryId"
                >
                  <option value="">{{ 'adminUi.storefront.products.bulkCategoryPlaceholder' | translate }}</option>
                  <option *ngFor="let category of bulkCategoryOptions()" [value]="category.id">
                    {{ bulkCategoryLabel(category) }}
                  </option>
                </select>
              </label>

              <label class="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                <span>{{ 'adminUi.storefront.products.bulkFeatured' | translate }}</span>
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [disabled]="bulkSaving()"
                  [(ngModel)]="bulkFeatured"
                >
                  <option value="">{{ 'adminUi.storefront.products.bulkFeaturedPlaceholder' | translate }}</option>
                  <option value="true">{{ 'adminUi.storefront.products.bulkFeaturedOn' | translate }}</option>
                  <option value="false">{{ 'adminUi.storefront.products.bulkFeaturedOff' | translate }}</option>
                </select>
              </label>
            </div>

            <p *ngIf="bulkEditError" class="text-xs text-rose-700 dark:text-rose-300">{{ bulkEditError }}</p>
          </div>

          <p *ngIf="canReorderProducts()" class="text-xs text-slate-500 dark:text-slate-400">
            {{ 'adminUi.storefront.products.reorderHint' | translate }}
          </p>

          <app-loading-state *ngIf="loading()" [rows]="3"></app-loading-state>

          <div *ngIf="hasError()" class="grid gap-3">
            <app-inline-error-card
              [titleKey]="'shop.errorTitle'"
              [messageKey]="'shop.errorCopy'"
              [retryLabelKey]="'shop.retry'"
              [showContact]="false"
              [backToUrl]="null"
              (retry)="loadProducts()"
            ></app-inline-error-card>
            <div class="flex justify-center">
              <app-button [label]="'shop.reset' | translate" size="sm" variant="ghost" (action)="resetFilters()"></app-button>
            </div>
          </div>

          <div *ngIf="!loading() && !hasError() && products.length === 0" class="grid gap-4">
            <app-empty-state
              icon="🧭"
              [titleKey]="'shop.noResults'"
              [copyKey]="'shop.tryAdjust'"
              [primaryActionLabelKey]="'shop.reset'"
              [secondaryActionLabelKey]="'shop.backHome'"
              [secondaryActionUrl]="'/'"
              (primaryAction)="resetFilters()"
            ></app-empty-state>
            <div *ngIf="rootCategories.length" class="mt-1 grid gap-2">
              <p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                {{ 'shop.suggestedCategories' | translate }}
              </p>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-800 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800"
                  (click)="quickSelectCategory('sale')"
                >
                  {{ 'shop.sale' | translate }}
                </button>
                <button
                  *ngFor="let category of rootCategories"
                  type="button"
                  class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-800 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800"
                  (click)="quickSelectCategory(category.slug)"
                >
                  {{ category.name }}
                </button>
              </div>
            </div>
          </div>

          <div *ngIf="!loading() && products.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div
              *ngFor="let product of products"
              class="relative"
              [ngClass]="{
                'cursor-move': canReorderProducts(),
                'ring-2 ring-indigo-400 rounded-2xl': dragOverProductId === product.id
              }"
              [attr.draggable]="canReorderProducts() ? 'true' : null"
              (dragstart)="onProductDragStart($event, product.id)"
              (dragover)="onProductDragOver($event, product.id)"
              (drop)="onProductDrop($event, product.id)"
              (dragend)="onProductDragEnd()"
            >
              <input
                *ngIf="bulkSelectMode()"
                type="checkbox"
                class="absolute left-3 top-3 z-20 h-5 w-5 rounded border-slate-300 bg-white/90 shadow-sm accent-indigo-600 dark:border-slate-600 dark:bg-slate-900/80"
                [checked]="bulkIsSelected(product.id)"
                [disabled]="bulkSaving()"
                [attr.aria-label]="'adminUi.products.table.select' | translate"
                (click)="$event.stopPropagation()"
                (change)="toggleBulkSelected($event, product.id)"
              />
	              <app-product-card
	                [product]="product"
	                [rememberShopReturn]="true"
	                [showQuickView]="true"
	                [quickViewOnCardClick]="!canReorderProducts()"
	                [showAddToCart]="true"
	                [showPin]="canReorderProducts()"
	                (quickView)="openQuickView($event)"
	                (pinToTop)="pinProductToTop($event)"
	              ></app-product-card>
            </div>
          </div>

          <div *ngIf="pageMeta" class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm text-slate-700 dark:text-slate-300">
            <div class="flex flex-wrap items-center gap-3">
              <div class="inline-flex items-center overflow-hidden rounded-full border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                <button
                  type="button"
                  class="px-3 py-2 text-xs font-semibold transition"
                  [ngClass]="paginationMode === 'pages' ? 'bg-slate-900 text-white dark:bg-slate-50 dark:text-slate-900' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'"
                  (click)="setPaginationMode('pages')"
                  [attr.aria-pressed]="paginationMode === 'pages'"
                >
                  {{ 'shop.paginationPages' | translate }}
                </button>
                <button
                  type="button"
                  class="px-3 py-2 text-xs font-semibold transition"
                  [ngClass]="paginationMode === 'load_more' ? 'bg-slate-900 text-white dark:bg-slate-50 dark:text-slate-900' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'"
                  (click)="setPaginationMode('load_more')"
                  [attr.aria-pressed]="paginationMode === 'load_more'"
                >
                  {{ 'shop.loadMore' | translate }}
                </button>
              </div>

              <div *ngIf="paginationMode === 'pages'">
                {{ 'shop.pageMeta' | translate : { page: pageMeta.page, totalPages: pageMeta.total_pages, totalItems: pageMeta.total_items } }}
              </div>
              <div *ngIf="paginationMode === 'load_more'">
                {{ 'shop.loadedCount' | translate : { shown: products.length, total: pageMeta.total_items } }}
              </div>
            </div>

            <div *ngIf="paginationMode === 'pages'" class="flex gap-2">
              <app-button
                [label]="'shop.prev' | translate"
                size="sm"
                variant="ghost"
                [disabled]="pageMeta.page <= 1"
                (action)="changePage(-1)"
              >
              </app-button>
              <app-button
                [label]="'shop.next' | translate"
                size="sm"
                variant="ghost"
                [disabled]="pageMeta.page >= pageMeta.total_pages"
                (action)="changePage(1)"
              >
              </app-button>
            </div>

            <div *ngIf="paginationMode === 'load_more'" class="flex">
              <button
                type="button"
                class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:hover:bg-slate-800"
                [disabled]="loadingMore() || pageMeta.page >= pageMeta.total_pages"
                (click)="loadMore()"
              >
                {{ loadingMore() ? ('shop.loadingMore' | translate) : ('shop.loadMore' | translate) }}
              </button>
            </div>
          </div>
	        </section>
	      </div>
	    </app-container>

	    <div class="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80 lg:hidden">
	      <div class="mx-auto max-w-6xl px-4 sm:px-6 py-3 grid grid-cols-2 gap-3">
	        <button
	          type="button"
	          class="h-11 w-full rounded-full bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-white"
	          (click)="scrollToFilters()"
	        >
	          {{ 'shop.filters' | translate }}
	        </button>
	        <button
	          type="button"
	          class="h-11 w-full rounded-full border border-slate-200 bg-white text-slate-900 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:hover:bg-slate-800"
	          (click)="scrollToSort()"
	        >
	          {{ 'shop.sort' | translate }}
	        </button>
	      </div>
	    </div>

	    <app-product-quick-view-modal
	      [open]="quickViewOpen"
	      [slug]="quickViewSlug"
	      (closed)="closeQuickView()"
      (view)="viewProduct($event)"
    ></app-product-quick-view-modal>
  `
})
export class ShopComponent implements OnInit, OnDestroy {
  products: Product[] = [];
  categories: Category[] = [];
  pageMeta: PaginationMeta | null = null;
  allTags: { slug: string; name: string }[] = [];
  loading = signal<boolean>(true);
  hasError = signal<boolean>(false);
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.shop' }
  ];

	  filters: {
	    search: string;
	    min_price: number;
	    max_price: number;
	    tags: Set<string>;
	    sort: SortOption;
	    page: number;
	    limit: number;
	  } = {
	    search: '',
	    min_price: 1,
	    max_price: 500,
	    tags: new Set<string>(),
	    sort: 'recommended',
    page: 1,
    limit: 12
  };

  categorySelection = '';
  activeCategorySlug = '';
  activeSubcategorySlug = '';
  rootCategories: Category[] = [];
  private readonly categoriesBySlug = new Map<string, Category>();
  private readonly categoriesById = new Map<string, Category>();
  private readonly childrenByParentId = new Map<string, Category[]>();

  readonly priceMinBound = 1;
  priceMaxBound = 500;
  readonly priceStep = 1;
  private filterDebounce?: ReturnType<typeof setTimeout>;
  private readonly filterDebounceMs = 350;
  private suppressNextUrlSync = false;
  private restoreScrollY: number | null = null;

  quickViewOpen = false;
  quickViewSlug = '';
  paginationMode: 'pages' | 'load_more' = 'pages';
  loadingMore = signal<boolean>(false);

  draggingRootCategorySlug: string | null = null;
  dragOverRootCategorySlug: string | null = null;
  reorderSaving = signal<boolean>(false);

  editingCategorySlug = '';
  renameLoading = false;
  renameSaving = false;
	  renameNameRo = '';
	  renameNameEn = '';
	  renameError = '';

	  creatingCategoryParentSlug: string | null = null;
		  createSaving = false;
		  createNameRo = '';
		  createNameEn = '';
		  createError = '';

	  visibilitySavingSlug: string | null = null;
	  categoryImageSavingSlug: string | null = null;
	  categoryImageError = '';

	  mergeTargetSlug = '';
	  mergePreviewLoading = false;
	  mergePreview: AdminCategoryMergePreview | null = null;
	  mergeSaving = false;
	  mergeError = '';

  deletePreviewLoading = false;
  deletePreview: AdminCategoryDeletePreview | null = null;
  deleteSaving = false;
  deleteError = '';

  bulkSelectMode = signal<boolean>(false);
  bulkSaving = signal<boolean>(false);
  bulkSelectedProductIds = signal<Set<string>>(new Set());
  readonly bulkSelectedCount = computed(() => this.bulkSelectedProductIds().size);
  bulkStatus = '';
  bulkCategoryId = '';
  bulkFeatured = '';
  bulkEditError = '';
  draggingProductId: string | null = null;
  dragOverProductId: string | null = null;
  productReorderSaving = signal<boolean>(false);
  private productsLoadSeq = 0;

  readonly sortOptions: { label: string; value: SortOption }[] = [
    { label: 'shop.sortRecommended', value: 'recommended' },
    { label: 'shop.sortNew', value: 'newest' },
    { label: 'shop.sortPriceAsc', value: 'price_asc' },
    { label: 'shop.sortPriceDesc', value: 'price_desc' },
    { label: 'shop.sortNameAsc', value: 'name_asc' },
    { label: 'shop.sortNameDesc', value: 'name_desc' }
  ];

	  private langSub?: Subscription;
	  private readonly storefrontEditModeEffect?: EffectRef;
	  private lastStorefrontEditMode: boolean | null = null;

  constructor(
    private readonly catalog: CatalogService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly admin: AdminService,
    private readonly storefrontAdminMode: StorefrontAdminModeService,
    private readonly toast: ToastService,
    private readonly translate: TranslateService,
    private readonly title: Title,
    private readonly metaService: Meta,
    private readonly seoHeadLinks: SeoHeadLinksService,
    private readonly structuredData: StructuredDataService
  ) {
    this.storefrontEditModeEffect = effect(() => {
      const enabled = this.storefrontAdminMode.enabled();
      if (this.lastStorefrontEditMode === null) {
        this.lastStorefrontEditMode = enabled;
        return;
      }
      if (this.lastStorefrontEditMode === enabled) return;
      this.lastStorefrontEditMode = enabled;
      if (!enabled) {
        this.bulkSelectMode.set(false);
        this.resetBulkEdits();
        this.clearBulkSelection();
        this.bulkEditError = '';
      }
      this.cancelCreateCategory();
      this.cancelRenameCategory();
      this.fetchCategories();
    });
  }

	  ngOnInit(): void {
	    this.setMetaTags();
	    this.langSub = this.translate.onLangChange.subscribe(() => {
	      this.setMetaTags();
	      this.cancelCreateCategory();
	      this.cancelRenameCategory();
	      this.fetchCategories();
	      this.loadProducts(false);
	    });
	    this.initScrollRestoreFromSession();
	    const dataCategories: Category[] = this.route.snapshot.data['categories'] ?? [];
    if (dataCategories.length) {
      this.categories = dataCategories;
      this.rebuildCategoryTree();
    } else {
      this.fetchCategories();
    }
    combineLatest([this.route.paramMap, this.route.queryParams]).subscribe(([paramMap, params]) => {
      if (this.suppressNextUrlSync) {
        this.suppressNextUrlSync = false;
        return;
      }
      const canonicalize = this.syncStateFromUrl(paramMap.get('category'), params);
      if (canonicalize) {
        this.loadProducts(true, true);
        return;
      }
      this.loadProducts(false);
    });
  }

	  ngOnDestroy(): void {
	    this.langSub?.unsubscribe();
	    this.storefrontEditModeEffect?.destroy();
	    this.cancelFilterDebounce();
      this.structuredData.clearRouteSchemas();
	  }

  openQuickView(slug: string): void {
    const desired = String(slug || '').trim();
    if (!desired) return;
    this.quickViewSlug = desired;
    this.quickViewOpen = true;
  }

  closeQuickView(): void {
    this.quickViewOpen = false;
    this.quickViewSlug = '';
  }

  viewProduct(slug: string): void {
    const desired = String(slug || '').trim();
    if (!desired) return;
    this.rememberShopReturnContext();
    this.closeQuickView();
    void this.router.navigate(['/products', desired]);
  }

  canEditCategories(): boolean {
    return this.storefrontAdminMode.enabled();
  }

  canEditProducts(): boolean {
    return this.storefrontAdminMode.enabled();
  }

  private activeLeafCategorySlug(): string | null {
    if (!this.activeCategorySlug || this.activeCategorySlug === 'sale') return null;
    if (this.activeSubcategorySlug) return this.activeSubcategorySlug;
    const category = this.categoriesBySlug.get(this.activeCategorySlug);
    if (!category) return null;
    const children = this.getSubcategories(category);
    if (children.length) return null;
    return this.activeCategorySlug;
  }

  canReorderProducts(): boolean {
    if (!this.canEditProducts()) return false;
    if (this.bulkSelectMode()) return false;
    if (this.productReorderSaving()) return false;
    if (this.loading() || this.hasError()) return false;
    if (this.filters.sort !== 'recommended') return false;
    const leaf = this.activeLeafCategorySlug();
    if (!leaf) return false;
    const meta = this.pageMeta;
    if (!meta) return false;
    const totalPages = Number(meta.total_pages ?? 1);
    const page = Number(meta.page ?? 1);
    const totalItems = Number(meta.total_items ?? 0);
    if (!Number.isFinite(totalPages) || totalPages < 1) return false;
    if (!Number.isFinite(page) || page < 1) return false;
    if (!Number.isFinite(totalItems) || totalItems < 0) return false;
    const loadedAll =
      totalPages === 1 || (this.paginationMode === 'load_more' && page >= totalPages && this.products.length >= totalItems);
    if (!loadedAll) return false;
    return this.products.length > 1;
  }

  onProductDragStart(event: DragEvent, productId: string): void {
    if (!this.canReorderProducts()) return;
    const desired = String(productId || '').trim();
    if (!desired) return;
    this.draggingProductId = desired;
    this.dragOverProductId = null;
    try {
      event.dataTransfer?.setData('text/plain', desired);
      event.dataTransfer!.effectAllowed = 'move';
    } catch {
      // ignore
    }
  }

  onProductDragOver(event: DragEvent, productId: string): void {
    if (!this.canReorderProducts()) return;
    if (!this.draggingProductId) return;
    const over = String(productId || '').trim();
    if (!over || over === this.draggingProductId) return;
    event.preventDefault();
    this.dragOverProductId = over;
    try {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    } catch {
      // ignore
    }
  }

  onProductDrop(event: DragEvent, productId: string): void {
    if (!this.canReorderProducts()) return;
    const from = this.draggingProductId;
    if (!from) return;
    if (this.productReorderSaving()) return;
    const to = String(productId || '').trim();
    if (!to || to === from) return;
    event.preventDefault();

    const previous = this.products.map((p) => p.id);
    const moved = this.reorderProducts(from, to);
    if (!moved) return;
    const updates = this.products
      .map((p, index) => ({ product_id: p.id, sort_order: index }))
      .filter((row) => Boolean(row.product_id));
    if (!updates.length) return;

    this.productReorderSaving.set(true);
    this.admin.bulkUpdateProducts(updates, { source: 'storefront' }).subscribe({
      next: () => {
        this.productReorderSaving.set(false);
        this.draggingProductId = null;
        this.dragOverProductId = null;
        const current = this.products.map((p) => p.id);
        this.toast.action(
          this.translate.instant('adminUi.storefront.products.reorderSuccess'),
          this.translate.instant('adminUi.common.undo'),
          () => this.undoProductOrder(previous, current),
          { tone: 'success' }
        );
      },
      error: () => {
        this.productReorderSaving.set(false);
        this.draggingProductId = null;
        this.dragOverProductId = null;
        this.restoreProductOrder(previous);
        this.toast.error(this.translate.instant('adminUi.storefront.products.reorderError'));
      }
    });
  }

  pinProductToTop(productId: string): void {
    if (!this.canReorderProducts()) return;
    if (this.productReorderSaving()) return;
    const desired = String(productId || '').trim();
    if (!desired) return;
    const firstId = this.products?.[0]?.id;
    if (!firstId || desired === firstId) return;

    const previous = this.products.map((p) => p.id);
    const moved = this.reorderProducts(desired, firstId);
    if (!moved) return;
    const updates = this.products
      .map((p, index) => ({ product_id: p.id, sort_order: index }))
      .filter((row) => Boolean(row.product_id));
    if (!updates.length) return;

    this.productReorderSaving.set(true);
    this.admin.bulkUpdateProducts(updates, { source: 'storefront' }).subscribe({
      next: () => {
        this.productReorderSaving.set(false);
        const current = this.products.map((p) => p.id);
        this.toast.action(
          this.translate.instant('adminUi.storefront.products.reorderSuccess'),
          this.translate.instant('adminUi.common.undo'),
          () => this.undoProductOrder(previous, current),
          { tone: 'success' }
        );
      },
      error: () => {
        this.productReorderSaving.set(false);
        this.restoreProductOrder(previous);
        this.toast.error(this.translate.instant('adminUi.storefront.products.reorderError'));
      }
    });
  }

  onProductDragEnd(): void {
    this.draggingProductId = null;
    this.dragOverProductId = null;
  }

  private reorderProducts(fromId: string, toId: string): boolean {
    const fromIndex = this.products.findIndex((p) => p.id === fromId);
    const toIndex = this.products.findIndex((p) => p.id === toId);
    if (fromIndex < 0 || toIndex < 0) return false;
    if (fromIndex === toIndex) return false;
    const next = [...this.products];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    this.products = next;
    return true;
  }

  private restoreProductOrder(previousIds: string[]): void {
    if (!previousIds.length) return;
    const byId = new Map(this.products.map((p) => [p.id, p] as const));
    const ordered: Product[] = [];
    for (const id of previousIds) {
      const item = byId.get(id);
      if (item) ordered.push(item);
    }
    if (ordered.length) this.products = ordered;
  }

  toggleBulkSelectMode(): void {
    if (!this.canEditProducts()) return;
    const next = !this.bulkSelectMode();
    this.bulkSelectMode.set(next);
    this.bulkEditError = '';
    if (!next) {
      this.resetBulkEdits();
      this.clearBulkSelection();
    }
  }

  bulkHasPendingEdits(): boolean {
    return Boolean((this.bulkStatus || '').trim() || (this.bulkCategoryId || '').trim() || String(this.bulkFeatured || '').trim());
  }

  bulkIsSelected(productId: string): boolean {
    return this.bulkSelectedProductIds().has(productId);
  }

  toggleBulkSelected(event: Event, productId: string): void {
    if (!this.bulkSelectMode()) return;
    if (this.bulkSaving()) return;
    event.preventDefault();
    event.stopPropagation();
    const input = event.target as HTMLInputElement | null;
    const next = new Set(this.bulkSelectedProductIds());
    if (input?.checked) {
      next.add(productId);
    } else {
      next.delete(productId);
    }
    this.bulkSelectedProductIds.set(next);
  }

  clearBulkSelection(): void {
    this.bulkSelectedProductIds.set(new Set());
  }

  selectAllProductsOnPage(): void {
    if (!this.bulkSelectMode()) return;
    if (!this.products.length) return;
    const next = new Set(this.bulkSelectedProductIds());
    for (const product of this.products) {
      if (product?.id) next.add(product.id);
    }
    this.bulkSelectedProductIds.set(next);
  }

  applyBulkProductEdits(): void {
    if (!this.canEditProducts()) return;
    if (!this.bulkSelectMode()) return;
    if (this.bulkSaving()) return;
    this.bulkEditError = '';

    const ids = Array.from(this.bulkSelectedProductIds());
    if (!ids.length) {
      this.bulkEditError = this.translate.instant('adminUi.storefront.products.bulkNoSelection');
      return;
    }
    if (!this.bulkHasPendingEdits()) {
      this.bulkEditError = this.translate.instant('adminUi.storefront.products.bulkNoChanges');
      return;
    }

    const status = (this.bulkStatus || '').trim() || null;
    const categoryId = (this.bulkCategoryId || '').trim() || null;
    const featuredRaw = String(this.bulkFeatured || '').trim();
    const featured =
      featuredRaw === ''
        ? null
        : featuredRaw === 'true'
          ? true
          : featuredRaw === 'false'
            ? false
            : null;

    const updates = ids.map((id) => ({
      product_id: id,
      ...(status ? { status } : {}),
      ...(categoryId ? { category_id: categoryId } : {}),
      ...(featured === null ? {} : { is_featured: featured })
    }));

    this.bulkSaving.set(true);
    this.admin.bulkUpdateProducts(updates, { source: 'storefront' }).subscribe({
      next: () => {
        this.bulkSaving.set(false);
        for (const product of this.products) {
          if (!product?.id) continue;
          if (!this.bulkSelectedProductIds().has(product.id)) continue;
          if (status) product.status = status;
          if (featured !== null) product.is_featured = featured;
        }
        this.toast.success(this.translate.instant('adminUi.products.bulk.success'));
        this.resetBulkEdits();
        this.clearBulkSelection();
      },
      error: () => {
        this.bulkSaving.set(false);
        this.toast.error(this.translate.instant('adminUi.products.bulk.error'));
      }
    });
  }

  private resetBulkEdits(): void {
    this.bulkStatus = '';
    this.bulkCategoryId = '';
    this.bulkFeatured = '';
  }

  bulkCategoryOptions(): Category[] {
    return this.rootCategories
      .flatMap((root) => [root, ...this.getDescendants(root)])
      .filter((c) => Boolean(c?.id && c?.name));
  }

  bulkCategoryLabel(category: Category): string {
    const parts: string[] = [];
    const visited = new Set<string>();
    let current: Category | undefined = category;
    while (current && current.id && !visited.has(current.id)) {
      visited.add(current.id);
      parts.unshift(current.name);
      if (!current.parent_id) break;
      current = this.categoriesById.get(current.parent_id);
    }
    return parts.join(' / ');
  }

  private getDescendants(root: Category): Category[] {
    const parentId = root?.id || '';
    const children = parentId ? this.childrenByParentId.get(parentId) ?? [] : [];
    const out: Category[] = [];
    for (const child of children) {
      out.push(child);
      out.push(...this.getDescendants(child));
    }
    return out;
  }

	  onRootCategoryDragStart(event: DragEvent, slug: string): void {
	    if (!this.canEditCategories()) return;
	    if (this.reorderSaving()) return;
	    if (this.renameSaving || this.renameLoading) return;
	    if (this.isCreatingAnyCategory()) return;
	    if (this.editingCategorySlug) return;
	    const desired = (slug || '').trim();
	    if (!desired) return;
    this.draggingRootCategorySlug = desired;
    this.dragOverRootCategorySlug = null;
    try {
      event.dataTransfer?.setData('text/plain', desired);
      event.dataTransfer?.setDragImage?.((event.target as HTMLElement) ?? new Image(), 0, 0);
      event.dataTransfer!.effectAllowed = 'move';
    } catch {
      // ignore
    }
  }

  onRootCategoryDragOver(event: DragEvent, slug: string): void {
    if (!this.canEditCategories()) return;
    if (!this.draggingRootCategorySlug) return;
    if (this.reorderSaving()) return;
    const over = (slug || '').trim();
    if (!over || over === this.draggingRootCategorySlug) return;
    event.preventDefault();
    this.dragOverRootCategorySlug = over;
    try {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    } catch {
      // ignore
    }
  }

  onRootCategoryDrop(event: DragEvent, slug: string): void {
    if (!this.canEditCategories()) return;
    const from = this.draggingRootCategorySlug;
    if (!from) return;
    if (this.reorderSaving()) return;
    const to = (slug || '').trim();
    if (!to || to === from) return;
    event.preventDefault();

    const previous = this.rootCategories.map((c) => c.slug);
    const moved = this.reorderRootCategories(from, to);
    if (!moved) return;
    this.persistRootCategoryOrder(previous);
  }

  onRootCategoryDragEnd(): void {
    this.draggingRootCategorySlug = null;
    this.dragOverRootCategorySlug = null;
  }

  toggleCategoryVisibility(event: MouseEvent, category: Category): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canEditCategories()) return;
    if (this.reorderSaving()) return;
    if (this.renameSaving || this.renameLoading) return;
    if (this.createSaving) return;
    if (this.visibilitySavingSlug) return;

    const slug = (category?.slug || '').trim();
    if (!slug) return;
    const currentlyVisible = category.is_visible !== false;
    this.visibilitySavingSlug = slug;
    this.admin.updateCategory(slug, { is_visible: !currentlyVisible }, { source: 'storefront' }).subscribe({
      next: () => {
        this.visibilitySavingSlug = null;
        this.toast.success(this.translate.instant('adminUi.storefront.categories.visibilitySuccess'));
        this.fetchCategories();
      },
      error: () => {
        this.visibilitySavingSlug = null;
        this.toast.error(this.translate.instant('adminUi.storefront.categories.visibilityError'));
      }
    });
  }

  startRenameCategory(event: MouseEvent, category: Category): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canEditCategories()) return;
    if (this.reorderSaving()) return;
    this.cancelCreateCategory();
    this.categoryImageSavingSlug = null;
    this.categoryImageError = '';
    this.mergeTargetSlug = '';
    this.mergePreviewLoading = false;
    this.mergePreview = null;
    this.mergeSaving = false;
    this.mergeError = '';
    this.deletePreviewLoading = false;
    this.deletePreview = null;
    this.deleteSaving = false;
    this.deleteError = '';

    const slug = (category?.slug || '').trim();
    if (!slug) return;

    if (this.editingCategorySlug === slug) {
      this.cancelRenameCategory();
      return;
    }

    this.editingCategorySlug = slug;
    this.renameLoading = true;
    this.renameSaving = false;
    this.renameError = '';
    this.renameNameRo = '';
    this.renameNameEn = '';

    this.admin.getCategoryTranslations(slug).subscribe({
      next: (rows) => {
        const ro = rows.find((r) => r.lang === 'ro')?.name?.trim() ?? '';
        const en = rows.find((r) => r.lang === 'en')?.name?.trim() ?? '';
        const currentLang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
        this.renameNameRo = ro || (currentLang === 'ro' ? (category.name || '').trim() : '');
        this.renameNameEn = en || (currentLang === 'en' ? (category.name || '').trim() : '');
        if (!this.renameNameRo && !this.renameNameEn) {
          this.renameNameRo = (category.name || '').trim();
        }
        this.renameLoading = false;
      },
      error: () => {
        const currentLang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
        this.renameNameRo = currentLang === 'ro' ? (category.name || '').trim() : '';
        this.renameNameEn = currentLang === 'en' ? (category.name || '').trim() : '';
        this.renameLoading = false;
        this.renameError = this.translate.instant('adminUi.storefront.categories.loadError');
      }
    });
  }

  cancelRenameCategory(): void {
    this.editingCategorySlug = '';
    this.renameLoading = false;
    this.renameSaving = false;
    this.renameError = '';
    this.renameNameRo = '';
    this.renameNameEn = '';
    this.categoryImageSavingSlug = null;
    this.categoryImageError = '';
    this.mergeTargetSlug = '';
    this.mergePreviewLoading = false;
    this.mergePreview = null;
    this.mergeSaving = false;
    this.mergeError = '';
    this.deletePreviewLoading = false;
    this.deletePreview = null;
    this.deleteSaving = false;
    this.deleteError = '';
  }

  canSaveRename(): boolean {
    if (this.renameLoading || this.renameSaving) return false;
    const ro = (this.renameNameRo || '').trim();
    const en = (this.renameNameEn || '').trim();
    return Boolean(ro && en);
  }

  saveRenameCategory(): void {
	    if (!this.canEditCategories()) return;
	    if (this.renameSaving || this.renameLoading) return;
	    const slug = (this.editingCategorySlug || '').trim();
    if (!slug) return;

    const nameRo = (this.renameNameRo || '').trim();
    const nameEn = (this.renameNameEn || '').trim();
    if (!nameRo || !nameEn) {
      this.renameError = this.translate.instant('adminUi.storefront.categories.namesRequired');
      return;
    }

    this.renameSaving = true;
    this.renameError = '';

    this.admin
      .updateCategory(slug, { name: nameRo }, { source: 'storefront' })
      .pipe(
        switchMap(() =>
          forkJoin([
            this.admin.upsertCategoryTranslation(slug, 'ro', { name: nameRo }, { source: 'storefront' }),
            this.admin.upsertCategoryTranslation(slug, 'en', { name: nameEn }, { source: 'storefront' })
          ])
        )
      )
      .subscribe({
        next: () => {
          this.renameSaving = false;
          this.toast.success(this.translate.instant('adminUi.storefront.categories.saveSuccess'));
          this.cancelRenameCategory();
          this.fetchCategories();
        },
        error: () => {
          this.renameSaving = false;
          this.renameError = this.translate.instant('adminUi.storefront.categories.saveError');
        }
      });
  }

  onCategoryImageSelected(event: Event, slug: string, kind: 'thumbnail' | 'banner'): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;

    if (!this.canEditCategories()) return;
    if (this.reorderSaving()) return;
    if (this.renameSaving || this.renameLoading) return;
    if (this.createSaving) return;
    const desired = (slug || '').trim();
    if (!desired) return;
    if (this.categoryImageSavingSlug) return;

    this.categoryImageSavingSlug = desired;
    this.categoryImageError = '';
    this.admin.uploadCategoryImage(desired, kind, file, { source: 'storefront' }).subscribe({
      next: () => {
        this.categoryImageSavingSlug = null;
        this.toast.success(this.translate.instant('adminUi.storefront.categories.imageUploadSuccess'));
        this.fetchCategories();
      },
      error: () => {
        this.categoryImageSavingSlug = null;
        this.categoryImageError = this.translate.instant('adminUi.storefront.categories.imageUploadError');
      }
    });
  }

  onMergeTargetChange(): void {
    this.mergePreview = null;
    this.mergeError = '';
  }

  previewCategoryMerge(category: Category): void {
    if (!this.canEditCategories()) return;
    if (this.mergePreviewLoading || this.mergeSaving) return;
    const sourceSlug = (category?.slug || '').trim();
    const targetSlug = (this.mergeTargetSlug || '').trim();
    if (!sourceSlug || !targetSlug) {
      this.mergeError = this.translate.instant('adminUi.storefront.categories.mergeSelectTarget');
      return;
    }
    this.mergePreviewLoading = true;
    this.mergePreview = null;
    this.mergeError = '';
    this.admin.previewMergeCategory(sourceSlug, targetSlug).subscribe({
      next: (preview) => {
        this.mergePreviewLoading = false;
        this.mergePreview = preview;
        if (!preview.can_merge) {
          this.mergeError = this.translate.instant(this.mergeReasonKey(preview.reason));
        }
      },
      error: () => {
        this.mergePreviewLoading = false;
        this.mergeError = this.translate.instant('adminUi.storefront.categories.mergePreviewError');
      }
    });
  }

  mergeCategory(category: Category): void {
    if (!this.canEditCategories()) return;
    if (this.mergeSaving) return;
    const sourceSlug = (category?.slug || '').trim();
    const targetSlug = (this.mergeTargetSlug || '').trim();
    if (!sourceSlug || !targetSlug) return;
    if (!this.mergePreview || !this.mergePreview.can_merge) {
      this.mergeError = this.translate.instant('adminUi.storefront.categories.mergePreviewRequired');
      return;
    }

    const targetName = this.rootCategories.find((c) => c.slug === targetSlug)?.name ?? targetSlug;
    const sourceName = category?.name ?? sourceSlug;
    const count = Number(this.mergePreview.product_count || 0);
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        this.translate.instant('adminUi.storefront.categories.confirmMerge', {
          source: sourceName,
          target: targetName,
          count
        })
      );
      if (!ok) return;
    }

    this.mergeSaving = true;
    this.mergeError = '';
    this.admin.mergeCategory(sourceSlug, targetSlug, { source: 'storefront' }).subscribe({
      next: () => {
        this.mergeSaving = false;
        this.toast.success(this.translate.instant('adminUi.storefront.categories.mergeSuccess'));
        this.cancelRenameCategory();
        this.fetchCategories();
        void this.router.navigate(['/shop', targetSlug]);
      },
      error: () => {
        this.mergeSaving = false;
        this.mergeError = this.translate.instant('adminUi.storefront.categories.mergeError');
      }
    });
  }

  previewCategoryDelete(category: Category): void {
    if (!this.canEditCategories()) return;
    if (this.deletePreviewLoading || this.deleteSaving) return;
    const slug = (category?.slug || '').trim();
    if (!slug) return;
    this.deletePreviewLoading = true;
    this.deletePreview = null;
    this.deleteError = '';
    this.admin.previewDeleteCategory(slug).subscribe({
      next: (preview) => {
        this.deletePreviewLoading = false;
        this.deletePreview = preview;
        if (!preview.can_delete) {
          this.deleteError = this.translate.instant('adminUi.storefront.categories.deleteNotAllowed', {
            products: preview.product_count,
            children: preview.child_count
          });
        }
      },
      error: () => {
        this.deletePreviewLoading = false;
        this.deleteError = this.translate.instant('adminUi.storefront.categories.deletePreviewError');
      }
    });
  }

  deleteCategorySafe(category: Category): void {
    if (!this.canEditCategories()) return;
    if (this.deleteSaving) return;
    if (!this.deletePreview || !this.deletePreview.can_delete) {
      this.deleteError = this.translate.instant('adminUi.storefront.categories.deletePreviewRequired');
      return;
    }
    const slug = (category?.slug || '').trim();
    if (!slug) return;

    const name = category?.name ?? slug;
    if (typeof window !== 'undefined') {
      const ok = window.confirm(this.translate.instant('adminUi.storefront.categories.confirmDelete', { name }));
      if (!ok) return;
    }

    this.deleteSaving = true;
    this.deleteError = '';
    this.admin.deleteCategory(slug, { source: 'storefront' }).subscribe({
      next: () => {
        this.deleteSaving = false;
        this.toast.success(this.translate.instant('adminUi.storefront.categories.deleteSuccess'));
        this.cancelRenameCategory();
        this.fetchCategories();
        void this.router.navigate(['/shop']);
      },
      error: () => {
        this.deleteSaving = false;
        this.deleteError = this.translate.instant('adminUi.storefront.categories.deleteError');
      }
    });
  }

  private mergeReasonKey(reason: string | null | undefined): string {
    if (reason === 'same_category') return 'adminUi.storefront.categories.mergeReasonSame';
    if (reason === 'different_parent') return 'adminUi.storefront.categories.mergeReasonParent';
    if (reason === 'source_has_children') return 'adminUi.storefront.categories.mergeReasonChildren';
    return 'adminUi.storefront.categories.mergeNotAllowed';
  }

	  scrollToFilters(): void {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('shop-filters');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  scrollToSort(): void {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('shop-actions');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      const select = document.getElementById('shop-sort-select');
      if (select instanceof HTMLSelectElement) {
        select.focus();
      }
    }, 350);
  }

  quickSelectCategory(slug: string): void {
    this.categorySelection = String(slug || '');
    this.onCategorySelected();
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  setPaginationMode(mode: 'pages' | 'load_more'): void {
    if (this.paginationMode === mode) return;
    this.cancelFilterDebounce();
    this.paginationMode = mode;
    this.filters.page = 1;
    this.loadProducts();
  }

  loadMore(): void {
    if (this.paginationMode !== 'load_more') return;
    if (this.loadingMore()) return;
    const meta = this.pageMeta;
    if (!meta) return;
    const nextPage = Number(meta.page ?? this.filters.page) + 1;
    if (!Number.isFinite(nextPage) || nextPage < 2 || nextPage > meta.total_pages) return;
    this.cancelFilterDebounce();
    this.filters.page = nextPage;
    this.loadingMore.set(true);
    this.hasError.set(false);
    this.fetchProducts(true);
  }

	  fetchCategories(): void {
	    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
	    this.catalog.listCategories(lang, { include_hidden: this.canEditCategories() }).subscribe({
	      next: (data) => {
	        this.categories = data;
	        this.rebuildCategoryTree();
	      },
	      error: () => {
	        this.categories = [];
	        this.rebuildCategoryTree();
	      }
	    });
	  }

	  isCreatingAnyCategory(): boolean {
	    return this.creatingCategoryParentSlug !== null;
	  }

	  isCreatingRootCategory(): boolean {
	    return this.creatingCategoryParentSlug === '';
	  }

	  isCreatingSubcategory(slug: string): boolean {
	    return this.creatingCategoryParentSlug === slug;
	  }

	  toggleCreateRootCategory(): void {
	    if (!this.canEditCategories()) return;
	    if (this.reorderSaving()) return;
	    if (this.renameSaving || this.renameLoading) return;
	    if (this.isCreatingRootCategory()) {
	      this.cancelCreateCategory();
	      return;
	    }
	    this.cancelRenameCategory();
	    this.creatingCategoryParentSlug = '';
	    this.createSaving = false;
	    this.createError = '';
	    this.createNameRo = '';
	    this.createNameEn = '';
	  }

	  toggleCreateSubcategory(event: MouseEvent, category: Category): void {
	    event.preventDefault();
	    event.stopPropagation();
	    if (!this.canEditCategories()) return;
	    if (this.reorderSaving()) return;
	    if (this.renameSaving || this.renameLoading) return;
	    const slug = (category?.slug || '').trim();
	    if (!slug) return;
	    if (this.isCreatingSubcategory(slug)) {
	      this.cancelCreateCategory();
	      return;
	    }
	    this.cancelRenameCategory();
	    this.creatingCategoryParentSlug = slug;
	    this.createSaving = false;
	    this.createError = '';
	    this.createNameRo = '';
	    this.createNameEn = '';
	  }

	  cancelCreateCategory(): void {
	    this.creatingCategoryParentSlug = null;
	    this.createSaving = false;
	    this.createError = '';
	    this.createNameRo = '';
	    this.createNameEn = '';
	  }

	  canSaveCreateCategory(): boolean {
	    if (this.createSaving) return false;
	    const ro = (this.createNameRo || '').trim();
	    const en = (this.createNameEn || '').trim();
	    return Boolean(ro && en);
	  }

	  saveCreateCategory(): void {
	    if (!this.canEditCategories()) return;
	    if (this.createSaving) return;
	    const parentSlug = this.creatingCategoryParentSlug;
	    if (parentSlug === null) return;

	    const nameRo = (this.createNameRo || '').trim();
	    const nameEn = (this.createNameEn || '').trim();
	    if (!nameRo || !nameEn) {
	      this.createError = this.translate.instant('adminUi.storefront.categories.namesRequired');
	      return;
	    }

	    let parentId: string | null = null;
	    let sortOrder = 0;
	    if (parentSlug) {
	      const parent = this.categoriesBySlug.get(parentSlug);
	      if (!parent) {
	        this.createError = this.translate.instant('adminUi.storefront.categories.createError');
	        return;
	      }
	      parentId = parent.id;
	      const siblings = this.getSubcategories(parent);
	      const maxSortOrder = Math.max(
	        -1,
	        ...siblings.map((c) => (typeof c.sort_order === 'number' && Number.isFinite(c.sort_order) ? c.sort_order : 0))
	      );
	      sortOrder = maxSortOrder + 1;
	    } else {
	      const maxSortOrder = Math.max(
	        -1,
	        ...this.rootCategories.map((c) => (typeof c.sort_order === 'number' && Number.isFinite(c.sort_order) ? c.sort_order : 0))
	      );
	      sortOrder = maxSortOrder + 1;
	    }

	    this.createSaving = true;
	    this.createError = '';
	    this.admin
	      .createCategory({ name: nameRo, sort_order: sortOrder, parent_id: parentId }, { source: 'storefront' })
	      .pipe(
	        switchMap((created) =>
	          forkJoin([
	            this.admin.upsertCategoryTranslation(created.slug, 'ro', { name: nameRo }, { source: 'storefront' }),
	            this.admin.upsertCategoryTranslation(created.slug, 'en', { name: nameEn }, { source: 'storefront' })
	          ]).pipe(map(() => created))
	        )
	      )
	      .subscribe({
	        next: () => {
	          this.createSaving = false;
	          this.toast.success(this.translate.instant('adminUi.storefront.categories.createSuccess'));
	          this.cancelCreateCategory();
	          this.fetchCategories();
	        },
	        error: () => {
	          this.createSaving = false;
	          this.createError = this.translate.instant('adminUi.storefront.categories.createError');
	        }
	      });
	  }

  private reorderRootCategories(fromSlug: string, toSlug: string): boolean {
    const list = [...this.rootCategories];
    const from = list.findIndex((c) => c.slug === fromSlug);
    const to = list.findIndex((c) => c.slug === toSlug);
    if (from < 0 || to < 0) return false;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);

    const order = new Map<string, number>();
    list.forEach((c, idx) => order.set(c.slug, idx));
    for (const cat of this.categories) {
      if (cat.parent_id) continue;
      const next = order.get(cat.slug);
      if (next == null) continue;
      cat.sort_order = next;
    }

    this.rebuildCategoryTree();
    return true;
  }

  private restoreRootCategoryOrder(slugs: string[]): void {
    const order = new Map<string, number>();
    slugs.forEach((slug, idx) => order.set(slug, idx));
    for (const cat of this.categories) {
      if (cat.parent_id) continue;
      const next = order.get(cat.slug);
      if (next == null) continue;
      cat.sort_order = next;
    }
    this.rebuildCategoryTree();
  }

  private persistRootCategoryOrder(previousSlugs: string[]): void {
    if (this.reorderSaving()) return;
    const payload = this.rootCategories.map((c, idx) => ({ slug: c.slug, sort_order: idx }));
    if (!payload.length) return;
    this.reorderSaving.set(true);
    this.admin.reorderCategories(payload, { source: 'storefront' }).subscribe({
      next: (updated) => {
        const bySlug = new Map<string, number>();
        (updated || []).forEach((c) => {
          if (c?.slug && typeof c.sort_order === 'number') bySlug.set(c.slug, c.sort_order);
        });
        for (const cat of this.categories) {
          const next = bySlug.get(cat.slug);
          if (next == null) continue;
          cat.sort_order = next;
        }
        this.rebuildCategoryTree();
        this.reorderSaving.set(false);
        const current = this.rootCategories.map((c) => c.slug);
        this.toast.action(
          this.translate.instant('adminUi.storefront.categories.reorderSuccess'),
          this.translate.instant('adminUi.common.undo'),
          () => this.undoRootCategoryOrder(previousSlugs, current),
          { tone: 'success' }
        );
      },
      error: () => {
        this.reorderSaving.set(false);
        this.restoreRootCategoryOrder(previousSlugs);
        this.toast.error(this.translate.instant('adminUi.storefront.categories.reorderError'));
      }
    });
  }

  private undoProductOrder(previousIds: string[], currentIds: string[]): void {
    if (this.productReorderSaving()) return;
    const updates = previousIds
      .map((id, idx) => ({ product_id: id, sort_order: idx }))
      .filter((row) => Boolean(row.product_id));
    if (!updates.length) return;

    this.restoreProductOrder(previousIds);
    this.productReorderSaving.set(true);
    this.admin.bulkUpdateProducts(updates, { source: 'storefront' }).subscribe({
      next: () => {
        this.productReorderSaving.set(false);
        this.toast.success(this.translate.instant('adminUi.storefront.undoApplied'));
      },
      error: () => {
        this.productReorderSaving.set(false);
        this.restoreProductOrder(currentIds);
        this.toast.error(this.translate.instant('adminUi.storefront.undoFailed'));
      }
    });
  }

  private undoRootCategoryOrder(previousSlugs: string[], currentSlugs: string[]): void {
    if (this.reorderSaving()) return;
    const payload = previousSlugs.map((slug, idx) => ({ slug, sort_order: idx })).filter((row) => Boolean(row.slug));
    if (!payload.length) return;

    this.restoreRootCategoryOrder(previousSlugs);
    this.reorderSaving.set(true);
    this.admin.reorderCategories(payload, { source: 'storefront' }).subscribe({
      next: (updated) => {
        const bySlug = new Map<string, number>();
        (updated || []).forEach((c) => {
          if (c?.slug && typeof c.sort_order === 'number') bySlug.set(c.slug, c.sort_order);
        });
        for (const cat of this.categories) {
          const next = bySlug.get(cat.slug);
          if (next == null) continue;
          cat.sort_order = next;
        }
        this.rebuildCategoryTree();
        this.reorderSaving.set(false);
        this.toast.success(this.translate.instant('adminUi.storefront.undoApplied'));
      },
      error: () => {
        this.reorderSaving.set(false);
        this.restoreRootCategoryOrder(currentSlugs);
        this.toast.error(this.translate.instant('adminUi.storefront.undoFailed'));
      }
    });
  }

  loadProducts(pushUrl = true, replaceUrl = false): void {
    this.normalizePriceRange();
    this.loading.set(true);
    this.hasError.set(false);
    if (pushUrl) {
      this.suppressNextUrlSync = true;
      this.pushUrlState(replaceUrl);
    }
    this.fetchProducts();
  }

  private fetchProducts(append = false): void {
	    const loadSeq = ++this.productsLoadSeq;
	    const isSale = this.activeCategorySlug === 'sale';
	    const categorySlug = isSale ? undefined : (this.activeSubcategorySlug || this.activeCategorySlug || undefined);
	    const includeUnpublished = this.canEditProducts();
      const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
	    this.catalog
	      .listProducts({
	        search: this.filters.search || undefined,
	        category_slug: categorySlug,
	        on_sale: isSale ? true : undefined,
	        include_unpublished: includeUnpublished ? true : undefined,
          lang,
	        min_price: this.filters.min_price > this.priceMinBound ? this.filters.min_price : undefined,
	        max_price: this.filters.max_price < this.priceMaxBound ? this.filters.max_price : undefined,
	        tags: Array.from(this.filters.tags),
	        sort: this.filters.sort,
        page: this.filters.page,
        limit: this.filters.limit
      })
      .subscribe({
        next: (response) => {
	        if (loadSeq !== this.productsLoadSeq) return;
          const incoming = response.items ?? [];
          this.products = append && this.products.length ? [...this.products, ...incoming] : incoming;
          if (!append) {
            this.clearBulkSelection();
            this.bulkEditError = '';
          }
          this.pageMeta = response.meta;
          const previousMaxBound = this.priceMaxBound;
          const max = response.bounds?.max_price;
          if (typeof max === 'number' && Number.isFinite(max)) {
            const rounded = Math.ceil(max / this.priceStep) * this.priceStep;
            this.priceMaxBound = Math.max(this.priceMinBound, rounded);
            if (this.filters.max_price === previousMaxBound) {
              this.filters.max_price = this.priceMaxBound;
            }
	          }
	          this.normalizePriceRange();
	          if (isSale) {
	            this.crumbs = [
	              { label: 'nav.home', url: '/' },
	              { label: 'nav.shop', url: '/shop' },
	              { label: 'shop.sale' }
	            ];
	          } else if (this.activeCategorySlug) {
	            const cat = this.categories.find((c) => c.slug === this.activeCategorySlug);
	            const sub = this.activeSubcategorySlug
	              ? this.categories.find((c) => c.slug === this.activeSubcategorySlug)
	              : undefined;
	            this.crumbs = [
	              { label: 'nav.home', url: '/' },
	              { label: 'nav.shop', url: '/shop' },
              { label: cat?.name ?? this.activeCategorySlug, url: `/shop/${this.activeCategorySlug}` },
              ...(sub ? [{ label: sub.name ?? sub.slug }] : [])
            ];
          } else {
            this.crumbs = [
              { label: 'nav.home', url: '/' },
              { label: 'nav.shop' }
            ];
          }
          const tagMap = new Map<string, string>();
          this.products.forEach((p) => {
            (p.tags ?? []).forEach((tag) => tagMap.set(tag.slug, tag.name));
          });
          this.allTags = Array.from(tagMap.entries())
            .map(([slug, name]) => ({ slug, name }))
            .sort((a, b) => a.name.localeCompare(b.name));
          this.setMetaTags();
          this.loading.set(false);
          this.loadingMore.set(false);
          this.hasError.set(false);
          if (!append) this.restoreScrollIfNeeded();
        },
        error: () => {
	        if (loadSeq !== this.productsLoadSeq) return;
          this.loading.set(false);
          this.loadingMore.set(false);
          if (append) {
            this.filters.page = Math.max(1, this.filters.page - 1);
            this.toast.error(this.translate.instant('shop.errorTitle'), this.translate.instant('shop.errorCopy'));
            return;
          }
          this.products = [];
          this.pageMeta = null;
          this.clearBulkSelection();
          this.bulkEditError = '';
          this.hasError.set(true);
          this.toast.error(this.translate.instant('shop.errorTitle'), this.translate.instant('shop.errorCopy'));
        }
      });
  }

  private rememberShopReturnContext(): void {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const url = `${window.location.pathname}${window.location.search || ''}`;
      if (!url.startsWith('/shop')) return;
      sessionStorage.setItem('shop_return_pending', '1');
      sessionStorage.setItem('shop_return_url', url);
      sessionStorage.setItem('shop_return_scroll_y', String(window.scrollY || 0));
      sessionStorage.setItem('shop_return_at', String(Date.now()));
    } catch {
      // best-effort
    }
  }

  applyFilters(): void {
    this.cancelFilterDebounce();
    this.filters.page = 1;
    this.loadProducts();
  }

  private scheduleFilterApply(): void {
    this.filters.page = 1;
    if (this.filterDebounce) clearTimeout(this.filterDebounce);
    this.filterDebounce = setTimeout(() => {
      this.filterDebounce = undefined;
      this.loadProducts();
    }, this.filterDebounceMs);
  }

  private cancelFilterDebounce(): void {
    if (!this.filterDebounce) return;
    clearTimeout(this.filterDebounce);
    this.filterDebounce = undefined;
  }

  onSidebarSearchChange(raw: string | number): void {
    this.filters.search = String(raw ?? '');
    this.scheduleFilterApply();
  }

  onPriceCommit(changed: 'min' | 'max'): void {
    this.normalizePriceRange(changed);
    this.applyFilters();
  }

  onPriceTextChange(changed: 'min' | 'max', raw: string | number): void {
    const parsed = this.parsePrice(raw);
    if (changed === 'min') {
      this.filters.min_price = parsed ?? this.priceMinBound;
    } else {
      this.filters.max_price = parsed ?? this.priceMaxBound;
    }
    this.normalizePriceRange(changed);
    this.scheduleFilterApply();
  }

  onSearch(): void {
    this.applyFilters();
  }

  changePage(delta: number): void {
    this.cancelFilterDebounce();
    if (this.paginationMode !== 'pages') return;
    if (!this.pageMeta) return;
    const nextPage = this.pageMeta.page + delta;
    if (nextPage < 1 || nextPage > this.pageMeta.total_pages) return;
    this.filters.page = nextPage;
    this.loadProducts();
  }

  toggleTag(tagSlug: string): void {
    this.cancelFilterDebounce();
    if (this.filters.tags.has(tagSlug)) {
      this.filters.tags.delete(tagSlug);
    } else {
      this.filters.tags.add(tagSlug);
    }
    this.applyFilters();
  }

	  resetFilters(): void {
	    this.cancelFilterDebounce();
	    this.filters.search = '';
	    this.activeCategorySlug = '';
	    this.activeSubcategorySlug = '';
	    this.categorySelection = '';
	    this.filters.min_price = this.priceMinBound;
	    this.filters.max_price = this.priceMaxBound;
	    this.filters.tags = new Set<string>();
	    this.filters.sort = 'newest';
    this.filters.page = 1;
    this.loadProducts();
  }

  setMetaTags(): void {
    const lang = this.translate.currentLang === 'ro' ? 'ro' : 'en';
    const categoryLabel = this.resolveActiveCategoryLabel();
    const title = categoryLabel
      ? this.translate.instant('shop.metaTitleCategory', { category: categoryLabel })
      : this.translate.instant('shop.metaTitle');
    const categoryDescription = categoryLabel
      ? this.translate.instant('shop.metaDescriptionCategory', { category: categoryLabel })
      : '';
    const description = resolveRouteSeoDescription(
      'shop',
      lang,
      categoryDescription,
      this.translate.instant('meta.descriptions.shop'),
      this.translate.instant('shop.metaDescription')
    );
    this.title.setTitle(title);
    this.metaService.updateTag({ property: 'og:title', content: title });
    this.metaService.updateTag({ property: 'og:description', content: description });
    this.metaService.updateTag({ name: 'description', content: description });
    const path = this.activeCategorySlug ? `/shop/${encodeURIComponent(this.activeCategorySlug)}` : '/shop';
    const canonical = this.seoHeadLinks.setLocalizedCanonical(path, lang, {
      sub: this.shouldKeepSubcategoryInCanonical() ? this.activeSubcategorySlug : undefined
    });
    this.metaService.updateTag({ property: 'og:url', content: canonical });
    this.structuredData.setRouteSchemas([
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: title,
        description,
        url: canonical,
        inLanguage: lang
      }
    ]);
  }

  private resolveActiveCategoryLabel(): string | null {
    const slug = (this.activeCategorySlug || '').trim();
    if (!slug) return null;
    if (slug === 'sale') {
      return this.translate.instant('shop.sale');
    }
    const categoryName = (this.categoriesBySlug.get(slug)?.name || '').trim();
    if (categoryName) return categoryName;
    const fallback = slug
      .replace(/[-_]+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
    return fallback || null;
  }

  private shouldKeepSubcategoryInCanonical(): boolean {
    if (!this.activeCategorySlug || this.activeCategorySlug === 'sale') return false;
    const subSlug = (this.activeSubcategorySlug || '').trim();
    if (!subSlug) return false;
    const parent = this.categoriesBySlug.get(this.activeCategorySlug);
    const child = this.categoriesBySlug.get(subSlug);
    if (!parent || !child) return false;
    return child.parent_id === parent.id;
  }

  onCategorySelected(): void {
    this.cancelFilterDebounce();
    this.filters.page = 1;
    this.activeCategorySlug = this.categorySelection || '';
    this.activeSubcategorySlug = '';
    this.loadProducts();
  }

  setSubcategory(slug: string): void {
    this.cancelFilterDebounce();
    const parent = this.categoriesBySlug.get(this.activeCategorySlug);
    if (!parent) return;
    if (slug) {
      const allowed = this.getSubcategories(parent).some((c) => c.slug === slug);
      if (!allowed) return;
    }
    this.filters.page = 1;
    this.activeSubcategorySlug = slug || '';
    this.loadProducts();
  }

  getSubcategories(category: Category): Category[] {
    return this.childrenByParentId.get(category.id) ?? [];
  }

  private rebuildCategoryTree(): void {
    this.categoriesBySlug.clear();
    this.categoriesById.clear();
    this.childrenByParentId.clear();

    for (const cat of this.categories) {
      this.categoriesBySlug.set(cat.slug, cat);
      this.categoriesById.set(cat.id, cat);
    }

    for (const cat of this.categories) {
      const parentId = cat.parent_id;
      if (!parentId) continue;
      const bucket = this.childrenByParentId.get(parentId);
      if (bucket) {
        bucket.push(cat);
      } else {
        this.childrenByParentId.set(parentId, [cat]);
      }
    }

    const sortByOrderThenName = (a: Category, b: Category) => {
      const sortA = a.sort_order;
      const sortB = b.sort_order;
      const orderA = typeof sortA === 'number' && Number.isFinite(sortA) ? sortA : 0;
      const orderB = typeof sortB === 'number' && Number.isFinite(sortB) ? sortB : 0;
      if (orderA !== orderB) return orderA - orderB;
      return (a.name ?? '').localeCompare(b.name ?? '');
    };

    for (const [key, list] of this.childrenByParentId.entries()) {
      this.childrenByParentId.set(key, [...list].sort(sortByOrderThenName));
    }

    this.rootCategories = this.categories
      .filter((c) => !c.parent_id)
      .sort(sortByOrderThenName);
  }

  private syncStateFromUrl(routeCategory: string | null, params: Params): boolean {
    this.syncFiltersFromQuery(params);

    const legacyCat = typeof params['cat'] === 'string' ? params['cat'].trim() : '';
    const legacyOnSale = this.parseBoolean(params['on_sale']);

    let categorySlug = (routeCategory ?? '').trim();
    let subSlug = typeof params['sub'] === 'string' ? params['sub'].trim() : '';
    let shouldCanonicalize = false;

    if (!categorySlug && legacyCat) {
      categorySlug = legacyCat;
      shouldCanonicalize = true;
    }
    if (!categorySlug && legacyOnSale) {
      categorySlug = 'sale';
      shouldCanonicalize = true;
    }

    const isSale = categorySlug === 'sale';
    if (isSale) {
      subSlug = '';
    }

    const selected = categorySlug ? this.categoriesBySlug.get(categorySlug) : undefined;
    if (!isSale && selected?.parent_id) {
      const parent = this.categoriesById.get(selected.parent_id);
      if (parent) {
        subSlug = subSlug || selected.slug;
        categorySlug = parent.slug;
        shouldCanonicalize = true;
      }
    }

    if (!isSale && categorySlug && subSlug) {
      const parent = this.categoriesBySlug.get(categorySlug);
      const sub = this.categoriesBySlug.get(subSlug);
      if (!parent || !sub || sub.parent_id !== parent.id) {
        subSlug = '';
        shouldCanonicalize = true;
      }
    }

    this.activeCategorySlug = isSale ? 'sale' : categorySlug;
    this.activeSubcategorySlug = isSale ? '' : subSlug;
    this.categorySelection = this.activeCategorySlug === 'sale' ? 'sale' : this.activeCategorySlug;

    if (!this.activeCategorySlug && this.activeSubcategorySlug) {
      this.activeSubcategorySlug = '';
      shouldCanonicalize = true;
    }

    return shouldCanonicalize;
  }

  private buildQueryParams(): Params {
    return {
      q: this.filters.search || undefined,
      sub: this.activeCategorySlug && this.activeCategorySlug !== 'sale' ? (this.activeSubcategorySlug || undefined) : undefined,
      min: this.filters.min_price > this.priceMinBound ? this.filters.min_price : undefined,
      max: this.filters.max_price < this.priceMaxBound ? this.filters.max_price : undefined,
      sort: this.filters.sort !== 'recommended' ? this.filters.sort : undefined,
      page: this.filters.page !== 1 ? this.filters.page : undefined,
      tags: this.filters.tags.size ? Array.from(this.filters.tags).join(',') : undefined
    };
  }

  private pushUrlState(replaceUrl: boolean): void {
    const commands = this.activeCategorySlug ? ['/shop', this.activeCategorySlug] : ['/shop'];
    void this.router.navigate(commands, { queryParams: this.buildQueryParams(), replaceUrl });
  }

  private syncFiltersFromQuery(params: Params): void {
    this.filters.search = params['q'] ?? '';
    const min = this.parsePrice(params['min']);
    const max = this.parsePrice(params['max']);
    this.filters.min_price = min ?? this.priceMinBound;
    this.filters.max_price = max ?? this.priceMaxBound;
    const rawSort = typeof params['sort'] === 'string' ? params['sort'].trim() : '';
    const allowedSorts: SortOption[] = ['recommended', 'newest', 'price_asc', 'price_desc', 'name_asc', 'name_desc'];
    this.filters.sort = allowedSorts.find((option) => option === rawSort) ?? 'recommended';
    this.filters.page = params['page'] ? Number(params['page']) : 1;
    const tagParam = params['tags'];
    this.filters.tags = new Set<string>(
      typeof tagParam === 'string' && tagParam.length ? tagParam.split(',') : []
    );
    this.normalizePriceRange();
  }

		  private parseBoolean(raw: unknown): boolean {
		    if (raw === true) return true;
		    if (raw === false || raw == null) return false;
		    if (typeof raw === 'number') return raw === 1;
		    if (Array.isArray(raw)) return this.parseBoolean(raw[0]);
		    if (typeof raw !== 'string') return false;
		    const value = raw.trim().toLowerCase();
		    return value === '1' || value === 'true' || value === 'yes';
		  }

  private parsePrice(raw: unknown): number | undefined {
    if (raw === null || raw === undefined) return undefined;
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) return undefined;
      return raw;
    }
    if (typeof raw !== 'string') return undefined;
    const str = String(raw).trim();
    if (!str.length) return undefined;
    const n = Number(str);
    if (!Number.isFinite(n)) return undefined;
    return n;
  }

  private normalizePriceRange(changed?: 'min' | 'max'): void {
    this.filters.min_price = this.clampPrice(this.filters.min_price);
    this.filters.max_price = this.clampPrice(this.filters.max_price);

    if (this.filters.max_price < this.filters.min_price) {
      if (changed === 'min') {
        this.filters.max_price = this.filters.min_price;
      } else if (changed === 'max') {
        this.filters.min_price = this.filters.max_price;
      } else {
        this.filters.max_price = this.filters.min_price;
      }
    }
  }

  private clampPrice(value: number): number {
    if (!Number.isFinite(value)) return this.priceMinBound;
    const clamped = Math.min(Math.max(value, this.priceMinBound), this.priceMaxBound);
    const stepped = Math.round(clamped / this.priceStep) * this.priceStep;
    return Math.min(Math.max(stepped, this.priceMinBound), this.priceMaxBound);
  }

  filterChips(): ShopFilterChip[] {
    const chips: ShopFilterChip[] = [];
    if (this.activeCategorySlug) {
      if (this.activeCategorySlug === 'sale') {
        chips.push({ id: 'category:sale', type: 'category', label: this.translate.instant('shop.sale') });
      } else {
        const category = this.categoriesBySlug.get(this.activeCategorySlug);
        chips.push({
          id: `category:${this.activeCategorySlug}`,
          type: 'category',
          label: category?.name || this.activeCategorySlug
        });
      }
    }
    if (this.activeSubcategorySlug) {
      const sub = this.categoriesBySlug.get(this.activeSubcategorySlug);
      chips.push({
        id: `subcategory:${this.activeSubcategorySlug}`,
        type: 'subcategory',
        label: sub?.name || this.activeSubcategorySlug
      });
    }

    const hasMin = this.filters.min_price > this.priceMinBound;
    const hasMax = this.filters.max_price < this.priceMaxBound;
    if (hasMin || hasMax) {
      chips.push({
        id: `price:${this.filters.min_price}-${this.filters.max_price}`,
        type: 'price',
        label: this.translate.instant('shop.priceChip', { min: this.filters.min_price, max: this.filters.max_price })
      });
    }

    if (this.filters.search.trim()) {
      chips.push({
        id: `search:${this.filters.search.trim()}`,
        type: 'search',
        label: this.translate.instant('shop.searchChip', { q: this.filters.search.trim() })
      });
    }

    for (const slug of Array.from(this.filters.tags)) {
      const tagName = this.allTags.find((t) => t.slug === slug)?.name || slug;
      chips.push({
        id: `tag:${slug}`,
        type: 'tag',
        label: tagName,
        value: slug
      });
    }

    return chips;
  }

  trackChip(_: number, chip: ShopFilterChip): string {
    return chip.id;
  }

  removeChip(chip: ShopFilterChip): void {
    this.cancelFilterDebounce();
    this.filters.page = 1;

    if (chip.type === 'category') {
      this.activeCategorySlug = '';
      this.activeSubcategorySlug = '';
      this.categorySelection = '';
      this.loadProducts();
      return;
    }
    if (chip.type === 'subcategory') {
      this.activeSubcategorySlug = '';
      this.loadProducts();
      return;
    }
    if (chip.type === 'price') {
      this.filters.min_price = this.priceMinBound;
      this.filters.max_price = this.priceMaxBound;
      this.applyFilters();
      return;
    }
    if (chip.type === 'search') {
      this.filters.search = '';
      this.applyFilters();
      return;
    }
    if (chip.type === 'tag' && chip.value) {
      this.filters.tags.delete(chip.value);
      this.applyFilters();
      return;
    }
  }

  resultsMetaParams(): { total: number; from: number; to: number } | null {
    const meta = this.pageMeta;
    if (!meta) return null;

    const total = Number(meta.total_items ?? 0);
    const page = Number(meta.page ?? 1);
    const limit = Number(meta.limit ?? this.filters.limit);
    if (!Number.isFinite(total) || !Number.isFinite(page) || !Number.isFinite(limit) || limit <= 0) return null;
    if (total <= 0) return { total: 0, from: 0, to: 0 };

    if (this.paginationMode === 'load_more') {
      const shown = Math.max(0, this.products.length);
      if (shown <= 0) return { total, from: 0, to: 0 };
      return { total, from: 1, to: Math.min(total, shown) };
    }

    const from = (page - 1) * limit + 1;
    const to = Math.min(total, page * limit);
    return { total, from, to };
  }

  private initScrollRestoreFromSession(): void {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const pending = sessionStorage.getItem('shop_return_pending');
      if (pending !== '1') return;

      const url = sessionStorage.getItem('shop_return_url') || '';
      const scrollRaw = sessionStorage.getItem('shop_return_scroll_y') || '';
      const atRaw = sessionStorage.getItem('shop_return_at') || '';
      const at = Number(atRaw);

      const now = Date.now();
      if (!Number.isFinite(at) || now - at > 10 * 60 * 1000) {
        this.clearShopReturnContext();
        return;
      }

      const currentUrl = this.router.url;
      if (!url || url !== currentUrl) {
        this.clearShopReturnContext();
        return;
      }

      const y = Number(scrollRaw);
      if (!Number.isFinite(y) || y < 0) {
        this.clearShopReturnContext();
        return;
      }

      this.restoreScrollY = y;
    } catch {
      // ignore
    }
  }

  private clearShopReturnContext(): void {
    if (typeof sessionStorage === 'undefined') return;
    try {
      sessionStorage.removeItem('shop_return_pending');
      sessionStorage.removeItem('shop_return_url');
      sessionStorage.removeItem('shop_return_scroll_y');
      sessionStorage.removeItem('shop_return_at');
    } catch {
      // ignore
    }
  }

  private restoreScrollIfNeeded(): void {
    const y = this.restoreScrollY;
    if (y == null) return;
    this.restoreScrollY = null;
    this.clearShopReturnContext();
    requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'auto' }));
  }
}
