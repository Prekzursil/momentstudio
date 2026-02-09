import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { finalize, Subscription, TimeoutError, timeout } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AnalyticsService } from '../../core/analytics.service';
import { CartStore } from '../../core/cart.store';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ContainerComponent } from '../../layout/container.component';
import { CheckoutReturnErrorCardComponent } from './checkout-return-error-card.component';

const CHECKOUT_SUCCESS_KEY = 'checkout_last_order';
const CHECKOUT_STRIPE_PENDING_KEY = 'checkout_stripe_pending';
const RETURN_CONFIRM_TIMEOUT_MS = 30_000;

type MockOutcome = 'success' | 'decline';

@Component({
  selector: 'app-stripe-return',
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    ContainerComponent,
    BreadcrumbComponent,
    CheckoutReturnErrorCardComponent
  ],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <div
        *ngIf="loading"
        class="rounded-2xl border border-slate-200 bg-white p-6 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <p class="text-sm font-semibold tracking-[0.2em] uppercase text-slate-600 dark:text-slate-300">
          {{ 'checkout.stripeReturnTitle' | translate }}
        </p>
        <p class="mt-3 text-sm text-slate-700 dark:text-slate-200">{{ 'checkout.stripeConfirming' | translate }}</p>
      </div>

      <app-checkout-return-error-card
        *ngIf="!loading && errorMessage"
        [titleKey]="'checkout.stripeReturnTitle'"
        [message]="errorMessage"
        (retry)="retry()"
      ></app-checkout-return-error-card>
    </app-container>
  `
})
export class StripeReturnComponent implements OnInit, OnDestroy {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'checkout.title', url: '/checkout' },
    { label: 'checkout.stripeReturnTitle' }
  ];

  loading = true;
  errorMessage = '';
  private sessionId = '';
  private mock: MockOutcome | null = null;
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
    const raw = localStorage.getItem(CHECKOUT_STRIPE_PENDING_KEY);
    if (!raw) return;
    try {
      localStorage.setItem(CHECKOUT_SUCCESS_KEY, raw);
      localStorage.removeItem(CHECKOUT_STRIPE_PENDING_KEY);
    } catch {
      // best-effort only
    }
  }

  private pendingOrderId(): string | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CHECKOUT_STRIPE_PENDING_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { order_id?: unknown } | null;
      return typeof parsed?.order_id === 'string' ? parsed.order_id : null;
    } catch {
      return null;
    }
  }

  ngOnInit(): void {
    this.sessionId = this.route.snapshot.queryParamMap.get('session_id') || '';
    const mockRaw = (this.route.snapshot.queryParamMap.get('mock') || '').toLowerCase();
    if (mockRaw === 'success' || mockRaw === 'decline') {
      this.mock = mockRaw;
    }
    if (!this.sessionId) {
      this.loading = false;
      this.errorMessage = this.translate.instant('checkout.stripeMissingSession');
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
    if (!this.sessionId) return;
    this.confirmPayment();
  }

  private confirmPayment(): void {
    const sessionId = this.sessionId;
    this.loading = true;
    this.errorMessage = '';

    const orderId = this.pendingOrderId();
    const payload: { session_id: string; order_id?: string; mock?: MockOutcome } = { session_id: sessionId };
    if (orderId) payload.order_id = orderId;
    if (this.mock) payload.mock = this.mock;

    const startedAt = Date.now();
    this.confirmSubscription?.unsubscribe();
    this.confirmSubscription = this.api
      .post<{ order_id: string; reference_code?: string; status: string }>('/orders/stripe/confirm', payload)
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
              provider: 'stripe',
              route: 'checkout/stripe/return',
              timeout_ms: RETURN_CONFIRM_TIMEOUT_MS,
              elapsed_ms: Date.now() - startedAt
            });
            return;
          }
          this.errorMessage = this.resolveErrorMessage(err, 'checkout.stripeConfirmFailed');
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
