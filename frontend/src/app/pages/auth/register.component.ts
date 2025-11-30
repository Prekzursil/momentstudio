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
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ContainerComponent, ButtonComponent, BreadcrumbComponent],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-xl">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <h1 class="text-2xl font-semibold text-slate-900">Create account</h1>
      <form #registerForm="ngForm" class="grid gap-4" (ngSubmit)="onSubmit(registerForm)">
        <label class="grid gap-1 text-sm font-medium text-slate-700">
          Name
          <input name="name" class="rounded-lg border border-slate-200 px-3 py-2" required [(ngModel)]="name" />
        </label>
        <label class="grid gap-1 text-sm font-medium text-slate-700">
          Email
          <input name="email" type="email" class="rounded-lg border border-slate-200 px-3 py-2" required [(ngModel)]="email" />
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
        <label class="grid gap-1 text-sm font-medium text-slate-700">
          Confirm password
          <input
            name="confirm"
            type="password"
            class="rounded-lg border border-slate-200 px-3 py-2"
            required
            [(ngModel)]="confirmPassword"
          />
        </label>
        <p *ngIf="error" class="text-sm text-amber-700">{{ error }}</p>
        <app-button label="Sign up" type="submit"></app-button>
        <p class="text-sm text-slate-600">
          Already have an account?
          <a routerLink="/login" class="text-indigo-600 font-medium">Login</a>
        </p>
      </form>
    </app-container>
  `
})
export class RegisterComponent {
  crumbs = [
    { label: 'Home', url: '/' },
    { label: 'Register' }
  ];
  name = '';
  email = '';
  password = '';
  confirmPassword = '';
  error = '';
  loading = false;

  constructor(private toast: ToastService, private auth: AuthService, private router: Router) {}

  onSubmit(form: NgForm): void {
    if (!form.valid) {
      this.error = 'Please fill all fields correctly.';
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.error = 'Passwords do not match.';
      return;
    }
    this.error = '';
    this.loading = true;
    this.auth.register(this.name, this.email, this.password).subscribe({
      next: (res) => {
        this.toast.success('Account created', `Welcome, ${res.user.email}`);
        this.router.navigateByUrl('/account');
      },
      error: (err) => {
        const message = err?.error?.detail || 'Unable to register right now.';
        this.toast.error(message);
      },
      complete: () => {
        this.loading = false;
      }
    });
  }
}
