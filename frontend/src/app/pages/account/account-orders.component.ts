import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { ButtonComponent } from '../../shared/button.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { SkeletonComponent } from '../../shared/skeleton.component';
import { AccountComponent } from './account.component';

@Component({
  selector: 'app-account-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslateModule, ButtonComponent, LocalizedCurrencyPipe, SkeletonComponent],
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

        <label class="flex items-center gap-2 min-w-[14rem]">
          <span class="text-slate-600 dark:text-slate-300">{{ 'account.orders.searchLabel' | translate }}</span>
          <input
            class="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            [(ngModel)]="account.ordersQuery"
            (keyup.enter)="account.applyOrderFilters()"
            [placeholder]="'account.orders.searchPlaceholder' | translate"
            name="ordersQuery"
            autocomplete="off"
          />
        </label>

        <label class="flex items-center gap-2">
          <span class="text-slate-600 dark:text-slate-300">{{ 'account.orders.fromLabel' | translate }}</span>
          <input
            class="rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            type="date"
            [(ngModel)]="account.ordersFrom"
            name="ordersFrom"
          />
        </label>

        <label class="flex items-center gap-2">
          <span class="text-slate-600 dark:text-slate-300">{{ 'account.orders.toLabel' | translate }}</span>
          <input
            class="rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            type="date"
            [(ngModel)]="account.ordersTo"
            name="ordersTo"
          />
        </label>

        <app-button size="sm" variant="ghost" [label]="'account.orders.applyFilters' | translate" (action)="account.applyOrderFilters()"></app-button>
        <app-button
          size="sm"
          variant="ghost"
          [label]="'account.orders.clearFilters' | translate"
          [disabled]="!account.ordersFiltersActive()"
          (action)="account.clearOrderFilters()"
        ></app-button>
      </div>

      <div *ngIf="account.ordersLoading() && !account.ordersLoaded()" class="grid gap-3">
        <app-skeleton height="18px" width="240px"></app-skeleton>
        <app-skeleton height="72px"></app-skeleton>
        <app-skeleton height="72px"></app-skeleton>
      </div>

      <div
        *ngIf="!account.ordersLoading() && account.ordersError()"
        class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
      >
        <div class="flex items-start justify-between gap-3">
          <span class="min-w-0">{{ account.ordersError() | translate }}</span>
          <app-button
            size="sm"
            variant="ghost"
            [label]="'shop.retry' | translate"
            [disabled]="account.ordersLoading()"
            (action)="account.loadOrders(true)"
          ></app-button>
        </div>
      </div>

      <div
        *ngIf="account.ordersLoaded() && !account.ordersLoading() && !account.ordersError() && account.pagedOrders().length === 0"
        class="border border-dashed border-slate-200 rounded-xl p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300 grid gap-2"
      >
        <p>{{ 'account.orders.empty' | translate }}</p>
        <a routerLink="/shop" class="text-indigo-600 dark:text-indigo-300 font-medium">{{ 'account.orders.browse' | translate }}</a>
      </div>

      <div *ngIf="account.ordersLoaded() && account.pagedOrders().length" class="grid gap-3">
        <details
          *ngFor="let order of account.pagedOrders()"
          class="rounded-lg border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200"
        >
          <summary class="flex items-start justify-between gap-4 cursor-pointer select-none [&::-webkit-details-marker]:hidden">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-semibold text-slate-900 dark:text-slate-50">{{
                  'account.orders.orderLabel' | translate: { ref: order.reference_code || order.id }
                }}</span>
                <span class="text-xs rounded-full px-2 py-1" [ngClass]="account.orderStatusChipClass(order.status)">
                  {{ ('adminUi.orders.' + order.status) | translate }}
                </span>
                <span
                  class="text-xs rounded-full px-2 py-1 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  *ngIf="order.payment_method"
                >
                  {{ account.paymentMethodLabel(order) }}
                </span>
              </div>
              <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {{ order.created_at | date: 'mediumDate' }} ·
                {{
                  order.items.length === 1
                    ? ('account.orders.itemsCount.one' | translate)
                    : ('account.orders.itemsCount.many' | translate: { count: order.items.length })
                }}
              </p>
            </div>
            <div class="grid gap-2 justify-items-end text-right">
              <p class="font-semibold text-slate-900 dark:text-slate-50">
                {{ order.total_amount | localizedCurrency: order.currency || 'RON' }}
              </p>
              <div
                class="flex flex-wrap justify-end gap-2"
                (click)="$event.preventDefault(); $event.stopPropagation()"
              >
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
                  [label]="
                    account.receiptCopiedId() === order.id
                      ? ('account.orders.receiptCopiedShort' | translate)
                      : ('account.orders.receiptShare' | translate)
                  "
                  [disabled]="account.sharingReceiptId === order.id"
                  (action)="account.shareReceipt(order)"
                ></app-button>
                <app-button
                  *ngIf="account.receiptShares()[order.id]"
                  size="sm"
                  variant="ghost"
                  [label]="
                    account.receiptCopiedId() === order.id
                      ? ('account.orders.receiptCopiedShort' | translate)
                      : ('account.orders.receiptCopyLink' | translate)
                  "
                  (action)="account.copyReceiptLink(order)"
                ></app-button>
                <app-button
                  *ngIf="account.receiptShares()[order.id]"
                  size="sm"
                  variant="ghost"
                  [label]="'account.orders.receiptRevoke' | translate"
                  [disabled]="account.revokingReceiptId === order.id"
                  (action)="account.revokeReceiptShare(order)"
                ></app-button>
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                {{ 'account.orders.updated' | translate: { date: (order.updated_at | date: 'mediumDate') } }}
              </p>
            </div>
          </summary>

          <div class="mt-3 grid gap-3">
            <div
              *ngIf="account.manualRefundRequired(order)"
              class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <p class="font-semibold">{{ 'account.orders.refund.manualRequiredTitle' | translate }}</p>
              <p class="mt-1 text-sm">{{ 'account.orders.refund.manualRequiredCopy' | translate }}</p>
              <p class="mt-1 text-sm">{{ 'account.orders.refund.manualRequiredHint' | translate }}</p>
              <a routerLink="/tickets" class="mt-2 inline-flex font-medium text-amber-900 underline dark:text-amber-100">{{
                'account.orders.refund.contact' | translate
              }}</a>
            </div>
            <div class="mt-4 grid gap-4">
              <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-slate-500 dark:text-slate-400">{{ 'account.orders.trackingLabel' | translate }}</span>
                  <a
                    *ngIf="order.tracking_number"
                    class="text-indigo-600 dark:text-indigo-300 font-medium"
                    [href]="account.trackingUrl(order.tracking_number)"
                    target="_blank"
                    rel="noopener"
                    >{{ order.tracking_number }}</a
                  >
                  <span *ngIf="!order.tracking_number" class="text-slate-600 dark:text-slate-300">{{ 'account.orders.trackingNotAvailable' | translate }}</span>
                </div>
                <div *ngIf="account.trackingStatusLabel(order) as trackingStatus" class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-slate-500 dark:text-slate-400">{{ 'account.orders.trackingStatusLabel' | translate }}</span>
                  <span>{{ trackingStatus }}</span>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-slate-500 dark:text-slate-400">{{ 'account.orders.shippingLabel' | translate }}</span>
                  <span>{{ order.shipping_method?.name || '—' }}</span>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-slate-500 dark:text-slate-400">{{ 'account.orders.deliveryLabel' | translate }}</span>
                  <span>{{ account.deliveryLabel(order) }}</span>
                </div>
                <div *ngIf="account.lockerLabel(order)" class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-slate-500 dark:text-slate-400">{{ 'account.orders.lockerLabel' | translate }}</span>
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
                <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{{ 'account.orders.itemsTitle' | translate }}</p>
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
                      <p class="text-xs text-slate-500 dark:text-slate-400">
                        {{ 'account.orders.qtyLabel' | translate: { count: item.quantity } }}
                      </p>
                    </div>
                    <div class="text-right grid gap-2 justify-items-end">
                      <div class="text-sm font-medium text-slate-900 dark:text-slate-50">
                        {{ item.subtotal | localizedCurrency: order.currency || 'RON' }}
                      </div>
                      <app-button
                        size="sm"
                        variant="ghost"
                        [label]="'product.addToCart' | translate"
                        [disabled]="account.reorderingOrderItemId === item.id || account.creatingReturn"
                        (action)="account.reorderItem(order, item)"
                      ></app-button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="grid gap-4 sm:grid-cols-2">
                <div class="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                  <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{{ 'account.orders.totalsTitle' | translate }}</p>
                  <div class="mt-2 grid gap-1 text-slate-700 dark:text-slate-200">
                    <div class="flex items-center justify-between" *ngIf="(order.tax_amount || 0) > 0">
                      <span class="text-slate-500 dark:text-slate-400">{{ 'account.orders.vatLabel' | translate }}</span>
                      <span>{{ (order.tax_amount || 0) | localizedCurrency: order.currency || 'RON' }}</span>
                    </div>
                    <div class="flex items-center justify-between" *ngIf="(order.fee_amount || 0) > 0">
                      <span class="text-slate-500 dark:text-slate-400">{{ 'account.orders.additionalLabel' | translate }}</span>
                      <span>{{ (order.fee_amount || 0) | localizedCurrency: order.currency || 'RON' }}</span>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="text-slate-500 dark:text-slate-400">{{ 'account.orders.shippingLabel' | translate }}</span>
                      <span>{{ (order.shipping_amount || 0) | localizedCurrency: order.currency || 'RON' }}</span>
                    </div>
                    <div class="flex items-center justify-between font-semibold text-slate-900 dark:text-slate-50 pt-1">
                      <span>{{ 'account.orders.totalLabel' | translate }}</span>
                      <span>{{ order.total_amount | localizedCurrency: order.currency || 'RON' }}</span>
                    </div>
                  </div>
                </div>

                <div class="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                  <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{{ 'account.orders.actionsTitle' | translate }}</p>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'account.orders.reorder' | translate"
                      [disabled]="account.reorderingOrderId === order.id"
                      (action)="account.reorder(order)"
                    ></app-button>
                    <app-button
                      *ngIf="order.status === 'delivered'"
                      size="sm"
                      variant="ghost"
                      [label]="
                        account.hasReturnRequested(order)
                          ? ('account.orders.return.requested' | translate)
                          : ('account.orders.return.open' | translate)
                      "
                      [disabled]="account.hasReturnRequested(order) || account.creatingReturn"
                      (action)="account.openReturnRequest(order)"
                    ></app-button>
                    <app-button
                      variant="ghost"
                      size="sm"
                      [label]="
                        account.hasCancelRequested(order)
                          ? ('account.orders.cancel.requested' | translate)
                          : ('account.orders.cancel.open' | translate)
                      "
                      [disabled]="account.hasCancelRequested(order) || account.requestingCancel"
                      *ngIf="account.canRequestCancel(order) || account.hasCancelRequested(order)"
                      (action)="account.openCancelRequest(order)"
                    ></app-button>
                  </div>
                </div>
              </div>

              <div
                *ngIf="account.returnOrderId === order.id"
                class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/40"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="grid gap-1">
                    <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      {{ 'account.orders.return.title' | translate }}
                    </p>
                    <p class="text-xs text-slate-600 dark:text-slate-300">
                      {{ 'account.orders.return.hint' | translate }}
                    </p>
                  </div>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'account.orders.return.cancel' | translate"
                    [disabled]="account.creatingReturn"
                    (action)="account.closeReturnRequest()"
                  ></app-button>
                </div>

                <div class="mt-3 grid gap-3">
                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'account.orders.return.reasonLabel' | translate }}
                    <textarea
                      class="min-h-[90px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                      [(ngModel)]="account.returnReason"
                      [placeholder]="'account.orders.return.reasonPh' | translate"
                    ></textarea>
                  </label>

                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'account.orders.return.messageLabel' | translate }}
                    <textarea
                      class="min-h-[90px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                      [(ngModel)]="account.returnCustomerMessage"
                      [placeholder]="'account.orders.return.messagePh' | translate"
                    ></textarea>
                  </label>

                  <div class="grid gap-2">
                    <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                      {{ 'account.orders.return.itemsLabel' | translate }}
                    </div>
                    <div class="grid gap-2">
                      <div
                        *ngFor="let item of order.items"
                        class="grid grid-cols-[1fr_120px] gap-3 items-center rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
                      >
                        <div class="min-w-0">
                          <div class="font-medium text-slate-900 dark:text-slate-50 truncate">{{ item.product?.name || item.product_id }}</div>
                          <div class="text-xs text-slate-500 dark:text-slate-400">×{{ item.quantity }}</div>
                        </div>
                        <input
                          class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          type="number"
                          min="0"
                          [max]="item.quantity"
                          [(ngModel)]="account.returnQty[item.id]"
                          [ngModelOptions]="{ standalone: true }"
                          [attr.aria-label]="'account.orders.return.qtyLabel' | translate"
                        />
                      </div>
                    </div>
                  </div>

                  <div
                    *ngIf="account.returnCreateError"
                    class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
                  >
                    {{ account.returnCreateError }}
                  </div>

                  <div class="flex items-center justify-end gap-2">
                    <app-button
                      size="sm"
                      [label]="'account.orders.return.submit' | translate"
                      [disabled]="account.creatingReturn"
                      (action)="account.submitReturnRequest(order)"
                    ></app-button>
                  </div>
                </div>
              </div>

              <div
                *ngIf="account.cancelOrderId === order.id"
                class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/40"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="grid gap-1">
                    <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      {{ 'account.orders.cancel.title' | translate }}
                    </p>
                    <p class="text-xs text-slate-600 dark:text-slate-300">
                      {{ 'account.orders.cancel.hint' | translate }}
                    </p>
                  </div>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'account.orders.cancel.close' | translate"
                    [disabled]="account.requestingCancel"
                    (action)="account.closeCancelRequest()"
                  ></app-button>
                </div>

                <div class="mt-3 grid gap-3">
                  <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                    {{ 'account.orders.cancel.reasonLabel' | translate }}
                    <textarea
                      class="min-h-[90px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                      [(ngModel)]="account.cancelReason"
                      [placeholder]="'account.orders.cancel.reasonPh' | translate"
                    ></textarea>
                  </label>

                  <div
                    *ngIf="account.cancelRequestError"
                    class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
                  >
                    {{ account.cancelRequestError }}
                  </div>

                  <div class="flex items-center justify-end gap-2">
                    <app-button
                      size="sm"
                      [label]="'account.orders.cancel.submit' | translate"
                      [disabled]="account.requestingCancel"
                      (action)="account.submitCancelRequest(order)"
                    ></app-button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </details>

        <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
          <span>{{ 'account.orders.pageLabel' | translate: { page: account.page, total: account.totalPages } }}</span>
          <div class="flex gap-2">
            <app-button
              size="sm"
              variant="ghost"
              [label]="'account.orders.prev' | translate"
              [disabled]="account.page === 1"
              (action)="account.prevPage()"
            ></app-button>
            <app-button
              size="sm"
              variant="ghost"
              [label]="'account.orders.next' | translate"
              [disabled]="account.page === account.totalPages"
              (action)="account.nextPage()"
            ></app-button>
          </div>
        </div>
      </div>
    </section>
  `
})
export class AccountOrdersComponent {
  protected readonly account = inject(AccountComponent);
}
