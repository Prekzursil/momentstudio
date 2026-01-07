import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { CartStore } from '../../core/cart.store';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { OnInit } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, RouterLink, ContainerComponent, ButtonComponent, BreadcrumbComponent, LocalizedCurrencyPipe, TranslateModule],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <div class="grid lg:grid-cols-[2fr_1fr] gap-6 items-start">
        <section class="grid gap-4">
          <div class="flex items-center justify-between">
            <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'cart.title' | translate }}</h1>
            <span class="text-sm text-slate-600 dark:text-slate-300">{{ 'cart.items' | translate : { count: items().length } }}</span>
          </div>

          <div *ngIf="!items().length" class="border border-dashed border-slate-200 rounded-2xl p-10 text-center grid gap-3 dark:border-slate-800">
            <p class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'cart.emptyTitle' | translate }}</p>
            <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'cart.emptyCopy' | translate }}</p>
            <div class="flex justify-center">
              <app-button routerLink="/shop" [label]="'cart.backToShop' | translate"></app-button>
            </div>
          </div>

          <div *ngFor="let item of items()" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex gap-4">
              <img
                [src]="item.image ?? 'assets/placeholder/product-placeholder.svg'"
                [alt]="item.name"
                class="h-24 w-24 rounded-xl object-cover border border-slate-100 dark:border-slate-800"
                (error)="onImageError($event)"
              />
              <div class="flex-1 grid gap-2">
                <div class="flex items-start justify-between">
                  <div>
                    <p class="font-semibold text-slate-900 dark:text-slate-50">{{ item.name }}</p>
                    <p class="text-sm text-slate-500 dark:text-slate-400">In stock: {{ item.stock }}</p>
                  </div>
                  <button class="text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50" (click)="remove(item.id)">
                    Remove
                  </button>
                </div>
                <div class="flex items-center gap-3 text-sm">
                  <label class="flex items-center gap-2">
                    {{ 'cart.qty' | translate }}
                    <input
                      type="number"
                      class="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [value]="item.quantity"
                      (change)="onQuantityChange(item.id, $any($event.target).value)"
                      min="1"
                      [max]="item.stock"
                    />
                  </label>
                  <span class="text-slate-600 dark:text-slate-300">
                    {{ item.price | localizedCurrency : item.currency }} {{ 'cart.each' | translate }}
                  </span>
                  <span class="font-semibold text-slate-900 dark:text-slate-50">
                    {{ item.price * item.quantity | localizedCurrency : item.currency }}
                  </span>
                </div>
                <p *ngIf="errorMsg" class="text-sm text-amber-700 dark:text-amber-300">{{ errorMsg }}</p>
              </div>
            </div>
          </div>
        </section>

        <aside class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'cart.summary' | translate }}</h2>
          <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
            <span>{{ 'cart.subtotal' | translate }}</span>
            <span>{{ subtotal() | localizedCurrency : currency }}</span>
          </div>
          <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
            <span>{{ 'cart.shipping' | translate }}</span>
            <span class="text-slate-500 dark:text-slate-400">{{ 'cart.calcAtCheckout' | translate }}</span>
          </div>
          <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
            <span>{{ 'cart.tax' | translate }}</span>
            <span class="text-slate-500 dark:text-slate-400">{{ 'cart.calcAtCheckout' | translate }}</span>
          </div>
          <div class="border-t border-slate-200 pt-3 flex items-center justify-between text-base font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-50">
            <span>{{ 'cart.estimatedTotal' | translate }}</span>
            <span>{{ subtotal() | localizedCurrency : currency }}</span>
          </div>
          <app-button
            [label]="'cart.checkout' | translate"
            [routerLink]="['/checkout']"
            [disabled]="!items().length"
          ></app-button>
          <app-button variant="ghost" [label]="'cart.continue' | translate" [routerLink]="['/shop']"></app-button>
        </aside>
      </div>
    </app-container>
  `
})
export class CartComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.cart' }
  ];
  errorMsg = '';

  constructor(private cart: CartStore, private translate: TranslateService) {}

  ngOnInit(): void {
    this.cart.loadFromBackend();
  }

  items = this.cart.items;
  subtotal = this.cart.subtotal;
  currency = 'USD';

  onImageError(event: Event): void {
    const target = event.target as HTMLImageElement | null;
    if (!target) return;
    const fallback = 'assets/placeholder/product-placeholder.svg';
    if (target.src.includes(fallback)) return;
    target.src = fallback;
  }

  onQuantityChange(id: string, value: number): void {
    const qty = Number(value);
    const { error } = this.cart.updateQuantity(id, qty);
    this.errorMsg = error ?? '';
  }

  remove(id: string): void {
    this.cart.remove(id);
  }
}
