import { CommonModule, NgOptimizedImage, DOCUMENT } from '@angular/common';
import { Component, OnDestroy, OnInit, Inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogService, Product } from '../../core/catalog.service';
import { CartStore } from '../../core/cart.store';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { ToastService } from '../../core/toast.service';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { Title, Meta } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

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
    TranslateModule
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
        <ng-container *ngIf="product; else missing">
          <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
          <div class="grid gap-10 lg:grid-cols-2">
            <div class="space-y-4">
              <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white cursor-zoom-in" (click)="openPreview()">
                <img
                  [ngSrc]="activeImage"
                  [alt]="product.name"
                  class="w-full object-cover"
                  width="960"
                  height="960"
                  loading="lazy"
                  decoding="async"
                  sizes="(min-width: 1024px) 480px, 100vw"
                />
              </div>
              <div class="flex gap-3">
                <button
                  *ngFor="let image of product.images ?? []; let idx = index"
                  class="h-20 w-20 rounded-xl border"
                  [ngClass]="idx === activeImageIndex ? 'border-slate-900' : 'border-slate-200'"
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
                  />
                </button>
              </div>
            </div>

            <div class="space-y-5">
              <div class="space-y-2">
                <p class="text-xs uppercase tracking-[0.3em] text-slate-500">{{ 'product.handmade' | translate }}</p>
                <h1 class="text-3xl font-semibold text-slate-900">{{ product.name }}</h1>
              <p class="text-lg font-semibold text-slate-900">
                  {{ product.base_price | localizedCurrency : product.currency }}
                </p>
                <div class="flex items-center gap-2 text-sm text-amber-700" *ngIf="product.rating_count">
                  ★ {{ product.rating_average?.toFixed(1) ?? '0.0' }} ·
                  {{ 'product.reviews' | translate : { count: product.rating_count } }}
                </div>
              </div>

              <p class="text-sm text-slate-700 leading-relaxed" *ngIf="product.long_description">
                {{ product.long_description }}
              </p>

              <div class="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
                {{ 'product.uniqueness' | translate }}
              </div>

              <div class="space-y-3">
                <label *ngIf="product.variants?.length" class="grid gap-1 text-sm font-medium text-slate-800">
                  {{ 'product.variant' | translate }}
                  <select
                    class="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    [(ngModel)]="selectedVariantId"
                  >
                    <option *ngFor="let variant of product.variants" [value]="variant.id">
                      {{ variant.name }} <span *ngIf="variant.stock_quantity !== null">({{ variant.stock_quantity }} left)</span>
                    </option>
                  </select>
                </label>

                <label class="grid gap-1 text-sm font-medium text-slate-800">
                  {{ 'product.quantity' | translate }}
                  <input
                    type="number"
                    min="1"
                    class="w-24 rounded-lg border border-slate-200 px-3 py-2"
                    [(ngModel)]="quantity"
                  />
                </label>
              </div>

              <div class="flex gap-3">
                <app-button [label]="'product.addToCart' | translate" size="lg" (action)="addToCart()"></app-button>
                <app-button [label]="'product.backToShop' | translate" variant="ghost" [routerLink]="['/shop']"></app-button>
              </div>

              <div class="flex flex-wrap gap-2" *ngIf="product.tags?.length">
                <span
                  *ngFor="let tag of product.tags"
                  class="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                >
                  {{ tag.name ?? tag }}
                </span>
              </div>
            </div>
          </div>
        </ng-container>
      </ng-template>

      <div *ngIf="recentlyViewed.length" class="mt-12 grid gap-4">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-slate-900">{{ 'product.recentlyViewed' | translate }}</h3>
          <a routerLink="/shop" class="text-sm font-medium text-indigo-600">{{ 'product.backToShop' | translate }}</a>
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
                [ngSrc]="item.images?.[0]?.url ?? 'https://via.placeholder.com/96'"
                [alt]="item.name"
                class="h-14 w-14 rounded-xl object-cover"
                width="96"
                height="96"
                loading="lazy"
                decoding="async"
              />
              <div class="grid gap-1">
                <p class="text-sm font-semibold text-slate-900">{{ item.name }}</p>
                <p class="text-sm text-slate-600">
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
          />
        </div>
      </div>

      <ng-template #missing>
        <div class="border border-dashed border-slate-200 rounded-2xl p-10 text-center">
          <p class="text-lg font-semibold text-slate-900">{{ 'product.notFound' | translate }}</p>
          <a routerLink="/shop" class="text-indigo-600 font-medium">{{ 'product.backToShop' | translate }}</a>
        </div>
      </ng-template>
    </app-container>
  `
})
export class ProductComponent implements OnInit, OnDestroy {
  product: Product | null = null;
  loading = true;
  selectedVariantId: string | null = null;
  quantity = 1;
  activeImageIndex = 0;
  previewOpen = false;
  recentlyViewed: Product[] = [];
  private ldScript?: HTMLScriptElement;
  private langSub?: Subscription;
  private canonicalEl?: HTMLLinkElement;
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
    private translate: TranslateService,
    @Inject(DOCUMENT) private document: Document
  ) {}

  ngOnDestroy(): void {
    if (this.ldScript && typeof document !== 'undefined') {
      this.ldScript.remove();
    }
    this.langSub?.unsubscribe();
  }

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    this.langSub = this.translate.onLangChange.subscribe(() => {
      if (this.product) {
        this.updateMeta(this.product);
      }
    });
    if (slug) {
      this.catalog.getProduct(slug).subscribe({
        next: (product) => {
          this.product = product;
          this.selectedVariantId = product.variants?.[0]?.id ?? null;
          this.loading = false;
          this.crumbs = [
            { label: 'nav.home', url: '/' },
            { label: 'nav.shop', url: '/shop' },
            { label: product.name, url: `/products/${product.slug}` }
          ];
          this.updateMeta(product);
          this.updateStructuredData(product);
          this.saveRecentlyViewed(product);
          this.recentlyViewed = this.getRecentlyViewed().filter((p) => p.slug !== product.slug).slice(0, 8);
        },
        error: () => {
          this.product = null;
          this.loading = false;
        }
      });
    } else {
      this.loading = false;
    }
  }

  get activeImage(): string {
    if (!this.product || !this.product.images?.length) {
      return 'https://via.placeholder.com/960x960?text=Product';
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
    this.cartStore.addFromProduct({
      product_id: this.product.id,
      variant_id: null,
      quantity: this.quantity,
      name: this.product.name,
      slug: this.product.slug,
      image: this.product.images?.[0]?.url,
      price: Number(this.product.base_price),
      currency: this.product.currency,
      stock: this.product.stock_quantity ?? 99
    });
    this.toast.success(
      this.translate.instant('product.addedTitle'),
      this.translate.instant('product.addedBody', { qty: this.quantity, name: this.product.name })
    );
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
        price: product.base_price,
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
    let link: HTMLLinkElement | null = this.document.querySelector('link[rel=\"canonical\"]');
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.document.head.appendChild(link);
    }
    link.setAttribute('href', href);
    this.canonicalEl = link;
  }

  private saveRecentlyViewed(product: Product): void {
    if (typeof localStorage === 'undefined') return;
    const key = 'recently_viewed';
    const existing: Product[] = this.getRecentlyViewed();
    const filtered = existing.filter((p) => p.slug !== product.slug);
    filtered.unshift({
      id: product.id,
      slug: product.slug,
      name: product.name,
      base_price: product.base_price,
      currency: product.currency,
      images: product.images
    });
    localStorage.setItem(key, JSON.stringify(filtered.slice(0, 12)));
  }

  private getRecentlyViewed(): Product[] {
    if (typeof localStorage === 'undefined') return [];
    const key = 'recently_viewed';
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as Product[]) : [];
    } catch {
      return [];
    }
  }
}
