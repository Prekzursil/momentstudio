import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { CartStore } from '../../core/cart.store';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';

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
          <div class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em]">Step 1 · Who's checking out?</p>
            <label class="flex items-center gap-2 text-sm">
              <input type="radio" name="checkoutMode" value="guest" [(ngModel)]="mode" /> Checkout as guest
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input type="radio" name="checkoutMode" value="login" [(ngModel)]="mode" /> Login to continue
            </label>
          </div>

          <div class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em]">Step 2 · Shipping address</p>
            <div class="grid sm:grid-cols-2 gap-3">
              <label class="text-sm grid gap-1">
                Full name
                <input class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="address.name" />
              </label>
              <label class="text-sm grid gap-1">
                Email
                <input class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="address.email" type="email" />
              </label>
              <label class="text-sm grid gap-1">
                Address line
                <input class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="address.line1" />
              </label>
              <label class="text-sm grid gap-1">
                City
                <input class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="address.city" />
              </label>
              <label class="text-sm grid gap-1">
                Postal code
                <input class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="address.postal" />
              </label>
              <label class="text-sm grid gap-1">
                Country
                <input class="rounded-lg border border-slate-200 px-3 py-2" [(ngModel)]="address.country" />
              </label>
            </div>
          </div>

          <div class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em]">Step 3 · Payment</p>
            <label class="flex items-center gap-2 text-sm">
              <input type="radio" name="payment" value="card" [(ngModel)]="payment" /> Card via Stripe
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input type="radio" name="payment" value="cod" [(ngModel)]="payment" /> Cash on delivery (placeholder)
            </label>
          </div>

          <div class="flex gap-3">
            <app-button label="Place order" (action)="placeOrder()"></app-button>
            <app-button variant="ghost" label="Back to cart" routerLink="/cart"></app-button>
          </div>
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
            <span class="text-slate-500">$8 (placeholder)</span>
          </div>
          <div class="flex items-center justify-between text-sm text-slate-700">
            <span>Tax</span>
            <span class="text-slate-500">$0 (placeholder)</span>
          </div>
          <div class="border-t border-slate-200 pt-3 flex items-center justify-between text-base font-semibold text-slate-900">
            <span>Estimated total</span>
            <span>{{ (subtotal() + 8) | localizedCurrency : currency }}</span>
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
  payment: 'card' | 'cod' = 'card';
  address = {
    name: '',
    email: '',
    line1: '',
    city: '',
    postal: '',
    country: ''
  };

  constructor(private cart: CartStore) {}

  items = this.cart.items;
  subtotal = this.cart.subtotal;
  currency = 'USD';

  placeOrder(): void {
    // Placeholder: in a real app, call backend checkout.
  }
}
