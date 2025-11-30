import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ContainerComponent, ButtonComponent, BreadcrumbComponent],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-xl">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <h1 class="text-2xl font-semibold text-slate-900">Login</h1>
      <form #loginForm="ngForm" class="grid gap-4" (ngSubmit)="onSubmit(loginForm)">
        <label class="grid gap-1 text-sm font-medium text-slate-700">
          Email
          <input
            name="email"
            type="email"
            class="rounded-lg border border-slate-200 px-3 py-2"
            required
            [(ngModel)]="email"
          />
        </label>
        <label class="grid gap-1 text-sm font-medium text-slate-700">
          Password
          <input
            name="password"
            type="password"
            class="rounded-lg border border-slate-200 px-3 py-2"
            required
            minlength="6"
            [(ngModel)]="password"
          />
        </label>
        <div class="flex items-center justify-between text-sm">
          <a routerLink="/password-reset" class="text-indigo-600 font-medium">Forgot password?</a>
          <a routerLink="/register" class="text-slate-600 hover:text-slate-900">Create account</a>
        </div>
        <app-button label="Login" type="submit"></app-button>
      </form>
    </app-container>
  `
})
export class LoginComponent {
  crumbs = [
    { label: 'Home', url: '/' },
    { label: 'Login' }
  ];
  email = '';
  password = '';
  loading = false;

  constructor(private toast: ToastService, private auth: AuthService, private router: Router) {}

  onSubmit(form: NgForm): void {
    if (!form.valid) return;
    this.loading = true;
    this.auth.login(this.email, this.password).subscribe({
      next: (res) => {
        this.toast.success('Welcome back', res.user.email);
        this.router.navigateByUrl('/account');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Unable to login. Please try again.';
        this.toast.error(message);
      },
      complete: () => {
        this.loading = false;
      }
    });
  }
}
