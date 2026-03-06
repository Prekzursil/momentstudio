import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { CartStore } from '../../core/cart.store';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { TranslateModule } from '@ngx-translate/core';
import { AnalyticsService } from '../../core/analytics.service';

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
  totals: { subtotal: number; fee?: number; tax: number; shipping: number; total: number; currency: string; discount: number };
  items: CheckoutSuccessItem[];
  created_at: string;
};

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
          <div class="flex items-center justify-between" *ngIf="(summary.totals.fee || 0) > 0">
            <span>{{ 'checkout.additionalCost' | translate }}</span>
            <span>{{ (summary.totals.fee || 0) | localizedCurrency : summary.totals.currency }}</span>
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
	            <span>{{ 'checkout.discount' | translate }}</span>
	            <span class="text-emerald-700 dark:text-emerald-300">{{ -summary.totals.discount | localizedCurrency : summary.totals.currency }}</span>
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
  private static readonly COURIER_LABELS: Record<string, string> = {
    fan_courier: 'Fan Courier',
    sameday: 'Sameday'
  };

  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'checkout.successTitle' }
  ];

  summary: CheckoutSuccessSummary | null = null;

  constructor(
    private readonly cart: CartStore,
    private readonly analytics: AnalyticsService
  ) {
    // Keep the cart in sync in case the backend cleared it while we were paying.
    this.cart.loadFromBackend();
    this.summary = this.loadSummary();
    this.trackCheckoutSuccess();
  }

  private loadSummary(): CheckoutSuccessSummary | null {
    const state = history.state as { checkoutSummary?: CheckoutSuccessSummary } | null;
    const summary = state?.checkoutSummary;
    if (!summary || typeof summary !== 'object') return null;
    if (!summary.order_id) return null;
    return summary;
  }

  private trackCheckoutSuccess(): void {
    const summary = this.summary;
    if (!summary) return;
    const items = summary.items ?? [];
    const units = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
    this.analytics.track('checkout_success', {
      order_id: summary.order_id,
      payment_method: summary.payment_method,
      courier: summary.courier,
      delivery_type: summary.delivery_type,
      line_items: items.length,
      units,
      subtotal: summary.totals?.subtotal,
      discount: summary.totals?.discount,
      fee: summary.totals?.fee ?? 0,
      tax: summary.totals?.tax,
      shipping: summary.totals?.shipping,
      total: summary.totals?.total,
      currency: summary.totals?.currency
    });
  }

  courierLabel(): string | null {
    const s = this.summary;
    if (!s) return null;
    const courierRaw = (s.courier ?? '').trim().toLowerCase();
    const knownLabel = SuccessComponent.COURIER_LABELS[courierRaw];
    if (knownLabel) return knownLabel;
    return (s.courier ?? '').trim() || null;
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
