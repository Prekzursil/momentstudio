import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { PasswordStrengthComponent } from '../../shared/password-strength.component';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { type CountryCode } from 'libphonenumber-js';
import { buildE164, listPhoneCountries, type PhoneCountryOption } from '../../shared/phone';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ContainerComponent,
    ButtonComponent,
    BreadcrumbComponent,
    PasswordStrengthComponent,
    TranslateModule
  ],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-xl">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'auth.registerTitle' | translate }}</h1>
      <div class="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span class="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 dark:border-slate-800" [class.bg-slate-100]="step === 1" [class.dark:bg-slate-900]="step === 1">
          <span class="font-semibold">1</span> {{ 'auth.registerStepAccount' | translate }}
        </span>
        <span class="opacity-60">→</span>
        <span class="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 dark:border-slate-800" [class.bg-slate-100]="step === 2" [class.dark:bg-slate-900]="step === 2">
          <span class="font-semibold">2</span> {{ 'auth.registerStepPersonal' | translate }}
        </span>
      </div>

      <form #registerForm="ngForm" class="grid gap-4" (ngSubmit)="onSubmit(registerForm)">
        <ng-container *ngIf="step === 1">
          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'auth.displayName' | translate }}
            <input
              #displayNameCtrl="ngModel"
              name="displayName"
              class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              required
              [(ngModel)]="displayName"
            />
            <span class="text-xs font-normal text-slate-500 dark:text-slate-400">
              {{ displayNamePreview() }}
            </span>
            <span *ngIf="displayNameCtrl.touched && displayNameCtrl.invalid" class="text-xs font-normal text-rose-700 dark:text-rose-300">
              {{ 'validation.required' | translate }}
            </span>
          </label>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'auth.username' | translate }}
            <input
              #usernameCtrl="ngModel"
              name="username"
              class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              required
              minlength="3"
              maxlength="30"
              pattern="^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$"
              autocomplete="username"
              [(ngModel)]="username"
            />
            <span *ngIf="usernameCtrl.touched && usernameCtrl.invalid" class="text-xs font-normal text-rose-700 dark:text-rose-300">
              {{ 'validation.usernameInvalid' | translate }}
            </span>
          </label>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'auth.email' | translate }}
            <input
              #emailCtrl="ngModel"
              name="email"
              type="email"
              class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              required
              autocomplete="email"
              [(ngModel)]="email"
            />
            <span *ngIf="emailCtrl.touched && emailCtrl.invalid" class="text-xs font-normal text-rose-700 dark:text-rose-300">
              {{ emailCtrl.errors?.['email'] ? ('validation.invalidEmail' | translate) : ('validation.required' | translate) }}
            </span>
          </label>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'auth.password' | translate }}
            <input
              #passwordCtrl="ngModel"
              name="password"
              type="password"
              class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              required
              minlength="6"
              autocomplete="new-password"
              [(ngModel)]="password"
            />
            <span *ngIf="passwordCtrl.touched && passwordCtrl.invalid" class="text-xs font-normal text-rose-700 dark:text-rose-300">
              {{ 'validation.passwordMin' | translate }}
            </span>
          </label>

          <app-password-strength [password]="password"></app-password-strength>

          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'auth.confirmPassword' | translate }}
            <input
              #confirmCtrl="ngModel"
              name="confirm"
              type="password"
              class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              required
              autocomplete="new-password"
              [(ngModel)]="confirmPassword"
            />
            <span *ngIf="confirmCtrl.touched && confirmCtrl.invalid" class="text-xs font-normal text-rose-700 dark:text-rose-300">
              {{ 'validation.required' | translate }}
            </span>
          </label>

          <p *ngIf="error" class="text-sm text-amber-700 dark:text-amber-300">{{ error }}</p>

          <app-button
            [label]="'auth.next' | translate"
            type="button"
            [disabled]="loading"
            (action)="goNext(registerForm)"
          ></app-button>

          <div class="border-t border-slate-200 pt-4 grid gap-2 dark:border-slate-800">
            <p class="text-sm text-slate-600 dark:text-slate-300 text-center">{{ 'auth.orContinue' | translate }}</p>
            <app-button variant="ghost" [label]="'auth.googleContinue' | translate" (action)="startGoogle()"></app-button>
          </div>

          <p class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'auth.haveAccount' | translate }}
            <a routerLink="/login" class="text-indigo-600 dark:text-indigo-300 font-medium">{{ 'auth.login' | translate }}</a>
          </p>
        </ng-container>

        <ng-container *ngIf="step === 2">
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.firstName' | translate }}
              <input
                #firstNameCtrl="ngModel"
                name="firstName"
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                required
                autocomplete="given-name"
                [(ngModel)]="firstName"
              />
              <span *ngIf="firstNameCtrl.touched && firstNameCtrl.invalid" class="text-xs font-normal text-rose-700 dark:text-rose-300">
                {{ 'validation.required' | translate }}
              </span>
            </label>

            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.middleName' | translate }}
              <input
                name="middleName"
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                autocomplete="additional-name"
                [(ngModel)]="middleName"
              />
            </label>

            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.lastName' | translate }}
              <input
                #lastNameCtrl="ngModel"
                name="lastName"
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                required
                autocomplete="family-name"
                [(ngModel)]="lastName"
              />
              <span *ngIf="lastNameCtrl.touched && lastNameCtrl.invalid" class="text-xs font-normal text-rose-700 dark:text-rose-300">
                {{ 'validation.required' | translate }}
              </span>
            </label>

            <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
              {{ 'auth.dateOfBirth' | translate }}
              <input
                #dobCtrl="ngModel"
                name="dateOfBirth"
                type="date"
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                required
                [(ngModel)]="dateOfBirth"
              />
              <span *ngIf="dobCtrl.touched && dobCtrl.invalid" class="text-xs font-normal text-rose-700 dark:text-rose-300">
                {{ 'validation.required' | translate }}
              </span>
            </label>
          </div>

          <div class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'auth.phone' | translate }}
            <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
              <select
                name="phoneCountry"
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                [(ngModel)]="phoneCountry"
              >
                <option *ngFor="let c of countries" [ngValue]="c.code">{{ c.flag }} {{ c.name }} ({{ c.dial }})</option>
              </select>
              <input
                #phoneCtrl="ngModel"
                name="phoneNational"
                type="tel"
                class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                required
                pattern="^[0-9]{6,14}$"
                autocomplete="tel-national"
                placeholder="723204204"
                [(ngModel)]="phoneNational"
              />
            </div>
            <span *ngIf="phoneCtrl.touched && phoneCtrl.invalid" class="text-xs font-normal text-rose-700 dark:text-rose-300">
              {{ 'validation.phoneInvalid' | translate }}
            </span>
          </div>

          <p *ngIf="error" class="text-sm text-amber-700 dark:text-amber-300">{{ error }}</p>

          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <app-button variant="ghost" [label]="'auth.back' | translate" type="button" (action)="step = 1"></app-button>
            <app-button [label]="'auth.register' | translate" type="submit" [disabled]="loading"></app-button>
          </div>
        </ng-container>
      </form>
    </app-container>
  `
})
export class RegisterComponent implements OnDestroy {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'auth.registerTitle' }
  ];
  step: 1 | 2 = 1;
  displayName = '';
  username = '';
  email = '';
  password = '';
  confirmPassword = '';
  firstName = '';
  middleName = '';
  lastName = '';
  dateOfBirth = '';
  phoneCountry: CountryCode = 'RO';
  phoneNational = '';
  countries: PhoneCountryOption[] = [];
  error = '';
  loading = false;
  private langSub?: Subscription;

  constructor(
    private toast: ToastService,
    private auth: AuthService,
    private router: Router,
    private translate: TranslateService
  ) {
    this.countries = listPhoneCountries(this.translate.currentLang || 'en');
    this.langSub = this.translate.onLangChange.subscribe((evt) => {
      this.countries = listPhoneCountries(evt.lang || 'en');
    });
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
  }

  displayNamePreview(): string {
    const name = this.displayName.trim();
    const username = this.username.trim();
    if (!name && !username) return this.translate.instant('auth.displayNameHintEmpty');
    if (name && username) return this.translate.instant('auth.displayNameHint', { name, username });
    return this.translate.instant('auth.displayNameHintPartial');
  }

  startGoogle(): void {
    localStorage.setItem('google_flow', 'login');
    this.auth.startGoogleLogin().subscribe({
      next: (url) => (window.location.href = url),
      error: (err) => {
        const message = err?.error?.detail || this.translate.instant('auth.googleError');
        this.toast.error(message);
      }
    });
  }

  goNext(form: NgForm): void {
    form.form.markAllAsTouched();
    if (!form.valid) {
      this.error = this.translate.instant('validation.required');
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.error = this.translate.instant('validation.passwordMismatch');
      return;
    }
    this.error = '';
    this.step = 2;
  }

  onSubmit(form: NgForm): void {
    this.error = '';
    if (this.step === 1) {
      this.goNext(form);
      return;
    }
    form.form.markAllAsTouched();
    if (!form.valid) {
      this.error = this.translate.instant('validation.required');
      return;
    }
    const dob = (this.dateOfBirth || '').trim();
    if (!dob) {
      this.error = this.translate.instant('validation.required');
      return;
    }
    const e164 = buildE164(this.phoneCountry, this.phoneNational);
    if (!e164) {
      this.error = this.translate.instant('validation.phoneInvalid');
      return;
    }
    this.loading = true;
    this.auth
      .register({
        name: this.displayName.trim(),
        username: this.username.trim(),
        email: this.email.trim(),
        password: this.password,
        first_name: this.firstName.trim(),
        middle_name: this.middleName.trim() ? this.middleName.trim() : null,
        last_name: this.lastName.trim(),
        date_of_birth: dob,
        phone: e164,
        preferred_language: (this.translate.currentLang || '').startsWith('ro') ? 'ro' : 'en'
      })
      .subscribe({
      next: (res) => {
        this.toast.success(this.translate.instant('auth.successRegister'), `Welcome, ${res.user.email}`);
        void this.router.navigateByUrl('/account');
      },
      error: (err) => {
        const message = err?.error?.detail || this.translate.instant('auth.errorRegister');
        this.toast.error(message);
      },
      complete: () => {
        this.loading = false;
      }
    });
  }
}
