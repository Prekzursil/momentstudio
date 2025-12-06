import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
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
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRouteSnapshot } from '@angular/router';

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
    BreadcrumbComponent
  ],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <div class="grid gap-8 lg:grid-cols-[280px_1fr]">
        <aside class="border border-slate-200 rounded-2xl p-4 bg-white h-fit space-y-6">
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold text-slate-900">Filters</h2>
              <button class="text-sm text-indigo-600 font-medium" type="button" (click)="resetFilters()">Reset</button>
            </div>
            <app-input label="Search" placeholder="Search products" [(value)]="filters.search" (ngModelChange)="onSearch()">
            </app-input>
          </div>

          <div class="space-y-3">
            <p class="text-sm font-semibold text-slate-800">Categories</p>
            <div class="space-y-2 max-h-48 overflow-auto pr-1">
              <label
                *ngFor="let category of categories"
                class="flex items-center gap-2 text-sm text-slate-700"
              >
                <input
                  type="radio"
                  name="category"
                  class="h-4 w-4 rounded border-slate-300"
                  [value]="category.slug"
                  [(ngModel)]="filters.category_slug"
                  (change)="applyFilters()"
                />
                <span>{{ category.name }}</span>
              </label>
              <label class="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="category"
                  class="h-4 w-4 rounded border-slate-300"
                  value=""
                  [(ngModel)]="filters.category_slug"
                  (change)="applyFilters()"
                />
                <span>All categories</span>
              </label>
            </div>
          </div>

          <div class="space-y-3">
            <p class="text-sm font-semibold text-slate-800">Price range</p>
            <div class="grid gap-3">
              <div class="flex items-center gap-3">
                <input type="range" min="0" max="500" step="5" [(ngModel)]="filters.min_price" (change)="applyFilters()" aria-label="Minimum price" />
                <input type="range" min="0" max="500" step="5" [(ngModel)]="filters.max_price" (change)="applyFilters()" aria-label="Maximum price" />
              </div>
              <div class="grid grid-cols-2 gap-3">
                <app-input label="Min" type="number" [(value)]="filters.min_price" (ngModelChange)="applyFilters()">
                </app-input>
                <app-input label="Max" type="number" [(value)]="filters.max_price" (ngModelChange)="applyFilters()">
                </app-input>
              </div>
              <p class="text-xs text-slate-500">Adjust sliders or inputs to refine results.</p>
            </div>
          </div>

          <div class="space-y-3" *ngIf="allTags.size">
            <p class="text-sm font-semibold text-slate-800">Tags</p>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="rounded-full border px-3 py-1 text-xs font-medium transition"
                [ngClass]="filters.tags.has(tag) ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-700'"
                *ngFor="let tag of allTags"
                (click)="toggleTag(tag)"
              >
                {{ tag }}
              </button>
            </div>
          </div>
        </aside>

        <section class="grid gap-6">
          <div class="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <div class="flex items-center gap-3">
              <input
                class="w-64 max-w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
                placeholder="Search products..."
                [(ngModel)]="filters.search"
                (keyup.enter)="onSearch()"
              />
              <app-button label="Search" size="sm" (action)="onSearch()"></app-button>
            </div>
            <label class="flex items-center gap-2 text-sm text-slate-700">
              <span>Sort</span>
              <select
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                [(ngModel)]="filters.sort"
                (change)="applyFilters()"
              >
                <option *ngFor="let option of sortOptions" [value]="option.value">{{ option.label }}</option>
              </select>
            </label>
          </div>

          <div *ngIf="loading()" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-4">
            <app-skeleton *ngFor="let i of placeholders" height="260px"></app-skeleton>
          </div>

          <div
            *ngIf="hasError()"
            class="border border-amber-200 bg-amber-50 rounded-2xl p-6 text-center grid gap-3"
          >
            <p class="text-lg font-semibold text-amber-900">We hit a snag loading products.</p>
            <p class="text-sm text-amber-800">Check your connection or retry in a moment.</p>
            <div class="flex justify-center gap-3">
              <app-button label="Retry" size="sm" (action)="loadProducts()"></app-button>
              <app-button label="Reset filters" size="sm" variant="ghost" (action)="resetFilters()"></app-button>
            </div>
          </div>

          <div
            *ngIf="!loading() && !hasError() && products.length === 0"
            class="border border-dashed border-slate-200 rounded-2xl p-10 text-center grid gap-2"
          >
            <p class="text-lg font-semibold text-slate-900">No products found</p>
            <p class="text-sm text-slate-600">Try adjusting filters or search terms.</p>
            <div class="flex justify-center gap-3">
              <app-button label="Reset filters" size="sm" variant="ghost" (action)="resetFilters()"></app-button>
              <app-button label="Back to home" size="sm" variant="ghost" routerLink="/"></app-button>
            </div>
          </div>

          <div *ngIf="!loading() && products.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <app-product-card *ngFor="let product of products" [product]="product"></app-product-card>
          </div>

          <div *ngIf="meta" class="flex items-center justify-between text-sm text-slate-700">
            <div>
              Page {{ meta.page }} of {{ meta.total_pages }} · {{ meta.total_items }} items
            </div>
            <div class="flex gap-2">
              <app-button label="Prev" size="sm" variant="ghost" [disabled]="meta.page <= 1" (action)="changePage(-1)">
              </app-button>
              <app-button
                label="Next"
                size="sm"
                variant="ghost"
                [disabled]="meta.page >= meta.total_pages"
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
export class ShopComponent implements OnInit {
  products: Product[] = [];
  categories: Category[] = [];
  meta: PaginationMeta | null = null;
  allTags = new Set<string>();
  loading = signal<boolean>(true);
  hasError = signal<boolean>(false);
  placeholders = Array.from({ length: 6 });
  crumbs = [
    { label: 'Home', url: '/' },
    { label: 'Shop' }
  ];

