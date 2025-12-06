import { CommonModule, NgOptimizedImage } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Product } from '../core/catalog.service';
import { ButtonComponent } from './button.component';
import { LocalizedCurrencyPipe } from './localized-currency.pipe';

@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [CommonModule, RouterLink, NgOptimizedImage, LocalizedCurrencyPipe, ButtonComponent],
  template: `
    <article class="group grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm hover:-translate-y-1 hover:shadow-md transition dark:bg-slate-900 dark:border-slate-800 dark:shadow-none">
      <a [routerLink]="['/products', product.slug]" class="block overflow-hidden rounded-xl bg-slate-50 relative dark:bg-slate-800">
        <img
          [ngSrc]="primaryImage"
          [alt]="product.name"
          class="aspect-square w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          width="640"
          height="640"
        />
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
        <p class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ product.base_price | localizedCurrency : product.currency }}</p>
        <p *ngIf="product.short_description" class="text-sm text-slate-600 line-clamp-2 dark:text-slate-300">
          {{ product.short_description }}
        </p>
        <div class="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400" *ngIf="product.rating_count">
          ★ {{ product.rating_average?.toFixed(1) ?? '0.0' }} · {{ product.rating_count }} review(s)
        </div>
      </div>
      <app-button label="View details" size="sm" variant="ghost" [routerLink]="['/products', product.slug]"></app-button>
    </article>
  `
})
export class ProductCardComponent {
  @Input({ required: true }) product!: Product;
  @Input() tag?: string | null;

  get badge(): string | null {
    if (this.tag) return this.tag;
    const tagName = this.product.tags?.[0]?.name;
    if (tagName) return tagName;
    return this.stockBadge;
  }

  get primaryImage(): string {
    return this.product.images?.[0]?.url ?? 'https://via.placeholder.com/640x640?text=Product';
  }

  get stockBadge(): string | null {
    if (this.product.stock_quantity === 0) return 'Sold out';
    if ((this.product.stock_quantity ?? 0) < 5) return 'Low stock';
    return null;
  }
}
