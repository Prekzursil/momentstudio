import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { CartStore, CartItem } from '../../core/cart.store';
import { CartApi, CartResponse } from '../../core/cart.api';
import { ApiService } from '../../core/api.service';
import { AccountService, Address } from '../../core/account.service';
import { CouponsService, type CouponEligibilityResponse, type CouponOffer } from '../../core/coupons.service';
import { appConfig } from '../../core/app-config';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../core/auth.service';
import { buildE164, listPhoneCountries, PhoneCountryOption } from '../../shared/phone';
import { LockerPickerComponent } from '../../shared/locker-picker.component';
import { LockerProvider, LockerRead } from '../../core/shipping.service';
import { RO_CITIES, RO_COUNTIES } from '../../shared/ro-geo';
import { parseMoney } from '../../shared/money';

type CheckoutShippingAddress = {
  name: string;
  email: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postal: string;
  country: string;
  password?: string;
};

type CheckoutBillingAddress = {
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postal: string;
  country: string;
};

type SavedCheckout = {
  address: CheckoutShippingAddress;
  billingSameAsShipping: boolean;
  billing: CheckoutBillingAddress;
  courier?: LockerProvider;
  deliveryType?: 'home' | 'locker';
  locker?: LockerRead | null;
};

type CheckoutPaymentMethod = 'cod' | 'netopia' | 'paypal' | 'stripe';

type CheckoutQuote = {
  subtotal: number;
  fee: number;
  tax: number;
  shipping: number;
  total: number;
  currency: string;
};

type CheckoutSuccessItem = {
  name: string;
  slug: string;
  quantity: number;
  unit_price: number;
  currency: string;
};

type CheckoutSuccessSummary = {
  order_id: string;
  reference_code: string | null;
  payment_method: CheckoutPaymentMethod;
  courier: LockerProvider | null;
  delivery_type: 'home' | 'locker' | null;
  locker_name: string | null;
  locker_address: string | null;
  totals: CheckoutQuote & { discount: number };
  items: CheckoutSuccessItem[];
  created_at: string;
};

