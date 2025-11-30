import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { CartStore } from '../../core/cart.store';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, RouterLink, ContainerComponent, ButtonComponent, BreadcrumbComponent, LocalizedCurrencyPipe],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <div class="grid lg:grid-cols-[2fr_1fr] gap-6 items-start">
        <section class="grid gap-4">
          <div class="flex items-center justify-between">
            <h1 class="text-2xl font-semibold text-slate-900">Your cart</h1>
            <span class="text-sm text-slate-600">{{ items().length }} item(s)</span>
          </div>

          <div *ngIf="!items().length" class="border border-dashed border-slate-200 rounded-2xl p-10 text-center grid gap-3">
            <p class="text-lg font-semibold text-slate-900">Your cart is empty</p>
            <p class="text-sm text-slate-600">Browse the shop to add items.</p>
            <div class="flex justify-center">
              <app-button routerLink="/shop" label="Back to shop"></app-button>
            </div>
          </div>

          <div *ngFor="let item of items()" class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div class="flex gap-4">
              <img
                [src]="item.image ?? 'https://via.placeholder.com/120'"
                [alt]="item.name"
                class="h-24 w-24 rounded-xl object-cover border border-slate-100"
              />
              <div class="flex-1 grid gap-2">
                <div class="flex items-start justify-between">
                  <div>
                    <p class="font-semibold text-slate-900">{{ item.name }}</p>
                    <p class="text-sm text-slate-500">In stock: {{ item.stock }}</p>
                  </div>
                  <button class="text-sm text-slate-500 hover:text-slate-900" (click)="remove(item.id)">Remove</button>
                </div>
                <div class="flex items-center gap-3 text-sm">
                  <label class="flex items-center gap-2">
                    Qty
                    <input
                      type="number"
                      class="w-20 rounded-lg border border-slate-200 px-2 py-1"
                      [value]="item.quantity"
                      (change)="onQuantityChange(item.id, $any($event.target).value)"
                      min="1"
                      [max]="item.stock"
                    />
                  </label>
                  <span class="text-slate-600">
                    {{ item.price | localizedCurrency : item.currency }} each
                  </span>
                  <span class="font-semibold text-slate-900">
                    {{ item.price * item.quantity | localizedCurrency : item.currency }}
                  </span>
                </div>
                <p *ngIf="errorMsg" class="text-sm text-amber-700">{{ errorMsg }}</p>
              </div>
            </div>
          </div>
        </section>

        <aside class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4">
          <h2 class="text-lg font-semibold text-slate-900">Order summary</h2>
          <div class="flex items-center justify-between text-sm text-slate-700">
            <span>Subtotal</span>
            <span>{{ subtotal() | localizedCurrency : currency }}</span>
          </div>
          <div class="flex items-center justify-between text-sm text-slate-700">
            <span>Shipping</span>
            <span class="text-slate-500">Calculated at checkout</span>
          </div>
          <div class="flex items-center justify-between text-sm text-slate-700">
            <span>Tax</span>
            <span class="text-slate-500">Calculated at checkout</span>
          </div>
          <div class="border-t border-slate-200 pt-3 flex items-center justify-between text-base font-semibold text-slate-900">
            <span>Estimated total</span>
            <span>{{ subtotal() | localizedCurrency : currency }}</span>
          </div>
          <app-button
            label="Proceed to checkout"
            [routerLink]="['/checkout']"
            [disabled]="!items().length"
          ></app-button>
          <app-button variant="ghost" label="Continue shopping" [routerLink]="['/shop']"></app-button>
        </aside>
      </div>
    </app-container>
  `
})
export class CartComponent {
  crumbs = [
    { label: 'Home', url: '/' },
    { label: 'Cart' }
  ];
  errorMsg = '';

  constructor(private cart: CartStore) {}

  items = this.cart.items;
  subtotal = this.cart.subtotal;
  currency = 'USD';

  onQuantityChange(id: string, value: number): void {
    const qty = Number(value);
    const { error } = this.cart.updateQuantity(id, qty);
    this.errorMsg = error ?? '';
  }

  remove(id: string): void {
    this.cart.remove(id);
  }
}
