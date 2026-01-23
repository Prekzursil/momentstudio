import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { ControlContainer, FormsModule, NgForm } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonComponent } from '../../shared/button.component';
import { LocalizedCurrencyPipe } from '../../shared/localized-currency.pipe';
import { LockerPickerComponent } from '../../shared/locker-picker.component';

@Component({
  selector: 'app-checkout-shipping-step',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslateModule, ButtonComponent, LocalizedCurrencyPipe, LockerPickerComponent],
  viewProviders: [{ provide: ControlContainer, useExisting: NgForm }],
  template: `
	              <div
	                *ngIf="!auth.isAuthenticated()"
	                id="checkout-step-1"
	                class="scroll-mt-24 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
	              >
	                <div class="flex items-center justify-between gap-3">
	                  <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em] dark:text-slate-200">{{ 'checkout.step1' | translate }}</p>
	                  <span *ngIf="step1Complete()" class="text-xs font-semibold text-emerald-700 dark:text-emerald-300">✓</span>
		                </div>
		                <label class="flex items-center gap-2 text-sm">
		                  <input
		                    type="checkbox"
		                    [(ngModel)]="guestCreateAccount"
		                    name="guestCreateAccount"
		                    (ngModelChange)="onGuestCreateAccountChanged($event)"
		                  />
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
	                    <div class="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
	                      <select
	                        class="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                        name="guestPhoneCountry"
	                        [(ngModel)]="guestPhoneCountry"
	                        (ngModelChange)="onGuestPhoneChanged()"
	                        required
	                      >
	                        <option *ngFor="let c of phoneCountries" [value]="c.code">{{ c.flag }} {{ c.dial }} {{ c.name }}</option>
	                      </select>
	                      <input
	                        #guestPhoneCtrl="ngModel"
	                        type="tel"
	                        class="w-full min-w-0 rounded-lg border bg-white px-3 py-2 text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
	                        [ngClass]="
	                          (guestPhoneCtrl.invalid && (guestPhoneCtrl.touched || checkoutForm.submitted)) || (guestPhoneNational && !guestPhoneE164())
	                            ? 'border-rose-300 ring-2 ring-rose-200 dark:border-rose-900/40 dark:ring-rose-900/30'
	                            : 'border-slate-200 dark:border-slate-700'
	                        "
	                        [attr.aria-invalid]="
	                          (guestPhoneCtrl.invalid && (guestPhoneCtrl.touched || checkoutForm.submitted)) || (guestPhoneNational && !guestPhoneE164())
	                            ? 'true'
	                            : null
	                        "
	                        aria-describedby="checkout-guest-phone-required checkout-guest-phone-invalid"
	                        name="guestPhoneNational"
	                        [(ngModel)]="guestPhoneNational"
	                        (ngModelChange)="onGuestPhoneChanged()"
	                        autocomplete="tel-national"
	                        inputmode="numeric"
	                        required
	                        pattern="^[0-9]{6,14}$"
	                      />
	                    </div>
	                    <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'auth.phoneHint' | translate }}</span>
	                    <span
	                      *ngIf="guestPhoneCtrl.invalid && guestPhoneCtrl.errors?.['required'] && (guestPhoneCtrl.touched || checkoutForm.submitted)"
	                      id="checkout-guest-phone-required"
	                      class="text-xs font-normal text-rose-700 dark:text-rose-300"
	                    >
	                      {{ 'validation.required' | translate }}
	                    </span>
	                    <span
	                      *ngIf="
	                        ((guestPhoneCtrl.invalid && !guestPhoneCtrl.errors?.['required']) && (guestPhoneCtrl.touched || checkoutForm.submitted)) ||
	                        (guestPhoneNational && !guestPhoneE164())
	                      "
	                      id="checkout-guest-phone-invalid"
	                      class="text-xs font-normal text-rose-700 dark:text-rose-300"
	                    >
	                      {{ 'validation.phoneInvalid' | translate }}
	                    </span>
	                  </div>
	                </div>
                <div class="flex justify-end">
                  <app-button
                    size="sm"
                    variant="ghost"
                    [label]="'checkout.continue' | translate"
                    [disabled]="!step1Complete()"
                    (action)="scrollToStep('checkout-step-2')"
                  ></app-button>
                </div>
              </div>
              <div
                id="checkout-step-2"
                class="scroll-mt-24 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div class="flex items-center justify-between gap-3">
                  <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em] dark:text-slate-200">{{ 'checkout.step2' | translate }}</p>
                  <span *ngIf="step2Complete()" class="text-xs font-semibold text-emerald-700 dark:text-emerald-300">✓</span>
                </div>
                <div class="grid sm:grid-cols-2 gap-3">
	                <label class="text-sm grid gap-1">
	                  {{ 'checkout.name' | translate }}
	                  <input
	                    class="rounded-lg border bg-white px-3 py-2 text-slate-900 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
	                    [ngClass]="
	                      nameCtrl.invalid && (nameCtrl.touched || checkoutForm.submitted)
	                        ? 'border-rose-300 ring-2 ring-rose-200 dark:border-rose-900/40 dark:ring-rose-900/30'
	                        : 'border-slate-200 dark:border-slate-700'
	                    "
	                    [attr.aria-invalid]="nameCtrl.invalid && (nameCtrl.touched || checkoutForm.submitted) ? 'true' : null"
	                    aria-describedby="checkout-name-error"
	                    name="name"
	                    autocomplete="name"
	                    [(ngModel)]="address.name"
	                    #nameCtrl="ngModel"
	                    required
	                  />
	                  <span
	                    *ngIf="nameCtrl.invalid && (nameCtrl.touched || checkoutForm.submitted)"
	                    id="checkout-name-error"
	                    class="text-xs font-normal text-rose-700 dark:text-rose-300"
	                  >
	                    {{ 'validation.required' | translate }}
	                  </span>
	                </label>
	                <label class="text-sm grid gap-1">
	                  {{ 'checkout.email' | translate }}
	                  <input
	                    class="rounded-lg border bg-white px-3 py-2 text-slate-900 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
	                    [ngClass]="
	                      emailCtrl.invalid && (emailCtrl.touched || checkoutForm.submitted)
	                        ? 'border-rose-300 ring-2 ring-rose-200 dark:border-rose-900/40 dark:ring-rose-900/30'
	                        : 'border-slate-200 dark:border-slate-700'
	                    "
	                    [attr.aria-invalid]="emailCtrl.invalid && (emailCtrl.touched || checkoutForm.submitted) ? 'true' : null"
	                    aria-describedby="checkout-email-error"
	                    name="email"
	                    autocomplete="email"
	                    [(ngModel)]="address.email"
	                    #emailCtrl="ngModel"
	                    type="email"
	                    required
	                    (ngModelChange)="onEmailChanged()"
	                  />
	                  <span
	                    *ngIf="emailCtrl.invalid && (emailCtrl.touched || checkoutForm.submitted)"
	                    id="checkout-email-error"
	                    class="text-xs font-normal text-rose-700 dark:text-rose-300"
	                  >
	                    {{ emailCtrl.errors?.['email'] ? ('validation.invalidEmail' | translate) : ('validation.required' | translate) }}
	                  </span>
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
                      [disabled]="guestSendingCode || guestResendSecondsLeft > 0 || !address.email || guestEmailVerified"
                    ></app-button>
                    <span *ngIf="guestEmailVerified" class="text-xs font-medium text-emerald-700 dark:text-emerald-300">✓</span>
                    <span *ngIf="!guestEmailVerified && guestResendSecondsLeft > 0" class="text-xs text-slate-500 dark:text-slate-400">
                      {{ 'checkout.emailVerifyResendIn' | translate : { seconds: guestResendSecondsLeft } }}
                    </span>
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
                <div *ngIf="shippingPhoneRequired()" class="grid gap-1 text-sm sm:col-span-2">
                  <span class="font-medium text-slate-700 dark:text-slate-200">{{ 'auth.phone' | translate }}</span>
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                    <select
                      class="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      name="shippingPhoneCountry"
                      [(ngModel)]="shippingPhoneCountry"
                      required
                    >
                      <option *ngFor="let c of phoneCountries" [value]="c.code">{{ c.flag }} {{ c.dial }} {{ c.name }}</option>
                    </select>
                    <input
                      #shippingPhoneCtrl="ngModel"
                      type="tel"
                      class="w-full min-w-0 rounded-lg border bg-white px-3 py-2 text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                      [ngClass]="
                        (shippingPhoneCtrl.invalid && (shippingPhoneCtrl.touched || checkoutForm.submitted)) || (shippingPhoneNational && !shippingPhoneE164())
                          ? 'border-rose-300 ring-2 ring-rose-200 dark:border-rose-900/40 dark:ring-rose-900/30'
                          : 'border-slate-200 dark:border-slate-700'
                      "
                      [attr.aria-invalid]="
                        (shippingPhoneCtrl.invalid && (shippingPhoneCtrl.touched || checkoutForm.submitted)) || (shippingPhoneNational && !shippingPhoneE164())
                          ? 'true'
                          : null
                      "
                      aria-describedby="checkout-phone-required checkout-phone-invalid"
                      name="shippingPhoneNational"
                      [(ngModel)]="shippingPhoneNational"
                      autocomplete="tel-national"
                      required
                      pattern="^[0-9]{6,14}$"
                    />
                  </div>
                  <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'auth.phoneHint' | translate }}</span>
                  <span
                    *ngIf="shippingPhoneCtrl.invalid && (shippingPhoneCtrl.touched || checkoutForm.submitted)"
                    id="checkout-phone-required"
                    class="text-xs font-normal text-rose-700 dark:text-rose-300"
                  >
                    {{ 'validation.required' | translate }}
                  </span>
                  <span
                    *ngIf="shippingPhoneNational && !shippingPhoneE164()"
                    id="checkout-phone-invalid"
                    class="text-xs font-normal text-rose-700 dark:text-rose-300"
                  >
                    {{ 'validation.phoneInvalid' | translate }}
                  </span>
                </div>
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
	                  <label *ngIf="savedAddresses.length" class="text-sm grid gap-1 sm:col-span-2 min-w-0">
	                    {{ 'checkout.savedShippingAddress' | translate }}
	                    <select
	                      class="w-full min-w-0 truncate rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                      name="savedShippingAddress"
	                      [(ngModel)]="selectedShippingAddressId"
	                      (ngModelChange)="applySelectedShippingAddress()"
	                    >
	                      <option value="">{{ 'checkout.savedAddressSelect' | translate }}</option>
	                      <option *ngFor="let a of savedAddresses" [value]="a.id">{{ formatSavedAddress(a) }}</option>
	                    </select>
                      <button
                        type="button"
                        class="text-left text-xs text-indigo-600 hover:text-indigo-700 disabled:opacity-50 dark:text-indigo-300 dark:hover:text-indigo-200"
                        [disabled]="!selectedShippingAddressId"
                        (click)="openEditSavedAddress('shipping')"
                      >
                        {{ 'account.addresses.edit' | translate }}
                      </button>
	                  </label>
	                </ng-container>
	                <label class="text-sm grid gap-1 sm:col-span-2">
	                  {{ 'checkout.line1' | translate }}
	                  <input
	                    class="rounded-lg border bg-white px-3 py-2 text-slate-900 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
	                    [ngClass]="
	                      line1Ctrl.invalid && (line1Ctrl.touched || checkoutForm.submitted)
	                        ? 'border-rose-300 ring-2 ring-rose-200 dark:border-rose-900/40 dark:ring-rose-900/30'
	                        : 'border-slate-200 dark:border-slate-700'
	                    "
	                    [attr.aria-invalid]="line1Ctrl.invalid && (line1Ctrl.touched || checkoutForm.submitted) ? 'true' : null"
	                    aria-describedby="checkout-shipping-line1-error"
	                    name="line1"
	                    autocomplete="shipping address-line1"
	                    [(ngModel)]="address.line1"
	                    #line1Ctrl="ngModel"
	                    required
	                  />
	                  <span
	                    *ngIf="line1Ctrl.invalid && (line1Ctrl.touched || checkoutForm.submitted)"
	                    id="checkout-shipping-line1-error"
	                    class="text-xs font-normal text-rose-700 dark:text-rose-300"
	                  >
	                    {{ 'validation.required' | translate }}
	                  </span>
	                </label>
	                <div class="grid gap-3 sm:grid-cols-3 sm:col-span-2">
	                  <label class="text-sm grid gap-1">
	                    {{ 'checkout.city' | translate }}
	                    <input
	                      class="rounded-lg border bg-white px-3 py-2 text-slate-900 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
	                      [ngClass]="
	                        cityCtrl.invalid && (cityCtrl.touched || checkoutForm.submitted)
	                          ? 'border-rose-300 ring-2 ring-rose-200 dark:border-rose-900/40 dark:ring-rose-900/30'
	                          : 'border-slate-200 dark:border-slate-700'
	                      "
	                      [attr.aria-invalid]="cityCtrl.invalid && (cityCtrl.touched || checkoutForm.submitted) ? 'true' : null"
	                      aria-describedby="checkout-shipping-city-error"
	                      name="city"
	                      autocomplete="shipping address-level2"
	                      [(ngModel)]="address.city"
	                      #cityCtrl="ngModel"
	                      [attr.list]="address.country === 'RO' ? 'roCities' : null"
	                      required
	                    />
	                    <span
	                      *ngIf="cityCtrl.invalid && (cityCtrl.touched || checkoutForm.submitted)"
	                      id="checkout-shipping-city-error"
	                      class="text-xs font-normal text-rose-700 dark:text-rose-300"
	                    >
	                      {{ 'validation.required' | translate }}
	                    </span>
	                  </label>
	                  <label class="text-sm grid gap-1">
	                    {{ 'checkout.region' | translate }}
	                    <input
	                      class="rounded-lg border bg-white px-3 py-2 text-slate-900 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
	                      [ngClass]="
	                        regionCtrl.invalid && (regionCtrl.touched || checkoutForm.submitted)
	                          ? 'border-rose-300 ring-2 ring-rose-200 dark:border-rose-900/40 dark:ring-rose-900/30'
	                          : 'border-slate-200 dark:border-slate-700'
	                      "
	                      [attr.aria-invalid]="regionCtrl.invalid && (regionCtrl.touched || checkoutForm.submitted) ? 'true' : null"
	                      aria-describedby="checkout-shipping-region-error"
	                      name="region"
	                      autocomplete="shipping address-level1"
	                      [(ngModel)]="address.region"
	                      #regionCtrl="ngModel"
	                      [attr.list]="address.country === 'RO' ? 'roCounties' : null"
	                      [required]="address.country === 'RO'"
	                    />
	                    <span
	                      *ngIf="regionCtrl.invalid && (regionCtrl.touched || checkoutForm.submitted)"
	                      id="checkout-shipping-region-error"
	                      class="text-xs font-normal text-rose-700 dark:text-rose-300"
	                    >
	                      {{ 'validation.required' | translate }}
	                    </span>
	                  </label>
	                  <label class="text-sm grid gap-1">
	                    {{ 'checkout.postal' | translate }}
	                    <input
	                      class="rounded-lg border bg-white px-3 py-2 text-slate-900 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
	                      [ngClass]="
	                        postalCtrl.invalid && (postalCtrl.touched || checkoutForm.submitted)
	                          ? 'border-rose-300 ring-2 ring-rose-200 dark:border-rose-900/40 dark:ring-rose-900/30'
	                          : 'border-slate-200 dark:border-slate-700'
	                      "
	                      [attr.aria-invalid]="postalCtrl.invalid && (postalCtrl.touched || checkoutForm.submitted) ? 'true' : null"
	                      aria-describedby="checkout-shipping-postal-error"
	                      name="postal"
	                      autocomplete="shipping postal-code"
	                      [(ngModel)]="address.postal"
	                      #postalCtrl="ngModel"
	                      required
	                    />
	                    <span
	                      *ngIf="postalCtrl.invalid && (postalCtrl.touched || checkoutForm.submitted)"
	                      id="checkout-shipping-postal-error"
	                      class="text-xs font-normal text-rose-700 dark:text-rose-300"
	                    >
	                      {{ 'validation.required' | translate }}
	                    </span>
	                  </label>
	                </div>
	                <label class="text-sm grid gap-1 sm:col-span-2">
	                  {{ 'checkout.country' | translate }}
	                  <input
	                    class="rounded-lg border bg-white px-3 py-2 text-slate-900 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
	                    [ngClass]="
	                      shippingCountryError || (shippingCountryCtrl.invalid && (shippingCountryCtrl.touched || checkoutForm.submitted))
	                        ? 'border-rose-300 ring-2 ring-rose-200 dark:border-rose-900/40 dark:ring-rose-900/30'
	                        : 'border-slate-200 dark:border-slate-700'
	                    "
	                    [attr.aria-invalid]="
	                      shippingCountryError || (shippingCountryCtrl.invalid && (shippingCountryCtrl.touched || checkoutForm.submitted)) ? 'true' : null
	                    "
	                    aria-describedby="checkout-shipping-country-required checkout-shipping-country-invalid"
	                    name="countryInput"
	                    #shippingCountryCtrl="ngModel"
	                    autocomplete="shipping country"
	                    [attr.list]="'countryOptions'"
	                    [(ngModel)]="shippingCountryInput"
	                    (ngModelChange)="shippingCountryError = ''"
	                    (blur)="normalizeShippingCountry()"
	                    required
	                  />
	                  <span
	                    *ngIf="shippingCountryCtrl.invalid && (shippingCountryCtrl.touched || checkoutForm.submitted)"
	                    id="checkout-shipping-country-required"
	                    class="text-xs font-normal text-rose-700 dark:text-rose-300"
	                  >
	                    {{ 'validation.required' | translate }}
	                  </span>
	                  <span *ngIf="shippingCountryError" id="checkout-shipping-country-invalid" class="text-xs font-normal text-rose-700 dark:text-rose-300">{{
	                    shippingCountryError
	                  }}</span>
	                </label>
	              </div>

	              <div class="grid gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
	                <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em] dark:text-slate-200">
	                  {{ 'checkout.deliveryTitle' | translate }}
	                </p>
	                <div class="grid sm:grid-cols-2 gap-3">
	                  <div class="text-sm grid gap-1">
	                    <span>{{ 'checkout.deliveryType' | translate }}</span>
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
	                  </div>
	                  <div class="text-sm grid gap-2">
	                    <span>{{ 'checkout.courier' | translate }}</span>
	                    <div class="grid gap-2">
	                      <button
	                        type="button"
	                        class="rounded-xl border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
	                        [ngClass]="
	                          courier === 'sameday'
	                            ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/30 dark:text-indigo-100'
	                            : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
	                        "
	                        (click)="setCourier('sameday')"
	                        [attr.aria-pressed]="courier === 'sameday'"
	                      >
	                        <div class="flex items-start justify-between gap-3">
	                          <div class="min-w-0">
	                            <p class="font-medium">{{ 'checkout.courierSameday' | translate }}</p>
	                            <p *ngIf="courierEstimateKey('sameday')" class="text-xs text-slate-600 dark:text-slate-300">
	                              {{ courierEstimateKey('sameday') | translate : courierEstimateParams('sameday') }}
	                            </p>
	                          </div>
	                          <p class="text-xs text-slate-600 dark:text-slate-300">
	                            {{ 'checkout.shipping' | translate }}: {{ quoteShipping() | localizedCurrency : currency }}
	                          </p>
	                        </div>
	                      </button>
	                      <button
	                        type="button"
	                        class="rounded-xl border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
	                        [ngClass]="
	                          courier === 'fan_courier'
	                            ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-950/30 dark:text-indigo-100'
	                            : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'
	                        "
	                        (click)="setCourier('fan_courier')"
	                        [attr.aria-pressed]="courier === 'fan_courier'"
	                      >
	                        <div class="flex items-start justify-between gap-3">
	                          <div class="min-w-0">
	                            <p class="font-medium">{{ 'checkout.courierFanCourier' | translate }}</p>
	                            <p *ngIf="courierEstimateKey('fan_courier')" class="text-xs text-slate-600 dark:text-slate-300">
	                              {{ courierEstimateKey('fan_courier') | translate : courierEstimateParams('fan_courier') }}
	                            </p>
	                          </div>
	                          <p class="text-xs text-slate-600 dark:text-slate-300">
	                            {{ 'checkout.shipping' | translate }}: {{ quoteShipping() | localizedCurrency : currency }}
	                          </p>
	                        </div>
	                      </button>
	                    </div>
	                  </div>
	                </div>
		                <div *ngIf="deliveryType === 'locker'" id="checkout-locker-picker" tabindex="-1" class="grid gap-2">
		                  <app-locker-picker [provider]="courier" [(selected)]="locker"></app-locker-picker>
		                  <p *ngIf="deliveryError" class="text-xs text-amber-700 dark:text-amber-300">{{ deliveryError }}</p>
		                </div>
		              </div>

	              <div class="grid gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
	                <div class="flex flex-wrap items-center justify-between gap-3">
	                  <p class="text-sm font-semibold text-slate-800 uppercase tracking-[0.2em] dark:text-slate-200">
	                    {{ 'checkout.billingTitle' | translate }}
	                  </p>
	                  <div class="flex flex-wrap items-center gap-3">
	                    <button
	                      *ngIf="!billingSameAsShipping"
	                      type="button"
	                      class="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
	                      (click)="copyShippingToBilling()"
	                    >
	                      {{ 'checkout.copyFromShipping' | translate }}
	                    </button>
		                  <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
		                    <input
		                      type="checkbox"
		                      [(ngModel)]="billingSameAsShipping"
		                      name="billingSameAsShipping"
		                      (ngModelChange)="onBillingSameAsShippingChanged()"
		                    />
		                    {{ 'checkout.billingSameAsShipping' | translate }}
		                  </label>
	                  </div>
		                </div>
                <div class="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950">
                  <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <input type="checkbox" [(ngModel)]="invoiceEnabled" name="invoiceEnabled" />
                    {{ 'checkout.invoiceToggle' | translate }}
                  </label>
                  <div *ngIf="invoiceEnabled" class="grid gap-3 sm:grid-cols-2">
                    <label class="text-sm grid gap-1 sm:col-span-2">
                      {{ 'checkout.invoiceCompany' | translate }}
                      <input
                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                        name="invoiceCompany"
                        [(ngModel)]="invoiceCompany"
                        autocomplete="organization"
                        maxlength="200"
                      />
                    </label>
                    <label class="text-sm grid gap-1 sm:col-span-2">
                      {{ 'checkout.invoiceVatId' | translate }}
                      <input
                        class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                        name="invoiceVatId"
                        [(ngModel)]="invoiceVatId"
                        autocomplete="off"
                        maxlength="64"
                      />
                      <span class="text-xs text-slate-500 dark:text-slate-400">{{ 'checkout.invoiceVatHint' | translate }}</span>
                    </label>
                  </div>
                </div>
	                <div *ngIf="!billingSameAsShipping" class="grid sm:grid-cols-2 gap-3">
                  <ng-container *ngIf="auth.isAuthenticated()">
	                    <label *ngIf="savedAddresses.length" class="text-sm grid gap-1 sm:col-span-2 min-w-0">
	                      {{ 'checkout.savedBillingAddress' | translate }}
	                      <select
	                        class="w-full min-w-0 truncate rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
	                        name="savedBillingAddress"
	                        [(ngModel)]="selectedBillingAddressId"
	                        (ngModelChange)="applySelectedBillingAddress()"
	                      >
	                        <option value="">{{ 'checkout.savedAddressSelect' | translate }}</option>
	                        <option *ngFor="let a of savedAddresses" [value]="a.id">{{ formatSavedAddress(a) }}</option>
	                      </select>
                        <button
                          type="button"
                          class="text-left text-xs text-indigo-600 hover:text-indigo-700 disabled:opacity-50 dark:text-indigo-300 dark:hover:text-indigo-200"
                          [disabled]="!selectedBillingAddressId"
                          (click)="openEditSavedAddress('billing')"
                        >
                          {{ 'account.addresses.edit' | translate }}
                        </button>
	                    </label>
	                  </ng-container>
	                  <label class="text-sm grid gap-1 sm:col-span-2">
	                    {{ 'checkout.line1' | translate }}
	                    <input
	                      class="rounded-lg border bg-white px-3 py-2 text-slate-900 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
	                      [ngClass]="
	                        billingLine1Ctrl.invalid && (billingLine1Ctrl.touched || checkoutForm.submitted)
	                          ? 'border-rose-300 ring-2 ring-rose-200 dark:border-rose-900/40 dark:ring-rose-900/30'
	                          : 'border-slate-200 dark:border-slate-700'
	                      "
	                      [attr.aria-invalid]="billingLine1Ctrl.invalid && (billingLine1Ctrl.touched || checkoutForm.submitted) ? 'true' : null"
	                      aria-describedby="checkout-billing-line1-error"
	                      name="billingLine1"
	                      autocomplete="billing address-line1"
	                      [(ngModel)]="billing.line1"
	                      #billingLine1Ctrl="ngModel"
	                      required
	                    />
	                    <span
	                      *ngIf="billingLine1Ctrl.invalid && (billingLine1Ctrl.touched || checkoutForm.submitted)"
	                      id="checkout-billing-line1-error"
	                      class="text-xs font-normal text-rose-700 dark:text-rose-300"
	                    >
	                      {{ 'validation.required' | translate }}
	                    </span>
	                  </label>
	                  <div class="grid gap-3 sm:grid-cols-3 sm:col-span-2">
	                    <label class="text-sm grid gap-1">
	                      {{ 'checkout.city' | translate }}
	                      <input
	                        class="rounded-lg border bg-white px-3 py-2 text-slate-900 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
	                        [ngClass]="
	                          billingCityCtrl.invalid && (billingCityCtrl.touched || checkoutForm.submitted)
	                            ? 'border-rose-300 ring-2 ring-rose-200 dark:border-rose-900/40 dark:ring-rose-900/30'
	                            : 'border-slate-200 dark:border-slate-700'
	                        "
	                        [attr.aria-invalid]="billingCityCtrl.invalid && (billingCityCtrl.touched || checkoutForm.submitted) ? 'true' : null"
	                        aria-describedby="checkout-billing-city-error"
	                        name="billingCity"
	                        autocomplete="billing address-level2"
	                        [(ngModel)]="billing.city"
	                        #billingCityCtrl="ngModel"
	                        [attr.list]="billing.country === 'RO' ? 'roCities' : null"
	                        required
	                      />
	                      <span
	                        *ngIf="billingCityCtrl.invalid && (billingCityCtrl.touched || checkoutForm.submitted)"
	                        id="checkout-billing-city-error"
	                        class="text-xs font-normal text-rose-700 dark:text-rose-300"
	                      >
	                        {{ 'validation.required' | translate }}
	                      </span>
	                    </label>
	                    <label class="text-sm grid gap-1">
	                      {{ 'checkout.region' | translate }}
	                      <input
	                        class="rounded-lg border bg-white px-3 py-2 text-slate-900 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
	                        [ngClass]="
	                          billingRegionCtrl.invalid && (billingRegionCtrl.touched || checkoutForm.submitted)
	                            ? 'border-rose-300 ring-2 ring-rose-200 dark:border-rose-900/40 dark:ring-rose-900/30'
	                            : 'border-slate-200 dark:border-slate-700'
	                        "
	                        [attr.aria-invalid]="billingRegionCtrl.invalid && (billingRegionCtrl.touched || checkoutForm.submitted) ? 'true' : null"
	                        aria-describedby="checkout-billing-region-error"
	                        name="billingRegion"
	                        autocomplete="billing address-level1"
	                        [(ngModel)]="billing.region"
	                        #billingRegionCtrl="ngModel"
	                        [attr.list]="billing.country === 'RO' ? 'roCounties' : null"
	                        [required]="billing.country === 'RO'"
	                      />
	                      <span
	                        *ngIf="billingRegionCtrl.invalid && (billingRegionCtrl.touched || checkoutForm.submitted)"
	                        id="checkout-billing-region-error"
	                        class="text-xs font-normal text-rose-700 dark:text-rose-300"
	                      >
	                        {{ 'validation.required' | translate }}
	                      </span>
	                    </label>
	                    <label class="text-sm grid gap-1">
	                      {{ 'checkout.postal' | translate }}
	                      <input
	                        class="rounded-lg border bg-white px-3 py-2 text-slate-900 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
	                        [ngClass]="
	                          billingPostalCtrl.invalid && (billingPostalCtrl.touched || checkoutForm.submitted)
	                            ? 'border-rose-300 ring-2 ring-rose-200 dark:border-rose-900/40 dark:ring-rose-900/30'
	                            : 'border-slate-200 dark:border-slate-700'
	                        "
	                        [attr.aria-invalid]="billingPostalCtrl.invalid && (billingPostalCtrl.touched || checkoutForm.submitted) ? 'true' : null"
	                        aria-describedby="checkout-billing-postal-error"
	                        name="billingPostal"
	                        autocomplete="billing postal-code"
	                        [(ngModel)]="billing.postal"
	                        #billingPostalCtrl="ngModel"
	                        required
	                      />
	                      <span
	                        *ngIf="billingPostalCtrl.invalid && (billingPostalCtrl.touched || checkoutForm.submitted)"
	                        id="checkout-billing-postal-error"
	                        class="text-xs font-normal text-rose-700 dark:text-rose-300"
	                      >
	                        {{ 'validation.required' | translate }}
	                      </span>
	                    </label>
	                  </div>
	                  <label class="text-sm grid gap-1 sm:col-span-2">
	                    {{ 'checkout.country' | translate }}
	                    <input
	                      class="rounded-lg border bg-white px-3 py-2 text-slate-900 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
	                      [ngClass]="
	                        billingCountryError || (billingCountryCtrl.invalid && (billingCountryCtrl.touched || checkoutForm.submitted))
	                          ? 'border-rose-300 ring-2 ring-rose-200 dark:border-rose-900/40 dark:ring-rose-900/30'
	                          : 'border-slate-200 dark:border-slate-700'
	                      "
	                      [attr.aria-invalid]="
	                        billingCountryError || (billingCountryCtrl.invalid && (billingCountryCtrl.touched || checkoutForm.submitted)) ? 'true' : null
	                      "
	                      aria-describedby="checkout-billing-country-required checkout-billing-country-invalid"
	                      name="billingCountryInput"
	                      #billingCountryCtrl="ngModel"
	                      autocomplete="billing country"
	                      [attr.list]="'countryOptions'"
	                      [(ngModel)]="billingCountryInput"
	                      (ngModelChange)="billingCountryError = ''"
	                      (blur)="normalizeBillingCountry()"
	                      required
	                    />
	                    <span
	                      *ngIf="billingCountryCtrl.invalid && (billingCountryCtrl.touched || checkoutForm.submitted)"
	                      id="checkout-billing-country-required"
	                      class="text-xs font-normal text-rose-700 dark:text-rose-300"
	                    >
	                      {{ 'validation.required' | translate }}
	                    </span>
	                    <span *ngIf="billingCountryError" id="checkout-billing-country-invalid" class="text-xs font-normal text-rose-700 dark:text-rose-300">{{
	                      billingCountryError
	                    }}</span>
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
		                <input
		                  type="checkbox"
		                  [(ngModel)]="saveAddress"
		                  name="saveAddress"
		                  [disabled]="!auth.isAuthenticated() && guestCreateAccount"
		                />
		                {{ 'checkout.saveAddress' | translate }}
		              </label>
		              <div *ngIf="auth.isAuthenticated() && saveAddress" class="grid gap-1 pl-6">
		                <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
		                  <input type="checkbox" [(ngModel)]="saveDefaultShipping" name="saveDefaultShipping" />
		                  {{ 'addressForm.defaultShipping' | translate }}
		                </label>
		                <label class="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
		                  <input type="checkbox" [(ngModel)]="saveDefaultBilling" name="saveDefaultBilling" />
		                  {{ 'addressForm.defaultBilling' | translate }}
		                </label>
		              </div>
		              <p
		                *ngIf="!auth.isAuthenticated() && guestCreateAccount"
		                class="text-xs text-slate-500 dark:text-slate-400"
		              >
	                {{ 'checkout.saveAddressRequiredForAccount' | translate }}
	              </p>
              <p *ngIf="addressError" class="text-sm text-amber-700 dark:text-amber-300">{{ addressError }}</p>
              <div class="flex justify-end">
                <app-button
                  size="sm"
                  variant="ghost"
                  [label]="'checkout.continue' | translate"
                  [disabled]="!step2Complete()"
                  (action)="scrollToStep('checkout-step-3')"
                ></app-button>
              </div>
              </div>
  `
})
export class CheckoutShippingStepComponent {
  @Input({ required: true }) checkoutForm!: NgForm;
  @Input({ required: true }) vm!: any;

