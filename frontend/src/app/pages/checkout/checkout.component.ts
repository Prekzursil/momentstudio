import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { CartStore } from '../../core/cart.store';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';

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
                <input type="radio" name="checkoutMode" value="login" [(ngModel)]="mode" required /> Login to continue
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
              <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em]">Step 5 · Payment (Stripe placeholder)</p>
              <label class="text-sm grid gap-1">
                Card number
                <input class="rounded-lg border border-slate-200 px-3 py-2" placeholder="4242 4242 4242 4242" required />
              </label>
              <div class="grid grid-cols-2 gap-3">
                <label class="text-sm grid gap-1">
                  Expiry
                  <input class="rounded-lg border border-slate-200 px-3 py-2" placeholder="MM/YY" required />
                </label>
                <label class="text-sm grid gap-1">
                  CVC
                  <input class="rounded-lg border border-slate-200 px-3 py-2" placeholder="CVC" required />
                </label>
              </div>
              <p class="text-xs text-slate-500">Replace with real Stripe Elements integration in production.</p>
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
export class CheckoutComponent {
  crumbs = [
    { label: 'Home', url: '/' },
    { label: 'Cart', url: '/cart' },
    { label: 'Checkout' }
  ];
  mode: 'guest' | 'login' = 'guest';
  shipping: string = 'standard';
  promo = '';
  promoMessage = '';
  shippingMethods: ShippingMethod[] = [
    { id: 'standard', label: 'Standard', amount: 8, eta: '3-5 business days' },
    { id: 'express', label: 'Express', amount: 15, eta: '1-2 business days' }
  ];
  countries = ['United States', 'United Kingdom', 'Romania', 'Germany', 'France', 'Canada'];
  addressError = '';
  errorMessage = '';
  pricesRefreshed = false;
  saveAddress = true;
  address = {
    name: '',
    email: '',
    line1: '',
    city: '',
    postal: '',
    country: ''
  };
  discount = 0;

  constructor(private cart: CartStore, private router: Router) {
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
    if (this.promo.trim().toUpperCase() === 'SAVE10') {
      this.discount = Math.min(this.subtotal() * 0.1, 50);
      this.promoMessage = `Applied SAVE10: -${this.discount.toFixed(2)}`;
    } else {
      this.discount = 0;
      this.promoMessage = 'Invalid code';
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
    if (this.saveAddress) {
      this.persistAddress();
    }
    this.errorMessage = '';
    this.router.navigate(['/checkout/success']);
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
      const updated = items.map((item, idx) => (idx === 0 ? { ...item, price: item.price + 1 } : item));
      this.cart.seed(updated);
      this.pricesRefreshed = true;
      return 'Prices have changed. Totals refreshed; please review and submit again.';
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
}
