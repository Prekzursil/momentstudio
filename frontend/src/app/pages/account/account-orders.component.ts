import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { ButtonComponent } from '../../shared/button.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { AccountComponent } from './account.component';

@Component({
  selector: 'app-account-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslateModule, ButtonComponent, LocalizedCurrencyPipe],
  template: `
    <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'nav.myOrders' | translate }}</h2>
        <a routerLink="/shop" class="text-sm text-indigo-600 dark:text-indigo-300 font-medium">{{ 'account.orders.shopNew' | translate }}</a>
      </div>

      <div class="flex flex-wrap items-center gap-3 text-sm">
        <label class="flex items-center gap-2">
          <span class="text-slate-600 dark:text-slate-300">{{ 'account.orders.statusLabel' | translate }}</span>
          <select
            class="rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            [(ngModel)]="account.orderFilter"
            (change)="account.filterOrders()"
          >
            <option value="">{{ 'adminUi.orders.all' | translate }}</option>
            <option value="pending_payment">{{ 'adminUi.orders.pending_payment' | translate }}</option>
            <option value="pending_acceptance">{{ 'adminUi.orders.pending_acceptance' | translate }}</option>
            <option value="paid">{{ 'adminUi.orders.paid' | translate }}</option>
            <option value="shipped">{{ 'adminUi.orders.shipped' | translate }}</option>
            <option value="delivered">{{ 'adminUi.orders.delivered' | translate }}</option>
            <option value="cancelled">{{ 'adminUi.orders.cancelled' | translate }}</option>
            <option value="refunded">{{ 'adminUi.orders.refunded' | translate }}</option>
          </select>
        </label>
      </div>

      <div
        *ngIf="account.pagedOrders().length === 0"
        class="border border-dashed border-slate-200 rounded-xl p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300 grid gap-2"
      >
        <p>{{ 'account.orders.empty' | translate }}</p>
        <a routerLink="/shop" class="text-indigo-600 dark:text-indigo-300 font-medium">{{ 'account.orders.browse' | translate }}</a>
      </div>

      <div *ngIf="account.pagedOrders().length" class="grid gap-3">
        <details
          *ngFor="let order of account.pagedOrders()"
          class="rounded-lg border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200"
        >
          <summary class="flex items-start justify-between gap-4 cursor-pointer select-none [&::-webkit-details-marker]:hidden">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-semibold text-slate-900 dark:text-slate-50">Order #{{ order.reference_code || order.id }}</span>
                <span class="text-xs rounded-full px-2 py-1" [ngClass]="account.orderStatusChipClass(order.status)">
                  {{ ('adminUi.orders.' + order.status) | translate }}
                </span>
              </div>
              <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {{ order.created_at | date: 'mediumDate' }} · {{ order.items.length }} item{{ order.items.length === 1 ? '' : 's' }}
              </p>
            </div>
            <div class="text-right">
              <p class="font-semibold text-slate-900 dark:text-slate-50">
                {{ order.total_amount | localizedCurrency: order.currency || 'RON' }}
              </p>
              <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">Updated {{ order.updated_at | date: 'mediumDate' }}</p>
            </div>
          </summary>

          <div class="mt-3 grid gap-3">
            <div class="mt-4 grid gap-4">
              <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-slate-500 dark:text-slate-400">Tracking</span>
                  <a
                    *ngIf="order.tracking_number"
                    class="text-indigo-600 dark:text-indigo-300 font-medium"
                    [href]="account.trackingUrl(order.tracking_number)"
                    target="_blank"
                    rel="noopener"
                    >{{ order.tracking_number }}</a
                  >
                  <span *ngIf="!order.tracking_number" class="text-slate-600 dark:text-slate-300">Not available</span>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-slate-500 dark:text-slate-400">Shipping</span>
                  <span>{{ order.shipping_method?.name || '—' }}</span>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-slate-500 dark:text-slate-400">Delivery</span>
                  <span>{{ account.deliveryLabel(order) }}</span>
                </div>
                <div *ngIf="account.lockerLabel(order)" class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-slate-500 dark:text-slate-400">Locker</span>
                  <span class="truncate">{{ account.lockerLabel(order) }}</span>
                </div>
                <div
                  *ngIf="order.status === 'cancelled' && order.cancel_reason"
                  class="flex flex-wrap items-start justify-between gap-2"
                >
                  <span class="text-slate-500 dark:text-slate-400">{{ 'adminUi.orders.cancelReason' | translate }}</span>
                  <span class="max-w-[520px] text-right whitespace-pre-wrap">{{ order.cancel_reason }}</span>
                </div>
              </div>

              <div class="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Items</p>
                <div class="mt-2 grid gap-2">
                  <div *ngFor="let item of order.items" class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                      <a
                        *ngIf="item.product?.slug"
                        [routerLink]="['/products', item.product.slug]"
                        class="font-medium text-slate-900 dark:text-slate-50 hover:underline"
                        >{{ item.product?.name }}</a
                      >
                      <p *ngIf="!item.product?.slug" class="font-medium text-slate-900 dark:text-slate-50 truncate">
                        {{ item.product?.name || item.product_id }}
                      </p>
                      <p class="text-xs text-slate-500 dark:text-slate-400">Qty {{ item.quantity }}</p>
                    </div>
                    <div class="text-right text-sm font-medium text-slate-900 dark:text-slate-50">
                      {{ item.subtotal | localizedCurrency: order.currency || 'RON' }}
                    </div>
                  </div>
                </div>
              </div>

              <div class="grid gap-4 sm:grid-cols-2">
                <div class="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                  <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Totals</p>
                  <div class="mt-2 grid gap-1 text-slate-700 dark:text-slate-200">
                    <div class="flex items-center justify-between" *ngIf="(order.tax_amount || 0) > 0">
                      <span class="text-slate-500 dark:text-slate-400">VAT</span>
                      <span>{{ (order.tax_amount || 0) | localizedCurrency: order.currency || 'RON' }}</span>
                    </div>
                    <div class="flex items-center justify-between" *ngIf="(order.fee_amount || 0) > 0">
                      <span class="text-slate-500 dark:text-slate-400">Additional</span>
                      <span>{{ (order.fee_amount || 0) | localizedCurrency: order.currency || 'RON' }}</span>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="text-slate-500 dark:text-slate-400">Shipping</span>
                      <span>{{ (order.shipping_amount || 0) | localizedCurrency: order.currency || 'RON' }}</span>
                    </div>
                    <div class="flex items-center justify-between font-semibold text-slate-900 dark:text-slate-50 pt-1">
                      <span>Total</span>
                      <span>{{ order.total_amount | localizedCurrency: order.currency || 'RON' }}</span>
                    </div>
                  </div>
                </div>

                <div class="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                  <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Actions</p>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'account.orders.reorder' | translate"
                      [disabled]="account.reorderingOrderId === order.id"
                      (action)="account.reorder(order)"
                    ></app-button>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'account.orders.receiptPdf' | translate"
                      [disabled]="account.downloadingReceiptId === order.id"
                      (action)="account.downloadReceipt(order)"
                    ></app-button>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'account.orders.receiptShare' | translate"
                      [disabled]="account.sharingReceiptId === order.id"
                      (action)="account.shareReceipt(order)"
                    ></app-button>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'account.orders.receiptRevoke' | translate"
                      [disabled]="account.revokingReceiptId === order.id"
                      (action)="account.revokeReceiptShare(order)"
                    ></app-button>
                  </div>
                  <div *ngIf="account.receiptShares()[order.id] as share" class="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Share link expires: {{ share.expires_at | date: 'short' }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </details>

        <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
          <span>Page {{ account.page }} / {{ account.totalPages }}</span>
          <div class="flex gap-2">
            <app-button size="sm" variant="ghost" label="Prev" [disabled]="account.page === 1" (action)="account.prevPage()"></app-button>
            <app-button size="sm" variant="ghost" label="Next" [disabled]="account.page === account.totalPages" (action)="account.nextPage()"></app-button>
          </div>
        </div>
      </div>
    </section>
  `
})
export class AccountOrdersComponent {
  protected readonly account = inject(AccountComponent);
}