  get auth(): any {
    return this.vm.auth;
  }

  get roCounties(): any {
    return this.vm.roCounties;
  }

  get roCities(): any {
    return this.vm.roCities;
  }

  get phoneCountries(): any {
    return this.vm.phoneCountries;
  }

  get countries(): any {
    return this.vm.countries;
  }

  get currency(): any {
    return this.vm.currency;
  }

  get savedAddresses(): any {
    return this.vm.savedAddresses;
  }

  get savedAddressesLoading(): any {
    return this.vm.savedAddressesLoading;
  }

  get savedAddressesError(): any {
    return this.vm.savedAddressesError;
  }

  get selectedShippingAddressId(): any {
    return this.vm.selectedShippingAddressId;
  }
  set selectedShippingAddressId(value: any) {
    this.vm.selectedShippingAddressId = value;
  }

  get selectedBillingAddressId(): any {
    return this.vm.selectedBillingAddressId;
  }
  set selectedBillingAddressId(value: any) {
    this.vm.selectedBillingAddressId = value;
  }

  get guestCreateAccount(): any {
    return this.vm.guestCreateAccount;
  }
  set guestCreateAccount(value: any) {
    this.vm.guestCreateAccount = value;
  }

  get guestUsername(): any {
    return this.vm.guestUsername;
  }
  set guestUsername(value: any) {
    this.vm.guestUsername = value;
  }

