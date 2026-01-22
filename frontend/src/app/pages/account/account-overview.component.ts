import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { AccountComponent } from './account.component';
import { SkeletonComponent } from '../../shared/skeleton.component';

@Component({
  selector: 'app-account-overview',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, SkeletonComponent],
  template: `
    <section
      class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      [attr.aria-label]="'account.overview.aria.overview' | translate"
    >
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">
          {{ 'account.overview.title' | translate }}
        </h2>
        <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'account.overview.quickLinks' | translate }}</span>
      </div>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ng-container *ngIf="!account.ordersLoaded(); else ordersCard">
          <div
            class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40"
            [attr.aria-label]="'account.overview.aria.ordersLoading' | translate"
          >
            <app-skeleton height="12px" width="90px"></app-skeleton>
            <div class="mt-3 grid gap-2">
              <app-skeleton height="18px" width="80%"></app-skeleton>
              <app-skeleton height="14px" width="60%"></app-skeleton>
            </div>
          </div>
        </ng-container>
        <ng-template #ordersCard>
          <a
            routerLink="/account/orders"
            class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-slate-700"
          >
            <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{{ 'nav.myOrders' | translate }}</p>
            <p class="mt-1 font-semibold text-slate-900 dark:text-slate-50">{{ account.lastOrderLabel() }}</p>
            <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">{{ account.lastOrderSubcopy() }}</p>
          </a>
        </ng-template>

        <ng-container *ngIf="!account.addressesLoaded(); else addressesCard">
          <div
            class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40"
            [attr.aria-label]="'account.overview.aria.addressesLoading' | translate"
          >
            <app-skeleton height="12px" width="110px"></app-skeleton>
            <div class="mt-3 grid gap-2">
              <app-skeleton height="18px" width="70%"></app-skeleton>
              <app-skeleton height="14px" width="50%"></app-skeleton>
            </div>
          </div>
        </ng-container>
        <ng-template #addressesCard>
          <a
            routerLink="/account/addresses"
            class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-slate-700"
          >
            <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{{ 'account.sections.addresses' | translate }}</p>
            <p class="mt-1 font-semibold text-slate-900 dark:text-slate-50">{{ account.defaultAddressLabel() }}</p>
            <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">{{ account.defaultAddressSubcopy() }}</p>
          </a>
        </ng-template>

        <ng-container *ngIf="!account.wishlist.isLoaded(); else wishlistCard">
          <div
            class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40"
            [attr.aria-label]="'account.overview.aria.wishlistLoading' | translate"
          >
            <app-skeleton height="12px" width="100px"></app-skeleton>
            <div class="mt-3 grid gap-2">
              <app-skeleton height="18px" width="70%"></app-skeleton>
              <app-skeleton height="14px" width="60%"></app-skeleton>
            </div>
          </div>
        </ng-container>
        <ng-template #wishlistCard>
          <a
            routerLink="/account/wishlist"
            class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-slate-700"
          >
            <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{{ 'nav.myWishlist' | translate }}</p>
            <p class="mt-1 font-semibold text-slate-900 dark:text-slate-50">{{ account.wishlistCountLabel() }}</p>
            <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">{{ 'account.overview.wishlistHint' | translate }}</p>
          </a>
        </ng-template>

        <ng-container *ngIf="account.loading(); else notificationsCard">
          <div
            class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40"
            [attr.aria-label]="'account.overview.aria.notificationsLoading' | translate"
          >
            <app-skeleton height="12px" width="110px"></app-skeleton>
            <div class="mt-3 grid gap-2">
              <app-skeleton height="18px" width="75%"></app-skeleton>
              <app-skeleton height="14px" width="60%"></app-skeleton>
            </div>
          </div>
        </ng-container>
        <ng-template #notificationsCard>
          <a
            routerLink="/account/notifications"
            class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-slate-700"
          >
            <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{{ 'account.sections.notifications' | translate }}</p>
            <p class="mt-1 font-semibold text-slate-900 dark:text-slate-50">{{ account.notificationsLabel() }}</p>
            <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">{{ 'account.overview.notificationsHint' | translate }}</p>
          </a>
        </ng-template>

        <ng-container *ngIf="account.loading(); else securityCard">
          <div
            class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40"
            [attr.aria-label]="'account.overview.aria.securityLoading' | translate"
          >
            <app-skeleton height="12px" width="80px"></app-skeleton>
            <div class="mt-3 grid gap-2">
              <app-skeleton height="18px" width="70%"></app-skeleton>
              <app-skeleton height="14px" width="60%"></app-skeleton>
            </div>
          </div>
        </ng-container>
        <ng-template #securityCard>
          <a
            routerLink="/account/security"
            class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-slate-700"
          >
            <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{{ 'account.sections.security' | translate }}</p>
            <p class="mt-1 font-semibold text-slate-900 dark:text-slate-50">{{ account.securityLabel() }}</p>
            <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">{{ 'account.overview.securityHint' | translate }}</p>
          </a>
        </ng-template>

        <ng-container *ngIf="!account.ticketsLoaded(); else ticketsCard">
          <div
            class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/40"
            [attr.aria-label]="'account.overview.aria.supportLoading' | translate"
          >
            <app-skeleton height="12px" width="90px"></app-skeleton>
            <div class="mt-3 grid gap-2">
              <app-skeleton height="18px" width="80%"></app-skeleton>
              <app-skeleton height="14px" width="70%"></app-skeleton>
            </div>
          </div>
        </ng-container>
        <ng-template #ticketsCard>
          <a
            routerLink="/tickets"
            class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition dark:border-slate-800 dark:bg-slate-950/40 dark:hover:border-slate-700"
          >
            <p class="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">{{ 'account.overview.support.title' | translate }}</p>
            <p class="mt-1 font-semibold text-slate-900 dark:text-slate-50">{{ account.supportTicketsLabel() }}</p>
            <p class="mt-1 text-sm text-slate-600 dark:text-slate-300">{{ account.supportTicketsSubcopy() }}</p>
          </a>
        </ng-template>
      </div>
    </section>
  `
})
export class AccountOverviewComponent {
  protected readonly account = inject(AccountComponent);
}
