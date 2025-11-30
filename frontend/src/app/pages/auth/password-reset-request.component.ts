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
  selector: 'app-password-reset-request',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ContainerComponent, ButtonComponent, BreadcrumbComponent],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-xl">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <h1 class="text-2xl font-semibold text-slate-900">Reset your password</h1>
      <p class="text-sm text-slate-600">Enter your email and we'll send a reset link.</p>
      <form #resetForm="ngForm" class="grid gap-4" (ngSubmit)="onSubmit(resetForm)">
        <label class="grid gap-1 text-sm font-medium text-slate-700">
          Email
          <input name="email" type="email" class="rounded-lg border border-slate-200 px-3 py-2" required [(ngModel)]="email" />
        </label>
        <app-button label="Send reset link" type="submit"></app-button>
        <a routerLink="/login" class="text-sm text-indigo-600 font-medium">Back to login</a>
      </form>
    </app-container>
  `
})
export class PasswordResetRequestComponent {
  crumbs = [
    { label: 'Home', url: '/' },
    { label: 'Password reset' }
  ];
  email = '';
  loading = false;

  constructor(private toast: ToastService, private auth: AuthService) {}

  onSubmit(form: NgForm): void {
    if (!form.valid) return;
    this.loading = true;
    this.auth.requestPasswordReset(this.email).subscribe({
      next: () => this.toast.success('Reset link sent', `Check ${this.email}`),
      error: (err) => {
        const message = err?.error?.detail || 'Unable to send reset email.';
        this.toast.error(message);
      },
      complete: () => {
        this.loading = false;
      }
    });
  }
}
