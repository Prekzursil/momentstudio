import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { PasswordStrengthComponent } from '../../shared/password-strength.component';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { finalize } from 'rxjs';

@Component({
  selector: 'app-password-reset',
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
      <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'auth.resetTitle' | translate }}</h1>
      <form #resetForm="ngForm" class="grid gap-4" (ngSubmit)="onSubmit(resetForm)">
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'auth.resetCode' | translate }}
          <input name="token" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400" required [(ngModel)]="token" />
        </label>
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'auth.password' | translate }}
          <div class="relative">
            <input
              name="password"
              [type]="showPassword ? 'text' : 'password'"
              class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-16 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              required
              minlength="6"
              autocomplete="new-password"
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
        </label>
        <app-password-strength [password]="password"></app-password-strength>
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          {{ 'auth.confirmPassword' | translate }}
          <div class="relative">
            <input
              name="confirm"
              [type]="showConfirmPassword ? 'text' : 'password'"
              class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-16 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              required
              autocomplete="new-password"
              [(ngModel)]="confirmPassword"
            />
            <button
              type="button"
              class="absolute inset-y-0 right-2 inline-flex items-center text-xs font-semibold text-slate-600 dark:text-slate-300"
              (click)="showConfirmPassword = !showConfirmPassword"
              [attr.aria-label]="(showConfirmPassword ? 'auth.hidePassword' : 'auth.showPassword') | translate"
            >
              {{ (showConfirmPassword ? 'auth.hide' : 'auth.show') | translate }}
            </button>
          </div>
        </label>
        <p *ngIf="error" class="text-sm text-amber-700 dark:text-amber-300">{{ error }}</p>
        <app-button [label]="'auth.setPassword' | translate" type="submit"></app-button>
        <a routerLink="/login" class="text-sm text-indigo-600 dark:text-indigo-300 font-medium">{{ 'auth.backToLogin' | translate }}</a>
      </form>
    </app-container>
  `
})
export class PasswordResetComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'auth.resetTitle' }
  ];
  token = '';
  password = '';
  confirmPassword = '';
  showPassword = false;
  showConfirmPassword = false;
  error = '';
  loading = false;

  constructor(
    private toast: ToastService,
    private auth: AuthService,
    private translate: TranslateService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (token) this.token = token;
  }

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
    this.auth
      .confirmPasswordReset(this.token, this.password)
      .pipe(
        finalize(() => {
          this.loading = false;
        })
      )
      .subscribe({
        next: () => {
          this.toast.success(this.translate.instant('auth.successReset'), this.translate.instant('auth.backToLogin'));
        },
        error: (err) => {
          const message = err?.error?.detail || this.translate.instant('auth.errorReset');
          this.toast.error(message);
        }
      });
  }
}
