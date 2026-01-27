import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonComponent } from '../../shared/button.component';

@Component({
  selector: 'app-checkout-payment-step',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, ButtonComponent],
  template: `
    <div id="checkout-step-4" class="scroll-mt-24 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em] dark:text-slate-200">{{ 'checkout.step4' | translate }}</p>
      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          class="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-60"
          [disabled]="!vm.isPaymentMethodAvailable('cod')"
          [ngClass]="
            vm.paymentMethod === 'cod'
              ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/30 dark:text-indigo-100'
              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
          "
          (click)="vm.setPaymentMethod('cod')"
          [attr.aria-pressed]="vm.paymentMethod === 'cod'"
        >
          <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M2 7h20v10H2z"></path>
            <path d="M6 11h4"></path>
            <path d="M16 11h2"></path>
          </svg>
          <span>{{ 'checkout.paymentCash' | translate }}</span>
        </button>
        <button
          type="button"
          class="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-60"
          [disabled]="!vm.isPaymentMethodAvailable('netopia')"
          [ngClass]="
            vm.paymentMethod === 'netopia'
              ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/30 dark:text-indigo-100'
              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
          "
          (click)="vm.setPaymentMethod('netopia')"
          [attr.aria-pressed]="vm.paymentMethod === 'netopia'"
        >
          <span
            class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white dark:bg-slate-100 dark:text-slate-900"
          >
            N
          </span>
          <span>{{ 'checkout.paymentNetopia' | translate }}</span>
        </button>
        <button
          *ngIf="vm.paypalEnabled"
          type="button"
          class="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-60"
          [disabled]="!vm.isPaymentMethodAvailable('paypal')"
          [ngClass]="
            vm.paymentMethod === 'paypal'
              ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/30 dark:text-indigo-100'
              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
          "
          (click)="vm.setPaymentMethod('paypal')"
          [attr.aria-pressed]="vm.paymentMethod === 'paypal'"
        >
          <span class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#003087] text-xs font-bold text-white">P</span>
          <span>{{ 'checkout.paymentPayPal' | translate }}</span>
        </button>
        <button
          type="button"
          class="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          [ngClass]="
            vm.paymentMethod === 'stripe'
              ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/30 dark:text-indigo-100'
              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
          "
          (click)="vm.setPaymentMethod('stripe')"
          [attr.aria-pressed]="vm.paymentMethod === 'stripe'"
        >
          <span class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#635BFF] text-xs font-bold text-white">S</span>
          <span>{{ 'checkout.paymentStripe' | translate }}</span>
        </button>
      </div>
      <p class="text-xs text-slate-600 dark:text-slate-300" *ngIf="vm.paymentMethod === 'cod'">
        <span>{{ 'checkout.paymentCashHint' | translate }}</span>
        <a class="ml-1 underline text-indigo-700 hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-indigo-200" routerLink="/contact">
          {{ 'checkout.paymentHelpLink' | translate }}
        </a>
      </p>
      <p class="text-xs text-slate-600 dark:text-slate-300" *ngIf="vm.paymentMethod === 'netopia'">
        <span>{{
          vm.netopiaEnabled
            ? (vm.isPaymentMethodAvailable('netopia')
                ? ('checkout.paymentNetopiaHint' | translate)
                : ('checkout.paymentMethodUnavailable' | translate))
            : ('checkout.paymentNetopiaDisabled' | translate)
        }}</span>
        <a class="ml-1 underline text-indigo-700 hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-indigo-200" routerLink="/contact">
          {{ 'checkout.paymentHelpLink' | translate }}
        </a>
      </p>
      <p class="text-xs text-slate-600 dark:text-slate-300" *ngIf="vm.paymentMethod === 'paypal'">
        <span>{{ vm.isPaymentMethodAvailable('paypal') ? ('checkout.paymentPayPalHint' | translate) : ('checkout.paymentMethodUnavailable' | translate) }}</span>
        <a class="ml-1 underline text-indigo-700 hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-indigo-200" routerLink="/contact">
          {{ 'checkout.paymentHelpLink' | translate }}
        </a>
      </p>
      <p class="text-xs text-slate-600 dark:text-slate-300" *ngIf="vm.paymentMethod === 'stripe'">
        <span>{{ 'checkout.paymentStripeHint' | translate }}</span>
        <a class="ml-1 underline text-indigo-700 hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-indigo-200" routerLink="/contact">
          {{ 'checkout.paymentHelpLink' | translate }}
        </a>
      </p>

      <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-300">
        <span class="uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{{ 'checkout.acceptedCards' | translate }}</span>
        <div class="rounded-lg bg-white px-2 py-1 shadow-sm ring-1 ring-slate-200 dark:bg-slate-50 dark:ring-slate-200">
          <img
            src="assets/payments/netopia-visa-mastercard.png"
            [alt]="'checkout.acceptedCardsAlt' | translate"
            class="h-7 w-auto"
            loading="lazy"
          />
        </div>
      </div>

      <div class="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-200">
        <div *ngIf="vm.legalConsentsLoading" class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600 dark:border-slate-700 dark:border-t-indigo-300"></span>
          <span>{{ 'legal.consent.loading' | translate }}</span>
        </div>

        <label class="flex items-start gap-2">
          <input
            type="checkbox"
            [checked]="vm.acceptTerms"
            [disabled]="vm.consentLocked || vm.legalConsentsLoading"
            (click)="vm.onCheckoutConsentAttempt($event, 'terms')"
            (keydown.space)="vm.onCheckoutConsentAttempt($event, 'terms')"
          />
          <span>
            {{ 'auth.acceptTermsPrefix' | translate }}
            <a
              routerLink="/pages/terms-and-conditions"
              class="text-indigo-600 dark:text-indigo-300 font-medium hover:underline"
            >
              {{ 'auth.acceptTermsLink' | translate }}
            </a>
          </span>
        </label>

        <label class="flex items-start gap-2">
          <input
            type="checkbox"
            [checked]="vm.acceptPrivacy"
            [disabled]="vm.consentLocked || vm.legalConsentsLoading"
            (click)="vm.onCheckoutConsentAttempt($event, 'privacy')"
            (keydown.space)="vm.onCheckoutConsentAttempt($event, 'privacy')"
          />
          <span>
            {{ 'auth.acceptPrivacyPrefix' | translate }}
            <a
              routerLink="/pages/privacy-policy"
              class="text-indigo-600 dark:text-indigo-300 font-medium hover:underline"
            >
              {{ 'auth.acceptPrivacyLink' | translate }}
            </a>
          </span>
        </label>

        <p *ngIf="vm.consentError" class="text-xs text-rose-700 dark:text-rose-300">{{ vm.consentError }}</p>
      </div>
      <div *ngIf="vm.paymentNotReady" class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600 dark:border-slate-700 dark:border-t-indigo-300"></span>
        <span>{{ 'checkout.paymentNotReady' | translate }}</span>
      </div>
    </div>

    <div class="flex gap-3">
      <app-button
        [label]="vm.placing ? ('checkout.placingOrder' | translate) : ('checkout.placeOrder' | translate)"
        type="submit"
        [disabled]="vm.placing || vm.cartSyncPending() || vm.consentBlocking()"
      >
        <span
          *ngIf="vm.placing"
          class="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/70 border-t-white dark:border-slate-900/40 dark:border-t-slate-900"
        ></span>
      </app-button>
      <app-button variant="ghost" [label]="'checkout.backToCart' | translate" routerLink="/cart"></app-button>
    </div>
  `
})
export class CheckoutPaymentStepComponent {
  @Input({ required: true }) vm!: any;
}
