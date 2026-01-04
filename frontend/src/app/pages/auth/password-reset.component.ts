import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-password-reset',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ContainerComponent, ButtonComponent, BreadcrumbComponent, TranslateModule],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-xl">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'auth.resetTitle' | translate }}</h1>
      <form #resetForm="ngForm" class="grid gap-4" (ngSubmit)="onSubmit(resetForm)">
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'auth.resetCode' | translate }}
          <input name="token" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400" required [(ngModel)]="token" />
        </label>
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'auth.password' | translate }}
          <input
            name="password"
            type="password"
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            required
            minlength="6"
            [(ngModel)]="password"
          />
        </label>
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'auth.confirmPassword' | translate }}
          <input
            name="confirm"
            type="password"
            class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            required
            [(ngModel)]="confirmPassword"
          />
        </label>
        <p *ngIf="error" class="text-sm text-amber-700 dark:text-amber-300">{{ error }}</p>
        <app-button [label]="'auth.setPassword' | translate" type="submit"></app-button>
        <a routerLink="/login" class="text-sm text-indigo-600 dark:text-indigo-300 font-medium">{{ 'auth.backToLogin' | translate }}</a>
      </form>
    </app-container>
  `
})
export class PasswordResetComponent {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'auth.resetTitle' }
  ];
  token = '';
  password = '';
  confirmPassword = '';
  error = '';
  loading = false;

  constructor(private toast: ToastService, private auth: AuthService, private translate: TranslateService) {}

  onSubmit(form: NgForm): void {
    if (!form.valid) {
      this.error = this.translate.instant('validation.required');
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.error = this.translate.instant('validation.passwordMismatch');
      return;
    }
    this.error = '';
    this.loading = true;
    this.auth.confirmPasswordReset(this.token, this.password).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('auth.successReset'), this.translate.instant('auth.backToLogin'));
      },
      error: (err) => {
        const message = err?.error?.detail || this.translate.instant('auth.errorReset');
        this.toast.error(message);
      },
      complete: () => {
        this.loading = false;
      }
    });
  }
}
