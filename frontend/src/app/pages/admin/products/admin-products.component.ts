import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { AdminProductListItem, AdminProductListResponse, AdminProductsService } from '../../../core/admin-products.service';
import { CatalogService, Category } from '../../../core/catalog.service';
import { LocalizedCurrencyPipe } from '../../../shared/localized-currency.pipe';
import { AdminService } from '../../../core/admin.service';
import { ToastService } from '../../../core/toast.service';

type ProductStatusFilter = 'all' | 'draft' | 'published' | 'archived';

type ProductForm = {
  name: string;
  category_id: string;
  base_price: string;
  sale_enabled: boolean;
  sale_type: 'percent' | 'amount';
  sale_value: string;
  sale_start_at: string;
  sale_end_at: string;
  sale_auto_publish: boolean;
  stock_quantity: number;
  status: 'draft' | 'published' | 'archived';
  is_active: boolean;
  is_featured: boolean;
  sku: string;
  short_description: string;
  long_description: string;
  publish_at: string;
  is_bestseller: boolean;
};

type ProductTranslationForm = {
  name: string;
  short_description: string;
  long_description: string;
  meta_title: string;
  meta_description: string;
};

@Component({
  selector: 'app-admin-products',
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
          <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.products.title' | translate }}</h1>
          <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.products.hint' | translate }}</p>
        </div>
        <app-button size="sm" [label]="'adminUi.products.new' | translate" (action)="startNew()"></app-button>
      </div>

      <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
	        <div class="grid gap-3 lg:grid-cols-[1fr_240px_240px_auto] items-end">
	          <app-input [label]="'adminUi.products.search' | translate" [(value)]="q"></app-input>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.products.table.status' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="status"
            >
              <option value="all">{{ 'adminUi.products.all' | translate }}</option>
              <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
              <option value="published">{{ 'adminUi.status.published' | translate }}</option>
              <option value="archived">{{ 'adminUi.status.archived' | translate }}</option>
            </select>
          </label>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.products.table.category' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="categorySlug"
            >
              <option value="">{{ 'adminUi.products.allCategories' | translate }}</option>
              <option *ngFor="let cat of categories()" [value]="cat.slug">{{ cat.name }}</option>
            </select>
          </label>

	          <div class="flex items-center gap-2">
	            <app-button size="sm" [label]="'adminUi.actions.refresh' | translate" (action)="applyFilters()"></app-button>
	            <app-button size="sm" variant="ghost" [label]="'adminUi.actions.reset' | translate" (action)="resetFilters()"></app-button>
	          </div>
	        </div>

          <div
            *ngIf="selected.size > 0"
            class="rounded-xl border border-slate-200 bg-slate-50 p-3 grid gap-3 dark:border-slate-800 dark:bg-slate-950/20"
          >
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                {{ 'adminUi.products.bulk.selected' | translate: { count: selected.size } }}
              </p>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.products.bulk.clearSelection' | translate"
                (action)="clearSelection()"
                [disabled]="bulkBusy()"
              ></app-button>
            </div>

            <div class="grid gap-3 lg:grid-cols-[200px_240px_auto_auto] items-end">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.products.sale.type' | translate }}
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="bulkSaleType"
                  (change)="bulkSaleValue = ''"
                  [disabled]="bulkBusy()"
                >
                  <option [ngValue]="'percent'">{{ 'adminUi.products.sale.typePercent' | translate }}</option>
                  <option [ngValue]="'amount'">{{ 'adminUi.products.sale.typeAmount' | translate }}</option>
                </select>
              </label>

              <app-input
                [label]="'adminUi.products.bulk.saleValue' | translate"
                [placeholder]="bulkSaleType === 'percent' ? '10' : '5.00'"
                type="text"
                inputMode="decimal"
                [value]="bulkSaleValue"
                (valueChange)="onBulkSaleValueChange($event)"
                [disabled]="bulkBusy()"
              ></app-input>

              <app-button
                size="sm"
                [label]="'adminUi.products.bulk.applySale' | translate"
                (action)="applySaleToSelected()"
                [disabled]="bulkBusy()"
              ></app-button>

              <div class="flex flex-wrap gap-2 justify-end">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.products.bulk.clearSale' | translate"
                  (action)="clearSaleForSelected()"
                  [disabled]="bulkBusy()"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.products.bulk.publish' | translate"
                  (action)="publishSelected()"
                  [disabled]="bulkBusy()"
                ></app-button>
              </div>
            </div>

            <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.products.bulk.note' | translate }}</p>

            <div
              *ngIf="bulkError()"
              class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-2 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
            >
              {{ bulkError() }}
            </div>
          </div>

	        <div *ngIf="error()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
	          {{ error() }}
	        </div>

        <div *ngIf="loading(); else tableTpl">
          <app-skeleton [rows]="8"></app-skeleton>
        </div>
        <ng-template #tableTpl>
          <div *ngIf="products().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'adminUi.products.empty' | translate }}
          </div>

          <div *ngIf="products().length > 0" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table class="min-w-[980px] w-full text-sm">
              <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                <tr>
                  <th class="text-left font-semibold px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      [checked]="allSelectedOnPage()"
                      (change)="toggleSelectAll($event)"
                      [disabled]="bulkBusy()"
                      aria-label="Select all"
                    />
                  </th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.products.table.name' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.products.table.price' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.products.table.status' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.products.table.category' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.products.table.stock' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.products.table.active' | translate }}</th>
                  <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.products.table.updated' | translate }}</th>
                  <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.products.table.actions' | translate }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  *ngFor="let product of products()"
                  class="border-t border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
                >
                  <td class="px-3 py-2">
                    <input
                      type="checkbox"
                      [checked]="selected.has(product.id)"
                      (change)="toggleSelected(product.id, $event)"
                      [disabled]="bulkBusy()"
                      aria-label="Select"
                    />
                  </td>
                  <td class="px-3 py-2 font-medium text-slate-900 dark:text-slate-50">
                    <div class="grid">
                      <span class="truncate">{{ product.name }}</span>
                      <span class="text-xs text-slate-500 dark:text-slate-400">{{ product.slug }} · {{ product.sku }}</span>
                    </div>
                  </td>
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
                    {{ product.base_price | localizedCurrency : product.currency }}
                  </td>
                  <td class="px-3 py-2">
                    <span class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold" [ngClass]="statusPillClass(product.status)">
                      {{ ('adminUi.status.' + product.status) | translate }}
                    </span>
                  </td>
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
                    {{ product.category_name }}
                  </td>
                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
                    {{ product.stock_quantity }}
                  </td>
                  <td class="px-3 py-2">
                    <span
                      class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold"
                      [ngClass]="product.is_active ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'"
                    >
                      {{ product.is_active ? ('adminUi.products.active' | translate) : ('adminUi.products.inactive' | translate) }}
                    </span>
                  </td>
                  <td class="px-3 py-2 text-slate-600 dark:text-slate-300">
                    {{ product.updated_at | date: 'short' }}
                  </td>
                  <td class="px-3 py-2 text-right">
                    <app-button size="sm" variant="ghost" [label]="'adminUi.products.edit' | translate" (action)="edit(product.slug)"></app-button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div *ngIf="meta()" class="flex items-center justify-between gap-3 pt-2 text-sm text-slate-700 dark:text-slate-200">
            <div>
              {{ 'adminUi.products.pagination' | translate: { page: meta()!.page, total_pages: meta()!.total_pages, total_items: meta()!.total_items } }}
            </div>
            <div class="flex items-center gap-2">
              <app-button size="sm" variant="ghost" [label]="'adminUi.products.prev' | translate" [disabled]="meta()!.page <= 1" (action)="goToPage(meta()!.page - 1)"></app-button>
              <app-button size="sm" variant="ghost" [label]="'adminUi.products.next' | translate" [disabled]="meta()!.page >= meta()!.total_pages" (action)="goToPage(meta()!.page + 1)"></app-button>
            </div>
          </div>
        </ng-template>
      </section>

      <section *ngIf="editorOpen()" class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
            {{ editingSlug() ? ('adminUi.products.edit' | translate) : ('adminUi.products.create' | translate) }}
          </h2>
          <app-button size="sm" variant="ghost" [label]="'adminUi.products.actions.cancel' | translate" (action)="closeEditor()"></app-button>
        </div>

        <div *ngIf="editorError()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
          {{ editorError() }}
        </div>

        <div class="grid gap-3 md:grid-cols-2">
          <app-input [label]="'adminUi.products.table.name' | translate" [(value)]="form.name"></app-input>
          <div class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            <span>{{ 'adminUi.products.form.slug' | translate }}</span>
            <div class="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 shadow-sm flex items-center dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-100">
              <span *ngIf="editingSlug(); else slugHint" class="font-mono truncate">{{ editingSlug() }}</span>
              <ng-template #slugHint>
                <span class="text-slate-500 dark:text-slate-400">{{ 'adminUi.products.form.slugAutoHint' | translate }}</span>
              </ng-template>
            </div>
          </div>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.products.table.category' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="form.category_id"
            >
              <option value="" disabled>{{ 'adminUi.products.selectCategory' | translate }}</option>
              <option *ngFor="let cat of adminCategories()" [value]="cat.id">{{ cat.name }}</option>
            </select>
          </label>

          <app-input
            [label]="'adminUi.products.table.price' | translate"
            [placeholder]="'123.45'"
            type="text"
            inputMode="decimal"
            [value]="form.base_price"
            (valueChange)="onBasePriceChange($event)"
            [hint]="basePriceError || ('adminUi.products.form.priceFormatHint' | translate)"
          ></app-input>

          <div class="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                {{ 'adminUi.products.sale.title' | translate }}
              </p>
              <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" [(ngModel)]="form.sale_enabled" (change)="onSaleEnabledChange()" />
                {{ 'adminUi.products.sale.enabled' | translate }}
              </label>
            </div>

	            <div class="mt-3 grid gap-3 md:grid-cols-[200px_1fr] items-end">
	              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                {{ 'adminUi.products.sale.type' | translate }}
	                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="form.sale_type"
                  (change)="onSaleTypeChange()"
                  [disabled]="!form.sale_enabled"
                >
                  <option [ngValue]="'percent'">{{ 'adminUi.products.sale.typePercent' | translate }}</option>
                  <option [ngValue]="'amount'">{{ 'adminUi.products.sale.typeAmount' | translate }}</option>
                </select>
              </label>

              <app-input
                [label]="'adminUi.products.sale.value' | translate"
                [placeholder]="form.sale_type === 'percent' ? '10' : '5.00'"
                type="text"
                inputMode="decimal"
                [value]="form.sale_value"
                (valueChange)="onSaleValueChange($event)"
	                [disabled]="!form.sale_enabled"
	                [hint]="saleValueError || ('adminUi.products.sale.note' | translate)"
	              ></app-input>
	            </div>

	            <div class="mt-3 grid gap-3 md:grid-cols-3 items-end">
	              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                {{ 'adminUi.products.sale.startAt' | translate }}
	                <input
	                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                  type="datetime-local"
	                  [(ngModel)]="form.sale_start_at"
	                  [disabled]="!form.sale_enabled"
	                />
	              </label>

	              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                {{ 'adminUi.products.sale.endAt' | translate }}
	                <input
	                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                  type="datetime-local"
	                  [(ngModel)]="form.sale_end_at"
	                  [disabled]="!form.sale_enabled"
	                />
	              </label>

	              <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 pt-6">
	                <input type="checkbox" [(ngModel)]="form.sale_auto_publish" [disabled]="!form.sale_enabled" />
	                {{ 'adminUi.products.sale.autoPublish' | translate }}
	              </label>
	            </div>
	          </div>
          <app-input [label]="'adminUi.products.table.stock' | translate" type="number" [(value)]="form.stock_quantity"></app-input>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.products.table.status' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="form.status"
            >
              <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
              <option value="published">{{ 'adminUi.status.published' | translate }}</option>
              <option value="archived">{{ 'adminUi.status.archived' | translate }}</option>
            </select>
          </label>

          <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 pt-6">
            <input type="checkbox" [(ngModel)]="form.is_active" />
            {{ 'adminUi.products.form.active' | translate }}
          </label>

          <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 pt-6">
            <input type="checkbox" [(ngModel)]="form.is_featured" />
            {{ 'adminUi.products.form.featured' | translate }}
          </label>

          <app-input [label]="'adminUi.products.form.sku' | translate" [(value)]="form.sku"></app-input>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.products.form.publishAt' | translate }}
            <input
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              type="datetime-local"
              [(ngModel)]="form.publish_at"
            />
          </label>

          <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" [(ngModel)]="form.is_bestseller" />
            {{ 'adminUi.products.form.bestseller' | translate }}
          </label>
        </div>

        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'adminUi.products.form.shortDescription' | translate }}
          <textarea
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            rows="2"
            maxlength="280"
            [(ngModel)]="form.short_description"
          ></textarea>
          <span class="text-xs font-normal text-slate-500 dark:text-slate-400">
            {{ 'adminUi.products.form.shortDescriptionHint' | translate }}
          </span>
        </label>

	        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	          {{ 'adminUi.products.form.description' | translate }}
	          <textarea
	            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	            rows="4"
	            [(ngModel)]="form.long_description"
	          ></textarea>
	        </label>

	        <div class="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/20">
	          <div class="grid gap-1">
	            <h3 class="text-sm font-semibold tracking-wide uppercase text-slate-700 dark:text-slate-200">
	              {{ 'adminUi.products.translations.title' | translate }}
	            </h3>
	            <p class="text-xs text-slate-500 dark:text-slate-400">
	              {{ 'adminUi.products.translations.hint' | translate }}
	            </p>
	          </div>

	          <div
	            *ngIf="translationError()"
	            class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
	          >
	            {{ translationError() }}
	          </div>

	          <div class="grid gap-4 lg:grid-cols-2">
	            <div class="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	              <div class="flex items-center justify-between gap-3">
	                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">RO</p>
	                <div class="flex items-center gap-2">
	                  <app-button size="sm" [label]="'adminUi.actions.save' | translate" (action)="saveTranslation('ro')"></app-button>
	                  <app-button
	                    *ngIf="translationExists.ro"
	                    size="sm"
	                    variant="ghost"
	                    [label]="'adminUi.actions.delete' | translate"
	                    (action)="deleteTranslation('ro')"
	                  ></app-button>
	                </div>
	              </div>

	              <app-input [label]="'adminUi.products.table.name' | translate" [(value)]="translations.ro.name"></app-input>

	              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                {{ 'adminUi.products.form.shortDescription' | translate }}
	                <textarea
	                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                  rows="2"
	                  maxlength="280"
	                  [(ngModel)]="translations.ro.short_description"
	                ></textarea>
	              </label>

	              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                {{ 'adminUi.products.form.description' | translate }}
	                <textarea
	                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                  rows="4"
	                  [(ngModel)]="translations.ro.long_description"
	                ></textarea>
	              </label>
	            </div>

	            <div class="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	              <div class="flex items-center justify-between gap-3">
	                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">EN</p>
	                <div class="flex items-center gap-2">
	                  <app-button size="sm" [label]="'adminUi.actions.save' | translate" (action)="saveTranslation('en')"></app-button>
	                  <app-button
	                    *ngIf="translationExists.en"
	                    size="sm"
	                    variant="ghost"
	                    [label]="'adminUi.actions.delete' | translate"
	                    (action)="deleteTranslation('en')"
	                  ></app-button>
	                </div>
	              </div>

	              <app-input [label]="'adminUi.products.table.name' | translate" [(value)]="translations.en.name"></app-input>

	              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                {{ 'adminUi.products.form.shortDescription' | translate }}
	                <textarea
	                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                  rows="2"
	                  maxlength="280"
	                  [(ngModel)]="translations.en.short_description"
	                ></textarea>
	              </label>

	              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                {{ 'adminUi.products.form.description' | translate }}
	                <textarea
	                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                  rows="4"
	                  [(ngModel)]="translations.en.long_description"
	                ></textarea>
	              </label>
	            </div>
	          </div>
	        </div>

	        <div class="flex items-center gap-2">
	          <app-button [label]="'adminUi.products.form.save' | translate" (action)="save()"></app-button>
	          <span *ngIf="editorMessage()" class="text-sm text-emerald-700 dark:text-emerald-300">{{ editorMessage() }}</span>
	        </div>

        <div class="grid gap-3">
          <div class="flex items-center justify-between">
            <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{{ 'adminUi.products.form.images' | translate }}</p>
            <label class="text-sm text-slate-700 dark:text-slate-200">
              {{ 'adminUi.products.form.upload' | translate }}
              <input type="file" accept="image/*" class="block mt-1" (change)="onUpload($event)" />
            </label>
          </div>

          <div *ngIf="images().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'adminUi.products.form.noImages' | translate }}
          </div>

          <div *ngIf="images().length > 0" class="grid gap-2">
            <div *ngFor="let img of images()" class="flex items-center gap-3 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              <img [src]="img.url" [alt]="img.alt_text || 'image'" class="h-12 w-12 rounded object-cover" />
              <div class="flex-1 min-w-0">
                <p class="font-semibold text-slate-900 dark:text-slate-50 truncate">{{ img.alt_text || ('adminUi.products.form.image' | translate) }}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ img.url }}</p>
              </div>
              <app-button size="sm" variant="ghost" [label]="'adminUi.actions.delete' | translate" (action)="deleteImage(img.id)"></app-button>
            </div>
          </div>
        </div>
      </section>
    </div>
  `
})
export class AdminProductsComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.admin', url: '/admin/dashboard' },
    { label: 'adminUi.products.title' }
  ];

  loading = signal(true);
  error = signal<string | null>(null);
  products = signal<AdminProductListItem[]>([]);
  meta = signal<AdminProductListResponse['meta'] | null>(null);
  categories = signal<Category[]>([]);

  q = '';
  status: ProductStatusFilter = 'all';
  categorySlug = '';
  page = 1;
  limit = 25;

  editorOpen = signal(false);
  editingSlug = signal<string | null>(null);
  editorError = signal<string | null>(null);
  editorMessage = signal<string | null>(null);
  images = signal<Array<{ id: string; url: string; alt_text?: string | null }>>([]);
  adminCategories = signal<Array<{ id: string; name: string }>>([]);

  form: ProductForm = this.blankForm();
  basePriceError = '';
  saleValueError = '';

  selected = new Set<string>();
  bulkSaleType: 'percent' | 'amount' = 'percent';
  bulkSaleValue = '';
  bulkBusy = signal(false);
  bulkError = signal<string | null>(null);

  translationLoading = signal(false);
  translationError = signal<string | null>(null);
  translationExists: Record<'en' | 'ro', boolean> = { en: false, ro: false };
  translations: Record<'en' | 'ro', ProductTranslationForm> = {
    en: this.blankTranslationForm(),
    ro: this.blankTranslationForm()
  };

  constructor(
    private productsApi: AdminProductsService,
    private catalog: CatalogService,
    private admin: AdminService,
    private toast: ToastService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.loadCategories();
    this.loadAdminCategories();
    this.load();
  }

  applyFilters(): void {
    this.page = 1;
    this.clearSelection();
    this.load();
  }

  resetFilters(): void {
    this.q = '';
    this.status = 'all';
    this.categorySlug = '';
    this.page = 1;
    this.clearSelection();
    this.load();
  }

  goToPage(page: number): void {
    this.page = page;
    this.clearSelection();
    this.load();
  }

  clearSelection(): void {
    this.selected = new Set<string>();
    this.bulkError.set(null);
  }

  toggleSelected(productId: string, event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const checked = target?.checked !== false;
    if (checked) {
      this.selected.add(productId);
    } else {
      this.selected.delete(productId);
    }
    if (this.selected.size === 0) {
      this.bulkError.set(null);
    }
  }

  allSelectedOnPage(): boolean {
    const items = this.products();
    if (!items.length) return false;
    return items.every((p) => this.selected.has(p.id));
  }

  toggleSelectAll(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const checked = target?.checked !== false;
    const ids = this.products().map((p) => p.id);
    const next = new Set(this.selected);
    if (checked) {
      ids.forEach((id) => next.add(id));
    } else {
      ids.forEach((id) => next.delete(id));
    }
    this.selected = next;
  }

  onBulkSaleValueChange(next: string | number): void {
    const raw = String(next ?? '');
    const { clean } = this.sanitizeMoneyInput(raw);
    this.bulkSaleValue = clean;
  }

  applySaleToSelected(): void {
    this.bulkError.set(null);
    const parsed = this.parseMoneyInput(this.bulkSaleValue);
    if (parsed === null) {
      this.bulkError.set(this.t('adminUi.products.bulk.valueRequired'));
      return;
    }
    if (this.bulkSaleType === 'percent' && (parsed < 0 || parsed > 100)) {
      this.bulkError.set(this.t('adminUi.products.sale.percentHint'));
      return;
    }
    const payload = Array.from(this.selected).map((id) => ({
      product_id: id,
      sale_type: this.bulkSaleType,
      sale_value: parsed
    }));
    this.bulkBusy.set(true);
    this.admin.bulkUpdateProducts(payload).subscribe({
      next: () => {
        this.bulkBusy.set(false);
        this.toast.success(this.t('adminUi.products.bulk.success'));
        this.clearSelection();
        this.load();
      },
      error: () => {
        this.bulkBusy.set(false);
        this.bulkError.set(this.t('adminUi.products.bulk.error'));
      }
    });
  }

  clearSaleForSelected(): void {
    this.bulkError.set(null);
    const payload = Array.from(this.selected).map((id) => ({
      product_id: id,
      sale_type: null,
      sale_value: null
    }));
    this.bulkBusy.set(true);
    this.admin.bulkUpdateProducts(payload).subscribe({
      next: () => {
        this.bulkBusy.set(false);
        this.toast.success(this.t('adminUi.products.bulk.success'));
        this.clearSelection();
        this.load();
      },
      error: () => {
        this.bulkBusy.set(false);
        this.bulkError.set(this.t('adminUi.products.bulk.error'));
      }
    });
  }

  publishSelected(): void {
    this.bulkError.set(null);
    const payload = Array.from(this.selected).map((id) => ({
      product_id: id,
      status: 'published'
    }));
    this.bulkBusy.set(true);
    this.admin.bulkUpdateProducts(payload).subscribe({
      next: () => {
        this.bulkBusy.set(false);
        this.toast.success(this.t('adminUi.products.bulk.published'));
        this.clearSelection();
        this.load();
      },
      error: () => {
        this.bulkBusy.set(false);
        this.bulkError.set(this.t('adminUi.products.bulk.error'));
      }
    });
  }

  startNew(): void {
    this.editorOpen.set(true);
    this.editingSlug.set(null);
    this.editorError.set(null);
    this.editorMessage.set(null);
    this.images.set([]);
    this.form = this.blankForm();
    this.basePriceError = '';
    this.saleValueError = '';
    this.resetTranslations();
    const first = this.adminCategories()[0];
    if (first) this.form.category_id = first.id;
  }

  closeEditor(): void {
    this.editorOpen.set(false);
    this.editingSlug.set(null);
    this.editorError.set(null);
    this.editorMessage.set(null);
    this.images.set([]);
    this.basePriceError = '';
    this.saleValueError = '';
    this.resetTranslations();
  }

  edit(slug: string): void {
    this.editorOpen.set(true);
    this.editorError.set(null);
    this.editorMessage.set(null);
    this.editingSlug.set(slug);
    this.basePriceError = '';
    this.saleValueError = '';
    this.resetTranslations();
    this.admin.getProduct(slug).subscribe({
      next: (prod: any) => {
        const basePrice = typeof prod.base_price === 'number' ? prod.base_price : Number(prod.base_price || 0);
        const rawSaleType = (prod.sale_type || '').toString();
        const saleType: 'percent' | 'amount' = rawSaleType === 'amount' ? 'amount' : 'percent';
        const saleValueNum =
          typeof prod.sale_value === 'number' ? prod.sale_value : Number(prod.sale_value ?? 0);
        const saleEnabled =
          (typeof prod.sale_price === 'number' && Number.isFinite(prod.sale_price)) ||
          (rawSaleType && Number.isFinite(saleValueNum) && saleValueNum > 0);
        this.form = {
          name: prod.name || '',
          category_id: prod.category_id || '',
          base_price: this.formatMoneyInput(Number.isFinite(basePrice) ? basePrice : 0),
          sale_enabled: saleEnabled,
          sale_type: saleType,
          sale_value: saleEnabled
            ? saleType === 'amount'
              ? this.formatMoneyInput(Number.isFinite(saleValueNum) ? saleValueNum : 0)
              : String(Math.round(saleValueNum * 100) / 100)
            : '',
          sale_start_at: prod.sale_start_at ? this.toLocalDateTime(prod.sale_start_at) : '',
          sale_end_at: prod.sale_end_at ? this.toLocalDateTime(prod.sale_end_at) : '',
          sale_auto_publish: !!prod.sale_auto_publish,
          stock_quantity: Number(prod.stock_quantity || 0),
          status: (prod.status as any) || 'draft',
          is_active: prod.is_active !== false,
          is_featured: !!prod.is_featured,
          sku: (prod.sku || '').toString(),
          short_description: (prod.short_description || '').toString(),
          long_description: (prod.long_description || '').toString(),
          publish_at: prod.publish_at ? this.toLocalDateTime(prod.publish_at) : '',
          is_bestseller: Array.isArray(prod.tags) ? prod.tags.includes('bestseller') : false
        };
        this.images.set(Array.isArray(prod.images) ? prod.images : []);
        this.loadTranslations((prod.slug || slug).toString());
      },
      error: () => this.editorError.set(this.t('adminUi.products.errors.load'))
    });
  }

  onBasePriceChange(next: string | number): void {
    const raw = String(next ?? '');
    const { clean, changed } = this.sanitizeMoneyInput(raw);
    this.form.base_price = clean;
    this.basePriceError = changed ? this.t('adminUi.products.form.priceFormatHint') : '';
  }

  onSaleEnabledChange(): void {
    if (this.form.sale_enabled) return;
    this.form.sale_value = '';
    this.form.sale_start_at = '';
    this.form.sale_end_at = '';
    this.form.sale_auto_publish = false;
    this.saleValueError = '';
  }

  onSaleTypeChange(): void {
    this.form.sale_value = '';
    this.saleValueError = '';
  }

  onSaleValueChange(next: string | number): void {
    const raw = String(next ?? '');
    const { clean, changed } = this.sanitizeMoneyInput(raw);
    this.form.sale_value = clean;
    if (!this.form.sale_enabled) {
      this.saleValueError = '';
      return;
    }
    if (this.form.sale_type === 'percent' && clean) {
      const parsed = Number(clean);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        this.saleValueError = this.t('adminUi.products.sale.percentHint');
        return;
      }
    }
    this.saleValueError = changed ? this.t('adminUi.products.sale.valueHint') : '';
  }

  save(): void {
    const basePrice = this.parseMoneyInput(this.form.base_price);
    if (basePrice === null) {
      this.editorError.set(this.t('adminUi.products.form.priceFormatHint'));
      return;
    }

    let sale_type: 'percent' | 'amount' | null = null;
    let sale_value: number | null = null;
    if (this.form.sale_enabled) {
      sale_type = this.form.sale_type;
      if (sale_type === 'amount') {
        const amount = this.parseMoneyInput(this.form.sale_value);
        if (amount === null) {
          this.editorError.set(this.t('adminUi.products.sale.valueHint'));
          return;
        }
        sale_value = amount;
      } else {
        const percent = this.parseMoneyInput(this.form.sale_value);
        if (percent === null || percent < 0 || percent > 100) {
          this.editorError.set(this.t('adminUi.products.sale.percentHint'));
          return;
        }
        sale_value = percent;
      }
    }

    if (this.form.sale_enabled && this.form.sale_auto_publish && !this.form.sale_start_at) {
      this.editorError.set(this.t('adminUi.products.sale.startRequired'));
      return;
    }

    const payload: any = {
      name: this.form.name,
      category_id: this.form.category_id,
      base_price: basePrice,
      sale_type,
      sale_value,
      sale_start_at: this.form.sale_enabled && this.form.sale_start_at ? new Date(this.form.sale_start_at).toISOString() : null,
      sale_end_at: this.form.sale_enabled && this.form.sale_end_at ? new Date(this.form.sale_end_at).toISOString() : null,
      sale_auto_publish: this.form.sale_enabled ? this.form.sale_auto_publish : false,
      stock_quantity: Number(this.form.stock_quantity),
      status: this.form.status,
      is_active: this.form.is_active,
      is_featured: this.form.is_featured,
      sku: this.form.sku || null,
      long_description: this.form.long_description || null,
      short_description: this.form.short_description.trim() ? this.form.short_description.trim().slice(0, 280) : null,
      publish_at: this.form.publish_at ? new Date(this.form.publish_at).toISOString() : null,
      tags: this.buildTags()
    };

    const slug = this.editingSlug();
    const op = slug ? this.admin.updateProduct(slug, payload) : this.admin.createProduct(payload);
    op.subscribe({
      next: (prod: any) => {
        this.toast.success(this.t('adminUi.products.success.save'));
        this.editorMessage.set(this.t('adminUi.products.success.save'));
        const newSlug = (prod?.slug as string | undefined) || slug || null;
        this.editingSlug.set(newSlug);
        this.images.set(Array.isArray(prod?.images) ? prod.images : this.images());
        if (prod?.status) this.form.status = prod.status;
        if (newSlug) this.loadTranslations(newSlug);
        this.load();
      },
      error: () => this.editorError.set(this.t('adminUi.products.errors.save'))
    });
  }

  saveTranslation(lang: 'en' | 'ro'): void {
    const slug = this.editingSlug();
    if (!slug) return;
    this.translationError.set(null);

    const name = this.translations[lang].name.trim();
    if (!name) {
      this.toast.error(this.t('adminUi.products.translations.errors.nameRequired'));
      return;
    }

    const payload = {
      name,
      short_description: this.translations[lang].short_description.trim()
        ? this.translations[lang].short_description.trim().slice(0, 280)
        : null,
      long_description: this.translations[lang].long_description.trim() ? this.translations[lang].long_description.trim() : null
    };

    this.admin.upsertProductTranslation(slug, lang, payload).subscribe({
      next: (updated) => {
        this.translationExists[lang] = true;
        this.translations[lang] = {
          ...this.translations[lang],
          name: updated.name || name,
          short_description: (updated.short_description || '').toString(),
          long_description: (updated.long_description || '').toString(),
          meta_title: (updated.meta_title || '').toString(),
          meta_description: (updated.meta_description || '').toString()
        };
        this.toast.success(this.t('adminUi.products.translations.success.save'));
      },
      error: () => this.translationError.set(this.t('adminUi.products.translations.errors.save'))
    });
  }

  deleteTranslation(lang: 'en' | 'ro'): void {
    const slug = this.editingSlug();
    if (!slug) return;
    this.translationError.set(null);
    this.admin.deleteProductTranslation(slug, lang).subscribe({
      next: () => {
        this.translationExists[lang] = false;
        this.translations[lang] = this.blankTranslationForm();
        this.toast.success(this.t('adminUi.products.translations.success.delete'));
      },
      error: () => this.translationError.set(this.t('adminUi.products.translations.errors.delete'))
    });
  }

  onUpload(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const file = target?.files?.[0];
    if (!file) return;
    const slug = this.editingSlug();
    if (!slug) {
      this.toast.error(this.t('adminUi.products.errors.saveFirst'));
      return;
    }
    this.admin.uploadProductImage(slug, file).subscribe({
      next: (prod: any) => {
        this.toast.success(this.t('adminUi.products.success.imageUpload'));
        this.images.set(Array.isArray(prod.images) ? prod.images : []);
        if (target) target.value = '';
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.image'))
    });
  }

  deleteImage(imageId: string): void {
    const slug = this.editingSlug();
    if (!slug) return;
    this.admin.deleteProductImage(slug, imageId).subscribe({
      next: (prod: any) => {
        this.toast.success(this.t('adminUi.products.success.imageDelete'));
        this.images.set(Array.isArray(prod.images) ? prod.images : []);
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.deleteImage'))
    });
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.productsApi
      .search({
        q: this.q.trim() ? this.q.trim() : undefined,
        status: this.status === 'all' ? undefined : this.status,
        category_slug: this.categorySlug || undefined,
        page: this.page,
        limit: this.limit
      })
      .subscribe({
        next: (res) => {
          this.products.set(res.items || []);
          this.meta.set(res.meta || null);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(this.t('adminUi.products.errors.loadList'));
          this.loading.set(false);
        }
      });
  }

  private loadCategories(): void {
    this.catalog.listCategories().subscribe({
      next: (cats) => this.categories.set(cats || []),
      error: () => this.categories.set([])
    });
  }

  private loadAdminCategories(): void {
    this.admin.getCategories().subscribe({
      next: (cats: any[]) => {
        const mapped = (cats || []).map((c) => ({ id: c.id, name: c.name }));
        this.adminCategories.set(mapped);
      },
      error: () => this.adminCategories.set([])
    });
  }

  statusPillClass(status: string): string {
    if (status === 'published') return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100';
    if (status === 'archived') return 'bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100';
    return 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100';
  }

  private sanitizeMoneyInput(raw: string): { clean: string; changed: boolean } {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return { clean: '', changed: false };
    let clean = '';
    let sawDot = false;
    for (const ch of trimmed) {
      if (ch >= '0' && ch <= '9') {
        clean += ch;
        continue;
      }
      if (ch === '.' && !sawDot) {
        sawDot = true;
        clean += '.';
      }
    }
    if (clean.startsWith('.')) clean = `0${clean}`;
    if (sawDot) {
      const [whole, fracRaw = ''] = clean.split('.', 2);
      const frac = fracRaw.slice(0, 2);
      clean = frac.length ? `${whole}.${frac}` : whole;
    }
    return { clean, changed: clean !== trimmed };
  }

  private parseMoneyInput(raw: string): number | null {
    const { clean } = this.sanitizeMoneyInput(raw);
    if (!clean) return null;
    const parsed = Number(clean);
    if (!Number.isFinite(parsed)) return null;
    return Math.round(parsed * 100) / 100;
  }

  private formatMoneyInput(value: number): string {
    if (!Number.isFinite(value)) return '';
    return (Math.round(value * 100) / 100).toFixed(2);
  }

  private blankForm(): ProductForm {
    return {
      name: '',
      category_id: '',
      base_price: '',
      sale_enabled: false,
      sale_type: 'percent',
      sale_value: '',
      sale_start_at: '',
      sale_end_at: '',
      sale_auto_publish: false,
      stock_quantity: 0,
      status: 'draft',
      is_active: true,
      is_featured: false,
      sku: '',
      short_description: '',
      long_description: '',
      publish_at: '',
      is_bestseller: false
    };
  }

  private blankTranslationForm(): ProductTranslationForm {
    return {
      name: '',
      short_description: '',
      long_description: '',
      meta_title: '',
      meta_description: ''
    };
  }

  private resetTranslations(): void {
    this.translationLoading.set(false);
    this.translationError.set(null);
    this.translationExists = { en: false, ro: false };
    this.translations = { en: this.blankTranslationForm(), ro: this.blankTranslationForm() };
  }

  private loadTranslations(slug: string): void {
    this.translationLoading.set(true);
    this.translationError.set(null);
    this.admin.getProductTranslations(slug).subscribe({
      next: (items) => {
        const mapped: Record<'en' | 'ro', ProductTranslationForm> = {
          en: this.blankTranslationForm(),
          ro: this.blankTranslationForm()
        };
        const exists: Record<'en' | 'ro', boolean> = { en: false, ro: false };
        for (const t of items || []) {
          if (t.lang !== 'en' && t.lang !== 'ro') continue;
          exists[t.lang] = true;
          mapped[t.lang] = {
            name: (t.name || '').toString(),
            short_description: (t.short_description || '').toString(),
            long_description: (t.long_description || '').toString(),
            meta_title: (t.meta_title || '').toString(),
            meta_description: (t.meta_description || '').toString()
          };
        }
        this.translationExists = exists;
        this.translations = mapped;
        this.translationLoading.set(false);
      },
      error: () => {
        this.translationError.set(this.t('adminUi.products.translations.errors.load'));
        this.translationLoading.set(false);
      }
    });
  }

  private buildTags(): string[] {
    const tags: string[] = [];
    if (this.form.is_bestseller) tags.push('bestseller');
    return tags;
  }

  private toLocalDateTime(value: string): string {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private t(key: string): string {
    return this.translate.instant(key) as string;
  }
}
