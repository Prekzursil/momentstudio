import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { CartStore, CartItem } from '../../core/cart.store';
import { CartApi, CartResponse } from '../../core/cart.api';
import { ApiService } from '../../core/api.service';
import { appConfig } from '../../core/app-config';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../core/auth.service';
import { buildE164, listPhoneCountries, PhoneCountryOption } from '../../shared/phone';
import { LockerPickerComponent } from '../../shared/locker-picker.component';
import { LockerProvider, LockerRead } from '../../core/shipping.service';
import { RO_CITIES, RO_COUNTIES } from '../../shared/ro-geo';

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
                  <input class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400" name="name" [(ngModel)]="address.name" required />
                </label>
                <label class="text-sm grid gap-1">
                  {{ 'checkout.email' | translate }}
                  <input class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400" name="email" [(ngModel)]="address.email" type="email" required (ngModelChange)="onEmailChanged()" />
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
                <label class="text-sm grid gap-1 sm:col-span-2">
                  {{ 'checkout.line1' | translate }}
                  <input class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400" name="line1" [(ngModel)]="address.line1" required />
                </label>
                <div class="grid gap-3 sm:grid-cols-3 sm:col-span-2">
                  <label class="text-sm grid gap-1">
                    {{ 'checkout.city' | translate }}
                    <input
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                      name="city"
                      [(ngModel)]="address.city"
                      [attr.list]="address.country === 'RO' ? 'roCities' : null"
                      required
                    />
                  </label>
                  <label class="text-sm grid gap-1">
                    {{ 'checkout.region' | translate }}
                    <ng-container *ngIf="address.country === 'RO'; else regionFreeShipping">
                      <select
                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        name="region"
                        [(ngModel)]="address.region"
                        required
                      >
                        <option value="">{{ 'checkout.regionSelect' | translate }}</option>
                        <option *ngFor="let r of roCounties" [value]="r">{{ r }}</option>
                      </select>
                    </ng-container>
                    <ng-template #regionFreeShipping>
                      <input
                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                        name="region"
                        [(ngModel)]="address.region"
                      />
                    </ng-template>
                  </label>
                  <label class="text-sm grid gap-1">
                    {{ 'checkout.postal' | translate }}
                    <input
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                      name="postal"
                      [(ngModel)]="address.postal"
                      required
                    />
                  </label>
                </div>
                <label class="text-sm grid gap-1 sm:col-span-2">
                  {{ 'checkout.country' | translate }}
                  <select class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" name="country" [(ngModel)]="address.country" required>
                    <option value="">{{ 'checkout.countrySelect' | translate }}</option>
                    <option *ngFor="let c of countries" [value]="c.code">{{ c.flag }} {{ c.name }}</option>
                  </select>
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
                  <label class="text-sm grid gap-1 sm:col-span-2">
                    {{ 'checkout.line1' | translate }}
                    <input
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                      name="billingLine1"
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
                        [(ngModel)]="billing.city"
                        [attr.list]="billing.country === 'RO' ? 'roCities' : null"
                        required
                      />
                    </label>
                    <label class="text-sm grid gap-1">
                      {{ 'checkout.region' | translate }}
                      <ng-container *ngIf="billing.country === 'RO'; else regionFreeBilling">
                        <select
                          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          name="billingRegion"
                          [(ngModel)]="billing.region"
                          required
                        >
                          <option value="">{{ 'checkout.regionSelect' | translate }}</option>
                          <option *ngFor="let r of roCounties" [value]="r">{{ r }}</option>
                        </select>
                      </ng-container>
                      <ng-template #regionFreeBilling>
                        <input
                          class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                          name="billingRegion"
                          [(ngModel)]="billing.region"
                        />
                      </ng-template>
                    </label>
                    <label class="text-sm grid gap-1">
                      {{ 'checkout.postal' | translate }}
                      <input
                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                        name="billingPostal"
                        [(ngModel)]="billing.postal"
                        required
                      />
                    </label>
                  </div>
                  <label class="text-sm grid gap-1 sm:col-span-2">
                    {{ 'checkout.country' | translate }}
                    <select
                      class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      name="billingCountry"
                      [(ngModel)]="billing.country"
                      required
                    >
                      <option value="">{{ 'checkout.countrySelect' | translate }}</option>
                      <option *ngFor="let c of countries" [value]="c.code">{{ c.flag }} {{ c.name }}</option>
                    </select>
                  </label>
                </div>
              </div>
              <datalist id="roCities">
                <option *ngFor="let c of roCities" [value]="c"></option>
              </datalist>
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" [(ngModel)]="saveAddress" name="saveAddress" />
                {{ 'checkout.saveAddress' | translate }}
              </label>
                <p *ngIf="addressError" class="text-sm text-amber-700 dark:text-amber-300">{{ addressError }}</p>
              </div>

              <div class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em] dark:text-slate-200">{{ 'checkout.step3' | translate }}</p>
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
                  promoMessage.startsWith('Applied')
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : promoMessage.startsWith('Invalid')
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-slate-700 dark:text-slate-300'
                "
                *ngIf="promoMessage"
              >
                {{ promoMessage }}
              </p>
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
          <div class="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
            <span>{{ 'checkout.promo' | translate }}</span>
            <span class="text-emerald-700 dark:text-emerald-300">-{{ quoteDiscount() | localizedCurrency : currency }}</span>
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
  countries: PhoneCountryOption[] = [];
  readonly roCounties = RO_COUNTIES;
  readonly roCities = RO_CITIES;
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
    private cartApi: CartApi,
    private api: ApiService,
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
  }

  items = this.cart.items;
  subtotal = this.cart.subtotal;
  currency = 'RON';

  emailVerified(): boolean {
    return Boolean(this.auth.user()?.email_verified);
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

  private setQuote(res: CartResponse): void {
    const totals = res?.totals ?? ({} as any);
    const subtotal = this.parseMoney(totals.subtotal);
    const fee = this.parseMoney(totals.fee);
    const tax = this.parseMoney(totals.tax);
    const shipping = this.parseMoney(totals.shipping);
    const total = this.parseMoney(totals.total);
    const currency = (totals.currency ?? 'RON') as string;
    this.quote = { subtotal, fee, tax, shipping, total, currency };
    this.currency = currency || 'RON';
  }

  private parseMoney(value: unknown): number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === 'string') {
      const num = Number(value.trim());
      return Number.isFinite(num) ? num : 0;
    }
    if (typeof value === 'bigint') {
      const num = Number(value);
      return Number.isFinite(num) ? num : 0;
    }
    return 0;
  }

  applyPromo(): void {
    const code = this.promo.trim();
    if (!code) {
      this.promoMessage = '';
    }
    this.refreshQuote();
  }

  placeOrder(form: NgForm): void {
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
    this.syncBackendCart(this.items());
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
          this.setQuote(res);
          this.syncing = false;
        },
        error: () => {
          this.syncing = false;
          this.errorMessage = 'Could not sync cart with server';
        }
      });
  }

  private refreshQuote(): void {
    const promo = this.promo.trim();
    const params = promo ? { promo_code: promo } : undefined;
    this.cartApi.get(params).subscribe({
      next: (res) => {
        this.setQuote(res);
        if (promo) {
          const discount = this.quoteDiscount();
          this.promoMessage =
            discount > 0
              ? this.translate.instant('checkout.promoApplied', { code: promo.toUpperCase() })
              : this.translate.instant('checkout.promoPending', { code: promo.toUpperCase() });
        } else {
          this.promoMessage = '';
        }
      },
      error: (err) => {
        // Don't block checkout on promo quote; checkout will validate server-side.
        if (promo) {
          this.promoMessage = err?.error?.detail || this.translate.instant('checkout.promoPending', { code: promo.toUpperCase() });
        } else {
          this.promoMessage = '';
        }
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
          this.errorMessage = err?.error?.detail || 'Checkout failed';
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
      this.guestEmailError = this.guestEmailError || 'Could not send verification code';
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
        this.guestEmailError = err?.error?.detail || 'Could not send verification code';
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
      promo_code: this.promo || null,
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
          this.errorMessage = err?.error?.detail || 'Checkout failed';
          this.placing = false;
        }
      });
  }
}
