import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { extractRequestId } from '../../../shared/http-error';
import { InputComponent } from '../../../shared/input.component';
import { HelpPanelComponent } from '../../../shared/help-panel.component';
import { ModalComponent } from '../../../shared/modal.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import {
  AdminProductDuplicateCheckResponse,
  AdminProductListItem,
  AdminProductListResponse,
  AdminProductsService,
} from '../../../core/admin-products.service';
import { CatalogService, Category } from '../../../core/catalog.service';
import { MarkdownService } from '../../../core/markdown.service';
import { LocalizedCurrencyPipe } from '../../../shared/localized-currency.pipe';
import {
  AdminCategory,
  AdminCategoriesImportResult,
  AdminCategoryDeletePreview,
  AdminCategoryMergePreview,
  AdminDeletedProductImage,
  AdminProductAuditEntry,
  AdminProductImageOptimizationStats,
  AdminProductImageTranslation,
  AdminProductsImportResult,
  AdminProductVariant,
  AdminService,
  StockAdjustment,
  StockAdjustmentReason,
} from '../../../core/admin.service';
import { AdminRecentService } from '../../../core/admin-recent.service';
import { ToastService } from '../../../core/toast.service';
import { AuthService } from '../../../core/auth.service';
import { AdminFavoriteItem, AdminFavoritesService } from '../../../core/admin-favorites.service';
import { AdminUiPrefsService } from '../../../core/admin-ui-prefs.service';
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

type ProductStatusFilter = 'all' | 'draft' | 'published' | 'archived';
type ProductTranslationFilter = 'all' | 'missing_any' | 'missing_en' | 'missing_ro';
type ProductView = 'active' | 'deleted';

type ProductWizardKind = 'create' | 'publish';
type ProductWizardStepId = 'basics' | 'content' | 'save' | 'images' | 'publish';

type ProductWizardStep = {
  id: ProductWizardStepId;
  labelKey: string;
  descriptionKey: string;
  anchorId: string;
};

const PRODUCT_CREATE_WIZARD_STEPS: ProductWizardStep[] = [
  {
    id: 'basics',
    labelKey: 'adminUi.products.wizard.steps.basics',
    descriptionKey: 'adminUi.products.wizard.desc.basics',
    anchorId: 'product-wizard-top'
  },
  {
    id: 'content',
    labelKey: 'adminUi.products.wizard.steps.content',
    descriptionKey: 'adminUi.products.wizard.desc.content',
    anchorId: 'product-wizard-content'
  },
  {
    id: 'save',
    labelKey: 'adminUi.products.wizard.steps.save',
    descriptionKey: 'adminUi.products.wizard.desc.save',
    anchorId: 'product-wizard-save'
  },
  {
    id: 'images',
    labelKey: 'adminUi.products.wizard.steps.images',
    descriptionKey: 'adminUi.products.wizard.desc.images',
    anchorId: 'product-wizard-images'
  },
  {
    id: 'publish',
    labelKey: 'adminUi.products.wizard.steps.publish',
    descriptionKey: 'adminUi.products.wizard.desc.publish',
    anchorId: 'product-wizard-publish'
  }
];

const PRODUCT_PUBLISH_WIZARD_STEPS: ProductWizardStep[] = [
  {
    id: 'content',
    labelKey: 'adminUi.products.wizard.steps.review',
    descriptionKey: 'adminUi.products.wizard.desc.review',
    anchorId: 'product-wizard-content'
  },
  {
    id: 'images',
    labelKey: 'adminUi.products.wizard.steps.images',
    descriptionKey: 'adminUi.products.wizard.desc.images',
    anchorId: 'product-wizard-images'
  },
  {
    id: 'publish',
    labelKey: 'adminUi.products.wizard.steps.publish',
    descriptionKey: 'adminUi.products.wizard.desc.publish',
    anchorId: 'product-wizard-publish'
  }
];

const PRODUCTS_TABLE_COLUMNS: AdminTableLayoutColumnDef[] = [
  { id: 'select', labelKey: 'adminUi.products.table.select', required: true },
  { id: 'name', labelKey: 'adminUi.products.table.name', required: true },
  { id: 'price', labelKey: 'adminUi.products.table.price' },
  { id: 'status', labelKey: 'adminUi.products.table.status' },
  { id: 'category', labelKey: 'adminUi.products.table.category' },
  { id: 'stock', labelKey: 'adminUi.products.table.stock' },
  { id: 'active', labelKey: 'adminUi.products.table.active' },
  { id: 'updated', labelKey: 'adminUi.products.table.updated' },
  { id: 'actions', labelKey: 'adminUi.products.table.actions', required: true }
];

const defaultProductsTableLayout = (): AdminTableLayoutV1 => ({
  ...defaultAdminTableLayout(PRODUCTS_TABLE_COLUMNS),
  hidden: ['category', 'active', 'updated']
});

type ProductBadgeKey = 'new' | 'limited' | 'handmade';

type BadgeForm = {
  enabled: boolean;
  start_at: string;
  end_at: string;
};

type ProductForm = {
  name: string;
  category_id: string;
  base_price: string;
  weight_grams: string;
  width_cm: string;
  height_cm: string;
  depth_cm: string;
  shipping_class: 'standard' | 'bulky' | 'oversize';
  shipping_allow_locker: boolean;
  shipping_disallowed_couriers: { sameday: boolean; fan_courier: boolean };
  sale_enabled: boolean;
  sale_type: 'percent' | 'amount';
  sale_value: string;
  sale_start_at: string;
  sale_end_at: string;
  sale_auto_publish: boolean;
  stock_quantity: number;
  low_stock_threshold: string;
  status: 'draft' | 'published' | 'archived';
  is_active: boolean;
  is_featured: boolean;
  sku: string;
  short_description: string;
  long_description: string;
  publish_at: string;
  is_bestseller: boolean;
  badges: Record<ProductBadgeKey, BadgeForm>;
};

type ProductTranslationForm = {
  name: string;
  short_description: string;
  long_description: string;
  meta_title: string;
  meta_description: string;
};

type ImageMetaForm = {
  alt_text: string;
  caption: string;
};

type ImageMetaByLang = Record<'en' | 'ro', ImageMetaForm>;

type VariantRow = {
  id?: string;
  name: string;
  additional_price_delta: string;
  stock_quantity: number;
};

type PriceChangeEvent = {
  at: string;
  before: number;
  after: number;
  user: string | null;
};

type PriceHistoryChart = {
  width: number;
  height: number;
  pad: number;
  polyline: string;
  dots: Array<{ x: number; y: number }>;
  min: number;
  max: number;
  latest: number;
  nowX: number | null;
  saleRect: { x: number; width: number } | null;
};