  get guestPassword(): any {
    return this.vm.guestPassword;
  }
  set guestPassword(value: any) {
    this.vm.guestPassword = value;
  }

  get guestPasswordConfirm(): any {
    return this.vm.guestPasswordConfirm;
  }
  set guestPasswordConfirm(value: any) {
    this.vm.guestPasswordConfirm = value;
  }

  get guestShowPassword(): any {
    return this.vm.guestShowPassword;
  }
  set guestShowPassword(value: any) {
    this.vm.guestShowPassword = value;
  }

  get guestShowPasswordConfirm(): any {
    return this.vm.guestShowPasswordConfirm;
  }
  set guestShowPasswordConfirm(value: any) {
    this.vm.guestShowPasswordConfirm = value;
  }

  get guestFirstName(): any {
    return this.vm.guestFirstName;
  }
  set guestFirstName(value: any) {
    this.vm.guestFirstName = value;
  }

  get guestMiddleName(): any {
    return this.vm.guestMiddleName;
  }
  set guestMiddleName(value: any) {
    this.vm.guestMiddleName = value;
  }

  get guestLastName(): any {
    return this.vm.guestLastName;
  }
  set guestLastName(value: any) {
    this.vm.guestLastName = value;
  }

  get guestDob(): any {
    return this.vm.guestDob;
  }
  set guestDob(value: any) {
    this.vm.guestDob = value;
  }

