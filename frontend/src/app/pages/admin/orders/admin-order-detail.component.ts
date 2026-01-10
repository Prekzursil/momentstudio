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

type OrderStatus = 'pending' | 'paid' | 'shipped' | 'cancelled' | 'refunded';

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
              </div>
              <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <div class="text-xs font-semibold tracking-wide uppercase text-slate-500 dark:text-slate-400">{{ 'adminUi.orders.tracking' | translate }}</div>
                <div class="mt-1 font-semibold text-slate-900 dark:text-slate-50 truncate">
                  {{ order()!.tracking_number || '—' }}
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
                  <option value="cancelled">{{ 'adminUi.orders.cancelled' | translate }}</option>
                  <option value="refunded">{{ 'adminUi.orders.refunded' | translate }}</option>
                </select>
              </label>

              <app-input [label]="'adminUi.orders.trackingNumber' | translate" [(value)]="trackingNumber"></app-input>
            </div>

	            <div class="flex items-center gap-2">
	              <app-button size="sm" [label]="'adminUi.orders.save' | translate" (action)="save()"></app-button>
	              <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'adminUi.orders.saveHint' | translate }}</span>
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

  statusValue: OrderStatus = 'pending';
  trackingNumber = '';

  constructor(
    private route: ActivatedRoute,
    private api: AdminOrdersService,
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

  save(): void {
    const orderId = this.order()?.id;
    if (!orderId) return;
    this.api
      .update(orderId, { status: this.statusValue, tracking_number: this.trackingNumber.trim() || null })
      .subscribe({
        next: (o) => {
          this.order.set(o);
          this.statusValue = (o.status as OrderStatus) || 'pending';
          this.trackingNumber = o.tracking_number ?? '';
          this.toast.success(this.translate.instant('adminUi.orders.success.status'));
        },
        error: () => this.toast.error(this.translate.instant('adminUi.orders.errors.status'))
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
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.translate.instant('adminUi.orders.errors.load'));
        this.loading.set(false);
      }
    });
  }
}
