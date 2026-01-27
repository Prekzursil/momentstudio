import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { CatalogService, Category, PaginationMeta, Product, SortOption } from '../../core/catalog.service';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { InputComponent } from '../../shared/input.component';
import { ProductCardComponent } from '../../shared/product-card.component';
import { ProductQuickViewModalComponent } from '../../shared/product-quick-view-modal.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { ToastService } from '../../core/toast.service';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription, combineLatest } from 'rxjs';
import { Meta, Title } from '@angular/platform-browser';

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
    RouterLink,
    ContainerComponent,
    ButtonComponent,
    InputComponent,
    ProductCardComponent,
    ProductQuickViewModalComponent,
    SkeletonComponent,
    BreadcrumbComponent,
    TranslateModule
  ],
  template: `
	    <app-container classes="pt-10 pb-24 lg:pb-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
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
	            <p class="text-sm font-semibold text-slate-800 dark:text-slate-200">{{ 'shop.categories' | translate }}</p>
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
	              <label
	                *ngFor="let category of rootCategories"
	                class="grid gap-2"
	              >
	                <span class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
	                  <input
	                    type="radio"
	                    name="category"
	                    class="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
	                    [value]="category.slug"
	                    [(ngModel)]="categorySelection"
	                    (change)="onCategorySelected()"
	                  />
	                  <span>{{ category.name }}</span>
	                </span>
	                <div
	                  *ngIf="categorySelection === category.slug && getSubcategories(category).length"
	                  class="ml-6 grid gap-2"
	                >
	                  <p class="text-xs font-semibold text-slate-600 dark:text-slate-300">{{ 'shop.subcategories' | translate }}</p>
	                  <div class="flex flex-wrap gap-2">
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

          <div *ngIf="loading()" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-4">
            <div
              *ngFor="let i of placeholders"
              class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:bg-slate-900 dark:border-slate-800 dark:shadow-none"
            >
              <app-skeleton height="200px"></app-skeleton>
              <div class="grid gap-2">
                <app-skeleton height="16px" width="80%"></app-skeleton>
                <app-skeleton height="16px" width="55%"></app-skeleton>
                <app-skeleton height="14px" width="92%"></app-skeleton>
              </div>
            </div>
          </div>

          <div *ngIf="hasError()" class="border border-amber-200 bg-amber-50 rounded-2xl p-6 text-center grid gap-3 dark:border-amber-900/40 dark:bg-amber-950/30">
            <p class="text-lg font-semibold text-amber-900 dark:text-amber-100">{{ 'shop.errorTitle' | translate }}</p>
            <p class="text-sm text-amber-800 dark:text-amber-200">{{ 'shop.errorCopy' | translate }}</p>
            <div class="flex justify-center gap-3">
              <app-button [label]="'shop.retry' | translate" size="sm" (action)="loadProducts()"></app-button>
              <app-button [label]="'shop.reset' | translate" size="sm" variant="ghost" (action)="resetFilters()"></app-button>
            </div>
          </div>

          <div *ngIf="!loading() && !hasError() && products.length === 0" class="border border-dashed border-slate-200 rounded-2xl p-10 text-center grid gap-2 dark:border-slate-800">
            <p class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'shop.noResults' | translate }}</p>
            <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'shop.tryAdjust' | translate }}</p>
            <div *ngIf="rootCategories.length" class="mt-4 grid gap-2">
              <p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                {{ 'shop.suggestedCategories' | translate }}
              </p>
              <div class="flex flex-wrap justify-center gap-2">
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
            <div class="flex justify-center gap-3">
              <app-button [label]="'shop.reset' | translate" size="sm" variant="ghost" (action)="resetFilters()"></app-button>
              <app-button [label]="'shop.backHome' | translate" size="sm" variant="ghost" routerLink="/"></app-button>
            </div>
          </div>

          <div *ngIf="!loading() && products.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <app-product-card
              *ngFor="let product of products"
              [product]="product"
              [rememberShopReturn]="true"
              [showQuickView]="true"
              (quickView)="openQuickView($event)"
            ></app-product-card>
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
  placeholders = Array.from({ length: 6 });
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
	    sort: 'newest',
    page: 1,
    limit: 12
  };

  categorySelection = '';
  activeCategorySlug = '';
  activeSubcategorySlug = '';
  rootCategories: Category[] = [];
  private categoriesBySlug = new Map<string, Category>();
  private categoriesById = new Map<string, Category>();
  private childrenByParentId = new Map<string, Category[]>();

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

  sortOptions: { label: string; value: SortOption }[] = [
    { label: 'shop.sortNew', value: 'newest' },
    { label: 'shop.sortPriceAsc', value: 'price_asc' },
    { label: 'shop.sortPriceDesc', value: 'price_desc' },
    { label: 'shop.sortNameAsc', value: 'name_asc' },
    { label: 'shop.sortNameDesc', value: 'name_desc' }
  ];

  private langSub?: Subscription;

  constructor(
    private catalog: CatalogService,
    private route: ActivatedRoute,
    private router: Router,
    private toast: ToastService,
    private translate: TranslateService,
    private title: Title,
    private metaService: Meta
  ) {}

  ngOnInit(): void {
    this.setMetaTags();
    this.langSub = this.translate.onLangChange.subscribe(() => this.setMetaTags());
    this.initScrollRestoreFromSession();
    const dataCategories = (this.route.snapshot.data['categories'] as Category[]) ?? [];
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
    this.cancelFilterDebounce();
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
      const select = document.getElementById('shop-sort-select') as HTMLSelectElement | null;
      select?.focus();
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
    this.catalog.listCategories().subscribe((data) => {
      this.categories = data;
      this.rebuildCategoryTree();
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
	    const isSale = this.activeCategorySlug === 'sale';
	    const categorySlug = isSale ? undefined : (this.activeSubcategorySlug || this.activeCategorySlug || undefined);
	    this.catalog
	      .listProducts({
	        search: this.filters.search || undefined,
	        category_slug: categorySlug,
	        on_sale: isSale ? true : undefined,
	        min_price: this.filters.min_price > this.priceMinBound ? this.filters.min_price : undefined,
	        max_price: this.filters.max_price < this.priceMaxBound ? this.filters.max_price : undefined,
	        tags: Array.from(this.filters.tags),
	        sort: this.filters.sort,
        page: this.filters.page,
        limit: this.filters.limit
      })
      .subscribe({
        next: (response) => {
          const incoming = response.items ?? [];
          this.products = append && this.products.length ? [...this.products, ...incoming] : incoming;
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
          this.loading.set(false);
          this.loadingMore.set(false);
          if (append) {
            this.filters.page = Math.max(1, this.filters.page - 1);
            this.toast.error(this.translate.instant('shop.errorTitle'), this.translate.instant('shop.errorCopy'));
            return;
          }
          this.products = [];
          this.pageMeta = null;
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
    const title = this.translate.instant('shop.metaTitle');
    const description = this.translate.instant('shop.metaDescription');
    this.title.setTitle(title);
    this.metaService.updateTag({ name: 'og:title', content: title });
    this.metaService.updateTag({ name: 'og:description', content: description });
    this.metaService.updateTag({ name: 'description', content: description });
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
      sort: this.filters.sort !== 'newest' ? this.filters.sort : undefined,
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
    this.filters.sort = (params['sort'] as SortOption) ?? 'newest';
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