  get guestPhoneCountry(): any {
    return this.vm.guestPhoneCountry;
  }
  set guestPhoneCountry(value: any) {
    this.vm.guestPhoneCountry = value;
  }

  get guestPhoneNational(): any {
    return this.vm.guestPhoneNational;
  }
  set guestPhoneNational(value: any) {
    this.vm.guestPhoneNational = value;
  }

  get guestVerificationToken(): any {
    return this.vm.guestVerificationToken;
  }
  set guestVerificationToken(value: any) {
    this.vm.guestVerificationToken = value;
  }

  get guestVerificationSent(): any {
    return this.vm.guestVerificationSent;
  }

  get guestEmailVerified(): any {
    return this.vm.guestEmailVerified;
  }

  get guestSendingCode(): any {
    return this.vm.guestSendingCode;
  }

  get guestConfirmingCode(): any {
    return this.vm.guestConfirmingCode;
  }

  get guestEmailError(): any {
    return this.vm.guestEmailError;
  }

  get guestResendSecondsLeft(): any {
    return this.vm.guestResendSecondsLeft;
  }

  get shippingPhoneCountry(): any {
    return this.vm.shippingPhoneCountry;
  }
  set shippingPhoneCountry(value: any) {
    this.vm.shippingPhoneCountry = value;
  }

