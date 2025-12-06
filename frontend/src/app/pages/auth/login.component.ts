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
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ContainerComponent, ButtonComponent, BreadcrumbComponent, TranslateModule],
  template: `
    <app-container classes="py-10 grid gap-6 max-w-xl">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <h1 class="text-2xl font-semibold text-slate-900">{{ 'auth.loginTitle' | translate }}</h1>
      <form #loginForm="ngForm" class="grid gap-4" (ngSubmit)="onSubmit(loginForm)">
        <label class="grid gap-1 text-sm font-medium text-slate-700">
          {{ 'auth.email' | translate }}
          <input
            name="email"
            type="email"
            class="rounded-lg border border-slate-200 px-3 py-2"
            required
            [(ngModel)]="email"
          />
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
        <div class="flex items-center justify-between text-sm">
          <a routerLink="/password-reset" class="text-indigo-600 font-medium">{{ 'auth.forgot' | translate }}</a>
          <a routerLink="/register" class="text-slate-600 hover:text-slate-900">{{ 'auth.createAccount' | translate }}</a>
        </div>
        <app-button [label]="'auth.login' | translate" type="submit"></app-button>
        <div class="border-t border-slate-200 pt-4 grid gap-2">
          <p class="text-sm text-slate-600 text-center">{{ 'auth.orContinue' | translate }}</p>
          <app-button variant="ghost" [label]="'auth.googleContinue' | translate" (action)="startGoogle()"></app-button>
        </div>
      </form>
    </app-container>
  `
})
export class LoginComponent {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'auth.loginTitle' }
  ];
  email = '';
  password = '';
  loading = false;

  constructor(private toast: ToastService, private auth: AuthService, private router: Router, private translate: TranslateService) {}

  startGoogle(): void {
    localStorage.setItem('google_flow', 'login');
    this.auth.startGoogleLogin().subscribe({
      next: (url) => {
        window.location.href = url;
      },
      error: (err) => {
        const message = err?.error?.detail || this.translate.instant('auth.googleError');
        this.toast.error(message);
      }
    });
  }

  onSubmit(form: NgForm): void {
    if (!form.valid) return;
    this.loading = true;
    this.auth.login(this.email, this.password).subscribe({
      next: (res) => {
        this.toast.success(this.translate.instant('auth.successLogin'), res.user.email);
        this.router.navigateByUrl('/account');
      },
      error: (err) => {
        const message = err?.error?.detail || this.translate.instant('auth.errorLogin');
        this.toast.error(message);
      },
      complete: () => {
        this.loading = false;
      }
    });
  }
}
