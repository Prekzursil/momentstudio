import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { finalize, Subscription, TimeoutError, timeout } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AnalyticsService } from '../../core/analytics.service';
import { CartStore } from '../../core/cart.store';
import { ContainerComponent } from '../../layout/container.component';
import { CheckoutReturnErrorCardComponent } from './checkout-return-error-card.component';
import { PageHeaderComponent } from '../../shared/page-header.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';

const CHECKOUT_SUCCESS_KEY = 'checkout_last_order';
const CHECKOUT_NETOPIA_PENDING_KEY = 'checkout_netopia_pending';
const RETURN_CONFIRM_TIMEOUT_MS = 30_000;

@Component({
  selector: 'app-netopia-return',
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    ContainerComponent,
    CheckoutReturnErrorCardComponent,
    PageHeaderComponent,
    LoadingStateComponent
  ],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-page-header [crumbs]="crumbs" [titleKey]="'checkout.netopiaReturnTitle'"></app-page-header>

      <div
        *ngIf="loading"
        class="rounded-2xl border border-slate-200 bg-white p-6 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <p class="text-sm font-semibold tracking-[0.2em] uppercase text-slate-600 dark:text-slate-300">
          {{ 'checkout.netopiaReturnTitle' | translate }}
        </p>
        <p class="mt-3 text-sm text-slate-700 dark:text-slate-200">{{ 'checkout.netopiaConfirming' | translate }}</p>
        <div class="mt-4">
          <app-loading-state [rows]="1"></app-loading-state>
        </div>
      </div>

      <app-checkout-return-error-card
        *ngIf="!loading && errorMessage"
        [titleKey]="'checkout.netopiaReturnTitle'"
        [message]="errorMessage"
        (retry)="retry()"
      ></app-checkout-return-error-card>
    </app-container>
  `
})
export class NetopiaReturnComponent implements OnInit, OnDestroy {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'checkout.title', url: '/checkout' },
    { label: 'checkout.netopiaReturnTitle' }
  ];

  loading = true;
  errorMessage = '';
  private orderId = '';
  private ntpId: string | null = null;
  private confirmSubscription: Subscription | null = null;

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private router: Router,
    private translate: TranslateService,
    private cart: CartStore,
    private analytics: AnalyticsService
  ) {}

  private promotePendingSummary(): void {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(CHECKOUT_NETOPIA_PENDING_KEY);
    if (!raw) return;
    try {
      localStorage.setItem(CHECKOUT_SUCCESS_KEY, raw);
      localStorage.removeItem(CHECKOUT_NETOPIA_PENDING_KEY);
    } catch {
      // best-effort only
    }
  }

  ngOnInit(): void {
    this.orderId = this.route.snapshot.queryParamMap.get('order_id') || '';
    this.ntpId =
      this.route.snapshot.queryParamMap.get('ntp_id') ||
      this.route.snapshot.queryParamMap.get('ntpID') ||
      this.route.snapshot.queryParamMap.get('ntpId');

    if (!this.orderId) {
      this.loading = false;
      this.errorMessage = this.translate.instant('checkout.netopiaMissingOrder');
      return;
    }
    this.confirmPayment();
  }

  ngOnDestroy(): void {
    this.confirmSubscription?.unsubscribe();
    this.confirmSubscription = null;
  }

  retry(): void {
    if (this.loading) return;
    if (!this.orderId) return;
    this.confirmPayment();
  }

  private confirmPayment(): void {
    this.loading = true;
    this.errorMessage = '';

    const payload: { order_id: string; ntp_id?: string } = { order_id: this.orderId };
    if (this.ntpId) payload.ntp_id = this.ntpId;

    const startedAt = Date.now();
    this.confirmSubscription?.unsubscribe();
    this.confirmSubscription = this.api
      .post<{ order_id: string; reference_code?: string; status: string }>('/orders/netopia/confirm', payload)
      .pipe(
        timeout({ first: RETURN_CONFIRM_TIMEOUT_MS }),
        finalize(() => {
          this.loading = false;
          this.confirmSubscription = null;
        })
      )
      .subscribe({
        next: () => {
          this.promotePendingSummary();
          this.cart.clear();
          void this.router.navigate(['/checkout/success']);
        },
        error: (err) => {
          if (err instanceof TimeoutError) {
            this.errorMessage = this.translate.instant('checkout.paymentConfirmTimeout');
            this.analytics.track('confirm_stuck_timeout', {
              provider: 'netopia',
              route: 'checkout/netopia/return',
              timeout_ms: RETURN_CONFIRM_TIMEOUT_MS,
              elapsed_ms: Date.now() - startedAt
            });
            return;
          }
          this.errorMessage = this.resolveErrorMessage(err, 'checkout.netopiaConfirmFailed');
        }
      });
  }

  private resolveErrorMessage(err: any, fallbackKey: string): string {
    const detail = typeof err?.error?.detail === 'string' ? err.error.detail.trim() : '';
    if (detail) return detail;

    const message = typeof err?.message === 'string' ? err.message.trim() : '';
    if (message && !message.toLowerCase().includes('http failure response')) return message;

    return this.translate.instant(fallbackKey);
  }
}
