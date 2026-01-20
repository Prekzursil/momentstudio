import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { ContainerComponent } from '../../layout/container.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';

@Component({
  selector: 'app-two-factor',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, ContainerComponent, BreadcrumbComponent, ButtonComponent],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-xl">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <div class="grid gap-1">
        <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'auth.twoFactorTitle' | translate }}</h1>
        <p class="text-sm text-slate-600 dark:text-slate-300">
          {{ 'auth.twoFactorCopy' | translate }}<span *ngIf="userEmail"> ({{ userEmail }})</span>
        </p>
      </div>

      <form #twoFactorForm="ngForm" class="grid gap-4" (ngSubmit)="onSubmit(twoFactorForm)">
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'auth.twoFactorCodeLabel' | translate }}
          <input
            name="code"
            type="text"
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            required
            autocomplete="one-time-code"
            [(ngModel)]="code"
          />
        </label>

        <p *ngIf="error" class="text-sm text-rose-700 dark:text-rose-300">{{ error }}</p>

        <div class="flex flex-col sm:flex-row gap-2">
          <app-button [label]="'auth.twoFactorSubmit' | translate" type="submit"></app-button>
          <app-button variant="ghost" [label]="'auth.twoFactorBack' | translate" (action)="cancel()"></app-button>
        </div>
      </form>
    </app-container>
  `
})
export class TwoFactorComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'auth.loginTitle', url: '/login' },
    { label: 'auth.twoFactorTitle' }
  ];

  code = '';
  error: string | null = null;
  loading = false;
  userEmail: string | null = null;

  private token: string | null = null;
  private remember = false;

  constructor(private auth: AuthService, private toast: ToastService, private router: Router, private translate: TranslateService) {}

  ngOnInit(): void {
    if (typeof sessionStorage === 'undefined') {
      this.toast.error(this.translate.instant('auth.twoFactorMissing'));
      void this.router.navigateByUrl('/login');
      return;
    }
    this.token = sessionStorage.getItem('two_factor_token');
    const rememberRaw = sessionStorage.getItem('two_factor_remember');
    try {
      this.remember = JSON.parse(rememberRaw ?? 'false');
    } catch {
      this.remember = false;
    }
    const rawUser = sessionStorage.getItem('two_factor_user');
    if (rawUser) {
      try {
        const parsed = JSON.parse(rawUser);
        this.userEmail = parsed?.email ?? null;
      } catch {
        this.userEmail = null;
      }
    }

    if (!this.token) {
      this.toast.error(this.translate.instant('auth.twoFactorMissing'));
      void this.router.navigateByUrl('/login');
    }
  }

  cancel(): void {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('two_factor_token');
      sessionStorage.removeItem('two_factor_user');
      sessionStorage.removeItem('two_factor_remember');
    }
    void this.router.navigateByUrl('/login');
  }

  onSubmit(form: NgForm): void {
    if (!form.valid || !this.token) {
      this.toast.error(this.translate.instant('auth.completeForm'));
      return;
    }
    this.error = null;
    this.loading = true;
    this.auth.completeTwoFactorLogin(this.token, this.code, this.remember).subscribe({
      next: (res) => {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem('two_factor_token');
          sessionStorage.removeItem('two_factor_user');
          sessionStorage.removeItem('two_factor_remember');
        }
        this.toast.success(this.translate.instant('auth.successLogin'), res.user.email);
        void this.router.navigateByUrl('/account');
      },
      error: (err) => {
        const message = err?.error?.detail || this.translate.instant('auth.twoFactorInvalid');
        this.error = message;
        this.toast.error(message);
      },
      complete: () => {
        this.loading = false;
      }
    });
  }
}
