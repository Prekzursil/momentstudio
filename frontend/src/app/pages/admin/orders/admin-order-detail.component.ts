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
import { AdminOrderDetail, AdminOrdersService } from '../../../core/admin-orders.service';
import { AdminReturnsService, ReturnRequestRead } from '../../../core/admin-returns.service';

type OrderStatus = 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
type OrderAction =
  | 'save'
  | 'retry'
  | 'capture'
  | 'void'
  | 'refund'
  | 'deliveryEmail'
  | 'packingSlip'
  | 'labelUpload'
  | 'labelDownload'
  | 'labelDelete';

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
                <div class="mt-1 font-semibold text-slate-900 dark:text-slate-50">
                  {{ ('adminUi.orders.' + order()!.status) | translate }}
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
                  <option value="pending">{{ 'adminUi.orders.pending' | translate }}</option>
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
                  [label]="'adminUi.orders.shippingLabelDelete' | translate"
                  [disabled]="action() !== null"
                  (action)="deleteShippingLabel()"
                ></app-button>
              </div>

              <div *ngIf="order()!.has_shipping_label" class="text-xs text-slate-600 dark:text-slate-300">
                {{ order()!.shipping_label_filename }} · {{ order()!.shipping_label_uploaded_at | date: 'short' }}
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
              </div>

              <div class="grid gap-3 md:grid-cols-[1fr_auto] items-end">
                <app-input
                  [label]="'adminUi.orders.refundNote' | translate"
                  [placeholder]="'adminUi.orders.refundNotePlaceholder' | translate"
                  [(value)]="refundNote"
                ></app-input>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.orders.actions.refund' | translate"
                  [disabled]="action() !== null"
                  (action)="requestRefund()"
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

  statusValue: OrderStatus = 'pending';
  trackingNumber = '';
  trackingUrl = '';
  cancelReason = '';
  refundNote = '';
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
    const currentStatus = ((this.order()?.status as OrderStatus) || 'pending') as OrderStatus;
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
          this.statusValue = (o.status as OrderStatus) || 'pending';
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
    this.api.downloadShippingLabel(orderId).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.order()?.shipping_label_filename || `order-${this.orderRef() || orderId}-label`;
        a.click();
        URL.revokeObjectURL(url);
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
        const current = this.order();
        if (current) {
          this.order.set({
            ...current,
            has_shipping_label: false,
            shipping_label_filename: null,
            shipping_label_uploaded_at: null
          } as AdminOrderDetail);
        }
        this.toast.success(this.translate.instant('adminUi.orders.success.shippingLabelDelete'));
        this.action.set(null);
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.orders.errors.shippingLabelDelete'));
        this.action.set(null);
      }
    });
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
    const orderId = this.orderId;
    if (!orderId) return;
    if (!confirm(this.translate.instant('adminUi.orders.confirmRefund'))) return;
    this.action.set('refund');
    const note = this.refundNote.trim();
    this.api.requestRefund(orderId, note ? note : null).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('adminUi.orders.success.refund'));
        this.refundNote = '';
        this.load(orderId);
        this.action.set(null);
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.orders.errors.refund'));
        this.action.set(null);
      }
    });
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

  private load(orderId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.get(orderId).subscribe({
      next: (o) => {
        this.order.set(o);
        this.statusValue = (o.status as OrderStatus) || 'pending';
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