const CHECKOUT_SUCCESS_KEY = 'checkout_last_order';
const CHECKOUT_PAYPAL_PENDING_KEY = 'checkout_paypal_pending';
const CHECKOUT_STRIPE_PENDING_KEY = 'checkout_stripe_pending';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ContainerComponent,
    ButtonComponent,
    BreadcrumbComponent,
    LocalizedCurrencyPipe,
    TranslateModule,
    LockerPickerComponent
  ],
  template: `
      <app-container classes="py-10 grid gap-6">
        <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
        <div class="grid lg:grid-cols-[2fr_1fr] gap-6 items-start">
          <section class="grid gap-4">
            <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'checkout.title' | translate }}</h1>
            <div
              *ngIf="errorMessage"
            class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-start justify-between gap-3 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <span>{{ errorMessage }}</span>
              <app-button size="sm" variant="ghost" [label]="'checkout.retry' | translate" (action)="retryValidation()"></app-button>
            </div>
            <div
              *ngIf="!auth.isAuthenticated()"
              class="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800 flex flex-wrap items-center justify-between gap-3 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
            >
              <span class="font-medium">{{ 'checkout.guest' | translate }}</span>
              <div class="flex flex-wrap gap-2">
                <app-button size="sm" variant="ghost" [label]="'auth.login' | translate" routerLink="/login"></app-button>
                <app-button size="sm" variant="ghost" [label]="'auth.register' | translate" routerLink="/register"></app-button>
              </div>
            </div>
            <div
              *ngIf="auth.isAuthenticated() && !emailVerified()"
              class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-start justify-between gap-3 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <span>{{ 'auth.emailVerificationNeeded' | translate }}</span>
              <app-button size="sm" variant="ghost" [label]="'auth.emailVerificationConfirm' | translate" routerLink="/account"></app-button>
            </div>
            <form #checkoutForm="ngForm" class="grid gap-4" (ngSubmit)="placeOrder(checkoutForm)">
              <div
                *ngIf="!auth.isAuthenticated()"
                class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em] dark:text-slate-200">{{ 'checkout.step1' | translate }}</p>
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" [(ngModel)]="guestCreateAccount" name="guestCreateAccount" />
                  {{ 'checkout.createAccount' | translate }}
                </label>
                <div *ngIf="guestCreateAccount" class="grid sm:grid-cols-2 gap-3">
                  <label class="text-sm grid gap-1">
                    {{ 'auth.username' | translate }}
                    <input
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                      name="guestUsername"
                      [(ngModel)]="guestUsername"
                      autocomplete="username"
                      required
                      minlength="3"
                      maxlength="30"
                      pattern="^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$"
                    />
                    <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'validation.usernameInvalid' | translate }}</span>
                  </label>
                  <div class="grid gap-1 text-sm">
                    <span class="font-medium text-slate-700 dark:text-slate-200">{{ 'auth.password' | translate }}</span>
                    <div class="grid grid-cols-[1fr_auto] gap-2 items-center">
                      <input
                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                        name="guestPassword"
                        [type]="guestShowPassword ? 'text' : 'password'"
                        [(ngModel)]="guestPassword"
                        autocomplete="new-password"
                        required
                        minlength="6"
                        maxlength="128"
                      />
                      <app-button size="sm" variant="ghost" [label]="guestShowPassword ? ('auth.hide' | translate) : ('auth.show' | translate)" (action)="toggleGuestPassword()"></app-button>
                    </div>
                    <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'validation.passwordMin' | translate }}</span>
                  </div>
                  <div class="grid gap-1 text-sm">
                    <span class="font-medium text-slate-700 dark:text-slate-200">{{ 'auth.confirmPassword' | translate }}</span>
                    <div class="grid grid-cols-[1fr_auto] gap-2 items-center">
                      <input
                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                        name="guestPasswordConfirm"
                        [type]="guestShowPasswordConfirm ? 'text' : 'password'"
                        [(ngModel)]="guestPasswordConfirm"
                        autocomplete="new-password"
                        required
                        minlength="6"
                        maxlength="128"
                      />
                      <app-button
                        size="sm"
                        variant="ghost"
                        [label]="guestShowPasswordConfirm ? ('auth.hide' | translate) : ('auth.show' | translate)"
                        (action)="toggleGuestPasswordConfirm()"
                      ></app-button>
                    </div>
                    <span *ngIf="guestPasswordConfirm && guestPasswordConfirm !== guestPassword" class="text-xs text-amber-700 dark:text-amber-300">
                      {{ 'validation.passwordMismatch' | translate }}
                    </span>
                  </div>
                  <label class="text-sm grid gap-1">
                    {{ 'auth.firstName' | translate }}
                    <input
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                      name="guestFirstName"
                      [(ngModel)]="guestFirstName"
                      autocomplete="given-name"
                      required
                    />
                  </label>
                  <label class="text-sm grid gap-1">
                    {{ 'auth.middleName' | translate }}
                    <input
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                      name="guestMiddleName"
                      [(ngModel)]="guestMiddleName"
                      autocomplete="additional-name"
                    />
                  </label>
                  <label class="text-sm grid gap-1">
                    {{ 'auth.lastName' | translate }}
                    <input
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                      name="guestLastName"
                      [(ngModel)]="guestLastName"
                      autocomplete="family-name"
                      required
                    />
                  </label>
                  <label class="text-sm grid gap-1">
                    {{ 'auth.dateOfBirth' | translate }}
                    <input
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                      name="guestDob"
                      type="date"
                      [(ngModel)]="guestDob"
                      required
                    />
                  </label>
                  <div class="grid gap-1 text-sm sm:col-span-2">
                    <span class="font-medium text-slate-700 dark:text-slate-200">{{ 'auth.phone' | translate }}</span>
                    <div class="grid grid-cols-[auto_1fr] gap-2">
                      <select
                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        name="guestPhoneCountry"
                        [(ngModel)]="guestPhoneCountry"
                        required
                      >
                        <option *ngFor="let c of phoneCountries" [value]="c.code">{{ c.flag }} {{ c.dial }} {{ c.name }}</option>
                      </select>
                      <input
                        type="tel"
                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                        name="guestPhoneNational"
                        [(ngModel)]="guestPhoneNational"
                        autocomplete="tel-national"
                        required
                        pattern="^[0-9]{6,14}$"
                      />
                    </div>
                    <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'auth.phoneHint' | translate }}</span>
                    <span *ngIf="guestPhoneNational && !guestPhoneE164()" class="text-xs text-amber-700 dark:text-amber-300">
                      {{ 'validation.phoneInvalid' | translate }}
                    </span>
                  </div>
                </div>
              </div>
              <div class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em] dark:text-slate-200">{{ 'checkout.step2' | translate }}</p>
                <div class="grid sm:grid-cols-2 gap-3">
                <label class="text-sm grid gap-1">
                  {{ 'checkout.name' | translate }}
                  <input
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                    name="name"
                    autocomplete="name"
                    [(ngModel)]="address.name"
                    required
                  />
                </label>
                <label class="text-sm grid gap-1">
                  {{ 'checkout.email' | translate }}
                  <input
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                    name="email"
                    autocomplete="email"
                    [(ngModel)]="address.email"
                    type="email"
                    required
                    (ngModelChange)="onEmailChanged()"
                  />
                  <div *ngIf="!auth.isAuthenticated()" class="flex flex-wrap items-center gap-2">
                    <app-button
                      size="sm"
                      variant="ghost"
                      [label]="
                        guestEmailVerified
                          ? ('checkout.emailVerifyVerified' | translate)
                          : guestVerificationSent
                            ? ('checkout.emailVerifyResend' | translate)
                            : ('checkout.emailVerifySend' | translate)
                      "
                      (action)="requestGuestEmailVerification()"
                      [disabled]="guestSendingCode || !address.email || guestEmailVerified"
                    ></app-button>
                    <span *ngIf="guestEmailVerified" class="text-xs font-medium text-emerald-700 dark:text-emerald-300">✓</span>
                  </div>
                  <div *ngIf="!auth.isAuthenticated() && guestVerificationSent && !guestEmailVerified" class="grid gap-2">
                    <div class="grid grid-cols-[1fr_auto] gap-2 items-center">
                      <input
                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                        name="guestEmailToken"
                        [(ngModel)]="guestVerificationToken"
                        [placeholder]="'auth.emailVerificationTokenPlaceholder' | translate"
                        inputmode="numeric"
                        maxlength="6"
                        pattern="^[0-9]{6}$"
                      />
                      <app-button
                        size="sm"
                        [label]="'auth.emailVerificationConfirm' | translate"
                        (action)="confirmGuestEmailVerification()"
                        [disabled]="guestConfirmingCode || guestVerificationToken.trim().length < 6"
                      ></app-button>
                    </div>
                    <p *ngIf="guestEmailError" class="text-xs text-amber-700 dark:text-amber-300">{{ guestEmailError }}</p>
                  </div>
                </label>
                <ng-container *ngIf="auth.isAuthenticated()">
                  <div class="sm:col-span-2 flex items-center justify-between gap-2">
                    <p class="text-xs font-semibold text-slate-600 uppercase tracking-[0.2em] dark:text-slate-300">
                      {{ 'checkout.savedAddressesTitle' | translate }}
                    </p>
                    <a routerLink="/account/addresses" class="text-xs text-indigo-600 dark:text-indigo-300">{{
                      'checkout.manageAddresses' | translate
                    }}</a>
                  </div>
                  <div *ngIf="savedAddressesLoading" class="sm:col-span-2 text-xs text-slate-600 dark:text-slate-300">
                    {{ 'notifications.loading' | translate }}
                  </div>
                  <p *ngIf="savedAddressesError" class="sm:col-span-2 text-xs text-rose-700 dark:text-rose-300">{{ savedAddressesError }}</p>
                  <label *ngIf="savedAddresses.length" class="text-sm grid gap-1 sm:col-span-2">
                    {{ 'checkout.savedShippingAddress' | translate }}
                    <select
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      name="savedShippingAddress"
                      [(ngModel)]="selectedShippingAddressId"
                      (ngModelChange)="applySelectedShippingAddress()"
                    >
                      <option value="">{{ 'checkout.savedAddressSelect' | translate }}</option>
                      <option *ngFor="let a of savedAddresses" [value]="a.id">{{ formatSavedAddress(a) }}</option>
                    </select>
                  </label>
                </ng-container>
                <label class="text-sm grid gap-1 sm:col-span-2">
                  {{ 'checkout.line1' | translate }}
                  <input
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                    name="line1"
                    autocomplete="shipping address-line1"
                    [(ngModel)]="address.line1"
                    required
                  />
                </label>
                <div class="grid gap-3 sm:grid-cols-3 sm:col-span-2">
                  <label class="text-sm grid gap-1">
                    {{ 'checkout.city' | translate }}
                    <input
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                      name="city"
                      autocomplete="shipping address-level2"
                      [(ngModel)]="address.city"
                      [attr.list]="address.country === 'RO' ? 'roCities' : null"
                      required
                    />
                  </label>
                  <label class="text-sm grid gap-1">
                    {{ 'checkout.region' | translate }}
                    <input
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                      name="region"
                      autocomplete="shipping address-level1"
                      [(ngModel)]="address.region"
                      [attr.list]="address.country === 'RO' ? 'roCounties' : null"
                      [required]="address.country === 'RO'"
                    />
                  </label>
                  <label class="text-sm grid gap-1">
                    {{ 'checkout.postal' | translate }}
                    <input
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                      name="postal"
                      autocomplete="shipping postal-code"
                      [(ngModel)]="address.postal"
                      required
                    />
                  </label>
                </div>
                <label class="text-sm grid gap-1 sm:col-span-2">
                  {{ 'checkout.country' | translate }}
                  <input
                    class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                    name="countryInput"
                    autocomplete="shipping country"
                    [attr.list]="'countryOptions'"
                    [(ngModel)]="shippingCountryInput"
                    (ngModelChange)="shippingCountryError = ''"
                    (blur)="normalizeShippingCountry()"
                    required
                  />
                  <p *ngIf="shippingCountryError" class="text-xs text-amber-700 dark:text-amber-300">{{ shippingCountryError }}</p>
                </label>
              </div>

              <div class="grid gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em] dark:text-slate-200">
                  {{ 'checkout.deliveryTitle' | translate }}
                </p>
                <div class="grid sm:grid-cols-2 gap-3">
                  <label class="text-sm grid gap-1">
                    {{ 'checkout.deliveryType' | translate }}
                    <div class="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        class="flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                        [ngClass]="
                          deliveryType === 'home'
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/30 dark:text-indigo-100'
                            : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
                        "
                        (click)="setDeliveryType('home')"
                        [attr.aria-pressed]="deliveryType === 'home'"
                      >
                        {{ 'checkout.deliveryHome' | translate }}
                      </button>
                      <button
                        type="button"
                        class="flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                        [ngClass]="
                          deliveryType === 'locker'
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/30 dark:text-indigo-100'
                            : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
                        "
                        (click)="setDeliveryType('locker')"
                        [attr.aria-pressed]="deliveryType === 'locker'"
                      >
                        {{ 'checkout.deliveryLocker' | translate }}
                      </button>
                    </div>
                  </label>
                  <label class="text-sm grid gap-1">
                    {{ 'checkout.courier' | translate }}
                    <select
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      name="courier"
                      [(ngModel)]="courier"
                      (ngModelChange)="onCourierChanged()"
                      required
                    >
                      <option value="sameday">{{ 'checkout.courierSameday' | translate }}</option>
                      <option value="fan_courier">{{ 'checkout.courierFanCourier' | translate }}</option>
                    </select>
                  </label>
                </div>
                <div *ngIf="deliveryType === 'locker'" class="grid gap-2">
                  <app-locker-picker [provider]="courier" [(selected)]="locker"></app-locker-picker>
                  <p *ngIf="deliveryError" class="text-xs text-amber-700 dark:text-amber-300">{{ deliveryError }}</p>
                </div>
              </div>

              <div class="grid gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em] dark:text-slate-200">
                    {{ 'checkout.billingTitle' | translate }}
                  </p>
                  <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <input type="checkbox" [(ngModel)]="billingSameAsShipping" name="billingSameAsShipping" />
                    {{ 'checkout.billingSameAsShipping' | translate }}
                  </label>
                </div>
                <div *ngIf="!billingSameAsShipping" class="grid sm:grid-cols-2 gap-3">
                  <ng-container *ngIf="auth.isAuthenticated()">
                    <label *ngIf="savedAddresses.length" class="text-sm grid gap-1 sm:col-span-2">
                      {{ 'checkout.savedBillingAddress' | translate }}
                      <select
                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        name="savedBillingAddress"
                        [(ngModel)]="selectedBillingAddressId"
                        (ngModelChange)="applySelectedBillingAddress()"
                      >
                        <option value="">{{ 'checkout.savedAddressSelect' | translate }}</option>
                        <option *ngFor="let a of savedAddresses" [value]="a.id">{{ formatSavedAddress(a) }}</option>
                      </select>
                    </label>
                  </ng-container>
                  <label class="text-sm grid gap-1 sm:col-span-2">
                    {{ 'checkout.line1' | translate }}
                    <input
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                      name="billingLine1"
                      autocomplete="billing address-line1"
                      [(ngModel)]="billing.line1"
                      required
                    />
                  </label>
                  <div class="grid gap-3 sm:grid-cols-3 sm:col-span-2">
                    <label class="text-sm grid gap-1">
                      {{ 'checkout.city' | translate }}
                      <input
                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                        name="billingCity"
                        autocomplete="billing address-level2"
                        [(ngModel)]="billing.city"
                        [attr.list]="billing.country === 'RO' ? 'roCities' : null"
                        required
                      />
                    </label>
                    <label class="text-sm grid gap-1">
                      {{ 'checkout.region' | translate }}
                      <input
                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                        name="billingRegion"
                        autocomplete="billing address-level1"
                        [(ngModel)]="billing.region"
                        [attr.list]="billing.country === 'RO' ? 'roCounties' : null"
                        [required]="billing.country === 'RO'"
                      />
                    </label>
                    <label class="text-sm grid gap-1">
                      {{ 'checkout.postal' | translate }}
                      <input
                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                        name="billingPostal"
                        autocomplete="billing postal-code"
                        [(ngModel)]="billing.postal"
                        required
                      />
                    </label>
                  </div>
                  <label class="text-sm grid gap-1 sm:col-span-2">
                    {{ 'checkout.country' | translate }}
                    <input
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                      name="billingCountryInput"
                      autocomplete="billing country"
                      [attr.list]="'countryOptions'"
                      [(ngModel)]="billingCountryInput"
                      (ngModelChange)="billingCountryError = ''"
                      (blur)="normalizeBillingCountry()"
                      required
                    />
                    <p *ngIf="billingCountryError" class="text-xs text-amber-700 dark:text-amber-300">{{ billingCountryError }}</p>
                  </label>
                </div>
              </div>
              <datalist id="roCities">
                <option *ngFor="let c of roCities" [value]="c"></option>
              </datalist>
              <datalist id="roCounties">
                <option *ngFor="let r of roCounties" [value]="r"></option>
              </datalist>
              <datalist id="countryOptions">
                <option *ngFor="let c of countries" [value]="formatCountryOption(c)"></option>
              </datalist>
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" [(ngModel)]="saveAddress" name="saveAddress" />
                {{ 'checkout.saveAddress' | translate }}
              </label>
                <p *ngIf="addressError" class="text-sm text-amber-700 dark:text-amber-300">{{ addressError }}</p>
              </div>

	              <div class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	                <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em] dark:text-slate-200">{{ 'checkout.step3' | translate }}</p>
	                <ng-container *ngIf="auth.isAuthenticated(); else guestCoupons">
	                  <div class="flex gap-3">
	                    <input
	                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 flex-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
	                      [(ngModel)]="promo"
	                      name="promo"
	                      [placeholder]="'checkout.promoPlaceholder' | translate"
	                    />
	                    <app-button size="sm" [label]="'checkout.apply' | translate" (action)="applyPromo()"></app-button>
	                  </div>
	                  <p
	                    class="text-sm"
	                    [ngClass]="
	                      promoStatus === 'success'
	                        ? 'text-emerald-700 dark:text-emerald-300'
	                        : promoStatus === 'warn'
	                          ? 'text-amber-700 dark:text-amber-300'
	                          : 'text-slate-700 dark:text-slate-300'
	                    "
	                    *ngIf="promoMessage"
	                  >
	                    {{ promoMessage }}
	                  </p>

	                  <div class="grid gap-2 pt-2">
	                    <p *ngIf="couponEligibilityLoading" class="text-xs text-slate-500 dark:text-slate-400">
	                      {{ 'checkout.couponsLoading' | translate }}
	                    </p>
	                    <p *ngIf="couponEligibilityError" class="text-xs text-amber-700 dark:text-amber-300">
	                      {{ couponEligibilityError }}
	                    </p>

	                    <ng-container *ngIf="!couponEligibilityLoading && !couponEligibilityError && couponEligibility">
	                      <div *ngIf="couponEligibility.eligible.length" class="grid gap-2">
                          <div
                            *ngIf="suggestedCouponOffer && !appliedCouponOffer"
                            class="grid gap-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-900/40 dark:bg-indigo-950/30"
                          >
                            <p class="text-xs font-semibold text-indigo-900 dark:text-indigo-100">
                              {{ 'checkout.bestCouponTitle' | translate }}
                            </p>
                            <div class="flex items-start justify-between gap-3">
                              <div class="min-w-0">
                                <p class="text-sm font-medium text-slate-900 dark:text-slate-50">
                                  {{ suggestedCouponOffer.coupon.promotion?.name || suggestedCouponOffer.coupon.code }}
                                </p>
                                <p class="text-xs text-slate-700 dark:text-slate-200">
                                  {{ describeCouponOffer(suggestedCouponOffer) }}
                                </p>
                              </div>
                              <app-button
                                size="sm"
                                variant="ghost"
                                [label]="'checkout.apply' | translate"
                                (action)="applyCouponOffer(suggestedCouponOffer)"
                              ></app-button>
                            </div>
                          </div>
	                        <p class="text-xs font-semibold text-slate-700 dark:text-slate-200">
	                          {{ 'checkout.availableCoupons' | translate }}
	                        </p>
	                        <div class="grid gap-2">
	                          <div
	                            *ngFor="let offer of couponEligibility.eligible"
	                            class="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/30"
	                          >
	                            <div class="min-w-0">
	                              <p class="text-sm font-medium text-slate-900 dark:text-slate-50">
	                                {{ offer.coupon.promotion?.name || offer.coupon.code }}
	                              </p>
	                              <p class="text-xs text-slate-600 dark:text-slate-300">
	                                {{ describeCouponOffer(offer) }}
	                              </p>
	                            </div>
	                            <app-button
	                              size="sm"
	                              variant="ghost"
	                              [label]="'checkout.apply' | translate"
	                              (action)="applyCouponOffer(offer)"
	                            ></app-button>
	                          </div>
	                        </div>
	                      </div>

	                      <details *ngIf="couponEligibility.ineligible.length" class="grid gap-2">
	                        <summary class="cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-200">
	                          {{ 'checkout.unavailableCoupons' | translate }}
	                        </summary>
	                        <div class="grid gap-2">
	                          <div
	                            *ngFor="let offer of couponEligibility.ineligible"
	                            class="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
	                          >
	                            <div class="min-w-0">
	                              <p class="text-sm font-medium text-slate-900 dark:text-slate-50">
	                                {{ offer.coupon.promotion?.name || offer.coupon.code }}
	                              </p>
	                              <p class="text-xs text-slate-600 dark:text-slate-300">
	                                {{ describeCouponOffer(offer) }}
	                              </p>
	                              <p *ngIf="offer.reasons?.length" class="text-xs text-amber-700 dark:text-amber-300 pt-1">
	                                {{ describeCouponReasons(offer.reasons) }}
	                              </p>
                                  <ng-container *ngIf="minSubtotalShortfall(offer) as minInfo">
                                    <p class="text-xs text-slate-600 dark:text-slate-300 pt-1">
                                      {{
                                        'checkout.couponMinSubtotalRemaining'
                                          | translate
                                            : { amount: minInfo.remaining.toFixed(2), min: minInfo.min.toFixed(2) }
                                      }}
                                    </p>
                                    <div class="mt-1 h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800">
                                      <div
                                        class="h-2 rounded-full bg-indigo-600"
                                        [style.width.%]="minInfo.progress * 100"
                                      ></div>
                                    </div>
                                  </ng-container>
	                            </div>
	                            <span class="font-mono text-xs text-slate-500 dark:text-slate-400">{{ offer.coupon.code }}</span>
	                          </div>
	                        </div>
	                      </details>
	                    </ng-container>
	                  </div>
	                </ng-container>

	                <ng-template #guestCoupons>
	                  <div class="grid gap-2">
	                    <p class="text-sm text-slate-700 dark:text-slate-300">{{ 'checkout.couponsLoginRequired' | translate }}</p>
	                    <div class="flex flex-wrap gap-2">
	                      <app-button size="sm" variant="ghost" [label]="'nav.signIn' | translate" routerLink="/login"></app-button>
	                      <app-button size="sm" variant="ghost" [label]="'nav.register' | translate" routerLink="/register"></app-button>
	                    </div>
	                  </div>
	                </ng-template>
	            </div>

	            <div class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
	              <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em] dark:text-slate-200">{{ 'checkout.step4' | translate }}</p>
              <div class="flex flex-wrap gap-3">
                <button
                  type="button"
                  class="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  [ngClass]="
                    paymentMethod === 'cod'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/30 dark:text-indigo-100'
                      : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
                  "
                  (click)="setPaymentMethod('cod')"
                  [attr.aria-pressed]="paymentMethod === 'cod'"
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
                  [disabled]="!netopiaEnabled"
                  [ngClass]="
                    paymentMethod === 'netopia'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/30 dark:text-indigo-100'
                      : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
                  "
                  (click)="setPaymentMethod('netopia')"
                  [attr.aria-pressed]="paymentMethod === 'netopia'"
                >
                  <span class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white dark:bg-slate-100 dark:text-slate-900">
                    N
                  </span>
                  <span>{{ 'checkout.paymentNetopia' | translate }}</span>
                </button>
                <button
                  *ngIf="paypalEnabled"
                  type="button"
                  class="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  [ngClass]="
                    paymentMethod === 'paypal'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/30 dark:text-indigo-100'
                      : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
                  "
                  (click)="setPaymentMethod('paypal')"
                  [attr.aria-pressed]="paymentMethod === 'paypal'"
                >
                  <span class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#003087] text-xs font-bold text-white">P</span>
                  <span>{{ 'checkout.paymentPayPal' | translate }}</span>
                </button>
                <button
                  type="button"
                  class="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  [ngClass]="
                    paymentMethod === 'stripe'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/30 dark:text-indigo-100'
                      : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
                  "
                  (click)="setPaymentMethod('stripe')"
                  [attr.aria-pressed]="paymentMethod === 'stripe'"
                >
                  <span class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#635BFF] text-xs font-bold text-white">S</span>
                  <span>{{ 'checkout.paymentStripe' | translate }}</span>
                </button>
              </div>
              <p class="text-xs text-slate-600 dark:text-slate-300" *ngIf="paymentMethod === 'cod'">
                {{ 'checkout.paymentCashHint' | translate }}
              </p>
              <p class="text-xs text-slate-600 dark:text-slate-300" *ngIf="paymentMethod === 'netopia'">
                {{ netopiaEnabled ? ('checkout.paymentNetopiaHint' | translate) : ('checkout.paymentNetopiaDisabled' | translate) }}
              </p>
              <p class="text-xs text-slate-600 dark:text-slate-300" *ngIf="paymentMethod === 'paypal'">
                {{ 'checkout.paymentPayPalHint' | translate }}
              </p>
              <p class="text-xs text-slate-600 dark:text-slate-300" *ngIf="paymentMethod === 'stripe'">
                {{ 'checkout.paymentStripeHint' | translate }}
              </p>
            </div>

            <div class="flex gap-3">
              <app-button [label]="'checkout.placeOrder' | translate" type="submit"></app-button>
              <app-button variant="ghost" [label]="'checkout.backToCart' | translate" routerLink="/cart"></app-button>
            </div>
          </form>
        </section>

        <aside class="rounded-2xl border border-slate-200 bg-white p-4 grid gap-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'checkout.summary' | translate }}</h2>
          <div class="grid gap-2 text-sm text-slate-700 dark:text-slate-200">
            <div *ngFor="let item of items()">
              <div class="flex justify-between">
                <span>{{ item.name }} × {{ item.quantity }}</span>
                <span>{{ item.price * item.quantity | localizedCurrency : item.currency }}</span>
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400">Stock: {{ item.stock }}</p>
            </div>
          </div>
          <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
            <span>{{ 'checkout.subtotal' | translate }}</span>
            <span>{{ quoteSubtotal() | localizedCurrency : currency }}</span>
          </div>
          <div
            class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200"
            *ngIf="quoteFee() > 0"
          >
            <span>{{ 'checkout.additionalCost' | translate }}</span>
            <span>{{ quoteFee() | localizedCurrency : currency }}</span>
          </div>
          <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200" *ngIf="quoteTax() > 0">
            <span>{{ 'checkout.tax' | translate }}</span>
            <span>{{ quoteTax() | localizedCurrency : currency }}</span>
          </div>
          <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
            <span>{{ 'checkout.shipping' | translate }}</span>
            <span>{{ quoteShipping() | localizedCurrency : currency }}</span>
          </div>
          <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200" *ngIf="quotePromoSavings() > 0">
            <span>{{ 'checkout.promo' | translate }}</span>
            <span class="text-emerald-700 dark:text-emerald-300">-{{ quotePromoSavings() | localizedCurrency : currency }}</span>
          </div>
          <div class="border-t border-slate-200 pt-3 flex items-center justify-between text-base font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-50">
            <span>{{ 'checkout.estimatedTotal' | translate }}</span>
            <span>{{ quoteTotal() | localizedCurrency : currency }}</span>
          </div>
          </aside>
        </div>
      </app-container>
    `
})
export class CheckoutComponent implements OnInit, OnDestroy {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'nav.cart', url: '/cart' },
    { label: 'checkout.title' }
  ];
  promo = '';
  promoMessage = '';
  promoStatus: 'success' | 'warn' | 'info' = 'info';
  promoValid = true;

  couponEligibility: CouponEligibilityResponse | null = null;
  couponEligibilityLoading = false;
  couponEligibilityError = '';
  appliedCouponOffer: CouponOffer | null = null;
  suggestedCouponOffer: CouponOffer | null = null;
  private pendingPromoCode: string | null = null;
  countries: PhoneCountryOption[] = [];
  readonly roCounties = RO_COUNTIES;
  readonly roCities = RO_CITIES;
  shippingCountryInput = '';
  billingCountryInput = '';
  shippingCountryError = '';
  billingCountryError = '';
  savedAddresses: Address[] = [];
  savedAddressesLoading = false;
  savedAddressesError = '';
  selectedShippingAddressId = '';
  selectedBillingAddressId = '';
  addressError = '';
  errorMessage = '';
  pricesRefreshed = false;
  saveAddress = true;
  guestCreateAccount = false;
  guestUsername = '';
  guestPassword = '';
  guestPasswordConfirm = '';
  guestShowPassword = false;
  guestShowPasswordConfirm = false;
  guestFirstName = '';
  guestMiddleName = '';
  guestLastName = '';
  guestDob = '';
  phoneCountries: PhoneCountryOption[] = [];
  guestPhoneCountry = 'RO';
  guestPhoneNational = '';
  guestVerificationToken = '';
  guestVerificationSent = false;
  guestEmailVerified = false;
  guestSendingCode = false;
  guestConfirmingCode = false;
  guestEmailError = '';
  private lastGuestEmailRequested: string | null = null;
  private lastGuestEmailVerified: string | null = null;
  courier: LockerProvider = 'sameday';
  deliveryType: 'home' | 'locker' = 'home';
  locker: LockerRead | null = null;
  deliveryError = '';
  private quote: CheckoutQuote | null = null;
  address: CheckoutShippingAddress = {
    name: '',
    email: '',
    line1: '',
    line2: '',
    city: '',
    region: '',
    postal: '',
    country: '',
    password: ''
  };
  billingSameAsShipping = true;
  billing: CheckoutBillingAddress = {
    line1: '',
    line2: '',
    city: '',
    region: '',
    postal: '',
    country: ''
  };

  syncing = false;
  placing = false;
  paymentMethod: CheckoutPaymentMethod = 'cod';
  paypalEnabled = Boolean(appConfig.paypalEnabled);
  netopiaEnabled = Boolean(appConfig.netopiaEnabled);

  constructor(
    private cart: CartStore,
    private router: Router,
    private route: ActivatedRoute,
    private cartApi: CartApi,
    private api: ApiService,
    private accountService: AccountService,
    private couponsService: CouponsService,
    private translate: TranslateService,
    public auth: AuthService
  ) {
    const saved = this.loadSavedCheckout();
    if (saved) {
      this.address = saved.address;
      this.billingSameAsShipping = saved.billingSameAsShipping;
      this.billing = saved.billing;
      this.courier = saved.courier ?? 'sameday';
      this.deliveryType = saved.deliveryType ?? 'home';
      this.locker = saved.locker ?? null;
    }
    this.paymentMethod = this.defaultPaymentMethod();
    this.phoneCountries = listPhoneCountries(this.translate.currentLang || 'en');
    this.countries = this.phoneCountries;
    if (!this.address.country) this.address.country = 'RO';
    if (!this.billing.country) this.billing.country = this.address.country;
    this.shippingCountryInput = this.countryInputFromCode(this.address.country);
    this.billingCountryInput = this.countryInputFromCode(this.billing.country);
  }

  items = this.cart.items;
  subtotal = this.cart.subtotal;
  currency = 'RON';

  emailVerified(): boolean {
    return Boolean(this.auth.user()?.email_verified);
  }

  private prefillFromUser(): void {
    const user = this.auth.user();
    if (!user) return;
    if (!this.address.email) {
      this.address.email = user.email || '';
    }
    if (!this.address.name) {
      const parts = [user.first_name, user.middle_name, user.last_name].filter((p) => (p || '').trim());
      const fullName = parts.join(' ').trim();
      this.address.name = fullName || user.name || '';
    }
  }

  formatSavedAddress(addr: Address): string {
    const label = (addr.label || '').trim();
    const line1 = (addr.line1 || '').trim();
    const city = (addr.city || '').trim();
    const region = (addr.region || '').trim();
    const country = (addr.country || '').trim();
    const place = [city, region].filter((p) => p).join(', ');
    const tail = [place, country].filter((p) => p).join(' · ');
    const title = label || this.translate.instant('account.addresses.labels.address');
    const body = [line1, tail].filter((p) => p).join(' · ');
    return body ? `${title} — ${body}` : title;
  }

  applySelectedShippingAddress(): void {
    const id = (this.selectedShippingAddressId || '').trim();
    if (!id) return;
    const addr = this.savedAddresses.find((a) => a.id === id);
    if (!addr) return;
    this.applySavedAddressToShipping(addr);
  }

  applySelectedBillingAddress(): void {
    const id = (this.selectedBillingAddressId || '').trim();
    if (!id) return;
    const addr = this.savedAddresses.find((a) => a.id === id);
    if (!addr) return;
    this.applySavedAddressToBilling(addr);
  }

  private applySavedAddressToShipping(addr: Address): void {
    this.address.line1 = addr.line1 || '';
    this.address.line2 = addr.line2 || '';
    this.address.city = addr.city || '';
    this.address.region = addr.region || '';
    this.address.postal = addr.postal_code || '';
    this.address.country = (addr.country || '').trim().toUpperCase();
    this.shippingCountryInput = this.countryInputFromCode(this.address.country);
    if (this.billingSameAsShipping) {
      this.billing.country = this.address.country;
      this.billingCountryInput = this.countryInputFromCode(this.billing.country);
    }
    this.addressError = '';
    this.shippingCountryError = '';
    this.saveAddress = false;
  }

  private applySavedAddressToBilling(addr: Address): void {
    this.billing.line1 = addr.line1 || '';
    this.billing.line2 = addr.line2 || '';
    this.billing.city = addr.city || '';
    this.billing.region = addr.region || '';
    this.billing.postal = addr.postal_code || '';
    this.billing.country = (addr.country || '').trim().toUpperCase();
    this.billingCountryInput = this.countryInputFromCode(this.billing.country);
    this.billingCountryError = '';
    this.saveAddress = false;
  }

  formatCountryOption(country: PhoneCountryOption): string {
    return `${country.code} — ${country.name}`;
  }

  normalizeShippingCountry(): void {
    this.shippingCountryError = '';
    const code = this.resolveCountryCode(this.shippingCountryInput);
    if (!code) {
      this.shippingCountryError = this.translate.instant('checkout.countryInvalid');
      return;
    }
    this.address.country = code;
    this.shippingCountryInput = this.countryInputFromCode(code);
    if (this.billingSameAsShipping) {
      this.billing.country = code;
      this.billingCountryInput = this.countryInputFromCode(code);
    }
  }

  normalizeBillingCountry(): void {
    this.billingCountryError = '';
    const code = this.resolveCountryCode(this.billingCountryInput);
    if (!code) {
      this.billingCountryError = this.translate.instant('checkout.countryInvalid');
      return;
    }
    this.billing.country = code;
    this.billingCountryInput = this.countryInputFromCode(code);
  }

  private normalizeCheckoutCountries(): boolean {
    this.shippingCountryError = '';
    this.billingCountryError = '';
    const shippingCode = this.resolveCountryCode(this.shippingCountryInput);
    if (!shippingCode) {
      this.shippingCountryError = this.translate.instant('checkout.countryInvalid');
      return false;
    }
    this.address.country = shippingCode;
    this.shippingCountryInput = this.countryInputFromCode(shippingCode);
    if (this.billingSameAsShipping) {
      this.billing.country = shippingCode;
      this.billingCountryInput = this.countryInputFromCode(shippingCode);
      return true;
    }
    const billingCode = this.resolveCountryCode(this.billingCountryInput);
    if (!billingCode) {
      this.billingCountryError = this.translate.instant('checkout.countryInvalid');
      return false;
    }
    this.billing.country = billingCode;
    this.billingCountryInput = this.countryInputFromCode(billingCode);
    return true;
  }

  private resolveCountryCode(raw: string): string | null {
    const trimmed = (raw || '').trim();
    if (!trimmed) return null;

    const codeMatch = trimmed.match(/^([A-Za-z]{2})\b/);
    if (codeMatch) {
      const code = codeMatch[1].toUpperCase();
      if (this.countries.some((c) => c.code === code)) return code;
    }

    const normalized = trimmed.toLowerCase();
    const byName = this.countries.find((c) => c.name.toLowerCase() === normalized);
    if (byName) return byName.code;

    const withoutParen = normalized.replace(/\s*\([a-z]{2}\)\s*$/, '').trim();
    if (withoutParen && withoutParen !== normalized) {
      const match = this.countries.find((c) => c.name.toLowerCase() === withoutParen);
      if (match) return match.code;
    }

    const withoutSuffixCode = normalized.replace(/\s*[-—]\s*[a-z]{2}\s*$/, '').trim();
    if (withoutSuffixCode && withoutSuffixCode !== normalized) {
      const match = this.countries.find((c) => c.name.toLowerCase() === withoutSuffixCode);
      if (match) return match.code;
    }

    return null;
  }

  private countryInputFromCode(code: string): string {
    const normalized = (code || '').trim().toUpperCase();
    if (!normalized) return '';
    const match = this.countries.find((c) => c.code === normalized);
    if (!match) return normalized;
    return this.formatCountryOption(match);
  }

  private loadSavedAddresses(force: boolean = false): void {
    if (!this.auth.isAuthenticated()) return;
    if (this.savedAddressesLoading && !force) return;
    this.savedAddressesLoading = true;
    this.savedAddressesError = '';
    this.accountService.getAddresses().subscribe({
      next: (addresses) => {
        this.savedAddresses = Array.isArray(addresses) ? addresses : [];
        if (!this.address.line1.trim() && !this.address.city.trim() && !this.address.postal.trim() && this.savedAddresses.length) {
          const defaultShipping = this.savedAddresses.find((a) => a.is_default_shipping) ?? this.savedAddresses[0];
          this.selectedShippingAddressId = defaultShipping.id;
          this.applySavedAddressToShipping(defaultShipping);
        }
        this.savedAddressesLoading = false;
      },
      error: () => {
        this.savedAddresses = [];
        this.savedAddressesError = this.translate.instant('checkout.savedAddressesLoadError');
        this.savedAddressesLoading = false;
      }
    });
  }

  onEmailChanged(): void {
    if (this.auth.isAuthenticated()) return;
    const normalized = (this.address.email || '').trim().toLowerCase();
    if (this.lastGuestEmailVerified && normalized !== this.lastGuestEmailVerified) {
      this.guestEmailVerified = false;
      this.lastGuestEmailVerified = null;
    }
    if (this.lastGuestEmailRequested && normalized !== this.lastGuestEmailRequested) {
      this.guestVerificationSent = false;
      this.guestVerificationToken = '';
      this.guestEmailError = '';
      this.lastGuestEmailRequested = null;
    }
  }

  toggleGuestPassword(): void {
    this.guestShowPassword = !this.guestShowPassword;
  }

  toggleGuestPasswordConfirm(): void {
    this.guestShowPasswordConfirm = !this.guestShowPasswordConfirm;
  }

  guestPhoneE164(): string | null {
    const country = (this.guestPhoneCountry || 'RO') as any;
    return buildE164(country, this.guestPhoneNational);
  }

  quoteSubtotal(): number {
    return this.quote?.subtotal ?? this.subtotal();
  }

  quoteTax(): number {
    return this.quote?.tax ?? 0;
  }

  quoteFee(): number {
    return this.quote?.fee ?? 0;
  }

  quoteShipping(): number {
    return this.quote?.shipping ?? 0;
  }

  quoteTotal(): number {
    return this.quote?.total ?? this.subtotal();
  }

  quoteDiscount(): number {
    const q = this.quote;
    if (!q) return 0;
    return Math.max(0, q.subtotal + q.fee + q.tax + q.shipping - q.total);
  }

  quotePromoSavings(): number {
    const discount = this.quoteDiscount();
    return Math.max(0, discount + this.couponShippingDiscount());
  }

  applyCouponOffer(offer: CouponOffer): void {
    this.promo = offer.coupon.code;
    this.appliedCouponOffer = offer;
    this.applyPromo();
  }

  describeCouponOffer(offer: CouponOffer): string {
    const promo = offer.coupon.promotion;
    if (!promo) return offer.coupon.code;

    let label = this.translate.instant('account.coupons.coupon');
    if (promo.discount_type === 'free_shipping') {
      label = this.translate.instant('account.coupons.freeShipping');
    } else if (promo.discount_type === 'amount') {
      label = this.translate.instant('account.coupons.amountOff', { value: promo.amount_off ?? '0' });
    } else {
      label = this.translate.instant('account.coupons.percentOff', { value: promo.percentage_off ?? '0' });
    }

    const savings = this.couponOfferSavings(offer);
    if (savings <= 0) return `${offer.coupon.code} · ${label}`;
    return `${offer.coupon.code} · ${label} · ≈${savings.toFixed(2)} RON`;
  }

  describeCouponReasons(reasons: string[]): string {
    if (!reasons || reasons.length === 0) {
      return this.translate.instant('checkout.couponNotEligible');
    }
    const labels = reasons.map((reason) => {
      const key = `checkout.couponReasons.${reason}`;
      const translated = this.translate.instant(key);
      return translated === key ? reason : translated;
    });
    return labels.join(' • ');
  }

  minSubtotalShortfall(offer: CouponOffer | null): { min: number; remaining: number; progress: number } | null {
    if (!offer?.reasons?.includes('min_subtotal_not_met')) return null;
    const promo = offer.coupon?.promotion;
    if (!promo?.min_subtotal) return null;
    const min = parseMoney(promo.min_subtotal);
    if (!Number.isFinite(min) || min <= 0) return null;
    const current = this.quoteSubtotal();
    const remaining = Math.max(0, min - current);
    if (remaining <= 0) return null;
    const progress = Math.max(0, Math.min(1, current / min));
    return { min, remaining, progress };
  }

  private pickBestCouponOffer(offers: CouponOffer[]): CouponOffer | null {
    let best: CouponOffer | null = null;
    let bestSavings = 0;
    for (const offer of offers ?? []) {
      if (!offer?.eligible) continue;
      const savings = this.couponOfferSavings(offer);
      if (!Number.isFinite(savings) || savings <= 0) continue;
      if (!best || savings > bestSavings) {
        best = offer;
        bestSavings = savings;
      }
    }
    return best;
  }

	  private couponShippingDiscount(): number {
	    const offer = this.appliedCouponOffer;
	    if (!offer || !offer.eligible) return 0;
	    const currentCode = (this.promo || '').trim().toUpperCase();
	    if (!currentCode || offer.coupon.code.toUpperCase() !== currentCode) return 0;
	    return parseMoney(offer.estimated_shipping_discount_ron);
	  }

	  private couponOfferSavings(offer: CouponOffer): number {
	    return parseMoney(offer.estimated_discount_ron) + parseMoney(offer.estimated_shipping_discount_ron);
	  }

  private buildSuccessSummary(orderId: string, referenceCode: string | null, paymentMethod: CheckoutPaymentMethod): CheckoutSuccessSummary {
    const quote = this.quote ?? { subtotal: this.subtotal(), fee: 0, tax: 0, shipping: 0, total: this.subtotal(), currency: this.currency };
    const discount = Math.max(0, quote.subtotal + quote.fee + quote.tax + quote.shipping - quote.total);
    const items = this.items().map((i) => ({
      name: i.name,
      slug: i.slug,
      quantity: i.quantity,
      unit_price: i.price,
      currency: i.currency || this.currency
    }));
    return {
      order_id: orderId,
      reference_code: referenceCode,
      payment_method: paymentMethod,
      courier: this.courier ?? null,
      delivery_type: this.deliveryType ?? null,
      locker_name: this.locker?.name ?? null,
      locker_address: this.locker?.address ?? null,
      totals: { ...quote, discount },
      items,
      created_at: new Date().toISOString()
    };
  }

  private persistSuccessSummary(summary: CheckoutSuccessSummary): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CHECKOUT_SUCCESS_KEY, JSON.stringify(summary));
  }

  private persistPayPalPendingSummary(summary: CheckoutSuccessSummary): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CHECKOUT_PAYPAL_PENDING_KEY, JSON.stringify(summary));
  }

  private persistStripePendingSummary(summary: CheckoutSuccessSummary): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CHECKOUT_STRIPE_PENDING_KEY, JSON.stringify(summary));
  }

  private hydrateCartAndQuote(res: CartResponse): void {
    this.cart.hydrateFromBackend(res);
    this.setQuote(res);
  }

	  private setQuote(res: CartResponse): void {
	    const totals = res?.totals ?? ({} as any);
	    const subtotal = parseMoney(totals.subtotal);
	    const fee = parseMoney(totals.fee);
	    const tax = parseMoney(totals.tax);
	    const shipping = parseMoney(totals.shipping);
	    const total = parseMoney(totals.total);
	    const currency = (totals.currency ?? 'RON') as string;
	    this.quote = { subtotal, fee, tax, shipping, total, currency };
	    this.currency = currency || 'RON';
	    this.loadCouponsEligibility();
	    this.applyPendingPromoCode();
	  }

	  private loadCouponsEligibility(): void {
	    if (!this.auth.isAuthenticated()) {
	      this.couponEligibility = null;
      this.couponEligibilityError = '';
      this.couponEligibilityLoading = false;
      this.suggestedCouponOffer = null;
      return;
    }

    this.couponEligibilityLoading = true;
    this.couponEligibilityError = '';
    this.couponsService.eligibility().subscribe({
      next: (res) => {
        this.couponEligibility = res ?? { eligible: [], ineligible: [] };
        this.couponEligibilityLoading = false;
        this.suggestedCouponOffer = this.pickBestCouponOffer(this.couponEligibility.eligible ?? []);

        const current = (this.promo || '').trim().toUpperCase();
        if (!current) {
          this.appliedCouponOffer = null;
          return;
        }
        const offers = [...(this.couponEligibility.eligible ?? []), ...(this.couponEligibility.ineligible ?? [])];
        const match = offers.find((offer) => offer.coupon?.code?.toUpperCase() === current) ?? null;
        this.appliedCouponOffer = match;
      },
      error: (err) => {
        this.couponEligibilityLoading = false;
        this.couponEligibilityError =
          err?.error?.detail || this.translate.instant('checkout.couponsLoadError');
      }
    });
  }

  private applyPendingPromoCode(): void {
    const pending = (this.pendingPromoCode || '').trim().toUpperCase();
    if (!pending) return;
    if (!this.auth.isAuthenticated()) return;

    const current = (this.promo || '').trim().toUpperCase();
    if (current === pending) {
      this.pendingPromoCode = null;
      return;
    }

    this.pendingPromoCode = null;
    this.promo = pending;
    this.applyPromo();
  }

  applyPromo(): void {
    const normalized = (this.promo || '').trim().toUpperCase();
    this.promo = normalized;
    this.promoValid = true;

    if (!normalized) {
      this.appliedCouponOffer = null;
      this.promoMessage = '';
      this.promoStatus = 'info';
      this.refreshQuote(null);
      return;
    }

    if (this.auth.isAuthenticated()) {
      this.couponsService.validate(normalized).subscribe({
        next: (offer) => {
          this.appliedCouponOffer = offer;
          if (!offer.eligible) {
            this.promoStatus = 'warn';
            this.promoValid = false;
            const reasons = this.describeCouponReasons(offer.reasons ?? []);
            const minInfo = this.minSubtotalShortfall(offer);
            if (minInfo) {
              const extra = this.translate.instant('checkout.couponMinSubtotalRemaining', {
                amount: minInfo.remaining.toFixed(2),
                min: minInfo.min.toFixed(2)
              });
              this.promoMessage = `${this.translate.instant('checkout.couponNotEligible')}: ${reasons}. ${extra}`;
            } else {
              this.promoMessage = `${this.translate.instant('checkout.couponNotEligible')}: ${reasons}`;
            }
            this.refreshQuote(null);
            return;
          }
          this.promoStatus = 'success';
          this.promoMessage = this.translate.instant('checkout.promoApplied', { code: normalized });
          this.refreshQuote(normalized);
        },
        error: (err) => {
          if (err?.status === 404) {
            this.appliedCouponOffer = null;
            this.applyLegacyPromo(normalized);
            return;
          }

          this.appliedCouponOffer = null;
          this.promoStatus = 'warn';
          this.promoValid = false;
          this.promoMessage =
            err?.error?.detail || this.translate.instant('checkout.promoPending', { code: normalized });
          this.refreshQuote(null);
        }
      });
      return;
    }

    this.appliedCouponOffer = null;
    this.promoStatus = 'warn';
    this.promoValid = false;
    this.promoMessage = this.translate.instant('checkout.couponsLoginRequired');
    this.promo = '';
    this.refreshQuote(null);
  }

  placeOrder(form: NgForm): void {
    if (!this.normalizeCheckoutCountries()) {
      this.addressError = this.translate.instant('checkout.countryInvalid');
      return;
    }
    form.control.updateValueAndValidity();
    if (!form.valid) {
      this.addressError = this.translate.instant('checkout.addressRequired');
      return;
    }
    this.addressError = '';
    this.deliveryError = '';
    if (this.deliveryType === 'locker' && !this.locker) {
      this.deliveryError = this.translate.instant('checkout.deliveryLockerRequired');
      return;
    }
    if (this.auth.isAuthenticated() && !this.emailVerified()) {
      this.errorMessage = this.translate.instant('auth.emailVerificationNeeded');
      return;
    }
    if (!this.auth.isAuthenticated() && !this.guestEmailVerified) {
      this.errorMessage = this.translate.instant('auth.emailVerificationNeeded');
      return;
    }
    if (!this.auth.isAuthenticated() && this.guestCreateAccount) {
      if (this.guestPassword.length < 6) {
        this.errorMessage = this.translate.instant('validation.passwordMin');
        return;
      }
      if (this.guestPassword !== this.guestPasswordConfirm) {
        this.errorMessage = this.translate.instant('validation.passwordMismatch');
        return;
      }
      if (!this.guestPhoneE164()) {
        this.errorMessage = this.translate.instant('validation.phoneInvalid');
        return;
      }
    }
    const validation = this.validateCart();
    if (validation) {
      this.errorMessage = validation;
      return;
    }
    this.errorMessage = '';
    if (this.paymentMethod === 'paypal' && !this.paypalEnabled) {
      this.errorMessage = this.translate.instant('checkout.paymentNotReady');
      return;
    }
    if (this.paymentMethod === 'netopia' && !this.netopiaEnabled) {
      this.errorMessage = this.translate.instant('checkout.paymentNotReady');
      return;
    }
    this.placing = true;
    if (this.auth.isAuthenticated()) {
      this.submitCheckout();
    } else {
      this.submitGuestCheckout();
    }
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
      this.syncBackendCart(items);
      this.pricesRefreshed = true;
      return null;
    }
    return null;
  }

  private persistAddress(): void {
    if (typeof localStorage === 'undefined') return;
    const billing = this.billingSameAsShipping
      ? { line1: this.address.line1, line2: this.address.line2, city: this.address.city, region: this.address.region, postal: this.address.postal, country: this.address.country }
      : this.billing;
    localStorage.setItem(
      'checkout_address',
      JSON.stringify({
        address: {
          name: this.address.name,
          email: this.address.email,
          line1: this.address.line1,
          line2: this.address.line2 || '',
          city: this.address.city,
          region: this.address.region || '',
          postal: this.address.postal,
          country: this.address.country || '',
        },
        billingSameAsShipping: this.billingSameAsShipping,
        billing: {
          line1: billing.line1,
          line2: billing.line2 || '',
          city: billing.city,
          region: billing.region || '',
          postal: billing.postal,
          country: billing.country || '',
        },
        courier: this.courier,
        deliveryType: this.deliveryType,
        locker: this.locker ? { ...this.locker } : null
      })
    );
  }

  private loadSavedCheckout(): SavedCheckout | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem('checkout_address');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as any;
      if (parsed && typeof parsed === 'object' && parsed.address) {
        const addr = parsed.address as any;
        const billing = (parsed.billing as any) || null;
        const billingSame = Boolean(parsed.billingSameAsShipping);
        return {
          address: {
            name: String(addr.name || ''),
            email: String(addr.email || ''),
            line1: String(addr.line1 || ''),
            line2: String(addr.line2 || ''),
            city: String(addr.city || ''),
            region: String(addr.region || ''),
            postal: String(addr.postal || ''),
            country: String(addr.country || ''),
            password: ''
          },
          billingSameAsShipping: billingSame,
          billing: {
            line1: String(billing?.line1 || ''),
            line2: String(billing?.line2 || ''),
            city: String(billing?.city || ''),
            region: String(billing?.region || ''),
            postal: String(billing?.postal || ''),
            country: String(billing?.country || '')
          },
          courier: parsed.courier === 'fan_courier' ? 'fan_courier' : 'sameday',
          deliveryType: parsed.deliveryType === 'locker' ? 'locker' : 'home',
          locker: parsed.locker && typeof parsed.locker === 'object' ? (parsed.locker as LockerRead) : null
        };
      }
      // legacy shape: the stored value was the flat address object
      const legacy = parsed as any;
      const addr = {
        name: String(legacy.name || ''),
        email: String(legacy.email || ''),
        line1: String(legacy.line1 || ''),
        line2: String(legacy.line2 || ''),
        city: String(legacy.city || ''),
        region: String(legacy.region || ''),
        postal: String(legacy.postal || ''),
        country: String(legacy.country || ''),
        password: ''
      };
      return {
        address: addr,
        billingSameAsShipping: true,
        billing: {
          line1: addr.line1,
          line2: addr.line2,
          city: addr.city,
          region: addr.region,
          postal: addr.postal,
          country: addr.country
        },
        courier: 'sameday',
        deliveryType: 'home',
        locker: null
      };
    } catch {
      return null;
    }
  }

  setDeliveryType(value: 'home' | 'locker'): void {
    this.deliveryType = value;
    this.deliveryError = '';
    if (value === 'home') {
      this.locker = null;
    }
  }

  onCourierChanged(): void {
    this.deliveryError = '';
    if (this.deliveryType === 'locker') {
      this.locker = null;
    }
  }

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const promo = (params.get('promo') || '').trim();
      if (!promo) return;
      const normalized = promo.toUpperCase();
      if (normalized && normalized !== this.promo.trim().toUpperCase()) {
        this.pendingPromoCode = normalized;
      }
    });
    this.prefillFromUser();
    this.loadSavedAddresses();
    const items = this.items();
    if (items.length) {
      this.syncBackendCart(items);
    } else {
      this.loadCartFromServer();
    }
    this.loadGuestEmailVerificationStatus();
  }

  ngOnDestroy(): void {
  }

  setPaymentMethod(method: CheckoutPaymentMethod): void {
    if (method === 'paypal' && !this.paypalEnabled) {
      this.errorMessage = this.translate.instant('checkout.paymentNotReady');
      return;
    }
    if (method === 'netopia' && !this.netopiaEnabled) {
      this.errorMessage = this.translate.instant('checkout.paymentNotReady');
      return;
    }
    this.paymentMethod = method;
    this.errorMessage = '';
  }

  private defaultPaymentMethod(): CheckoutPaymentMethod {
    return 'cod';
  }

  private syncBackendCart(items: CartItem[]): void {
    this.syncing = true;
    this.cartApi
      .sync(
        items.map((i) => ({
          product_id: i.product_id,
          variant_id: i.variant_id,
          quantity: i.quantity,
          note: undefined,
          max_quantity: undefined
        }))
      )
      .subscribe({
        next: (res) => {
          this.hydrateCartAndQuote(res);
          this.syncing = false;
        },
        error: () => {
          this.syncing = false;
          this.errorMessage = this.translate.instant('checkout.cartSyncError');
        }
      });
  }

  private loadCartFromServer(): void {
    this.syncing = true;
    this.auth.ensureAuthenticated({ silent: true }).subscribe({
      next: () => {
        this.cartApi.get().subscribe({
          next: (res) => {
            this.hydrateCartAndQuote(res);
            this.syncing = false;
          },
          error: () => {
            this.syncing = false;
            this.errorMessage = this.translate.instant('checkout.cartLoadError');
          }
        });
      },
      error: () => {
        this.syncing = false;
        this.errorMessage = this.translate.instant('checkout.cartLoadError');
      }
    });
  }

  private refreshQuote(promo: string | null): void {
    const code = (promo || '').trim();
    const params = code ? { promo_code: code } : undefined;
    this.cartApi.get(params).subscribe({
      next: (res) => {
        this.hydrateCartAndQuote(res);
      },
      error: (err) => {
        // Don't block checkout on promo quote; checkout will validate server-side.
        if (code) {
          this.promoStatus = 'warn';
          this.promoValid = false;
          this.promoMessage = err?.error?.detail || this.translate.instant('checkout.promoPending', { code });
          this.cartApi.get().subscribe({
            next: (res) => this.hydrateCartAndQuote(res),
            error: () => {}
          });
        }
      }
    });
  }

  private applyLegacyPromo(code: string): void {
    this.cartApi.get({ promo_code: code }).subscribe({
      next: (res) => {
        this.hydrateCartAndQuote(res);
        const savings = this.quotePromoSavings();
        if (savings > 0) {
          this.promoStatus = 'success';
          this.promoValid = true;
          this.promoMessage = this.translate.instant('checkout.promoApplied', { code });
        } else {
          this.promoStatus = 'warn';
          this.promoValid = false;
          this.promoMessage = this.translate.instant('checkout.promoPending', { code });
        }
      },
      error: (err) => {
        this.promoStatus = 'warn';
        this.promoValid = false;
        this.promoMessage = err?.error?.detail || this.translate.instant('checkout.promoPending', { code });
        this.cartApi.get().subscribe({
          next: (res) => this.hydrateCartAndQuote(res),
          error: () => {}
        });
      }
    });
  }

  private submitCheckout(): void {
    const body: Record<string, unknown> = {
      line1: this.address.line1,
      line2: this.address.line2,
      city: this.address.city,
      region: this.address.region,
      postal_code: this.address.postal,
      country: this.address.country || 'RO',
      shipping_method_id: null,
      promo_code: this.promo || null,
      save_address: this.saveAddress,
      courier: this.courier,
      delivery_type: this.deliveryType,
      locker_id: this.deliveryType === 'locker' ? this.locker?.id ?? null : null,
      locker_name: this.deliveryType === 'locker' ? this.locker?.name ?? null : null,
      locker_address: this.deliveryType === 'locker' ? this.locker?.address ?? null : null,
      locker_lat: this.deliveryType === 'locker' ? this.locker?.lat ?? null : null,
      locker_lng: this.deliveryType === 'locker' ? this.locker?.lng ?? null : null,
    };
    if (!this.billingSameAsShipping) {
      body['billing_line1'] = this.billing.line1;
      body['billing_line2'] = this.billing.line2 || null;
      body['billing_city'] = this.billing.city;
      body['billing_region'] = this.billing.region || null;
      body['billing_postal_code'] = this.billing.postal;
      body['billing_country'] = this.billing.country || this.address.country || 'RO';
    }
    body['payment_method'] = this.paymentMethod;
    this.api
      .post<{
        order_id: string;
        reference_code?: string;
        paypal_order_id?: string | null;
        paypal_approval_url?: string | null;
        stripe_session_id?: string | null;
        stripe_checkout_url?: string | null;
        payment_method?: string;
      }>(
        '/orders/checkout',
        body,
        this.cartApi.headers()
      )
      .subscribe({
        next: (res) => {
          const method = (res.payment_method as CheckoutPaymentMethod | undefined) ?? this.paymentMethod;
          if (this.paymentMethod === 'paypal') {
            this.persistPayPalPendingSummary(
              this.buildSuccessSummary(res.order_id, res.reference_code ?? null, method)
            );
            if (this.saveAddress) this.persistAddress();
            this.placing = false;
            if (res.paypal_approval_url) {
              window.location.assign(res.paypal_approval_url);
              return;
            }
            this.errorMessage = this.translate.instant('checkout.paymentNotReady');
            return;
          }
          if (this.paymentMethod === 'stripe') {
            this.persistStripePendingSummary(this.buildSuccessSummary(res.order_id, res.reference_code ?? null, method));
            if (this.saveAddress) this.persistAddress();
            this.placing = false;
            if (res.stripe_checkout_url) {
              window.location.assign(res.stripe_checkout_url);
              return;
            }
            this.errorMessage = this.translate.instant('checkout.paymentNotReady');
            return;
          }
          if (this.paymentMethod === 'netopia') {
            this.persistStripePendingSummary(this.buildSuccessSummary(res.order_id, res.reference_code ?? null, method));
            if (this.saveAddress) this.persistAddress();
            this.placing = false;
            this.errorMessage = this.translate.instant('checkout.paymentNotReady');
            return;
          }
          if (this.paymentMethod === 'cod') {
            this.persistSuccessSummary(
              this.buildSuccessSummary(res.order_id, res.reference_code ?? null, method)
            );
            if (this.saveAddress) this.persistAddress();
            this.cart.clear();
            this.placing = false;
            void this.router.navigate(['/checkout/success']);
            return;
          }
          this.errorMessage = this.translate.instant('checkout.paymentNotReady');
          this.placing = false;
        },
        error: (err) => {
          this.errorMessage = err?.error?.detail || this.translate.instant('checkout.checkoutFailed');
          this.placing = false;
        }
      });
  }

  requestGuestEmailVerification(): void {
    if (this.auth.isAuthenticated()) return;
    this.guestEmailError = '';
    const email = (this.address.email || '').trim();
    if (!email) {
      this.guestEmailError = this.translate.instant('checkout.addressRequired');
      return;
    }

    // Optimistically reveal the token input so the UI doesn't feel unresponsive while the request is in-flight.
    this.guestVerificationSent = true;
    this.guestEmailVerified = false;
    this.lastGuestEmailRequested = email.toLowerCase();
    this.lastGuestEmailVerified = null;

    this.guestSendingCode = true;
    const timeoutId = setTimeout(() => {
      if (!this.guestSendingCode) return;
      this.guestSendingCode = false;
      this.guestEmailError = this.guestEmailError || this.translate.instant('checkout.emailVerifySendFailed');
    }, 15_000);

    const lang = (this.translate.currentLang || 'en') === 'ro' ? 'ro' : 'en';
    const url = `/orders/guest-checkout/email/request?lang=${lang}`;

    this.api.post<void>(url, { email }, this.cartApi.headers()).subscribe({
      next: () => {
        clearTimeout(timeoutId);
        this.guestSendingCode = false;
      },
      error: (err) => {
        clearTimeout(timeoutId);
        this.guestSendingCode = false;
        this.guestEmailError = err?.error?.detail || this.translate.instant('checkout.emailVerifySendFailed');
      },
      complete: () => {
        // Some environments may not emit a `next` value. Treat completion as success.
        clearTimeout(timeoutId);
        this.guestSendingCode = false;
      }
    });
  }

  confirmGuestEmailVerification(): void {
    if (this.auth.isAuthenticated()) return;
    this.guestEmailError = '';
    const email = (this.address.email || '').trim();
    const token = (this.guestVerificationToken || '').trim();
    if (!email || !token) {
      this.guestEmailError = this.translate.instant('checkout.addressRequired');
      return;
    }
    this.guestConfirmingCode = true;
    this.api
      .post<{ email: string | null; verified: boolean }>(
        '/orders/guest-checkout/email/confirm',
        { email, token },
        this.cartApi.headers()
      )
      .subscribe({
        next: (res) => {
          this.guestConfirmingCode = false;
          this.guestEmailVerified = Boolean(res?.verified);
          this.lastGuestEmailVerified = (res?.email || email).trim().toLowerCase();
          this.guestVerificationToken = '';
        },
        error: (err) => {
          this.guestConfirmingCode = false;
          this.guestEmailError = err?.error?.detail || 'Invalid code';
        }
      });
  }

  private loadGuestEmailVerificationStatus(): void {
    if (this.auth.isAuthenticated()) return;
    this.api
      .get<{ email: string | null; verified: boolean }>(
        '/orders/guest-checkout/email/status',
        undefined,
        this.cartApi.headers()
      )
      .subscribe({
        next: (res) => {
          if (!res) return;
          this.guestEmailVerified = Boolean(res.verified);
          const email = (res.email || '').trim();
          if (email) {
            if (!this.address.email) {
              this.address.email = email;
            }
            this.lastGuestEmailVerified = email.toLowerCase();
          }
          if (!this.guestEmailVerified && email) {
            this.lastGuestEmailRequested = email.toLowerCase();
            this.guestVerificationSent = true;
          }
        },
        error: () => {
          // Best-effort; allow checkout UI to function even if status lookup fails.
        }
      });
  }

  private submitGuestCheckout(): void {
    const preferredLanguage = (this.translate.currentLang || 'en') === 'ro' ? 'ro' : 'en';
    const payload: Record<string, unknown> = {
      name: this.address.name,
      email: this.address.email,
      line1: this.address.line1,
      line2: this.address.line2 || null,
      city: this.address.city,
      region: this.address.region || null,
      postal_code: this.address.postal,
      country: this.address.country || 'RO',
      billing_line1: this.billingSameAsShipping ? null : this.billing.line1,
      billing_line2: this.billingSameAsShipping ? null : this.billing.line2 || null,
      billing_city: this.billingSameAsShipping ? null : this.billing.city,
      billing_region: this.billingSameAsShipping ? null : this.billing.region || null,
      billing_postal_code: this.billingSameAsShipping ? null : this.billing.postal,
      billing_country: this.billingSameAsShipping ? null : this.billing.country || this.address.country || 'RO',
      shipping_method_id: null,
      save_address: this.saveAddress,
      payment_method: this.paymentMethod,
      create_account: this.guestCreateAccount,
      courier: this.courier,
      delivery_type: this.deliveryType,
      locker_id: this.deliveryType === 'locker' ? this.locker?.id ?? null : null,
      locker_name: this.deliveryType === 'locker' ? this.locker?.name ?? null : null,
      locker_address: this.deliveryType === 'locker' ? this.locker?.address ?? null : null,
      locker_lat: this.deliveryType === 'locker' ? this.locker?.lat ?? null : null,
      locker_lng: this.deliveryType === 'locker' ? this.locker?.lng ?? null : null,
    };

    if (this.guestCreateAccount) {
      payload['username'] = this.guestUsername;
      payload['password'] = this.guestPassword;
      payload['first_name'] = this.guestFirstName;
      payload['middle_name'] = this.guestMiddleName || null;
      payload['last_name'] = this.guestLastName;
      payload['date_of_birth'] = this.guestDob;
      payload['phone'] = this.guestPhoneE164();
      payload['preferred_language'] = preferredLanguage;
    }

    this.api
      .post<{
        order_id: string;
        reference_code?: string;
        paypal_order_id?: string | null;
        paypal_approval_url?: string | null;
        stripe_session_id?: string | null;
        stripe_checkout_url?: string | null;
        payment_method?: string;
      }>(
        '/orders/guest-checkout',
        payload,
        this.cartApi.headers()
      )
      .subscribe({
        next: (res) => {
          const method = (res.payment_method as CheckoutPaymentMethod | undefined) ?? this.paymentMethod;
          if (this.paymentMethod === 'paypal') {
            this.persistPayPalPendingSummary(
              this.buildSuccessSummary(res.order_id, res.reference_code ?? null, method)
            );
            if (this.saveAddress) this.persistAddress();
            this.placing = false;
            if (res.paypal_approval_url) {
              window.location.assign(res.paypal_approval_url);
              return;
            }
            this.errorMessage = this.translate.instant('checkout.paymentNotReady');
            return;
          }
          if (this.paymentMethod === 'stripe') {
            this.persistStripePendingSummary(this.buildSuccessSummary(res.order_id, res.reference_code ?? null, method));
            if (this.saveAddress) this.persistAddress();
            this.placing = false;
            if (res.stripe_checkout_url) {
              window.location.assign(res.stripe_checkout_url);
              return;
            }
            this.errorMessage = this.translate.instant('checkout.paymentNotReady');
            return;
          }
          if (this.paymentMethod === 'netopia') {
            this.persistStripePendingSummary(this.buildSuccessSummary(res.order_id, res.reference_code ?? null, method));
            if (this.saveAddress) this.persistAddress();
            this.placing = false;
            this.errorMessage = this.translate.instant('checkout.paymentNotReady');
            return;
          }
          if (this.paymentMethod === 'cod') {
            this.persistSuccessSummary(
              this.buildSuccessSummary(res.order_id, res.reference_code ?? null, method)
            );
            if (this.saveAddress) this.persistAddress();
            this.placing = false;
            this.cart.clear();
            void this.router.navigate(['/checkout/success']);
            return;
          }
          this.errorMessage = this.translate.instant('checkout.paymentNotReady');
          this.placing = false;
        },
        error: (err) => {
          this.errorMessage = err?.error?.detail || this.translate.instant('checkout.checkoutFailed');
          this.placing = false;
        }
      });
  }
}