  get shippingPhoneNational(): any {
    return this.vm.shippingPhoneNational;
  }
  set shippingPhoneNational(value: any) {
    this.vm.shippingPhoneNational = value;
  }

  get address(): any {
    return this.vm.address;
  }

  get billingSameAsShipping(): any {
    return this.vm.billingSameAsShipping;
  }
  set billingSameAsShipping(value: any) {
    this.vm.billingSameAsShipping = value;
  }

  get billing(): any {
    return this.vm.billing;
  }

  get invoiceEnabled(): any {
    return this.vm.invoiceEnabled;
  }
  set invoiceEnabled(value: any) {
    this.vm.invoiceEnabled = value;
  }

  get invoiceCompany(): any {
    return this.vm.invoiceCompany;
  }
  set invoiceCompany(value: any) {
    this.vm.invoiceCompany = value;
  }

  get invoiceVatId(): any {
    return this.vm.invoiceVatId;
  }
  set invoiceVatId(value: any) {
    this.vm.invoiceVatId = value;
  }

  get shippingCountryInput(): any {
    return this.vm.shippingCountryInput;
  }
  set shippingCountryInput(value: any) {
    this.vm.shippingCountryInput = value;
  }

  get billingCountryInput(): any {
    return this.vm.billingCountryInput;
  }
  set billingCountryInput(value: any) {
    this.vm.billingCountryInput = value;
  }

