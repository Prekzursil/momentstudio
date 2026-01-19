import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { PasswordStrengthComponent } from '../../shared/password-strength.component';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-change-password',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    TranslateModule,
    ContainerComponent,
    ButtonComponent,
    PasswordStrengthComponent
  ],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-xl">
      <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">Change password</h1>
      <form #changeForm="ngForm" class="grid gap-4" (ngSubmit)="onSubmit(changeForm)">
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          Current password
          <div class="relative">
            <input
              name="current"
              [type]="showCurrent ? 'text' : 'password'"
              class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-16 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              required
              autocomplete="current-password"
              [(ngModel)]="current"
            />
            <button
              type="button"
              class="absolute inset-y-0 right-2 inline-flex items-center text-xs font-semibold text-slate-600 dark:text-slate-300"
              (click)="showCurrent = !showCurrent"
              [attr.aria-label]="(showCurrent ? 'auth.hidePassword' : 'auth.showPassword') | translate"
            >
              {{ (showCurrent ? 'auth.hide' : 'auth.show') | translate }}
            </button>
          </div>
        </label>
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          New password
          <div class="relative">
            <input
              name="password"
              [type]="showNew ? 'text' : 'password'"
              class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-16 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              required
              minlength="6"
              autocomplete="new-password"
              [(ngModel)]="password"
            />
            <button
              type="button"
              class="absolute inset-y-0 right-2 inline-flex items-center text-xs font-semibold text-slate-600 dark:text-slate-300"
              (click)="showNew = !showNew"
              [attr.aria-label]="(showNew ? 'auth.hidePassword' : 'auth.showPassword') | translate"
            >
              {{ (showNew ? 'auth.hide' : 'auth.show') | translate }}
            </button>
          </div>
        </label>
        <app-password-strength [password]="password"></app-password-strength>
        <label class="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          Confirm new password
          <div class="relative">
            <input
              name="confirm"
              [type]="showConfirm ? 'text' : 'password'"
              class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-16 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
              required
              autocomplete="new-password"
              [(ngModel)]="confirm"
            />
            <button
              type="button"
              class="absolute inset-y-0 right-2 inline-flex items-center text-xs font-semibold text-slate-600 dark:text-slate-300"
              (click)="showConfirm = !showConfirm"
              [attr.aria-label]="(showConfirm ? 'auth.hidePassword' : 'auth.showPassword') | translate"
            >
              {{ (showConfirm ? 'auth.hide' : 'auth.show') | translate }}
            </button>
          </div>
        </label>
        <p *ngIf="error" class="text-sm text-amber-700 dark:text-amber-300">{{ error }}</p>
        <app-button label="Update password" type="submit"></app-button>
        <a routerLink="/account" class="text-sm text-indigo-600 dark:text-indigo-300 font-medium">Back to account</a>
      </form>
    </app-container>
  `
})
export class ChangePasswordComponent {
  current = '';
  password = '';
  confirm = '';
  error = '';
  showCurrent = false;
  showNew = false;
  showConfirm = false;

  constructor(private toast: ToastService, private auth: AuthService) {}

  onSubmit(form: NgForm): void {
    if (!form.valid) {
      this.error = 'Please complete the form.';
      return;
    }
    if (this.password !== this.confirm) {
      this.error = 'Passwords do not match.';
      return;
    }
    this.error = '';
    this.auth.changePassword(this.current, this.password).subscribe({
      next: () => {
        this.toast.success('Password updated', 'Your password has been changed.');
        this.current = '';
        this.password = '';
        this.confirm = '';
      },
      error: (err) => {
        const message = err?.error?.detail || 'Could not update password.';
        this.error = message;
        this.toast.error(message);
      }
    });
  }
}
