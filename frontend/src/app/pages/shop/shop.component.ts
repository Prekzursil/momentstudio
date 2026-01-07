import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { CatalogService, Category, PaginationMeta, Product, SortOption } from '../../core/catalog.service';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { InputComponent } from '../../shared/input.component';
import { ProductCardComponent } from '../../shared/product-card.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { ToastService } from '../../core/toast.service';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { Meta, Title } from '@angular/platform-browser';

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
    SkeletonComponent,
    BreadcrumbComponent,
    TranslateModule
  ],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <div class="grid gap-8 lg:grid-cols-[280px_1fr]">
        <aside class="border border-slate-200 rounded-2xl p-4 bg-white h-fit space-y-6 dark:border-slate-800 dark:bg-slate-900">
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
              [(value)]="filters.search"
              (ngModelChange)="onSearch()"
            >
            </app-input>
          </div>

          <div class="space-y-3">
            <p class="text-sm font-semibold text-slate-800 dark:text-slate-200">{{ 'shop.categories' | translate }}</p>
            <div class="space-y-2 max-h-48 overflow-auto pr-1">
              <label
                *ngFor="let category of categories"
                class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"
              >
                <input
                  type="radio"
                  name="category"
                  class="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
                  [value]="category.slug"
                  [(ngModel)]="filters.category_slug"
                  (change)="applyFilters()"
                />
                <span>{{ category.name }}</span>
              </label>
              <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="radio"
                  name="category"
                  class="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
                  value=""
                  [(ngModel)]="filters.category_slug"
                  (change)="applyFilters()"
                />
                <span>{{ 'shop.allCategories' | translate }}</span>
              </label>
            </div>
          </div>

          <div class="space-y-3">
            <p class="text-sm font-semibold text-slate-800 dark:text-slate-200">{{ 'shop.priceRange' | translate }}</p>
            <div class="grid gap-3">
              <div class="grid gap-2 overflow-hidden">
                <input
                  type="range"
                  [min]="priceMinBound"
                  [max]="priceMaxBound"
                  [step]="priceStep"
                  class="block w-full max-w-full accent-indigo-600"
                  [(ngModel)]="filters.min_price"
                  (change)="onPriceCommit('min')"
                  aria-label="Minimum price"
                />
                <input
                  type="range"
                  [min]="priceMinBound"
                  [max]="priceMaxBound"
                  [step]="priceStep"
                  class="block w-full max-w-full accent-indigo-600"
                  [(ngModel)]="filters.max_price"
                  (change)="onPriceCommit('max')"
                  aria-label="Maximum price"
                />
              </div>
              <div class="grid grid-cols-2 gap-3">
                <app-input
                  [label]="'shop.min' | translate"
                  type="number"
                  [value]="filters.min_price"
                  (valueChange)="onPriceTextChange('min', $event)"
                ></app-input>
                <app-input
                  [label]="'shop.max' | translate"
                  type="number"
                  [value]="filters.max_price"
                  (valueChange)="onPriceTextChange('max', $event)"
                ></app-input>
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400">{{ 'shop.priceHint' | translate }}</p>
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
          <div class="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
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
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="filters.sort"
                (change)="applyFilters()"
              >
                <option *ngFor="let option of sortOptions" [value]="option.value">{{ option.label | translate }}</option>
              </select>
            </label>
          </div>

          <div *ngIf="loading()" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-4">
            <app-skeleton *ngFor="let i of placeholders" height="260px"></app-skeleton>
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
            <div class="flex justify-center gap-3">
              <app-button [label]="'shop.reset' | translate" size="sm" variant="ghost" (action)="resetFilters()"></app-button>
              <app-button [label]="'shop.backHome' | translate" size="sm" variant="ghost" routerLink="/"></app-button>
            </div>
          </div>

          <div *ngIf="!loading() && products.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <app-product-card *ngFor="let product of products" [product]="product"></app-product-card>
          </div>

          <div *ngIf="pageMeta" class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-300">
            <div>
              {{ 'shop.pageMeta' | translate : { page: pageMeta.page, totalPages: pageMeta.total_pages, totalItems: pageMeta.total_items } }}
            </div>
            <div class="flex gap-2">
              <app-button label="Prev" size="sm" variant="ghost" [disabled]="pageMeta.page <= 1" (action)="changePage(-1)">
              </app-button>
              <app-button
                label="Next"
                size="sm"
                variant="ghost"
                [disabled]="pageMeta.page >= pageMeta.total_pages"
                (action)="changePage(1)"
              >
              </app-button>
            </div>
          </div>
        </section>
      </div>
    </app-container>
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
    category_slug: string;
    min_price: number;
    max_price: number;
    tags: Set<string>;
    sort: SortOption;
    page: number;
    limit: number;
  } = {
    search: '',
    category_slug: '',
    min_price: 1,
    max_price: 500,
    tags: new Set<string>(),
    sort: 'newest',
    page: 1,
    limit: 12
  };

  readonly priceMinBound = 1;
  priceMaxBound = 500;
  readonly priceStep = 1;
  private suppressNextQueryLoad = false;
  private lastBoundsKey = '';

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
    const dataCategories = (this.route.snapshot.data['categories'] as Category[]) ?? [];
    if (dataCategories.length) {
      this.categories = dataCategories;
    } else {
      this.fetchCategories();
    }
    this.route.queryParams.subscribe((params) => {
      if (this.suppressNextQueryLoad) {
        this.suppressNextQueryLoad = false;
        return;
      }
      this.syncFiltersFromQuery(params);
      this.loadProducts(false);
    });
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
  }

  fetchCategories(): void {
    this.catalog.listCategories().subscribe((data) => {
      this.categories = data;
    });
  }

  loadProducts(pushQuery = true): void {
    this.normalizePriceRange();
    this.loading.set(true);
    this.hasError.set(false);
    if (pushQuery) {
      this.suppressNextQueryLoad = true;
      this.updateQueryParams();
    }
    this.loadPriceBoundsIfNeeded(() => this.fetchProducts());
  }

  private fetchProducts(): void {
    this.catalog
      .listProducts({
        search: this.filters.search || undefined,
        category_slug: this.filters.category_slug || undefined,
        min_price: this.filters.min_price > this.priceMinBound ? this.filters.min_price : undefined,
        max_price: this.filters.max_price < this.priceMaxBound ? this.filters.max_price : undefined,
        tags: Array.from(this.filters.tags),
        sort: this.filters.sort,
        page: this.filters.page,
        limit: this.filters.limit
      })
      .subscribe({
        next: (response) => {
          this.products = response.items;
          this.pageMeta = response.meta;
          if (this.filters.category_slug) {
            const cat = this.categories.find((c) => c.slug === this.filters.category_slug);
            this.crumbs = [
              { label: 'nav.home', url: '/' },
              { label: 'nav.shop', url: '/shop' },
              { label: cat?.name ?? this.filters.category_slug }
            ];
          } else {
            this.crumbs = [
              { label: 'nav.home', url: '/' },
              { label: 'nav.shop' }
            ];
          }
          const tagMap = new Map<string, string>();
          response.items.forEach((p) => {
            (p.tags ?? []).forEach((tag) => tagMap.set(tag.slug, tag.name));
          });
          this.allTags = Array.from(tagMap.entries())
            .map(([slug, name]) => ({ slug, name }))
            .sort((a, b) => a.name.localeCompare(b.name));
          this.setMetaTags();
          this.loading.set(false);
          this.hasError.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.products = [];
          this.hasError.set(true);
          this.toast.error(this.translate.instant('shop.errorTitle'), this.translate.instant('shop.errorCopy'));
        }
      });
  }

  applyFilters(): void {
    this.filters.page = 1;
    this.loadProducts();
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
    this.applyFilters();
  }

  onSearch(): void {
    this.applyFilters();
  }

  changePage(delta: number): void {
    if (!this.pageMeta) return;
    const nextPage = this.pageMeta.page + delta;
    if (nextPage < 1 || nextPage > this.pageMeta.total_pages) return;
    this.filters.page = nextPage;
    this.loadProducts();
  }

  toggleTag(tagSlug: string): void {
    if (this.filters.tags.has(tagSlug)) {
      this.filters.tags.delete(tagSlug);
    } else {
      this.filters.tags.add(tagSlug);
    }
    this.applyFilters();
  }

  resetFilters(): void {
    this.filters.search = '';
    this.filters.category_slug = '';
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

  private updateQueryParams(): void {
    const params: Params = {
      q: this.filters.search || undefined,
      cat: this.filters.category_slug || undefined,
      min: this.filters.min_price > this.priceMinBound ? this.filters.min_price : undefined,
      max: this.filters.max_price < this.priceMaxBound ? this.filters.max_price : undefined,
      sort: this.filters.sort !== 'newest' ? this.filters.sort : undefined,
      page: this.filters.page !== 1 ? this.filters.page : undefined,
      tags: this.filters.tags.size ? Array.from(this.filters.tags).join(',') : undefined
    };
    void this.router.navigate([], { relativeTo: this.route, queryParams: params, queryParamsHandling: 'merge' });
  }

  private syncFiltersFromQuery(params: Params): void {
    this.filters.search = params['q'] ?? '';
    this.filters.category_slug = params['cat'] ?? '';
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

  private loadPriceBoundsIfNeeded(after: () => void): void {
    const key = this.computeBoundsKey();
    if (key === this.lastBoundsKey) {
      after();
      return;
    }
    this.lastBoundsKey = key;
    this.loadPriceBounds(after);
  }

  private computeBoundsKey(): string {
    const tags = Array.from(this.filters.tags).sort().join(',');
    return `${this.filters.category_slug}|${this.filters.search}|${tags}`;
  }

  private loadPriceBounds(after: () => void): void {
    const previousMaxBound = this.priceMaxBound;
    this.catalog
      .getProductPriceBounds({
        category_slug: this.filters.category_slug || undefined,
        search: this.filters.search || undefined,
        tags: Array.from(this.filters.tags)
      })
      .subscribe({
        next: (resp) => {
          const max = resp.max_price;
          if (typeof max === 'number' && Number.isFinite(max)) {
            const rounded = Math.ceil(max / this.priceStep) * this.priceStep;
            this.priceMaxBound = Math.max(this.priceMinBound, rounded);
          }
          if (this.filters.max_price === previousMaxBound) {
            this.filters.max_price = this.priceMaxBound;
          }
          this.normalizePriceRange();
          after();
        },
        error: () => {
          // Keep defaults if we can't infer bounds.
          after();
        }
      });
  }

  private parsePrice(raw: unknown): number | undefined {
    if (raw === null || raw === undefined) return undefined;
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) return undefined;
      return raw;
    }
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
}
