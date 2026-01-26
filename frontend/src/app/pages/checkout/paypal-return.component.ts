import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { CartStore } from '../../core/cart.store';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { ContainerComponent } from '../../layout/container.component';

const CHECKOUT_SUCCESS_KEY = 'checkout_last_order';
const CHECKOUT_PAYPAL_PENDING_KEY = 'checkout_paypal_pending';

@Component({
  selector: 'app-paypal-return',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, ContainerComponent, BreadcrumbComponent, ButtonComponent],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <div
        *ngIf="loading"
        class="rounded-2xl border border-slate-200 bg-white p-6 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <p class="text-sm font-semibold tracking-[0.2em] uppercase text-slate-600 dark:text-slate-300">
          {{ 'checkout.paypalReturnTitle' | translate }}
        </p>
        <p class="mt-3 text-sm text-slate-700 dark:text-slate-200">{{ 'checkout.paypalCapturing' | translate }}</p>
      </div>

	      <div
	        *ngIf="!loading && errorMessage"
	        class="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
	      >
	        <p class="text-sm font-semibold tracking-[0.2em] uppercase">{{ 'checkout.paypalReturnTitle' | translate }}</p>
	        <p class="mt-3 text-sm">{{ errorMessage }}</p>
	        <div class="mt-5 flex flex-wrap gap-3">
	          <app-button [label]="'checkout.retry' | translate" (action)="retry()"></app-button>
	          <app-button routerLink="/checkout" variant="ghost" [label]="'checkout.backToCheckout' | translate"></app-button>
	          <app-button routerLink="/contact" variant="ghost" [label]="'nav.contact' | translate"></app-button>
	        </div>
	      </div>
	    </app-container>
	  `
})
export class PayPalReturnComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'checkout.title', url: '/checkout' },
    { label: 'checkout.paypalReturnTitle' }
  ];

  loading = true;
  errorMessage = '';
  private token = '';

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private router: Router,
    private translate: TranslateService,
    private cart: CartStore
  ) {}

  private promotePendingSummary(): void {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(CHECKOUT_PAYPAL_PENDING_KEY);
    if (!raw) return;
    try {
      localStorage.setItem(CHECKOUT_SUCCESS_KEY, raw);
      localStorage.removeItem(CHECKOUT_PAYPAL_PENDING_KEY);
    } catch {
      // best-effort only
    }
  }

  private pendingOrderId(): string | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CHECKOUT_PAYPAL_PENDING_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { order_id?: unknown } | null;
      return typeof parsed?.order_id === 'string' ? parsed.order_id : null;
    } catch {
      return null;
    }
  }

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
    if (!this.token) {
      this.loading = false;
      this.errorMessage = this.translate.instant('checkout.paypalMissingToken');
      return;
    }
    this.capturePayment();
  }

  retry(): void {
    if (this.loading) return;
    if (!this.token) return;
    this.capturePayment();
  }

  private capturePayment(): void {
    const token = this.token;
    this.loading = true;
    this.errorMessage = '';

    const orderId = this.pendingOrderId();
    const payload: { paypal_order_id: string; order_id?: string } = { paypal_order_id: token };
    if (orderId) payload.order_id = orderId;

    this.api
      .post<{ order_id: string; reference_code?: string; status: string; paypal_capture_id?: string | null }>(
        '/orders/paypal/capture',
        payload
      )
      .subscribe({
        next: () => {
          this.loading = false;
          this.promotePendingSummary();
          this.cart.clear();
          void this.router.navigate(['/checkout/success']);
        },
        error: (err) => {
          this.loading = false;
          this.errorMessage = err?.error?.detail || this.translate.instant('checkout.paypalCaptureFailed');
        }
      });
  }
}
