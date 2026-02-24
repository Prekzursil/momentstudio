import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { CatalogService, Product, ProductVariant } from '../core/catalog.service';
import { CartStore } from '../core/cart.store';
import { ToastService } from '../core/toast.service';
import { ImgFallbackDirective } from './img-fallback.directive';
import { LocalizedCurrencyPipe } from './localized-currency.pipe';
import { ModalComponent } from './modal.component';
import { SkeletonComponent } from './skeleton.component';

@Component({
  selector: 'app-product-quick-view-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
    ModalComponent,
    SkeletonComponent,
    LocalizedCurrencyPipe,
    ImgFallbackDirective
  ],
  template: `
    <app-modal
      [open]="open"
      [title]="title()"
      [closeLabel]="'legal.modal.close' | translate"
      [showActions]="false"
      (closed)="handleClosed()"
    >
      <div *ngIf="loading" class="grid gap-4">
        <app-skeleton height="260px"></app-skeleton>
        <div class="grid gap-2">
          <app-skeleton height="20px" width="70%"></app-skeleton>
          <app-skeleton height="16px" width="40%"></app-skeleton>
          <app-skeleton height="14px" width="95%"></app-skeleton>
          <app-skeleton height="14px" width="85%"></app-skeleton>
        </div>
      </div>

      <div *ngIf="!loading && error" class="grid gap-3">
        <p class="text-sm text-amber-800 dark:text-amber-200">{{ error }}</p>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-white"
            (click)="retry()"
          >
            {{ 'product.retry' | translate }}
          </button>
        </div>
      </div>

      <div *ngIf="!loading && !error && product" class="grid gap-5">
        <div class="grid gap-4 sm:grid-cols-2 sm:items-start">
          <div class="grid gap-3">
            <div class="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800">
              <img
                [src]="activeImageUrl()"
                [alt]="product.name"
                class="aspect-square w-full object-cover"
                loading="lazy"
                [appImgFallback]="'assets/placeholder/product-placeholder.svg'"
              />
            </div>
            <div *ngIf="(product.images?.length ?? 0) > 1" class="flex gap-2 overflow-x-auto pb-1">
              <button
                *ngFor="let img of product.images ?? []; let idx = index"
                type="button"
                class="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800"
                [class.border-slate-900]="idx === activeImageIndex"
                [class.dark\\:border-slate-50]="idx === activeImageIndex"
                (click)="setActiveImage(idx)"
                [attr.aria-label]="product.name + ' image ' + (idx + 1)"
              >
                <img
                  [src]="img.url"
                  [alt]="img.alt_text || product.name"
                  class="h-full w-full object-cover"
                  loading="lazy"
                  [appImgFallback]="'assets/placeholder/product-placeholder.svg'"
                />
              </button>
            </div>
          </div>

          <div class="grid gap-4">
            <div class="grid gap-1">
              <p class="text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">{{ 'product.handmade' | translate }}</p>
              <h2 class="text-xl font-semibold text-slate-900 dark:text-slate-50">{{ product.name }}</h2>
              <div class="flex items-baseline gap-3">
                <p class="text-lg font-semibold text-slate-900 dark:text-slate-50">
                  {{ displayPrice(product) | localizedCurrency : product.currency }}
                </p>
                <p *ngIf="isOnSale(product)" class="text-sm text-slate-500 line-through dark:text-slate-300">
                  {{ product.base_price | localizedCurrency : product.currency }}
                </p>
              </div>
              <p *ngIf="product.short_description" class="text-sm text-slate-700 dark:text-slate-200">
                {{ product.short_description }}
              </p>
            </div>

            <label *ngIf="product.variants?.length" class="grid gap-1 text-sm font-medium text-slate-800 dark:text-slate-200">
              {{ 'product.variant' | translate }}
              <select
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="selectedVariantId"
              >
                <option *ngFor="let variant of product.variants" [value]="variant.id">
                  {{ variant.name }}
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

            <p *ngIf="isOutOfStock()" class="text-sm font-semibold text-rose-700 dark:text-rose-300">
              {{ 'product.soldOut' | translate }}
            </p>

            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-white"
                [disabled]="isOutOfStock()"
                (click)="addToCart()"
              >
                {{ 'product.addToCart' | translate }}
              </button>
              <button
                type="button"
                class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:hover:border-slate-500 dark:hover:bg-slate-800"
                (click)="viewDetails()"
              >
                {{ 'product.viewDetails' | translate }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </app-modal>
  `
})
export class ProductQuickViewModalComponent implements OnChanges {
  @Input() open = false;
  @Input() slug = '';
  @Output() closed = new EventEmitter<void>();
  @Output() view = new EventEmitter<string>();

