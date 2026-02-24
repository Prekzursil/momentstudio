import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { GoogleLinkPendingService } from '../../core/google-link-pending.service';
import { ToastService } from '../../core/toast.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

const GOOGLE_FLOW_KEY = 'google_flow';

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
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly auth: AuthService,
    private readonly googleLinkPending: GoogleLinkPendingService,
    private readonly toast: ToastService,
    private readonly translate: TranslateService
  ) {}

  ngOnInit(): void {
    const code = this.route.snapshot.queryParamMap.get('code');
    const state = this.route.snapshot.queryParamMap.get('state');
    const flow = (localStorage.getItem(GOOGLE_FLOW_KEY) as 'login' | 'link' | null) || 'login';
    if (!code || !state) {
      this.error.set(this.translate.instant('auth.googleMissingCode'));
      this.toast.error(this.translate.instant('auth.googleMissingCode'));
      void this.router.navigateByUrl('/login');
      return;
    }

    if (flow === 'link') {
      this.handleLink(code, state);
    } else {
      this.handleLogin(code, state);
    }
  }

  private handleLogin(code: string, state: string): void {
    this.message.set(this.translate.instant('auth.googleSigningIn'));
    this.auth.completeGoogleLogin(code, state).subscribe({
      next: (res) => {
        localStorage.removeItem(GOOGLE_FLOW_KEY);
        if (res.requires_completion || res.completion_token) {
          if (typeof sessionStorage !== 'undefined' && res.completion_token) {
            sessionStorage.setItem('google_completion_token', res.completion_token);
            sessionStorage.setItem('google_completion_user', JSON.stringify(res.user));
          }
          this.toast.info(
            this.translate.instant('auth.completeProfileRequiredTitle'),
            this.translate.instant('auth.completeProfileRequiredCopy')
          );
          void this.router.navigate(['/register'], { queryParams: { complete: 1 } });
          return;
        }
        if (res.requires_two_factor && res.two_factor_token) {
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('two_factor_token', res.two_factor_token);
            sessionStorage.setItem('two_factor_user', JSON.stringify(res.user ?? null));
            sessionStorage.setItem('two_factor_remember', JSON.stringify(true));
          }
          this.toast.info(this.translate.instant('auth.twoFactorRequired'));
          void this.router.navigateByUrl('/login/2fa');
          return;
        }
        this.toast.success(this.translate.instant('auth.googleLoginSuccess'), res.user.email);
        void this.router.navigateByUrl('/account');
      },
      error: (err) => {
        localStorage.removeItem(GOOGLE_FLOW_KEY);
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem('google_completion_token');
          sessionStorage.removeItem('google_completion_user');
        }
        const message = err?.error?.detail || this.translate.instant('auth.googleError');
        this.error.set(message);
        this.toast.error(message);
        void this.router.navigateByUrl('/login');
      }
    });
  }

  private handleLink(code: string, state: string): void {
    this.message.set(this.translate.instant('auth.googleLinking'));
    this.googleLinkPending.setPending({ code, state });
    localStorage.removeItem(GOOGLE_FLOW_KEY);
    this.toast.info(this.translate.instant('auth.googleLinkContinueInAccount'));
    void this.router.navigateByUrl('/account/security');
  }
}

