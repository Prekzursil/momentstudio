import { CommonModule } from '@angular/common';
import { Component, ViewChild } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { CaptchaTurnstileComponent } from '../../shared/captcha-turnstile.component';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { appConfig } from '../../core/app-config';
import { isWebAuthnSupported, serializePublicKeyCredential, toPublicKeyCredentialRequestOptions } from '../../shared/webauthn';
import { finalize } from 'rxjs';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ContainerComponent,
    ButtonComponent,
    BreadcrumbComponent,
    CaptchaTurnstileComponent,
    TranslateModule
  ],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-xl">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">
        {{ (twoFactorToken ? 'auth.twoFactorTitle' : 'auth.loginTitle') | translate }}
      </h1>
      <form #loginForm="ngForm" class="grid gap-4" (ngSubmit)="onSubmit(loginForm)">
        <ng-container *ngIf="!twoFactorToken; else twoFactorStep">
          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'auth.emailOrUsername' | translate }}
            <input
              name="identifier"
              type="text"
              class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              required
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              [(ngModel)]="identifier"
            />
          </label>
          <div class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            <label for="login-password">{{ 'auth.password' | translate }}</label>
            <div class="relative">
              <input
                id="login-password"
                name="password"
                [type]="showPassword ? 'text' : 'password'"
                class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-16 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
                required
                autocomplete="current-password"
                [(ngModel)]="password"
              />
              <button
                type="button"
                class="absolute inset-y-0 right-2 inline-flex items-center text-xs font-semibold text-slate-600 dark:text-slate-300"
                (click)="showPassword = !showPassword"
                [attr.aria-label]="(showPassword ? 'auth.hidePassword' : 'auth.showPassword') | translate"
              >
                {{ (showPassword ? 'auth.hide' : 'auth.show') | translate }}
              </button>
            </div>
          </div>
          <label class="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              name="keepSignedIn"
              class="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/40 dark:border-slate-600 dark:bg-slate-800"
              [(ngModel)]="keepSignedIn"
            />
            {{ 'auth.keepSignedIn' | translate }}
          </label>
	          <app-captcha-turnstile
	            *ngIf="captchaEnabled"
	            [siteKey]="captchaSiteKey"
	            (tokenChange)="captchaToken = $event"
	          ></app-captcha-turnstile>
	          <p *ngIf="error" class="text-sm text-amber-700 dark:text-amber-300">{{ error }}</p>
	          <div class="flex items-center justify-between text-sm">
	            <a routerLink="/password-reset" class="text-indigo-600 dark:text-indigo-300 font-medium">{{ 'auth.forgot' | translate }}</a>
	            <a routerLink="/register" class="text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50">{{
	              'auth.createAccount' | translate
	            }}</a>
          </div>
          <app-button [label]="'auth.login' | translate" type="submit" [disabled]="loading"></app-button>
          <div class="border-t border-slate-200 pt-4 grid gap-2 dark:border-slate-800">
            <p class="text-sm text-slate-600 dark:text-slate-300 text-center">{{ 'auth.orContinue' | translate }}</p>
            <app-button
              *ngIf="passkeySupported"
              variant="ghost"
              [label]="'auth.passkeyContinue' | translate"
              [disabled]="passkeyBusy || loading"
              (action)="startPasskey()"
            ></app-button>
            <app-button variant="ghost" [label]="'auth.googleContinue' | translate" [disabled]="loading" (action)="startGoogle()"></app-button>
          </div>
        </ng-container>

        <ng-template #twoFactorStep>
          <p class="text-sm text-slate-600 dark:text-slate-300">
            {{ 'auth.twoFactorCopy' | translate }}<span *ngIf="twoFactorUserEmail"> ({{ twoFactorUserEmail }})</span>
          </p>
          <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
            {{ 'auth.twoFactorCodeLabel' | translate }}
            <input
              name="twoFactorCode"
              type="text"
              autocomplete="one-time-code"
              class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              required
              [(ngModel)]="twoFactorCode"
            />
          </label>
          <div class="grid gap-2">
            <app-button [label]="'auth.twoFactorSubmit' | translate" type="submit" [disabled]="loading"></app-button>
            <app-button
              variant="ghost"
              [label]="'auth.twoFactorBack' | translate"
              [disabled]="loading"
              (action)="cancelTwoFactor()"
            ></app-button>
          </div>
        </ng-template>
      </form>
    </app-container>
  `
})
export class LoginComponent {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'auth.loginTitle' }
  ];
  identifier = '';
  password = '';
  keepSignedIn = false;
  showPassword = false;
	  captchaToken: string | null = null;
	  loading = false;
	  passkeyBusy = false;
	  error = '';
	  captchaSiteKey = appConfig.captchaSiteKey || '';
	  captchaEnabled = Boolean(this.captchaSiteKey);
	  passkeySupported = isWebAuthnSupported();
  twoFactorToken: string | null = null;
  twoFactorUserEmail: string | null = null;
  twoFactorCode = '';
  nextUrl: string | null = null;

  @ViewChild(CaptchaTurnstileComponent) captcha: CaptchaTurnstileComponent | undefined;

  constructor(
    private toast: ToastService,
    private auth: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private translate: TranslateService
  ) {
    this.nextUrl = this.normalizeNextUrl(this.route.snapshot.queryParamMap.get('next'));
  }

  private normalizeNextUrl(raw: string | null): string | null {
    const value = (raw || '').trim();
    if (!value) return null;
    if (!value.startsWith('/') || value.startsWith('//')) return null;
    if (value.startsWith('/login')) return null;
    return value;
  }

  private navigateAfterLogin(): void {
    void this.router.navigateByUrl(this.nextUrl || '/account');
  }

  private resetCaptcha(): void {
    this.captchaToken = null;
    this.captcha?.reset();
  }

  cancelTwoFactor(): void {
    this.twoFactorToken = null;
    this.twoFactorUserEmail = null;
    this.twoFactorCode = '';
    this.loading = false;
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('two_factor_token');
      sessionStorage.removeItem('two_factor_user');
      sessionStorage.removeItem('two_factor_remember');
    }
  }

  startPasskey(): void {
    if (this.passkeyBusy) return;
    if (!this.passkeySupported) {
      this.toast.error(this.translate.instant('auth.passkeyNotSupported'));
      return;
    }
    this.passkeyBusy = true;
    this.auth.startPasskeyLogin(this.identifier, this.keepSignedIn).subscribe({
      next: async (res) => {
        try {
          const publicKey = toPublicKeyCredentialRequestOptions(res.options);
          const credential = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
          if (!credential) {
            this.passkeyBusy = false;
            return;
          }
          const payload = serializePublicKeyCredential(credential);
          this.auth.completePasskeyLogin(res.authentication_token, payload, this.keepSignedIn).subscribe({
            next: (authRes) => {
              this.toast.success(this.translate.instant('auth.successLogin'), authRes?.user?.email);
              this.navigateAfterLogin();
            },
            error: (err) => {
              const message = err?.error?.detail || this.translate.instant('auth.passkeyError');
              this.toast.error(message);
            },
            complete: () => {
              this.passkeyBusy = false;
            }
          });
        } catch (err: any) {
          const name = err?.name || '';
          if (name === 'NotAllowedError') {
            this.toast.info(this.translate.instant('auth.passkeyCancelled'));
          } else {
            const message = err?.message || this.translate.instant('auth.passkeyError');
            this.toast.error(message);
          }
          this.passkeyBusy = false;
        }
      },
      error: (err) => {
        const message = err?.error?.detail || this.translate.instant('auth.passkeyError');
        this.toast.error(message);
        this.passkeyBusy = false;
      }
    });
  }

  startGoogle(): void {
    localStorage.setItem('google_flow', 'login');
    this.auth.startGoogleLogin().subscribe({
      next: (url) => {
        window.location.href = url;
      },
      error: (err) => {
        const message = err?.error?.detail || this.translate.instant('auth.googleError');
        this.toast.error(message);
      }
    });
  }

	onSubmit(form: NgForm): void {
		this.error = '';
	    if (this.twoFactorToken) {
	      if (!form.valid) {
	        const msg = this.translate.instant('auth.completeForm');
	        this.error = msg;
	        this.toast.error(msg);
	        return;
	      }
	      const token = this.twoFactorToken;
	      const code = this.twoFactorCode.trim();
	      if (!code) {
	        const msg = this.translate.instant('auth.completeForm');
	        this.error = msg;
	        this.toast.error(msg);
	        return;
	      }
	      this.loading = true;
	      this.auth
        .completeTwoFactorLogin(token, code, this.keepSignedIn)
        .pipe(
          finalize(() => {
            this.loading = false;
          })
        )
	        .subscribe({
	          next: (authRes) => {
            if (typeof sessionStorage !== 'undefined') {
              sessionStorage.removeItem('two_factor_token');
              sessionStorage.removeItem('two_factor_user');
              sessionStorage.removeItem('two_factor_remember');
            }
            this.twoFactorToken = null;
	            this.twoFactorUserEmail = null;
	            this.twoFactorCode = '';
	            this.error = '';
	            this.toast.success(this.translate.instant('auth.successLogin'), authRes?.user?.email);
	            this.navigateAfterLogin();
	          },
	          error: (err) => {
	            if (err?.status === 401) {
	              const msg = this.translate.instant('auth.twoFactorInvalid');
	              this.error = msg;
	              this.toast.error(msg);
	              return;
	            }
	            const detail = err?.error?.detail;
	            const message = typeof detail === 'string' && detail.trim()
	              ? detail
	              : this.translate.instant('auth.twoFactorInvalid');
	            this.error = message;
	            this.toast.error(message);
	          }
	        });
	      return;
	    }
	    if (!form.valid) {
	      const msg = this.translate.instant('auth.completeForm');
	      this.error = msg;
	      this.toast.error(msg);
	      return;
	    }
	    if (this.captchaEnabled && !this.captchaToken) {
	      const msg = this.translate.instant('auth.captchaRequired');
	      this.error = msg;
	      this.toast.error(msg);
	      return;
	    }
	    this.loading = true;
	    this.auth
      .login(this.identifier, this.password, this.captchaToken ?? undefined, { remember: this.keepSignedIn })
      .pipe(
        finalize(() => {
          this.loading = false;
        })
      )
	      .subscribe({
	        next: (res) => {
	          const anyRes = res as any;
	          if (anyRes?.requires_two_factor && anyRes?.two_factor_token) {
            this.twoFactorToken = anyRes.two_factor_token;
            this.twoFactorUserEmail = anyRes?.user?.email || null;
            this.twoFactorCode = '';
            if (typeof sessionStorage !== 'undefined') {
              sessionStorage.setItem('two_factor_token', anyRes.two_factor_token);
              sessionStorage.setItem('two_factor_user', JSON.stringify(anyRes.user ?? null));
              sessionStorage.setItem('two_factor_remember', JSON.stringify(this.keepSignedIn));
            }
	            this.toast.info(this.translate.instant('auth.twoFactorRequired'));
	            return;
	          }
	          this.error = '';
	          this.toast.success(this.translate.instant('auth.successLogin'), anyRes?.user?.email);
	          this.navigateAfterLogin();
	        },
	        error: (err) => {
	          this.resetCaptcha();
	          if (err?.status === 401) {
	            const msg = this.translate.instant('auth.invalidCredentials');
	            this.error = msg;
	            this.toast.error(msg);
	            return;
	          }
	          const detail = err?.error?.detail;
	          const message = typeof detail === 'string' && detail.trim()
	            ? detail
	            : this.translate.instant('auth.errorLogin');
	          this.error = message;
	          this.toast.error(message);
	        }
	      });
	  }
}