@Component({
  selector: 'app-admin-products',
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
    HelpPanelComponent,
    ModalComponent,
    SkeletonComponent,
    LocalizedCurrencyPipe,
    TableLayoutModalComponent,
    AdminPageHeaderComponent
  ],
  template: `
      <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

	      <app-admin-page-header [titleKey]="'adminUi.products.title'" [hintKey]="'adminUi.products.hint'">
	        <ng-template #primaryActions>
	          <app-button size="sm" variant="ghost" [label]="'adminUi.products.wizard.start' | translate" (action)="startCreateWizard()"></app-button>
	          <app-button size="sm" [label]="'adminUi.products.new' | translate" (action)="startNew()"></app-button>
	        </ng-template>

	        <ng-template #secondaryActions>
	          <app-button size="sm" variant="ghost" [label]="'adminUi.products.csv.export' | translate" (action)="exportProductsCsv()"></app-button>
	          <app-button size="sm" variant="ghost" [label]="'adminUi.products.csv.import' | translate" (action)="openCsvImport()"></app-button>
	          <app-button size="sm" variant="ghost" [label]="densityToggleLabelKey() | translate" (action)="toggleDensity()"></app-button>
	          <app-button size="sm" variant="ghost" [label]="'adminUi.tableLayout.title' | translate" (action)="openLayoutModal()"></app-button>
	          <app-button size="sm" variant="ghost" [label]="'adminUi.categories.title' | translate" (action)="openCategoryManager()"></app-button>
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

      <app-modal
        [open]="csvImportOpen()"
        [title]="'adminUi.products.csv.title' | translate"
        [subtitle]="'adminUi.products.csv.hint' | translate"
        [showActions]="false"
        [closeLabel]="'adminUi.actions.cancel' | translate"
        (closed)="closeCsvImport()"
      >
        <div class="grid gap-3">
          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.products.csv.file' | translate }}
            <input
              type="file"
              accept=".csv"
              (change)="onCsvImportFileChange($event)"
              class="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-700 dark:file:bg-slate-100 dark:file:text-slate-900 dark:hover:file:bg-slate-200"
            />
          </label>

          <div *ngIf="csvImportFile()" class="text-xs text-slate-500 dark:text-slate-400">
            {{ csvImportFile()?.name }}
          </div>

          <div
            *ngIf="csvImportError()"
            class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
          >
            {{ csvImportError() }}
          </div>

          <div *ngIf="csvImportBusy()" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'adminUi.actions.loading' | translate }}
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <app-button size="sm" variant="ghost" [label]="'adminUi.actions.cancel' | translate" (action)="closeCsvImport()"></app-button>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'adminUi.products.csv.dryRun' | translate"
              (action)="runCsvImport(true)"
              [disabled]="csvImportBusy() || !csvImportFile()"
            ></app-button>
            <app-button
              size="sm"
              [label]="'adminUi.products.csv.apply' | translate"
              (action)="runCsvImport(false)"
              [disabled]="csvImportBusy() || !csvImportCanApply()"
            ></app-button>
          </div>

          <div
            *ngIf="csvImportResult() as result"
            class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20"
          >
            <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
              {{ 'adminUi.products.csv.result' | translate }}
            </p>
            <div class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
              <div>{{ 'adminUi.products.csv.created' | translate }}: {{ result.created }}</div>
              <div>{{ 'adminUi.products.csv.updated' | translate }}: {{ result.updated }}</div>
            </div>

            <div *ngIf="(result.errors || []).length > 0; else csvNoErrors" class="grid gap-2">
              <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                {{ 'adminUi.products.csv.errorsTitle' | translate }}
              </p>
              <ul class="list-disc pl-5 text-xs text-slate-600 dark:text-slate-300">
                <li *ngFor="let err of result.errors">{{ err }}</li>
              </ul>
            </div>
            <ng-template #csvNoErrors>
              <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.products.csv.noErrors' | translate }}</p>
            </ng-template>
          </div>
        </div>
      </app-modal>

      <app-modal
        [open]="statusConfirmOpen()"
        [title]="'adminUi.products.confirmStatus.title' | translate"
        [subtitle]="'adminUi.products.confirmStatus.subtitle' | translate"
        [closeLabel]="'adminUi.actions.cancel' | translate"
        [cancelLabel]="'adminUi.actions.cancel' | translate"
        [confirmLabel]="statusConfirmBusy() ? ('adminUi.actions.loading' | translate) : ('adminUi.actions.save' | translate)"
        [confirmDisabled]="statusConfirmBusy()"
        (closed)="closeStatusConfirm()"
        (confirm)="confirmStatusChange()"
      >
        <div class="grid gap-3">
          <div
            *ngIf="statusConfirmPrev() as prev"
            class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20"
          >
            <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {{ 'adminUi.products.confirmStatus.summary' | translate }}
            </p>
            <p class="mt-1 text-sm text-slate-900 dark:text-slate-50">
              <span class="font-semibold">{{ ('adminUi.status.' + prev.status) | translate }}</span>
              →
              <span class="font-semibold">{{ ('adminUi.status.' + (statusConfirmTarget()?.status || form.status)) | translate }}</span>
            </p>
          </div>

          <ul class="list-disc pl-5 text-sm text-slate-700 dark:text-slate-200">
            <li *ngIf="(statusConfirmTarget()?.status || form.status) === 'published'">
              {{ 'adminUi.products.confirmStatus.points.published' | translate }}
            </li>
            <li *ngIf="(statusConfirmTarget()?.status || form.status) === 'draft'">
              {{ 'adminUi.products.confirmStatus.points.draft' | translate }}
            </li>
            <li *ngIf="(statusConfirmTarget()?.status || form.status) === 'archived'">
              {{ 'adminUi.products.confirmStatus.points.archived' | translate }}
            </li>
            <li>{{ 'adminUi.products.confirmStatus.points.audit' | translate }}</li>
          </ul>
        </div>
      </app-modal>

      <app-modal
        [open]="bulkStatusConfirmOpen()"
        [title]="'adminUi.products.bulk.status.title' | translate: { count: selected.size }"
        [subtitle]="'adminUi.products.bulk.status.subtitle' | translate"
        [closeLabel]="'adminUi.actions.cancel' | translate"
        [cancelLabel]="'adminUi.actions.cancel' | translate"
        [confirmLabel]="bulkStatusConfirmBusy() ? ('adminUi.actions.loading' | translate) : ('adminUi.products.bulk.status.apply' | translate)"
        [confirmDisabled]="bulkStatusConfirmBusy()"
        (closed)="closeBulkStatusConfirm()"
        (confirm)="confirmBulkStatusChange()"
      >
        <div class="grid gap-3">
          <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
            <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {{ 'adminUi.products.bulk.status.target' | translate }}
            </p>
            <p class="mt-1 text-sm text-slate-900 dark:text-slate-50">
              <span class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold" [ngClass]="statusPillClass(bulkStatusTarget)">
                {{ ('adminUi.status.' + bulkStatusTarget) | translate }}
              </span>
            </p>
          </div>

          <div class="grid gap-2">
            <div
              *ngFor="let product of selectedProductsOnPage(); trackBy: trackProductId"
              class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <div class="min-w-0">
                <p class="font-semibold text-slate-900 dark:text-slate-50 truncate">{{ product.name }}</p>
                <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ product.slug }}</p>
              </div>
              <div class="flex items-center gap-2">
                <span class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold" [ngClass]="statusPillClass(product.status)">
                  {{ ('adminUi.status.' + product.status) | translate }}
                </span>
                <span class="text-slate-400">→</span>
                <span class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold" [ngClass]="statusPillClass(bulkStatusTarget)">
                  {{ ('adminUi.status.' + bulkStatusTarget) | translate }}
                </span>
              </div>
            </div>
          </div>

          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ 'adminUi.products.bulk.status.undoHint' | translate }}
          </p>

          <div
            *ngIf="bulkError()"
            class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-2 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
          >
            {{ bulkError() }}
          </div>
        </div>
      </app-modal>

      <app-modal
        [open]="categoryManagerOpen()"
        [title]="'adminUi.categories.title' | translate"
        [showActions]="false"
        [closeLabel]="'adminUi.actions.cancel' | translate"
        (closed)="closeCategoryManager()"
      >
        <div class="grid gap-4">
          <div class="flex flex-wrap items-end justify-between gap-2">
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 flex-1">
              {{ 'adminUi.products.table.category' | translate }}
              <select
                class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="categoryManagerSlug"
                (ngModelChange)="onCategoryManagerSelect($event)"
              >
                <option value="">{{ 'adminUi.products.selectCategory' | translate }}</option>
                <option *ngFor="let cat of categories()" [value]="cat.slug">{{ cat.name }}</option>
              </select>
            </label>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'adminUi.categories.add' | translate"
              (action)="openCreateCategoryFromManager()"
              [disabled]="categoryManagerUpdateBusy() || mergeSaving() || deleteSaving()"
            ></app-button>
          </div>

          <div *ngIf="categoryManagerSelectedCategory() as cat" class="grid gap-4">
            <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
              <p class="font-semibold text-slate-900 dark:text-slate-50">{{ cat.name }}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.categories.slug' | translate }}: {{ cat.slug }}</p>
            </div>

            <div class="grid gap-2">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.categories.parent' | translate }}
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="categoryManagerParentId"
                  [disabled]="categoryManagerUpdateBusy() || mergePreviewLoading() || mergeSaving() || deletePreviewLoading() || deleteSaving()"
                >
                  <option value="">{{ 'adminUi.categories.parentNone' | translate }}</option>
                  <option *ngFor="let parent of categoryParentOptions(cat)" [value]="parent.id">{{ parent.name }}</option>
                </select>
              </label>
              <div class="flex items-center justify-end gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.actions.reset' | translate"
                  (action)="resetCategoryManagerParent()"
                  [disabled]="categoryManagerUpdateBusy()"
                ></app-button>
                <app-button
                  size="sm"
                  [label]="categoryManagerUpdateBusy() ? ('adminUi.actions.loading' | translate) : ('adminUi.actions.save' | translate)"
                  (action)="saveCategoryManagerParent()"
                  [disabled]="categoryManagerUpdateBusy()"
                ></app-button>
              </div>
              <p *ngIf="categoryManagerUpdateError()" class="text-xs text-rose-700 dark:text-rose-300">
                {{ categoryManagerUpdateError() }}
              </p>
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
                  class="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="mergeTargetSlug"
                  (ngModelChange)="onMergeTargetChange()"
                  [disabled]="categoryManagerUpdateBusy() || mergePreviewLoading() || mergeSaving() || deletePreviewLoading() || deleteSaving()"
                >
                  <option value="">{{ 'adminUi.storefront.categories.mergeSelectPlaceholder' | translate }}</option>
                  <option *ngFor="let target of mergeTargetOptions(cat)" [value]="target.slug">{{ target.name }}</option>
                </select>
              </label>
              <p *ngIf="mergePreview() as preview" class="text-xs text-slate-600 dark:text-slate-300">
                {{
                  'adminUi.storefront.categories.mergePreviewInfo'
                    | translate : { products: preview.product_count, children: preview.child_count }
                }}
              </p>
              <p *ngIf="mergeError()" class="text-xs text-rose-700 dark:text-rose-300">{{ mergeError() }}</p>
              <div class="flex flex-wrap justify-end gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="mergePreviewLoading() ? ('adminUi.actions.loading' | translate) : ('adminUi.storefront.categories.mergePreview' | translate)"
                  [disabled]="mergePreviewLoading() || mergeSaving() || !mergeTargetSlug"
                  (action)="previewCategoryMerge()"
                ></app-button>
                <app-button
                  size="sm"
                  [label]="mergeSaving() ? ('adminUi.actions.loading' | translate) : ('adminUi.storefront.categories.mergeAction' | translate)"
                  [disabled]="mergeSaving() || !(mergePreview()?.can_merge)"
                  (action)="mergeCategorySelected()"
                ></app-button>
              </div>
            </div>

            <div class="grid gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/40 dark:bg-rose-950/30">
              <p class="text-xs font-semibold text-rose-900 dark:text-rose-100">
                {{ 'adminUi.storefront.categories.deleteTitle' | translate }}
              </p>
              <p *ngIf="deletePreview() as preview" class="text-xs text-rose-800 dark:text-rose-200">
                {{
                  'adminUi.storefront.categories.deletePreviewInfo'
                    | translate : { products: preview.product_count, children: preview.child_count }
                }}
              </p>
              <p *ngIf="deleteError()" class="text-xs text-rose-800 dark:text-rose-200">{{ deleteError() }}</p>
              <div class="flex flex-wrap justify-end gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="deletePreviewLoading() ? ('adminUi.actions.loading' | translate) : ('adminUi.storefront.categories.deletePreview' | translate)"
                  [disabled]="deletePreviewLoading() || deleteSaving()"
                  (action)="previewCategoryDelete()"
                ></app-button>
                <app-button
                  size="sm"
                  [label]="deleteSaving() ? ('adminUi.actions.loading' | translate) : ('adminUi.storefront.categories.deleteAction' | translate)"
                  [disabled]="deleteSaving() || !(deletePreview()?.can_delete)"
                  (action)="deleteCategorySelectedSafe()"
                ></app-button>
              </div>
            </div>
          </div>

          <details
            class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-200"
          >
            <summary class="cursor-pointer select-none font-semibold text-slate-900 dark:text-slate-50">
              {{ 'adminUi.categories.csv.title' | translate }}
            </summary>

            <div class="mt-3 grid gap-3">
              <p class="text-xs text-slate-600 dark:text-slate-300">{{ 'adminUi.categories.csv.hint' | translate }}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.categories.csv.formatHint' | translate }}</p>

              <div class="flex flex-wrap justify-end gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.categories.csv.downloadTemplate' | translate"
                  (action)="downloadCategoriesCsv(true)"
                  [disabled]="categoryImportBusy()"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.categories.csv.export' | translate"
                  (action)="downloadCategoriesCsv(false)"
                  [disabled]="categoryImportBusy()"
                ></app-button>
              </div>

              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.categories.csv.file' | translate }}
                <input
                  type="file"
                  accept=".csv"
                  (change)="onCategoryImportFileChange($event)"
                  class="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-700 dark:file:bg-slate-100 dark:file:text-slate-900 dark:hover:file:bg-slate-200"
                />
              </label>

              <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" [(ngModel)]="categoryImportDryRun" [disabled]="categoryImportBusy()" />
                {{ 'adminUi.categories.csv.dryRun' | translate }}
              </label>

              <div class="flex justify-end">
                <app-button
                  size="sm"
                  [label]="categoryImportBusy() ? ('adminUi.actions.loading' | translate) : ('adminUi.categories.csv.run' | translate)"
                  (action)="runCategoryImport()"
                  [disabled]="categoryImportBusy() || !categoryImportFile"
                ></app-button>
              </div>

              <p *ngIf="categoryImportError()" class="text-sm text-rose-700 dark:text-rose-300">{{ categoryImportError() }}</p>

              <div *ngIf="categoryImportResult() as result" class="grid gap-2">
                <p class="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  {{ 'adminUi.categories.csv.result' | translate }}
                </p>
                <div class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
                  <div>{{ 'adminUi.categories.csv.created' | translate }}: {{ result.created }}</div>
                  <div>{{ 'adminUi.categories.csv.updated' | translate }}: {{ result.updated }}</div>
                </div>

                <div *ngIf="(result.errors || []).length > 0; else categoryCsvNoErrors" class="grid gap-2">
                  <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    {{ 'adminUi.categories.csv.errorsTitle' | translate }}
                  </p>
                  <ul class="list-disc pl-5 text-xs text-slate-600 dark:text-slate-300">
                    <li *ngFor="let err of result.errors">{{ err }}</li>
                  </ul>
                </div>
                <ng-template #categoryCsvNoErrors>
                  <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.categories.csv.noErrors' | translate }}</p>
                </ng-template>
              </div>
            </div>
          </details>
        </div>
      </app-modal>

      <app-modal
        [open]="createCategoryOpen()"
        [title]="'adminUi.categories.add' | translate"
        [subtitle]="'adminUi.categories.slugAutoHint' | translate"
        [closeLabel]="'adminUi.actions.cancel' | translate"
        [cancelLabel]="'adminUi.actions.cancel' | translate"
        [confirmLabel]="createCategoryBusy() ? ('adminUi.actions.loading' | translate) : ('adminUi.categories.add' | translate)"
        [confirmDisabled]="createCategoryBusy() || !createCategoryName.trim()"
        (closed)="closeCreateCategory()"
        (confirm)="confirmCreateCategory()"
      >
        <div class="grid gap-3">
          <app-input
            [label]="'adminUi.products.table.name' | translate"
            [(value)]="createCategoryName"
            [disabled]="createCategoryBusy()"
          ></app-input>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.categories.parent' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="createCategoryParentId"
              [disabled]="createCategoryBusy()"
            >
              <option value="">{{ 'adminUi.categories.parentNone' | translate }}</option>
              <option *ngFor="let cat of categories()" [value]="cat.id">{{ cat.name }}</option>
            </select>
          </label>

          <p class="text-xs text-slate-500 dark:text-slate-400">
            {{ 'adminUi.categories.wizard.desc.translations' | translate }}
          </p>

          <div
            *ngIf="createCategoryError()"
            class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-2 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
          >
            {{ createCategoryError() }}
          </div>
        </div>
      </app-modal>

      <app-modal
        [open]="deleteImageConfirmOpen()"
        [title]="'adminUi.products.confirmDeleteImage.title' | translate"
        [subtitle]="'adminUi.products.confirmDeleteImage.subtitle' | translate"
        [closeLabel]="'adminUi.actions.cancel' | translate"
        [cancelLabel]="'adminUi.actions.cancel' | translate"
        [confirmLabel]="deleteImageConfirmBusy() ? ('adminUi.actions.loading' | translate) : ('adminUi.actions.delete' | translate)"
        [confirmDisabled]="deleteImageConfirmBusy()"
        (closed)="closeDeleteImageConfirm()"
        (confirm)="confirmDeleteImage()"
      >
        <div class="grid gap-3">
          <div
            *ngIf="deleteImageConfirmTarget() as target"
            class="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20"
          >
            <img [src]="target.url" [alt]="target.alt" class="h-12 w-12 rounded object-cover" />
            <div class="min-w-0">
              <p class="font-semibold text-slate-900 dark:text-slate-50 truncate">{{ target.alt }}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ target.url }}</p>
            </div>
          </div>

          <ul class="list-disc pl-5 text-sm text-slate-700 dark:text-slate-200">
            <li>{{ 'adminUi.products.confirmDeleteImage.points.storefront' | translate }}</li>
            <li>{{ 'adminUi.products.confirmDeleteImage.points.restore' | translate }}</li>
            <li>{{ 'adminUi.products.confirmDeleteImage.points.metadata' | translate }}</li>
          </ul>
        </div>
      </app-modal>

	      <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
          <app-help-panel
            [titleKey]="'adminUi.help.title'"
            [subtitleKey]="'adminUi.products.help.subtitle'"
            [mediaSrc]="'assets/help/admin-products-help.svg'"
            [mediaAltKey]="'adminUi.products.help.mediaAlt'"
          >
            <ul class="list-disc pl-5 text-xs text-slate-600 dark:text-slate-300">
              <li>{{ 'adminUi.products.help.points.search' | translate }}</li>
              <li>{{ 'adminUi.products.help.points.bulk' | translate }}</li>
              <li>{{ 'adminUi.products.help.points.columns' | translate }}</li>
              <li>{{ 'adminUi.products.help.points.wizard' | translate }}</li>
            </ul>
          </app-help-panel>

          <div class="flex flex-wrap items-center gap-3">
            <div class="inline-flex overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <button
                type="button"
                class="px-3 py-1.5 text-xs font-semibold"
                [class.bg-slate-900]="status === 'all'"
                [class.text-white]="status === 'all'"
                [class.text-slate-700]="status !== 'all'"
                [class.dark:text-slate-200]="status !== 'all'"
                (click)="setStatusFilter('all')"
              >
                {{ 'adminUi.products.all' | translate }}
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-xs font-semibold"
                [class.bg-slate-900]="status === 'draft'"
                [class.text-white]="status === 'draft'"
                [class.text-slate-700]="status !== 'draft'"
                [class.dark:text-slate-200]="status !== 'draft'"
                (click)="setStatusFilter('draft')"
              >
                {{ 'adminUi.status.draft' | translate }}
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-xs font-semibold"
                [class.bg-slate-900]="status === 'published'"
                [class.text-white]="status === 'published'"
                [class.text-slate-700]="status !== 'published'"
                [class.dark:text-slate-200]="status !== 'published'"
                (click)="setStatusFilter('published')"
              >
                {{ 'adminUi.status.published' | translate }}
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-xs font-semibold"
                [class.bg-slate-900]="status === 'archived'"
                [class.text-white]="status === 'archived'"
                [class.text-slate-700]="status !== 'archived'"
                [class.dark:text-slate-200]="status !== 'archived'"
                (click)="setStatusFilter('archived')"
              >
                {{ 'adminUi.status.archived' | translate }}
              </button>
            </div>
          </div>

		        <div class="flex flex-wrap items-end gap-3">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 flex-1 min-w-[260px]">
                {{ 'adminUi.products.search' | translate }}
                <div class="relative">
                  <input
                    id="admin-products-search"
                    role="combobox"
                    aria-autocomplete="list"
                    [attr.aria-expanded]="productSearchOpen() ? 'true' : 'false'"
                    [attr.aria-controls]="'admin-products-search-listbox'"
                    [attr.aria-activedescendant]="productSearchActiveDescendant()"
                    class="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [placeholder]="'adminUi.products.searchPlaceholder' | translate"
                    [(ngModel)]="q"
                    (ngModelChange)="onProductSearchChange()"
                    (focus)="openProductSearch()"
                    (blur)="onProductSearchBlur()"
                    (keydown)="onProductSearchKeydown($event)"
                    autocomplete="off"
                    spellcheck="false"
                  />

                  <div
                    *ngIf="productSearchOpen()"
                    class="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div id="admin-products-search-listbox" role="listbox" class="max-h-72 overflow-auto">
                      <div
                        *ngIf="productSearchLoading()"
                        role="option"
                        aria-disabled="true"
                        class="px-3 py-2 text-xs text-slate-600 dark:text-slate-300"
                      >
                        {{ 'adminUi.actions.loading' | translate }}
                      </div>
                      <div
                        *ngIf="productSearchError()"
                        role="option"
                        aria-disabled="true"
                        class="px-3 py-2 text-xs text-rose-700 dark:text-rose-300"
                      >
                        {{ productSearchError() }}
                      </div>

                      <ng-container *ngIf="!productSearchLoading() && !productSearchError()">
                        <div
                          *ngIf="productSearchResults().length === 0 && (q || '').trim().length >= 2"
                          role="option"
                          aria-disabled="true"
                          class="px-3 py-2 text-xs text-slate-600 dark:text-slate-300"
                        >
                          {{ 'adminUi.products.searchNoMatches' | translate }}
                        </div>

                        <button
                          *ngFor="let item of productSearchResults(); let i = index"
                          type="button"
                          role="option"
                          tabindex="-1"
                          [id]="'admin-products-search-option-' + i"
                          [attr.aria-selected]="i === productSearchActiveIndex() ? 'true' : 'false'"
                          class="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60"
                          [class.bg-slate-50]="i === productSearchActiveIndex()"
                          [class.dark:bg-slate-800/60]="i === productSearchActiveIndex()"
                          (mousedown)="selectProductSearch(item, $event)"
                        >
                          <div class="flex items-center justify-between gap-3">
                            <span class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 truncate">
                              {{ item.sku || item.slug }}
                            </span>
                            <span class="inline-flex items-center gap-2">
                              <span
                                class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold"
                                [ngClass]="statusPillClass(item.status)"
                              >
                                {{ ('adminUi.status.' + item.status) | translate }}
                              </span>
                              <span *ngIf="item.status === 'published'" class="text-xs text-slate-500 dark:text-slate-400">
                                {{ item.is_active ? ('adminUi.products.active' | translate) : ('adminUi.products.inactive' | translate) }}
                              </span>
                            </span>
                          </div>
                          <div class="mt-1 font-medium text-slate-900 dark:text-slate-50 truncate">{{ item.name }}</div>
                          <div class="text-xs text-slate-600 dark:text-slate-300 truncate">{{ item.slug }}</div>
                        </button>
                      </ng-container>
                    </div>
                  </div>
                </div>
              </label>

	          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 w-full sm:w-auto min-w-[180px]">
	            {{ 'adminUi.products.table.view' | translate }}
	            <select
	              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	              [(ngModel)]="view"
	            >
	              <option value="active">{{ 'adminUi.products.view.active' | translate }}</option>
	              <option value="deleted">{{ 'adminUi.products.view.deleted' | translate }}</option>
	            </select>
	          </label>

	          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 w-full sm:w-auto min-w-[200px]">
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

          <div class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 w-full sm:w-auto min-w-[220px]">
            <div class="flex items-center justify-between gap-2">
              <span>{{ 'adminUi.products.table.category' | translate }}</span>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.categories.add' | translate"
                (action)="openCreateCategory('filters')"
                [disabled]="loading()"
              ></app-button>
            </div>
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="categorySlug"
            >
              <option value="">{{ 'adminUi.products.allCategories' | translate }}</option>
              <option *ngFor="let cat of categories()" [value]="cat.slug">{{ cat.name }}</option>
            </select>
          </div>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 w-full sm:w-auto min-w-[220px]">
            {{ 'adminUi.products.table.translations' | translate }}
            <select
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="translationFilter"
            >
              <option value="all">{{ 'adminUi.products.translations.filter.all' | translate }}</option>
              <option value="missing_any">{{ 'adminUi.products.translations.filter.missingAny' | translate }}</option>
              <option value="missing_en">{{ 'adminUi.products.translations.filter.missingEn' | translate }}</option>
              <option value="missing_ro">{{ 'adminUi.products.translations.filter.missingRo' | translate }}</option>
            </select>
          </label>

	          <div class="flex items-center gap-2 w-full sm:w-auto sm:ml-auto">
	            <app-button size="sm" [label]="'adminUi.actions.refresh' | translate" (action)="applyFilters()"></app-button>
	            <app-button size="sm" variant="ghost" [label]="'adminUi.actions.reset' | translate" (action)="resetFilters()"></app-button>
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

	          <div
	            *ngIf="selected.size > 0 && view === 'active'"
              id="admin-products-bulk-actions"
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
                [disabled]="bulkBusy() || inlineBusy()"
              ></app-button>
            </div>

            <div class="grid gap-3 lg:grid-cols-[200px_240px_auto_auto] items-end">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.products.sale.type' | translate }}
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="bulkSaleType"
                  (change)="bulkSaleValue = ''"
                  [disabled]="bulkBusy() || inlineBusy()"
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
                [disabled]="bulkBusy() || inlineBusy()"
              ></app-input>

              <app-button
                size="sm"
                [label]="'adminUi.products.bulk.applySale' | translate"
                (action)="applySaleToSelected()"
                [disabled]="bulkBusy() || inlineBusy()"
              ></app-button>

              <div class="flex flex-wrap gap-2 justify-end">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.products.bulk.clearSale' | translate"
                  (action)="clearSaleForSelected()"
                  [disabled]="bulkBusy() || inlineBusy()"
                ></app-button>
              </div>
            </div>

            <div class="grid gap-3 lg:grid-cols-[240px_auto] items-end">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.products.table.status' | translate }}
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="bulkStatusTarget"
                  [disabled]="bulkBusy() || inlineBusy()"
                >
                  <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
                  <option value="published">{{ 'adminUi.status.published' | translate }}</option>
                  <option value="archived">{{ 'adminUi.status.archived' | translate }}</option>
                </select>
              </label>

              <div class="flex flex-wrap items-center justify-end gap-2">
                <app-button
                  size="sm"
                  [label]="'adminUi.products.bulk.status.apply' | translate"
                  (action)="openBulkStatusConfirm()"
                  [disabled]="bulkBusy() || inlineBusy()"
                ></app-button>
              </div>
            </div>

            <div class="h-px bg-slate-200 dark:bg-slate-800/70"></div>

            <div class="grid gap-3 lg:grid-cols-[260px_auto] items-end">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.products.bulk.category.label' | translate }}
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="bulkCategoryId"
                  [disabled]="bulkBusy() || inlineBusy()"
                >
                  <option value="">{{ 'adminUi.products.bulk.category.placeholder' | translate }}</option>
                  <option *ngFor="let cat of categories()" [value]="cat.id">{{ cat.name }}</option>
                </select>
              </label>

              <div class="flex flex-wrap items-center justify-end gap-2">
                <app-button
                  size="sm"
                  [label]="'adminUi.products.bulk.category.apply' | translate"
                  (action)="applyCategoryToSelected()"
                  [disabled]="bulkBusy() || inlineBusy()"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.products.bulk.category.addAndApply' | translate"
                  (action)="openCreateCategoryFromBulkAssign()"
                  [disabled]="bulkBusy() || inlineBusy()"
                ></app-button>
              </div>
            </div>

            <div class="h-px bg-slate-200 dark:bg-slate-800/70"></div>

            <div class="grid gap-3 lg:grid-cols-[240px_240px_auto] items-end">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.products.bulk.schedule.publishAt' | translate }}
                <input
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  type="datetime-local"
                  [(ngModel)]="bulkPublishScheduledFor"
                  [disabled]="bulkBusy() || inlineBusy()"
                />
              </label>

              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.products.bulk.schedule.unpublishAt' | translate }}
                <input
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  type="datetime-local"
                  [(ngModel)]="bulkUnpublishScheduledFor"
                  [disabled]="bulkBusy() || inlineBusy()"
                />
              </label>

              <app-button
                size="sm"
                [label]="'adminUi.products.bulk.schedule.apply' | translate"
                (action)="applyScheduleToSelected()"
                [disabled]="bulkBusy() || inlineBusy()"
              ></app-button>
            </div>

            <div class="flex flex-wrap items-center justify-end gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.products.bulk.schedule.clearPublish' | translate"
                (action)="clearPublishScheduleForSelected()"
                [disabled]="bulkBusy() || inlineBusy()"
              ></app-button>
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.products.bulk.schedule.clearUnpublish' | translate"
                (action)="clearUnpublishScheduleForSelected()"
                [disabled]="bulkBusy() || inlineBusy()"
              ></app-button>
            </div>

            <div class="h-px bg-slate-200 dark:bg-slate-800/70"></div>

            <div class="grid gap-3 lg:grid-cols-[200px_200px_240px_auto] items-end">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.products.bulk.priceAdjust.mode' | translate }}
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="bulkPriceMode"
                  (change)="bulkPriceValue = ''; bulkPricePreview = null"
                  [disabled]="bulkBusy() || inlineBusy()"
                >
                  <option [ngValue]="'percent'">{{ 'adminUi.products.bulk.priceAdjust.modePercent' | translate }}</option>
                  <option [ngValue]="'amount'">{{ 'adminUi.products.bulk.priceAdjust.modeAmount' | translate }}</option>
                </select>
              </label>

              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.products.bulk.priceAdjust.direction' | translate }}
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="bulkPriceDirection"
                  (change)="updateBulkPricePreview()"
                  [disabled]="bulkBusy() || inlineBusy()"
                >
                  <option [ngValue]="'increase'">{{ 'adminUi.products.bulk.priceAdjust.directionIncrease' | translate }}</option>
                  <option [ngValue]="'decrease'">{{ 'adminUi.products.bulk.priceAdjust.directionDecrease' | translate }}</option>
                </select>
              </label>

              <app-input
                [label]="'adminUi.products.bulk.priceAdjust.value' | translate"
                [placeholder]="bulkPriceMode === 'percent' ? '10' : '5.00'"
                type="text"
                inputMode="decimal"
                [value]="bulkPriceValue"
                (valueChange)="onBulkPriceValueChange($event)"
                [disabled]="bulkBusy() || inlineBusy()"
              ></app-input>

              <app-button
                size="sm"
                [label]="'adminUi.products.bulk.priceAdjust.apply' | translate"
                (action)="applyPriceAdjustmentToSelected()"
                [disabled]="bulkBusy() || inlineBusy()"
              ></app-button>
            </div>

            <p *ngIf="bulkPricePreview" class="text-xs text-slate-600 dark:text-slate-300">
              {{ 'adminUi.products.bulk.priceAdjust.preview' | translate: bulkPricePreview }}
            </p>

            <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.products.bulk.note' | translate }}</p>

            <div
              *ngIf="bulkError()"
              class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-2 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
            >
              {{ bulkError() }}
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
          <div *ngIf="products().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'adminUi.products.empty' | translate }}
          </div>

          <div *ngIf="products().length > 0" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <ng-template #productsTableHeader>
              <tr>
                <ng-container *ngFor="let colId of visibleColumnIds(); trackBy: trackColumnId" [ngSwitch]="colId">
                  <th *ngSwitchCase="'select'" class="text-left font-semibold w-10" [ngClass]="cellPaddingClass()">
                    <input
                      type="checkbox"
                      [checked]="allSelectedOnPage()"
                      (change)="toggleSelectAll($event)"
                      [disabled]="bulkBusy() || inlineBusy() || view === 'deleted'"
                      aria-label="Select all products on page"
                    />
                  </th>
                  <th *ngSwitchCase="'name'" class="text-left font-semibold" [ngClass]="cellPaddingClass()">
                    {{ 'adminUi.products.table.name' | translate }}
                  </th>
                  <th *ngSwitchCase="'price'" class="text-left font-semibold" [ngClass]="cellPaddingClass()">
                    {{ 'adminUi.products.table.price' | translate }}
                  </th>
                  <th *ngSwitchCase="'status'" class="text-left font-semibold" [ngClass]="cellPaddingClass()">
                    {{ 'adminUi.products.table.status' | translate }}
                  </th>
                  <th *ngSwitchCase="'category'" class="text-left font-semibold" [ngClass]="cellPaddingClass()">
                    {{ 'adminUi.products.table.category' | translate }}
                  </th>
                  <th *ngSwitchCase="'stock'" class="text-left font-semibold" [ngClass]="cellPaddingClass()">
                    {{ 'adminUi.products.table.stock' | translate }}
                  </th>
                  <th *ngSwitchCase="'active'" class="text-left font-semibold" [ngClass]="cellPaddingClass()">
                    {{ 'adminUi.products.table.active' | translate }}
                  </th>
                  <th *ngSwitchCase="'updated'" class="text-left font-semibold" [ngClass]="cellPaddingClass()">
                    {{
                      view === 'deleted'
                        ? ('adminUi.products.table.deletedAt' | translate)
                        : ('adminUi.products.table.updated' | translate)
                    }}
                  </th>
                  <th *ngSwitchCase="'actions'" class="text-right font-semibold" [ngClass]="cellPaddingClass()">
                    {{ 'adminUi.products.table.actions' | translate }}
                  </th>
                </ng-container>
              </tr>
            </ng-template>

            <cdk-virtual-scroll-viewport
              *ngIf="useVirtualProductsTable()"
              class="block h-[min(70vh,720px)]"
              [itemSize]="productRowHeight"
              [minBufferPx]="productRowHeight * 8"
              [maxBufferPx]="productRowHeight * 16"
            >
              <table class="min-w-[980px] w-full text-sm">
                <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                  <ng-container [ngTemplateOutlet]="productsTableHeader"></ng-container>
                </thead>
                <tbody>
                  <ng-container *cdkVirtualFor="let product of products(); trackBy: trackProductId">
                    <ng-container
                      [ngTemplateOutlet]="productRow"
                      [ngTemplateOutletContext]="{ $implicit: product }"
                    ></ng-container>
                  </ng-container>
                </tbody>
              </table>
            </cdk-virtual-scroll-viewport>

            <table class="min-w-[980px] w-full text-sm" [class.hidden]="useVirtualProductsTable()">
              <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                <ng-container [ngTemplateOutlet]="productsTableHeader"></ng-container>
	              </thead>
              <tbody>
                <ng-template #productRow let-product>
                  <tr class="border-t border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
                    <ng-container *ngFor="let colId of visibleColumnIds(); trackBy: trackColumnId" [ngSwitch]="colId">
	                  <td *ngSwitchCase="'select'" class="w-10" [ngClass]="cellPaddingClass()">
	                    <input
	                      type="checkbox"
	                      [checked]="selected.has(product.id)"
	                      (change)="toggleSelected(product.id, $event)"
	                      [disabled]="bulkBusy() || inlineBusy() || view === 'deleted'"
	                      [attr.aria-label]="'Select product ' + (product.name || product.slug)"
	                    />
	                  </td>
	                  <td *ngSwitchCase="'name'" class="font-medium text-slate-900 dark:text-slate-50" [ngClass]="cellPaddingClass()">
	                    <div class="grid">
	                      <span class="truncate">{{ product.name }}</span>
	                      <span class="text-xs text-slate-500 dark:text-slate-400">
	                        {{ product.deleted_slug || product.slug }} · {{ product.sku }}
	                      </span>
                        <div *ngIf="(product.missing_translations || []).length" class="mt-1 flex flex-wrap items-center gap-1">
                          <span class="text-[10px] font-semibold text-amber-700 dark:text-amber-200">
                            {{ 'adminUi.products.translations.missing' | translate }}
                          </span>
                          <span
                            *ngFor="let lang of product.missing_translations || []"
                            class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-900/30 dark:text-amber-100"
                          >
                            {{ (lang || '').toUpperCase() }}
                          </span>
                        </div>
	                    </div>
	                  </td>
                  <td *ngSwitchCase="'price'" class="text-slate-700 dark:text-slate-200" [ngClass]="cellPaddingClass()">
                    <ng-container *ngIf="inlineEditId === product.id; else priceRead">
                      <div class="grid gap-2 min-w-[240px]">
                        <div class="grid gap-1">
                          <input
                            class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            type="text"
                            inputMode="decimal"
                            [value]="inlineBasePrice"
                            (input)="onInlineBasePriceChange($any($event.target).value)"
                            [disabled]="inlineBusy()"
                            aria-label="Base price"
                          />
                          <p *ngIf="inlineBasePriceError" class="text-xs text-rose-700 dark:text-rose-200">
                            {{ inlineBasePriceError }}
                          </p>
                        </div>

                        <label class="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                          <input
                            type="checkbox"
                            [(ngModel)]="inlineSaleEnabled"
                            (change)="onInlineSaleEnabledChange()"
                            [disabled]="inlineBusy()"
                          />
                          {{ 'adminUi.products.sale.enabled' | translate }}
                        </label>

                        <div *ngIf="inlineSaleEnabled" class="grid gap-2">
                          <div class="grid grid-cols-2 gap-2 items-end">
                            <label class="grid gap-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                              {{ 'adminUi.products.sale.type' | translate }}
                              <select
                                class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                [(ngModel)]="inlineSaleType"
                                (change)="onInlineSaleTypeChange()"
                                [disabled]="inlineBusy()"
                              >
                                <option [ngValue]="'percent'">{{ 'adminUi.products.sale.typePercent' | translate }}</option>
                                <option [ngValue]="'amount'">{{ 'adminUi.products.sale.typeAmount' | translate }}</option>
                              </select>
                            </label>

                            <label class="grid gap-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                              {{ 'adminUi.products.sale.value' | translate }}
                              <input
                                class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                type="text"
                                inputMode="decimal"
                                [placeholder]="inlineSaleType === 'percent' ? '10' : '5.00'"
                                [value]="inlineSaleValue"
                                (input)="onInlineSaleValueChange($any($event.target).value)"
                                [disabled]="inlineBusy()"
                              />
                            </label>
                          </div>

                          <p *ngIf="inlineSaleError" class="text-xs text-rose-700 dark:text-rose-200">
                            {{ inlineSaleError }}
                          </p>
                        </div>

                        <p *ngIf="inlineError" class="text-xs text-rose-700 dark:text-rose-200">
                          {{ inlineError }}
                        </p>
                      </div>
                    </ng-container>
                    <ng-template #priceRead>
                      <div class="grid">
                        <span>{{ product.base_price | localizedCurrency : product.currency }}</span>
                        <span *ngIf="product.sale_type && product.sale_value" class="text-xs text-slate-500 dark:text-slate-400">
                          {{ 'adminUi.products.sale.title' | translate }}:
                          <ng-container *ngIf="product.sale_type === 'percent'">{{ product.sale_value }}%</ng-container>
                          <ng-container *ngIf="product.sale_type === 'amount'">{{
                            product.sale_value | localizedCurrency : product.currency
                          }}</ng-container>
                        </span>
                      </div>
                    </ng-template>
                  </td>
                  <td *ngSwitchCase="'status'" [ngClass]="cellPaddingClass()">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold" [ngClass]="statusPillClass(product.status)">
                        {{ ('adminUi.status.' + product.status) | translate }}
                      </span>
                      <span
                        *ngIf="product.status === 'published'"
                        class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold"
                        [ngClass]="product.is_active ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'"
                      >
                        {{ product.is_active ? ('adminUi.products.active' | translate) : ('adminUi.products.inactive' | translate) }}
                      </span>
                    </div>
                    <div
                      *ngIf="product.publish_scheduled_for || product.unpublish_scheduled_for"
                      class="mt-1 grid gap-0.5 text-xs text-slate-500 dark:text-slate-400"
                    >
                      <div *ngIf="product.publish_scheduled_for">
                        {{ 'adminUi.products.bulk.schedule.publishAt' | translate }}:
                        {{ product.publish_scheduled_for | date: 'short' }}
                      </div>
                      <div *ngIf="product.unpublish_scheduled_for">
                        {{ 'adminUi.products.bulk.schedule.unpublishAt' | translate }}:
                        {{ product.unpublish_scheduled_for | date: 'short' }}
                      </div>
                    </div>
                  </td>
                  <td *ngSwitchCase="'category'" class="text-slate-700 dark:text-slate-200" [ngClass]="cellPaddingClass()">
                    {{ product.category_name }}
                  </td>
                  <td *ngSwitchCase="'stock'" class="text-slate-700 dark:text-slate-200" [ngClass]="cellPaddingClass()">
                    <ng-container *ngIf="inlineEditId === product.id; else stockRead">
                      <div class="grid gap-1 min-w-[120px]">
                        <input
                          class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          [value]="inlineStockQuantity"
                          (input)="onInlineStockChange($any($event.target).value)"
                          [disabled]="inlineBusy()"
                          aria-label="Stock quantity"
                        />
                        <p *ngIf="inlineStockError" class="text-xs text-rose-700 dark:text-rose-200">
                          {{ inlineStockError }}
                        </p>
                      </div>
                    </ng-container>
                    <ng-template #stockRead>
                      {{ product.stock_quantity }}
                    </ng-template>
                  </td>
                  <td *ngSwitchCase="'active'" [ngClass]="cellPaddingClass()">
                    <span
                      class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold"
                      [ngClass]="product.is_active ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'"
                    >
                      {{ product.is_active ? ('adminUi.products.active' | translate) : ('adminUi.products.inactive' | translate) }}
                    </span>
                  </td>
                  <td *ngSwitchCase="'updated'" class="text-slate-600 dark:text-slate-300" [ngClass]="cellPaddingClass()">
                    {{
                      (view === 'deleted' ? (product.deleted_at || product.updated_at) : product.updated_at) | date: 'short'
                    }}
                  </td>
                  <td *ngSwitchCase="'actions'" class="text-right" [ngClass]="cellPaddingClass()">
                    <div class="flex items-center justify-end gap-2">
	                      <ng-container *ngIf="inlineEditId === product.id; else rowActions">
	                        <app-button
	                          size="sm"
	                          [label]="'adminUi.actions.save' | translate"
	                          (action)="saveInlineEdit()"
	                          [disabled]="inlineBusy()"
	                        ></app-button>
	                        <app-button
	                          size="sm"
	                          variant="ghost"
	                          [label]="'adminUi.actions.cancel' | translate"
	                          (action)="cancelInlineEdit()"
	                          [disabled]="inlineBusy()"
	                        ></app-button>
	                      </ng-container>
	                      <ng-template #rowActions>
	                        <ng-container *ngIf="view === 'deleted'; else activeRowActions">
	                          <app-button
	                            size="sm"
	                            variant="ghost"
	                            [label]="'adminUi.actions.restore' | translate"
	                            (action)="restoreProduct(product)"
	                            [disabled]="restoringProductId() === product.id"
	                          ></app-button>
	                        </ng-container>
	                        <ng-template #activeRowActions>
                            <app-button
                              *ngIf="product.status !== 'archived'"
                              size="sm"
                              variant="ghost"
                              [label]="
                                product.status === 'published'
                                  ? ('adminUi.products.quickStatus.unpublish' | translate)
                                  : ('adminUi.products.quickStatus.publish' | translate)
                              "
                              (action)="quickSetStatus(product, product.status === 'published' ? 'draft' : 'published')"
                              [disabled]="bulkBusy() || inlineBusy() || quickStatusBusyId()"
                            ></app-button>
                            <app-button
                              size="sm"
                              variant="ghost"
                              [label]="
                                product.status === 'archived'
                                  ? ('adminUi.products.quickStatus.unarchive' | translate)
                                  : ('adminUi.products.quickStatus.archive' | translate)
                              "
                              (action)="quickSetStatus(product, product.status === 'archived' ? 'draft' : 'archived')"
                              [disabled]="bulkBusy() || inlineBusy() || quickStatusBusyId()"
                            ></app-button>
	                          <app-button
	                            size="sm"
	                            variant="ghost"
	                            [label]="'adminUi.products.inlineEdit' | translate"
	                            (action)="startInlineEdit(product)"
	                            [disabled]="bulkBusy() || inlineBusy()"
	                          ></app-button>
	                          <app-button
	                            size="sm"
	                            variant="ghost"
	                            [label]="'adminUi.products.edit' | translate"
	                            (action)="edit(product.slug)"
	                          ></app-button>
	                        </ng-template>
	                      </ng-template>
	                    </div>
	                  </td>
                    </ng-container>
	                </tr>
                </ng-template>

                <ng-container *ngIf="!useVirtualProductsTable()">
                  <ng-container *ngFor="let product of products(); trackBy: trackProductId">
                    <ng-container
                      [ngTemplateOutlet]="productRow"
                      [ngTemplateOutletContext]="{ $implicit: product }"
                    ></ng-container>
                  </ng-container>
                </ng-container>
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

      <section
        *ngIf="editorOpen()"
        id="product-wizard-top"
        (input)="markEditorDirtyFromEvent($event)"
        (change)="markEditorDirtyFromEvent($event)"
        class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <div
          class="-mx-4 -mt-4 px-4 pt-4 pb-3 sticky top-24 z-30 rounded-t-2xl border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0 grid gap-1">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
                {{ editingSlug() ? ('adminUi.products.edit' | translate) : ('adminUi.products.create' | translate) }}
              </h2>
              <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span *ngIf="editingSlug() as slug" class="font-mono truncate">{{ slug }}</span>
                <span *ngIf="!editingSlug() && predictedSlug()" class="font-mono truncate">{{ predictedSlug() }}</span>

                <span
                  *ngIf="editorSaving()"
                  class="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {{ 'adminUi.common.saving' | translate }}
                </span>
                <ng-container *ngIf="!editorSaving()">
                  <span
                    *ngIf="editorDirty()"
                    class="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
                  >
                    {{ 'adminUi.content.autosave.state.unsaved' | translate }}
                  </span>
                  <span
                    *ngIf="!editorDirty() && editorLastSavedAt()"
                    class="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {{ 'adminUi.content.autosave.state.saved' | translate }} · {{ editorLastSavedAt() | date: 'shortTime' }}
                  </span>
                </ng-container>
              </div>
            </div>

            <div class="flex flex-wrap items-end justify-end gap-2">
              <label class="grid gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                {{ 'adminUi.products.table.status' | translate }}
                <select
                  class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="form.status"
                  [disabled]="editorSaving()"
                >
                  <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
                  <option value="published">{{ 'adminUi.status.published' | translate }}</option>
                  <option value="archived">{{ 'adminUi.status.archived' | translate }}</option>
                </select>
              </label>

              <app-button
                size="sm"
                [label]="editorSaving() ? ('adminUi.common.saving' | translate) : ('adminUi.products.form.save' | translate)"
                (action)="save()"
                [disabled]="editorSaving()"
              ></app-button>

              <app-button
                *ngIf="editingSlug()"
                size="sm"
                variant="ghost"
                [label]="'adminUi.products.wizard.publish' | translate"
                (action)="startPublishWizard()"
                [disabled]="editorSaving()"
              ></app-button>

              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.products.actions.cancel' | translate"
                (action)="closeEditor()"
                [disabled]="editorSaving()"
              ></app-button>
            </div>
          </div>
        </div>

        <div *ngIf="editorError()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
          {{ editorError() }}
        </div>

        <div
          *ngIf="wizardKind()"
          class="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-100"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="grid gap-1">
              <p class="font-semibold">{{ wizardTitleKey() | translate }}</p>
              <p class="text-xs text-indigo-800 dark:text-indigo-200">{{ wizardStepDescriptionKey() | translate }}</p>
            </div>
            <app-button size="sm" variant="ghost" [label]="'adminUi.actions.exit' | translate" (action)="exitWizard()"></app-button>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button
              *ngFor="let step of wizardSteps(); let idx = index"
              type="button"
              class="rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-semibold text-indigo-900 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/10 dark:text-indigo-100 dark:hover:bg-indigo-900/30"
              [class.bg-indigo-600]="idx === wizardStep()"
              [class.text-white]="idx === wizardStep()"
              [class.border-indigo-600]="idx === wizardStep()"
              [class.hover:bg-indigo-700]="idx === wizardStep()"
              [class.dark:bg-indigo-500/30]="idx === wizardStep()"
              [class.dark:hover:bg-indigo-500/40]="idx === wizardStep()"
              (click)="goToWizardStep(idx)"
            >
              {{ step.labelKey | translate }}
            </button>
          </div>

          <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
            <app-button
              size="sm"
              variant="ghost"
              [label]="'adminUi.actions.back' | translate"
              (action)="wizardPrev()"
              [disabled]="wizardStep() === 0"
            ></app-button>

            <div class="flex flex-wrap items-center gap-2">
              <app-button
                *ngIf="wizardCurrentStepId() === 'save'"
                size="sm"
                [label]="'adminUi.products.form.save' | translate"
                (action)="wizardSave()"
              ></app-button>
              <app-button
                *ngIf="wizardCurrentStepId() === 'publish'"
                size="sm"
                [label]="'adminUi.products.wizard.publishNow' | translate"
                (action)="wizardPublishNow()"
                [disabled]="!editingSlug()"
              ></app-button>
              <app-button
                size="sm"
                [label]="wizardNextLabelKey() | translate"
                (action)="wizardNext()"
                [disabled]="!wizardCanNext()"
              ></app-button>
            </div>
          </div>
        </div>

	        <div class="grid gap-3 md:grid-cols-2">
	          <app-input
              [label]="'adminUi.products.table.name' | translate"
              [value]="form.name"
              (valueChange)="onNameChange($event)"
            ></app-input>
	          <div class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	            <span>{{ 'adminUi.products.form.slug' | translate }}</span>
	            <div class="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 shadow-sm flex items-center dark:border-slate-800 dark:bg-slate-950/20 dark:text-slate-100">
	              <span *ngIf="editingSlug(); else slugHint" class="font-mono truncate">{{ editingSlug() }}</span>
	              <ng-template #slugHint>
                  <span *ngIf="predictedSlug(); else slugAuto" class="font-mono truncate">{{ predictedSlug() }}</span>
                  <ng-template #slugAuto>
	                  <span class="text-slate-500 dark:text-slate-400">{{ 'adminUi.products.form.slugAutoHint' | translate }}</span>
                  </ng-template>
	              </ng-template>
	            </div>
              <span class="text-xs font-normal text-slate-500 dark:text-slate-400">
                {{ 'adminUi.products.form.slugHelp' | translate }}
              </span>
	          </div>

            <div
              *ngIf="duplicateBusy() || duplicateHasWarnings()"
              class="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <div class="flex items-center justify-between gap-3">
                <p class="font-semibold">{{ 'adminUi.products.duplicates.title' | translate }}</p>
                <span *ngIf="duplicateBusy()" class="text-xs text-amber-700 dark:text-amber-200">
                  {{ 'adminUi.products.duplicates.checking' | translate }}
                </span>
              </div>

              <ng-container *ngIf="duplicateCheck() as dup">
                <div *ngIf="dup.slug_base && dup.suggested_slug && dup.slug_base !== dup.suggested_slug" class="mt-2">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <span>{{ 'adminUi.products.duplicates.slugTaken' | translate: { slug: dup.slug_base, suggested: dup.suggested_slug } }}</span>
                    <app-button
                      *ngIf="dup.slug_matches.length"
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.products.duplicates.open' | translate"
                      (action)="edit(dup.slug_matches[0].slug)"
                    ></app-button>
                  </div>
                </div>

                <div *ngIf="dup.sku_matches.length" class="mt-2 grid gap-1">
                  <p class="font-semibold">{{ 'adminUi.products.duplicates.skuMatches' | translate }}</p>
                  <div class="grid gap-1">
                    <div *ngFor="let match of dup.sku_matches" class="flex items-center justify-between gap-2">
                      <span class="truncate">
                        <span class="font-mono">{{ match.sku }}</span> · {{ match.name }}
                        <span class="text-xs text-amber-700 dark:text-amber-200">({{ match.slug }})</span>
                      </span>
                      <app-button
                        size="sm"
                        variant="ghost"
                        [label]="'adminUi.products.duplicates.open' | translate"
                        (action)="edit(match.slug)"
                      ></app-button>
                    </div>
                  </div>
                </div>

                <div *ngIf="dup.name_matches.length" class="mt-2 grid gap-1">
                  <p class="font-semibold">{{ 'adminUi.products.duplicates.nameMatches' | translate }}</p>
                  <div class="grid gap-1">
                    <div *ngFor="let match of dup.name_matches" class="flex items-center justify-between gap-2">
                      <span class="truncate">
                        {{ match.name }} <span class="text-xs text-amber-700 dark:text-amber-200">({{ match.slug }})</span>
                      </span>
                      <app-button
                        size="sm"
                        variant="ghost"
                        [label]="'adminUi.products.duplicates.open' | translate"
                        (action)="edit(match.slug)"
                      ></app-button>
                    </div>
                  </div>
                </div>

                <p *ngIf="duplicateHasWarnings()" class="mt-2 text-xs text-amber-800 dark:text-amber-200">
                  {{ 'adminUi.products.duplicates.mergeHint' | translate }}
                </p>
              </ng-container>
            </div>

	          <div class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              <div class="flex items-center justify-between gap-2">
                <span>{{ 'adminUi.products.table.category' | translate }}</span>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.categories.add' | translate"
                  (action)="openCreateCategory('product_form')"
                  [disabled]="createCategoryOpen()"
                ></app-button>
              </div>
	            <select
	              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              [(ngModel)]="form.category_id"
            >
              <option value="" disabled>{{ 'adminUi.products.selectCategory' | translate }}</option>
              <option *ngFor="let cat of adminCategories()" [value]="cat.id">{{ cat.name }}</option>
            </select>
          </div>

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
          <details
            id="product-wizard-publish"
            class="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20"
            [open]="uiPrefs.mode() === 'advanced' || wizardForcesAdvancedOpen()"
          >
            <summary class="cursor-pointer select-none text-sm font-semibold text-slate-900 dark:text-slate-50">
              {{ 'adminUi.products.form.advancedSettings' | translate }}
            </summary>
            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {{ 'adminUi.products.form.advancedHint' | translate }}
            </p>

            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <app-input
                [label]="'adminUi.lowStock.thresholdLabel' | translate"
                [hint]="'adminUi.lowStock.thresholdHint' | translate"
                type="number"
                [(value)]="form.low_stock_threshold"
              ></app-input>

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

              <app-input
                [label]="'adminUi.products.form.sku' | translate"
                [value]="form.sku"
                (valueChange)="onSkuChange($event)"
                [hint]="'adminUi.products.form.skuHint' | translate"
              ></app-input>

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

            <div class="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {{ 'adminUi.products.badges.title' | translate }}
                </p>
                <span class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.products.badges.hint' | translate }}
                </span>
              </div>

              <div class="mt-3 grid gap-4">
                <div class="grid gap-3 md:grid-cols-3 items-end">
                  <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 pt-6">
                    <input type="checkbox" [(ngModel)]="form.badges.new.enabled" />
                    {{ 'adminUi.products.badges.new' | translate }}
                  </label>

                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.products.badges.startAt' | translate }}
                    <input
                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      type="datetime-local"
                      [(ngModel)]="form.badges.new.start_at"
                      [disabled]="!form.badges.new.enabled"
                    />
                  </label>

                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.products.badges.endAt' | translate }}
                    <input
                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      type="datetime-local"
                      [(ngModel)]="form.badges.new.end_at"
                      [disabled]="!form.badges.new.enabled"
                    />
                  </label>
                </div>

                <div class="grid gap-3 md:grid-cols-3 items-end">
                  <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 pt-6">
                    <input type="checkbox" [(ngModel)]="form.badges.limited.enabled" />
                    {{ 'adminUi.products.badges.limited' | translate }}
                  </label>

                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.products.badges.startAt' | translate }}
                    <input
                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      type="datetime-local"
                      [(ngModel)]="form.badges.limited.start_at"
                      [disabled]="!form.badges.limited.enabled"
                    />
                  </label>

                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.products.badges.endAt' | translate }}
                    <input
                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      type="datetime-local"
                      [(ngModel)]="form.badges.limited.end_at"
                      [disabled]="!form.badges.limited.enabled"
                    />
                  </label>
                </div>

                <div class="grid gap-3 md:grid-cols-3 items-end">
                  <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 pt-6">
                    <input type="checkbox" [(ngModel)]="form.badges.handmade.enabled" />
                    {{ 'adminUi.products.badges.handmade' | translate }}
                  </label>

                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.products.badges.startAt' | translate }}
                    <input
                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      type="datetime-local"
                      [(ngModel)]="form.badges.handmade.start_at"
                      [disabled]="!form.badges.handmade.enabled"
                    />
                  </label>

                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.products.badges.endAt' | translate }}
                    <input
                      class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      type="datetime-local"
                      [(ngModel)]="form.badges.handmade.end_at"
                      [disabled]="!form.badges.handmade.enabled"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div class="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {{ 'adminUi.products.shipping.title' | translate }}
                </p>
                <span class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.products.shipping.hint' | translate }}
                </span>
              </div>

              <div class="mt-3 grid gap-3 md:grid-cols-4 items-end">
                <app-input
                  [label]="'adminUi.products.shipping.weight' | translate"
                  type="number"
                  inputMode="numeric"
                  [value]="form.weight_grams"
                  (valueChange)="form.weight_grams = String($event ?? '')"
                  [min]="0"
                  [hint]="'adminUi.products.shipping.weightUnit' | translate"
                ></app-input>

                <app-input
                  [label]="'adminUi.products.shipping.width' | translate"
                  type="number"
                  inputMode="decimal"
                  [value]="form.width_cm"
                  (valueChange)="form.width_cm = String($event ?? '')"
                  [min]="0"
                  [step]="0.01"
                  [hint]="'adminUi.products.shipping.cm' | translate"
                ></app-input>

                <app-input
                  [label]="'adminUi.products.shipping.height' | translate"
                  type="number"
                  inputMode="decimal"
                  [value]="form.height_cm"
                  (valueChange)="form.height_cm = String($event ?? '')"
                  [min]="0"
                  [step]="0.01"
                  [hint]="'adminUi.products.shipping.cm' | translate"
                ></app-input>

                <app-input
                  [label]="'adminUi.products.shipping.depth' | translate"
                  type="number"
                  inputMode="decimal"
                  [value]="form.depth_cm"
                  (valueChange)="form.depth_cm = String($event ?? '')"
                  [min]="0"
                  [step]="0.01"
                  [hint]="'adminUi.products.shipping.cm' | translate"
                ></app-input>
              </div>

              <div class="mt-3 grid gap-3 md:grid-cols-3 items-end">
                <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.products.shipping.classLabel' | translate }}
                  <select
                    class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="form.shipping_class"
                  >
                    <option value="standard">{{ 'adminUi.products.shipping.class.standard' | translate }}</option>
                    <option value="bulky">{{ 'adminUi.products.shipping.class.bulky' | translate }}</option>
                    <option value="oversize">{{ 'adminUi.products.shipping.class.oversize' | translate }}</option>
                  </select>
                </label>

                <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 pt-6">
                  <input type="checkbox" [(ngModel)]="form.shipping_allow_locker" />
                  {{ 'adminUi.products.shipping.allowLocker' | translate }}
                </label>

                <div class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <span>{{ 'adminUi.products.shipping.disallowedCouriers' | translate }}</span>
                  <div class="flex flex-wrap items-center gap-4 text-sm font-normal text-slate-700 dark:text-slate-200">
                    <label class="inline-flex items-center gap-2">
                      <input type="checkbox" [(ngModel)]="form.shipping_disallowed_couriers.sameday" />
                      {{ 'adminUi.products.shipping.courier.sameday' | translate }}
                    </label>
                    <label class="inline-flex items-center gap-2">
                      <input type="checkbox" [(ngModel)]="form.shipping_disallowed_couriers.fan_courier" />
                      {{ 'adminUi.products.shipping.courier.fan_courier' | translate }}
                    </label>
                  </div>
                  <span class="text-xs font-normal text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.products.shipping.disallowedHint' | translate }}
                  </span>
                </div>
              </div>
            </div>
          </details>
	        </div>

	        <details
            data-ignore-dirty
            class="group rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/20"
          >
            <summary class="flex items-start justify-between gap-4 cursor-pointer select-none [&::-webkit-details-marker]:hidden">
              <div class="min-w-0 grid gap-1">
                <h3 class="text-sm font-semibold tracking-wide uppercase text-slate-700 dark:text-slate-200">
                  {{ 'adminUi.products.form.variantsTitle' | translate }}
                </h3>
                <p class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.products.form.variantsHint' | translate }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <span
                  *ngIf="variants().length"
                  class="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                >
                  {{ variants().length }}
                </span>
                <span class="text-slate-500 transition-transform group-open:rotate-90 dark:text-slate-400">▸</span>
              </div>
            </summary>

            <div class="mt-3 grid gap-3">
              <div class="flex flex-wrap items-center justify-end gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.products.form.variantsAdd' | translate"
                  (action)="addVariantRow()"
                  [disabled]="variantsBusy()"
                ></app-button>
                <app-button
                  size="sm"
                  [label]="'adminUi.products.form.variantsSave' | translate"
                  (action)="saveVariants()"
                  [disabled]="variantsBusy() || !editingSlug()"
                ></app-button>
              </div>

              <div
                *ngIf="variantsError()"
                class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
              >
                {{ variantsError() }}
              </div>

              <div *ngIf="variants().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'adminUi.products.form.variantsEmpty' | translate }}
              </div>

              <div *ngIf="variants().length > 0" class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      <th class="py-2 pr-3">{{ 'adminUi.products.form.variantsName' | translate }}</th>
                      <th class="py-2 pr-3 w-40">{{ 'adminUi.products.form.variantsDelta' | translate }}</th>
                      <th class="py-2 pr-3 w-32">{{ 'adminUi.products.form.variantsPrice' | translate }}</th>
                      <th class="py-2 pr-3 w-28">{{ 'adminUi.products.form.variantsStock' | translate }}</th>
                      <th class="py-2 w-24">{{ 'adminUi.products.table.actions' | translate }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let v of variants(); let idx = index" class="border-t border-slate-200 dark:border-slate-800">
                      <td class="py-2 pr-3">
                        <input
                          class="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          type="text"
                          [ngModel]="v.name"
                          (ngModelChange)="onVariantNameChange(idx, $event)"
                          [disabled]="variantsBusy()"
                        />
                      </td>
                      <td class="py-2 pr-3">
                        <input
                          class="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          type="number"
                          step="0.01"
                          inputmode="decimal"
                          [ngModel]="v.additional_price_delta"
                          (ngModelChange)="onVariantDeltaChange(idx, $event)"
                          [disabled]="variantsBusy()"
                        />
                      </td>
                      <td class="py-2 pr-3 text-slate-700 dark:text-slate-200">
                        {{ formatMoneyInput(variantComputedPrice(v.additional_price_delta)) }} RON
                      </td>
                      <td class="py-2 pr-3">
                        <input
                          class="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          type="number"
                          step="1"
                          min="0"
                          [ngModel]="v.stock_quantity"
                          (ngModelChange)="onVariantStockChange(idx, $event)"
                          [disabled]="variantsBusy()"
                        />
                      </td>
                      <td class="py-2">
                        <app-button
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.products.form.variantsRemove' | translate"
                          (action)="removeVariantRow(v)"
                          [disabled]="variantsBusy()"
                        ></app-button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </details>

		        <details
              data-ignore-dirty
              class="group rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/20"
            >
		          <summary class="flex items-start justify-between gap-4 cursor-pointer select-none [&::-webkit-details-marker]:hidden">
                <div class="min-w-0 grid gap-1">
                  <h3 class="text-sm font-semibold tracking-wide uppercase text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.products.relationships.title' | translate }}
                  </h3>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.products.relationships.hint' | translate }}
                  </p>
                </div>
                <div class="flex items-center gap-2">
                  <span
                    *ngIf="relationshipsRelated().length + relationshipsUpsells().length"
                    class="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                  >
                    {{ relationshipsRelated().length + relationshipsUpsells().length }}
                  </span>
                  <span class="text-slate-500 transition-transform group-open:rotate-90 dark:text-slate-400">▸</span>
                </div>
              </summary>

              <div class="mt-3 grid gap-3">

              <div
                *ngIf="!editingSlug()"
                class="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-100"
              >
                {{ 'adminUi.products.relationships.saveFirst' | translate }}
              </div>

		          <div
		            *ngIf="relationshipsError()"
		            class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
		          >
		            {{ relationshipsError() }}
		          </div>

		          <div
		            *ngIf="relationshipsMessage()"
		            class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
		          >
		            {{ relationshipsMessage() }}
		          </div>

              <div class="grid gap-2">
                <app-input
                  [label]="'adminUi.products.relationships.searchLabel' | translate"
                  [value]="relationshipSearch"
                  (valueChange)="onRelationshipSearchChange($event)"
                  [disabled]="relationshipSearchLoading() || relationshipsLoading()"
                ></app-input>

                <div *ngIf="relationshipSearchLoading()" class="text-xs text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.products.relationships.searchLoading' | translate }}
                </div>

                <div
                  *ngIf="relationshipSearchResults().length"
                  class="rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div
                    *ngFor="let p of relationshipSearchResults()"
                    class="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <div class="min-w-0">
                      <p class="font-semibold text-slate-900 dark:text-slate-50 truncate">{{ p.name }}</p>
                      <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ p.slug }} · {{ p.sku }}</p>
                    </div>
                    <div class="flex items-center gap-1">
                      <app-button
                        size="sm"
                        variant="ghost"
                        [label]="'adminUi.products.relationships.addRelated' | translate"
                        (action)="addRelationship(p, 'related')"
                        [disabled]="!editingSlug()"
                      ></app-button>
                      <app-button
                        size="sm"
                        variant="ghost"
                        [label]="'adminUi.products.relationships.addUpsell' | translate"
                        (action)="addRelationship(p, 'upsell')"
                        [disabled]="!editingSlug()"
                      ></app-button>
                    </div>
                  </div>
                </div>

                <div class="grid gap-4 lg:grid-cols-2">
                  <div class="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {{ 'adminUi.products.relationships.related' | translate }}
                    </p>
                    <div *ngIf="relationshipsRelated().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.products.relationships.empty' | translate }}
                    </div>
                    <div *ngFor="let p of relationshipsRelated(); let idx = index" class="flex items-center justify-between gap-2">
                      <div class="min-w-0">
                        <p class="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">{{ p.name }}</p>
                        <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ p.slug }}</p>
                      </div>
                      <div class="flex items-center gap-1">
                        <app-button
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.actions.up' | translate"
                          (action)="moveRelationship('related', idx, -1)"
                          [disabled]="idx === 0 || relationshipsSaving()"
                        ></app-button>
                        <app-button
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.actions.down' | translate"
                          (action)="moveRelationship('related', idx, 1)"
                          [disabled]="idx >= relationshipsRelated().length - 1 || relationshipsSaving()"
                        ></app-button>
                        <app-button
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.actions.remove' | translate"
                          (action)="removeRelationship(p.id, 'related')"
                          [disabled]="relationshipsSaving()"
                        ></app-button>
                      </div>
                    </div>
                  </div>

                  <div class="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {{ 'adminUi.products.relationships.upsells' | translate }}
                    </p>
                    <div *ngIf="relationshipsUpsells().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.products.relationships.empty' | translate }}
                    </div>
                    <div *ngFor="let p of relationshipsUpsells(); let idx = index" class="flex items-center justify-between gap-2">
                      <div class="min-w-0">
                        <p class="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">{{ p.name }}</p>
                        <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ p.slug }}</p>
                      </div>
                      <div class="flex items-center gap-1">
                        <app-button
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.actions.up' | translate"
                          (action)="moveRelationship('upsell', idx, -1)"
                          [disabled]="idx === 0 || relationshipsSaving()"
                        ></app-button>
                        <app-button
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.actions.down' | translate"
                          (action)="moveRelationship('upsell', idx, 1)"
                          [disabled]="idx >= relationshipsUpsells().length - 1 || relationshipsSaving()"
                        ></app-button>
                        <app-button
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.actions.remove' | translate"
                          (action)="removeRelationship(p.id, 'upsell')"
                          [disabled]="relationshipsSaving()"
                        ></app-button>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="flex items-center justify-end">
                  <app-button
                    size="sm"
                    [label]="'adminUi.products.relationships.save' | translate"
                    (action)="saveRelationships()"
                    [disabled]="relationshipsSaving() || !editingSlug()"
                  ></app-button>
	                </div>
	              </div>
              </div>
			        </details>

			        <details class="group rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/20">
			          <summary class="flex items-start justify-between gap-4 cursor-pointer select-none [&::-webkit-details-marker]:hidden">
                  <div class="min-w-0 grid gap-1">
                    <h3 class="text-sm font-semibold tracking-wide uppercase text-slate-700 dark:text-slate-200">
                      {{ 'adminUi.products.priceHistory.title' | translate }}
                    </h3>
                    <p class="text-xs text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.products.priceHistory.hint' | translate }}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <span
                      *ngIf="priceHistoryChanges().length"
                      class="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                    >
                      {{ priceHistoryChanges().length }}
                    </span>
                    <span class="text-slate-500 transition-transform group-open:rotate-90 dark:text-slate-400">▸</span>
                  </div>
                </summary>

                <div class="mt-3 grid gap-3">
			          <div *ngIf="priceHistoryChart() as chart; else priceHistoryEmpty" class="grid gap-3">
			            <div class="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
			              <svg class="h-40 w-full" [attr.viewBox]="'0 0 ' + chart.width + ' ' + chart.height" preserveAspectRatio="none">
			                <rect
			                  *ngIf="chart.saleRect"
			                  [attr.x]="chart.saleRect.x"
			                  [attr.y]="chart.pad"
			                  [attr.width]="chart.saleRect.width"
			                  [attr.height]="chart.height - chart.pad * 2"
			                  fill="rgba(99, 102, 241, 0.12)"
			                ></rect>
			                <line
			                  *ngIf="chart.nowX !== null"
			                  [attr.x1]="chart.nowX"
			                  [attr.x2]="chart.nowX"
			                  [attr.y1]="chart.pad"
			                  [attr.y2]="chart.height - chart.pad"
			                  stroke="rgba(100, 116, 139, 0.6)"
			                  stroke-width="1"
			                  stroke-dasharray="4 4"
			                ></line>
			                <polyline
			                  [attr.points]="chart.polyline"
			                  fill="none"
			                  stroke="rgba(99, 102, 241, 0.9)"
			                  stroke-width="2"
			                  stroke-linejoin="round"
			                  stroke-linecap="round"
			                ></polyline>
			                <circle
			                  *ngFor="let dot of chart.dots"
			                  [attr.cx]="dot.x"
			                  [attr.cy]="dot.y"
			                  r="2.5"
			                  fill="rgba(99, 102, 241, 0.95)"
			                ></circle>
			              </svg>
			            </div>

			            <div class="flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
			              <span class="rounded-full border border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900">
			                {{ 'adminUi.products.priceHistory.latest' | translate }}:
			                {{ chart.latest | localizedCurrency : editingCurrency() }}
			              </span>
			              <span class="rounded-full border border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900">
			                {{ 'adminUi.products.priceHistory.min' | translate }}:
			                {{ chart.min | localizedCurrency : editingCurrency() }}
			              </span>
			              <span class="rounded-full border border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900">
			                {{ 'adminUi.products.priceHistory.max' | translate }}:
			                {{ chart.max | localizedCurrency : editingCurrency() }}
			              </span>
			              <span
			                *ngIf="form.sale_start_at && form.sale_end_at"
			                class="rounded-full border border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900"
			              >
			                {{ 'adminUi.products.priceHistory.saleWindow' | translate }}:
			                {{ form.sale_start_at }} → {{ form.sale_end_at }}
			              </span>
			            </div>
			          </div>

			          <ng-template #priceHistoryEmpty>
			            <div class="text-sm text-slate-600 dark:text-slate-300">
			              {{ 'adminUi.products.priceHistory.empty' | translate }}
			            </div>
			          </ng-template>

			          <div
			            *ngIf="priceHistoryChanges().length > 0"
			            class="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
			          >
			            <table class="w-full text-left text-sm">
			              <thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
			                <tr>
			                  <th class="px-3 py-2">{{ 'adminUi.products.priceHistory.table.when' | translate }}</th>
			                  <th class="px-3 py-2">{{ 'adminUi.products.priceHistory.table.user' | translate }}</th>
			                  <th class="px-3 py-2">{{ 'adminUi.products.priceHistory.table.from' | translate }}</th>
			                  <th class="px-3 py-2">{{ 'adminUi.products.priceHistory.table.to' | translate }}</th>
			                </tr>
			              </thead>
			              <tbody>
			                <tr *ngFor="let change of priceHistoryChanges()" class="border-t border-slate-200 dark:border-slate-800">
			                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ change.at | date: 'short' }}</td>
			                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ change.user || '—' }}</td>
			                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
			                    {{ change.before | localizedCurrency : editingCurrency() }}
			                  </td>
			                  <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
			                    {{ change.after | localizedCurrency : editingCurrency() }}
			                  </td>
			                </tr>
			              </tbody>
			            </table>
			          </div>
                </div>
			        </details>

			        <details class="group rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/20">
			          <summary class="flex items-start justify-between gap-4 cursor-pointer select-none [&::-webkit-details-marker]:hidden">
			            <div class="min-w-0 grid gap-1">
			              <h3 class="text-sm font-semibold tracking-wide uppercase text-slate-700 dark:text-slate-200">
			                {{ 'adminUi.products.audit.title' | translate }}
			              </h3>
			              <p class="text-xs text-slate-500 dark:text-slate-400">
			                {{ 'adminUi.products.audit.hint' | translate }}
			              </p>
			            </div>
			            <div class="flex items-center gap-2">
			              <span
			                *ngIf="auditEntries().length"
			                class="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
			              >
			                {{ auditEntries().length }}
			              </span>
			              <span class="text-slate-500 transition-transform group-open:rotate-90 dark:text-slate-400">▸</span>
			            </div>
			          </summary>

			          <div class="mt-3 grid gap-3">
			            <div class="flex flex-wrap items-center justify-end gap-2">
			              <app-button
			                size="sm"
			                variant="ghost"
			                [label]="'adminUi.actions.refresh' | translate"
			                (action)="refreshAudit()"
			                [disabled]="auditBusy() || !editingSlug()"
			              ></app-button>
			            </div>

			            <div
			              *ngIf="auditError()"
			              class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
			            >
			              {{ auditError() }}
			            </div>

			            <div *ngIf="auditBusy()" class="text-sm text-slate-600 dark:text-slate-300">
			              {{ 'adminUi.actions.loading' | translate }}
			            </div>

			            <div *ngIf="!auditBusy() && auditEntries().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
			              {{ 'adminUi.products.audit.empty' | translate }}
			            </div>

			            <div
			              *ngIf="auditEntries().length > 0"
			              class="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
			            >
			              <table class="w-full text-sm">
			                <thead class="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950/20 dark:text-slate-400">
			                  <tr>
			                    <th class="px-3 py-2">{{ 'adminUi.products.audit.when' | translate }}</th>
			                    <th class="px-3 py-2">{{ 'adminUi.products.audit.action' | translate }}</th>
			                    <th class="px-3 py-2">{{ 'adminUi.products.audit.user' | translate }}</th>
			                    <th class="px-3 py-2">{{ 'adminUi.products.audit.details' | translate }}</th>
			                  </tr>
			                </thead>
			                <tbody>
			                  <tr *ngFor="let entry of auditEntries()" class="border-t border-slate-200 dark:border-slate-800">
			                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">{{ entry.created_at | date: 'short' }}</td>
			                    <td class="px-3 py-2 font-semibold text-slate-900 dark:text-slate-50">{{ entry.action }}</td>
			                    <td class="px-3 py-2 text-slate-700 dark:text-slate-200">
			                      {{ entry.user_email || entry.user_id || '—' }}
			                    </td>
			                    <td class="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
			                      <div *ngIf="entry.payload?.changes as changes; else auditFallback" class="grid gap-1">
			                        <div *ngFor="let item of changes | keyvalue" class="grid gap-1 sm:grid-cols-[160px_1fr] sm:gap-3">
			                          <span class="font-semibold text-slate-700 dark:text-slate-200">{{ item.key }}</span>
			                          <span class="truncate">
			                            {{ formatAuditValue(item.value?.before) }} → {{ formatAuditValue(item.value?.after) }}
			                          </span>
			                        </div>
			                      </div>
			                      <ng-template #auditFallback>
			                        <span *ngIf="entry.payload as payload; else auditEmpty">{{ formatAuditValue(payload) }}</span>
			                        <ng-template #auditEmpty>—</ng-template>
			                      </ng-template>
			                    </td>
			                  </tr>
			                </tbody>
			              </table>
			            </div>
			          </div>
			        </details>

			        <details
			          data-ignore-dirty
			          class="group rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/20"
			        >
			          <summary class="flex items-start justify-between gap-4 cursor-pointer select-none [&::-webkit-details-marker]:hidden">
			            <div class="min-w-0 grid gap-1">
			              <h3 class="text-sm font-semibold tracking-wide uppercase text-slate-700 dark:text-slate-200">
			                {{ 'adminUi.products.form.stockLedgerTitle' | translate }}
			              </h3>
			              <p class="text-xs text-slate-500 dark:text-slate-400">
			                {{ 'adminUi.products.form.stockLedgerHint' | translate }}
			              </p>
			            </div>
			            <div class="flex items-center gap-2">
			              <span
			                *ngIf="stockAdjustments().length"
			                class="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
			              >
			                {{ stockAdjustments().length }}
			              </span>
			              <span class="text-slate-500 transition-transform group-open:rotate-90 dark:text-slate-400">▸</span>
			            </div>
			          </summary>

			          <div class="mt-3 grid gap-3">
			            <div
			              *ngIf="stockAdjustmentsError()"
			              class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
			            >
			              {{ stockAdjustmentsError() }}
			            </div>

			            <div class="grid gap-3 items-end md:grid-cols-5">
			              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
			                {{ 'adminUi.products.form.stockLedgerTarget' | translate }}
			                <select
			                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
			                  [(ngModel)]="stockAdjustTarget"
			                  [disabled]="stockAdjustBusy() || !editingSlug()"
			                >
			                  <option value="">{{ 'adminUi.products.form.stockLedgerTargetProduct' | translate }}</option>
			                  <option *ngFor="let v of variantsWithIds()" [value]="v.id">{{ v.name }}</option>
			                </select>
			              </label>

			              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
			                {{ 'adminUi.products.form.stockLedgerReason' | translate }}
			                <select
			                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
			                  [(ngModel)]="stockAdjustReason"
			                  [disabled]="stockAdjustBusy() || !editingSlug()"
			                >
			                  <option value="restock">{{ 'adminUi.products.form.stockReason.restock' | translate }}</option>
			                  <option value="damage">{{ 'adminUi.products.form.stockReason.damage' | translate }}</option>
			                  <option value="manual_correction">{{ 'adminUi.products.form.stockReason.manual_correction' | translate }}</option>
			                </select>
			              </label>

			              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
			                {{ 'adminUi.products.form.stockLedgerDelta' | translate }}
			                <input
			                  class="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
			                  type="number"
			                  step="1"
			                  [(ngModel)]="stockAdjustDelta"
			                  [disabled]="stockAdjustBusy() || !editingSlug()"
			                />
			              </label>

			              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200 md:col-span-2">
			                {{ 'adminUi.products.form.stockLedgerNote' | translate }}
			                <input
			                  class="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
			                  type="text"
			                  [(ngModel)]="stockAdjustNote"
			                  [disabled]="stockAdjustBusy() || !editingSlug()"
			                />
			              </label>
			            </div>

			            <div class="flex items-center gap-2">
			              <app-button
			                size="sm"
			                [label]="'adminUi.products.form.stockLedgerApply' | translate"
			                (action)="applyStockAdjustment()"
			                [disabled]="stockAdjustBusy() || !editingSlug()"
			              ></app-button>
			              <span *ngIf="stockAdjustBusy()" class="text-sm text-slate-600 dark:text-slate-300">
			                {{ 'adminUi.products.form.stockLedgerApplying' | translate }}
			              </span>
			            </div>

			            <div *ngIf="stockAdjustments().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
			              {{ 'adminUi.products.form.stockLedgerEmpty' | translate }}
			            </div>

			            <div *ngIf="stockAdjustments().length > 0" class="overflow-x-auto">
			              <table class="w-full text-sm">
			                <thead>
			                  <tr class="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
			                    <th class="py-2 pr-3">{{ 'adminUi.products.form.stockLedgerWhen' | translate }}</th>
			                    <th class="py-2 pr-3">{{ 'adminUi.products.form.stockLedgerItem' | translate }}</th>
			                    <th class="py-2 pr-3">{{ 'adminUi.products.form.stockLedgerReason' | translate }}</th>
			                    <th class="py-2 pr-3">{{ 'adminUi.products.form.stockLedgerDelta' | translate }}</th>
			                    <th class="py-2 pr-3">{{ 'adminUi.products.form.stockLedgerBefore' | translate }}</th>
			                    <th class="py-2 pr-3">{{ 'adminUi.products.form.stockLedgerAfter' | translate }}</th>
			                    <th class="py-2">{{ 'adminUi.products.form.stockLedgerNote' | translate }}</th>
			                  </tr>
			                </thead>
			                <tbody>
			                  <tr *ngFor="let row of stockAdjustments()" class="border-t border-slate-200 dark:border-slate-800">
			                    <td class="py-2 pr-3 text-slate-700 dark:text-slate-200">{{ formatTimestamp(row.created_at) }}</td>
			                    <td class="py-2 pr-3 text-slate-700 dark:text-slate-200">{{ stockAdjustmentTargetLabel(row) }}</td>
			                    <td class="py-2 pr-3 text-slate-700 dark:text-slate-200">{{ stockReasonLabel(row.reason) }}</td>
			                    <td class="py-2 pr-3 font-semibold" [class.text-emerald-700]="row.delta > 0" [class.text-rose-700]="row.delta < 0">
			                      {{ row.delta > 0 ? '+' + row.delta : row.delta }}
			                    </td>
			                    <td class="py-2 pr-3 text-slate-700 dark:text-slate-200">{{ row.before_quantity }}</td>
			                    <td class="py-2 pr-3 text-slate-700 dark:text-slate-200">{{ row.after_quantity }}</td>
			                    <td class="py-2 text-slate-600 dark:text-slate-300">{{ row.note || '—' }}</td>
			                  </tr>
			                </tbody>
			              </table>
			            </div>
			          </div>
			        </details>

          <div id="product-wizard-content" class="h-0 scroll-mt-24"></div>

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
              (ngModelChange)="onDescriptionChange()"
	          ></textarea>
	        </label>

          <div class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
            <div class="flex items-center justify-between gap-2">
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                {{ 'adminUi.products.markdownPreview.title' | translate }}
              </p>
              <app-button
                size="sm"
                variant="ghost"
                [label]="(descriptionPreviewOpen() ? 'adminUi.actions.hide' : 'adminUi.actions.preview') | translate"
                (action)="toggleDescriptionPreview()"
              ></app-button>
            </div>

            <div *ngIf="descriptionPreviewOpen()" class="grid gap-2">
              <div
                *ngIf="descriptionPreviewSanitized()"
                class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
              >
                {{ 'adminUi.products.markdownPreview.sanitizedWarning' | translate }}
              </div>
              <div class="markdown text-sm text-slate-700 dark:text-slate-200" [innerHTML]="descriptionPreviewHtml()"></div>
            </div>
          </div>

	        <details
	          data-ignore-dirty
	          class="group rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/20"
	        >
	          <summary class="flex items-start justify-between gap-4 cursor-pointer select-none [&::-webkit-details-marker]:hidden">
	            <div class="min-w-0 grid gap-1">
	              <h3 class="text-sm font-semibold tracking-wide uppercase text-slate-700 dark:text-slate-200">
	                {{ 'adminUi.products.translations.title' | translate }}
	              </h3>
	              <p class="text-xs text-slate-500 dark:text-slate-400">
	                {{ 'adminUi.products.translations.hint' | translate }}
	              </p>
	            </div>
	            <div class="flex items-center gap-2">
	              <span class="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
	                {{ (translationExists.ro ? 1 : 0) + (translationExists.en ? 1 : 0) }}/2
	              </span>
	              <span class="text-slate-500 transition-transform group-open:rotate-90 dark:text-slate-400">▸</span>
	            </div>
	          </summary>

	          <div class="mt-3 grid gap-3">
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
                    (ngModelChange)="onTranslationDescriptionChange('ro')"
	                ></textarea>
	              </label>

                <div class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.products.markdownPreview.title' | translate }}
                    </p>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="(translationPreviewOpen.ro ? 'adminUi.actions.hide' : 'adminUi.actions.preview') | translate"
                      (action)="toggleTranslationPreview('ro')"
                    ></app-button>
                  </div>

                  <div *ngIf="translationPreviewOpen.ro" class="grid gap-2">
                    <div
                      *ngIf="translationPreviewSanitized.ro"
                      class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
                    >
                      {{ 'adminUi.products.markdownPreview.sanitizedWarning' | translate }}
                    </div>
                    <div class="markdown text-sm text-slate-700 dark:text-slate-200" [innerHTML]="translationPreviewHtml.ro"></div>
                  </div>
                </div>
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
                    (ngModelChange)="onTranslationDescriptionChange('en')"
	                ></textarea>
	              </label>

                <div class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/20">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                      {{ 'adminUi.products.markdownPreview.title' | translate }}
                    </p>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="(translationPreviewOpen.en ? 'adminUi.actions.hide' : 'adminUi.actions.preview') | translate"
                      (action)="toggleTranslationPreview('en')"
                    ></app-button>
                  </div>

                  <div *ngIf="translationPreviewOpen.en" class="grid gap-2">
                    <div
                      *ngIf="translationPreviewSanitized.en"
                      class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
                    >
                      {{ 'adminUi.products.markdownPreview.sanitizedWarning' | translate }}
                    </div>
                    <div class="markdown text-sm text-slate-700 dark:text-slate-200" [innerHTML]="translationPreviewHtml.en"></div>
                  </div>
                </div>
	              </div>
	            </div>
	          </div>
	        </details>

            <details class="group rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/20">
              <summary class="flex items-start justify-between gap-4 cursor-pointer select-none [&::-webkit-details-marker]:hidden">
                <div class="min-w-0 grid gap-1">
                  <h3 class="text-sm font-semibold tracking-wide uppercase text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.products.seoPreview.title' | translate }}
                  </h3>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.products.seoPreview.hint' | translate }}
                  </p>
                </div>
                <span class="text-slate-500 transition-transform group-open:rotate-90 dark:text-slate-400">▸</span>
              </summary>

              <div class="mt-3 grid gap-4 lg:grid-cols-2">
                <div class="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">RO</p>

                  <div class="grid gap-2">
                    <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.products.seoPreview.cardTitle' | translate }}
                    </p>
                    <div class="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/20">
                      <div class="h-14 w-14 rounded bg-slate-100 overflow-hidden flex items-center justify-center dark:bg-slate-800">
                        <img *ngIf="seoPreviewImageUrl() as url; else seoImgPlaceholder" [src]="url" alt="" class="h-full w-full object-cover" />
                        <ng-template #seoImgPlaceholder>
                          <span class="text-xs text-slate-500 dark:text-slate-400">—</span>
                        </ng-template>
                      </div>
                      <div class="min-w-0 grid gap-1">
                        <p class="font-semibold text-slate-900 dark:text-slate-50 truncate">{{ seoPreviewName('ro') }}</p>
                        <p class="text-sm text-slate-700 dark:text-slate-200">
                          <ng-container *ngIf="previewSalePrice() as sale; else seoBasePriceRo">
                            <span class="font-semibold text-rose-700 dark:text-rose-300">{{ sale | localizedCurrency: 'RON' }}</span>
                            <span class="ml-2 line-through text-slate-500 dark:text-slate-400">{{ previewBasePrice() | localizedCurrency: 'RON' }}</span>
                          </ng-container>
                          <ng-template #seoBasePriceRo>
                            <span class="font-semibold">{{ previewBasePrice() | localizedCurrency: 'RON' }}</span>
                          </ng-template>
                        </p>
                      </div>
                    </div>
                  </div>

                  <div class="grid gap-2">
                    <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.products.seoPreview.snippetTitle' | translate }}
                    </p>
                    <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/20">
                      <p class="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                        {{ seoPreviewTitle('ro') }}
                      </p>
                      <p class="text-xs text-emerald-700 dark:text-emerald-300">
                        {{ seoPreviewUrl() }}
                      </p>
                      <p class="text-sm text-slate-700 dark:text-slate-200">
                        {{ seoPreviewDescription('ro') }}
                      </p>
                    </div>
                  </div>
                </div>

                <div class="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">EN</p>

                  <div class="grid gap-2">
                    <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.products.seoPreview.cardTitle' | translate }}
                    </p>
                    <div class="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/20">
                      <div class="h-14 w-14 rounded bg-slate-100 overflow-hidden flex items-center justify-center dark:bg-slate-800">
                        <img *ngIf="seoPreviewImageUrl() as url; else seoImgPlaceholderEn" [src]="url" alt="" class="h-full w-full object-cover" />
                        <ng-template #seoImgPlaceholderEn>
                          <span class="text-xs text-slate-500 dark:text-slate-400">—</span>
                        </ng-template>
                      </div>
                      <div class="min-w-0 grid gap-1">
                        <p class="font-semibold text-slate-900 dark:text-slate-50 truncate">{{ seoPreviewName('en') }}</p>
                        <p class="text-sm text-slate-700 dark:text-slate-200">
                          <ng-container *ngIf="previewSalePrice() as sale; else seoBasePriceEn">
                            <span class="font-semibold text-rose-700 dark:text-rose-300">{{ sale | localizedCurrency: 'RON' }}</span>
                            <span class="ml-2 line-through text-slate-500 dark:text-slate-400">{{ previewBasePrice() | localizedCurrency: 'RON' }}</span>
                          </ng-container>
                          <ng-template #seoBasePriceEn>
                            <span class="font-semibold">{{ previewBasePrice() | localizedCurrency: 'RON' }}</span>
                          </ng-template>
                        </p>
                      </div>
                    </div>
                  </div>

                  <div class="grid gap-2">
                    <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.products.seoPreview.snippetTitle' | translate }}
                    </p>
                    <div class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/20">
                      <p class="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                        {{ seoPreviewTitle('en') }}
                      </p>
                      <p class="text-xs text-emerald-700 dark:text-emerald-300">
                        {{ seoPreviewUrl() }}
                      </p>
                      <p class="text-sm text-slate-700 dark:text-slate-200">
                        {{ seoPreviewDescription('en') }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </details>

		        <div id="product-wizard-save" class="grid gap-2">
              <div class="flex flex-wrap items-center gap-2">
		            <app-button
                  [label]="editorSaving() ? ('adminUi.common.saving' | translate) : ('adminUi.products.form.save' | translate)"
                  (action)="save()"
                  [disabled]="editorSaving()"
                ></app-button>

                <ng-container *ngIf="editorMessage()">
                  <span
                    class="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
                  >
                    {{ 'adminUi.products.successFeedback.saved' | translate }}
                  </span>
                  <span
                    class="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {{ successStatusLabelKey() | translate }}
                  </span>
                  <span
                    class="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {{ successVisibilityLabelKey() | translate }}
                  </span>
                </ng-container>
              </div>

              <div *ngIf="editorMessage() && editingSlug() as slug" class="flex flex-wrap items-center gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.products.successFeedback.cta.images' | translate"
                  (action)="scrollToImagesSection()"
                ></app-button>
                <app-button
                  *ngIf="savedStatus() !== 'published'"
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.products.successFeedback.cta.publish' | translate"
                  (action)="startPublishWizard()"
                ></app-button>
                <app-button
                  *ngIf="savedIsVisible()"
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.products.successFeedback.cta.view' | translate"
                  [routerLink]="['/products', slug]"
                ></app-button>
              </div>
		        </div>

	        <div id="product-wizard-images" data-ignore-dirty class="grid gap-3">
	          <div class="flex items-center justify-between">
	            <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{{ 'adminUi.products.form.images' | translate }}</p>
	            <div class="flex flex-wrap items-center gap-2">
	              <app-button
	                size="sm"
	                variant="ghost"
	                [label]="
	                  deletedImagesOpen()
	                    ? ('adminUi.products.form.hideDeletedImages' | translate)
	                    : ('adminUi.products.form.showDeletedImages' | translate)
	                "
	                (action)="toggleDeletedImages()"
	                [disabled]="deletedImagesBusy() || !editingSlug()"
	              ></app-button>
	              <label class="text-sm text-slate-700 dark:text-slate-200">
	                {{ 'adminUi.products.form.upload' | translate }}
	                <input type="file" accept="image/*" class="block mt-1" (change)="onUpload($event)" />
	              </label>
	            </div>
	          </div>

          <div *ngIf="images().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'adminUi.products.form.noImages' | translate }}
          </div>

			          <div *ngIf="images().length > 0" class="grid gap-2">
			            <div *ngFor="let img of images(); let idx = index" class="rounded-lg border border-slate-200 dark:border-slate-700">
			              <div class="flex items-center gap-3 p-2">
			                <img [src]="img.url" [alt]="img.alt_text || 'image'" class="h-12 w-12 rounded object-cover" />
		                <div class="flex-1 min-w-0">
		                  <div class="flex flex-wrap items-center gap-2">
		                    <p class="font-semibold text-slate-900 dark:text-slate-50 truncate">{{ img.alt_text || ('adminUi.products.form.image' | translate) }}</p>
		                    <span
		                      *ngIf="idx === 0"
		                      class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
		                    >
		                      {{ 'adminUi.storefront.products.images.primaryBadge' | translate }}
		                    </span>
		                  </div>
		                  <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ img.url }}</p>
		                </div>
		                <div class="flex items-center gap-1">
		                  <app-button
		                    *ngIf="idx > 0"
		                    size="sm"
		                    variant="ghost"
		                    [label]="'adminUi.storefront.products.images.makePrimary' | translate"
		                    [disabled]="imageOrderBusy() || imageMetaBusy() || deleteImageConfirmBusy()"
		                    (action)="makeImagePrimary(img.id)"
		                  ></app-button>
		                  <app-button
		                    size="sm"
		                    variant="ghost"
		                    [label]="'adminUi.actions.edit' | translate"
	                    (action)="toggleImageMeta(img.id)"
	                  ></app-button>
	                  <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.actions.delete' | translate"
                      (action)="openDeleteImageConfirm(img.id)"
		                    ></app-button>
		                </div>
			              </div>

	              <div *ngIf="editingImageId() === img.id" class="grid gap-4 border-t border-slate-200 p-3 dark:border-slate-700">
	                <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
	                  <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{{ 'adminUi.products.form.imageMeta' | translate }}</p>
	                  <div class="flex flex-wrap items-center gap-2">
	                    <app-button
	                      size="sm"
	                      variant="ghost"
	                      [label]="'adminUi.products.form.imageReprocess' | translate"
	                      (action)="reprocessImage()"
	                      [disabled]="imageMetaBusy()"
	                    ></app-button>
	                    <app-button size="sm" variant="ghost" [label]="'adminUi.actions.save' | translate" (action)="saveImageMeta()" [disabled]="imageMetaBusy()"></app-button>
			          </div>

                <p *ngIf="imageOrderError()" class="text-sm text-rose-700 dark:text-rose-300">{{ imageOrderError() }}</p>
	                </div>

	                <p *ngIf="imageMetaError()" class="text-sm text-rose-700 dark:text-rose-300">{{ imageMetaError() }}</p>

	                <div *ngIf="imageStats" class="grid gap-1 text-sm text-slate-700 dark:text-slate-200">
	                  <p>
	                    {{ 'adminUi.products.form.imageSize' | translate }}:
	                    <span class="font-semibold">{{ formatBytes(imageStats.original_bytes) }}</span>
	                    <span *ngIf="imageStats.width && imageStats.height" class="text-slate-500 dark:text-slate-400">
	                      · {{ imageStats.width }}×{{ imageStats.height }}
	                    </span>
	                  </p>
	                  <p class="text-xs text-slate-500 dark:text-slate-400">
	                    {{ 'adminUi.products.form.imageThumbs' | translate }}:
	                    sm {{ formatBytes(imageStats.thumb_sm_bytes) }},
	                    md {{ formatBytes(imageStats.thumb_md_bytes) }},
	                    lg {{ formatBytes(imageStats.thumb_lg_bytes) }}
	                  </p>
	                </div>

	                <div class="grid gap-3 lg:grid-cols-2">
	                  <div class="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
	                    <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">RO</p>
	                    <app-input [label]="'adminUi.products.form.imageAltText' | translate" [(value)]="imageMeta.ro.alt_text"></app-input>
	                    <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                      {{ 'adminUi.products.form.imageCaption' | translate }}
	                      <textarea
	                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                        rows="2"
	                        [(ngModel)]="imageMeta.ro.caption"
	                      ></textarea>
	                    </label>
	                  </div>

	                  <div class="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
	                    <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">EN</p>
	                    <app-input [label]="'adminUi.products.form.imageAltText' | translate" [(value)]="imageMeta.en.alt_text"></app-input>
	                    <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
	                      {{ 'adminUi.products.form.imageCaption' | translate }}
	                      <textarea
	                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                        rows="2"
	                        [(ngModel)]="imageMeta.en.caption"
	                      ></textarea>
	                    </label>
		              </div>
		            </div>
		          </div>

	          <div
	            *ngIf="deletedImagesOpen()"
	            class="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/20"
	          >
	            <div class="flex items-center justify-between gap-3">
	              <p class="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
	                {{ 'adminUi.products.form.deletedImages' | translate }}
	              </p>
	              <span class="text-xs text-slate-500 dark:text-slate-400">
	                {{ deletedImages().length }}
	              </span>
	            </div>

	            <div *ngIf="deletedImagesBusy()" class="text-sm text-slate-600 dark:text-slate-300">
	              {{ 'adminUi.actions.loading' | translate }}
	            </div>

	            <div
	              *ngIf="deletedImagesError()"
	              class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
	            >
	              {{ deletedImagesError() }}
	            </div>

	            <div *ngIf="!deletedImagesBusy() && deletedImages().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
	              {{ 'adminUi.products.form.noDeletedImages' | translate }}
	            </div>

	            <div *ngIf="!deletedImagesBusy() && deletedImages().length > 0" class="grid gap-2">
	              <div
	                *ngFor="let img of deletedImages()"
	                class="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900"
	              >
	                <img [src]="img.url" [alt]="img.alt_text || 'image'" class="h-12 w-12 rounded object-cover" />
	                <div class="flex-1 min-w-0">
	                  <p class="font-semibold text-slate-900 dark:text-slate-50 truncate">
	                    {{ img.alt_text || ('adminUi.products.form.image' | translate) }}
	                  </p>
	                  <p class="text-xs text-slate-500 dark:text-slate-400 truncate">{{ img.url }}</p>
	                  <p *ngIf="img.deleted_at" class="text-xs text-slate-500 dark:text-slate-400">
	                    {{ 'adminUi.products.form.deletedAt' | translate }}: {{ img.deleted_at | date: 'short' }}
	                  </p>
	                </div>
	                <app-button
	                  size="sm"
	                  variant="ghost"
	                  [label]="'adminUi.actions.restore' | translate"
	                  (action)="restoreDeletedImage(img.id)"
	                  [disabled]="restoringDeletedImage() === img.id"
	                ></app-button>
	              </div>
	            </div>
	          </div>
	        </div>
	          </div>
	        </div>
	      </section>

        <div *ngIf="selected.size > 0 && view === 'active'" class="h-24"></div>

        <div *ngIf="selected.size > 0 && view === 'active'" class="fixed inset-x-0 bottom-4 z-40 px-4 sm:px-6">
          <div class="max-w-6xl mx-auto">
            <div
              class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 text-sm text-slate-700 shadow-lg backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-200 dark:shadow-none"
            >
              <div class="font-medium">
                {{ 'adminUi.products.bulk.selected' | translate: { count: selected.size } }}
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.actions.bulkActions' | translate"
                  (action)="scrollToBulkActions()"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.products.bulk.clearSelection' | translate"
                  [disabled]="bulkBusy() || inlineBusy()"
                  (action)="clearSelection()"
                ></app-button>
              </div>
            </div>
          </div>
        </div>
	    </div>
	  `
})
export class AdminProductsComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.admin', url: '/admin/dashboard' },
    { label: 'adminUi.products.title' }
  ];

  readonly productRowHeight = 96;
  readonly tableColumns = PRODUCTS_TABLE_COLUMNS;
  readonly tableDefaults = defaultProductsTableLayout();

  layoutModalOpen = signal(false);
  tableLayout = signal<AdminTableLayoutV1>(defaultProductsTableLayout());

  loading = signal(true);
  error = signal<string | null>(null);
  errorRequestId = signal<string | null>(null);
  products = signal<AdminProductListItem[]>([]);
  meta = signal<AdminProductListResponse['meta'] | null>(null);
  categories = signal<Category[]>([]);

  q = '';
  status: ProductStatusFilter = 'all';
  categorySlug = '';
  translationFilter: ProductTranslationFilter = 'all';
  view: ProductView = 'active';
  page = 1;
  limit = 25;
  selectedSavedViewKey = '';

  productSearchOpen = signal(false);
  productSearchLoading = signal(false);
  productSearchResults = signal<AdminProductListItem[]>([]);
  productSearchError = signal<string | null>(null);
  productSearchActiveIndex = signal(-1);

  private productSearchDebounceHandle: number | null = null;
  private productSearchBlurHandle: number | null = null;
  private productSearchRequestId = 0;
  private productFilterDebounceHandle: number | null = null;

	  editorOpen = signal(false);
	  editingSlug = signal<string | null>(null);
	  editingCurrency = signal('RON');
	  editorError = signal<string | null>(null);
	  editorMessage = signal<string | null>(null);
    editorDirty = signal(false);
    editorSaving = signal(false);
    editorLastSavedAt = signal<string | null>(null);
    lastSavedState = signal<{ status: ProductForm['status']; isActive: boolean } | null>(null);
	  wizardKind = signal<ProductWizardKind | null>(null);
	  wizardStep = signal(0);
    private wizardAdvanceAfterSave = false;
    private wizardExitAfterPublish = false;
    statusConfirmOpen = signal(false);
    statusConfirmBusy = signal(false);
    statusConfirmPrev = signal<{ status: ProductForm['status']; isActive: boolean } | null>(null);
    statusConfirmTarget = signal<{ status: ProductForm['status']; isActive: boolean } | null>(null);
  deleteImageConfirmOpen = signal(false);
  deleteImageConfirmBusy = signal(false);
  deleteImageConfirmTarget = signal<{ id: string; url: string; alt: string } | null>(null);
  images = signal<Array<{ id: string; url: string; alt_text?: string | null; caption?: string | null; sort_order?: number | null }>>([]);
  imageOrderBusy = signal(false);
  imageOrderError = signal<string | null>(null);
  deletedImagesOpen = signal(false);
  deletedImages = signal<AdminDeletedProductImage[]>([]);
  deletedImagesBusy = signal(false);
  deletedImagesError = signal<string | null>(null);
  restoringDeletedImage = signal<string | null>(null);
  editingImageId = signal<string | null>(null);
  imageMetaBusy = signal(false);
  imageMetaError = signal<string | null>(null);
  imageMeta: ImageMetaByLang = this.blankImageMetaByLang();
  imageMetaExists: Record<'en' | 'ro', boolean> = { en: false, ro: false };
  imageStats: AdminProductImageOptimizationStats | null = null;
  adminCategories = signal<Array<{ id: string; name: string }>>([]);
  createCategoryOpen = signal(false);
  createCategoryBusy = signal(false);
  createCategoryError = signal<string | null>(null);
  createCategoryName = '';
  createCategoryParentId = '';
  private createCategoryContext: 'filters' | 'product_form' | 'manager' | 'bulk_assign' = 'product_form';
  categoryManagerOpen = signal(false);
  categoryManagerSlug = '';
  categoryManagerParentId = '';
  categoryManagerUpdateBusy = signal(false);
  categoryManagerUpdateError = signal<string | null>(null);
  mergeTargetSlug = '';
  mergePreview = signal<AdminCategoryMergePreview | null>(null);
  mergePreviewLoading = signal(false);
  mergeSaving = signal(false);
  mergeError = signal<string | null>(null);
  deletePreview = signal<AdminCategoryDeletePreview | null>(null);
  deletePreviewLoading = signal(false);
  deleteSaving = signal(false);
  deleteError = signal<string | null>(null);
  categoryImportFile: File | null = null;
  categoryImportDryRun = true;
  categoryImportBusy = signal(false);
  categoryImportError = signal<string | null>(null);
  categoryImportResult = signal<AdminCategoriesImportResult | null>(null);

  form: ProductForm = this.blankForm();
  private loadedTagSlugs: string[] = [];
  basePriceError = '';
  saleValueError = '';
  descriptionPreviewOpen = signal(false);
  descriptionPreviewHtml = signal('');
  descriptionPreviewSanitized = signal(false);
  translationPreviewOpen: Record<'en' | 'ro', boolean> = { en: false, ro: false };
  translationPreviewHtml: Record<'en' | 'ro', string> = { en: '', ro: '' };
  translationPreviewSanitized: Record<'en' | 'ro', boolean> = { en: false, ro: false };

  duplicateCheck = signal<AdminProductDuplicateCheckResponse | null>(null);
  duplicateBusy = signal(false);
  private duplicateCheckSeq = 0;
  private duplicateCheckTimeoutId: ReturnType<typeof setTimeout> | null = null;

  selected = new Set<string>();
  bulkSaleType: 'percent' | 'amount' = 'percent';
  bulkSaleValue = '';
  bulkCategoryId = '';
  bulkStatusTarget: ProductForm['status'] = 'published';
  bulkStatusConfirmOpen = signal(false);
  bulkStatusConfirmBusy = signal(false);
  bulkPublishScheduledFor = '';
  bulkUnpublishScheduledFor = '';
  bulkBusy = signal(false);
  bulkError = signal<string | null>(null);
  restoringProductId = signal<string | null>(null);
  quickStatusBusyId = signal<string | null>(null);

  inlineEditId: string | null = null;
  inlineBasePrice = '';
  inlineStockQuantity = '';
  inlineSaleEnabled = false;
  inlineSaleType: 'percent' | 'amount' = 'percent';
  inlineSaleValue = '';
  inlineBasePriceError = '';
  inlineStockError = '';
  inlineSaleError = '';
  inlineError = '';
  inlineBusy = signal(false);

  bulkPriceMode: 'percent' | 'amount' = 'percent';
  bulkPriceDirection: 'increase' | 'decrease' = 'increase';
  bulkPriceValue = '';
  bulkPricePreview: { old_min: string; old_max: string; new_min: string; new_max: string; currency: string } | null = null;

  translationLoading = signal(false);
  translationError = signal<string | null>(null);
  translationExists: Record<'en' | 'ro', boolean> = { en: false, ro: false };
  translations: Record<'en' | 'ro', ProductTranslationForm> = {
    en: this.blankTranslationForm(),
    ro: this.blankTranslationForm()
  };

	  editingProductId = signal<string | null>(null);
	  auditEntries = signal<AdminProductAuditEntry[]>([]);
	  auditBusy = signal(false);
	  auditError = signal<string | null>(null);
	  priceHistoryChanges = signal<PriceChangeEvent[]>([]);
	  priceHistoryChart = signal<PriceHistoryChart | null>(null);

  csvImportOpen = signal(false);
  csvImportFile = signal<File | null>(null);
  csvImportBusy = signal(false);
  csvImportError = signal<string | null>(null);
  csvImportResult = signal<AdminProductsImportResult | null>(null);

  variants = signal<VariantRow[]>([]);
  variantsBusy = signal(false);
  variantsError = signal<string | null>(null);
  private pendingVariantDeletes = new Set<string>();

  relationshipsRelatedIds = signal<string[]>([]);
  relationshipsUpsellIds = signal<string[]>([]);
  relationshipsRelated = signal<AdminProductListItem[]>([]);
  relationshipsUpsells = signal<AdminProductListItem[]>([]);
  relationshipsLoading = signal(false);
  relationshipsSaving = signal(false);
  relationshipsError = signal<string | null>(null);
  relationshipsMessage = signal<string | null>(null);

  relationshipSearch = '';
  relationshipSearchResults = signal<AdminProductListItem[]>([]);
  relationshipSearchLoading = signal(false);
  private relationshipSearchTimeout: ReturnType<typeof setTimeout> | null = null;
  private relationshipSearchRequestId = 0;

  stockAdjustments = signal<StockAdjustment[]>([]);
  stockAdjustmentsError = signal<string | null>(null);
  stockAdjustBusy = signal(false);
  stockAdjustTarget = '';
  stockAdjustReason: StockAdjustmentReason = 'manual_correction';
  stockAdjustDelta = '';
  stockAdjustNote = '';

  private autoStartNewProduct = false;
  private pendingEditProductSlug: string | null = null;

  constructor(
    private productsApi: AdminProductsService,
    private catalog: CatalogService,
    private admin: AdminService,
    private auth: AuthService,
    private recent: AdminRecentService,
    public uiPrefs: AdminUiPrefsService,
    private markdown: MarkdownService,
    private toast: ToastService,
    private translate: TranslateService,
    public favorites: AdminFavoritesService
  ) {}

  ngOnInit(): void {
    this.favorites.init();
    this.tableLayout.set(loadAdminTableLayout(this.tableLayoutStorageKey(), this.tableColumns, this.tableDefaults));
    const state = history.state as any;
    const editSlug = typeof state?.editProductSlug === 'string' ? state.editProductSlug : '';
    this.pendingEditProductSlug = editSlug.trim() ? editSlug.trim() : null;
    this.autoStartNewProduct = !this.pendingEditProductSlug && Boolean(state?.openNewProduct);
    this.maybeApplyFiltersFromState(state);
    this.loadCategories();
    this.loadAdminCategories();
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
    const el = document.getElementById('admin-products-bulk-actions');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      const focusable = el.querySelector<HTMLElement>('select, input, button, [href], [tabindex]:not([tabindex="-1"])');
      focusable?.focus();
    }, 0);
  }

  successStatusLabelKey(): string {
    return `adminUi.status.${this.savedStatus()}`;
  }

  successVisibilityLabelKey(): string {
    return this.savedIsVisible() ? 'adminUi.products.successFeedback.visible' : 'adminUi.products.successFeedback.hidden';
  }

  savedStatus(): ProductForm['status'] {
    return this.lastSavedState()?.status ?? this.form.status;
  }

  savedIsVisible(): boolean {
    const snap = this.lastSavedState();
    const status = snap?.status ?? this.form.status;
    const isActive = snap?.isActive ?? this.form.is_active;
    return status === 'published' && isActive;
  }

  scrollToImagesSection(): void {
    this.scrollToWizardAnchor('product-wizard-images');
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

  private tableLayoutStorageKey(): string {
    return adminTableLayoutStorageKey('products', this.auth.user()?.id);
  }

  applyFilters(): void {
    this.page = 1;
    this.selectedSavedViewKey = '';
    this.clearSelection();
    this.cancelInlineEdit();
    this.load();
  }

  openProductSearch(): void {
    const needle = (this.q || '').trim();
    const shouldOpen =
      needle.length >= 2 || this.productSearchLoading() || !!this.productSearchError() || this.productSearchResults().length > 0;
    if (!shouldOpen) return;
    if (this.productSearchBlurHandle !== null) {
      clearTimeout(this.productSearchBlurHandle);
      this.productSearchBlurHandle = null;
    }
    this.productSearchOpen.set(true);
    if (this.productSearchActiveIndex() === -1 && this.productSearchResults().length > 0) {
      this.productSearchActiveIndex.set(0);
    }
  }

  onProductSearchBlur(): void {
    if (this.productSearchBlurHandle !== null) clearTimeout(this.productSearchBlurHandle);
    this.productSearchBlurHandle = window.setTimeout(() => {
      this.productSearchOpen.set(false);
      this.productSearchActiveIndex.set(-1);
      this.productSearchBlurHandle = null;
    }, 150);
  }

  onProductSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.productSearchOpen.set(false);
      this.productSearchActiveIndex.set(-1);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.openProductSearch();
      this.moveProductSearchActive(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.openProductSearch();
      this.moveProductSearchActive(-1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      this.setProductSearchActive(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      this.setProductSearchActive(this.productSearchResults().length - 1);
      return;
    }
    if (event.key !== 'Enter') return;
    const selected = this.getProductSearchActive() || this.productSearchResults()[0];
    if (!selected) return;
    event.preventDefault();
    this.selectProductSearch(selected);
  }

  onProductSearchChange(): void {
    const needle = (this.q || '').trim();
    this.productSearchError.set(null);
    this.productSearchActiveIndex.set(-1);

    this.scheduleProductFiltersApply();

    if (this.productSearchDebounceHandle !== null) {
      clearTimeout(this.productSearchDebounceHandle);
      this.productSearchDebounceHandle = null;
    }

    if (needle.length < 2) {
      this.productSearchResults.set([]);
      this.productSearchLoading.set(false);
      this.productSearchActiveIndex.set(-1);
      this.productSearchOpen.set(false);
      return;
    }

    this.productSearchDebounceHandle = window.setTimeout(() => {
      this.productSearchDebounceHandle = null;
      this.runProductSearch(needle);
    }, 250);
  }

  private scheduleProductFiltersApply(): void {
    if (this.productFilterDebounceHandle !== null) clearTimeout(this.productFilterDebounceHandle);
    this.productFilterDebounceHandle = window.setTimeout(() => {
      this.productFilterDebounceHandle = null;
      this.applyFilters();
    }, 250);
  }

  private runProductSearch(needle: string): void {
    this.openProductSearch();
    this.productSearchLoading.set(true);
    const requestId = ++this.productSearchRequestId;
    this.productsApi
      .search({
        q: needle,
        status: this.status === 'all' ? undefined : this.status,
        category_slug: this.categorySlug || undefined,
        missing_translations: this.translationFilter === 'missing_any' ? true : undefined,
        missing_translation_lang:
          this.translationFilter === 'missing_en' ? 'en' : this.translationFilter === 'missing_ro' ? 'ro' : undefined,
        deleted: this.view === 'deleted' ? true : undefined,
        page: 1,
        limit: 8
      })
      .subscribe({
        next: (res) => {
          if (requestId !== this.productSearchRequestId) return;
          const items = Array.isArray(res?.items) ? res.items : [];
          this.productSearchResults.set(items);
          this.productSearchActiveIndex.set(items.length > 0 ? 0 : -1);
          this.productSearchLoading.set(false);
        },
        error: () => {
          if (requestId !== this.productSearchRequestId) return;
          this.productSearchResults.set([]);
          this.productSearchLoading.set(false);
          this.productSearchActiveIndex.set(-1);
          this.productSearchError.set(this.t('adminUi.products.errors.loadList'));
        }
      });
  }

  productSearchActiveDescendant(): string | null {
    if (!this.productSearchOpen()) return null;
    const idx = this.productSearchActiveIndex();
    if (idx < 0 || idx >= this.productSearchResults().length) return null;
    return `admin-products-search-option-${idx}`;
  }

  selectProductSearch(item: AdminProductListItem, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.productSearchOpen.set(false);
    this.productSearchActiveIndex.set(-1);
    this.edit(item.slug);
  }

  private getProductSearchActive(): AdminProductListItem | null {
    const idx = this.productSearchActiveIndex();
    const items = this.productSearchResults();
    if (idx < 0 || idx >= items.length) return null;
    return items[idx];
  }

  private moveProductSearchActive(delta: number): void {
    const items = this.productSearchResults();
    if (items.length === 0) {
      this.productSearchActiveIndex.set(-1);
      return;
    }
    const current = this.productSearchActiveIndex();
    const next = Math.max(0, Math.min(items.length - 1, (current < 0 ? 0 : current) + delta));
    this.setProductSearchActive(next);
  }

  private setProductSearchActive(index: number): void {
    const items = this.productSearchResults();
    if (items.length === 0) {
      this.productSearchActiveIndex.set(-1);
      return;
    }
    const bounded = Math.max(0, Math.min(items.length - 1, index));
    this.productSearchActiveIndex.set(bounded);
    const id = `admin-products-search-option-${bounded}`;
    window.setTimeout(() => {
      if (typeof document === 'undefined') return;
      document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
    }, 0);
  }

  setStatusFilter(next: ProductStatusFilter): void {
    if (this.status === next) return;
    this.status = next;
    this.applyFilters();
  }

  resetFilters(): void {
    this.q = '';
    this.status = 'all';
    this.categorySlug = '';
    this.translationFilter = 'all';
    this.page = 1;
    this.selectedSavedViewKey = '';
    this.clearSelection();
    this.cancelInlineEdit();
    this.load();
  }

  savedViews(): AdminFavoriteItem[] {
    return this.favorites
      .items()
      .filter((item) => item?.type === 'filter' && (item?.state as any)?.adminFilterScope === 'products');
  }

  applySavedView(key: string): void {
    this.selectedSavedViewKey = key;
    if (!key) return;
    const view = this.savedViews().find((item) => item.key === key);
    const filters = view?.state && typeof view.state === 'object' ? (view.state as any).adminFilters : null;
    if (!filters || typeof filters !== 'object') return;

    this.q = String(filters.q ?? '');
    this.status = (filters.status ?? 'all') as ProductStatusFilter;
    this.categorySlug = String(filters.categorySlug ?? '');
    this.translationFilter = (filters.translationFilter ?? 'all') as ProductTranslationFilter;
    this.view = (filters.view ?? 'active') as ProductView;
    const nextLimit = typeof filters.limit === 'number' && Number.isFinite(filters.limit) ? filters.limit : this.limit;
    this.limit = nextLimit;
    this.page = 1;
    this.clearSelection();
    this.cancelInlineEdit();
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
      url: '/admin/products',
      state: { adminFilterScope: 'products', adminFilters: filters }
    });
    this.selectedSavedViewKey = key;
  }

  private maybeApplyFiltersFromState(state: any): void {
    const scope = (state?.adminFilterScope || '').toString();
    if (scope !== 'products') return;
    const filters = state?.adminFilters;
    if (!filters || typeof filters !== 'object') return;

    this.q = String(filters.q ?? '');
    this.status = (filters.status ?? 'all') as ProductStatusFilter;
    this.categorySlug = String(filters.categorySlug ?? '');
    this.translationFilter = (filters.translationFilter ?? 'all') as ProductTranslationFilter;
    this.view = (filters.view ?? 'active') as ProductView;
    const nextLimit = typeof filters.limit === 'number' && Number.isFinite(filters.limit) ? filters.limit : this.limit;
    this.limit = nextLimit;
    this.page = 1;
    this.selectedSavedViewKey = this.currentViewFavoriteKey();
  }

  private currentViewFilters(): {
    q: string;
    status: ProductStatusFilter;
    categorySlug: string;
    translationFilter: ProductTranslationFilter;
    view: ProductView;
    limit: number;
  } {
    return {
      q: this.q,
      status: this.status,
      categorySlug: this.categorySlug,
      translationFilter: this.translationFilter,
      view: this.view,
      limit: this.limit
    };
  }

  private currentViewFavoriteKey(): string {
    return adminFilterFavoriteKey('products', this.currentViewFilters());
  }

  goToPage(page: number): void {
    this.page = page;
    this.clearSelection();
    this.cancelInlineEdit();
    this.load();
  }

  useVirtualProductsTable(): boolean {
    return this.inlineEditId === null && this.products().length > 100;
  }

  trackProductId(_: number, product: AdminProductListItem): string {
    return product.id;
  }

  clearSelection(): void {
    this.selected = new Set<string>();
    this.bulkError.set(null);
    this.bulkPricePreview = null;
  }

  toggleSelected(productId: string, event: Event): void {
    if (this.view === 'deleted') return;
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
    this.updateBulkPricePreview();
  }

  allSelectedOnPage(): boolean {
    if (this.view === 'deleted') return false;
    const items = this.products();
    if (!items.length) return false;
    return items.every((p) => this.selected.has(p.id));
  }

  toggleSelectAll(event: Event): void {
    if (this.view === 'deleted') return;
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
    this.updateBulkPricePreview();
  }

  selectedProductsOnPage(): AdminProductListItem[] {
    const selected = this.selected;
    return this.products().filter((p) => selected.has(p.id));
  }

  openBulkStatusConfirm(): void {
    this.bulkError.set(null);
    if (!this.selected.size) return;
    this.bulkStatusConfirmBusy.set(false);
    this.bulkStatusConfirmOpen.set(true);
  }

  closeBulkStatusConfirm(): void {
    this.bulkStatusConfirmOpen.set(false);
    this.bulkStatusConfirmBusy.set(false);
  }

  confirmBulkStatusChange(): void {
    const items = this.selectedProductsOnPage();
    if (!items.length) {
      this.closeBulkStatusConfirm();
      return;
    }

    const nextStatus = this.bulkStatusTarget;
    const payload = items.map((p) => ({ product_id: p.id, status: nextStatus }));
    const undoPayload = items.map((p) => ({ product_id: p.id, status: p.status }));

    this.bulkError.set(null);
    this.bulkStatusConfirmBusy.set(true);
    this.bulkBusy.set(true);
    this.admin.bulkUpdateProducts(payload).subscribe({
      next: () => {
        const count = payload.length;
        this.bulkBusy.set(false);
        this.bulkStatusConfirmBusy.set(false);
        this.closeBulkStatusConfirm();
        this.toast.action(
          this.translate.instant('adminUi.products.bulk.status.success', { count }),
          this.translate.instant('adminUi.actions.undo'),
          () => this.undoBulkStatusChange(undoPayload),
          { tone: 'success', durationMs: 8000 }
        );
        this.clearSelection();
        this.load();
      },
      error: () => {
        this.bulkBusy.set(false);
        this.bulkStatusConfirmBusy.set(false);
        this.bulkError.set(this.t('adminUi.products.bulk.error'));
      }
    });
  }

  private undoBulkStatusChange(payload: Array<{ product_id: string; status: string }>): void {
    if (!payload.length) return;
    this.admin.bulkUpdateProducts(payload).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('adminUi.products.bulk.status.undoSuccess'));
        this.load();
      },
      error: () => this.toast.error(this.translate.instant('adminUi.products.bulk.status.undoError'))
    });
  }

  openCreateCategory(context: 'filters' | 'product_form' | 'manager' | 'bulk_assign'): void {
    this.createCategoryContext = context;
    this.createCategoryName = '';
    this.createCategoryParentId = '';
    this.createCategoryError.set(null);
    this.createCategoryBusy.set(false);
    this.createCategoryOpen.set(true);
  }

  closeCreateCategory(): void {
    this.createCategoryOpen.set(false);
    this.createCategoryBusy.set(false);
    this.createCategoryError.set(null);
  }

  confirmCreateCategory(): void {
    const name = (this.createCategoryName || '').trim();
    if (!name || this.createCategoryBusy()) return;
    const parentId = (this.createCategoryParentId || '').trim();
    const parent_id = parentId ? parentId : null;

    this.createCategoryBusy.set(true);
    this.createCategoryError.set(null);
    this.admin.createCategory({ name, parent_id }).subscribe({
      next: (cat) => {
        this.createCategoryBusy.set(false);
        this.createCategoryOpen.set(false);
        this.toast.success(this.t('adminUi.categories.success.add'));

        this.upsertCategoryLists(cat);
        if (this.createCategoryContext === 'product_form') {
          this.form.category_id = cat.id;
        } else if (this.createCategoryContext === 'filters') {
          this.categorySlug = cat.slug;
        } else if (this.createCategoryContext === 'bulk_assign') {
          this.bulkCategoryId = cat.id;
          this.applyCategoryToSelected();
        }
      },
      error: (err) => {
        this.createCategoryBusy.set(false);
        this.createCategoryError.set(err?.error?.detail || this.t('adminUi.categories.errors.add'));
      }
    });
  }

  private upsertCategoryLists(cat: AdminCategory): void {
    const currentCategories = this.categories();
    const nextCategory: Category = {
      id: cat.id,
      slug: cat.slug,
      name: cat.name,
      parent_id: cat.parent_id ?? null,
      sort_order: cat.sort_order ?? undefined,
      thumbnail_url: cat.thumbnail_url ?? null,
      banner_url: cat.banner_url ?? null,
      is_visible: cat.is_visible
    };
    const nextCategories = [...currentCategories];
    const existingIdx = nextCategories.findIndex((c) => c.id === nextCategory.id);
    if (existingIdx >= 0) {
      nextCategories[existingIdx] = { ...nextCategories[existingIdx], ...nextCategory };
    } else {
      nextCategories.push(nextCategory);
    }
    this.categories.set(nextCategories);

    const currentAdminCategories = this.adminCategories();
    const nextAdminCategories = [...currentAdminCategories];
    const existingAdminIdx = nextAdminCategories.findIndex((c) => c.id === cat.id);
    const adminItem = { id: cat.id, name: cat.name };
    if (existingAdminIdx >= 0) {
      nextAdminCategories[existingAdminIdx] = adminItem;
    } else {
      nextAdminCategories.push(adminItem);
    }
    this.adminCategories.set(nextAdminCategories);
  }

  openCategoryManager(): void {
    this.categoryManagerSlug = '';
    this.categoryManagerParentId = '';
    this.categoryManagerUpdateBusy.set(false);
    this.categoryManagerUpdateError.set(null);
    this.resetCategoryManagerActions();
    this.categoryManagerOpen.set(true);
    this.refreshCategoryLists();
  }

  closeCategoryManager(): void {
    this.categoryManagerOpen.set(false);
    this.categoryManagerUpdateBusy.set(false);
    this.mergePreviewLoading.set(false);
    this.mergeSaving.set(false);
    this.deletePreviewLoading.set(false);
    this.deleteSaving.set(false);
  }

  openCreateCategoryFromManager(): void {
    this.closeCategoryManager();
    this.openCreateCategory('manager');
  }

  openCreateCategoryFromBulkAssign(): void {
    this.openCreateCategory('bulk_assign');
  }

  onCategoryManagerSelect(slug: string): void {
    this.categoryManagerSlug = String(slug ?? '');
    const cat = this.categoryManagerSelectedCategory();
    this.categoryManagerParentId = (cat?.parent_id ?? '').trim();
    this.categoryManagerUpdateError.set(null);
    this.resetCategoryManagerActions();
  }

  categoryManagerSelectedCategory(): Category | null {
    const slug = (this.categoryManagerSlug || '').trim();
    if (!slug) return null;
    return this.categories().find((c) => c.slug === slug) ?? null;
  }

  resetCategoryManagerParent(): void {
    const cat = this.categoryManagerSelectedCategory();
    this.categoryManagerUpdateError.set(null);
    this.categoryManagerParentId = (cat?.parent_id ?? '').trim();
  }

  saveCategoryManagerParent(): void {
    const cat = this.categoryManagerSelectedCategory();
    if (!cat) return;
    if (this.categoryManagerUpdateBusy()) return;

    const nextParentId = (this.categoryManagerParentId || '').trim() || null;
    const prevParentId = (cat.parent_id ?? '').trim() || null;
    if (nextParentId === prevParentId) return;

    this.categoryManagerUpdateBusy.set(true);
    this.categoryManagerUpdateError.set(null);
    this.admin.updateCategory(cat.slug, { parent_id: nextParentId }).subscribe({
      next: (updated) => {
        this.categoryManagerUpdateBusy.set(false);
        this.toast.success(this.t('adminUi.categories.success.updateParent'));
        this.categoryManagerParentId = (updated.parent_id ?? '').trim();
        this.refreshCategoryLists();
      },
      error: (err) => {
        this.categoryManagerUpdateBusy.set(false);
        this.categoryManagerUpdateError.set(err?.error?.detail || this.t('adminUi.categories.errors.updateParent'));
        this.categoryManagerParentId = prevParentId || '';
      }
    });
  }

  categoryParentOptions(cat: Category): Category[] {
    const currentId = cat.id;
    const excluded = this.categoryDescendantIds(currentId);
    excluded.add(currentId);
    return this.categories()
      .filter((candidate) => !excluded.has(candidate.id))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }

  private categoryDescendantIds(rootId: string): Set<string> {
    const childrenByParent = new Map<string, string[]>();
    for (const cat of this.categories()) {
      const parentId = (cat.parent_id ?? '').trim();
      if (!parentId) continue;
      const bucket = childrenByParent.get(parentId);
      if (bucket) {
        bucket.push(cat.id);
      } else {
        childrenByParent.set(parentId, [cat.id]);
      }
    }
    const resolved = new Set<string>();
    const stack = [...(childrenByParent.get(rootId) ?? [])];
    while (stack.length) {
      const next = stack.pop()!;
      if (resolved.has(next)) continue;
      resolved.add(next);
      const kids = childrenByParent.get(next);
      if (kids?.length) stack.push(...kids);
    }
    return resolved;
  }

  mergeTargetOptions(source: Category): Category[] {
    const parentId = (source.parent_id ?? '').trim() || null;
    return this.categories()
      .filter((candidate) => ((candidate.parent_id ?? '').trim() || null) === parentId && candidate.slug !== source.slug)
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }

  onMergeTargetChange(): void {
    this.mergePreview.set(null);
    this.mergeError.set(null);
  }

  previewCategoryMerge(): void {
    const cat = this.categoryManagerSelectedCategory();
    if (!cat) return;
    if (this.mergePreviewLoading() || this.mergeSaving()) return;

    const targetSlug = (this.mergeTargetSlug || '').trim();
    if (!targetSlug) {
      this.mergeError.set(this.t('adminUi.storefront.categories.mergeSelectTarget'));
      return;
    }

    this.mergePreviewLoading.set(true);
    this.mergeError.set(null);
    this.mergePreview.set(null);
    this.admin.previewMergeCategory(cat.slug, targetSlug).subscribe({
      next: (preview) => {
        this.mergePreviewLoading.set(false);
        this.mergePreview.set(preview);
        if (!preview.can_merge) {
          this.mergeError.set(this.t(this.mergeReasonKey(preview.reason)));
        }
      },
      error: () => {
        this.mergePreviewLoading.set(false);
        this.mergeError.set(this.t('adminUi.storefront.categories.mergePreviewError'));
      }
    });
  }

  mergeCategorySelected(): void {
    const cat = this.categoryManagerSelectedCategory();
    if (!cat) return;
    if (this.mergeSaving()) return;

    const targetSlug = (this.mergeTargetSlug || '').trim();
    if (!targetSlug) {
      this.mergeError.set(this.t('adminUi.storefront.categories.mergeSelectTarget'));
      return;
    }

    const preview = this.mergePreview();
    if (!preview) {
      this.mergeError.set(this.t('adminUi.storefront.categories.mergePreviewRequired'));
      return;
    }
    if (!preview.can_merge) {
      this.mergeError.set(this.t(this.mergeReasonKey(preview.reason)));
      return;
    }

    const targetName = this.categories().find((c) => c.slug === targetSlug)?.name ?? targetSlug;
    const confirmed = confirm(
      this.translate.instant('adminUi.storefront.categories.confirmMerge', {
        source: cat.name,
        target: targetName,
        count: preview.product_count
      })
    );
    if (!confirmed) return;

    this.mergeSaving.set(true);
    this.admin.mergeCategory(cat.slug, targetSlug).subscribe({
      next: () => {
        this.mergeSaving.set(false);
        this.toast.success(this.t('adminUi.storefront.categories.mergeSuccess'));
        this.categoryManagerSlug = '';
        this.categoryManagerParentId = '';
        this.resetCategoryManagerActions();
        this.refreshCategoryLists();
      },
      error: () => {
        this.mergeSaving.set(false);
        this.mergeError.set(this.t('adminUi.storefront.categories.mergeError'));
      }
    });
  }

  private mergeReasonKey(reason: string | null | undefined): string {
    if (reason === 'same_category') return 'adminUi.storefront.categories.mergeReasonSame';
    if (reason === 'different_parent') return 'adminUi.storefront.categories.mergeReasonParent';
    if (reason === 'source_has_children') return 'adminUi.storefront.categories.mergeReasonChildren';
    return 'adminUi.storefront.categories.mergeNotAllowed';
  }

  previewCategoryDelete(): void {
    const cat = this.categoryManagerSelectedCategory();
    if (!cat) return;
    if (this.deletePreviewLoading() || this.deleteSaving()) return;

    this.deletePreviewLoading.set(true);
    this.deleteError.set(null);
    this.deletePreview.set(null);
    this.admin.previewDeleteCategory(cat.slug).subscribe({
      next: (preview) => {
        this.deletePreviewLoading.set(false);
        this.deletePreview.set(preview);
        if (!preview.can_delete) {
          this.deleteError.set(this.t('adminUi.storefront.categories.deleteNotAllowed'));
        }
      },
      error: () => {
        this.deletePreviewLoading.set(false);
        this.deleteError.set(this.t('adminUi.storefront.categories.deletePreviewError'));
      }
    });
  }

  deleteCategorySelectedSafe(): void {
    const cat = this.categoryManagerSelectedCategory();
    if (!cat) return;
    if (this.deleteSaving()) return;

    const preview = this.deletePreview();
    if (!preview) {
      this.deleteError.set(this.t('adminUi.storefront.categories.deletePreviewRequired'));
      return;
    }
    if (!preview.can_delete) {
      this.deleteError.set(this.t('adminUi.storefront.categories.deleteNotAllowed'));
      return;
    }

    const confirmed = confirm(this.translate.instant('adminUi.storefront.categories.confirmDelete', { name: cat.name }));
    if (!confirmed) return;

    this.deleteSaving.set(true);
    this.admin.deleteCategory(cat.slug).subscribe({
      next: () => {
        this.deleteSaving.set(false);
        this.toast.success(this.t('adminUi.storefront.categories.deleteSuccess'));
        this.categoryManagerSlug = '';
        this.categoryManagerParentId = '';
        this.resetCategoryManagerActions();
        this.refreshCategoryLists();
      },
      error: () => {
        this.deleteSaving.set(false);
        this.deleteError.set(this.t('adminUi.storefront.categories.deleteError'));
      }
    });
  }

  private resetCategoryManagerActions(): void {
    this.mergeTargetSlug = '';
    this.mergePreview.set(null);
    this.mergePreviewLoading.set(false);
    this.mergeSaving.set(false);
    this.mergeError.set(null);
    this.deletePreview.set(null);
    this.deletePreviewLoading.set(false);
    this.deleteSaving.set(false);
    this.deleteError.set(null);
  }

  private refreshCategoryLists(): void {
    this.catalog.listCategories(undefined, { include_hidden: true }).subscribe({
      next: (cats) => this.categories.set(cats || []),
      error: () => this.categories.set([])
    });
    this.admin.getCategories().subscribe({
      next: (cats) => this.adminCategories.set((cats || []).map((c) => ({ id: c.id, name: c.name }))),
      error: () => this.adminCategories.set([])
    });
  }

  onCategoryImportFileChange(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.categoryImportFile = input?.files?.[0] ?? null;
    this.categoryImportError.set(null);
    this.categoryImportResult.set(null);
  }

  runCategoryImport(): void {
    const file = this.categoryImportFile;
    if (!file) return;
    if (this.categoryImportBusy()) return;

    this.categoryImportBusy.set(true);
    this.categoryImportError.set(null);
    this.categoryImportResult.set(null);

    this.admin.importCategoriesCsv(file, this.categoryImportDryRun).subscribe({
      next: (result) => {
        this.categoryImportBusy.set(false);
        this.categoryImportResult.set(result);
        if ((result.errors || []).length) {
          this.toast.error(this.t('adminUi.categories.csv.error'));
          return;
        }
        this.toast.success(this.t('adminUi.categories.csv.success'));
        if (!this.categoryImportDryRun) this.refreshCategoryLists();
      },
      error: (err) => {
        this.categoryImportBusy.set(false);
        this.categoryImportError.set(err?.error?.detail || this.t('adminUi.categories.csv.error'));
      }
    });
  }

  quickSetStatus(product: AdminProductListItem, nextStatus: ProductForm['status']): void {
    const productId = product.id;
    const prevStatus = product.status;
    if (prevStatus === nextStatus) return;
    if (this.quickStatusBusyId()) return;

    this.quickStatusBusyId.set(productId);
    this.admin.bulkUpdateProducts([{ product_id: productId, status: nextStatus }]).subscribe({
      next: () => {
        this.quickStatusBusyId.set(null);
        const displayName = product.name || product.slug;
        this.toast.action(
          this.translate.instant('adminUi.products.quickStatus.success', { name: displayName }),
          this.translate.instant('adminUi.actions.undo'),
          () => this.undoQuickStatusChange(productId, prevStatus),
          { tone: 'success', durationMs: 8000 }
        );
        if (this.selected.has(productId)) {
          const nextSelected = new Set(this.selected);
          nextSelected.delete(productId);
          this.selected = nextSelected;
          this.updateBulkPricePreview();
        }
        this.load();
      },
      error: () => {
        this.quickStatusBusyId.set(null);
        this.toast.error(this.translate.instant('adminUi.products.quickStatus.error'));
      }
    });
  }

  private undoQuickStatusChange(productId: string, status: string): void {
    this.admin.bulkUpdateProducts([{ product_id: productId, status }]).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('adminUi.products.quickStatus.undoSuccess'));
        this.load();
      },
      error: () => this.toast.error(this.translate.instant('adminUi.products.quickStatus.undoError'))
    });
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

  applyCategoryToSelected(): void {
    this.bulkError.set(null);
    const categoryId = (this.bulkCategoryId || '').trim();
    if (!categoryId) {
      this.bulkError.set(this.t('adminUi.products.bulk.category.valueRequired'));
      return;
    }
    const payload = Array.from(this.selected).map((id) => ({
      product_id: id,
      category_id: categoryId
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

  applyScheduleToSelected(): void {
    this.bulkError.set(null);
    const publishDate = this.bulkPublishScheduledFor ? new Date(this.bulkPublishScheduledFor) : null;
    const unpublishDate = this.bulkUnpublishScheduledFor ? new Date(this.bulkUnpublishScheduledFor) : null;

    if (
      (publishDate && Number.isNaN(publishDate.getTime())) ||
      (unpublishDate && Number.isNaN(unpublishDate.getTime()))
    ) {
      this.bulkError.set(this.t('adminUi.products.bulk.schedule.invalidDate'));
      return;
    }

    if (!publishDate && !unpublishDate) {
      this.bulkError.set(this.t('adminUi.products.bulk.schedule.valueRequired'));
      return;
    }

    if (publishDate && unpublishDate && unpublishDate.getTime() <= publishDate.getTime()) {
      this.bulkError.set(this.t('adminUi.products.bulk.schedule.orderInvalid'));
      return;
    }

    const publishIso = publishDate ? publishDate.toISOString() : null;
    const unpublishIso = unpublishDate ? unpublishDate.toISOString() : null;

    const payload = Array.from(this.selected).map((id) => ({
      product_id: id,
      ...(publishIso ? { publish_scheduled_for: publishIso } : {}),
      ...(unpublishIso ? { unpublish_scheduled_for: unpublishIso } : {})
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

  clearPublishScheduleForSelected(): void {
    this.bulkError.set(null);
    const payload = Array.from(this.selected).map((id) => ({
      product_id: id,
      publish_scheduled_for: null
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

  clearUnpublishScheduleForSelected(): void {
    this.bulkError.set(null);
    const payload = Array.from(this.selected).map((id) => ({
      product_id: id,
      unpublish_scheduled_for: null
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

  startInlineEdit(product: AdminProductListItem): void {
    if (this.inlineBusy()) return;
    this.inlineEditId = product.id;
    this.inlineError = '';
    this.inlineBasePriceError = '';
    this.inlineStockError = '';
    this.inlineSaleError = '';

    const basePrice = typeof product.base_price === 'number' ? product.base_price : Number(product.base_price || 0);
    this.inlineBasePrice = this.formatMoneyInput(Number.isFinite(basePrice) ? basePrice : 0);
    this.inlineStockQuantity = String(Number(product.stock_quantity || 0));

    const rawSaleType = (product.sale_type || '').toString();
    const saleType: 'percent' | 'amount' = rawSaleType === 'amount' ? 'amount' : 'percent';
    const saleValueNum = typeof product.sale_value === 'number' ? product.sale_value : Number(product.sale_value ?? 0);
    const saleEnabled = Boolean(rawSaleType && Number.isFinite(saleValueNum) && saleValueNum > 0);
    this.inlineSaleEnabled = saleEnabled;
    this.inlineSaleType = saleType;
    this.inlineSaleValue = saleEnabled
      ? saleType === 'amount'
        ? this.formatMoneyInput(Number.isFinite(saleValueNum) ? saleValueNum : 0)
        : String(Math.round(saleValueNum * 100) / 100)
      : '';
  }

  cancelInlineEdit(): void {
    this.inlineEditId = null;
    this.inlineBasePrice = '';
    this.inlineStockQuantity = '';
    this.inlineSaleEnabled = false;
    this.inlineSaleType = 'percent';
    this.inlineSaleValue = '';
    this.inlineBasePriceError = '';
    this.inlineStockError = '';
    this.inlineSaleError = '';
    this.inlineError = '';
  }

  onInlineBasePriceChange(next: string | number): void {
    const raw = String(next ?? '');
    const { clean, changed } = this.sanitizeMoneyInput(raw);
    this.inlineBasePrice = clean;
    this.inlineBasePriceError = changed ? this.t('adminUi.products.form.priceFormatHint') : '';
  }

  onInlineStockChange(next: string | number): void {
    const raw = String(next ?? '');
    this.inlineStockQuantity = raw;
    if (!raw.trim()) {
      this.inlineStockError = this.t('adminUi.products.inline.errors.stockRequired');
      return;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      this.inlineStockError = this.t('adminUi.products.inline.errors.stockInvalid');
      return;
    }
    this.inlineStockError = '';
  }

  onInlineSaleEnabledChange(): void {
    if (this.inlineSaleEnabled) return;
    this.inlineSaleValue = '';
    this.inlineSaleError = '';
  }

  onInlineSaleTypeChange(): void {
    this.inlineSaleValue = '';
    this.inlineSaleError = '';
  }

  onInlineSaleValueChange(next: string | number): void {
    const raw = String(next ?? '');
    const { clean, changed } = this.sanitizeMoneyInput(raw);
    this.inlineSaleValue = clean;
    if (!this.inlineSaleEnabled) {
      this.inlineSaleError = '';
      return;
    }
    if (this.inlineSaleType === 'percent' && clean) {
      const parsed = Number(clean);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        this.inlineSaleError = this.t('adminUi.products.sale.percentHint');
        return;
      }
    }
    this.inlineSaleError = changed ? this.t('adminUi.products.sale.valueHint') : '';
  }

  saveInlineEdit(): void {
    const productId = this.inlineEditId;
    if (!productId) return;
    this.inlineError = '';

    const basePrice = this.parseMoneyInput(this.inlineBasePrice);
    if (basePrice === null) {
      this.inlineError = this.t('adminUi.products.form.priceFormatHint');
      return;
    }

    const stockRaw = (this.inlineStockQuantity || '').trim();
    if (!stockRaw) {
      this.inlineStockError = this.t('adminUi.products.inline.errors.stockRequired');
      return;
    }
    const stockQuantity = Number(stockRaw);
    if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
      this.inlineStockError = this.t('adminUi.products.inline.errors.stockInvalid');
      return;
    }
    this.inlineStockError = '';

    let sale_type: 'percent' | 'amount' | null = null;
    let sale_value: number | null = null;
    if (this.inlineSaleEnabled) {
      sale_type = this.inlineSaleType;
      if (sale_type === 'amount') {
        const parsed = this.parseMoneyInput(this.inlineSaleValue);
        if (parsed === null) {
          this.inlineSaleError = this.t('adminUi.products.sale.valueHint');
          return;
        }
        sale_value = parsed;
      } else {
        const parsed = this.parseMoneyInput(this.inlineSaleValue);
        if (parsed === null || parsed < 0 || parsed > 100) {
          this.inlineSaleError = this.t('adminUi.products.sale.percentHint');
          return;
        }
        sale_value = parsed;
      }
    }

    this.inlineBusy.set(true);
    this.admin
      .bulkUpdateProducts([
        {
          product_id: productId,
          base_price: basePrice,
          stock_quantity: stockQuantity,
          sale_type,
          sale_value
        }
      ])
      .subscribe({
        next: () => {
          this.inlineBusy.set(false);
          this.toast.success(this.t('adminUi.products.inline.success'));
          this.cancelInlineEdit();
          this.load();
        },
        error: () => {
          this.inlineBusy.set(false);
          this.inlineError = this.t('adminUi.products.inline.errors.save');
        }
      });
  }

  onBulkPriceValueChange(next: string | number): void {
    const raw = String(next ?? '');
    const { clean } = this.sanitizeMoneyInput(raw);
    this.bulkPriceValue = clean;
    this.updateBulkPricePreview();
  }

  applyPriceAdjustmentToSelected(): void {
    this.bulkError.set(null);
    const selectedItems = this.products().filter((p) => this.selected.has(p.id));
    if (!selectedItems.length) return;

    const delta = this.parseMoneyInput(this.bulkPriceValue);
    if (delta === null || delta <= 0) {
      this.bulkError.set(this.t('adminUi.products.bulk.priceAdjust.valueRequired'));
      return;
    }

    const direction = this.bulkPriceDirection === 'decrease' ? -1 : 1;
    const payload: Array<{ product_id: string; base_price: number }> = [];
    for (const product of selectedItems) {
      const base = typeof product.base_price === 'number' ? product.base_price : Number(product.base_price || 0);
      let nextPrice = base;
      if (this.bulkPriceMode === 'percent') {
        nextPrice = base + (base * delta * direction) / 100;
      } else {
        nextPrice = base + delta * direction;
      }
      nextPrice = Math.round(nextPrice * 100) / 100;
      if (!Number.isFinite(nextPrice) || nextPrice < 0) {
        this.bulkError.set(this.t('adminUi.products.bulk.priceAdjust.negative'));
        return;
      }
      payload.push({ product_id: product.id, base_price: nextPrice });
    }

    this.bulkBusy.set(true);
    this.admin.bulkUpdateProducts(payload).subscribe({
      next: () => {
        this.bulkBusy.set(false);
        this.toast.success(this.t('adminUi.products.bulk.priceAdjust.success'));
        this.clearSelection();
        this.load();
      },
      error: () => {
        this.bulkBusy.set(false);
        this.bulkError.set(this.t('adminUi.products.bulk.error'));
      }
    });
  }

  updateBulkPricePreview(): void {
    this.bulkPricePreview = null;
    const selectedItems = this.products().filter((p) => this.selected.has(p.id));
    if (!selectedItems.length) return;
    const delta = this.parseMoneyInput(this.bulkPriceValue);
    if (delta === null || delta <= 0) return;

    const direction = this.bulkPriceDirection === 'decrease' ? -1 : 1;
    const currency = selectedItems[0]?.currency || 'RON';

    const oldPrices = selectedItems
      .map((p) => (typeof p.base_price === 'number' ? p.base_price : Number(p.base_price || 0)))
      .filter((n) => Number.isFinite(n));
    if (!oldPrices.length) return;

    const newPrices: number[] = [];
    for (const base of oldPrices) {
      let nextPrice = base;
      if (this.bulkPriceMode === 'percent') {
        nextPrice = base + (base * delta * direction) / 100;
      } else {
        nextPrice = base + delta * direction;
      }
      nextPrice = Math.round(nextPrice * 100) / 100;
      newPrices.push(nextPrice);
    }

    const minOld = Math.min(...oldPrices);
    const maxOld = Math.max(...oldPrices);
    const minNew = Math.min(...newPrices);
    const maxNew = Math.max(...newPrices);

    this.bulkPricePreview = {
      old_min: this.formatMoneyInput(minOld),
      old_max: this.formatMoneyInput(maxOld),
      new_min: this.formatMoneyInput(minNew),
      new_max: this.formatMoneyInput(maxNew),
      currency
    };
  }

  exportProductsCsv(): void {
    this.admin.exportProductsCsv().subscribe({
      next: (blob) => this.downloadBlob(blob, 'products.csv'),
      error: () => this.toast.error(this.t('adminUi.products.csv.errors.export'))
    });
  }

  downloadCategoriesCsv(template: boolean): void {
    this.admin.exportCategoriesCsv(template).subscribe({
      next: (blob) => this.downloadBlob(blob, template ? 'categories-template.csv' : 'categories.csv'),
      error: () => this.toast.error(this.t('adminUi.categories.csv.exportError'))
    });
  }

  openCsvImport(): void {
    this.csvImportOpen.set(true);
    this.csvImportFile.set(null);
    this.csvImportResult.set(null);
    this.csvImportError.set(null);
    this.csvImportBusy.set(false);
  }

  closeCsvImport(): void {
    this.csvImportOpen.set(false);
  }

  onCsvImportFileChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const file = target?.files && target.files.length > 0 ? target.files[0] : null;
    this.csvImportFile.set(file);
    this.csvImportResult.set(null);
    this.csvImportError.set(null);
  }

  csvImportCanApply(): boolean {
    const file = this.csvImportFile();
    const result = this.csvImportResult();
    return Boolean(file && result && (result.errors || []).length === 0);
  }

  runCsvImport(dryRun: boolean): void {
    const file = this.csvImportFile();
    if (!file) {
      this.csvImportError.set(this.t('adminUi.products.csv.errors.noFile'));
      return;
    }
    this.csvImportBusy.set(true);
    this.csvImportError.set(null);
    this.csvImportResult.set(null);
    this.admin.importProductsCsv(file, dryRun).subscribe({
      next: (res) => {
        this.csvImportResult.set(res);
        this.csvImportBusy.set(false);
        if (!dryRun && (!res?.errors || res.errors.length === 0)) {
          this.toast.success(this.t('adminUi.products.csv.success.imported'));
          this.load();
        }
      },
      error: () => {
        this.csvImportBusy.set(false);
        this.csvImportError.set(this.t('adminUi.products.csv.errors.import'));
      }
    });
  }

  toggleDescriptionPreview(): void {
    const next = !this.descriptionPreviewOpen();
    this.descriptionPreviewOpen.set(next);
    if (next) this.refreshDescriptionPreview();
  }

  onDescriptionChange(): void {
    if (!this.descriptionPreviewOpen()) return;
    this.refreshDescriptionPreview();
  }

  toggleTranslationPreview(lang: 'en' | 'ro'): void {
    this.translationPreviewOpen[lang] = !this.translationPreviewOpen[lang];
    if (this.translationPreviewOpen[lang]) {
      this.refreshTranslationPreview(lang);
    }
  }

  onTranslationDescriptionChange(lang: 'en' | 'ro'): void {
    if (!this.translationPreviewOpen[lang]) return;
    this.refreshTranslationPreview(lang);
  }

  private refreshDescriptionPreview(): void {
    const { html, sanitized } = this.markdown.renderWithSanitizationReport(this.form.long_description || '');
    this.descriptionPreviewHtml.set(html);
    this.descriptionPreviewSanitized.set(sanitized);
  }

  private refreshTranslationPreview(lang: 'en' | 'ro'): void {
    const text = (this.translations?.[lang]?.long_description || '').toString();
    const { html, sanitized } = this.markdown.renderWithSanitizationReport(text);
    this.translationPreviewHtml[lang] = html;
    this.translationPreviewSanitized[lang] = sanitized;
  }

  startCreateWizard(): void {
    this.startNew();
    this.wizardKind.set('create');
    this.wizardStep.set(0);
    this.scrollToWizardAnchor(PRODUCT_CREATE_WIZARD_STEPS[0].anchorId);
  }

  startPublishWizard(): void {
    if (!this.editorOpen() || !this.editingSlug()) return;
    this.wizardKind.set('publish');
    this.wizardStep.set(0);
    this.scrollToWizardAnchor(PRODUCT_PUBLISH_WIZARD_STEPS[0].anchorId);
  }

  exitWizard(): void {
    this.wizardKind.set(null);
    this.wizardStep.set(0);
    this.wizardAdvanceAfterSave = false;
    this.wizardExitAfterPublish = false;
  }

  wizardSteps(): ProductWizardStep[] {
    const kind = this.wizardKind();
    if (kind === 'publish') return PRODUCT_PUBLISH_WIZARD_STEPS;
    if (kind === 'create') return PRODUCT_CREATE_WIZARD_STEPS;
    return [];
  }

  wizardCurrentStepId(): ProductWizardStepId | null {
    return this.wizardCurrent()?.id ?? null;
  }

  wizardTitleKey(): string {
    return this.wizardKind() === 'publish' ? 'adminUi.products.wizard.publishTitle' : 'adminUi.products.wizard.createTitle';
  }

  wizardStepDescriptionKey(): string {
    return this.wizardCurrent()?.descriptionKey ?? 'adminUi.products.wizard.desc.basics';
  }

  wizardNextLabelKey(): string {
    const steps = this.wizardSteps();
    if (!steps.length) return 'adminUi.actions.next';
    return this.wizardStep() >= steps.length - 1 ? 'adminUi.actions.done' : 'adminUi.actions.next';
  }

  wizardCanNext(): boolean {
    const steps = this.wizardSteps();
    if (!steps.length) return false;
    if (this.wizardStep() >= steps.length - 1) return true;
    const current = this.wizardCurrent();
    if (current?.id === 'save') return Boolean(this.editingSlug());
    return true;
  }

  wizardPrev(): void {
    const next = this.wizardStep() - 1;
    if (next < 0) return;
    this.wizardStep.set(next);
    this.scrollToWizardAnchor(this.wizardCurrent()?.anchorId || 'product-wizard-top');
  }

  wizardNext(): void {
    const steps = this.wizardSteps();
    if (!steps.length) return;
    if (this.wizardStep() >= steps.length - 1) {
      this.exitWizard();
      return;
    }
    if (!this.wizardCanNext()) {
      this.toast.error(this.t('adminUi.products.errors.saveFirst'));
      this.scrollToWizardAnchor('product-wizard-save');
      return;
    }
    this.wizardStep.set(this.wizardStep() + 1);
    this.scrollToWizardAnchor(this.wizardCurrent()?.anchorId || 'product-wizard-top');
  }

  goToWizardStep(index: number): void {
    const steps = this.wizardSteps();
    if (!steps.length) return;
    if (index < 0 || index >= steps.length) return;
    if (this.wizardKind() === 'create' && index > 2 && !this.editingSlug()) {
      this.toast.error(this.t('adminUi.products.errors.saveFirst'));
      this.wizardStep.set(2);
      this.scrollToWizardAnchor('product-wizard-save');
      return;
    }
    this.wizardStep.set(index);
    this.scrollToWizardAnchor(steps[index].anchorId);
  }

  wizardSave(): void {
    this.wizardAdvanceAfterSave = true;
    this.save();
  }

  wizardPublishNow(): void {
    this.form.status = 'published';
    this.form.is_active = true;
    this.wizardExitAfterPublish = true;
    this.save();
  }

  wizardForcesAdvancedOpen(): boolean {
    if (!this.wizardKind()) return false;
    return this.wizardCurrentStepId() === 'publish';
  }

  private wizardCurrent(): ProductWizardStep | null {
    const steps = this.wizardSteps();
    const idx = this.wizardStep();
    return steps[idx] ?? null;
  }

  private scrollToWizardAnchor(anchorId: string): void {
    window.setTimeout(() => {
      const el = document.getElementById(anchorId);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  markEditorDirty(): void {
    if (!this.editorOpen()) return;
    if (this.editorSaving()) return;
    if (this.editorDirty()) return;
    this.editorDirty.set(true);
    this.editorMessage.set(null);
  }

  markEditorDirtyFromEvent(event: Event): void {
    const target = event?.target as HTMLElement | null;
    if (target && typeof (target as any).closest === 'function' && target.closest('[data-ignore-dirty]')) return;
    this.markEditorDirty();
  }

		  startNew(): void {
        this.exitWizard();
		    this.editorOpen.set(true);
		    this.editingSlug.set(null);
		    this.editingProductId.set(null);
		    this.editingCurrency.set('RON');
		    this.editorError.set(null);
		    this.editorMessage.set(null);
        this.editorDirty.set(false);
        this.editorSaving.set(false);
        this.editorLastSavedAt.set(null);
        this.lastSavedState.set(null);
        this.loadedTagSlugs = [];
		    this.resetDuplicateCheck();
		    this.resetRelationships();
		    this.resetAudit();
        this.resetMarkdownPreview();
		    this.images.set([]);
	    this.resetDeletedImages();
		    this.resetImageMeta();
		    this.form = this.blankForm();
        this.lastSavedState.set({ status: this.form.status, isActive: this.form.is_active });
		    this.basePriceError = '';
		    this.saleValueError = '';
	    this.resetTranslations();
    this.resetVariants();
    this.resetStockLedger();
    const first = this.adminCategories()[0];
    if (first) this.form.category_id = first.id;
  }

		  closeEditor(): void {
        if (this.editorSaving()) return;
        if (this.editorDirty() && !window.confirm(this.t('account.unsaved.confirmDiscard'))) return;
        this.exitWizard();
		    this.editorOpen.set(false);
		    this.editingSlug.set(null);
		    this.editingProductId.set(null);
		    this.editingCurrency.set('RON');
		    this.editorError.set(null);
		    this.editorMessage.set(null);
        this.editorDirty.set(false);
        this.editorSaving.set(false);
        this.editorLastSavedAt.set(null);
        this.lastSavedState.set(null);
        this.loadedTagSlugs = [];
		    this.resetDuplicateCheck();
		    this.resetRelationships();
		    this.resetAudit();
        this.resetMarkdownPreview();
		    this.images.set([]);
	    this.resetDeletedImages();
		    this.resetImageMeta();
		    this.basePriceError = '';
		    this.saleValueError = '';
	    this.resetTranslations();
    this.resetVariants();
    this.resetStockLedger();
  }

		  edit(slug: string): void {
        this.exitWizard();
		    this.editorOpen.set(true);
		    this.editorError.set(null);
		    this.editorMessage.set(null);
        this.editorDirty.set(false);
        this.editorSaving.set(false);
        this.editorLastSavedAt.set(null);
        this.lastSavedState.set(null);
		    this.editingSlug.set(slug);
		    this.editingProductId.set(null);
		    this.editingCurrency.set('RON');
		    this.resetDuplicateCheck();
		    this.resetRelationships();
		    this.resetAudit();
        this.resetMarkdownPreview();
		    this.basePriceError = '';
		    this.saleValueError = '';
		    this.resetTranslations();
		    this.resetDeletedImages();
		    this.resetImageMeta();
		    this.resetVariants();
	    this.resetStockLedger();
    this.admin.getProduct(slug).subscribe({
      next: (prod: any) => {
        const name = (prod?.name || '').toString().trim();
        this.recent.add({
          key: `product:${slug}`,
          type: 'product',
          label: name || slug,
          subtitle: slug,
          url: '/admin/products',
          state: { editProductSlug: slug }
        });
        this.editingProductId.set(prod?.id ? String(prod.id) : null);
        this.editingCurrency.set((prod?.currency || 'RON').toString() || 'RON');
        const basePrice = typeof prod.base_price === 'number' ? prod.base_price : Number(prod.base_price || 0);
        const weightGramsRaw = typeof prod.weight_grams === 'number' ? prod.weight_grams : Number(prod.weight_grams ?? NaN);
        const widthRaw = typeof prod.width_cm === 'number' ? prod.width_cm : Number(prod.width_cm ?? NaN);
        const heightRaw = typeof prod.height_cm === 'number' ? prod.height_cm : Number(prod.height_cm ?? NaN);
        const depthRaw = typeof prod.depth_cm === 'number' ? prod.depth_cm : Number(prod.depth_cm ?? NaN);
        const shippingClassRaw = (prod.shipping_class || '').toString();
        const shippingClass: 'standard' | 'bulky' | 'oversize' =
          shippingClassRaw === 'bulky' || shippingClassRaw === 'oversize' ? shippingClassRaw : 'standard';
        const disallowedCouriers = Array.isArray(prod.shipping_disallowed_couriers)
          ? prod.shipping_disallowed_couriers.map((c: any) => (c ?? '').toString().trim().toLowerCase()).filter(Boolean)
          : [];
        const disallowedSet = new Set(disallowedCouriers);
        const rawSaleType = (prod.sale_type || '').toString();
        const saleType: 'percent' | 'amount' = rawSaleType === 'amount' ? 'amount' : 'percent';
        const saleValueNum =
          typeof prod.sale_value === 'number' ? prod.sale_value : Number(prod.sale_value ?? 0);
        const saleEnabled =
          (typeof prod.sale_price === 'number' && Number.isFinite(prod.sale_price)) ||
          (rawSaleType && Number.isFinite(saleValueNum) && saleValueNum > 0);
        const tagSlugs = this.parseTagSlugs(prod.tags);
        this.loadedTagSlugs = tagSlugs;
        const badgesState: Record<ProductBadgeKey, BadgeForm> = {
          new: { enabled: false, start_at: '', end_at: '' },
          limited: { enabled: false, start_at: '', end_at: '' },
          handmade: { enabled: false, start_at: '', end_at: '' }
        };
        const rawBadges = Array.isArray(prod.badges) ? prod.badges : [];
        for (const raw of rawBadges) {
          const badgeKey = String(raw?.badge ?? '').trim();
          if (badgeKey !== 'new' && badgeKey !== 'limited' && badgeKey !== 'handmade') continue;
          const key = badgeKey as ProductBadgeKey;
          badgesState[key].enabled = true;
          badgesState[key].start_at = raw?.start_at ? this.toLocalDateTime(raw.start_at) : '';
          badgesState[key].end_at = raw?.end_at ? this.toLocalDateTime(raw.end_at) : '';
        }
        this.form = {
          name: prod.name || '',
          category_id: prod.category_id || '',
          base_price: this.formatMoneyInput(Number.isFinite(basePrice) ? basePrice : 0),
          weight_grams: Number.isFinite(weightGramsRaw) && weightGramsRaw >= 0 ? String(Math.round(weightGramsRaw)) : '',
          width_cm: Number.isFinite(widthRaw) && widthRaw >= 0 ? String(widthRaw) : '',
          height_cm: Number.isFinite(heightRaw) && heightRaw >= 0 ? String(heightRaw) : '',
          depth_cm: Number.isFinite(depthRaw) && depthRaw >= 0 ? String(depthRaw) : '',
          shipping_class: shippingClass,
          shipping_allow_locker: prod.shipping_allow_locker !== false,
          shipping_disallowed_couriers: {
            sameday: disallowedSet.has('sameday'),
            fan_courier: disallowedSet.has('fan_courier')
          },
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
          low_stock_threshold:
            prod.low_stock_threshold === null || prod.low_stock_threshold === undefined ? '' : String(prod.low_stock_threshold),
          status: (prod.status as any) || 'draft',
          is_active: prod.is_active !== false,
          is_featured: !!prod.is_featured,
          sku: (prod.sku || '').toString(),
          short_description: (prod.short_description || '').toString(),
          long_description: (prod.long_description || '').toString(),
          publish_at: prod.publish_at ? this.toLocalDateTime(prod.publish_at) : '',
          is_bestseller: tagSlugs.includes('bestseller'),
          badges: badgesState
        };
        this.lastSavedState.set({ status: this.form.status, isActive: this.form.is_active });
        const nextImages = Array.isArray(prod.images) ? [...prod.images] : [];
        nextImages.sort((a: any, b: any) => Number(a?.sort_order ?? 0) - Number(b?.sort_order ?? 0));
        this.images.set(nextImages);
        this.setVariantsFromProduct(prod);
        const productId = this.editingProductId();
        if (productId) this.loadStockAdjustments(productId);
        this.loadTranslations((prod.slug || slug).toString());
		        this.loadRelationships((prod.slug || slug).toString());
		        this.loadAudit((prod.slug || slug).toString());
		        this.scheduleDuplicateCheck();
		      },
	      error: () => this.editorError.set(this.t('adminUi.products.errors.load'))
		    });
		  }

	  restoreProduct(product: AdminProductListItem): void {
	    const id = (product?.id || '').toString();
	    if (!id) return;
	    this.restoringProductId.set(id);
	    this.productsApi.restore(id).subscribe({
	      next: () => {
	        this.toast.success(this.t('adminUi.products.trash.success.restore'));
	        this.restoringProductId.set(null);
	        this.clearSelection();
	        this.load();
	      },
	      error: () => {
	        this.restoringProductId.set(null);
	        this.toast.error(this.t('adminUi.products.trash.errors.restore'));
	      }
	    });
	  }

	  refreshAudit(): void {
	    const slug = this.editingSlug();
	    if (!slug) return;
	    this.loadAudit(slug);
	  }

	  onNameChange(next: string | number): void {
	    this.form.name = String(next ?? '');
	    this.scheduleDuplicateCheck();
	  }

  onSkuChange(next: string | number): void {
    this.form.sku = String(next ?? '');
    this.scheduleDuplicateCheck();
  }

  predictedSlug(): string | null {
    const existing = this.editingSlug();
    if (existing) return existing;
    const suggested = this.duplicateCheck()?.suggested_slug;
    return suggested && suggested.trim() ? suggested : null;
  }

  duplicateHasWarnings(): boolean {
    const dup = this.duplicateCheck();
    if (!dup) return false;
    const slugTaken = Boolean(dup.slug_base && dup.suggested_slug && dup.slug_base !== dup.suggested_slug);
    return slugTaken || (dup.sku_matches?.length ?? 0) > 0 || (dup.name_matches?.length ?? 0) > 0;
  }

  private resetDuplicateCheck(): void {
    this.duplicateCheckSeq += 1;
    this.duplicateBusy.set(false);
    this.duplicateCheck.set(null);
    if (this.duplicateCheckTimeoutId) {
      clearTimeout(this.duplicateCheckTimeoutId);
      this.duplicateCheckTimeoutId = null;
    }
  }

  private scheduleDuplicateCheck(): void {
    if (!this.editorOpen()) return;
    if (this.duplicateCheckTimeoutId) {
      clearTimeout(this.duplicateCheckTimeoutId);
      this.duplicateCheckTimeoutId = null;
    }

    const name = (this.form.name || '').trim();
    const sku = (this.form.sku || '').trim();
    if (!name && !sku) {
      this.duplicateCheck.set(null);
      return;
    }

    this.duplicateCheckTimeoutId = setTimeout(() => this.runDuplicateCheck(), 450);
  }

  private runDuplicateCheck(): void {
    const name = (this.form.name || '').trim();
    const sku = (this.form.sku || '').trim();
    if (!name && !sku) {
      this.duplicateCheck.set(null);
      return;
    }

    const seq = (this.duplicateCheckSeq += 1);
    this.duplicateBusy.set(true);
    this.productsApi
      .duplicateCheck({
        name: name || undefined,
        sku: sku || undefined,
        exclude_slug: this.editingSlug() || undefined,
      })
      .subscribe({
        next: (res) => {
          if (seq !== this.duplicateCheckSeq) return;
          this.duplicateCheck.set(res);
        },
        error: () => {
          if (seq !== this.duplicateCheckSeq) return;
          this.duplicateCheck.set(null);
        },
      })
      .add(() => {
        if (seq !== this.duplicateCheckSeq) return;
        this.duplicateBusy.set(false);
      });
  }

  seoPreviewImageUrl(): string | null {
    const first = this.images()?.[0]?.url;
    return typeof first === 'string' && first.trim() ? first : null;
  }

  seoPreviewName(lang: 'en' | 'ro'): string {
    const translated = (this.translations?.[lang]?.name || '').trim();
    if (translated) return translated;
    const base = (this.form?.name || '').trim();
    return base || '—';
  }

  seoPreviewTitle(lang: 'en' | 'ro'): string {
    const name = this.seoPreviewName(lang);
    if (name === '—') return name;
    return `${name} | momentstudio`;
  }

  seoPreviewUrl(): string {
    const slug = this.predictedSlug();
    return `/products/${slug || '<slug>'}`;
  }

  seoPreviewDescription(lang: 'en' | 'ro'): string {
    const translatedShort = (this.translations?.[lang]?.short_description || '').trim();
    const translatedLong = (this.translations?.[lang]?.long_description || '').trim();
    const baseShort = (this.form?.short_description || '').trim();
    const baseLong = (this.form?.long_description || '').trim();

    const raw = translatedShort || baseShort || translatedLong || baseLong;
    const normalized = raw.replace(/\s+/g, ' ').trim();
    if (!normalized) return '—';
    if (normalized.length <= 160) return normalized;
    return `${normalized.slice(0, 157)}…`;
  }

  previewBasePrice(): number {
    const parsed = this.parseMoneyInput(this.form?.base_price || '');
    return parsed === null ? 0 : parsed;
  }

  previewSalePrice(): number | null {
    if (!this.form?.sale_enabled) return null;
    const base = this.previewBasePrice();
    if (!(base > 0)) return null;
    const value = this.parseMoneyInput(this.form.sale_value || '');
    if (value === null || value <= 0) return null;

    if (this.form.sale_type === 'amount') {
      const discounted = Math.max(0, Math.round((base - value) * 100) / 100);
      return discounted < base ? discounted : null;
    }

    if (value > 100) return null;
    const discounted = Math.max(0, Math.round((base * (1 - value / 100)) * 100) / 100);
    return discounted < base ? discounted : null;
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

  private shouldConfirmStatusChange(): boolean {
    const prev = this.lastSavedState();
    if (!prev) return false;
    return prev.status !== this.form.status;
  }

  private openStatusConfirm(): void {
    const prev = this.lastSavedState();
    if (!prev) return;
    this.statusConfirmPrev.set(prev);
    this.statusConfirmTarget.set({ status: this.form.status, isActive: this.form.is_active });
    this.statusConfirmBusy.set(false);
    this.statusConfirmOpen.set(true);
  }

  closeStatusConfirm(): void {
    this.statusConfirmOpen.set(false);
    this.statusConfirmBusy.set(false);
    this.statusConfirmPrev.set(null);
    this.statusConfirmTarget.set(null);
  }

  confirmStatusChange(): void {
    const target = this.statusConfirmTarget();
    if (!target) return;
    if (this.statusConfirmBusy()) return;
    this.form.status = target.status;
    this.form.is_active = target.isActive;
    this.statusConfirmBusy.set(true);
    this.save({
      skipStatusConfirm: true,
      done: () => {
        this.statusConfirmBusy.set(false);
        this.closeStatusConfirm();
      }
    });
  }

  save(opts?: { skipStatusConfirm?: boolean; done?: (ok: boolean) => void }): void {
    if (!opts?.skipStatusConfirm && this.shouldConfirmStatusChange()) {
      this.openStatusConfirm();
      opts?.done?.(false);
      return;
    }
    if (this.editorSaving()) {
      opts?.done?.(false);
      return;
    }

    const basePrice = this.parseMoneyInput(this.form.base_price);
    if (basePrice === null) {
      this.editorError.set(this.t('adminUi.products.form.priceFormatHint'));
      opts?.done?.(false);
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
          opts?.done?.(false);
          return;
        }
        sale_value = amount;
      } else {
        const percent = this.parseMoneyInput(this.form.sale_value);
        if (percent === null || percent < 0 || percent > 100) {
          this.editorError.set(this.t('adminUi.products.sale.percentHint'));
          opts?.done?.(false);
          return;
        }
        sale_value = percent;
      }
    }

    if (this.form.sale_enabled && this.form.sale_auto_publish && !this.form.sale_start_at) {
      this.editorError.set(this.t('adminUi.products.sale.startRequired'));
      opts?.done?.(false);
      return;
    }

    const lowStockRaw = (this.form.low_stock_threshold || '').trim();
    let low_stock_threshold: number | null = null;
    if (lowStockRaw) {
      const parsed = Number(lowStockRaw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        this.editorError.set(this.t('adminUi.lowStock.thresholdError'));
        opts?.done?.(false);
        return;
      }
      low_stock_threshold = parsed;
    }

    const weightRaw = (this.form.weight_grams || '').trim();
    let weight_grams: number | null = null;
    if (weightRaw) {
      const parsed = Number(weightRaw);
      if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        this.editorError.set(this.t('adminUi.products.shipping.weightHint'));
        opts?.done?.(false);
        return;
      }
      weight_grams = parsed;
    }

    const parseDim = (raw: string): number | null => {
      const trimmed = (raw || '').trim();
      if (!trimmed) return null;
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0) return NaN;
      return Math.round(parsed * 100) / 100;
    };

    const width_cm = parseDim(this.form.width_cm);
    const height_cm = parseDim(this.form.height_cm);
    const depth_cm = parseDim(this.form.depth_cm);
    if ([width_cm, height_cm, depth_cm].some((val) => typeof val === 'number' && Number.isNaN(val))) {
      this.editorError.set(this.t('adminUi.products.shipping.dimensionsHint'));
      opts?.done?.(false);
      return;
    }

    const shipping_disallowed_couriers: string[] = [];
    if (this.form.shipping_disallowed_couriers?.sameday) shipping_disallowed_couriers.push('sameday');
    if (this.form.shipping_disallowed_couriers?.fan_courier) shipping_disallowed_couriers.push('fan_courier');

    const badges: Array<{ badge: ProductBadgeKey; start_at: string | null; end_at: string | null }> = [];
    for (const badge of ['new', 'limited', 'handmade'] as const) {
      const state = this.form.badges?.[badge];
      if (!state?.enabled) continue;
      const startDate = state.start_at ? new Date(state.start_at) : null;
      const endDate = state.end_at ? new Date(state.end_at) : null;
      if (startDate && Number.isNaN(startDate.getTime())) {
        this.editorError.set(this.t('adminUi.products.badges.errors.invalidDate'));
        opts?.done?.(false);
        return;
      }
      if (endDate && Number.isNaN(endDate.getTime())) {
        this.editorError.set(this.t('adminUi.products.badges.errors.invalidDate'));
        opts?.done?.(false);
        return;
      }
      if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
        this.editorError.set(this.t('adminUi.products.badges.errors.endBeforeStart'));
        opts?.done?.(false);
        return;
      }
      badges.push({
        badge,
        start_at: startDate ? startDate.toISOString() : null,
        end_at: endDate ? endDate.toISOString() : null
      });
    }

    const payload: any = {
      name: this.form.name,
      category_id: this.form.category_id,
      base_price: basePrice,
      weight_grams,
      width_cm,
      height_cm,
      depth_cm,
      shipping_class: this.form.shipping_class,
      shipping_allow_locker: this.form.shipping_allow_locker,
      shipping_disallowed_couriers,
      sale_type,
      sale_value,
      sale_start_at: this.form.sale_enabled && this.form.sale_start_at ? new Date(this.form.sale_start_at).toISOString() : null,
      sale_end_at: this.form.sale_enabled && this.form.sale_end_at ? new Date(this.form.sale_end_at).toISOString() : null,
      sale_auto_publish: this.form.sale_enabled ? this.form.sale_auto_publish : false,
      stock_quantity: Number(this.form.stock_quantity),
      low_stock_threshold,
      status: this.form.status,
      is_active: this.form.is_active,
      is_featured: this.form.is_featured,
      sku: this.form.sku || null,
      long_description: this.form.long_description || null,
      short_description: this.buildShortDescription(),
      publish_at: this.form.publish_at ? new Date(this.form.publish_at).toISOString() : null,
      tags: this.buildTags(),
      badges
    };

    const slug = this.editingSlug();
    const op = slug ? this.admin.updateProduct(slug, payload) : this.admin.createProduct(payload);
    this.editorSaving.set(true);
    op.subscribe({
      next: (prod: any) => {
        this.editorSaving.set(false);
        this.editorDirty.set(false);
        this.editorLastSavedAt.set(new Date().toISOString());
        this.toast.success(this.t('adminUi.products.success.save'));
        this.editorMessage.set(this.t('adminUi.products.success.save'));
        const newSlug = (prod?.slug as string | undefined) || slug || null;
        this.editingSlug.set(newSlug);
        this.loadedTagSlugs = this.parseTagSlugs(prod?.tags);
        if (!this.editingProductId() && prod?.id) {
          this.editingProductId.set(String(prod.id));
          this.loadStockAdjustments(String(prod.id));
        }
        if (Array.isArray(prod?.images)) {
          const nextImages = [...prod.images];
          nextImages.sort((a: any, b: any) => Number(a?.sort_order ?? 0) - Number(b?.sort_order ?? 0));
          this.images.set(nextImages);
        }
	        if (prod?.status) this.form.status = prod.status;
          if (typeof prod?.is_active === 'boolean') this.form.is_active = prod.is_active;
          this.lastSavedState.set({ status: this.form.status, isActive: this.form.is_active });
	        if (newSlug) this.loadTranslations(newSlug);
	        if (newSlug) this.loadRelationships(newSlug);
          if (newSlug) this.loadAudit(newSlug);
	        this.load();
          opts?.done?.(true);
          if (this.wizardExitAfterPublish) {
            this.wizardExitAfterPublish = false;
            this.wizardAdvanceAfterSave = false;
            this.exitWizard();
          } else if (this.wizardAdvanceAfterSave && this.wizardCurrentStepId() === 'save') {
            this.wizardAdvanceAfterSave = false;
            this.wizardNext();
          } else {
            this.wizardAdvanceAfterSave = false;
          }
	      },
	      error: () => {
          this.editorSaving.set(false);
          this.editorError.set(this.t('adminUi.products.errors.save'));
          opts?.done?.(false);
        }
	    });
	  }

  variantsWithIds(): VariantRow[] {
    return this.variants().filter((v) => Boolean(v.id));
  }

  addVariantRow(): void {
    this.variantsError.set(null);
    this.variants.set([
      ...this.variants(),
      {
        name: '',
        additional_price_delta: '0.00',
        stock_quantity: 0,
      },
    ]);
  }

  removeVariantRow(variant: VariantRow): void {
    if (variant.id) {
      this.pendingVariantDeletes.add(variant.id);
    }
    this.variants.set(this.variants().filter((v) => v !== variant));
  }

  onVariantNameChange(index: number, next: string): void {
    this.updateVariant(index, { name: String(next ?? '') });
  }

  onVariantDeltaChange(index: number, next: string | number): void {
    this.updateVariant(index, { additional_price_delta: String(next ?? '') });
  }

  onVariantStockChange(index: number, next: string | number): void {
    const raw = String(next ?? '').trim();
    const parsed = Number(raw);
    const stock = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
    this.updateVariant(index, { stock_quantity: stock });
  }

  variantComputedPrice(deltaRaw: string): number {
    const baseParsed = this.parseMoneyInput(this.form.base_price);
    const base = baseParsed ?? 0;
    const deltaParsed = this.parseSignedMoneyInput(deltaRaw);
    const delta = deltaParsed ?? 0;
    return Math.round((base + delta) * 100) / 100;
  }

  saveVariants(): void {
    const slug = this.editingSlug();
    if (!slug) return;
    this.variantsError.set(null);

    const payloadVariants: Array<{
      id?: string | null;
      name: string;
      additional_price_delta: number;
      stock_quantity: number;
    }> = [];

    for (const row of this.variants()) {
      const name = (row.name || '').trim();
      if (!name) {
        this.variantsError.set(this.t('adminUi.products.form.variantNameRequired'));
        return;
      }
      const delta = this.parseSignedMoneyInput(row.additional_price_delta);
      if (delta === null) {
        this.variantsError.set(this.t('adminUi.products.form.priceFormatHint'));
        return;
      }
      const stock = Number(row.stock_quantity);
      if (!Number.isInteger(stock) || stock < 0) {
        this.variantsError.set(this.t('adminUi.products.inline.errors.stockInvalid'));
        return;
      }
      payloadVariants.push({
        id: row.id ?? null,
        name,
        additional_price_delta: delta,
        stock_quantity: stock,
      });
    }

    this.variantsBusy.set(true);
    this.admin
      .updateProductVariants(slug, { variants: payloadVariants, delete_variant_ids: Array.from(this.pendingVariantDeletes) })
      .subscribe({
        next: (updated) => {
          this.variantsBusy.set(false);
          this.pendingVariantDeletes = new Set<string>();
          this.variants.set(
            (updated || []).map((variant) => ({
              id: String(variant.id),
              name: String(variant.name || ''),
              additional_price_delta: this.formatMoneyInput(Number(variant.additional_price_delta ?? 0)),
              stock_quantity: Number(variant.stock_quantity ?? 0),
            }))
          );
          this.toast.success(this.t('adminUi.products.form.variantsSaved'));
          const productId = this.editingProductId();
          if (productId) this.loadStockAdjustments(productId);
        },
        error: (err) => {
          this.variantsBusy.set(false);
          const detail = err?.error?.detail;
          this.variantsError.set(typeof detail === 'string' && detail.trim() ? detail.trim() : this.t('adminUi.products.form.variantsSaveError'));
        },
      });
  }

  formatTimestamp(raw: string): string {
    const dt = new Date(raw);
    if (!raw || Number.isNaN(dt.getTime())) return raw || '';
    try {
      return dt.toLocaleString(this.translate.currentLang || undefined);
    } catch {
      return dt.toLocaleString();
    }
  }

  stockAdjustmentTargetLabel(row: StockAdjustment): string {
    if (row.variant_id) {
      const match = this.variants().find((v) => v.id === row.variant_id);
      return match?.name || `Variant ${row.variant_id.slice(0, 8)}`;
    }
    return this.t('adminUi.products.form.stockLedgerTargetProduct');
  }

  stockReasonLabel(reason: StockAdjustmentReason): string {
    return this.t(`adminUi.products.form.stockReason.${reason}`);
  }

  applyStockAdjustment(): void {
    const productId = this.editingProductId();
    if (!productId) return;
    this.stockAdjustmentsError.set(null);

    const deltaRaw = String(this.stockAdjustDelta ?? '').trim();
    const deltaParsed = Number(deltaRaw);
    if (!Number.isInteger(deltaParsed) || deltaParsed === 0) {
      this.stockAdjustmentsError.set(this.t('adminUi.products.form.stockLedgerDeltaInvalid'));
      return;
    }

    const note = (this.stockAdjustNote || '').trim() || null;
    const variantId = this.stockAdjustTarget ? this.stockAdjustTarget : null;

    this.stockAdjustBusy.set(true);
    this.admin
      .applyStockAdjustment({
        product_id: productId,
        variant_id: variantId,
        delta: deltaParsed,
        reason: this.stockAdjustReason,
        note,
      })
      .subscribe({
        next: (created) => {
          this.stockAdjustBusy.set(false);
          this.stockAdjustDelta = '';
          this.stockAdjustNote = '';
          this.stockAdjustments.set([created, ...this.stockAdjustments()]);
          if (created.variant_id) {
            const current = this.variants();
            const idx = current.findIndex((v) => v.id === created.variant_id);
            if (idx >= 0) {
              const next = current.slice();
              next[idx] = { ...next[idx], stock_quantity: created.after_quantity };
              this.variants.set(next);
            }
          } else {
            this.form.stock_quantity = created.after_quantity;
          }
          this.toast.success(this.t('adminUi.products.form.stockLedgerApplied'));
        },
        error: (err) => {
          this.stockAdjustBusy.set(false);
          const detail = err?.error?.detail;
          this.stockAdjustmentsError.set(
            typeof detail === 'string' && detail.trim() ? detail.trim() : this.t('adminUi.products.form.stockLedgerApplyError')
          );
        },
      });
  }

  private loadStockAdjustments(productId: string): void {
    this.stockAdjustmentsError.set(null);
    this.admin.listStockAdjustments({ product_id: productId, limit: 50, offset: 0 }).subscribe({
      next: (rows) => this.stockAdjustments.set(Array.isArray(rows) ? rows : []),
      error: () => this.stockAdjustmentsError.set(this.t('adminUi.products.form.stockLedgerLoadError')),
    });
  }

  private setVariantsFromProduct(prod: any): void {
    const rows: AdminProductVariant[] = Array.isArray(prod?.variants) ? prod.variants : [];
    this.variants.set(
      rows.map((variant: AdminProductVariant) => ({
        id: String(variant.id),
        name: String(variant.name || ''),
        additional_price_delta: this.formatMoneyInput(Number(variant.additional_price_delta ?? 0)),
        stock_quantity: Number(variant.stock_quantity ?? 0),
      }))
    );
  }

  private updateVariant(index: number, patch: Partial<VariantRow>): void {
    const current = this.variants();
    if (index < 0 || index >= current.length) return;
    const next = current.slice();
    next[index] = { ...next[index], ...patch };
    this.variants.set(next);
  }

  private resetVariants(): void {
    this.variants.set([]);
    this.variantsError.set(null);
    this.variantsBusy.set(false);
    this.pendingVariantDeletes = new Set<string>();
  }

  private resetRelationships(): void {
    this.relationshipsRelatedIds.set([]);
    this.relationshipsUpsellIds.set([]);
    this.relationshipsRelated.set([]);
    this.relationshipsUpsells.set([]);
    this.relationshipsLoading.set(false);
    this.relationshipsSaving.set(false);
    this.relationshipsError.set(null);
    this.relationshipsMessage.set(null);
    this.relationshipSearch = '';
    this.relationshipSearchResults.set([]);
    this.relationshipSearchLoading.set(false);
    if (this.relationshipSearchTimeout) {
      clearTimeout(this.relationshipSearchTimeout);
      this.relationshipSearchTimeout = null;
    }
    this.relationshipSearchRequestId += 1;
  }

  private loadRelationships(slug: string): void {
    if (!slug) return;
    this.relationshipsLoading.set(true);
    this.relationshipsError.set(null);
    this.relationshipsMessage.set(null);
    this.admin.getProductRelationships(slug).subscribe({
      next: (res) => {
        const relatedIds = (res?.related_product_ids ?? []).map((id) => String(id));
        const upsellIds = (res?.upsell_product_ids ?? []).map((id) => String(id));
        this.relationshipsRelatedIds.set(relatedIds);
        this.relationshipsUpsellIds.set(upsellIds);
        const allIds = Array.from(new Set([...relatedIds, ...upsellIds]));
        if (!allIds.length) {
          this.relationshipsRelated.set([]);
          this.relationshipsUpsells.set([]);
          this.relationshipsLoading.set(false);
          return;
        }
        this.productsApi.byIds(allIds).subscribe({
          next: (rows) => {
            const items = Array.isArray(rows) ? rows : [];
            const byId = new Map(items.map((p) => [String(p.id), p]));
            const filteredRelatedIds = relatedIds.filter((id) => byId.has(id));
            const filteredUpsellIds = upsellIds.filter((id) => byId.has(id) && !filteredRelatedIds.includes(id));
            if (filteredRelatedIds.length !== relatedIds.length) this.relationshipsRelatedIds.set(filteredRelatedIds);
            if (filteredUpsellIds.length !== upsellIds.length) this.relationshipsUpsellIds.set(filteredUpsellIds);
            this.relationshipsRelated.set(filteredRelatedIds.map((id) => byId.get(id)!).filter(Boolean));
            this.relationshipsUpsells.set(filteredUpsellIds.map((id) => byId.get(id)!).filter(Boolean));
            this.relationshipsLoading.set(false);
          },
          error: () => {
            this.relationshipsLoading.set(false);
            this.relationshipsError.set(this.t('adminUi.products.relationships.errors.load'));
          }
        });
      },
      error: () => {
        this.relationshipsLoading.set(false);
        this.relationshipsError.set(this.t('adminUi.products.relationships.errors.load'));
      }
    });
  }

  onRelationshipSearchChange(next: string | number): void {
    this.relationshipSearch = String(next ?? '');
    if (this.relationshipSearchTimeout) {
      clearTimeout(this.relationshipSearchTimeout);
      this.relationshipSearchTimeout = null;
    }
    const needle = this.relationshipSearch.trim();
    if (needle.length < 2) {
      this.relationshipSearchResults.set([]);
      this.relationshipSearchLoading.set(false);
      return;
    }
    this.relationshipSearchTimeout = setTimeout(() => {
      this.relationshipSearchTimeout = null;
      this.runRelationshipSearch(needle);
    }, 250);
  }

  private runRelationshipSearch(needle: string): void {
    const requestId = ++this.relationshipSearchRequestId;
    this.relationshipSearchLoading.set(true);
    this.productsApi.search({ q: needle, page: 1, limit: 10 }).subscribe({
      next: (res) => {
        if (requestId !== this.relationshipSearchRequestId) return;
        const rows = Array.isArray(res?.items) ? res.items : [];
        const currentProductId = this.editingProductId();
        const selected = new Set([...this.relationshipsRelatedIds(), ...this.relationshipsUpsellIds()]);
        this.relationshipSearchResults.set(
          rows.filter((p) => String(p.id) !== currentProductId && !selected.has(String(p.id)))
        );
        this.relationshipSearchLoading.set(false);
      },
      error: () => {
        if (requestId !== this.relationshipSearchRequestId) return;
        this.relationshipSearchResults.set([]);
        this.relationshipSearchLoading.set(false);
      }
    });
  }

  addRelationship(item: AdminProductListItem, kind: 'related' | 'upsell'): void {
    const id = String(item?.id ?? '');
    if (!id) return;
    if (id === this.editingProductId()) return;

    const relatedIds = this.relationshipsRelatedIds();
    const upsellIds = this.relationshipsUpsellIds();
    if (relatedIds.includes(id) || upsellIds.includes(id)) return;

    if (kind === 'related') {
      this.relationshipsRelatedIds.set([...relatedIds, id]);
      this.relationshipsRelated.set([...this.relationshipsRelated(), item]);
    } else {
      this.relationshipsUpsellIds.set([...upsellIds, id]);
      this.relationshipsUpsells.set([...this.relationshipsUpsells(), item]);
    }
    this.relationshipSearchResults.set(this.relationshipSearchResults().filter((p) => String(p.id) !== id));
  }

  removeRelationship(id: string, kind: 'related' | 'upsell'): void {
    if (kind === 'related') {
      this.relationshipsRelatedIds.set(this.relationshipsRelatedIds().filter((pid) => pid !== id));
      this.relationshipsRelated.set(this.relationshipsRelated().filter((p) => String(p.id) !== id));
    } else {
      this.relationshipsUpsellIds.set(this.relationshipsUpsellIds().filter((pid) => pid !== id));
      this.relationshipsUpsells.set(this.relationshipsUpsells().filter((p) => String(p.id) !== id));
    }
  }

  moveRelationship(kind: 'related' | 'upsell', index: number, direction: -1 | 1): void {
    const ids = kind === 'related' ? this.relationshipsRelatedIds() : this.relationshipsUpsellIds();
    const items = kind === 'related' ? this.relationshipsRelated() : this.relationshipsUpsells();
    const nextIndex = index + direction;
    if (index < 0 || index >= ids.length) return;
    if (nextIndex < 0 || nextIndex >= ids.length) return;
    const idsNext = ids.slice();
    const itemsNext = items.slice();
    const [id] = idsNext.splice(index, 1);
    const [item] = itemsNext.splice(index, 1);
    idsNext.splice(nextIndex, 0, id);
    itemsNext.splice(nextIndex, 0, item);
    if (kind === 'related') {
      this.relationshipsRelatedIds.set(idsNext);
      this.relationshipsRelated.set(itemsNext);
    } else {
      this.relationshipsUpsellIds.set(idsNext);
      this.relationshipsUpsells.set(itemsNext);
    }
  }

  saveRelationships(): void {
    const slug = this.editingSlug();
    if (!slug) {
      this.toast.error(this.t('adminUi.products.relationships.saveFirst'));
      return;
    }
    this.relationshipsSaving.set(true);
    this.relationshipsError.set(null);
    this.relationshipsMessage.set(null);
    this.admin
      .updateProductRelationships(slug, {
        related_product_ids: this.relationshipsRelatedIds(),
        upsell_product_ids: this.relationshipsUpsellIds(),
      })
      .subscribe({
        next: () => {
          this.relationshipsSaving.set(false);
          this.relationshipsMessage.set(this.t('adminUi.products.relationships.success.save'));
          this.toast.success(this.t('adminUi.products.relationships.success.save'));
          this.loadRelationships(slug);
        },
        error: () => {
          this.relationshipsSaving.set(false);
          this.relationshipsError.set(this.t('adminUi.products.relationships.errors.save'));
        }
      });
  }

  private resetStockLedger(): void {
    this.stockAdjustments.set([]);
    this.stockAdjustmentsError.set(null);
    this.stockAdjustBusy.set(false);
    this.stockAdjustTarget = '';
    this.stockAdjustReason = 'manual_correction';
    this.stockAdjustDelta = '';
    this.stockAdjustNote = '';
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
        const nextImages = Array.isArray(prod.images) ? [...prod.images] : [];
        nextImages.sort((a: any, b: any) => Number(a?.sort_order ?? 0) - Number(b?.sort_order ?? 0));
        this.images.set(nextImages);
        if (target) target.value = '';
      },
      error: () => this.toast.error(this.t('adminUi.products.errors.image'))
    });
  }

  makeImagePrimary(imageId: string): void {
    const slug = this.editingSlug();
    const desired = (imageId || '').trim();
    if (!slug || !desired) return;
    if (this.imageOrderBusy()) return;

    const current = this.images();
    const fromIndex = current.findIndex((img) => img.id === desired);
    if (fromIndex <= 0) return;

    const next = [...current];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.unshift(moved);

    const updates = next.map((img, idx) => ({ id: img.id, sort_order: idx + 1 }));
    this.imageOrderBusy.set(true);
    this.imageOrderError.set(null);

    forkJoin(updates.map((row) => this.admin.reorderProductImage(slug, row.id, row.sort_order))).subscribe({
      next: () => {
        this.imageOrderBusy.set(false);
        for (const row of updates) {
          const match = next.find((img) => img.id === row.id);
          if (match) match.sort_order = row.sort_order;
        }
        this.images.set(next);
        this.toast.success(this.t('adminUi.storefront.products.images.reorderSuccess'));
      },
      error: () => {
        this.imageOrderBusy.set(false);
        this.imageOrderError.set(this.t('adminUi.storefront.products.images.reorderError'));
      }
    });
  }

  openDeleteImageConfirm(imageId: string): void {
    const img = this.images().find((i) => i.id === imageId);
    if (!img) return;
    const alt = (img.alt_text || this.t('adminUi.products.form.image')).toString();
    this.deleteImageConfirmTarget.set({ id: imageId, url: img.url, alt });
    this.deleteImageConfirmBusy.set(false);
    this.deleteImageConfirmOpen.set(true);
  }

  closeDeleteImageConfirm(): void {
    this.deleteImageConfirmOpen.set(false);
    this.deleteImageConfirmBusy.set(false);
    this.deleteImageConfirmTarget.set(null);
  }

  confirmDeleteImage(): void {
    const slug = this.editingSlug();
    const target = this.deleteImageConfirmTarget();
    if (!slug || !target) return;
    if (this.deleteImageConfirmBusy()) return;
    this.deleteImageConfirmBusy.set(true);
    this.deleteImage(target.id, {
      done: (ok) => {
        this.deleteImageConfirmBusy.set(false);
        if (ok) this.closeDeleteImageConfirm();
      }
    });
  }

  deleteImage(imageId: string, opts?: { done?: (ok: boolean) => void }): void {
    const slug = this.editingSlug();
    if (!slug) {
      opts?.done?.(false);
      return;
    }
    this.admin.deleteProductImage(slug, imageId).subscribe({
      next: (prod: any) => {
        this.toast.success(this.t('adminUi.products.success.imageDelete'));
        if (this.editingImageId() === imageId) {
          this.resetImageMeta();
        }
        const nextImages = Array.isArray(prod.images) ? [...prod.images] : [];
        nextImages.sort((a: any, b: any) => Number(a?.sort_order ?? 0) - Number(b?.sort_order ?? 0));
        this.images.set(nextImages);
        if (this.deletedImagesOpen()) {
          this.loadDeletedImages(slug);
        }
        opts?.done?.(true);
      },
      error: () => {
        this.toast.error(this.t('adminUi.products.errors.deleteImage'));
        opts?.done?.(false);
      }
    });
  }

  toggleDeletedImages(): void {
    const slug = this.editingSlug();
    if (!slug) return;
    if (this.deletedImagesOpen()) {
      this.resetDeletedImages();
      return;
    }
    this.deletedImagesOpen.set(true);
    this.loadDeletedImages(slug);
  }

  restoreDeletedImage(imageId: string): void {
    const slug = this.editingSlug();
    if (!slug) return;
    this.deletedImagesError.set(null);
    this.restoringDeletedImage.set(imageId);
    this.admin.restoreProductImage(slug, imageId).subscribe({
      next: (prod: any) => {
        this.toast.success(this.t('adminUi.products.success.imageRestore'));
        const nextImages = Array.isArray(prod.images) ? [...prod.images] : [];
        nextImages.sort((a: any, b: any) => Number(a?.sort_order ?? 0) - Number(b?.sort_order ?? 0));
        this.images.set(nextImages);
        this.restoringDeletedImage.set(null);
        this.loadDeletedImages(slug);
      },
      error: () => {
        this.restoringDeletedImage.set(null);
        this.deletedImagesError.set(this.t('adminUi.products.errors.restoreImage'));
      }
    });
  }

  toggleImageMeta(imageId: string): void {
    const slug = this.editingSlug();
    if (!slug) return;

    if (this.editingImageId() === imageId) {
      this.resetImageMeta();
      return;
    }

    this.editingImageId.set(imageId);
    this.loadImageMeta(slug, imageId);
  }

  saveImageMeta(): void {
    const slug = this.editingSlug();
    const imageId = this.editingImageId();
    if (!slug || !imageId) return;

    this.imageMetaError.set(null);
    this.imageMetaBusy.set(true);

    const ops: any[] = [];
    (['ro', 'en'] as const).forEach((lang) => {
      const alt = this.imageMeta[lang].alt_text.trim();
      const caption = this.imageMeta[lang].caption.trim();
      if (!alt && !caption) {
        if (this.imageMetaExists[lang]) {
          ops.push(this.admin.deleteProductImageTranslation(slug, imageId, lang));
        }
        return;
      }
      ops.push(
        this.admin.upsertProductImageTranslation(slug, imageId, lang, {
          alt_text: alt || null,
          caption: caption || null
        })
      );
    });

    if (!ops.length) {
      this.imageMetaBusy.set(false);
      this.toast.success(this.t('adminUi.products.form.imageMetaSaved'));
      return;
    }

    forkJoin(ops).subscribe({
      next: () => {
        this.toast.success(this.t('adminUi.products.form.imageMetaSaved'));
        this.loadImageMeta(slug, imageId);
      },
      error: () => {
        this.imageMetaBusy.set(false);
        this.imageMetaError.set(this.t('adminUi.products.form.imageMetaSaveError'));
      }
    });
  }

  reprocessImage(): void {
    const slug = this.editingSlug();
    const imageId = this.editingImageId();
    if (!slug || !imageId) return;
    this.imageMetaError.set(null);
    this.imageMetaBusy.set(true);
    this.admin.reprocessProductImage(slug, imageId).subscribe({
      next: (stats) => {
        this.imageStats = stats || null;
        this.imageMetaBusy.set(false);
        this.toast.success(this.t('adminUi.products.form.imageReprocessed'));
      },
      error: () => {
        this.imageMetaBusy.set(false);
        this.imageMetaError.set(this.t('adminUi.products.form.imageReprocessError'));
      }
    });
  }

  formatBytes(value?: number | null): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = value;
    let idx = 0;
    while (size >= 1024 && idx < units.length - 1) {
      size /= 1024;
      idx += 1;
    }
    const rounded = idx === 0 ? Math.round(size) : Math.round(size * 10) / 10;
    return `${rounded} ${units[idx]}`;
  }

  formatAuditValue(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    if (value instanceof Date) return value.toISOString();
    try {
      return JSON.stringify(value);
    } catch {
      return '—';
    }
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.errorRequestId.set(null);
    this.productsApi
      .search({
        q: this.q.trim() ? this.q.trim() : undefined,
        status: this.status === 'all' ? undefined : this.status,
        category_slug: this.categorySlug || undefined,
        missing_translations: this.translationFilter === 'missing_any' ? true : undefined,
        missing_translation_lang:
          this.translationFilter === 'missing_en' ? 'en' : this.translationFilter === 'missing_ro' ? 'ro' : undefined,
        deleted: this.view === 'deleted' ? true : undefined,
        page: this.page,
        limit: this.limit
      })
      .subscribe({
        next: (res) => {
          this.products.set(res.items || []);
          this.meta.set(res.meta || null);
          this.updateBulkPricePreview();
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(this.t('adminUi.products.errors.loadList'));
          this.errorRequestId.set(extractRequestId(err));
          this.loading.set(false);
        }
      });
  }

  retryLoad(): void {
    this.load();
  }

	  private loadCategories(): void {
	    this.catalog.listCategories(undefined, { include_hidden: true }).subscribe({
	      next: (cats) => this.categories.set(cats || []),
	      error: () => this.categories.set([])
	    });
	  }

  private loadAdminCategories(): void {
    this.admin.getCategories().subscribe({
      next: (cats: any[]) => {
        const mapped = (cats || []).map((c) => ({ id: c.id, name: c.name }));
        this.adminCategories.set(mapped);
        if (this.editorOpen() && !this.editingSlug() && !this.form.category_id && mapped[0]) {
          this.form.category_id = mapped[0].id;
        }
        this.openPendingEditor();
      },
      error: () => {
        this.adminCategories.set([]);
        this.openPendingEditor();
      }
    });
  }

  private openPendingEditor(): void {
    if (this.pendingEditProductSlug) {
      const slug = this.pendingEditProductSlug;
      this.pendingEditProductSlug = null;
      this.edit(slug);
      return;
    }
    if (this.autoStartNewProduct) {
      this.autoStartNewProduct = false;
      this.startNew();
    }
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

  private parseSignedMoneyInput(raw: string): number | null {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed || trimmed === '-') return null;
    const negative = trimmed.startsWith('-');
    const magnitudeRaw = negative ? trimmed.slice(1) : trimmed;
    const magnitude = this.parseMoneyInput(magnitudeRaw);
    if (magnitude === null) return null;
    return negative ? -magnitude : magnitude;
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
      weight_grams: '',
      width_cm: '',
      height_cm: '',
      depth_cm: '',
      shipping_class: 'standard',
      shipping_allow_locker: true,
      shipping_disallowed_couriers: { sameday: false, fan_courier: false },
      sale_enabled: false,
      sale_type: 'percent',
      sale_value: '',
      sale_start_at: '',
      sale_end_at: '',
      sale_auto_publish: false,
      stock_quantity: 0,
      low_stock_threshold: '',
      status: 'draft',
      is_active: true,
      is_featured: false,
      sku: '',
      short_description: '',
      long_description: '',
      publish_at: '',
      is_bestseller: false,
      badges: {
        new: { enabled: false, start_at: '', end_at: '' },
        limited: { enabled: false, start_at: '', end_at: '' },
        handmade: { enabled: false, start_at: '', end_at: '' }
      }
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

  private resetAudit(): void {
    this.auditEntries.set([]);
    this.auditBusy.set(false);
    this.auditError.set(null);
    this.priceHistoryChanges.set([]);
    this.priceHistoryChart.set(null);
  }

  private rebuildPriceHistory(entries: AdminProductAuditEntry[]): void {
    const changes = this.extractBasePriceChanges(entries);
    this.priceHistoryChanges.set(changes);
    this.priceHistoryChart.set(this.buildPriceHistoryChart(changes));
  }

  private extractBasePriceChanges(entries: AdminProductAuditEntry[]): PriceChangeEvent[] {
    const out: PriceChangeEvent[] = [];
    for (const entry of entries || []) {
      const changes = entry?.payload?.changes;
      const base = changes?.base_price;
      if (!base) continue;
      const before = this.parseAuditMoney(base?.before);
      const after = this.parseAuditMoney(base?.after);
      if (before === null || after === null) continue;
      if (before === after) continue;
      const user = (entry.user_email || entry.user_id || null) as string | null;
      out.push({ at: entry.created_at, before, after, user });
    }
    out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return out;
  }

  private buildPriceHistoryChart(changes: PriceChangeEvent[]): PriceHistoryChart | null {
    const width = 640;
    const height = 160;
    const pad = 12;
    const now = Date.now();

    const currentBase = this.parseMoneyInput(this.form?.base_price || '');
    const asc = [...changes].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    const series: Array<{ t: number; v: number }> = [];
    const dotsSource: Array<{ t: number; v: number }> = [];

    if (asc.length === 0) {
      if (currentBase === null) return null;
      series.push({ t: now, v: currentBase }, { t: now + 1, v: currentBase });
      dotsSource.push({ t: now, v: currentBase });
    } else {
      const firstAt = new Date(asc[0].at).getTime();
      series.push({ t: firstAt, v: asc[0].before });
      for (const ev of asc) {
        const t = new Date(ev.at).getTime();
        series.push({ t, v: ev.before }, { t, v: ev.after });
        dotsSource.push({ t, v: ev.after });
      }
      const last = asc[asc.length - 1];
      const lastAt = new Date(last.at).getTime();
      const endAt = Math.max(now, lastAt);
      series.push({ t: endAt, v: last.after });
      if (endAt === now) dotsSource.push({ t: now, v: last.after });
    }

    const saleStart = this.parseLocalDateTime(this.form?.sale_start_at || '');
    const saleEnd = this.parseLocalDateTime(this.form?.sale_end_at || '');

    let minT = Math.min(...series.map((p) => p.t));
    let maxT = Math.max(...series.map((p) => p.t));
    if (saleStart !== null) minT = Math.min(minT, saleStart);
    if (saleEnd !== null) maxT = Math.max(maxT, saleEnd);
    minT = Math.min(minT, now);
    maxT = Math.max(maxT, now);
    const spanT = Math.max(1, maxT - minT);

    let minV = Math.min(...series.map((p) => p.v));
    let maxV = Math.max(...series.map((p) => p.v));
    if (!Number.isFinite(minV) || !Number.isFinite(maxV)) return null;
    if (minV === maxV) {
      minV -= 1;
      maxV += 1;
    } else {
      const padV = Math.max(0.01, (maxV - minV) * 0.1);
      minV -= padV;
      maxV += padV;
    }
    const spanV = Math.max(1e-9, maxV - minV);

    const toX = (t: number) => pad + ((t - minT) / spanT) * (width - pad * 2);
    const toY = (v: number) => height - pad - ((v - minV) / spanV) * (height - pad * 2);

    const polyline = series
      .map((p) => `${Math.round(toX(p.t) * 10) / 10},${Math.round(toY(p.v) * 10) / 10}`)
      .join(' ');

    const dots = dotsSource.map((p) => ({
      x: Math.round(toX(p.t) * 10) / 10,
      y: Math.round(toY(p.v) * 10) / 10
    }));

    const nowX = Math.round(toX(now) * 10) / 10;

    let saleRect: { x: number; width: number } | null = null;
    if (saleStart !== null && saleEnd !== null && saleEnd > saleStart) {
      const left = Math.max(pad, Math.min(width - pad, toX(saleStart)));
      const right = Math.max(pad, Math.min(width - pad, toX(saleEnd)));
      if (right > left) saleRect = { x: Math.round(left * 10) / 10, width: Math.round((right - left) * 10) / 10 };
    }

    const latest = asc.length > 0 ? asc[asc.length - 1].after : (currentBase ?? 0);
    const rawMin = Math.min(...series.map((p) => p.v));
    const rawMax = Math.max(...series.map((p) => p.v));

    return {
      width,
      height,
      pad,
      polyline,
      dots,
      min: rawMin,
      max: rawMax,
      latest,
      nowX: Number.isFinite(nowX) ? nowX : null,
      saleRect
    };
  }

  private parseAuditMoney(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
    }
    if (typeof value === 'bigint') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private parseLocalDateTime(value: string): number | null {
    const trimmed = (value || '').trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    const ms = d.getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  private resetMarkdownPreview(): void {
    this.descriptionPreviewOpen.set(false);
    this.descriptionPreviewHtml.set('');
    this.descriptionPreviewSanitized.set(false);
    this.translationPreviewOpen = { en: false, ro: false };
    this.translationPreviewHtml = { en: '', ro: '' };
    this.translationPreviewSanitized = { en: false, ro: false };
  }

  private blankImageMetaForm(): ImageMetaForm {
    return { alt_text: '', caption: '' };
  }

  private blankImageMetaByLang(): ImageMetaByLang {
    return { en: this.blankImageMetaForm(), ro: this.blankImageMetaForm() };
  }

  private resetDeletedImages(): void {
    this.deletedImagesOpen.set(false);
    this.deletedImages.set([]);
    this.deletedImagesBusy.set(false);
    this.deletedImagesError.set(null);
    this.restoringDeletedImage.set(null);
  }

  private loadDeletedImages(slug: string): void {
    this.deletedImagesBusy.set(true);
    this.deletedImagesError.set(null);
    this.admin.listDeletedProductImages(slug).subscribe({
      next: (items) => {
        this.deletedImages.set(Array.isArray(items) ? items : []);
        this.deletedImagesBusy.set(false);
      },
      error: () => {
        this.deletedImagesBusy.set(false);
        this.deletedImagesError.set(this.t('adminUi.products.errors.loadDeletedImages'));
      }
    });
  }

  private resetImageMeta(): void {
    this.editingImageId.set(null);
    this.imageMetaBusy.set(false);
    this.imageMetaError.set(null);
    this.imageStats = null;
    this.imageMetaExists = { en: false, ro: false };
    this.imageMeta = this.blankImageMetaByLang();
  }

  private loadImageMeta(slug: string, imageId: string): void {
    this.imageMetaBusy.set(true);
    this.imageMetaError.set(null);
    this.imageStats = null;
    this.imageMetaExists = { en: false, ro: false };
    this.imageMeta = this.blankImageMetaByLang();

    forkJoin({
      translations: this.admin.getProductImageTranslations(slug, imageId),
      stats: this.admin.getProductImageStats(slug, imageId)
    }).subscribe({
      next: ({ translations, stats }: { translations: AdminProductImageTranslation[]; stats: AdminProductImageOptimizationStats }) => {
        const mapped: ImageMetaByLang = this.blankImageMetaByLang();
        const exists: Record<'en' | 'ro', boolean> = { en: false, ro: false };
        for (const t of translations || []) {
          if (t.lang !== 'en' && t.lang !== 'ro') continue;
          exists[t.lang] = true;
          mapped[t.lang] = {
            alt_text: (t.alt_text || '').toString(),
            caption: (t.caption || '').toString()
          };
        }
        this.imageMetaExists = exists;
        this.imageMeta = mapped;
        this.imageStats = stats || null;
        this.imageMetaBusy.set(false);
      },
      error: () => {
        this.imageMetaBusy.set(false);
        this.imageMetaError.set(this.t('adminUi.products.form.imageMetaLoadError'));
      }
    });
  }

  private loadAudit(slug: string): void {
    this.auditBusy.set(true);
    this.auditError.set(null);
    this.admin.getProductAudit(slug, 50).subscribe({
      next: (items) => {
        const entries = Array.isArray(items) ? items : [];
        this.auditEntries.set(entries);
        this.rebuildPriceHistory(entries);
        this.auditBusy.set(false);
      },
      error: () => {
        this.auditBusy.set(false);
        this.auditError.set(this.t('adminUi.products.audit.errors.load'));
      }
    });
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
        for (const lang of ['en', 'ro'] as const) {
          if (this.translationPreviewOpen[lang]) {
            this.refreshTranslationPreview(lang);
          }
        }
        this.translationLoading.set(false);
      },
      error: () => {
        this.translationError.set(this.t('adminUi.products.translations.errors.load'));
        this.translationLoading.set(false);
      }
    });
  }

  private parseTagSlugs(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const slugs = raw
      .map((tag: any) => (typeof tag === 'string' ? tag : tag?.slug))
      .map((slug: any) => (slug ?? '').toString().trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const slug of slugs) {
      const normalized = slug.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      unique.push(normalized);
    }
    return unique;
  }

  private buildTags(): string[] {
    const seen = new Set<string>(this.loadedTagSlugs.map((t) => (t ?? '').toString().trim().toLowerCase()).filter(Boolean));
    if (this.form.is_bestseller) {
      seen.add('bestseller');
    } else {
      seen.delete('bestseller');
    }
    return Array.from(seen);
  }

  private buildShortDescription(): string | null {
    const direct = (this.form.short_description || '').trim();
    if (direct) return direct.slice(0, 280);

    const fallback = (this.form.long_description || '').trim();
    if (!fallback) return null;

    const firstLine = fallback
      .split('\n')
      .map((line) => line.trim())
      .find((line) => Boolean(line));

    return firstLine ? firstLine.slice(0, 280) : null;
  }

  private toLocalDateTime(value: string): string {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private downloadBlob(blob: Blob, filename: string): void {
    if (typeof document === 'undefined') return;
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }

  private t(key: string): string {
    return this.translate.instant(key) as string;
  }
}
