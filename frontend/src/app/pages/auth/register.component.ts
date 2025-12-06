import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ContainerComponent, ButtonComponent, BreadcrumbComponent, TranslateModule],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-xl">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <h1 class="text-2xl font-semibold text-slate-900">{{ 'auth.registerTitle' | translate }}</h1>
      <form #registerForm="ngForm" class="grid gap-4" (ngSubmit)="onSubmit(registerForm)">
        <label class="grid gap-1 text-sm font-medium text-slate-700">
          {{ 'auth.name' | translate }}
          <input name="name" class="rounded-lg border border-slate-200 px-3 py-2" required [(ngModel)]="name" />
        </label>
        <label class="grid gap-1 text-sm font-medium text-slate-700">
          {{ 'auth.email' | translate }}
          <input name="email" type="email" class="rounded-lg border border-slate-200 px-3 py-2" required [(ngModel)]="email" />
        </label>
        <label class="grid gap-1 text-sm font-medium text-slate-700">
          {{ 'auth.password' | translate }}
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
          {{ 'auth.confirmPassword' | translate }}
          <input
            name="confirm"
            type="password"
            class="rounded-lg border border-slate-200 px-3 py-2"
            required
            [(ngModel)]="confirmPassword"
          />
        </label>
        <p *ngIf="error" class="text-sm text-amber-700">{{ error }}</p>
        <app-button [label]="'auth.register' | translate" type="submit"></app-button>
        <p class="text-sm text-slate-600">
          {{ 'auth.haveAccount' | translate }}
          <a routerLink="/login" class="text-indigo-600 font-medium">{{ 'auth.login' | translate }}</a>
        </p>
      </form>
    </app-container>
  `
})
export class RegisterComponent {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'auth.registerTitle' }
  ];
  name = '';
  email = '';
  password = '';
  confirmPassword = '';
  error = '';
  loading = false;

  constructor(
    private toast: ToastService,
    private auth: AuthService,
    private router: Router,
    private translate: TranslateService
  ) {}

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
    this.auth.register(this.name, this.email, this.password).subscribe({
      next: (res) => {
        this.toast.success(this.translate.instant('auth.successRegister'), `Welcome, ${res.user.email}`);
        this.router.navigateByUrl('/account');
      },
      error: (err) => {
        const message = err?.error?.detail || this.translate.instant('auth.errorRegister');
        this.toast.error(message);
      },
      complete: () => {
        this.loading = false;
      }
    });
  }
}
