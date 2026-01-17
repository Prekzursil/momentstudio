import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { CartStore } from '../../core/cart.store';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { TranslateModule } from '@ngx-translate/core';

type CheckoutSuccessItem = {
  name: string;
  slug: string;
  quantity: number;
  unit_price: number;
  currency: string;
};

type CheckoutSuccessSummary = {
  order_id: string;
  reference_code: string | null;
  payment_method: 'stripe' | 'cod' | 'paypal' | 'netopia';
  courier: string | null;
  delivery_type: 'home' | 'locker' | null;
  locker_name: string | null;
  locker_address: string | null;
  totals: { subtotal: number; tax: number; shipping: number; total: number; currency: string; discount: number };
  items: CheckoutSuccessItem[];
  created_at: string;
};

const CHECKOUT_SUCCESS_KEY = 'checkout_last_order';

@Component({
  selector: 'app-success',
  standalone: true,
  imports: [CommonModule, RouterLink, ContainerComponent, ButtonComponent, BreadcrumbComponent, LocalizedCurrencyPipe, TranslateModule],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <div
        class="grid gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
      >
        <p class="text-sm uppercase tracking-[0.3em] font-semibold">{{ 'checkout.successTitle' | translate }}</p>
        <h1 class="text-2xl font-semibold text-emerald-900 dark:text-emerald-100">{{ 'checkout.successHeadline' | translate }}</h1>
        <p class="text-sm text-emerald-800 dark:text-emerald-200">{{ 'checkout.successCopy' | translate }}</p>
        <div class="flex flex-wrap gap-3">
          <app-button routerLink="/shop" [label]="'checkout.successContinue' | translate"></app-button>
          <app-button routerLink="/account" variant="ghost" [label]="'checkout.successViewOrders' | translate"></app-button>
        </div>
      </div>

      <aside
        *ngIf="summary; else noSummary"
        class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'checkout.summary' | translate }}</h2>
          <span *ngIf="summary.reference_code" class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'checkout.successReference' | translate : { ref: summary.reference_code } }}
          </span>
        </div>

        <div *ngIf="courierLabel() || deliveryTypeKey()" class="text-sm text-slate-700 dark:text-slate-200">
          <span class="text-slate-500 dark:text-slate-400">{{ 'checkout.shipping' | translate }}:</span>
          <span class="ml-1">
            <ng-container *ngIf="courierLabel()">{{ courierLabel() }}</ng-container>
            <ng-container *ngIf="courierLabel() && deliveryTypeKey()"> · </ng-container>
            <ng-container *ngIf="deliveryTypeKey()">{{ deliveryTypeKey() | translate }}</ng-container>
          </span>
        </div>
        <div *ngIf="lockerLabel()" class="text-sm text-slate-700 dark:text-slate-200">
          <span class="text-slate-500 dark:text-slate-400">{{ 'checkout.locker' | translate }}:</span>
          <span class="ml-1">{{ lockerLabel() }}</span>
        </div>

        <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
          <div *ngFor="let item of summary.items">
            <div class="flex justify-between gap-4">
              <a class="font-medium hover:underline" [routerLink]="['/products', item.slug]">{{ item.name }}</a>
              <span>{{ item.unit_price * item.quantity | localizedCurrency : item.currency }}</span>
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ item.quantity }} × {{ item.unit_price | localizedCurrency : item.currency }}</p>
          </div>
        </div>

        <div class="grid gap-1 text-sm text-slate-700 dark:text-slate-200 border-t border-slate-200 pt-3 dark:border-slate-800">
          <div class="flex items-center justify-between">
            <span>{{ 'checkout.subtotal' | translate }}</span>
            <span>{{ summary.totals.subtotal | localizedCurrency : summary.totals.currency }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span>{{ 'checkout.tax' | translate }}</span>
            <span>{{ summary.totals.tax | localizedCurrency : summary.totals.currency }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span>{{ 'checkout.shipping' | translate }}</span>
            <span>{{ summary.totals.shipping | localizedCurrency : summary.totals.currency }}</span>
          </div>
          <div class="flex items-center justify-between" *ngIf="summary.totals.discount > 0">
            <span>{{ 'checkout.promo' | translate }}</span>
            <span class="text-emerald-700 dark:text-emerald-300">-{{ summary.totals.discount | localizedCurrency : summary.totals.currency }}</span>
          </div>
          <div class="flex items-center justify-between text-base font-semibold text-slate-900 pt-1 dark:text-slate-50">
            <span>{{ 'checkout.estimatedTotal' | translate }}</span>
            <span>{{ summary.totals.total | localizedCurrency : summary.totals.currency }}</span>
          </div>
        </div>
      </aside>

      <ng-template #noSummary>
        <aside class="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
          {{ 'checkout.successNoSummary' | translate }}
        </aside>
      </ng-template>
    </app-container>
  `
})
export class SuccessComponent {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'checkout.successTitle' }
  ];

  summary: CheckoutSuccessSummary | null = null;

  constructor(private cart: CartStore) {
    // Keep the cart in sync in case the backend cleared it while we were paying.
    this.cart.loadFromBackend();
    this.summary = this.loadSummary();
  }

  private loadSummary(): CheckoutSuccessSummary | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(CHECKOUT_SUCCESS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CheckoutSuccessSummary;
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.order_id) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  courierLabel(): string | null {
    const s = this.summary;
    if (!s) return null;
    const courierRaw = (s.courier ?? '').trim().toLowerCase();
    return courierRaw === 'fan_courier'
      ? 'Fan Courier'
      : courierRaw === 'sameday'
        ? 'Sameday'
        : (s.courier ?? '').trim() || null;
  }

  deliveryTypeKey(): string | null {
    const s = this.summary;
    if (!s) return null;
    return s.delivery_type === 'home'
      ? 'checkout.deliveryHome'
      : s.delivery_type === 'locker'
        ? 'checkout.deliveryLocker'
        : null;
  }

  lockerLabel(): string | null {
    const s = this.summary;
    if (!s) return null;
    if (s.delivery_type !== 'locker') return null;
    const detail = [s.locker_name, s.locker_address].filter((p) => (p || '').trim()).join(' — ');
    return detail || null;
  }
}
