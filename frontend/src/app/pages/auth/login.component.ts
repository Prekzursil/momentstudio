import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { CaptchaTurnstileComponent } from '../../shared/captcha-turnstile.component';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { appConfig } from '../../core/app-config';

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
      <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'auth.loginTitle' | translate }}</h1>
      <form #loginForm="ngForm" class="grid gap-4" (ngSubmit)="onSubmit(loginForm)">
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'auth.emailOrUsername' | translate }}
          <input
            name="identifier"
            type="text"
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            required
            [(ngModel)]="identifier"
          />
        </label>
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'auth.password' | translate }}
          <input
            name="password"
            type="password"
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            required
            autocomplete="current-password"
            [(ngModel)]="password"
          />
        </label>
        <app-captcha-turnstile
          *ngIf="captchaEnabled"
          [siteKey]="captchaSiteKey"
          (tokenChange)="captchaToken = $event"
        ></app-captcha-turnstile>
        <div class="flex items-center justify-between text-sm">
          <a routerLink="/password-reset" class="text-indigo-600 dark:text-indigo-300 font-medium">{{ 'auth.forgot' | translate }}</a>
          <a routerLink="/register" class="text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-50">{{ 'auth.createAccount' | translate }}</a>
        </div>
        <app-button [label]="'auth.login' | translate" type="submit"></app-button>
        <div class="border-t border-slate-200 pt-4 grid gap-2 dark:border-slate-800">
          <p class="text-sm text-slate-600 dark:text-slate-300 text-center">{{ 'auth.orContinue' | translate }}</p>
          <app-button variant="ghost" [label]="'auth.googleContinue' | translate" (action)="startGoogle()"></app-button>
        </div>
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
  captchaToken: string | null = null;
  loading = false;
  captchaSiteKey = appConfig.captchaSiteKey || '';
  captchaEnabled = Boolean(this.captchaSiteKey);

  constructor(private toast: ToastService, private auth: AuthService, private router: Router, private translate: TranslateService) {}

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
    if (!form.valid) {
      this.toast.error(this.translate.instant('auth.completeForm'));
      return;
    }
    if (this.captchaEnabled && !this.captchaToken) {
      this.toast.error(this.translate.instant('auth.captchaRequired'));
      return;
    }
    this.loading = true;
    this.auth.login(this.identifier, this.password, this.captchaToken ?? undefined).subscribe({
      next: (res) => {
        this.toast.success(this.translate.instant('auth.successLogin'), res.user.email);
        void this.router.navigateByUrl('/account');
      },
      error: (err) => {
        if (err?.status === 401) {
          this.toast.error(this.translate.instant('auth.invalidCredentials'));
          return;
        }
        const message = err?.error?.detail || this.translate.instant('auth.errorLogin');
        this.toast.error(message);
      },
      complete: () => {
        this.loading = false;
      }
    });
  }
}
