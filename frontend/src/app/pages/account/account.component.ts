import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AccountState } from './account.state';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { BlogService } from '../../core/blog.service';
import { CartStore } from '../../core/cart.store';
import { LanguageService } from '../../core/language.service';
import { NotificationsService } from '../../core/notifications.service';
import { AccountService } from '../../core/account.service';
import { CouponsService } from '../../core/coupons.service';
import { ThemeService } from '../../core/theme.service';
import { ToastService } from '../../core/toast.service';
import { WishlistService } from '../../core/wishlist.service';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { SkeletonComponent } from '../../shared/skeleton.component';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    TranslateModule,
    ContainerComponent,
    ButtonComponent,
    SkeletonComponent
  ],
  template: `
    <app-container classes="py-10 grid gap-6">
      <div
        *ngIf="error()"
        class="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-3 text-sm dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
      >
        <div class="flex items-start justify-between gap-3">
          <span class="min-w-0">{{ error() | translate }}</span>
          <app-button size="sm" variant="ghost" [label]="'shop.retry' | translate" (action)="retryAccountLoad()"></app-button>
        </div>
      </div>

      <div class="grid gap-6" *ngIf="!error()">
        <header class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <p class="text-sm text-slate-500 dark:text-slate-400">{{ 'account.header.signedInAs' | translate }}</p>

            <ng-container *ngIf="loading(); else headerBody">
              <app-skeleton height="28px" width="360px"></app-skeleton>
            </ng-container>

            <ng-template #headerBody>
              <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50 truncate">
                {{ accountHeaderLabel() }}
              </h1>
              <div
                *ngIf="!emailVerified()"
                class="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm grid gap-3 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
              >
                <div class="flex items-start justify-between gap-3">
                  <span>{{ 'auth.emailVerificationNeeded' | translate }}</span>
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="
                      primaryVerificationResendRemainingSeconds() > 0
                        ? ('account.verification.resendIn' | translate: { seconds: primaryVerificationResendRemainingSeconds() })
                        : ('auth.emailVerificationResend' | translate)
                    "
                    [disabled]="primaryVerificationResendRemainingSeconds() > 0"
                    (action)="resendVerification()"
                  ></app-button>
                </div>
                <form class="flex gap-2 items-center" (ngSubmit)="submitVerification()">
                  <input
                    [(ngModel)]="verificationToken"
                    name="verificationToken"
                    type="text"
                    [placeholder]="'auth.emailVerificationTokenPlaceholder' | translate"
                    class="border border-amber-300 bg-white rounded-lg px-3 py-2 text-sm flex-1 text-slate-900 dark:border-amber-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
                    required
                  />
                  <app-button size="sm" [label]="'auth.emailVerificationConfirm' | translate" type="submit"></app-button>
                </form>
                <p *ngIf="verificationStatus" class="text-xs text-amber-800 dark:text-amber-200">{{ verificationStatus }}</p>
              </div>
            </ng-template>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <app-button variant="ghost" [label]="'nav.signOut' | translate" (action)="signOut()"></app-button>
          </div>
        </header>

        <div class="grid gap-6">
            <div
              class="lg:hidden rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 grid gap-2"
              aria-label="Account section selector"
            >
              <label class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {{ 'account.nav.sectionSelect' | translate }}
              </label>
              <select
                class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [value]="navigationSection()"
                (change)="navigateToSection($any($event.target).value)"
              >
                <option value="overview">{{ 'account.sections.overview' | translate }}</option>
                <option value="profile">{{ 'nav.myProfile' | translate }}</option>
                <option value="orders">{{ 'nav.myOrders' | translate }}</option>
                <option value="addresses">{{ 'account.sections.addresses' | translate }}</option>
                <option value="wishlist">{{ 'nav.myWishlist' | translate }}</option>
                <option value="coupons">{{ 'nav.myCoupons' | translate }}</option>
                <option value="notifications">{{ 'account.sections.notifications' | translate }}</option>
                <option value="security">{{ 'account.sections.security' | translate }}</option>
                <option value="comments">{{ 'account.sections.comments' | translate }}</option>
                <option value="privacy">{{ 'account.sections.privacy' | translate }}</option>
              </select>
              <a routerLink="/tickets" class="text-sm text-indigo-600 dark:text-indigo-300 font-medium">{{ 'nav.helpCenter' | translate }}</a>
            </div>

            <div class="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
            <nav
              class="hidden lg:grid rounded-2xl border border-slate-200 bg-white p-3 gap-1 dark:border-slate-800 dark:bg-slate-900 lg:sticky lg:top-24 lg:self-start"
              aria-label="Account navigation"
            >
              <a
                routerLink="/account/overview"
                [routerLinkActiveOptions]="{ exact: true }"
                routerLinkActive="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-50"
                class="rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition flex items-center justify-between gap-2"
              >
                <span>{{ 'account.sections.overview' | translate }}</span>
              </a>
              <a
                routerLink="/account/profile"
                routerLinkActive="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-50"
                class="rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition flex items-center justify-between gap-2"
              >
                <span>{{ 'nav.myProfile' | translate }}</span>
              </a>
              <a
                routerLink="/account/orders"
                routerLinkActive="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-50"
                class="rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition flex items-center justify-between gap-2"
              >
                <span>{{ 'nav.myOrders' | translate }}</span>
                <span
                  *ngIf="pendingOrdersCount() > 0"
                  class="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white dark:bg-amber-400 dark:text-slate-900"
                  >{{ pendingOrdersCount() }}</span
                >
              </a>
              <a
                routerLink="/account/addresses"
                routerLinkActive="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-50"
                class="rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition flex items-center justify-between gap-2"
              >
                <span>{{ 'account.sections.addresses' | translate }}</span>
              </a>
              <a
                routerLink="/account/wishlist"
                routerLinkActive="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-50"
                class="rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition flex items-center justify-between gap-2"
              >
                <span>{{ 'nav.myWishlist' | translate }}</span>
              </a>
              <a
                routerLink="/account/coupons"
                routerLinkActive="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-50"
                class="rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition flex items-center justify-between gap-2"
              >
                <span>{{ 'nav.myCoupons' | translate }}</span>
                <span
                  *ngIf="couponsCountLoaded() && couponsCount() > 0"
                  class="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white dark:bg-indigo-500"
                  >{{ couponsCount() }}</span
                >
              </a>
              <a
                routerLink="/account/notifications"
                routerLinkActive="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-50"
                class="rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition flex items-center justify-between gap-2"
              >
                <span>{{ 'account.sections.notifications' | translate }}</span>
                <span
                  *ngIf="unreadNotificationsCount() > 0"
                  class="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white dark:bg-indigo-500"
                  >{{ unreadNotificationsCount() }}</span
                >
              </a>
              <a
                routerLink="/account/security"
                routerLinkActive="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-50"
                class="rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition flex items-center justify-between gap-2"
              >
                <span>{{ 'account.sections.security' | translate }}</span>
              </a>
              <a
                routerLink="/account/comments"
                routerLinkActive="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-50"
                class="rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition flex items-center justify-between gap-2"
              >
                <span>{{ 'account.sections.comments' | translate }}</span>
              </a>
              <a
                routerLink="/account/privacy"
                routerLinkActive="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-50"
                class="rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition flex items-center justify-between gap-2"
              >
                <span>{{ 'account.sections.privacy' | translate }}</span>
              </a>
              <a
                routerLink="/tickets"
                routerLinkActive="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-50"
                class="rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition flex items-center justify-between gap-2"
              >
                <span>{{ 'nav.helpCenter' | translate }}</span>
              </a>
            </nav>

	            <main class="grid gap-4 min-w-0">
	              <router-outlet></router-outlet>
	            </main>
	          </div>
	        </div>
	      </div>
	    </app-container>
  `
})
export class AccountComponent extends AccountState {
  constructor(
    toast: ToastService,
    auth: AuthService,
    account: AccountService,
    blog: BlogService,
    cart: CartStore,
    router: Router,
    route: ActivatedRoute,
    api: ApiService,
    wishlist: WishlistService,
    notifications: NotificationsService,
    coupons: CouponsService,
    theme: ThemeService,
    lang: LanguageService,
    translate: TranslateService
  ) {
    super(toast, auth, account, blog, cart, router, route, api, wishlist, notifications, coupons, theme, lang, translate);
  }
}