  get shippingCountryError(): any {
    return this.vm.shippingCountryError;
  }
  set shippingCountryError(value: any) {
    this.vm.shippingCountryError = value;
  }

  get billingCountryError(): any {
    return this.vm.billingCountryError;
  }
  set billingCountryError(value: any) {
    this.vm.billingCountryError = value;
  }

  get courier(): any {
    return this.vm.courier;
  }

  get deliveryType(): any {
    return this.vm.deliveryType;
  }

  get locker(): any {
    return this.vm.locker;
  }
  set locker(value: any) {
    this.vm.locker = value;
  }

  get deliveryError(): any {
    return this.vm.deliveryError;
  }

  get saveAddress(): any {
    return this.vm.saveAddress;
  }
  set saveAddress(value: any) {
    this.vm.saveAddress = value;
  }

  get saveDefaultShipping(): any {
    return this.vm.saveDefaultShipping;
  }
  set saveDefaultShipping(value: any) {
    this.vm.saveDefaultShipping = value;
  }

  get saveDefaultBilling(): any {
    return this.vm.saveDefaultBilling;
  }
  set saveDefaultBilling(value: any) {
    this.vm.saveDefaultBilling = value;
  }

  get addressError(): any {
    return this.vm.addressError;
  }

  step1Complete(): any {
    return this.vm.step1Complete();
  }