  filters: {
    search: string;
    category_slug: string;
    min_price?: number | string;
    max_price?: number | string;
    tags: Set<string>;
    sort: SortOption;
    page: number;
    limit: number;
  } = {
    search: '',
    category_slug: '',
    tags: new Set<string>(),
    sort: 'newest',
    page: 1,
    limit: 12
  };

  sortOptions: { label: string; value: SortOption }[] = [
    { label: 'Newest', value: 'newest' },
    { label: 'Price: Low to High', value: 'price_asc' },
    { label: 'Price: High to Low', value: 'price_desc' },
    { label: 'Name: A → Z', value: 'name_asc' },
    { label: 'Name: Z → A', value: 'name_desc' }
  ];

  constructor(
    private catalog: CatalogService,
    private route: ActivatedRoute,
    private router: Router,
    private toast: ToastService,
    private title: Title,
    private metaService: Meta
  ) {}

  ngOnInit(): void {
    this.title.setTitle('Shop | AdrianaArt');
    this.metaService.updateTag({
      name: 'description',
      content: 'Browse categories, filter by price and tags, and find handcrafted ceramics on AdrianaArt.'
    });
    this.metaService.updateTag({ property: 'og:title', content: 'Shop handcrafted ceramics | AdrianaArt' });
    this.metaService.updateTag({
      property: 'og:description',
      content: 'Search and filter handcrafted ceramics by category, price, and tags.'
    });
    const dataCategories = (this.route.snapshot.data['categories'] as Category[]) ?? [];
    if (dataCategories.length) {
      this.categories = dataCategories;
    } else {
      this.fetchCategories();
    }
    this.route.queryParams.subscribe((params) => {
      this.syncFiltersFromQuery(params);
      this.loadProducts(false);
    });
  }

  fetchCategories(): void {
    this.catalog.listCategories().subscribe((data) => {
      this.categories = data;
    });
  }

  loadProducts(pushQuery = true): void {
    this.loading.set(true);
    this.hasError.set(false);
    if (pushQuery) {
      this.updateQueryParams();
    }
    this.catalog
      .listProducts({
        search: this.filters.search || undefined,
        category_slug: this.filters.category_slug || undefined,
        min_price: this.filters.min_price ? Number(this.filters.min_price) : undefined,
        max_price: this.filters.max_price ? Number(this.filters.max_price) : undefined,
        tags: Array.from(this.filters.tags),
        sort: this.filters.sort,
        page: this.filters.page,
        limit: this.filters.limit
      })
      .subscribe({
        next: (response) => {
          this.products = response.items;
          this.meta = response.meta;
          if (this.filters.category_slug) {
            const cat = this.categories.find((c) => c.slug === this.filters.category_slug);
            this.crumbs = [
              { label: 'Home', url: '/' },
              { label: 'Shop', url: '/shop' },
              { label: cat?.name ?? this.filters.category_slug }
            ];
          } else {
            this.crumbs = [
              { label: 'Home', url: '/' },
              { label: 'Shop' }
            ];
          }
          this.allTags = new Set(
            response.items
              .flatMap((p) => p.tags ?? [])
              .map((t) => ('name' in t ? t.name : String(t)))
          );
          this.loading.set(false);
          this.hasError.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.products = [];
          this.hasError.set(true);
          this.toast.error('Could not load products', 'Please try again.');
        }
      });
  }

  applyFilters(): void {
    this.filters.page = 1;
    this.loadProducts();
  }

  onSearch(): void {
    this.applyFilters();
  }

  changePage(delta: number): void {
    if (!this.meta) return;
    const nextPage = this.meta.page + delta;
    if (nextPage < 1 || nextPage > this.meta.total_pages) return;
    this.filters.page = nextPage;
    this.loadProducts();
  }

  toggleTag(tag: string): void {
    if (this.filters.tags.has(tag)) {
      this.filters.tags.delete(tag);
    } else {
      this.filters.tags.add(tag);
    }
    this.applyFilters();
  }

  resetFilters(): void {
    this.filters.search = '';
    this.filters.category_slug = '';
    this.filters.min_price = undefined;
    this.filters.max_price = undefined;
    this.filters.tags = new Set<string>();
    this.filters.sort = 'newest';
    this.filters.page = 1;
    this.loadProducts();
  }

  private updateQueryParams(): void {
    const params: Params = {
      q: this.filters.search || undefined,
      cat: this.filters.category_slug || undefined,
      min: this.filters.min_price || undefined,
      max: this.filters.max_price || undefined,
      sort: this.filters.sort !== 'newest' ? this.filters.sort : undefined,
      page: this.filters.page !== 1 ? this.filters.page : undefined,
      tags: this.filters.tags.size ? Array.from(this.filters.tags).join(',') : undefined
    };
    this.router.navigate([], { relativeTo: this.route, queryParams: params, queryParamsHandling: 'merge' });
  }

  private syncFiltersFromQuery(params: Params): void {
    this.filters.search = params['q'] ?? '';
    this.filters.category_slug = params['cat'] ?? '';
    this.filters.min_price = params['min'] ?? undefined;
    this.filters.max_price = params['max'] ?? undefined;
    this.filters.sort = (params['sort'] as SortOption) ?? 'newest';
    this.filters.page = params['page'] ? Number(params['page']) : 1;
    const tagParam = params['tags'];
    this.filters.tags = new Set<string>(
      typeof tagParam === 'string' && tagParam.length ? tagParam.split(',') : []
    );
  }
}
