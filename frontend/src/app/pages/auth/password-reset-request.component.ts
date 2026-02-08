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
import { finalize } from 'rxjs';

@Component({
  selector: 'app-password-reset-request',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ContainerComponent, ButtonComponent, BreadcrumbComponent, TranslateModule],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-xl">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'auth.resetRequestTitle' | translate }}</h1>
      <p class="text-sm text-slate-600 dark:text-slate-300">{{ 'auth.resetRequestCopy' | translate }}</p>
      <form #resetForm="ngForm" class="grid gap-4" (ngSubmit)="onSubmit(resetForm)">
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'auth.email' | translate }}
          <input name="email" type="email" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400" required [(ngModel)]="email" />
        </label>
        <app-button [label]="'auth.resetLink' | translate" type="submit" [disabled]="loading"></app-button>
        <a routerLink="/login" class="text-sm text-indigo-600 dark:text-indigo-300 font-medium">{{ 'auth.backToLogin' | translate }}</a>
      </form>
    </app-container>
  `
})
export class PasswordResetRequestComponent {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'auth.resetRequestTitle' }
  ];
  email = '';
  loading = false;

  constructor(private toast: ToastService, private auth: AuthService, private translate: TranslateService) {}

  onSubmit(form: NgForm): void {
    if (!form.valid) return;
    this.loading = true;
    this.auth
      .requestPasswordReset(this.email)
      .pipe(
        finalize(() => {
          this.loading = false;
        })
      )
      .subscribe({
        next: () =>
          this.toast.success(
            this.translate.instant('auth.resetLinkSent'),
            this.translate.instant('auth.resetLinkSentBody', { email: this.email })
          ),
        error: (err) => {
          const message = err?.error?.detail || this.translate.instant('auth.errorReset');
          this.toast.error(message);
        }
      });
  }
}
