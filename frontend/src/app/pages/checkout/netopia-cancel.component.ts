import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { finalize, Subscription, TimeoutError, timeout } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CartStore } from '../../core/cart.store';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { ContainerComponent } from '../../layout/container.component';
import { LoadingStateComponent } from '../../shared/loading-state.component';

const CHECKOUT_NETOPIA_PENDING_KEY = 'checkout_netopia_pending';
const CANCEL_CONFIRM_TIMEOUT_MS = 15_000;

@Component({
  selector: 'app-netopia-cancel',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    TranslateModule,
    ContainerComponent,
    BreadcrumbComponent,
    ButtonComponent,
    LoadingStateComponent
  ],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <div
        *ngIf="checking"
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
      <div
        *ngIf="!checking"
        class="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
      >
        <p class="text-sm font-semibold tracking-[0.2em] uppercase">{{ 'checkout.netopiaReturnTitle' | translate }}</p>
        <h1 class="mt-3 text-xl font-semibold text-amber-900 dark:text-amber-100">
          {{ 'checkout.netopiaCancelled' | translate }}
        </h1>
        <p class="mt-2 text-sm text-amber-800 dark:text-amber-200">{{ 'checkout.netopiaCancelledCopy' | translate }}</p>
        <div class="mt-5 flex flex-wrap gap-3">
          <app-button routerLink="/checkout" [label]="'checkout.backToCheckout' | translate"></app-button>
          <app-button routerLink="/cart" variant="ghost" [label]="'checkout.backToCart' | translate"></app-button>
          <app-button routerLink="/contact" variant="ghost" [label]="'nav.contact' | translate"></app-button>
        </div>
      </div>
    </app-container>
  `
})
export class NetopiaCancelComponent implements OnInit, OnDestroy {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'checkout.title', url: '/checkout' },
    { label: 'checkout.netopiaCancelled' }
  ];

  checking = false;
  private orderId = '';
  private ntpId: string | null = null;
  private confirmSubscription: Subscription | null = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly api: ApiService,
    private readonly router: Router,
    private readonly cart: CartStore
  ) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem(CHECKOUT_NETOPIA_PENDING_KEY);
    } catch {
      // ignore
    }
  }

  ngOnInit(): void {
    this.orderId = this.route.snapshot.queryParamMap.get('order_id') || '';
    this.ntpId =
      this.route.snapshot.queryParamMap.get('ntp_id') ||
      this.route.snapshot.queryParamMap.get('ntpID') ||
      this.route.snapshot.queryParamMap.get('ntpId');

    if (!this.orderId) return;
    this.confirmPayment();
  }

  ngOnDestroy(): void {
    this.confirmSubscription?.unsubscribe();
    this.confirmSubscription = null;
  }

  private confirmPayment(): void {
    this.checking = true;
    const payload: { order_id: string; ntp_id?: string } = { order_id: this.orderId };
    if (this.ntpId) payload.ntp_id = this.ntpId;

    this.confirmSubscription?.unsubscribe();
    this.confirmSubscription = this.api
      .post<{ order_id: string; reference_code?: string; status: string }>('/orders/netopia/confirm', payload)
      .pipe(
        timeout({ first: CANCEL_CONFIRM_TIMEOUT_MS }),
        finalize(() => {
          this.checking = false;
          this.confirmSubscription = null;
        })
      )
      .subscribe({
        next: () => {
          this.cart.clear();
          void this.router.navigate(['/checkout/success']);
        },
        error: (err) => {
          if (err instanceof TimeoutError) return;
        }
      });
  }
}

