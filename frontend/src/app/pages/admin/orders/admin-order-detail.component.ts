import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { InputComponent } from '../../../shared/input.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { ToastService } from '../../../core/toast.service';
import { LocalizedCurrencyPipe } from '../../../shared/localized-currency.pipe';
import { ReceiptShareToken } from '../../../core/account.service';
import { AdminOrderDetail, AdminOrderEvent, AdminOrdersService } from '../../../core/admin-orders.service';
import { AdminReturnsService, ReturnRequestRead } from '../../../core/admin-returns.service';
import { orderStatusChipClass } from '../../../shared/order-status';

type OrderStatus =
  | 'pending'
  | 'pending_payment'
  | 'pending_acceptance'
  | 'paid'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';
type OrderAction =
  | 'save'
  | 'retry'
  | 'capture'
  | 'void'
  | 'partialRefund'
  | 'refund'
  | 'addNote'
  | 'deliveryEmail'
  | 'packingSlip'
  | 'labelUpload'
  | 'labelDownload'
  | 'labelPrint'
  | 'labelDelete'
  | 'receiptShare'
  | 'receiptRevoke';

@Component({
  selector: 'app-admin-order-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TranslateModule,
    BreadcrumbComponent,
    ButtonComponent,
    InputComponent,
    SkeletonComponent,
    LocalizedCurrencyPipe
  ],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs()"></app-breadcrumb>

      <div *ngIf="loading(); else contentTpl" class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <app-skeleton [rows]="10"></app-skeleton>
      </div>

      <ng-template #contentTpl>
        <div *ngIf="error()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
          {{ error() }}
        </div>

        <div *ngIf="order(); else notFoundTpl" class="grid gap-6">
          <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-start justify-between gap-3">
              <div class="grid gap-1">
                <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">
                  {{ 'adminUi.orders.detailTitle' | translate }}: {{ orderRef() }}
                </h1>
                <div class="text-sm text-slate-600 dark:text-slate-300">
                  {{ customerLabel() }} · {{ order()!.created_at | date: 'medium' }}
                </div>
              </div>
              <a routerLink="/admin/orders" class="text-sm text-indigo-600 hover:underline dark:text-indigo-300">
                {{ 'adminUi.orders.backToList' | translate }}
              </a>
            </div>

            <div class="grid md:grid-cols-3 gap-3 text-sm">
              <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.orders.table.status' | translate }}</div>
                <div class="mt-2">
                  <span
                    class="inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold"
                    [ngClass]="statusChipClass(order()!.status)"
                  >
                    {{ ('adminUi.orders.' + order()!.status) | translate }}
                  </span>
                </div>
              </div>
              <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.orders.table.total' | translate }}</div>
                <div class="mt-1 font-semibold text-slate-900 dark:text-slate-50">
                  {{ order()!.total_amount | localizedCurrency : order()!.currency }}
                </div>
                <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  {{ 'adminUi.orders.paymentMethod' | translate }}: {{ paymentMethodLabel() }}
                </div>
              </div>
              <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.orders.tracking' | translate }}</div>
                <div class="mt-1 font-semibold text-slate-900 dark:text-slate-50 truncate">
                  {{ order()!.tracking_number || '—' }}
                </div>
                <div class="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  {{ 'adminUi.orders.deliveryMethod' | translate }}: {{ deliveryLabel() }}
                </div>
                <div *ngIf="lockerLabel()" class="mt-1 text-xs text-slate-600 dark:text-slate-300 truncate">
                  {{ lockerLabel() }}
                </div>
              </div>
            </div>

            <div class="grid gap-3 md:grid-cols-2">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.orders.updateStatus' | translate }}
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="statusValue"
                >
                  <option value="pending_payment">{{ 'adminUi.orders.pending_payment' | translate }}</option>
                  <option value="pending_acceptance">{{ 'adminUi.orders.pending_acceptance' | translate }}</option>
                  <option value="paid">{{ 'adminUi.orders.paid' | translate }}</option>
                  <option value="shipped">{{ 'adminUi.orders.shipped' | translate }}</option>
                  <option value="delivered">{{ 'adminUi.orders.delivered' | translate }}</option>
                  <option value="cancelled">{{ 'adminUi.orders.cancelled' | translate }}</option>
                  <option value="refunded">{{ 'adminUi.orders.refunded' | translate }}</option>
                </select>
              </label>

              <app-input [label]="'adminUi.orders.trackingNumber' | translate" [(value)]="trackingNumber"></app-input>
            </div>

            <label
              *ngIf="statusValue === 'cancelled' || order()!.status === 'cancelled'"
              class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200"
            >
              {{ 'adminUi.orders.cancelReason' | translate }}
              <textarea
                class="min-h-[92px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                [placeholder]="'adminUi.orders.cancelReasonPlaceholder' | translate"
                [(ngModel)]="cancelReason"
              ></textarea>
              <span class="text-xs font-normal text-slate-500 dark:text-slate-400">{{ 'adminUi.orders.cancelReasonHint' | translate }}</span>
            </label>

            <app-input
              [label]="'adminUi.orders.trackingUrl' | translate"
              [placeholder]="'adminUi.orders.trackingUrlPlaceholder' | translate"
              [(value)]="trackingUrl"
            ></app-input>

            <div class="grid gap-2">
              <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                {{ 'adminUi.orders.shippingLabel' | translate }}
              </div>

              <div
                *ngIf="shippingLabelError()"
                class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-2 text-xs dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
              >
                {{ shippingLabelError() }}
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <label class="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                  <input type="file" class="hidden" (change)="onShippingLabelSelected($event)" />
                  <span class="font-medium text-slate-900 dark:text-slate-50">{{ 'adminUi.orders.shippingLabelChoose' | translate }}</span>
                  <span class="text-xs text-slate-500 dark:text-slate-300 truncate max-w-[220px]">
                    {{ shippingLabelFileName() }}
                  </span>
                </label>

                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.orders.shippingLabelUpload' | translate"
                  [disabled]="action() !== null || !shippingLabelFile"
                  (action)="uploadShippingLabel()"
                ></app-button>

                <app-button
                  *ngIf="order()!.has_shipping_label"
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.orders.shippingLabelDownload' | translate"
                  [disabled]="action() !== null"
                  (action)="downloadShippingLabel()"
                ></app-button>

                <app-button
                  *ngIf="order()!.has_shipping_label"
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.orders.shippingLabelPrint' | translate"
                  [disabled]="action() !== null"
                  (action)="printShippingLabel()"
                ></app-button>

                <app-button
                  *ngIf="order()!.has_shipping_label"
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.orders.shippingLabelDelete' | translate"
                  [disabled]="action() !== null"
                  (action)="deleteShippingLabel()"
                ></app-button>
              </div>

              <div *ngIf="order()!.has_shipping_label" class="text-xs text-slate-600 dark:text-slate-300">
                {{ order()!.shipping_label_filename }} · {{ order()!.shipping_label_uploaded_at | date: 'short' }}
              </div>
              <div *ngIf="shippingLabelHistory().length" class="mt-2 grid gap-1 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200">
                <div class="text-[11px] font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.orders.shippingLabelHistory' | translate }}
                </div>
                <div *ngFor="let evt of shippingLabelHistory()" class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="font-medium text-slate-900 dark:text-slate-50 truncate">{{ shippingLabelEventLabel(evt.event) }}</div>
                    <div *ngIf="evt.note" class="text-slate-600 dark:text-slate-300 truncate">{{ evt.note }}</div>
                  </div>
                  <div class="shrink-0 text-slate-500 dark:text-slate-400">{{ evt.created_at | date: 'short' }}</div>
                </div>
              </div>
              <div *ngIf="!order()!.has_shipping_label" class="text-xs text-slate-600 dark:text-slate-300">
                {{ 'adminUi.orders.shippingLabelNone' | translate }}
              </div>
            </div>

            <div class="flex items-center gap-2">
              <app-button
                size="sm"
                [label]="'adminUi.orders.save' | translate"
                [disabled]="action() !== null"
                (action)="save()"
              ></app-button>
              <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.orders.saveHint' | translate }}</span>
            </div>

            <div class="grid gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
              <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.orders.actionsTitle' | translate }}</div>

	              <div class="grid gap-3 md:grid-cols-2">
	                <div class="grid gap-2">
	                  <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
	                    {{ 'adminUi.orders.paymentTitle' | translate }}
	                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.orders.actions.retryPayment' | translate"
                      [disabled]="action() !== null"
                      (action)="retryPayment()"
                    ></app-button>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.orders.actions.voidPayment' | translate"
                      [disabled]="action() !== null"
                      (action)="voidPayment()"
                    ></app-button>
                  </div>
                  <div *ngIf="order()!.stripe_payment_intent_id" class="text-xs text-slate-600 dark:text-slate-300">
                    {{ 'adminUi.orders.paymentIntent' | translate }}: {{ order()!.stripe_payment_intent_id }}
                  </div>
                </div>

	                <div class="grid gap-2">
	                  <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
	                    {{ 'adminUi.orders.customerCommsTitle' | translate }}
	                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.orders.actions.deliveryEmail' | translate"
                      [disabled]="action() !== null"
                      (action)="sendDeliveryEmail()"
                    ></app-button>
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.orders.actions.packingSlip' | translate"
                      [disabled]="action() !== null"
                      (action)="downloadPackingSlip()"
                    ></app-button>
	                  </div>
	                </div>

	                <div class="grid gap-2">
	                  <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
	                    {{ 'adminUi.orders.receiptLinks.title' | translate }}
	                  </div>
	                  <div class="flex flex-wrap items-center gap-2">
	                    <app-button
	                      size="sm"
	                      variant="ghost"
	                      [label]="'adminUi.orders.receiptLinks.share' | translate"
	                      [disabled]="action() !== null"
	                      (action)="shareReceipt()"
	                    ></app-button>
	                    <app-button
	                      size="sm"
	                      variant="ghost"
	                      [label]="'adminUi.orders.receiptLinks.revoke' | translate"
	                      [disabled]="action() !== null"
	                      (action)="revokeReceiptShare()"
	                    ></app-button>
	                  </div>
	                  <div *ngIf="receiptShare() as share" class="text-xs text-slate-600 dark:text-slate-300">
	                    {{ 'adminUi.orders.receiptLinks.expires' | translate }}: {{ share.expires_at | date: 'short' }}
	                  </div>
	                </div>
	              </div>

              <div class="flex flex-wrap items-center justify-end gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.orders.actions.partialRefund' | translate"
                  [disabled]="action() !== null || !canRefund()"
                  (action)="openPartialRefundWizard()"
                ></app-button>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.orders.actions.refund' | translate"
                  [disabled]="action() !== null || !canRefund()"
                  (action)="openRefundWizard()"
                ></app-button>
              </div>
              <div class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.orders.refundHint' | translate }}</div>
            </div>
          </section>

          <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-3 dark:border-slate-800 dark:bg-slate-900">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.orders.addressesTitle' | translate }}</h2>
            <div class="grid gap-3 md:grid-cols-2">
              <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.orders.shippingAddress' | translate }}</div>
	                <div *ngIf="order()!.shipping_address; else noShipping" class="mt-2 grid gap-1 text-sm text-slate-700 dark:text-slate-200">
	                  <div class="font-semibold text-slate-900 dark:text-slate-50" *ngIf="order()!.shipping_address?.label">
	                    {{ order()!.shipping_address?.label }}
	                  </div>
	                  <div>{{ order()!.shipping_address!.line1 }}</div>
	                  <div *ngIf="order()!.shipping_address!.line2">{{ order()!.shipping_address!.line2 }}</div>
	                  <div>
	                    {{ order()!.shipping_address!.city }}{{ order()!.shipping_address!.region ? ', ' + order()!.shipping_address!.region : '' }}
	                    {{ order()!.shipping_address!.postal_code }}
	                  </div>
	                  <div>{{ order()!.shipping_address!.country }}</div>
	                </div>
	                <ng-template #noShipping>
	                  <div class="mt-2 text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.orders.noAddress' | translate }}</div>
	                </ng-template>
	              </div>

	              <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
	                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.orders.billingAddress' | translate }}</div>
	                <div *ngIf="order()!.billing_address; else noBilling" class="mt-2 grid gap-1 text-sm text-slate-700 dark:text-slate-200">
	                  <div class="font-semibold text-slate-900 dark:text-slate-50" *ngIf="order()!.billing_address?.label">
	                    {{ order()!.billing_address?.label }}
	                  </div>
	                  <div>{{ order()!.billing_address!.line1 }}</div>
	                  <div *ngIf="order()!.billing_address!.line2">{{ order()!.billing_address!.line2 }}</div>
	                  <div>
	                    {{ order()!.billing_address!.city }}{{ order()!.billing_address!.region ? ', ' + order()!.billing_address!.region : '' }}
	                    {{ order()!.billing_address!.postal_code }}
	                  </div>
	                  <div>{{ order()!.billing_address!.country }}</div>
	                </div>
	                <ng-template #noBilling>
	                  <div class="mt-2 text-sm text-slate-600 dark:text-slate-300">{{ 'adminUi.orders.noAddress' | translate }}</div>
	                </ng-template>

                  <div class="mt-3 border-t border-slate-200 pt-3 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200">
                    <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                      {{ 'adminUi.orders.invoiceTitle' | translate }}
                    </div>
                    <div class="mt-2 grid gap-1">
                      <div>
                        <span class="text-slate-500 dark:text-slate-400">{{ 'adminUi.orders.invoiceCompany' | translate }}:</span>
                        <span class="ml-1">{{ order()!.invoice_company || '—' }}</span>
                      </div>
                      <div>
                        <span class="text-slate-500 dark:text-slate-400">{{ 'adminUi.orders.invoiceVatId' | translate }}:</span>
                        <span class="ml-1">{{ order()!.invoice_vat_id || '—' }}</span>
                      </div>
                    </div>
                  </div>
	              </div>
	            </div>
	          </section>

          <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-3 dark:border-slate-800 dark:bg-slate-900">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.orders.itemsTitle' | translate }}</h2>
	            <div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
	              <table class="min-w-[720px] w-full text-sm">
                <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                  <tr>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.orders.items.product' | translate }}</th>
                    <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.orders.items.qty' | translate }}</th>
                    <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.orders.items.unit' | translate }}</th>
                    <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.orders.items.subtotal' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    *ngFor="let item of order()!.items"
                    class="border-t border-slate-200 dark:border-slate-800"
                  >
                    <td class="px-3 py-2 text-slate-900 dark:text-slate-50">
                      {{ item.product?.name || item.product_id }}
                    </td>
                    <td class="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{{ item.quantity }}</td>
                    <td class="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                      {{ item.unit_price | localizedCurrency : order()!.currency }}
                    </td>
                    <td class="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                      {{ item.subtotal | localizedCurrency : order()!.currency }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.returns.title' | translate }}</h2>
              <app-button
                size="sm"
                [label]="showReturnCreate() ? ('adminUi.actions.cancel' | translate) : ('adminUi.returns.create.open' | translate)"
                (action)="toggleReturnCreate()"
              ></app-button>
            </div>

            <div *ngIf="returnsLoading()" class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <app-skeleton [rows]="4"></app-skeleton>
            </div>

            <div *ngIf="!returnsLoading() && returnsError()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
              {{ returnsError() }}
            </div>

            <div *ngIf="!returnsLoading() && !returnsError() && returnRequests().length === 0" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.returns.empty' | translate }}
            </div>

            <div *ngIf="!returnsLoading() && returnRequests().length" class="grid gap-2">
              <div
                *ngFor="let rr of returnRequests()"
                class="rounded-xl border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="font-semibold text-slate-900 dark:text-slate-50">
                    {{ 'adminUi.returns.detail.title' | translate }} · {{ ('adminUi.returns.status.' + rr.status) | translate }}
                  </div>
                  <div class="text-xs text-slate-500 dark:text-slate-400">{{ rr.created_at | date: 'short' }}</div>
                </div>
                <div class="mt-1 text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{{ rr.reason }}</div>
                <a
                  class="mt-2 inline-flex text-xs text-indigo-600 hover:underline dark:text-indigo-300"
                  [routerLink]="['/admin/returns']"
                  [queryParams]="{ order_id: rr.order_id }"
                >
                  {{ 'adminUi.returns.viewAllForOrder' | translate }}
                </a>
              </div>
            </div>

            <div *ngIf="showReturnCreate()" class="rounded-2xl border border-slate-200 bg-slate-50 p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-800/40">
              <div class="grid gap-1">
                <div class="text-sm font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.returns.create.title' | translate }}</div>
                <div class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.returns.create.hint' | translate }}</div>
              </div>

              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.returns.detail.reason' | translate }}
                <textarea
                  class="min-h-[120px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                  [(ngModel)]="returnReason"
                  [placeholder]="'adminUi.returns.create.reasonPh' | translate"
                ></textarea>
              </label>

              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.returns.detail.customerMessage' | translate }}
                <textarea
                  class="min-h-[90px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                  [(ngModel)]="returnCustomerMessage"
                  [placeholder]="'adminUi.returns.create.customerMessagePh' | translate"
                ></textarea>
              </label>

              <div class="grid gap-2">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                  {{ 'adminUi.returns.detail.items' | translate }}
                </div>
                <div class="grid gap-2">
                  <div
                    *ngFor="let item of order()!.items"
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
                      [(ngModel)]="returnQty[item.id]"
                      [ngModelOptions]="{ standalone: true }"
                      [attr.aria-label]="'adminUi.returns.create.qtyLabel' | translate"
                    />
                  </div>
                </div>
              </div>

              <div *ngIf="returnCreateError()" class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
                {{ returnCreateError() }}
              </div>

              <div class="flex items-center justify-end gap-2">
                <app-button
                  size="sm"
                  [label]="'adminUi.returns.create.create' | translate"
                  [loading]="creatingReturn()"
                  (action)="createReturnRequest()"
                ></app-button>
              </div>
            </div>
          </section>

          <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-3 dark:border-slate-800 dark:bg-slate-900">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.orders.notesTitle' | translate }}</h2>
            <div *ngIf="(order()!.admin_notes || []).length === 0" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.orders.notesEmpty' | translate }}
            </div>
            <div *ngIf="(order()!.admin_notes || []).length > 0" class="grid gap-2">
              <div
                *ngFor="let note of order()!.admin_notes"
                class="rounded-xl border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="grid gap-1">
                    <div class="text-xs font-semibold text-slate-900 dark:text-slate-50">
                      {{ note.actor?.email || note.actor?.username || '—' }}
                    </div>
                    <div class="whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-200">{{ note.note }}</div>
                  </div>
                  <div class="shrink-0 text-xs text-slate-500 dark:text-slate-400">{{ note.created_at | date: 'short' }}</div>
                </div>
              </div>
            </div>

            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'adminUi.orders.notesAddLabel' | translate }}
              <textarea
                class="min-h-[90px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                [(ngModel)]="adminNoteText"
                [placeholder]="'adminUi.orders.notesPlaceholder' | translate"
              ></textarea>
            </label>
            <div *ngIf="adminNoteError()" class="text-sm text-rose-700 dark:text-rose-300">{{ adminNoteError() }}</div>

            <div class="flex items-center justify-end">
              <app-button
                size="sm"
                [label]="'adminUi.orders.actions.addNote' | translate"
                [disabled]="action() !== null"
                (action)="addAdminNote()"
              ></app-button>
            </div>
          </section>

          <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-3 dark:border-slate-800 dark:bg-slate-900">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.orders.timelineTitle' | translate }}</h2>
            <div *ngIf="(order()!.events || []).length === 0" class="text-sm text-slate-600 dark:text-slate-300">
              {{ 'adminUi.orders.timelineEmpty' | translate }}
            </div>
            <div *ngIf="(order()!.events || []).length > 0" class="grid gap-2">
              <div
                *ngFor="let evt of order()!.events"
                class="rounded-xl border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="font-semibold text-slate-900 dark:text-slate-50">{{ evt.event }}</div>
                  <div class="text-xs text-slate-500 dark:text-slate-400">{{ evt.created_at | date: 'short' }}</div>
                </div>
                <ng-container *ngIf="eventDiffRows(evt) as diffs">
                  <div *ngIf="diffs.length" class="mt-2 grid gap-1 text-xs text-slate-600 dark:text-slate-300">
                    <div *ngFor="let diff of diffs" class="flex flex-wrap items-center gap-x-1 gap-y-1">
                      <span class="font-semibold text-slate-700 dark:text-slate-200">{{ diff.label }}:</span>
                      <span class="break-all font-mono">{{ diff.from }}</span>
                      <span class="text-slate-400">→</span>
                      <span class="break-all font-mono">{{ diff.to }}</span>
                    </div>
                  </div>
                </ng-container>
                <div *ngIf="evt.note" class="mt-1 text-slate-600 dark:text-slate-300">{{ evt.note }}</div>
              </div>
            </div>
          </section>
        </div>

        <ng-template #notFoundTpl>
          <div class="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
            {{ 'adminUi.orders.notFound' | translate }}
          </div>
        </ng-template>
      </ng-template>
    </div>

    <ng-container *ngIf="refundWizardOpen() && order() as o">
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" (click)="closeRefundWizard()">
        <div
          class="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          (click)="$event.stopPropagation()"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="grid gap-1">
              <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">
                {{ 'adminUi.orders.refundWizard.title' | translate }}
              </h3>
              <div class="text-xs text-slate-600 dark:text-slate-300">
                {{ 'adminUi.orders.detailTitle' | translate }}: {{ orderRef() }}
              </div>
            </div>
            <button
              type="button"
              class="rounded-md px-2 py-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50"
              (click)="closeRefundWizard()"
              [attr.aria-label]="'adminUi.orders.refundWizard.cancel' | translate"
            >
              ✕
            </button>
          </div>

          <ng-container *ngIf="refundBreakdown() as bd">
            <div class="mt-4 grid gap-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/40">
              <div class="flex items-center justify-between gap-3">
                <span class="text-slate-600 dark:text-slate-300">{{ 'adminUi.orders.refundWizard.subtotal' | translate }}</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">{{ bd.subtotal | localizedCurrency : o.currency }}</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-slate-600 dark:text-slate-300">{{ 'adminUi.orders.refundWizard.shipping' | translate }}</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">{{ bd.shipping | localizedCurrency : o.currency }}</span>
              </div>
              <div class="flex items-center justify-between gap-3">
                <span class="text-slate-600 dark:text-slate-300">{{ 'adminUi.orders.refundWizard.vat' | translate }}</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">{{ bd.vat | localizedCurrency : o.currency }}</span>
              </div>
              <div *ngIf="bd.fee !== 0" class="flex items-center justify-between gap-3">
                <span class="text-slate-600 dark:text-slate-300">{{ 'adminUi.orders.refundWizard.fee' | translate }}</span>
                <span class="font-medium text-slate-900 dark:text-slate-50">{{ bd.fee | localizedCurrency : o.currency }}</span>
              </div>
              <div class="mt-2 flex items-center justify-between gap-3 border-t border-slate-200 pt-2 font-semibold dark:border-slate-800">
                <span class="text-slate-900 dark:text-slate-50">{{ 'adminUi.orders.refundWizard.total' | translate }}</span>
                <span class="text-slate-900 dark:text-slate-50">{{ bd.total | localizedCurrency : o.currency }}</span>
              </div>
            </div>
          </ng-container>

          <label class="mt-4 grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.orders.refundWizard.noteLabel' | translate }}
            <textarea
              class="min-h-[90px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              [(ngModel)]="refundNote"
              [placeholder]="'adminUi.orders.refundWizard.notePlaceholder' | translate"
            ></textarea>
          </label>
          <div *ngIf="refundWizardError()" class="mt-2 text-sm text-rose-700 dark:text-rose-300">{{ refundWizardError() }}</div>

          <div class="mt-4 flex justify-end gap-2">
            <app-button
              size="sm"
              variant="ghost"
              [label]="'adminUi.orders.refundWizard.cancel' | translate"
              [disabled]="action() !== null"
              (action)="closeRefundWizard()"
            ></app-button>
            <app-button
              size="sm"
              [label]="'adminUi.orders.refundWizard.confirm' | translate"
              [disabled]="action() !== null"
              (action)="confirmRefund()"
            ></app-button>
          </div>
        </div>
      </div>
    </ng-container>

    <ng-container *ngIf="partialRefundWizardOpen() && order() as o">
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" (click)="closePartialRefundWizard()">
        <div
          class="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          (click)="$event.stopPropagation()"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="grid gap-1">
              <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">
                {{ 'adminUi.orders.partialRefundWizard.title' | translate }}
              </h3>
              <div class="text-xs text-slate-600 dark:text-slate-300">
                {{ 'adminUi.orders.detailTitle' | translate }}: {{ orderRef() }}
              </div>
            </div>
            <button
              type="button"
              class="rounded-md px-2 py-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50"
              (click)="closePartialRefundWizard()"
              [attr.aria-label]="'adminUi.orders.partialRefundWizard.cancel' | translate"
            >
              ✕
            </button>
          </div>

          <div class="mt-4 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/40">
            <div class="flex items-center justify-between gap-3">
              <span class="text-slate-600 dark:text-slate-300">{{ 'adminUi.orders.partialRefundWizard.remaining' | translate }}</span>
              <span class="font-semibold text-slate-900 dark:text-slate-50">{{ refundableRemaining() | localizedCurrency : o.currency }}</span>
            </div>
            <div *ngIf="refundsTotal() > 0" class="text-xs text-slate-500 dark:text-slate-400">
              {{ 'adminUi.orders.partialRefundWizard.alreadyRefunded' | translate }}:
              {{ refundsTotal() | localizedCurrency : o.currency }}
            </div>
          </div>

          <div class="mt-4 grid gap-2">
            <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
              {{ 'adminUi.orders.partialRefundWizard.itemsTitle' | translate }}
            </div>
            <div
              *ngFor="let it of o.items"
              class="rounded-xl border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="grid gap-1">
                  <div class="font-semibold text-slate-900 dark:text-slate-50">
                    {{ it.product?.name || it.product_id }}
                  </div>
                  <div class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.orders.partialRefundWizard.purchasedQty' | translate }}: {{ it.quantity }}
                    · {{ it.unit_price | localizedCurrency : o.currency }}
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    [disabled]="partialRefundQtyFor(it.id) <= 0"
                    (click)="adjustPartialRefundQty(it.id, -1, it.quantity)"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min="0"
                    [max]="it.quantity"
                    class="h-8 w-16 rounded-lg border border-slate-200 bg-white px-2 text-center text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [ngModel]="partialRefundQtyFor(it.id)"
                    (ngModelChange)="setPartialRefundQty(it.id, $event, it.quantity)"
                  />
                  <button
                    type="button"
                    class="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    [disabled]="partialRefundQtyFor(it.id) >= it.quantity"
                    (click)="adjustPartialRefundQty(it.id, 1, it.quantity)"
                  >
                    +
                  </button>
                </div>
              </div>
              <div *ngIf="partialRefundQtyFor(it.id) > 0" class="mt-2 flex items-center justify-end text-xs text-slate-600 dark:text-slate-300">
                {{ partialRefundLineTotal(it) | localizedCurrency : o.currency }}
              </div>
            </div>
          </div>

          <label class="mt-4 grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.orders.partialRefundWizard.amountLabel' | translate }}
            <input
              type="number"
              step="0.01"
              class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              [(ngModel)]="partialRefundAmount"
              [placeholder]="'adminUi.orders.partialRefundWizard.amountPlaceholder' | translate"
            />
            <div class="text-xs text-slate-500 dark:text-slate-400">
              {{ 'adminUi.orders.partialRefundWizard.amountHint' | translate }}:
              {{ partialRefundSelectionTotal(o) | localizedCurrency : o.currency }}
            </div>
          </label>

          <label class="mt-3 grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'adminUi.orders.partialRefundWizard.noteLabel' | translate }}
            <textarea
              class="min-h-[90px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              [(ngModel)]="partialRefundNote"
              [placeholder]="'adminUi.orders.partialRefundWizard.notePlaceholder' | translate"
            ></textarea>
          </label>

          <label class="mt-3 flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              class="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800"
              [(ngModel)]="partialRefundProcessPayment"
              [disabled]="!canProcessPartialRefund()"
            />
            <span class="grid gap-1">
              <span class="font-medium">{{ 'adminUi.orders.partialRefundWizard.processPaymentLabel' | translate }}</span>
              <span class="text-xs text-slate-500 dark:text-slate-400">
                {{ processPartialRefundHint() }}
              </span>
            </span>
          </label>

          <div *ngIf="partialRefundWizardError()" class="mt-2 text-sm text-rose-700 dark:text-rose-300">
            {{ partialRefundWizardError() }}
          </div>

          <div class="mt-4 flex justify-end gap-2">
            <app-button
              size="sm"
              variant="ghost"
              [label]="'adminUi.orders.partialRefundWizard.cancel' | translate"
              [disabled]="action() !== null"
              (action)="closePartialRefundWizard()"
            ></app-button>
            <app-button
              size="sm"
              [label]="'adminUi.orders.partialRefundWizard.confirm' | translate"
              [disabled]="action() !== null"
              (action)="confirmPartialRefund()"
            ></app-button>
          </div>

          <div *ngIf="(o.refunds || []).length > 0" class="mt-4 grid gap-2">
            <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
              {{ 'adminUi.orders.partialRefundWizard.historyTitle' | translate }}
            </div>
            <div
              *ngFor="let r of o.refunds"
              class="rounded-xl border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="font-semibold text-slate-900 dark:text-slate-50">
                  {{ r.amount | localizedCurrency : o.currency }} · {{ r.provider }}
                </div>
                <div class="text-xs text-slate-500 dark:text-slate-400">{{ r.created_at | date: 'short' }}</div>
              </div>
              <div *ngIf="r.note" class="mt-1 text-xs text-slate-600 dark:text-slate-300">{{ r.note }}</div>
              <div *ngIf="r.provider_refund_id" class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {{ 'adminUi.orders.partialRefundWizard.providerRefundId' | translate }}: {{ r.provider_refund_id }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ng-container>
  `
})
export class AdminOrderDetailComponent implements OnInit {
  loading = signal(true);
  error = signal<string | null>(null);
  order = signal<AdminOrderDetail | null>(null);
  action = signal<OrderAction | null>(null);
  returnsLoading = signal(false);
  returnsError = signal<string | null>(null);
  returnRequests = signal<ReturnRequestRead[]>([]);
  showReturnCreate = signal(false);
  creatingReturn = signal(false);
  returnCreateError = signal<string | null>(null);
  receiptShare = signal<ReceiptShareToken | null>(null);
  refundWizardOpen = signal(false);
  refundWizardError = signal<string | null>(null);
  partialRefundWizardOpen = signal(false);
  partialRefundWizardError = signal<string | null>(null);
  adminNoteError = signal<string | null>(null);

  statusValue: OrderStatus = 'pending_acceptance';
  trackingNumber = '';
  trackingUrl = '';
  cancelReason = '';
  refundNote = '';
  partialRefundNote = '';
  partialRefundAmount = '';
  partialRefundProcessPayment = false;
  partialRefundQty: Record<string, number> = {};
  adminNoteText = '';
  returnReason = '';
  returnCustomerMessage = '';
  returnQty: Record<string, number> = {};

  shippingLabelFile: File | null = null;
  shippingLabelError = signal<string | null>(null);

  private orderId: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private api: AdminOrdersService,
    private returnsApi: AdminReturnsService,
    private toast: ToastService,
    private translate: TranslateService
  ) {}

  statusChipClass(status: string): string {
    return orderStatusChipClass(status);
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('orderId');
    if (!id) {
      this.error.set(this.translate.instant('adminUi.orders.notFound'));
      this.loading.set(false);
      return;
    }
    this.orderId = id;
    this.load(id);
  }

  crumbs(): { label: string; url?: string }[] {
    const ref = this.orderRef();
    return [
      { label: 'nav.home', url: '/' },
      { label: 'nav.admin', url: '/admin/dashboard' },
      { label: 'adminUi.orders.title', url: '/admin/orders' },
      { label: ref ? `${this.translate.instant('adminUi.orders.detailTitle')}: ${ref}` : this.translate.instant('adminUi.orders.detailTitle') }
    ];
  }

  orderRef(): string {
    const o = this.order();
    if (!o) return '';
    return o.reference_code || o.id.slice(0, 8);
  }

  customerLabel(): string {
    const o = this.order();
    if (!o) return '';
    const email = (o.customer_email ?? '').trim();
    const username = (o.customer_username ?? '').trim();
    if (email && username) return `${email} (${username})`;
    return email || username || this.translate.instant('adminUi.orders.guest');
  }

  paymentMethodLabel(): string {
    const o = this.order();
    if (!o) return '—';
    const method = (o.payment_method ?? '').trim().toLowerCase();
    if (method === 'cod') return this.translate.instant('adminUi.orders.paymentCod');
    if (method === 'paypal') return this.translate.instant('adminUi.orders.paymentPaypal');
    if (method === 'stripe') return this.translate.instant('adminUi.orders.paymentStripe');
    return method || '—';
  }

  canRefund(): boolean {
    const status = (this.order()?.status ?? '').toString().trim().toLowerCase();
    return status === 'paid' || status === 'shipped' || status === 'delivered';
  }

  eventDiffRows(evt: AdminOrderEvent): Array<{ label: string; from: string; to: string }> {
    const changes = this.eventChanges(evt);
    if (changes) return changes;

    const note = (evt?.note ?? '').toString();
    const event = (evt?.event ?? '').toString();
    if ((event === 'status_change' || event === 'status_auto_ship') && note.includes('->')) {
      const parts = note.split('->').map((p) => p.trim());
      if (parts.length >= 2) {
        return [
          {
            label: this.diffLabel('status'),
            from: this.diffValue('status', parts[0]),
            to: this.diffValue('status', parts[1])
          }
        ];
      }
    }
    return [];
  }

  private eventChanges(evt: AdminOrderEvent): Array<{ label: string; from: string; to: string }> | null {
    const data = evt?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const rawChanges = (data as any).changes;
    if (!rawChanges || typeof rawChanges !== 'object' || Array.isArray(rawChanges)) return null;

    const rows: Array<{ label: string; from: string; to: string }> = [];
    for (const field of Object.keys(rawChanges)) {
      const change = (rawChanges as any)[field];
      if (!change || typeof change !== 'object') continue;
      const from = this.diffValue(field, (change as any).from);
      const to = this.diffValue(field, (change as any).to);
      if (from === to) continue;
      rows.push({ label: this.diffLabel(field), from, to });
    }
    return rows.length ? rows : [];
  }

  private diffLabel(field: string): string {
    const key =
      field === 'tracking_number'
        ? 'adminUi.orders.trackingNumber'
        : field === 'tracking_url'
          ? 'adminUi.orders.trackingUrl'
          : field === 'status'
            ? 'adminUi.orders.table.status'
            : field === 'cancel_reason'
              ? 'adminUi.orders.cancelReason'
              : field === 'courier'
                ? 'adminUi.orders.diff.courier'
                : field === 'shipping_method'
                  ? 'adminUi.orders.diff.shippingMethod'
                  : null;
    if (!key) return field.replaceAll('_', ' ');

    const translated = this.translate.instant(key);
    return translated && translated !== key ? translated : field.replaceAll('_', ' ');
  }

  private diffValue(field: string, value: unknown): string {
    if (value === null || value === undefined) return '—';
    let raw = '';
    if (typeof value === 'string') raw = value.trim();
    else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') raw = String(value);
    else return '—';
    if (!raw) return '—';
    if (field === 'status') {
      const key = `adminUi.orders.${raw}`;
      const translated = this.translate.instant(key);
      return translated && translated !== key ? translated : raw;
    }
    return raw;
  }

  refundBreakdown(): { subtotal: number; shipping: number; vat: number; fee: number; total: number } | null {
    const o = this.order();
    if (!o) return null;
    const total = Number(o.total_amount ?? 0);
    const shipping = Number(o.shipping_amount ?? 0);
    const vat = Number(o.tax_amount ?? 0);
    const fee = Number(o.fee_amount ?? 0);
    const subtotal = Math.max(0, total - shipping - vat - fee);
    return { subtotal, shipping, vat, fee, total };
  }

  openRefundWizard(): void {
    if (!this.orderId) return;
    if (!this.order() || !this.canRefund()) return;
    this.refundWizardError.set(null);
    this.refundWizardOpen.set(true);
  }

  closeRefundWizard(): void {
    this.refundWizardOpen.set(false);
    this.refundWizardError.set(null);
  }

  confirmRefund(): void {
    const orderId = this.orderId;
    if (!orderId) return;
    if (!this.order() || !this.canRefund()) return;

    const note = this.refundNote.trim();
    if (!note) {
      this.refundWizardError.set(this.translate.instant('adminUi.orders.refundWizard.noteRequired'));
      return;
    }

    this.refundWizardError.set(null);
    this.action.set('refund');
    this.api.requestRefund(orderId, note).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('adminUi.orders.success.refund'));
        this.refundNote = '';
        this.closeRefundWizard();
        this.load(orderId);
        this.action.set(null);
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant('adminUi.orders.errors.refund');
        this.refundWizardError.set(msg);
        this.toast.error(msg);
        this.action.set(null);
      }
    });
  }

  addAdminNote(): void {
    const orderId = this.orderId;
    if (!orderId) return;

    const note = this.adminNoteText.trim();
    if (!note) {
      this.adminNoteError.set(this.translate.instant('adminUi.orders.errors.noteRequired'));
      return;
    }

    this.adminNoteError.set(null);
    this.action.set('addNote');
    this.api.addAdminNote(orderId, note).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('adminUi.orders.success.note'));
        this.adminNoteText = '';
        this.load(orderId);
        this.action.set(null);
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant('adminUi.orders.errors.note');
        this.adminNoteError.set(msg);
        this.toast.error(msg);
        this.action.set(null);
      }
    });
  }

  refundsTotal(): number {
    const refunds = this.order()?.refunds ?? [];
    return refunds.reduce((sum, refund) => sum + Number(refund?.amount ?? 0), 0);
  }

  refundableRemaining(): number {
    const total = Number(this.order()?.total_amount ?? 0);
    const remaining = total - this.refundsTotal();
    return remaining > 0 ? remaining : 0;
  }

  partialRefundQtyFor(orderItemId: string): number {
    return Number(this.partialRefundQty?.[orderItemId] ?? 0);
  }

  partialRefundLineTotal(it: AdminOrderDetail['items'][number]): number {
    const qty = this.partialRefundQtyFor(it.id);
    const unit = Number(it.unit_price ?? 0);
    return Math.max(0, qty * unit);
  }

  partialRefundSelectionTotal(order: AdminOrderDetail): number {
    return (order.items ?? []).reduce((sum, item) => sum + this.partialRefundLineTotal(item), 0);
  }

  canProcessPartialRefund(): boolean {
    const o = this.order();
    if (!o) return false;
    const method = (o.payment_method ?? '').trim().toLowerCase();
    if (method === 'stripe') return !!o.stripe_payment_intent_id;
    if (method === 'paypal') return !!o.paypal_capture_id;
    return false;
  }

  processPartialRefundHint(): string {
    const o = this.order();
    if (!o) return '';
    const method = (o.payment_method ?? '').trim().toLowerCase();

    if (this.canProcessPartialRefund()) {
      return this.translate.instant('adminUi.orders.partialRefundWizard.processPaymentHintSupported');
    }
    if (method === 'stripe') {
      return this.translate.instant('adminUi.orders.partialRefundWizard.processPaymentHintMissingStripe');
    }
    if (method === 'paypal') {
      return this.translate.instant('adminUi.orders.partialRefundWizard.processPaymentHintMissingPaypal');
    }
    return this.translate.instant('adminUi.orders.partialRefundWizard.processPaymentHintUnsupported');
  }

  openPartialRefundWizard(): void {
    if (!this.orderId) return;
    const o = this.order();
    if (!o || !this.canRefund()) return;

    this.partialRefundWizardError.set(null);
    this.partialRefundNote = '';
    this.partialRefundProcessPayment = false;
    this.partialRefundQty = Object.fromEntries((o.items ?? []).map((it) => [it.id, 0]));
    this.partialRefundAmount = this.partialRefundSelectionTotal(o).toFixed(2);
    this.partialRefundWizardOpen.set(true);
  }

  closePartialRefundWizard(): void {
    this.partialRefundWizardOpen.set(false);
    this.partialRefundWizardError.set(null);
  }

  setPartialRefundQty(orderItemId: string, rawValue: unknown, max: number): void {
    const numeric = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    const safe = Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
    const clamped = Math.max(0, Math.min(max, safe));

    this.partialRefundQty = { ...this.partialRefundQty, [orderItemId]: clamped };

    const o = this.order();
    if (o) this.partialRefundAmount = this.partialRefundSelectionTotal(o).toFixed(2);
  }

  adjustPartialRefundQty(orderItemId: string, delta: number, max: number): void {
    this.setPartialRefundQty(orderItemId, this.partialRefundQtyFor(orderItemId) + delta, max);
  }

  confirmPartialRefund(): void {
    const orderId = this.orderId;
    if (!orderId) return;
    const o = this.order();
    if (!o || !this.canRefund()) return;

    const note = this.partialRefundNote.trim();
    if (!note) {
      this.partialRefundWizardError.set(this.translate.instant('adminUi.orders.partialRefundWizard.noteRequired'));
      return;
    }

    const items = Object.entries(this.partialRefundQty)
      .filter(([, qty]) => qty > 0)
      .map(([orderItemId, qty]) => ({
        order_item_id: orderItemId,
        quantity: qty
      }));
    if (!items.length) {
      this.partialRefundWizardError.set(this.translate.instant('adminUi.orders.partialRefundWizard.itemsRequired'));
      return;
    }

    const amount = Number(this.partialRefundAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      this.partialRefundWizardError.set(this.translate.instant('adminUi.orders.partialRefundWizard.amountRequired'));
      return;
    }

    const remaining = this.refundableRemaining();
    if (amount > remaining + 0.00001) {
      this.partialRefundWizardError.set(this.translate.instant('adminUi.orders.partialRefundWizard.amountTooHigh'));
      return;
    }

    const processPayment = !!this.partialRefundProcessPayment && this.canProcessPartialRefund();

    this.partialRefundWizardError.set(null);
    this.action.set('partialRefund');
    this.api
      .createPartialRefund(orderId, {
        amount: amount.toFixed(2),
        note,
        items,
        process_payment: processPayment
      })
      .subscribe({
        next: () => {
          this.toast.success(this.translate.instant('adminUi.orders.success.partialRefund'));
          this.partialRefundNote = '';
          this.partialRefundAmount = '';
          this.partialRefundProcessPayment = false;
          this.partialRefundQty = {};
          this.closePartialRefundWizard();
          this.load(orderId);
          this.action.set(null);
        },
        error: (err) => {
          const msg = err?.error?.detail || this.translate.instant('adminUi.orders.errors.partialRefund');
          this.partialRefundWizardError.set(msg);
          this.toast.error(msg);
          this.action.set(null);
        }
      });
  }

  deliveryLabel(): string {
    const o = this.order();
    if (!o) return '—';
    const courierRaw = (o.courier ?? '').trim().toLowerCase();
    const courier = courierRaw === 'sameday' ? 'Sameday' : courierRaw === 'fan_courier' ? 'Fan Courier' : (o.courier ?? '').trim();
    const type = (o.delivery_type ?? '').trim().toLowerCase();
    const deliveryType =
      type === 'locker'
        ? this.translate.instant('adminUi.orders.deliveryLocker')
        : type === 'home'
          ? this.translate.instant('adminUi.orders.deliveryHome')
          : (o.delivery_type ?? '').trim();
    const parts = [courier, deliveryType].filter((p) => (p || '').trim());
    return parts.length ? parts.join(' · ') : '—';
  }

  lockerLabel(): string | null {
    const o = this.order();
    if (!o) return null;
    if ((o.delivery_type ?? '').toLowerCase() !== 'locker') return null;
    const name = (o.locker_name ?? '').trim();
    const address = (o.locker_address ?? '').trim();
    const detail = [name, address].filter((p) => p).join(' — ');
    return detail ? `${this.translate.instant('adminUi.orders.locker')}: ${detail}` : null;
  }

  save(): void {
    const orderId = this.order()?.id;
    if (!orderId) return;
    const currentStatus = ((this.order()?.status as OrderStatus) || 'pending_acceptance') as OrderStatus;
    if (this.statusValue === 'cancelled' && !this.cancelReason.trim()) {
      this.toast.error(this.translate.instant('adminUi.orders.errors.cancelReasonRequired'));
      return;
    }
    this.action.set('save');
    this.api
      .update(orderId, {
        status: this.statusValue !== currentStatus ? this.statusValue : undefined,
        cancel_reason: this.statusValue === 'cancelled' ? this.cancelReason.trim() : undefined,
        tracking_number: this.trackingNumber.trim() || null,
        tracking_url: this.trackingUrl.trim() || null
      })
      .subscribe({
        next: (o) => {
          this.order.set(o);
          this.statusValue = (o.status as OrderStatus) || 'pending_acceptance';
          this.trackingNumber = o.tracking_number ?? '';
          this.trackingUrl = o.tracking_url ?? '';
          this.cancelReason = o.cancel_reason ?? '';
          this.action.set(null);
          this.toast.success(this.translate.instant('adminUi.orders.success.status'));
        },
        error: () => {
          this.action.set(null);
          this.toast.error(this.translate.instant('adminUi.orders.errors.status'));
        }
      });
  }

  shippingLabelFileName(): string {
    if (this.shippingLabelFile) return this.shippingLabelFile.name;
    return this.translate.instant('adminUi.orders.shippingLabelNoFile');
  }

  onShippingLabelSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.item(0) ?? null;
    this.shippingLabelFile = file;
    this.shippingLabelError.set(null);
    if (input) input.value = '';
  }

  uploadShippingLabel(): void {
    const orderId = this.order()?.id;
    if (!orderId || !this.shippingLabelFile) return;
    this.shippingLabelError.set(null);
    this.action.set('labelUpload');
    this.api.uploadShippingLabel(orderId, this.shippingLabelFile).subscribe({
      next: (o) => {
        this.order.set(o);
        this.shippingLabelFile = null;
        this.toast.success(this.translate.instant('adminUi.orders.success.shippingLabelUpload'));
        this.action.set(null);
      },
      error: () => {
        this.shippingLabelError.set(this.translate.instant('adminUi.orders.errors.shippingLabelUpload'));
        this.action.set(null);
      }
    });
  }

  downloadShippingLabel(): void {
    const orderId = this.order()?.id;
    if (!orderId) return;
    this.action.set('labelDownload');
    this.api.downloadShippingLabel(orderId, { action: 'download' }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.order()?.shipping_label_filename || `order-${this.orderRef() || orderId}-label`;
        a.click();
        URL.revokeObjectURL(url);
        this.load(orderId);
        this.action.set(null);
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.orders.errors.shippingLabelDownload'));
        this.action.set(null);
      }
    });
  }

  printShippingLabel(): void {
    const orderId = this.order()?.id;
    if (!orderId) return;
    this.action.set('labelPrint');
    this.api.downloadShippingLabel(orderId, { action: 'print' }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.order()?.shipping_label_filename || `order-${this.orderRef() || orderId}-label`;
        a.click();
        URL.revokeObjectURL(url);
        this.load(orderId);
        this.action.set(null);
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.orders.errors.shippingLabelDownload'));
        this.action.set(null);
      }
    });
  }

  deleteShippingLabel(): void {
    const orderId = this.order()?.id;
    if (!orderId) return;
    if (!confirm(this.translate.instant('adminUi.orders.confirmDeleteLabel'))) return;
    this.action.set('labelDelete');
    this.api.deleteShippingLabel(orderId).subscribe({
      next: () => {
        this.load(orderId);
        this.toast.success(this.translate.instant('adminUi.orders.success.shippingLabelDelete'));
        this.action.set(null);
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.orders.errors.shippingLabelDelete'));
        this.action.set(null);
      }
    });
  }

  shippingLabelHistory(): { event: string; note?: string | null; created_at: string }[] {
    const events = this.order()?.events ?? [];
    const shippingEvents = new Set([
      'shipping_label_uploaded',
      'shipping_label_downloaded',
      'shipping_label_printed',
      'shipping_label_deleted'
    ]);
    return events
      .filter((evt) => shippingEvents.has((evt.event || '').trim()))
      .slice()
      .sort((a, b) => (a.created_at > b.created_at ? -1 : a.created_at < b.created_at ? 1 : 0))
      .slice(0, 6);
  }

  shippingLabelEventLabel(event: string): string {
    const key =
      event === 'shipping_label_uploaded'
        ? 'adminUi.orders.shippingLabelEvents.uploaded'
        : event === 'shipping_label_downloaded'
          ? 'adminUi.orders.shippingLabelEvents.downloaded'
          : event === 'shipping_label_printed'
            ? 'adminUi.orders.shippingLabelEvents.printed'
            : event === 'shipping_label_deleted'
              ? 'adminUi.orders.shippingLabelEvents.deleted'
              : null;
    return key ? this.translate.instant(key) : event;
  }

  retryPayment(): void {
    const orderId = this.orderId;
    if (!orderId) return;
    this.action.set('retry');
    this.api.retryPayment(orderId).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('adminUi.orders.success.retry'));
        this.load(orderId);
        this.action.set(null);
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.orders.errors.retry'));
        this.action.set(null);
      }
    });
  }

  voidPayment(): void {
    const orderId = this.orderId;
    if (!orderId) return;
    this.action.set('void');
    this.api.voidPayment(orderId).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('adminUi.orders.success.void'));
        this.load(orderId);
        this.action.set(null);
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.orders.errors.void'));
        this.action.set(null);
      }
    });
  }

  requestRefund(): void {
    this.openRefundWizard();
  }

  sendDeliveryEmail(): void {
    const orderId = this.orderId;
    if (!orderId) return;
    this.action.set('deliveryEmail');
    this.api.sendDeliveryEmail(orderId).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('adminUi.orders.success.deliveryEmail'));
        this.action.set(null);
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.orders.errors.deliveryEmail'));
        this.action.set(null);
      }
    });
  }

  downloadPackingSlip(): void {
    const orderId = this.orderId;
    if (!orderId) return;
    this.action.set('packingSlip');
    this.api.downloadPackingSlip(orderId).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `order-${this.orderRef() || orderId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        this.action.set(null);
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.orders.errors.packingSlip'));
        this.action.set(null);
      }
    });
  }

  shareReceipt(): void {
    const orderId = this.orderId;
    if (!orderId) return;
    const cached = this.receiptShare();
    const expiresAt = cached?.expires_at ? new Date(cached.expires_at) : null;
    if (cached?.receipt_url && expiresAt && expiresAt.getTime() > Date.now() + 30_000) {
      void this.copyToClipboard(cached.receipt_url).then((ok) => {
        this.toast.success(
          ok ? this.translate.instant('adminUi.orders.receiptLinks.copied') : this.translate.instant('adminUi.orders.receiptLinks.ready')
        );
      });
      return;
    }
    this.action.set('receiptShare');
    this.api.shareReceipt(orderId).subscribe({
      next: (token) => {
        this.receiptShare.set(token);
        void this.copyToClipboard(token.receipt_url).then((ok) => {
          this.toast.success(
            ok ? this.translate.instant('adminUi.orders.receiptLinks.copied') : this.translate.instant('adminUi.orders.receiptLinks.ready')
          );
        });
        this.action.set(null);
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant('adminUi.orders.errors.receiptShare');
        this.toast.error(msg);
        this.action.set(null);
      }
    });
  }

  revokeReceiptShare(): void {
    const orderId = this.orderId;
    if (!orderId) return;
    if (!confirm(this.translate.instant('adminUi.orders.receiptLinks.confirmRevoke'))) return;
    this.action.set('receiptRevoke');
    this.api.revokeReceiptShare(orderId).subscribe({
      next: () => {
        this.receiptShare.set(null);
        this.toast.success(this.translate.instant('adminUi.orders.receiptLinks.revoked'));
        this.action.set(null);
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant('adminUi.orders.errors.receiptRevoke');
        this.toast.error(msg);
        this.action.set(null);
      }
    });
  }

  private load(orderId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.receiptShare.set(null);
    this.adminNoteError.set(null);
    this.api.get(orderId).subscribe({
      next: (o) => {
        this.order.set(o);
        this.statusValue = (o.status as OrderStatus) || 'pending_acceptance';
        this.trackingNumber = o.tracking_number ?? '';
        this.trackingUrl = o.tracking_url ?? '';
        this.cancelReason = o.cancel_reason ?? '';
        this.returnQty = {};
        (o.items || []).forEach((it) => (this.returnQty[it.id] = 0));
        this.loadReturns(o.id);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.translate.instant('adminUi.orders.errors.load'));
        this.loading.set(false);
      }
    });
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    try {
      if (typeof navigator === 'undefined') return false;
      if (!navigator.clipboard?.writeText) return false;
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  toggleReturnCreate(): void {
    if (!this.showReturnCreate()) {
      this.returnCreateError.set(null);
      this.returnReason = '';
      this.returnCustomerMessage = '';
      const o = this.order();
      if (o) {
        this.returnQty = {};
        (o.items || []).forEach((it) => (this.returnQty[it.id] = 0));
      }
    }
    this.showReturnCreate.set(!this.showReturnCreate());
  }

  createReturnRequest(): void {
    const o = this.order();
    if (!o) return;
    this.returnCreateError.set(null);

    const reason = this.returnReason.trim();
    if (!reason) {
      this.returnCreateError.set(this.translate.instant('adminUi.returns.create.reasonRequired'));
      return;
    }

    const items = (o.items || [])
      .map((it) => ({
        order_item_id: it.id,
        quantity: Math.max(0, Math.min(Number(this.returnQty[it.id] ?? 0), Number(it.quantity ?? 0)))
      }))
      .filter((row) => row.quantity > 0);

    if (!items.length) {
      this.returnCreateError.set(this.translate.instant('adminUi.returns.create.itemsRequired'));
      return;
    }

    this.creatingReturn.set(true);
    this.returnsApi
      .create({
        order_id: o.id,
        reason,
        customer_message: this.returnCustomerMessage.trim() ? this.returnCustomerMessage.trim() : null,
        items
      })
      .subscribe({
        next: () => {
          this.toast.success(this.translate.instant('adminUi.returns.create.success'));
          this.showReturnCreate.set(false);
          this.returnReason = '';
          this.returnCustomerMessage = '';
          this.loadReturns(o.id);
        },
        error: (err) => {
          this.returnCreateError.set(err?.error?.detail || this.translate.instant('adminUi.returns.create.errors.create'));
        },
        complete: () => this.creatingReturn.set(false)
      });
  }

  private loadReturns(orderId: string): void {
    this.returnsLoading.set(true);
    this.returnsError.set(null);
    this.returnsApi.listByOrder(orderId).subscribe({
      next: (rows) => this.returnRequests.set(rows || []),
      error: () => this.returnsError.set(this.translate.instant('adminUi.returns.errors.load')),
      complete: () => this.returnsLoading.set(false)
    });
  }
}
