import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { ContainerComponent } from '../../layout/container.component';

const CHECKOUT_NETOPIA_PENDING_KEY = 'checkout_netopia_pending';

@Component({
  selector: 'app-netopia-cancel',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, ContainerComponent, BreadcrumbComponent, ButtonComponent],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <div
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
export class NetopiaCancelComponent {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'checkout.title', url: '/checkout' },
    { label: 'checkout.netopiaCancelled' }
  ];

  constructor() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem(CHECKOUT_NETOPIA_PENDING_KEY);
    } catch {
      // ignore
    }
  }
}

