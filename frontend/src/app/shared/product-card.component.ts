import { CommonModule, NgOptimizedImage } from '@angular/common';
import { Component, Input } from '@angular/core';
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

@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [CommonModule, RouterLink, NgOptimizedImage, LocalizedCurrencyPipe, ButtonComponent, TranslateModule, ImgFallbackDirective],
  template: `
    <article class="group grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm hover:-translate-y-1 hover:shadow-md transition dark:bg-slate-900 dark:border-slate-800 dark:shadow-none">
      <a [routerLink]="['/products', product.slug]" class="block overflow-hidden rounded-xl bg-slate-50 relative dark:bg-slate-800">
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
      </a>
      <div class="grid gap-1">
        <div class="flex items-center justify-between gap-2">
          <a [routerLink]="['/products', product.slug]" class="font-semibold text-slate-900 line-clamp-1 dark:text-slate-50">
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
      <app-button [label]="'product.viewDetails' | translate" size="sm" variant="ghost" [routerLink]="['/products', product.slug]"></app-button>
    </article>
  `
})
export class ProductCardComponent {
  @Input({ required: true }) product!: Product;
  @Input() tag?: string | null;
  constructor(
    private translate: TranslateService,
    private wishlist: WishlistService,
    private auth: AuthService,
    private toast: ToastService,
    private router: Router
  ) {
    this.wishlist.ensureLoaded();
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
}