  loading = false;
  error = '';
  product: Product | null = null;
  activeImageIndex = 0;
  selectedVariantId: string | null = null;
  quantity = 1;

  private loadSub?: Subscription;

  constructor(
    private readonly catalog: CatalogService,
    private readonly cart: CartStore,
    private readonly toast: ToastService,
    private readonly translate: TranslateService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!('open' in changes) && !('slug' in changes)) return;
    if (!this.open) {
      this.reset();
      return;
    }
    this.load();
  }

  title(): string {
    return this.product?.name || this.translate.instant('shop.quickView');
  }

  retry(): void {
    if (!this.open) return;
    this.load();
  }

  setActiveImage(index: number): void {
    this.activeImageIndex = index;
  }

  activeImageUrl(): string {
    const images = this.product?.images ?? [];
    const idx = Math.max(0, Math.min(images.length - 1, this.activeImageIndex));
    return images[idx]?.url ?? 'assets/placeholder/product-placeholder.svg';
  }

  isOnSale(product: Product): boolean {
    const sale = product?.sale_price;
    return typeof sale === 'number' && Number.isFinite(sale) && sale < product.base_price;
  }

  displayPrice(product: Product): number {
    return this.isOnSale(product) ? Number(product.sale_price) : product.base_price;
  }

  private selectedVariant(product: Product): ProductVariant | null {
    const variants = product.variants ?? [];
    if (!variants.length) return null;
    const desired = this.selectedVariantId;
    return variants.find((v) => v.id === desired) ?? variants[0] ?? null;
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

  addToCart(): void {
    const product = this.product;
    if (!product) return;
    if (this.isOutOfStock()) return;

    const qty = Math.max(1, Number(this.quantity) || 1);
    const variant = this.selectedVariant(product);
    const variantId = variant?.id ?? null;
    const stock = variant?.stock_quantity ?? product.stock_quantity ?? 99;
    const imageUrl = product.images?.[0]?.url ?? 'assets/placeholder/product-placeholder.svg';

    this.cart.addFromProduct({
      product_id: product.id,
      variant_id: variantId,
      quantity: qty,
      name: product.name,
      slug: product.slug,
      image: imageUrl,
      price: this.displayPrice(product),
      currency: product.currency,
      stock: typeof stock === 'number' && Number.isFinite(stock) ? stock : 99
    });

    this.toast.success(
      this.translate.instant('product.addedTitle'),
      this.translate.instant('product.addedBody', { qty, name: product.name })
    );
  }

  viewDetails(): void {
    const slug = (this.product?.slug || this.slug || '').trim();
    if (!slug) return;
    this.view.emit(slug);
    this.handleClosed();
  }

  handleClosed(): void {
    this.closed.emit();
    this.reset();
  }

  private load(): void {
    const slug = (this.slug || '').trim();
    if (!slug) {
      this.loading = false;
      this.error = this.translate.instant('product.notFound');
      this.product = null;
      this.cdr.detectChanges();
      return;
    }

    this.loadSub?.unsubscribe();
    this.loading = true;
    this.error = '';
    this.product = null;
    this.activeImageIndex = 0;
    this.selectedVariantId = null;
    this.quantity = 1;
    this.cdr.detectChanges();

    this.loadSub = this.catalog.getProduct(slug).subscribe({
      next: (product) => {
        this.loading = false;
        this.error = '';
        if (Array.isArray(product.images)) {
          product.images = [...product.images].sort(
            (a: any, b: any) => Number(a?.sort_order ?? 0) - Number(b?.sort_order ?? 0)
          );
        }
        this.product = product;
        this.activeImageIndex = 0;
        const firstVariant = product?.variants?.[0];
        this.selectedVariantId = firstVariant?.id ?? null;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loading = false;
        this.product = null;
        this.error = this.translate.instant('product.loadErrorCopy');
        this.cdr.detectChanges();
      }
    });
  }

  private reset(): void {
    this.loadSub?.unsubscribe();
    this.loadSub = undefined;
    this.loading = false;
    this.error = '';
    this.product = null;
    this.activeImageIndex = 0;
    this.selectedVariantId = null;
    this.quantity = 1;
    this.cdr.detectChanges();
  }
}

