import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, RouterLink, ContainerComponent, BreadcrumbComponent, ButtonComponent, LocalizedCurrencyPipe],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <div class="grid gap-6">
        <header class="flex items-center justify-between">
          <div>
            <p class="text-sm text-slate-500">Signed in as</p>
            <h1 class="text-2xl font-semibold text-slate-900">customer&#64;example.com</h1>
          </div>
          <app-button routerLink="/account/password" variant="ghost" label="Change password"></app-button>
        </header>

        <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900">Profile</h2>
            <app-button size="sm" variant="ghost" label="Edit"></app-button>
          </div>
          <p class="text-sm text-slate-700">Name: Jane Doe</p>
          <p class="text-sm text-slate-700">Email: customer&#64;example.com</p>
        </section>

        <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900">Addresses</h2>
            <app-button size="sm" variant="ghost" label="Add address"></app-button>
          </div>
          <p class="text-sm text-slate-700">No addresses yet.</p>
        </section>

        <section class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold text-slate-900">Orders</h2>
            <a routerLink="/shop" class="text-sm text-indigo-600 font-medium">Shop new items</a>
          </div>
          <div class="border border-dashed border-slate-200 rounded-xl p-4 text-sm text-slate-600">
            No orders yet.
          </div>
        </section>
      </div>
    </app-container>
  `
})
export class AccountComponent {
  crumbs = [
    { label: 'Home', url: '/' },
    { label: 'Account' }
  ];
}
