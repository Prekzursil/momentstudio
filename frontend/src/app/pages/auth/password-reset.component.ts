import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-password-reset',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ContainerComponent, ButtonComponent, BreadcrumbComponent],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-xl">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <h1 class="text-2xl font-semibold text-slate-900">Choose a new password</h1>
      <form #resetForm="ngForm" class="grid gap-4" (ngSubmit)="onSubmit(resetForm)">
        <label class="grid gap-1 text-sm font-medium text-slate-700">
          Reset code
          <input name="token" class="rounded-lg border border-slate-200 px-3 py-2" required [(ngModel)]="token" />
        </label>
        <label class="grid gap-1 text-sm font-medium text-slate-700">
          New password
          <input
            name="password"
            type="password"
            class="rounded-lg border border-slate-200 px-3 py-2"
            required
            minlength="6"
            [(ngModel)]="password"
          />
        </label>
        <label class="grid gap-1 text-sm font-medium text-slate-700">
          Confirm new password
          <input
            name="confirm"
            type="password"
            class="rounded-lg border border-slate-200 px-3 py-2"
            required
            [(ngModel)]="confirmPassword"
          />
        </label>
        <p *ngIf="error" class="text-sm text-amber-700">{{ error }}</p>
        <app-button label="Update password" type="submit"></app-button>
        <a routerLink="/login" class="text-sm text-indigo-600 font-medium">Back to login</a>
      </form>
    </app-container>
  `
})
export class PasswordResetComponent {
  crumbs = [
    { label: 'Home', url: '/' },
    { label: 'Reset password' }
  ];
  token = '';
  password = '';
  confirmPassword = '';
  error = '';
  loading = false;

  constructor(private toast: ToastService, private auth: AuthService) {}

  onSubmit(form: NgForm): void {
    if (!form.valid) {
      this.error = 'Please fill all fields.';
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.error = 'Passwords do not match.';
      return;
    }
    this.error = '';
    this.loading = true;
    this.auth.confirmPasswordReset(this.token, this.password).subscribe({
      next: () => {
        this.toast.success('Password updated', 'You can now log in with your new password.');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Unable to update password.';
        this.toast.error(message);
      },
      complete: () => {
        this.loading = false;
      }
    });
  }
}
