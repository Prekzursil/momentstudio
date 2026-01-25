import { CommonModule, NgOptimizedImage, DOCUMENT } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { BackInStockRequest, CatalogService, Product, ProductVariant } from '../../core/catalog.service';
import { CartStore } from '../../core/cart.store';
import { RecentlyViewedService } from '../../core/recently-viewed.service';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { ToastService } from '../../core/toast.service';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ImgFallbackDirective } from '../../shared/img-fallback.directive';
import { Title, Meta } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { WishlistService } from '../../core/wishlist.service';
import { AuthService } from '../../core/auth.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    NgOptimizedImage,
    ContainerComponent,
    ButtonComponent,
    SkeletonComponent,
    LocalizedCurrencyPipe,
    BreadcrumbComponent,
    TranslateModule,
    ImgFallbackDirective
  ],
  template: `
    <app-container classes="py-10">
      <ng-container *ngIf="loading; else content">
        <div class="grid gap-6 lg:grid-cols-2">
          <app-skeleton height="420px"></app-skeleton>
          <div class="space-y-4">
            <app-skeleton height="32px"></app-skeleton>
            <app-skeleton height="24px"></app-skeleton>
            <app-skeleton height="18px" *ngFor="let i of [1, 2, 3]"></app-skeleton>
          </div>
        </div>
      </ng-container>

      <ng-template #content>
        <ng-container *ngIf="loadError; else maybeProduct">
          <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
          <div class="border border-dashed border-slate-200 rounded-2xl p-10 text-center dark:border-slate-800">
            <p class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'product.loadErrorTitle' | translate }}</p>
            <p class="mt-2 text-sm text-slate-600 dark:text-slate-300">{{ 'product.loadErrorCopy' | translate }}</p>
            <div class="mt-6 flex items-center justify-center gap-3">
              <app-button [label]="'product.retry' | translate" variant="ghost" (action)="retryLoad()"></app-button>
              <app-button [label]="'product.backToShop' | translate" variant="ghost" [routerLink]="['/shop']"></app-button>
            </div>
          </div>
        </ng-container>

        <ng-template #maybeProduct>
        <ng-container *ngIf="product; else missing">
          <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
          <div class="grid gap-10 lg:grid-cols-2">
            <div class="space-y-4">
              <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white cursor-zoom-in dark:border-slate-800 dark:bg-slate-900" (click)="openPreview()">
                <img
                  [ngSrc]="activeImage"
                  [alt]="product.name"
                  class="w-full object-cover"
                  width="960"
                  height="960"
                  loading="lazy"
                  decoding="async"
                  sizes="(min-width: 1024px) 480px, 100vw"
                  [appImgFallback]="'assets/placeholder/product-placeholder.svg'"
                />
              </div>
              <div class="flex gap-3">
                <button
                  *ngFor="let image of product.images ?? []; let idx = index"
                  class="h-20 w-20 rounded-xl border border-slate-200 dark:border-slate-700"
                  [ngClass]="idx === activeImageIndex ? 'border-slate-900 dark:border-slate-50' : ''"
                  type="button"
                  (click)="setActiveImage(idx)"
                >
                  <img
                    [ngSrc]="image.url"
                    [alt]="image.alt_text ?? product.name"
                    class="h-full w-full object-cover"
                    width="96"
                    height="96"
                    loading="lazy"
                    decoding="async"
                    [appImgFallback]="'assets/placeholder/product-placeholder.svg'"
                  />
                </button>
              </div>
            </div>

            <div class="space-y-5">
              <div class="space-y-2">
                <p class="text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">{{ 'product.handmade' | translate }}</p>
                <h1 class="text-3xl font-semibold text-slate-900 dark:text-slate-50">{{ product.name }}</h1>
                <div class="flex items-baseline gap-3">
                  <p class="text-lg font-semibold text-slate-900 dark:text-slate-50">
                    {{ displayPrice(product) | localizedCurrency : product.currency }}
                  </p>
                  <p
                    *ngIf="isOnSale(product)"
                    class="text-sm text-slate-500 line-through dark:text-slate-300"
                  >
                    {{ product.base_price | localizedCurrency : product.currency }}
                  </p>
                </div>
                <div class="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300" *ngIf="product.rating_count">
                  ★ {{ product.rating_average?.toFixed(1) ?? '0.0' }} ·
                  {{ 'product.reviews' | translate : { count: product.rating_count } }}
                </div>
              </div>

              <p class="text-sm text-slate-700 dark:text-slate-200 leading-relaxed" *ngIf="product.long_description">
                {{ product.long_description }}
              </p>

              <div class="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:border-amber-900/40 dark:text-amber-100">
                {{ 'product.uniqueness' | translate }}
              </div>

              <div class="space-y-3">
                <label *ngIf="product.variants?.length" class="grid gap-1 text-sm font-medium text-slate-800 dark:text-slate-200">
                  {{ 'product.variant' | translate }}
                  <select
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="selectedVariantId"
                  >
                    <option *ngFor="let variant of product.variants" [value]="variant.id">
                      {{ variant.name }} <span *ngIf="variant.stock_quantity !== null">({{ variant.stock_quantity }} left)</span>
                    </option>
                  </select>
                </label>

                <label class="grid gap-1 text-sm font-medium text-slate-800 dark:text-slate-200">
                  {{ 'product.quantity' | translate }}
                  <input
                    type="number"
                    min="1"
                    class="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [(ngModel)]="quantity"
                  />
                </label>
              </div>

              <div class="flex gap-3">
                <app-button
                  [label]="'product.addToCart' | translate"
                  size="lg"
                  (action)="addToCart()"
                  [disabled]="isOutOfStock()"
                ></app-button>
                <app-button
                  *ngIf="isOutOfStock()"
                  [label]="
                    backInStockRequest
                      ? ('product.notifyRequested' | translate)
                      : ('product.notifyBackInStock' | translate)
                  "
                  variant="ghost"
                  (action)="requestBackInStock()"
                  [disabled]="backInStockLoading || !!backInStockRequest"
                ></app-button>
                <app-button
                  *ngIf="isOutOfStock() && backInStockRequest"
                  [label]="'product.notifyCancel' | translate"
                  variant="ghost"
                  (action)="cancelBackInStock()"
                  [disabled]="backInStockLoading"
                ></app-button>
                <app-button [label]="'product.backToShop' | translate" variant="ghost" [routerLink]="['/shop']"></app-button>
                <app-button
                  [label]="wishlisted ? ('wishlist.saved' | translate) : ('wishlist.save' | translate)"
                  variant="ghost"
                  (action)="toggleWishlist()"
                >
                  <svg viewBox="0 0 24 24" class="mr-2 h-4 w-4" [attr.fill]="wishlisted ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"
                    />
                  </svg>
                </app-button>
              </div>

              <div class="flex flex-wrap gap-2" *ngIf="product.tags?.length">
                <span
                  *ngFor="let tag of product.tags"
                  class="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  {{ tag.name ?? tag }}
                </span>
	              </div>
	            </div>
	          </div>
		      <div *ngIf="upsellProducts.length" class="mt-12 grid gap-4">
		        <div class="flex items-center justify-between">
		          <h3 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'product.upsells' | translate }}</h3>
		          <a routerLink="/shop" class="text-sm font-medium text-indigo-600 dark:text-indigo-300">{{ 'product.backToShop' | translate }}</a>
		        </div>
		        <div class="flex gap-4 overflow-x-auto pb-2">
	          <app-button
	            *ngFor="let item of upsellProducts"
	            class="min-w-[220px]"
	            variant="ghost"
	            [routerLink]="['/products', item.slug]"
	          >
	            <div class="flex items-center gap-3 text-left">
	              <img
	                [ngSrc]="item.images?.[0]?.url ?? 'assets/placeholder/product-placeholder.svg'"
	                [alt]="item.name"
	                class="h-14 w-14 rounded-xl object-cover"
		                width="96"
		                height="96"
		                loading="lazy"
		                decoding="async"
		                [appImgFallback]="'assets/placeholder/product-placeholder.svg'"
		              />
	                <div class="grid gap-1">
	                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ item.name }}</p>
	                <p class="text-sm text-slate-600 dark:text-slate-300">
	                  {{ displayPrice(item) | localizedCurrency : item.currency }}
	                </p>
	              </div>
	            </div>
	          </app-button>
		        </div>
		      </div>

		      <div *ngIf="relatedProducts.length" class="mt-12 grid gap-4">
		        <div class="flex items-center justify-between">
		          <h3 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'product.relatedProducts' | translate }}</h3>
		          <a routerLink="/shop" class="text-sm font-medium text-indigo-600 dark:text-indigo-300">{{ 'product.backToShop' | translate }}</a>
		        </div>
		        <div class="flex gap-4 overflow-x-auto pb-2">
	          <app-button
	            *ngFor="let item of relatedProducts"
	            class="min-w-[220px]"
	            variant="ghost"
	            [routerLink]="['/products', item.slug]"
	          >
	            <div class="flex items-center gap-3 text-left">
	              <img
	                [ngSrc]="item.images?.[0]?.url ?? 'assets/placeholder/product-placeholder.svg'"
	                [alt]="item.name"
	                class="h-14 w-14 rounded-xl object-cover"
		                width="96"
		                height="96"
		                loading="lazy"
		                decoding="async"
		                [appImgFallback]="'assets/placeholder/product-placeholder.svg'"
		              />
	                <div class="grid gap-1">
	                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ item.name }}</p>
	                <p class="text-sm text-slate-600 dark:text-slate-300">
	                  {{ displayPrice(item) | localizedCurrency : item.currency }}
	                </p>
	              </div>
	            </div>
	          </app-button>
		        </div>
		      </div>

		      <div *ngIf="recentlyViewed.length" class="mt-12 grid gap-4">
		        <div class="flex items-center justify-between">
		          <h3 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'product.recentlyViewed' | translate }}</h3>
		          <a routerLink="/shop" class="text-sm font-medium text-indigo-600 dark:text-indigo-300">{{ 'product.backToShop' | translate }}</a>
	        </div>
	        <div class="flex gap-4 overflow-x-auto pb-2">
          <app-button
            *ngFor="let item of recentlyViewed"
            class="min-w-[220px]"
            variant="ghost"
            [routerLink]="['/products', item.slug]"
          >
            <div class="flex items-center gap-3 text-left">
              <img
                [ngSrc]="item.images?.[0]?.url ?? 'assets/placeholder/product-placeholder.svg'"
                [alt]="item.name"
                class="h-14 w-14 rounded-xl object-cover"
	                width="96"
	                height="96"
	                loading="lazy"
	                decoding="async"
	                [appImgFallback]="'assets/placeholder/product-placeholder.svg'"
	              />
                <div class="grid gap-1">
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ item.name }}</p>
                <p class="text-sm text-slate-600 dark:text-slate-300">
                  {{ item.base_price | localizedCurrency : item.currency }}
                </p>
              </div>
            </div>
          </app-button>
	        </div>
	      </div>
	
	      <div
	        *ngIf="previewOpen"
        class="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
        (click)="closePreview()"
      >
        <div class="relative max-w-5xl w-full" (click)="$event.stopPropagation()">
          <button
            class="absolute -top-10 right-0 text-white text-sm font-semibold underline"
            type="button"
            (click)="closePreview()"
          >
            Close
          </button>
          <img
            [ngSrc]="activeImage"
            [alt]="product?.name"
            class="w-full max-h-[80vh] object-contain rounded-2xl shadow-2xl"
            width="1600"
            height="1200"
	            loading="lazy"
	            decoding="async"
	            sizes="(min-width: 1024px) 960px, 100vw"
	            [appImgFallback]="'assets/placeholder/product-placeholder.svg'"
	          />
	        </div>
	      </div>

	      </ng-container>
	
	      <ng-template #missing>
	        <div class="border border-dashed border-slate-200 rounded-2xl p-10 text-center dark:border-slate-800">
	          <p class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'product.notFound' | translate }}</p>
	          <a routerLink="/shop" class="text-indigo-600 dark:text-indigo-300 font-medium">{{ 'product.backToShop' | translate }}</a>
        </div>
      </ng-template>
      </ng-template>
      </ng-template>
    </app-container>
  `
})
export class ProductComponent implements OnInit, OnDestroy {
  product: Product | null = null;
  loading = true;
  loadError = false;
  selectedVariantId: string | null = null;
  quantity = 1;
  activeImageIndex = 0;
  previewOpen = false;
  backInStockLoading = false;
  backInStockRequest: BackInStockRequest | null = null;
  upsellProducts: Product[] = [];
  relatedProducts: Product[] = [];
  recentlyViewed: Product[] = [];
  private ldScript?: HTMLScriptElement;
  private langSub?: Subscription;
  private routeSub?: Subscription;
  private productLoadSub?: Subscription;
  private upsellsLoadSub?: Subscription;
  private relatedLoadSub?: Subscription;
  private canonicalEl?: HTMLLinkElement;
  private document: Document = inject(DOCUMENT);
  private slug: string | null = null;
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.shop', url: '/shop' }
  ];

  constructor(
    private route: ActivatedRoute,
    private catalog: CatalogService,
    private toast: ToastService,
    private title: Title,
    private meta: Meta,
    private cartStore: CartStore,
    private recentlyViewedService: RecentlyViewedService,
    private translate: TranslateService,
    private wishlist: WishlistService,
    private auth: AuthService,
    private router: Router
  ) {}

  ngOnDestroy(): void {
    if (this.ldScript && typeof document !== 'undefined') {
      this.ldScript.remove();
    }
    this.langSub?.unsubscribe();
    this.routeSub?.unsubscribe();
    this.productLoadSub?.unsubscribe();
    this.upsellsLoadSub?.unsubscribe();
    this.relatedLoadSub?.unsubscribe();
  }

  ngOnInit(): void {
    this.wishlist.ensureLoaded();
    this.routeSub = this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug');
      if (slug === this.slug) {
        return;
      }
      this.slug = slug;
      this.activeImageIndex = 0;
      this.previewOpen = false;
      this.load();
    });
    this.langSub = this.translate.onLangChange.subscribe(() => {
      if (this.product) {
        this.updateMeta(this.product);
      }
    });
  }

  retryLoad(): void {
    this.load();
  }

  private load(): void {
    this.loading = true;
    this.loadError = false;
    this.product = null;
    this.backInStockRequest = null;
    this.upsellProducts = [];
    this.relatedProducts = [];
    const slug = this.slug;
    this.productLoadSub?.unsubscribe();
    this.productLoadSub = undefined;
    this.upsellsLoadSub?.unsubscribe();
    this.upsellsLoadSub = undefined;
    this.relatedLoadSub?.unsubscribe();
    this.relatedLoadSub = undefined;
    if (!slug) {
      this.loading = false;
      return;
    }
    this.productLoadSub = this.catalog.getProduct(slug).subscribe({
      next: (product) => {
        if (this.slug !== slug) return;
        this.product = product;
        this.selectedVariantId = product.variants?.[0]?.id ?? null;
        this.loading = false;
        this.loadError = false;
        this.crumbs = [
          { label: 'nav.home', url: '/' },
          { label: 'nav.shop', url: '/shop' },
          { label: product.name, url: `/products/${product.slug}` }
        ];
        this.updateMeta(product);
        this.updateStructuredData(product);
        const updated = this.recentlyViewedService.add(product);
        this.recentlyViewed = updated.filter((p) => p.slug !== product.slug).slice(0, 8);
        this.loadBackInStockStatus();
        this.loadUpsells(product.slug);
        this.loadRelated(product.slug);
      },
      error: (err) => {
        if (this.slug !== slug) return;
        this.product = null;
        this.loading = false;
        const status = typeof err?.status === 'number' ? err.status : 0;
        this.loadError = status !== 404;
      }
    });
  }

  private loadUpsells(slug: string): void {
    this.upsellsLoadSub?.unsubscribe();
    this.upsellsLoadSub = this.catalog.getUpsellProducts(slug).subscribe({
      next: (items) => {
        if (!this.product || this.product.slug !== slug) return;
        this.upsellProducts = (items || []).filter((p) => p.slug !== slug).slice(0, 8);
      },
      error: () => {
        if (!this.product || this.product.slug !== slug) return;
        this.upsellProducts = [];
      }
    });
  }

  private loadRelated(slug: string): void {
    this.relatedLoadSub?.unsubscribe();
    this.relatedLoadSub = this.catalog.getRelatedProducts(slug).subscribe({
      next: (items) => {
        if (!this.product || this.product.slug !== slug) return;
        this.relatedProducts = (items || []).filter((p) => p.slug !== slug).slice(0, 8);
      },
      error: () => {
        if (!this.product || this.product.slug !== slug) return;
        this.relatedProducts = [];
      }
    });
  }

  get activeImage(): string {
    if (!this.product || !this.product.images?.length) {
      return 'assets/placeholder/product-placeholder.svg';
    }
    return this.product.images[this.activeImageIndex]?.url ?? this.product.images[0].url;
  }

  setActiveImage(index: number): void {
    this.activeImageIndex = index;
  }

  openPreview(): void {
    this.previewOpen = true;
  }

  closePreview(): void {
    this.previewOpen = false;
  }

  addToCart(): void {
    if (!this.product) return;
    if (this.isOutOfStock()) {
      this.toast.error(this.translate.instant('product.soldOut'), this.translate.instant('product.notifyBackInStock'));
      return;
    }
    const variant = this.selectedVariant(this.product);
    this.cartStore.addFromProduct({
      product_id: this.product.id,
      variant_id: variant?.id ?? null,
      quantity: this.quantity,
      name: this.product.name,
      slug: this.product.slug,
      image: this.product.images?.[0]?.url,
      price: Number(this.displayPrice(this.product)),
      currency: this.product.currency,
      stock: (variant?.stock_quantity ?? this.product.stock_quantity ?? 99) || 0
    });
    this.toast.success(
      this.translate.instant('product.addedTitle'),
      this.translate.instant('product.addedBody', { qty: this.quantity, name: this.product.name })
    );
  }

  get wishlisted(): boolean {
    return this.product ? this.wishlist.isWishlisted(this.product.id) : false;
  }

  toggleWishlist(): void {
    if (!this.product) return;
    if (!this.auth.isAuthenticated()) {
      this.toast.info(this.translate.instant('wishlist.signInTitle'), this.translate.instant('wishlist.signInBody'));
      void this.router.navigateByUrl('/login');
      return;
    }

    if (this.wishlisted) {
      this.wishlist.remove(this.product.id).subscribe({
        next: () => {
          this.wishlist.removeLocal(this.product!.id);
          this.toast.success(
            this.translate.instant('wishlist.removedTitle'),
            this.translate.instant('wishlist.removedBody', { name: this.product!.name })
          );
        }
      });
      return;
    }

    this.wishlist.add(this.product.id).subscribe({
      next: (product) => {
        this.wishlist.addLocal(product);
        this.toast.success(
          this.translate.instant('wishlist.addedTitle'),
          this.translate.instant('wishlist.addedBody', { name: this.product!.name })
        );
      }
    });
  }

  private updateMeta(product: Product): void {
    const title = this.translate.instant('product.metaTitle', { name: product.name });
    const description =
      product.short_description ?? this.translate.instant('product.metaDescriptionFallback', { name: product.name });
    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({
      property: 'og:description',
      content: description
    });
    if (product.images?.[0]?.url) {
      this.meta.updateTag({ property: 'og:image', content: product.images[0].url });
    }
    this.meta.updateTag({ property: 'og:type', content: 'product' });
    this.setCanonical(product);
  }

  private updateStructuredData(product: Product): void {
    if (typeof document === 'undefined') return;
    if (this.ldScript) {
      this.ldScript.remove();
    }
    const availability =
      (product.stock_quantity ?? 0) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
    const productLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      description: product.short_description ?? product.long_description ?? undefined,
      image: product.images?.map((i) => i.url).filter(Boolean),
      sku: product.id,
      offers: {
        '@type': 'Offer',
        price: this.displayPrice(product),
        priceCurrency: product.currency,
        availability
      },
      aggregateRating:
        product.rating_count && product.rating_count > 0
          ? {
              '@type': 'AggregateRating',
              ratingValue: product.rating_average ?? 0,
              reviewCount: product.rating_count
            }
          : undefined
    };
    const breadcrumbLd = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${window.location.origin}/` },
        { '@type': 'ListItem', position: 2, name: 'Shop', item: `${window.location.origin}/shop` },
        { '@type': 'ListItem', position: 3, name: product.name, item: `${window.location.href}` }
      ]
    };
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.text = JSON.stringify([productLd, breadcrumbLd]);
    document.head.appendChild(script);
    this.ldScript = script;
  }

  private setCanonical(product: Product): void {
    if (typeof window === 'undefined' || !this.document) return;
    const lang = this.translate.currentLang || this.translate.getDefaultLang() || 'en';
    const href = `${window.location.origin}/products/${product.slug}?lang=${lang}`;
    let link: HTMLLinkElement | null = this.document.querySelector('link[rel="canonical"]');
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.document.head.appendChild(link);
    }
    link.setAttribute('href', href);
    this.canonicalEl = link;
  }

  isOutOfStock(): boolean {
    const product = this.product;
    if (!product) return false;
    const variant = this.selectedVariant(product);
    const stock = variant?.stock_quantity ?? product.stock_quantity ?? 0;
    const allowBackorder = !!product.allow_backorder;
    if (variant && variant.stock_quantity == null) return false;
    return stock <= 0 && !allowBackorder;
  }

  private selectedVariant(product: Product): ProductVariant | null {
    const variants = product.variants ?? [];
    if (!variants.length) return null;
    const desired = this.selectedVariantId;
    return variants.find((v) => v.id === desired) ?? variants[0] ?? null;
  }

  isOnSale(product: Product): boolean {
    const sale = product?.sale_price;
    return typeof sale === 'number' && Number.isFinite(sale) && sale < product.base_price;
  }

  displayPrice(product: Product): number {
    return this.isOnSale(product) ? Number(product.sale_price) : product.base_price;
  }

  private loadBackInStockStatus(): void {
    const product = this.product;
    if (!product || !this.isOutOfStock()) return;
    if (!this.auth.isAuthenticated()) return;
    this.catalog.getBackInStockStatus(product.slug).subscribe({
      next: (status) => {
        this.backInStockRequest = status.request ?? null;
      }
    });
  }

  requestBackInStock(): void {
    const product = this.product;
    if (!product || !this.isOutOfStock()) return;
    if (!this.auth.isAuthenticated()) {
      this.toast.info(
        this.translate.instant('product.notifyRequiresSignInTitle'),
        this.translate.instant('product.notifyRequiresSignInBody')
      );
      void this.router.navigateByUrl('/login');
      return;
    }
    if (this.backInStockRequest) return;
    this.backInStockLoading = true;
    this.catalog.requestBackInStock(product.slug).subscribe({
      next: (req) => {
        this.backInStockLoading = false;
        this.backInStockRequest = req;
        this.toast.success(
          this.translate.instant('product.notifyRequestedTitle'),
          this.translate.instant('product.notifyRequestedBody', { name: product.name })
        );
      },
      error: () => {
        this.backInStockLoading = false;
        this.toast.error(this.translate.instant('product.loadErrorTitle'), this.translate.instant('product.loadErrorCopy'));
      }
    });
  }

  cancelBackInStock(): void {
    const product = this.product;
    if (!product || !this.backInStockRequest) return;
    this.backInStockLoading = true;
    this.catalog.cancelBackInStock(product.slug).subscribe({
      next: () => {
        this.backInStockLoading = false;
        this.backInStockRequest = null;
        this.toast.success(
          this.translate.instant('product.notifyCanceledTitle'),
          this.translate.instant('product.notifyCanceledBody', { name: product.name })
        );
      },
      error: () => {
        this.backInStockLoading = false;
        this.toast.error(this.translate.instant('product.loadErrorTitle'), this.translate.instant('product.loadErrorCopy'));
      }
    });
  }

}
