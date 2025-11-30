import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { CartStore } from '../../core/cart.store';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';

@Component({
  selector: 'app-success',
  standalone: true,
  imports: [CommonModule, RouterLink, ContainerComponent, ButtonComponent, BreadcrumbComponent, LocalizedCurrencyPipe],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <div class="grid gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-900">
        <p class="text-sm uppercase tracking-[0.3em] font-semibold">Order confirmed</p>
        <h1 class="text-2xl font-semibold text-emerald-900">Thank you for your purchase!</h1>
        <p class="text-sm text-emerald-800">We emailed you a confirmation. You can continue shopping or view your orders.</p>
        <div class="flex gap-3">
          <app-button routerLink="/shop" label="Continue shopping"></app-button>
          <app-button routerLink="/" variant="ghost" label="Back home"></app-button>
        </div>
      </div>

      <aside class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-3">
        <h2 class="text-lg font-semibold text-slate-900">Order summary</h2>
        <div class="grid gap-2 text-sm text-slate-700">
          <div *ngFor="let item of items()">
            <div class="flex justify-between">
              <span>{{ item.name }} × {{ item.quantity }}</span>
              <span>{{ item.price * item.quantity | localizedCurrency : item.currency }}</span>
            </div>
          </div>
        </div>
        <div class="flex items-center justify-between text-base font-semibold text-slate-900 pt-2 border-t border-slate-200">
          <span>Total</span>
          <span>{{ subtotal() | localizedCurrency : currency }}</span>
        </div>
      </aside>
    </app-container>
  `
})
export class SuccessComponent {
  crumbs = [
    { label: 'Home', url: '/' },
    { label: 'Success' }
  ];

  constructor(private cart: CartStore) {}

  items = this.cart.items;
  subtotal = this.cart.subtotal;
  currency = 'USD';
}
