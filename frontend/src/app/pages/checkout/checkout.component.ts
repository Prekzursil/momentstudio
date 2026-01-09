import { CommonModule } from '@angular/common';
import { Component, AfterViewInit, OnDestroy, ViewChild, ElementRef, effect, EffectRef } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { CartStore, CartItem } from '../../core/cart.store';
import { CartApi } from '../../core/cart.api';
import { loadStripe, Stripe, StripeElements, StripeCardElement, StripeCardElementChangeEvent } from '@stripe/stripe-js';
import { ApiService } from '../../core/api.service';
import { appConfig } from '../../core/app-config';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ThemeMode, ThemeService } from '../../core/theme.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ContainerComponent, ButtonComponent, BreadcrumbComponent, LocalizedCurrencyPipe, TranslateModule],
  template: `
	    <app-container classes="py-10 grid gap-6">
	      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
	      <div class="grid lg:grid-cols-[2fr_1fr] gap-6 items-start" *ngIf="auth.isAuthenticated(); else authRequiredTpl">
	        <section class="grid gap-4">
	          <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'checkout.title' | translate }}</h1>
	          <div
	            *ngIf="errorMessage"
            class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-start justify-between gap-3 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
	          >
	            <span>{{ errorMessage }}</span>
	            <app-button size="sm" variant="ghost" [label]="'checkout.retry' | translate" (action)="retryValidation()"></app-button>
	          </div>
	          <div
	            *ngIf="auth.isAuthenticated() && !emailVerified()"
	            class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-start justify-between gap-3 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
	          >
	            <span>{{ 'auth.emailVerificationNeeded' | translate }}</span>
	            <app-button size="sm" variant="ghost" [label]="'auth.emailVerificationConfirm' | translate" routerLink="/account"></app-button>
	          </div>
	          <form #checkoutForm="ngForm" class="grid gap-4" (ngSubmit)="placeOrder(checkoutForm)">
	            <div class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	              <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em] dark:text-slate-200">{{ 'checkout.step2' | translate }}</p>
	              <div class="grid sm:grid-cols-2 gap-3">
                <label class="text-sm grid gap-1">
                  {{ 'checkout.name' | translate }}
                  <input class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400" name="name" [(ngModel)]="address.name" required />
                </label>
                <label class="text-sm grid gap-1">
                  {{ 'checkout.email' | translate }}
                  <input class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400" name="email" [(ngModel)]="address.email" type="email" required />
                </label>
                <label class="text-sm grid gap-1 sm:col-span-2">
                  {{ 'checkout.line1' | translate }}
                  <input class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400" name="line1" [(ngModel)]="address.line1" required />
                </label>
                <label class="text-sm grid gap-1">
                  {{ 'checkout.city' | translate }}
                  <input class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400" name="city" [(ngModel)]="address.city" required />
                </label>
                <label class="text-sm grid gap-1">
                  {{ 'checkout.postal' | translate }}
                  <input class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400" name="postal" [(ngModel)]="address.postal" required />
                </label>
                <label class="text-sm grid gap-1 sm:col-span-2">
                  {{ 'checkout.country' | translate }}
                  <select class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" name="country" [(ngModel)]="address.country" required>
                    <option value="">{{ 'checkout.countrySelect' | translate }}</option>
                    <option *ngFor="let c of countries" [value]="c">{{ c }}</option>
                  </select>
                </label>
              </div>
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" [(ngModel)]="saveAddress" name="saveAddress" />
                {{ 'checkout.saveAddress' | translate }}
              </label>
	              <p *ngIf="addressError" class="text-sm text-amber-700 dark:text-amber-300">{{ addressError }}</p>
	            </div>

	            <div class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	              <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em] dark:text-slate-200">{{ 'checkout.step4' | translate }}</p>
	              <div class="flex gap-3">
                <input
                  class="rounded-lg border border-slate-200 bg-white px-3 py-2 flex-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                  [(ngModel)]="promo"
                  name="promo"
                  [placeholder]="'checkout.promoPlaceholder' | translate"
                />
                <app-button size="sm" [label]="'checkout.apply' | translate" (action)="applyPromo()"></app-button>
              </div>
              <p
                class="text-sm"
                [ngClass]="
                  promoMessage.startsWith('Applied')
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : promoMessage.startsWith('Invalid')
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-slate-700 dark:text-slate-300'
                "
                *ngIf="promoMessage"
              >
                {{ promoMessage }}
              </p>
            </div>

            <div class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em] dark:text-slate-200">{{ 'checkout.step5' | translate }}</p>
              <div class="border border-dashed border-slate-200 rounded-lg p-3 text-sm dark:border-slate-700">
                <div #cardHost class="min-h-[48px]"></div>
                <p *ngIf="cardError" class="text-rose-700 dark:text-rose-300 text-xs mt-2">{{ cardError }}</p>
              </div>
            </div>

            <div class="flex gap-3">
              <app-button [label]="'checkout.placeOrder' | translate" type="submit"></app-button>
              <app-button variant="ghost" [label]="'checkout.backToCart' | translate" routerLink="/cart"></app-button>
            </div>
          </form>
        </section>

        <aside class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'checkout.summary' | translate }}</h2>
          <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
            <div *ngFor="let item of items()">
              <div class="flex justify-between">
                <span>{{ item.name }} × {{ item.quantity }}</span>
                <span>{{ item.price * item.quantity | localizedCurrency : item.currency }}</span>
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400">Stock: {{ item.stock }}</p>
            </div>
          </div>
          <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
            <span>{{ 'checkout.subtotal' | translate }}</span>
            <span>{{ subtotal() | localizedCurrency : currency }}</span>
          </div>
	          <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
	            <span>{{ 'checkout.shipping' | translate }}</span>
	            <span>{{ 0 | localizedCurrency : currency }}</span>
	          </div>
          <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
            <span>{{ 'checkout.promo' | translate }}</span>
            <span class="text-emerald-700 dark:text-emerald-300">-{{ discount | localizedCurrency : currency }}</span>
          </div>
          <div class="border-t border-slate-200 pt-3 flex items-center justify-between text-base font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-50">
            <span>{{ 'checkout.estimatedTotal' | translate }}</span>
            <span>{{ total | localizedCurrency : currency }}</span>
          </div>
	        </aside>
	      </div>
	      <ng-template #authRequiredTpl>
	        <section class="grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
	          <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'checkout.title' | translate }}</h1>
	          <p class="text-sm text-slate-700 dark:text-slate-200">{{ 'auth.haveAccount' | translate }}</p>
	          <div class="flex flex-wrap gap-3">
	            <app-button [label]="'auth.login' | translate" routerLink="/login"></app-button>
	            <app-button variant="ghost" [label]="'auth.register' | translate" routerLink="/register"></app-button>
	          </div>
	        </section>
	      </ng-template>
	    </app-container>
	  `
})
export class CheckoutComponent implements AfterViewInit, OnDestroy {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.cart', url: '/cart' },
    { label: 'checkout.title' }
  ];
  promo = '';
  promoMessage = '';
  countries = ['US', 'GB', 'RO', 'DE', 'FR', 'CA'];
  addressError = '';
  errorMessage = '';
  pricesRefreshed = false;
  saveAddress = true;
  address: { name: string; email: string; line1: string; line2?: string; city: string; region?: string; postal: string; country: string; password?: string } = {
    name: '',
    email: '',
    line1: '',
    line2: '',
    city: '',
    region: '',
    postal: '',
    country: '',
    password: ''
  };
  discount = 0;

  @ViewChild('cardHost') cardHost?: ElementRef<HTMLDivElement>;
  cardError: string | null = null;
  private stripe: Stripe | null = null;
  private elements?: StripeElements;
  private card?: StripeCardElement;
  private clientSecret: string | null = null;
  syncing = false;
  placing = false;
  private stripeThemeEffect?: EffectRef;

  constructor(
    private cart: CartStore,
    private router: Router,
    private cartApi: CartApi,
    private api: ApiService,
    private translate: TranslateService,
    private theme: ThemeService,
    public auth: AuthService
  ) {
    const saved = this.loadSavedAddress();
    if (saved) {
      this.address = saved;
    }
    this.stripeThemeEffect = effect(() => {
      const mode = this.theme.mode()();
      if (this.card) {
        this.card.update({ style: this.buildStripeCardStyle(mode) });
      }
    });
  }

  items = this.cart.items;
  subtotal = this.cart.subtotal;
  currency = 'RON';

  emailVerified(): boolean {
    return Boolean(this.auth.user()?.email_verified);
  }

  get total(): number {
    return this.subtotal() - this.discount;
  }

  applyPromo(): void {
    // promo validated backend-side during checkout; keep simple client message
    if (this.promo.trim()) {
      this.promoMessage = `Promo ${this.promo.trim().toUpperCase()} will be validated at checkout.`;
    } else {
      this.promoMessage = '';
    }
  }

  placeOrder(form: NgForm): void {
    if (!form.valid) {
      this.addressError = this.translate.instant('checkout.addressRequired');
      return;
    }
    this.addressError = '';
    if (!this.emailVerified()) {
      this.errorMessage = this.translate.instant('auth.emailVerificationNeeded');
      return;
    }
    const validation = this.validateCart();
    if (validation) {
      this.errorMessage = validation;
      return;
    }
    this.errorMessage = '';
    this.placing = true;
    this.submitCheckout();
  }

  retryValidation(): void {
    this.errorMessage = '';
    this.validateCart(true);
  }

  private validateCart(forceRefresh = false): string | null {
    const items = this.items();
    const stockIssue = items.find((i) => i.quantity > i.stock);
    if (stockIssue) {
      return `Only ${stockIssue.stock} left of ${stockIssue.name}. Please reduce quantity.`;
    }
    if (!this.pricesRefreshed || forceRefresh) {
      this.syncBackendCart(items);
      this.pricesRefreshed = true;
      return null;
    }
    return null;
  }

  private persistAddress(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('checkout_address', JSON.stringify(this.address));
  }

  private loadSavedAddress():
    | {
        name: string;
        email: string;
        line1: string;
        city: string;
        postal: string;
        country: string;
      }
    | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem('checkout_address');
      return raw ? (JSON.parse(raw) as typeof this.address) : null;
    } catch {
      return null;
    }
  }

  async ngAfterViewInit(): Promise<void> {
    await this.setupStripe();
    this.syncBackendCart(this.items());
  }

  ngOnDestroy(): void {
    if (this.card) this.card.destroy();
    this.stripeThemeEffect?.destroy();
  }

  private async setupStripe(): Promise<void> {
    const publishableKey = this.getStripePublishableKey();
    if (!publishableKey) {
      this.cardError = 'Stripe publishable key not set.';
      return;
    }
    this.stripe = await loadStripe(publishableKey);
    if (!this.stripe) {
      this.cardError = 'Could not init Stripe';
      return;
    }
    this.elements = this.stripe.elements();
    this.card = this.elements.create('card', { style: this.buildStripeCardStyle(this.theme.mode()()) });
    if (this.cardHost) {
      this.card.mount(this.cardHost.nativeElement);
      this.card.on('change', (event: StripeCardElementChangeEvent) => {
        this.cardError = event.error ? event.error.message ?? 'Card error' : null;
      });
    }
  }

  private buildStripeCardStyle(mode: ThemeMode) {
    const base =
      mode === 'dark'
        ? {
            color: '#f8fafc',
            iconColor: '#f8fafc',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '16px',
            '::placeholder': { color: '#94a3b8' }
          }
        : {
            color: '#0f172a',
            iconColor: '#0f172a',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '16px',
            '::placeholder': { color: '#64748b' }
          };
    return {
      base,
      invalid: {
        color: mode === 'dark' ? '#fca5a5' : '#b91c1c'
      }
    };
  }

  private getStripePublishableKey(): string | null {
    return appConfig.stripePublishableKey || null;
  }

  private async confirmPayment(clientSecret: string): Promise<boolean> {
    if (!this.stripe || !this.card) {
      this.cardError = 'Payment form not ready';
      return false;
    }
    const result = await this.stripe.confirmCardPayment(clientSecret, {
      payment_method: { card: this.card, billing_details: { name: this.address.name, email: this.address.email } }
    });
    if (result.error) {
      this.cardError = result.error.message ?? 'Payment failed';
      return false;
    }
    return true;
  }

  private syncBackendCart(items: CartItem[]): void {
    this.syncing = true;
    this.cartApi
      .sync(
        items.map((i) => ({
          product_id: i.product_id,
          variant_id: i.variant_id,
          quantity: i.quantity,
          note: undefined,
          max_quantity: undefined
        }))
      )
      .subscribe({
        next: () => (this.syncing = false),
      error: () => {
        this.syncing = false;
        this.errorMessage = 'Could not sync cart with server';
      }
    });
  }

  private submitCheckout(): void {
    const body = {
      line1: this.address.line1,
      line2: this.address.line2,
      city: this.address.city,
      region: this.address.region,
      postal_code: this.address.postal,
      country: this.address.country || 'US',
      shipping_method_id: null,
      promo_code: this.promo || null,
      save_address: this.saveAddress
    };
    this.api
      .post<{ order_id: string; reference_code?: string; client_secret: string }>(
        '/orders/checkout',
        body,
        this.cartApi.headers()
      )
      .subscribe({
        next: (res) => {
          this.clientSecret = res.client_secret;
          this.confirmPayment(res.client_secret)
            .then((paymentOk) => {
              if (!paymentOk) {
                this.placing = false;
                return;
              }
              if (this.saveAddress) this.persistAddress();
              void this.router.navigate(['/checkout/success']);
            })
            .catch(() => {
              this.errorMessage = this.translate.instant('checkout.paymentFailed');
              this.placing = false;
            });
        },
        error: (err) => {
          this.errorMessage = err?.error?.detail || 'Checkout failed';
          this.placing = false;
        }
      });
  }
}
