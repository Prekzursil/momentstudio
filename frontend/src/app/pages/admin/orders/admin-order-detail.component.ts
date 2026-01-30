import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BreadcrumbComponent } from '../../../shared/breadcrumb.component';
import { ButtonComponent } from '../../../shared/button.component';
import { ErrorStateComponent } from '../../../shared/error-state.component';
import { extractRequestId } from '../../../shared/http-error';
import { InputComponent } from '../../../shared/input.component';
import { SkeletonComponent } from '../../../shared/skeleton.component';
import { ToastService } from '../../../core/toast.service';
import { LocalizedCurrencyPipe } from '../../../shared/localized-currency.pipe';
import { ReceiptShareToken } from '../../../core/account.service';
import { AdminOrderDetail, AdminOrderEvent, AdminOrderFraudSignal, AdminOrderShipment, AdminOrdersService } from '../../../core/admin-orders.service';
import { AdminReturnsService, ReturnRequestRead } from '../../../core/admin-returns.service';
import { AdminRecentService } from '../../../core/admin-recent.service';
import { orderStatusChipClass } from '../../../shared/order-status';
import { CustomerTimelineComponent } from '../shared/customer-timeline.component';

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
  | 'fulfill'
  | 'addressEdit'
  | 'retry'
  | 'capture'
  | 'void'
  | 'partialRefund'
  | 'refund'
  | 'addNote'
  | 'tagAdd'
  | 'tagRemove'
  | 'shipmentSave'
  | 'shipmentDelete'
  | 'deliveryEmail'
  | 'packingSlip'
  | 'receiptPdf'
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
    ErrorStateComponent,
    InputComponent,
    SkeletonComponent,
    LocalizedCurrencyPipe,
    CustomerTimelineComponent
  ],
  template: `
    <div class="grid gap-6">
      <app-breadcrumb [crumbs]="crumbs()"></app-breadcrumb>

      <div *ngIf="loading(); else contentTpl" class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <app-skeleton [rows]="10"></app-skeleton>
      </div>

      <ng-template #contentTpl>
        <app-error-state
          *ngIf="error()"
          [message]="error()!"
          [requestId]="errorRequestId()"
          [showRetry]="true"
          (retry)="retryLoad()"
        ></app-error-state>

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
              <div class="flex items-center gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="(piiReveal() ? 'adminUi.pii.hide' : 'adminUi.pii.reveal') | translate"
                  [disabled]="action() !== null"
                  (action)="togglePiiReveal()"
                ></app-button>
                <a routerLink="/admin/orders" class="text-sm text-indigo-600 hover:underline dark:text-indigo-300">
                  {{ 'adminUi.orders.backToList' | translate }}
                </a>
              </div>
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

            <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <div class="flex items-start justify-between gap-3">
                <div class="grid gap-2">
                  <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.orders.fraudSignals.title' | translate }}
                  </div>
                  <div *ngIf="(order()!.fraud_signals || []).length === 0" class="text-xs text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.orders.fraudSignals.empty' | translate }}
                  </div>
                  <div *ngIf="(order()!.fraud_signals || []).length" class="grid gap-2">
                    <div *ngFor="let sig of order()!.fraud_signals || []" class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="inline-flex h-2.5 w-2.5 rounded-full" [ngClass]="fraudSeverityDotClass(sig.severity)"></span>
                          <span class="font-medium text-slate-900 dark:text-slate-50">{{ fraudSignalTitle(sig) }}</span>
                          <span
                            class="ml-auto inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                            [ngClass]="fraudSeverityBadgeClass(sig.severity)"
                          >
                            {{ fraudSeverityLabel(sig.severity) }}
                          </span>
                        </div>
                        <div *ngIf="fraudSignalDescription(sig) as desc" class="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                          {{ desc }}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <div class="flex items-start justify-between gap-3 flex-wrap">
                <div class="grid gap-2">
                  <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                    {{ 'adminUi.orders.table.tags' | translate }}
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <ng-container *ngFor="let tagValue of order()!.tags || []">
                      <span
                        class="inline-flex items-center rounded-full px-2 py-0.5 text-xs border border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200"
                      >
                        {{ tagLabel(tagValue) }}
                        <button
                          type="button"
                          class="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                          [disabled]="action() !== null"
                          (click)="removeTag(tagValue)"
                          [attr.aria-label]="'adminUi.orders.tags.removeLabel' | translate: { tag: tagLabel(tagValue) }"
                        >
                          ×
                        </button>
                      </span>
                    </ng-container>
                    <span *ngIf="(order()!.tags || []).length === 0" class="text-xs text-slate-400">
                      {{ 'adminUi.orders.tags.none' | translate }}
                    </span>
                  </div>
                </div>
                <div class="flex items-end gap-2">
                  <label class="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {{ 'adminUi.orders.tags.addLabel' | translate }}
                    <select
                      class="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      [(ngModel)]="tagToAdd"
                      [disabled]="action() !== null"
                    >
                      <option value="">{{ 'adminUi.orders.tags.select' | translate }}</option>
                      <option value="vip">{{ 'adminUi.orders.tags.vip' | translate }}</option>
                      <option value="fraud_risk">{{ 'adminUi.orders.tags.fraud_risk' | translate }}</option>
                      <option value="gift">{{ 'adminUi.orders.tags.gift' | translate }}</option>
                      <option value="test">{{ 'adminUi.orders.tags.test' | translate }}</option>
                    </select>
                  </label>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'adminUi.orders.tags.add' | translate"
                    [disabled]="action() !== null || !tagToAdd"
                    (action)="addTag()"
                  ></app-button>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="(isTestOrder() ? 'adminUi.orders.tags.unmarkTest' : 'adminUi.orders.tags.markTest') | translate"
                    [disabled]="action() !== null"
                    (action)="toggleTestTag()"
                  ></app-button>
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
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="'adminUi.orders.actions.receiptPdf' | translate"
                      [disabled]="action() !== null"
                      (action)="downloadReceiptPdf()"
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
                <div class="flex items-center justify-between gap-3">
                  <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.orders.shippingAddress' | translate }}</div>
                  <button
                    type="button"
                    class="text-xs font-semibold text-indigo-600 hover:underline disabled:opacity-40 dark:text-indigo-300"
                    [disabled]="action() !== null || !order()!.shipping_address"
                    (click)="openAddressEditor('shipping')"
                  >
                    {{ 'adminUi.actions.edit' | translate }}
                  </button>
                </div>
	                <div *ngIf="order()!.shipping_address; else noShipping" class="mt-2 grid gap-1 text-sm text-slate-700 dark:text-slate-200">
	                  <div class="font-semibold text-slate-900 dark:text-slate-50" *ngIf="order()!.shipping_address?.label">
	                    {{ order()!.shipping_address?.label }}
	                  </div>
                    <div *ngIf="order()!.shipping_address!.phone">{{ order()!.shipping_address!.phone }}</div>
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
	                <div class="flex items-center justify-between gap-3">
	                  <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.orders.billingAddress' | translate }}</div>
	                  <button
	                    type="button"
	                    class="text-xs font-semibold text-indigo-600 hover:underline disabled:opacity-40 dark:text-indigo-300"
	                    [disabled]="action() !== null || !order()!.billing_address"
	                    (click)="openAddressEditor('billing')"
	                  >
	                    {{ 'adminUi.actions.edit' | translate }}
	                  </button>
	                </div>
	                <div *ngIf="order()!.billing_address; else noBilling" class="mt-2 grid gap-1 text-sm text-slate-700 dark:text-slate-200">
	                  <div class="font-semibold text-slate-900 dark:text-slate-50" *ngIf="order()!.billing_address?.label">
	                    {{ order()!.billing_address?.label }}
	                  </div>
                    <div *ngIf="order()!.billing_address!.phone">{{ order()!.billing_address!.phone }}</div>
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
              <div class="flex items-center justify-between gap-3">
                <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.orders.shipments.title' | translate }}</h2>
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.orders.shipments.add' | translate"
                  [disabled]="action() !== null"
                  (action)="openShipmentEditor()"
                ></app-button>
              </div>

              <div *ngIf="(order()!.shipments || []).length === 0" class="text-sm text-slate-600 dark:text-slate-300">
                {{ 'adminUi.orders.shipments.empty' | translate }}
              </div>

              <div *ngIf="(order()!.shipments || []).length" class="grid gap-2">
                <div
                  *ngFor="let s of order()!.shipments || []"
                  class="rounded-xl border border-slate-200 p-3 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200"
                >
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0 grid gap-1">
                      <div class="font-semibold text-slate-900 dark:text-slate-50 truncate">
                        {{ s.tracking_number }}
                      </div>
                      <div *ngIf="s.courier" class="text-xs text-slate-600 dark:text-slate-300">
                        {{ 'adminUi.orders.shipments.courier' | translate }}: {{ courierName(s.courier) }}
                      </div>
                      <a
                        *ngIf="s.tracking_url"
                        class="text-xs text-indigo-600 hover:underline dark:text-indigo-300"
                        [href]="s.tracking_url"
                        target="_blank"
                        rel="noopener"
                      >
                        {{ 'adminUi.orders.shipments.openTracking' | translate }}
                      </a>
                      <div class="text-xs text-slate-500 dark:text-slate-400">{{ s.created_at | date: 'short' }}</div>
                    </div>

                    <div class="flex items-center gap-2">
                      <app-button
                        size="sm"
                        variant="ghost"
                        [label]="'adminUi.actions.edit' | translate"
                        [disabled]="action() !== null"
                        (action)="openShipmentEditor(s)"
                      ></app-button>
                      <app-button
                        size="sm"
                        variant="ghost"
                        [label]="'adminUi.actions.delete' | translate"
                        [disabled]="action() !== null"
                        (action)="deleteShipment(s.id)"
                      ></app-button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

	          <section class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-3 dark:border-slate-800 dark:bg-slate-900">
	            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.orders.itemsTitle' | translate }}</h2>
		            <div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
		              <table class="min-w-[920px] w-full text-sm">
                <thead class="bg-slate-50 text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                  <tr>
                    <th class="text-left font-semibold px-3 py-2">{{ 'adminUi.orders.items.product' | translate }}</th>
                    <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.orders.items.qty' | translate }}</th>
                    <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.orders.items.shipped' | translate }}</th>
                    <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.orders.items.unit' | translate }}</th>
                    <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.orders.items.subtotal' | translate }}</th>
                    <th class="text-right font-semibold px-3 py-2">{{ 'adminUi.orders.items.fulfill' | translate }}</th>
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
                      {{ item.shipped_quantity || 0 }} / {{ item.quantity }}
                    </td>
                    <td class="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                      {{ item.unit_price | localizedCurrency : order()!.currency }}
                    </td>
                    <td class="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                      {{ item.subtotal | localizedCurrency : order()!.currency }}
                    </td>
                    <td class="px-3 py-2 text-right">
                      <div class="flex items-center justify-end gap-2">
                        <input
                          type="number"
                          min="0"
                          [max]="item.quantity"
                          class="h-9 w-20 rounded-lg border border-slate-200 bg-white px-2 text-right text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          [(ngModel)]="fulfillmentQty[item.id]"
                        />
                        <app-button
                          size="sm"
                          variant="ghost"
                          [label]="'adminUi.actions.save' | translate"
                          [disabled]="action() !== null"
                          (action)="saveFulfillment(item.id, item.quantity)"
                        ></app-button>
                      </div>
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
            <app-customer-timeline
              [userId]="order()!.user_id"
              [customerEmail]="order()!.customer_email"
              [includePii]="piiReveal()"
              [excludeOrderId]="order()!.id"
            ></app-customer-timeline>
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
                <ng-container *ngIf="eventAddressDiff(evt) as addrDiff">
                  <div class="mt-2 grid gap-3">
                    <div *ngIf="addrDiff.shipping" class="grid gap-2">
                      <div class="text-[11px] font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                        {{ 'adminUi.orders.shippingAddress' | translate }}
                      </div>
                      <div class="grid gap-2 md:grid-cols-2">
                        <div class="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-800 dark:bg-slate-950/40">
                          <div class="text-[11px] font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                            {{ 'adminUi.orders.diff.before' | translate }}
                          </div>
                          <div class="mt-1 whitespace-pre-line text-slate-700 dark:text-slate-200">
                            {{ formatAddressSnapshot(addrDiff.shipping.from) }}
                          </div>
                        </div>
                        <div class="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-800 dark:bg-slate-950/40">
                          <div class="text-[11px] font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                            {{ 'adminUi.orders.diff.after' | translate }}
                          </div>
                          <div class="mt-1 whitespace-pre-line text-slate-700 dark:text-slate-200">
                            {{ formatAddressSnapshot(addrDiff.shipping.to) }}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div *ngIf="addrDiff.billing" class="grid gap-2">
                      <div class="text-[11px] font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                        {{ 'adminUi.orders.billingAddress' | translate }}
                      </div>
                      <div class="grid gap-2 md:grid-cols-2">
                        <div class="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-800 dark:bg-slate-950/40">
                          <div class="text-[11px] font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                            {{ 'adminUi.orders.diff.before' | translate }}
                          </div>
                          <div class="mt-1 whitespace-pre-line text-slate-700 dark:text-slate-200">
                            {{ formatAddressSnapshot(addrDiff.billing.from) }}
                          </div>
                        </div>
                        <div class="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-800 dark:bg-slate-950/40">
                          <div class="text-[11px] font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">
                            {{ 'adminUi.orders.diff.after' | translate }}
                          </div>
                          <div class="mt-1 whitespace-pre-line text-slate-700 dark:text-slate-200">
                            {{ formatAddressSnapshot(addrDiff.billing.to) }}
                          </div>
                        </div>
                      </div>
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

    <ng-container *ngIf="addressEditorOpen()">
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" (click)="closeAddressEditor()">
        <div
          class="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900"
          (click)="$event.stopPropagation()"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="grid gap-1">
              <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">
                {{
                  (addressEditorKind() === 'shipping'
                    ? 'adminUi.orders.addressEdit.titleShipping'
                    : 'adminUi.orders.addressEdit.titleBilling') | translate
                }}
              </h3>
              <div class="text-xs text-slate-600 dark:text-slate-300">
                {{ 'adminUi.orders.detailTitle' | translate }}: {{ orderRef() }}
              </div>
            </div>
            <button
              type="button"
              class="rounded-md px-2 py-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50"
              (click)="closeAddressEditor()"
              [attr.aria-label]="'adminUi.actions.cancel' | translate"
            >
              ✕
            </button>
          </div>

          <div class="mt-4 grid gap-3">
            <div class="grid gap-3 md:grid-cols-2">
              <app-input
                [label]="'addressForm.label' | translate"
                [placeholder]="'addressForm.customLabelPlaceholder' | translate"
                [(value)]="addressLabel"
              ></app-input>
              <app-input [label]="'auth.phone' | translate" [placeholder]="'+40740123456'" [(value)]="addressPhone"></app-input>
            </div>
            <app-input [label]="'addressForm.line1' | translate" [(value)]="addressLine1"></app-input>
            <app-input [label]="'addressForm.line2' | translate" [(value)]="addressLine2"></app-input>
            <div class="grid gap-3 md:grid-cols-2">
              <app-input [label]="'checkout.city' | translate" [(value)]="addressCity"></app-input>
              <app-input [label]="'checkout.region' | translate" [(value)]="addressRegion"></app-input>
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <app-input [label]="'checkout.postal' | translate" [(value)]="addressPostalCode"></app-input>
              <app-input [label]="'checkout.country' | translate" [placeholder]="'RO'" [(value)]="addressCountry"></app-input>
            </div>

            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'adminUi.orders.addressEdit.noteLabel' | translate }}
              <textarea
                class="min-h-[84px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                [(ngModel)]="addressNote"
                [placeholder]="'adminUi.orders.addressEdit.notePlaceholder' | translate"
              ></textarea>
            </label>

            <label
              *ngIf="addressEditorKind() === 'shipping'"
              class="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200"
            >
              <input type="checkbox" class="mt-0.5" [(ngModel)]="addressRerateShipping" />
              <span class="grid gap-1">
                <span class="font-semibold text-slate-900 dark:text-slate-50">{{ 'adminUi.orders.addressEdit.rerate' | translate }}</span>
                <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.orders.addressEdit.rerateHint' | translate }}</span>
              </span>
            </label>

            <div
              *ngIf="addressEditorError()"
              class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
            >
              {{ addressEditorError() }}
            </div>

            <div class="flex justify-end gap-2">
              <app-button
                size="sm"
                variant="ghost"
                [label]="'adminUi.actions.cancel' | translate"
                [disabled]="action() !== null"
                (action)="closeAddressEditor()"
              ></app-button>
              <app-button
                size="sm"
                [label]="'adminUi.actions.save' | translate"
                [disabled]="action() !== null"
                (action)="saveAddressEditor()"
              ></app-button>
            </div>
          </div>
        </div>
      </div>
	    </ng-container>

      <ng-container *ngIf="shipmentEditorOpen()">
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" (click)="closeShipmentEditor()">
          <div
            class="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            (click)="$event.stopPropagation()"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="grid gap-1">
                <h3 class="text-base font-semibold text-slate-900 dark:text-slate-50">
                  {{
                    (shipmentEditingId ? 'adminUi.orders.shipments.editTitle' : 'adminUi.orders.shipments.addTitle')
                      | translate
                  }}
                </h3>
                <div class="text-xs text-slate-600 dark:text-slate-300">
                  {{ 'adminUi.orders.detailTitle' | translate }}: {{ orderRef() }}
                </div>
              </div>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50"
                (click)="closeShipmentEditor()"
                [attr.aria-label]="'adminUi.actions.cancel' | translate"
              >
                ✕
              </button>
            </div>

            <div class="mt-4 grid gap-3">
              <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                {{ 'adminUi.orders.shipments.courier' | translate }}
                <select
                  class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  [(ngModel)]="shipmentCourier"
                >
                  <option value="">{{ 'adminUi.orders.shipments.courierNone' | translate }}</option>
                  <option value="sameday">{{ 'checkout.courierSameday' | translate }}</option>
                  <option value="fan_courier">{{ 'checkout.courierFanCourier' | translate }}</option>
                </select>
              </label>

              <app-input
                [label]="'adminUi.orders.shipments.trackingNumber' | translate"
                [(value)]="shipmentTrackingNumber"
              ></app-input>

              <app-input
                [label]="'adminUi.orders.shipments.trackingUrl' | translate"
                [placeholder]="'https://...'"
                [(value)]="shipmentTrackingUrl"
              ></app-input>

              <div
                *ngIf="shipmentEditorError()"
                class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
              >
                {{ shipmentEditorError() }}
              </div>

              <div class="flex justify-end gap-2">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'adminUi.actions.cancel' | translate"
                  [disabled]="action() !== null"
                  (action)="closeShipmentEditor()"
                ></app-button>
                <app-button
                  size="sm"
                  [label]="'adminUi.actions.save' | translate"
                  [disabled]="action() !== null"
                  (action)="saveShipmentEditor()"
                ></app-button>
              </div>
            </div>
          </div>
        </div>
      </ng-container>

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

          <div class="mt-3">
            <app-input
              [label]="'adminUi.orders.refundWizard.passwordLabel' | translate"
              type="password"
              [(value)]="refundPassword"
              [placeholder]="'auth.password' | translate"
              autocomplete="current-password"
            ></app-input>
          </div>
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
                    (click)="adjustPartialRefundQty(it.id, -1, partialRefundMaxQty(it))"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min="0"
                    [max]="partialRefundMaxQty(it)"
                    class="h-8 w-16 rounded-lg border border-slate-200 bg-white px-2 text-center text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    [ngModel]="partialRefundQtyFor(it.id)"
                    (ngModelChange)="setPartialRefundQty(it.id, $event, partialRefundMaxQty(it))"
                  />
                  <button
                    type="button"
                    class="h-8 w-8 rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    [disabled]="partialRefundQtyFor(it.id) >= partialRefundMaxQty(it)"
                    (click)="adjustPartialRefundQty(it.id, 1, partialRefundMaxQty(it))"
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

          <div class="mt-3">
            <app-input
              [label]="'adminUi.orders.partialRefundWizard.passwordLabel' | translate"
              type="password"
              [(value)]="partialRefundPassword"
              [placeholder]="'auth.password' | translate"
              autocomplete="current-password"
            ></app-input>
          </div>

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
  errorRequestId = signal<string | null>(null);
  order = signal<AdminOrderDetail | null>(null);
  piiReveal = signal(false);
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
  addressEditorOpen = signal(false);
  addressEditorKind = signal<'shipping' | 'billing'>('shipping');
  addressEditorError = signal<string | null>(null);
  shipmentEditorOpen = signal(false);
  shipmentEditorError = signal<string | null>(null);

  statusValue: OrderStatus = 'pending_acceptance';
  trackingNumber = '';
  trackingUrl = '';
  cancelReason = '';
  refundNote = '';
  refundPassword = '';
  partialRefundNote = '';
  partialRefundPassword = '';
  partialRefundAmount = '';
  partialRefundProcessPayment = false;
  partialRefundQty: Record<string, number> = {};
  adminNoteText = '';
  tagToAdd = '';
  returnReason = '';
  returnCustomerMessage = '';
  returnQty: Record<string, number> = {};
  addressLabel = '';
  addressPhone = '';
  addressLine1 = '';
  addressLine2 = '';
  addressCity = '';
  addressRegion = '';
  addressPostalCode = '';
  addressCountry = '';
  addressNote = '';
  addressRerateShipping = true;
  fulfillmentQty: Record<string, number> = {};
  shipmentEditingId: string | null = null;
  shipmentCourier = '';
  shipmentTrackingNumber = '';
  shipmentTrackingUrl = '';

  shippingLabelFile: File | null = null;
  shippingLabelError = signal<string | null>(null);

  private orderId: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private api: AdminOrdersService,
    private returnsApi: AdminReturnsService,
    private toast: ToastService,
    private translate: TranslateService,
    private recent: AdminRecentService
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

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (this.shouldIgnoreShortcut(event)) return;
    if (!this.order() || this.loading() || this.error()) return;
    if (this.action() !== null) return;

    const key = (event.key || '').toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 's') {
      event.preventDefault();
      this.save();
      return;
    }

    if (event.shiftKey && key === 'r') {
      event.preventDefault();
      this.openRefundWizard();
      return;
    }

    if (event.shiftKey && key === 'p') {
      event.preventDefault();
      this.downloadPackingSlip();
    }
  }

  private shouldIgnoreShortcut(event: KeyboardEvent): boolean {
    if (event.defaultPrevented) return true;
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    const tag = (target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (target.isContentEditable) return true;
    return false;
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

  togglePiiReveal(): void {
    const orderId = this.orderId;
    if (!orderId) return;
    this.piiReveal.set(!this.piiReveal());
    this.load(orderId);
  }

  tagLabel(tag: string): string {
    const key = `adminUi.orders.tags.${tag}`;
    const translated = this.translate.instant(key);
    return translated === key ? tag : translated;
  }

  fraudSignalTitle(signal: AdminOrderFraudSignal): string {
    const key = `adminUi.orders.fraudSignals.signals.${signal.code}.title`;
    const translated = this.translate.instant(key);
    return translated === key ? signal.code : translated;
  }

  fraudSignalDescription(signal: AdminOrderFraudSignal): string {
    const key = `adminUi.orders.fraudSignals.signals.${signal.code}.description`;
    const params = this.fraudSignalParams(signal);
    const translated = this.translate.instant(key, params);
    return translated === key ? '' : translated;
  }

  fraudSeverityLabel(severity: AdminOrderFraudSignal['severity']): string {
    const key = `adminUi.orders.fraudSignals.severity.${severity}`;
    const translated = this.translate.instant(key);
    return translated === key ? severity : translated;
  }

  fraudSeverityDotClass(severity: AdminOrderFraudSignal['severity']): string {
    if (severity === 'high') return 'bg-rose-500';
    if (severity === 'medium') return 'bg-amber-500';
    if (severity === 'low') return 'bg-sky-500';
    return 'bg-slate-400';
  }

  fraudSeverityBadgeClass(severity: AdminOrderFraudSignal['severity']): string {
    if (severity === 'high') return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200';
    if (severity === 'medium')
      return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200';
    if (severity === 'low') return 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-200';
    return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-200';
  }

  openAddressEditor(kind: 'shipping' | 'billing'): void {
    const o = this.order();
    if (!o) return;
    const addr = kind === 'shipping' ? o.shipping_address : o.billing_address;
    if (!addr) return;

    this.addressEditorKind.set(kind);
    this.addressEditorError.set(null);
    this.addressLabel = addr.label ?? '';
    this.addressPhone = addr.phone ?? '';
    this.addressLine1 = addr.line1 ?? '';
    this.addressLine2 = addr.line2 ?? '';
    this.addressCity = addr.city ?? '';
    this.addressRegion = addr.region ?? '';
    this.addressPostalCode = addr.postal_code ?? '';
    this.addressCountry = addr.country ?? '';
    this.addressNote = '';
    this.addressRerateShipping = true;
    this.addressEditorOpen.set(true);
  }

  closeAddressEditor(): void {
    this.addressEditorOpen.set(false);
    this.addressEditorError.set(null);
  }

  saveAddressEditor(): void {
    const orderId = this.orderId;
    const kind = this.addressEditorKind();
    if (!orderId) return;

    this.addressEditorError.set(null);
    this.action.set('addressEdit');

    const payload: any = {
      rerate_shipping: kind === 'shipping' ? !!this.addressRerateShipping : false,
      note: this.addressNote.trim() || null
    };

    const address = {
      label: this.addressLabel.trim() || null,
      phone: this.addressPhone.trim() || null,
      line1: this.addressLine1.trim(),
      line2: this.addressLine2.trim() || null,
      city: this.addressCity.trim(),
      region: this.addressRegion.trim() || null,
      postal_code: this.addressPostalCode.trim(),
      country: this.addressCountry.trim().toUpperCase()
    };

    if (kind === 'shipping') payload.shipping_address = address;
    else payload.billing_address = address;

    this.api.updateAddresses(orderId, payload, { include_pii: this.piiReveal() }).subscribe({
      next: (o) => {
        this.order.set(o);
        this.toast.success(this.translate.instant('adminUi.orders.addressEdit.success'));
        this.closeAddressEditor();
        this.action.set(null);
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant('adminUi.orders.addressEdit.errors.update');
        this.addressEditorError.set(msg);
        this.toast.error(msg);
        this.action.set(null);
      }
    });
  }

  courierName(courier: string | null | undefined): string {
    const raw = (courier ?? '').trim().toLowerCase();
    if (!raw) return '—';
    if (raw === 'sameday') return this.translate.instant('checkout.courierSameday');
    if (raw === 'fan_courier') return this.translate.instant('checkout.courierFanCourier');
    return (courier ?? '').trim() || '—';
  }

  openShipmentEditor(shipment?: AdminOrderShipment): void {
    this.shipmentEditorError.set(null);
    if (shipment) {
      this.shipmentEditingId = shipment.id;
      this.shipmentCourier = (shipment.courier ?? '').trim();
      this.shipmentTrackingNumber = (shipment.tracking_number ?? '').trim();
      this.shipmentTrackingUrl = (shipment.tracking_url ?? '').trim();
    } else {
      this.shipmentEditingId = null;
      this.shipmentCourier = '';
      this.shipmentTrackingNumber = '';
      this.shipmentTrackingUrl = '';
    }
    this.shipmentEditorOpen.set(true);
  }

  closeShipmentEditor(): void {
    this.shipmentEditorOpen.set(false);
    this.shipmentEditorError.set(null);
    this.shipmentEditingId = null;
    this.shipmentCourier = '';
    this.shipmentTrackingNumber = '';
    this.shipmentTrackingUrl = '';
  }

  saveShipmentEditor(): void {
    const orderId = this.orderId;
    if (!orderId) return;

    this.shipmentEditorError.set(null);
    const trackingNumber = this.shipmentTrackingNumber.trim();
    if (!trackingNumber) {
      const msg = this.translate.instant('adminUi.orders.shipments.errors.trackingRequired');
      this.shipmentEditorError.set(msg);
      this.toast.error(msg);
      return;
    }

    const payload: any = {
      courier: this.shipmentCourier.trim() || null,
      tracking_number: trackingNumber,
      tracking_url: this.shipmentTrackingUrl.trim() || null
    };

    this.action.set('shipmentSave');
    const req = this.shipmentEditingId
      ? this.api.updateShipment(orderId, this.shipmentEditingId, payload, { include_pii: this.piiReveal() })
      : this.api.createShipment(orderId, payload, { include_pii: this.piiReveal() });

    req.subscribe({
      next: (o) => {
        this.order.set(o);
        this.toast.success(this.translate.instant('adminUi.orders.shipments.success'));
        this.closeShipmentEditor();
        this.action.set(null);
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant('adminUi.orders.shipments.errors.save');
        this.shipmentEditorError.set(msg);
        this.toast.error(msg);
        this.action.set(null);
      }
    });
  }

  deleteShipment(shipmentId: string): void {
    const orderId = this.orderId;
    if (!orderId) return;
    this.action.set('shipmentDelete');
    this.api.deleteShipment(orderId, shipmentId, { include_pii: this.piiReveal() }).subscribe({
      next: (o) => {
        this.order.set(o);
        this.toast.success(this.translate.instant('adminUi.orders.shipments.deleted'));
        this.action.set(null);
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant('adminUi.orders.shipments.errors.delete');
        this.toast.error(msg);
        this.action.set(null);
      }
    });
  }

  saveFulfillment(itemId: string, maxQty: number): void {
    const orderId = this.orderId;
    if (!orderId) return;
    const rawQty = Number(this.fulfillmentQty[itemId] ?? 0);
    const qty = Math.max(0, Math.min(Math.trunc(Number.isFinite(rawQty) ? rawQty : 0), Number(maxQty ?? 0)));
    this.action.set('fulfill');
    this.api.fulfillItem(orderId, itemId, qty, { include_pii: this.piiReveal() }).subscribe({
      next: (o) => {
        this.order.set(o);
        this.fulfillmentQty = {};
        (o.items || []).forEach((it) => (this.fulfillmentQty[it.id] = Number(it.shipped_quantity ?? 0)));
        this.toast.success(this.translate.instant('adminUi.orders.items.fulfillSuccess'));
        this.action.set(null);
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant('adminUi.orders.items.fulfillError');
        this.toast.error(msg);
        this.action.set(null);
      }
    });
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

  private fraudSignalParams(signal: AdminOrderFraudSignal): Record<string, unknown> {
    const data = (signal.data ?? {}) as Record<string, unknown>;
    if (signal.code === 'velocity_email' || signal.code === 'velocity_user') {
      return {
        count: data['count'],
        window_minutes: data['window_minutes']
      };
    }
    if (signal.code === 'country_mismatch') {
      return {
        shipping_country: data['shipping_country'],
        billing_country: data['billing_country']
      };
    }
    if (signal.code === 'payment_retries') {
      return { count: data['count'] };
    }
    return data;
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

  eventAddressDiff(
    evt: AdminOrderEvent
  ): { shipping?: { from: unknown; to: unknown }; billing?: { from: unknown; to: unknown } } | null {
    const data = evt?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const rawChanges = (data as any).changes;
    if (!rawChanges || typeof rawChanges !== 'object' || Array.isArray(rawChanges)) return null;

    const shipping = (rawChanges as any).shipping_address;
    const billing = (rawChanges as any).billing_address;
    const result: { shipping?: { from: unknown; to: unknown }; billing?: { from: unknown; to: unknown } } = {};

    if (shipping && typeof shipping === 'object' && !Array.isArray(shipping)) {
      result.shipping = { from: (shipping as any).from ?? null, to: (shipping as any).to ?? null };
    }
    if (billing && typeof billing === 'object' && !Array.isArray(billing)) {
      result.billing = { from: (billing as any).from ?? null, to: (billing as any).to ?? null };
    }

    return result.shipping || result.billing ? result : null;
  }

  formatAddressSnapshot(snapshot: unknown): string {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return '—';
    const raw = snapshot as any;
    const lines: string[] = [];
    const label = (raw.label ?? '').toString().trim();
    const phone = (raw.phone ?? '').toString().trim();
    const line1 = (raw.line1 ?? '').toString().trim();
    const line2 = (raw.line2 ?? '').toString().trim();
    const city = (raw.city ?? '').toString().trim();
    const region = (raw.region ?? '').toString().trim();
    const postal = (raw.postal_code ?? '').toString().trim();
    const country = (raw.country ?? '').toString().trim();

    if (label) lines.push(label);
    if (phone) lines.push(phone);
    if (line1) lines.push(line1);
    if (line2) lines.push(line2);

    const locality = [city, region].filter((p) => p).join(', ');
    const localityPostal = [locality, postal].filter((p) => p).join(' ');
    if (localityPostal) lines.push(localityPostal);
    if (country) lines.push(country);

    return lines.join('\n') || '—';
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
    this.refundNote = '';
    this.refundPassword = '';
    this.refundWizardOpen.set(true);
  }

  closeRefundWizard(): void {
    this.refundWizardOpen.set(false);
    this.refundWizardError.set(null);
    this.refundNote = '';
    this.refundPassword = '';
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

    const password = this.refundPassword.trim();
    if (!password) {
      this.refundWizardError.set(this.translate.instant('adminUi.orders.refundWizard.passwordRequired'));
      return;
    }

    this.refundWizardError.set(null);
    this.action.set('refund');
    this.api.requestRefund(orderId, { password, note }).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('adminUi.orders.success.refund'));
        this.refundNote = '';
        this.refundPassword = '';
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

  addTag(): void {
    const orderId = this.orderId;
    if (!orderId) return;

    const tag = this.tagToAdd.trim();
    if (!tag) return;

    this.action.set('tagAdd');
    this.api.addOrderTag(orderId, tag, { include_pii: this.piiReveal() }).subscribe({
      next: (updated) => {
        this.order.set(updated);
        this.toast.success(this.translate.instant('adminUi.orders.tags.success.add'));
        this.tagToAdd = '';
        this.action.set(null);
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant('adminUi.orders.tags.errors.add');
        this.toast.error(msg);
        this.action.set(null);
      }
    });
  }

  isTestOrder(): boolean {
    return Boolean((this.order()?.tags || []).includes('test'));
  }

  toggleTestTag(): void {
    const orderId = this.orderId;
    if (!orderId) return;
    if (this.action() !== null) return;

    const isTest = this.isTestOrder();
    this.action.set(isTest ? 'tagRemove' : 'tagAdd');
    const request = isTest
      ? this.api.removeOrderTag(orderId, 'test', { include_pii: this.piiReveal() })
      : this.api.addOrderTag(orderId, 'test', { include_pii: this.piiReveal() });
    request.subscribe({
      next: (updated) => {
        this.order.set(updated);
        this.toast.success(
          this.translate.instant(
            isTest ? 'adminUi.orders.tags.success.remove' : 'adminUi.orders.tags.success.add'
          )
        );
        this.action.set(null);
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant(isTest ? 'adminUi.orders.tags.errors.remove' : 'adminUi.orders.tags.errors.add');
        this.toast.error(msg);
        this.action.set(null);
      }
    });
  }

  removeTag(tag: string): void {
    const orderId = this.orderId;
    if (!orderId) return;
    const cleaned = (tag ?? '').trim();
    if (!cleaned) return;

    this.action.set('tagRemove');
    this.api.removeOrderTag(orderId, cleaned, { include_pii: this.piiReveal() }).subscribe({
      next: (updated) => {
        this.order.set(updated);
        this.toast.success(this.translate.instant('adminUi.orders.tags.success.remove'));
        this.action.set(null);
      },
      error: (err) => {
        const msg = err?.error?.detail || this.translate.instant('adminUi.orders.tags.errors.remove');
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

  partialRefundMaxQty(it: AdminOrderDetail['items'][number]): number {
    const ordered = Number(it.quantity ?? 0);
    const already = this.partialRefundAlreadyRefundedQty(it.id);
    const remaining = ordered - already;
    return remaining > 0 ? remaining : 0;
  }

  private partialRefundAlreadyRefundedQty(orderItemId: string): number {
    const refunds = this.order()?.refunds ?? [];
    let qty = 0;
    for (const refund of refunds) {
      const items = (refund?.data as any)?.items;
      if (!Array.isArray(items)) continue;
      for (const row of items) {
        if (!row) continue;
        if (String((row as any).order_item_id ?? '') !== orderItemId) continue;
        const q = Number((row as any).quantity ?? 0);
        if (Number.isFinite(q) && q > 0) qty += Math.trunc(q);
      }
    }
    return qty;
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
    this.partialRefundPassword = '';
    this.partialRefundProcessPayment = false;
    this.partialRefundQty = Object.fromEntries((o.items ?? []).map((it) => [it.id, 0]));
    this.partialRefundAmount = this.partialRefundSelectionTotal(o).toFixed(2);
    this.partialRefundWizardOpen.set(true);
  }

  closePartialRefundWizard(): void {
    this.partialRefundWizardOpen.set(false);
    this.partialRefundWizardError.set(null);
    this.partialRefundNote = '';
    this.partialRefundPassword = '';
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

    const password = this.partialRefundPassword.trim();
    if (!password) {
      this.partialRefundWizardError.set(this.translate.instant('adminUi.orders.partialRefundWizard.passwordRequired'));
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
        password,
        amount: amount.toFixed(2),
        note,
        items,
        process_payment: processPayment
      })
      .subscribe({
        next: () => {
          this.toast.success(this.translate.instant('adminUi.orders.success.partialRefund'));
          this.partialRefundNote = '';
          this.partialRefundPassword = '';
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
      }, { include_pii: this.piiReveal() })
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
    this.api.uploadShippingLabel(orderId, this.shippingLabelFile, { include_pii: this.piiReveal() }).subscribe({
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

  downloadReceiptPdf(): void {
    const orderId = this.orderId;
    if (!orderId) return;
    this.action.set('receiptPdf');
    this.api.downloadReceiptPdf(orderId).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `receipt-${this.orderRef() || orderId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        this.action.set(null);
      },
      error: () => {
        this.toast.error(this.translate.instant('adminUi.orders.errors.receiptPdf'));
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
    this.errorRequestId.set(null);
    this.receiptShare.set(null);
    this.adminNoteError.set(null);
    this.api.get(orderId, { include_pii: this.piiReveal() }).subscribe({
      next: (o) => {
        this.order.set(o);
        const ref = o.reference_code || o.id.slice(0, 8);
        const email = (o.customer_email || '').toString().trim();
        this.recent.add({
          key: `order:${o.id}`,
          type: 'order',
          label: ref,
          subtitle: email,
          url: `/admin/orders/${o.id}`,
          state: null
        });
        this.statusValue = (o.status as OrderStatus) || 'pending_acceptance';
        this.trackingNumber = o.tracking_number ?? '';
        this.trackingUrl = o.tracking_url ?? '';
        this.cancelReason = o.cancel_reason ?? '';
        this.returnQty = {};
        this.fulfillmentQty = {};
        (o.items || []).forEach((it) => (this.returnQty[it.id] = 0));
        (o.items || []).forEach((it) => (this.fulfillmentQty[it.id] = Number(it.shipped_quantity ?? 0)));
        this.loadReturns(o.id);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(this.translate.instant('adminUi.orders.errors.load'));
        this.errorRequestId.set(extractRequestId(err));
        this.loading.set(false);
      }
    });
  }

  retryLoad(): void {
    const orderId = this.orderId;
    if (!orderId) return;
    this.load(orderId);
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
