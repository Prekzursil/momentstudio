import { CommonModule } from '@angular/common';
import { Component, AfterViewInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
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

type ShippingMethod = { id: string; label: string; amount: number; eta: string };

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ContainerComponent, ButtonComponent, BreadcrumbComponent, LocalizedCurrencyPipe],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <div class="grid lg:grid-cols-[2fr_1fr] gap-6 items-start">
        <section class="grid gap-4">
          <h1 class="text-2xl font-semibold text-slate-900">Checkout</h1>
          <div
            *ngIf="errorMessage"
            class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-start justify-between gap-3"
          >
            <span>{{ errorMessage }}</span>
            <app-button size="sm" variant="ghost" label="Retry" (action)="retryValidation()"></app-button>
          </div>
          <form #checkoutForm="ngForm" class="grid gap-4" (ngSubmit)="placeOrder(checkoutForm)">
            <div class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em]">Step 1 · Who's checking out?</p>
              <label class="flex items-center gap-2 text-sm">
                <input type="radio" name="checkoutMode" value="guest" [(ngModel)]="mode" required /> Checkout as guest
              </label>
              <label class="flex items-center gap-2 text-sm">
                <input type="radio" name="checkoutMode" value="create" [(ngModel)]="mode" required /> Create account during checkout
              </label>
            </div>

            <div class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em]">Step 2 · Shipping address</p>
              <div class="grid sm:grid-cols-2 gap-3">
                <label class="text-sm grid gap-1">
                  Full name
                  <input class="rounded-lg border border-slate-200 px-3 py-2" name="name" [(ngModel)]="address.name" required />
                </label>
                <label class="text-sm grid gap-1">
                  Email
                  <input class="rounded-lg border border-slate-200 px-3 py-2" name="email" [(ngModel)]="address.email" type="email" required />
                </label>
                <label class="text-sm grid gap-1 sm:col-span-2">
                  Address line
                  <input class="rounded-lg border border-slate-200 px-3 py-2" name="line1" [(ngModel)]="address.line1" required />
                </label>
                <label class="text-sm grid gap-1">
                  City
                  <input class="rounded-lg border border-slate-200 px-3 py-2" name="city" [(ngModel)]="address.city" required />
                </label>
                <label class="text-sm grid gap-1">
                  Postal code
                  <input class="rounded-lg border border-slate-200 px-3 py-2" name="postal" [(ngModel)]="address.postal" required />
                </label>
                <label class="text-sm grid gap-1 sm:col-span-2">
                  Country
                  <select class="rounded-lg border border-slate-200 px-3 py-2" name="country" [(ngModel)]="address.country" required>
                    <option value="">Select a country</option>
                    <option *ngFor="let c of countries" [value]="c">{{ c }}</option>
                  </select>
                </label>
              </div>
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" [(ngModel)]="saveAddress" name="saveAddress" />
                Save this address for next time
              </label>
              <p *ngIf="addressError" class="text-sm text-amber-700">{{ addressError }}</p>
            </div>

            <div class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em]">Step 3 · Shipping method</p>
              <label
                *ngFor="let method of shippingMethods"
                class="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                [class.border-slate-900]="shipping === method.id"
              >
                <span class="flex flex-col">
                  <span class="font-semibold text-slate-900">{{ method.label }}</span>
                  <span class="text-slate-500">{{ method.eta }}</span>
                </span>
                <span class="flex items-center gap-3">
                  <span class="font-semibold text-slate-900">{{ method.amount | localizedCurrency : currency }}</span>
                  <input type="radio" name="shipping" [value]="method.id" [(ngModel)]="shipping" required />
                </span>
              </label>
            </div>

            <div class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em]">Step 4 · Promo code</p>
              <div class="flex gap-3">
                <input class="rounded-lg border border-slate-200 px-3 py-2 flex-1" [(ngModel)]="promo" name="promo" placeholder="Enter code" />
                <app-button size="sm" label="Apply" (action)="applyPromo()"></app-button>
              </div>
              <p class="text-sm" [class.text-emerald-700]="promoMessage.startsWith('Applied')" [class.text-amber-700]="promoMessage.startsWith('Invalid')" *ngIf="promoMessage">
                {{ promoMessage }}
              </p>
            </div>

            <div class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em]">Step 5 · Payment</p>
              <div class="border border-dashed border-slate-200 rounded-lg p-3 text-sm">
                <div #cardHost class="min-h-[48px]"></div>
                <p *ngIf="cardError" class="text-rose-700 text-xs mt-2">{{ cardError }}</p>
              </div>
            </div>

            <div class="flex gap-3">
              <app-button label="Place order" type="submit"></app-button>
              <app-button variant="ghost" label="Back to cart" routerLink="/cart"></app-button>
            </div>
          </form>
        </section>

        <aside class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4">
          <h2 class="text-lg font-semibold text-slate-900">Order summary</h2>
          <div class="grid gap-2 text-sm text-slate-700">
            <div *ngFor="let item of items()">
              <div class="flex justify-between">
                <span>{{ item.name }} × {{ item.quantity }}</span>
                <span>{{ item.price * item.quantity | localizedCurrency : item.currency }}</span>
              </div>
              <p class="text-xs text-slate-500">Stock: {{ item.stock }}</p>
            </div>
          </div>
          <div class="flex items-center justify-between text-sm text-slate-700">
            <span>Subtotal</span>
            <span>{{ subtotal() | localizedCurrency : currency }}</span>
          </div>
          <div class="flex items-center justify-between text-sm text-slate-700">
            <span>Shipping</span>
            <span>{{ shippingAmount | localizedCurrency : currency }}</span>
          </div>
          <div class="flex items-center justify-between text-sm text-slate-700">
            <span>Promo</span>
            <span class="text-emerald-700">-{{ discount | localizedCurrency : currency }}</span>
          </div>
          <div class="border-t border-slate-200 pt-3 flex items-center justify-between text-base font-semibold text-slate-900">
            <span>Estimated total</span>
            <span>{{ total | localizedCurrency : currency }}</span>
          </div>
        </aside>
      </div>
    </app-container>
  `
})
export class CheckoutComponent implements AfterViewInit, OnDestroy {
  crumbs = [
    { label: 'Home', url: '/' },
    { label: 'Cart', url: '/cart' },
    { label: 'Checkout' }
  ];
  mode: 'guest' | 'create' = 'guest';
  shipping: string = 'standard';
  promo = '';
  promoMessage = '';
  shippingMethods: ShippingMethod[] = [
    { id: 'standard', label: 'Standard', amount: 8, eta: '3-5 business days' },
    { id: 'express', label: 'Express', amount: 15, eta: '1-2 business days' }
  ];
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

  constructor(private cart: CartStore, private router: Router, private cartApi: CartApi, private api: ApiService) {
    const saved = this.loadSavedAddress();
    if (saved) {
      this.address = saved;
    }
  }

  items = this.cart.items;
  subtotal = this.cart.subtotal;
  currency = 'USD';

  get shippingAmount(): number {
    const found = this.shippingMethods.find((m) => m.id === this.shipping);
    return found ? found.amount : 0;
  }

  get total(): number {
    return this.subtotal() + this.shippingAmount - this.discount;
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
      this.addressError = 'Please complete all required fields.';
      return;
    }
    this.addressError = '';
    const validation = this.validateCart();
    if (validation) {
      this.errorMessage = validation;
      return;
    }
    if (!this.clientSecret) {
      this.errorMessage = 'Payment not initialized yet. Please wait.';
      return;
    }
    this.errorMessage = '';
    this.placing = true;
    this.confirmPayment()
      .then((paymentOk) => {
        if (!paymentOk) {
          this.placing = false;
          return;
        }
        this.submitCheckout();
      })
      .catch(() => {
        this.errorMessage = 'Payment failed.';
        this.placing = false;
      });
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
    await this.syncBackendCart(this.items());
    await this.loadPaymentIntent();
  }

  ngOnDestroy(): void {
    if (this.card) this.card.destroy();
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
    this.card = this.elements.create('card');
    if (this.cardHost) {
      this.card.mount(this.cardHost.nativeElement);
      this.card.on('change', (event: StripeCardElementChangeEvent) => {
        this.cardError = event.error ? event.error.message ?? 'Card error' : null;
      });
    }
  }

  private getStripePublishableKey(): string | null {
    const meta = document.querySelector('meta[name="stripe-publishable-key"]');
    return meta?.getAttribute('content') || null;
  }

  private async loadPaymentIntent(): Promise<void> {
    this.cartApi.paymentIntent().subscribe({
      next: (res) => {
        this.clientSecret = res.client_secret;
      },
      error: () => {
        this.errorMessage = 'Could not start payment';
      }
    });
  }

  private async confirmPayment(): Promise<boolean> {
    if (!this.stripe || !this.card || !this.clientSecret) {
      this.cardError = 'Payment form not ready';
      return false;
    }
    const result = await this.stripe.confirmCardPayment(this.clientSecret, {
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
      name: this.address.name,
      email: this.address.email,
      password: this.mode === 'create' ? this.address.password || undefined : undefined,
      create_account: this.mode === 'create',
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
        '/orders/guest-checkout',
        body,
        this.cartApi.headers()
      )
      .subscribe({
        next: () => {
          if (this.saveAddress) this.persistAddress();
          this.router.navigate(['/checkout/success']);
        },
        error: (err) => {
          this.errorMessage = err?.error?.detail || 'Checkout failed';
          this.placing = false;
        }
      });
  }
}
