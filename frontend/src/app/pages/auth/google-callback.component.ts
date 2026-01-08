import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { missingRequiredProfileFields } from '../../shared/profile-requirements';

@Component({
  selector: 'app-google-callback',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div class="bg-white border border-slate-200 rounded-xl shadow-sm p-6 w-full max-w-md grid gap-3 text-center dark:bg-slate-900 dark:border-slate-700 dark:shadow-none">
        <p class="text-lg font-semibold text-slate-900 dark:text-slate-50">{{ 'auth.googleFinishing' | translate }}</p>
        <p class="text-sm text-slate-600 dark:text-slate-300" *ngIf="message()">{{ message() }}</p>
        <p class="text-sm text-rose-700 dark:text-rose-300" *ngIf="error()">{{ error() }}</p>
      </div>
    </div>
  `
})
export class GoogleCallbackComponent implements OnInit {
  message = signal<string | null>(null);
  error = signal<string | null>(null);

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private auth: AuthService,
    private toast: ToastService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    const code = this.route.snapshot.queryParamMap.get('code');
    const state = this.route.snapshot.queryParamMap.get('state');
    const flow = (localStorage.getItem('google_flow') as 'login' | 'link' | null) || 'login';
    if (!code || !state) {
      this.error.set(this.translate.instant('auth.googleMissingCode'));
      this.toast.error(this.translate.instant('auth.googleMissingCode'));
      void this.router.navigateByUrl('/login');
      return;
    }

    if (flow === 'link') {
      const password = sessionStorage.getItem('google_link_password');
      if (!password) {
        this.error.set(this.translate.instant('auth.googleLinkPasswordMissing'));
        this.toast.error(this.translate.instant('auth.googleLinkPasswordMissing'));
        void this.router.navigateByUrl('/account');
        return;
      }
      this.handleLink(code, state, password);
    } else {
      this.handleLogin(code, state);
    }
  }

  private handleLogin(code: string, state: string): void {
    this.message.set(this.translate.instant('auth.googleSigningIn'));
    this.auth.completeGoogleLogin(code, state).subscribe({
      next: (res) => {
        localStorage.removeItem('google_flow');
        this.toast.success(this.translate.instant('auth.googleLoginSuccess'), res.user.email);
        const missing = missingRequiredProfileFields(res.user);
        if (missing.length) {
          this.toast.info(this.translate.instant('auth.completeProfileRequiredTitle'), this.translate.instant('auth.completeProfileRequiredCopy'));
          void this.router.navigate(['/register'], { queryParams: { complete: 1 } });
          return;
        }
        void this.router.navigateByUrl('/account');
      },
      error: (err) => {
        localStorage.removeItem('google_flow');
        const message = err?.error?.detail || this.translate.instant('auth.googleError');
        this.error.set(message);
        this.toast.error(message);
        void this.router.navigateByUrl('/login');
      }
    });
  }

  private handleLink(code: string, state: string, password: string): void {
    this.message.set(this.translate.instant('auth.googleLinking'));
    this.auth.completeGoogleLink(code, state, password).subscribe({
      next: (user) => {
        localStorage.removeItem('google_flow');
        sessionStorage.removeItem('google_link_password');
        this.toast.success(this.translate.instant('auth.googleLinkSuccess'), user.email);
        void this.router.navigateByUrl('/account');
      },
      error: (err) => {
        localStorage.removeItem('google_flow');
        sessionStorage.removeItem('google_link_password');
        const message = err?.error?.detail || this.translate.instant('auth.googleError');
        this.error.set(message);
        this.toast.error(message);
        void this.router.navigateByUrl('/account');
      }
    });
  }
}
