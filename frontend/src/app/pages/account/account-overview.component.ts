import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { AccountComponent } from './account.component';

@Component({
  selector: 'app-account-overview',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule],
  template: `
    <section
      class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      aria-label="Account overview"
    >
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
          {{ 'account.overview.title' | translate }}
        </h2>
        <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'account.overview.quickLinks' | translate }}</span>
      </div>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <a
          routerLink="/account/orders"
          class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-slate-700"
        >
          <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{{ 'nav.myOrders' | translate }}</p>
          <p class="mt-1 font-semibold text-slate-900 dark:text-slate-50">{{ account.lastOrderLabel() }}</p>
          <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">{{ account.lastOrderSubcopy() }}</p>
        </a>
        <a
          routerLink="/account/addresses"
          class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-slate-700"
        >
          <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{{ 'account.sections.addresses' | translate }}</p>
          <p class="mt-1 font-semibold text-slate-900 dark:text-slate-50">{{ account.defaultAddressLabel() }}</p>
          <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">{{ account.defaultAddressSubcopy() }}</p>
        </a>
        <a
          routerLink="/account/wishlist"
          class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-slate-700"
        >
          <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{{ 'nav.myWishlist' | translate }}</p>
          <p class="mt-1 font-semibold text-slate-900 dark:text-slate-50">{{ account.wishlistCountLabel() }}</p>
          <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">{{ 'account.overview.wishlistHint' | translate }}</p>
        </a>
        <a
          routerLink="/account/notifications"
          class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-slate-700"
        >
          <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{{ 'account.sections.notifications' | translate }}</p>
          <p class="mt-1 font-semibold text-slate-900 dark:text-slate-50">{{ account.notificationsLabel() }}</p>
          <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">{{ 'account.overview.notificationsHint' | translate }}</p>
        </a>
        <a
          routerLink="/account/security"
          class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-slate-700"
        >
          <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{{ 'account.sections.security' | translate }}</p>
          <p class="mt-1 font-semibold text-slate-900 dark:text-slate-50">{{ account.securityLabel() }}</p>
          <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">{{ 'account.overview.securityHint' | translate }}</p>
        </a>
      </div>
    </section>
  `
})
export class AccountOverviewComponent {
  protected readonly account = inject(AccountComponent);
}

