import { CommonModule, NgOptimizedImage } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Product } from '../core/catalog.service';
import { ButtonComponent } from './button.component';
import { LocalizedCurrencyPipe } from './localized-currency.pipe';
import { ImgFallbackDirective } from './img-fallback.directive';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { WishlistService } from '../core/wishlist.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { Router } from '@angular/router';
import { StorefrontAdminModeService } from '../core/storefront-admin-mode.service';
import { AdminService } from '../core/admin.service';

@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [CommonModule, RouterLink, NgOptimizedImage, LocalizedCurrencyPipe, ButtonComponent, TranslateModule, ImgFallbackDirective],
  template: `
    <article class="group grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm hover:-translate-y-1 hover:shadow-md transition dark:bg-slate-900 dark:border-slate-800 dark:shadow-none">
      <div class="block overflow-hidden rounded-xl bg-slate-50 relative dark:bg-slate-800">
        <a [routerLink]="['/products', product.slug]" class="block" (click)="rememberShopReturnContext($event)">
          <img
            [ngSrc]="primaryImage"
            [alt]="product.name"
            class="aspect-square w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            width="640"
            height="640"
            loading="lazy"
            decoding="async"
            sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
            [appImgFallback]="'assets/placeholder/product-placeholder.svg'"
          />
        </a>
        <button
          type="button"
          class="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white/90 text-slate-700 shadow-sm transition hover:bg-white dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-100"
          [class.border-rose-200]="wishlisted"
          [class.text-rose-600]="wishlisted"
          [attr.aria-label]="wishlisted ? ('wishlist.remove' | translate) : ('wishlist.add' | translate)"
          [attr.aria-pressed]="wishlisted"
          (click)="toggleWishlist($event)"
        >
          <svg viewBox="0 0 24 24" class="h-5 w-5" [attr.fill]="wishlisted ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"
            />
          </svg>
        </button>
        <span
          *ngIf="badge"
          class="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-800 shadow dark:bg-slate-900/90 dark:text-slate-100"
        >
          {{ badge }}
        </span>
	        <button
	          *ngIf="showStorefrontEdit()"
	          type="button"
	          class="absolute left-3 bottom-3 rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-xs font-semibold text-slate-800 shadow-sm transition hover:bg-white dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-100"
	          (click)="openAdminEdit($event)"
	        >
	          {{ 'adminUi.common.edit' | translate }}
	        </button>
	        <select
	          *ngIf="showStorefrontEdit()"
	          class="absolute right-3 bottom-3 h-8 rounded-full border border-slate-200 bg-white/90 px-3 text-xs font-semibold text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-100"
	          [disabled]="statusSaving"
	          [value]="product.status ?? 'published'"
	          (change)="onStatusChange($event)"
	        >
	          <option value="draft">{{ 'adminUi.status.draft' | translate }}</option>
	          <option value="published">{{ 'adminUi.status.published' | translate }}</option>
	          <option value="archived">{{ 'adminUi.status.archived' | translate }}</option>
	    </select>
	      </div>
      <div class="grid gap-1">
        <div class="flex items-center justify-between gap-2">
          <a
            [routerLink]="['/products', product.slug]"
            class="font-semibold text-slate-900 line-clamp-1 dark:text-slate-50"
            (click)="rememberShopReturnContext($event)"
          >
            {{ product.name }}
          </a>
          <span class="text-sm text-slate-500 dark:text-slate-300">{{ product.currency }}</span>
        </div>
        <div class="flex items-baseline gap-2">
          <p class="text-lg font-semibold text-slate-900 dark:text-slate-50">
            {{ displayPrice | localizedCurrency : product.currency }}
          </p>
          <p
            *ngIf="isOnSale"
            class="text-sm text-slate-500 line-through dark:text-slate-300"
          >
            {{ product.base_price | localizedCurrency : product.currency }}
          </p>
        </div>
        <p *ngIf="product.short_description" class="text-sm text-slate-600 line-clamp-2 dark:text-slate-300">
          {{ product.short_description }}
        </p>
	        <div class="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400" *ngIf="product.rating_count">
	          ★ {{ product.rating_average?.toFixed(1) ?? '0.0' }} ·
	          {{ 'product.reviews' | translate : { count: product.rating_count } }}
	        </div>
	      </div>
	      <div
	        *ngIf="showStorefrontEdit()"
	        class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/40"
	        (click)="$event.stopPropagation()"
	      >
	        <div class="grid grid-cols-2 gap-2">
	          <label class="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
	            <span>{{ 'adminUi.products.table.price' | translate }}</span>
	            <input
	              type="number"
	              inputmode="decimal"
	              step="0.01"
	              min="0"
	              class="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
	              [disabled]="inlineSaving"
	              [value]="inlinePrice"
	              (input)="inlinePrice = $any($event.target).value"
	            />
	          </label>
	          <label class="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
	            <span>{{ 'adminUi.products.table.stock' | translate }}</span>
	            <input
	              type="number"
	              inputmode="numeric"
	              step="1"
	              min="0"
	              class="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
	              [disabled]="inlineSaving"
	              [value]="inlineStock"
	              (input)="inlineStock = $any($event.target).value"
	            />
	          </label>
	        </div>
	        <div class="flex items-center justify-between gap-3">
	          <p *ngIf="inlineError" class="text-xs text-rose-700 dark:text-rose-300">{{ inlineError }}</p>
	          <span class="flex-1"></span>
	          <app-button
	            [label]="inlineSaving ? ('adminUi.common.saving' | translate) : ('adminUi.common.save' | translate)"
	            size="sm"
	            [disabled]="inlineSaving"
	            (action)="saveInline()"
	          ></app-button>
	        </div>
	      </div>
	      <div class="flex flex-wrap items-center gap-2">
	        <app-button
	          *ngIf="showQuickView"
	          [label]="'shop.quickView' | translate"
          size="sm"
          variant="ghost"
          (action)="openQuickView()"
        ></app-button>
        <app-button [label]="'product.viewDetails' | translate" size="sm" variant="ghost" (action)="goToDetails()"></app-button>
      </div>
    </article>
  `
})
export class ProductCardComponent implements OnChanges {
  @Input({ required: true }) product!: Product;
  @Input() tag?: string | null;
  @Input() rememberShopReturn = false;
  @Input() showQuickView = false;
  @Output() quickView = new EventEmitter<string>();
  statusSaving = false;
  inlineSaving = false;
  inlinePrice = '';
  inlineStock = '';
  inlineError = '';
  private lastInlineProductId: string | null = null;
  constructor(
    private translate: TranslateService,
    private wishlist: WishlistService,
    private auth: AuthService,
    private toast: ToastService,
    private router: Router,
    private storefrontAdminMode: StorefrontAdminModeService,
    private admin: AdminService
  ) {
    this.wishlist.ensureLoaded();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['product']) return;
    const currentId = this.product?.id ?? null;
    if (!currentId) return;
    if (this.lastInlineProductId === currentId) return;
    this.lastInlineProductId = currentId;
    const price = typeof this.product?.base_price === 'number' && Number.isFinite(this.product.base_price) ? this.product.base_price : 0;
    this.inlinePrice = price.toFixed(2);
    const stock = this.product?.stock_quantity ?? 0;
    this.inlineStock = String(Number.isFinite(Number(stock)) ? stock : 0);
    this.inlineError = '';
    this.inlineSaving = false;
  }

  get wishlisted(): boolean {
    return this.product ? this.wishlist.isWishlisted(this.product.id) : false;
  }

  get badge(): string | null {
    if (this.tag) return this.tag;
    if (this.isOnSale) return this.translate.instant('shop.sale');
    const promoBadge = this.activeProductBadge;
    if (promoBadge) return this.translate.instant(`product.badges.${promoBadge}`);
    const tagName = this.product.tags?.[0]?.name;
    if (tagName) return tagName;
    return this.stockBadge;
  }

  get isOnSale(): boolean {
    const sale = this.product?.sale_price;
    return typeof sale === 'number' && Number.isFinite(sale) && sale < this.product.base_price;
  }

  get displayPrice(): number {
    return this.isOnSale ? Number(this.product.sale_price) : this.product.base_price;
  }

  get primaryImage(): string {
    return this.product.images?.[0]?.url ?? 'assets/placeholder/product-placeholder.svg';
  }

  get stockBadge(): string | null {
    if (this.product.stock_quantity === 0) return this.translate.instant('product.soldOut');
    if ((this.product.stock_quantity ?? 0) < 5) return this.translate.instant('product.lowStock');
    return null;
  }

  private get activeProductBadge(): string | null {
    const badges = Array.isArray(this.product?.badges) ? this.product.badges : [];
    if (!badges.length) return null;
    const now = Date.now();
    const isActive = (badge: any): boolean => {
      const startMs = badge?.start_at ? new Date(badge.start_at).getTime() : null;
      const endMs = badge?.end_at ? new Date(badge.end_at).getTime() : null;
      if (typeof startMs === 'number' && Number.isFinite(startMs) && now < startMs) return false;
      if (typeof endMs === 'number' && Number.isFinite(endMs) && now >= endMs) return false;
      return true;
    };
    const active = badges.filter(isActive).map((b: any) => String(b?.badge || '').trim()).filter(Boolean);
    const priority = ['limited', 'new', 'handmade'];
    for (const key of priority) {
      if (active.includes(key)) return key;
    }
    return active[0] ?? null;
  }

  toggleWishlist(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (!this.product?.id) return;
    if (!this.auth.isAuthenticated()) {
      this.toast.info(this.translate.instant('wishlist.signInTitle'), this.translate.instant('wishlist.signInBody'));
      void this.router.navigateByUrl('/login');
      return;
    }

    if (this.wishlisted) {
      this.wishlist.remove(this.product.id).subscribe({
        next: () => {
          this.wishlist.removeLocal(this.product.id);
          this.toast.success(
            this.translate.instant('wishlist.removedTitle'),
            this.translate.instant('wishlist.removedBody', { name: this.product.name })
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
          this.translate.instant('wishlist.addedBody', { name: this.product.name })
        );
      }
    });
  }

  goToDetails(): void {
    this.rememberShopReturnContext();
    if (!this.product?.slug) return;
    void this.router.navigate(['/products', this.product.slug]);
  }

  showStorefrontEdit(): boolean {
    if (!this.storefrontAdminMode.enabled()) return false;
    if (!this.auth.isAdmin()) return false;
    if (this.auth.isImpersonating()) return false;
    return Boolean(this.product?.slug);
  }

  openAdminEdit(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const slug = (this.product?.slug || '').trim();
    if (!slug) return;
    void this.router.navigate(['/admin/products'], { state: { editProductSlug: slug } });
  }

  onStatusChange(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.showStorefrontEdit()) return;
    const select = event.target as HTMLSelectElement | null;
    const desired = (select?.value || '').trim();
    if (!desired) return;
    const current = String(this.product?.status || '').trim() || 'published';
    if (desired === current) return;
    if (this.statusSaving) {
      if (select) select.value = current;
      return;
    }
    const slug = (this.product?.slug || '').trim();
    if (!slug) return;

    this.statusSaving = true;
    this.admin.updateProduct(slug, { status: desired }).subscribe({
      next: (updated) => {
        this.statusSaving = false;
        if (updated?.status) {
          this.product.status = updated.status;
          if (select) select.value = updated.status;
        } else {
          this.product.status = desired;
        }
        this.toast.success(this.translate.instant('adminUi.products.inline.success'));
      },
      error: () => {
        this.statusSaving = false;
        if (select) select.value = current;
        this.toast.error(this.translate.instant('adminUi.products.inline.errors.save'));
      }
    });
  }

  saveInline(): void {
    if (!this.showStorefrontEdit()) return;
    if (this.inlineSaving) return;
    this.inlineError = '';

    const rawPrice = String(this.inlinePrice ?? '').trim();
    if (!rawPrice) {
      this.inlineError = this.translate.instant('adminUi.products.inline.errors.priceRequired');
      return;
    }
    const price = Number(rawPrice.replace(',', '.'));
    if (!Number.isFinite(price) || price < 0) {
      this.inlineError = this.translate.instant('adminUi.products.inline.errors.priceInvalid');
      return;
    }

    const rawStock = String(this.inlineStock ?? '').trim();
    if (!rawStock) {
      this.inlineError = this.translate.instant('adminUi.products.inline.errors.stockRequired');
      return;
    }
    const stock = Number(rawStock);
    if (!Number.isFinite(stock) || !Number.isInteger(stock) || stock < 0) {
      this.inlineError = this.translate.instant('adminUi.products.inline.errors.stockInvalid');
      return;
    }

    const currentPrice = typeof this.product?.base_price === 'number' ? this.product.base_price : 0;
    const currentStock = this.product?.stock_quantity ?? 0;
    const priceChanged = Math.abs(price - currentPrice) > 1e-9;
    const stockChanged = stock !== currentStock;
    if (!priceChanged && !stockChanged) return;

    const update: { product_id: string; base_price?: number; stock_quantity?: number } = { product_id: this.product.id };
    if (priceChanged) update.base_price = Number(price.toFixed(2));
    if (stockChanged) update.stock_quantity = stock;

    this.inlineSaving = true;
    this.admin.bulkUpdateProducts([update]).subscribe({
      next: () => {
        this.inlineSaving = false;
        if (priceChanged) this.product.base_price = Number(price.toFixed(2));
        if (stockChanged) this.product.stock_quantity = stock;
        this.toast.success(this.translate.instant('adminUi.products.inline.success'));
      },
      error: () => {
        this.inlineSaving = false;
        this.toast.error(this.translate.instant('adminUi.products.inline.errors.save'));
      }
    });
  }

  openQuickView(): void {
    if (!this.product?.slug) return;
    this.quickView.emit(this.product.slug);
  }

  rememberShopReturnContext(event?: MouseEvent): void {
    if (!this.rememberShopReturn) return;
    if (event) {
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    }
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
}