  step2Complete(): any {
    return this.vm.step2Complete();
  }

  scrollToStep(id: string): void {
    this.vm.scrollToStep(id);
  }

  onGuestCreateAccountChanged(enabled: boolean): void {
    this.vm.onGuestCreateAccountChanged(enabled);
  }

  toggleGuestPassword(): void {
    this.vm.toggleGuestPassword();
  }

  toggleGuestPasswordConfirm(): void {
    this.vm.toggleGuestPasswordConfirm();
  }

  guestPhoneE164(): any {
    return this.vm.guestPhoneE164();
  }

  onGuestPhoneChanged(): void {
    this.vm.onGuestPhoneChanged();
  }

  onEmailChanged(): void {
    this.vm.onEmailChanged();
  }

  requestGuestEmailVerification(): void {
    this.vm.requestGuestEmailVerification();
  }

  confirmGuestEmailVerification(): void {
    this.vm.confirmGuestEmailVerification();
  }

  shippingPhoneRequired(): any {
    return this.vm.shippingPhoneRequired();
  }

  shippingPhoneE164(): any {
    return this.vm.shippingPhoneE164();
  }

  formatSavedAddress(addr: any): any {
    return this.vm.formatSavedAddress(addr);
  }

  applySelectedShippingAddress(): void {
    this.vm.applySelectedShippingAddress();
  }

  applySelectedBillingAddress(): void {
    this.vm.applySelectedBillingAddress();
  }

  openEditSavedAddress(target: any): void {
    this.vm.openEditSavedAddress(target);
  }

  copyShippingToBilling(): void {
    this.vm.copyShippingToBilling();
  }

  onBillingSameAsShippingChanged(): void {
    this.vm.onBillingSameAsShippingChanged();
  }

  formatCountryOption(country: any): any {
    return this.vm.formatCountryOption(country);
  }

  normalizeShippingCountry(): void {
    this.vm.normalizeShippingCountry();
  }

  normalizeBillingCountry(): void {
    this.vm.normalizeBillingCountry();
  }

  setDeliveryType(type: any): void {
    this.vm.setDeliveryType(type);
  }

  setCourier(provider: any): void {
    this.vm.setCourier(provider);
  }

  courierEstimateKey(provider: any): any {
    return this.vm.courierEstimateKey(provider);
  }

  courierEstimateParams(provider: any): any {
    return this.vm.courierEstimateParams(provider);
  }

  quoteShipping(): any {
    return this.vm.quoteShipping();
  }
}
