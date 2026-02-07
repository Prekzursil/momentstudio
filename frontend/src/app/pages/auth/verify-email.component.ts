import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CartApi } from '../../core/cart.api';
import { ContainerComponent } from '../../layout/container.component';
import { ButtonComponent } from '../../shared/button.component';

type VerifyKind = 'primary' | 'secondary' | 'guest';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, TranslateModule, RouterLink, ContainerComponent, ButtonComponent],
  template: `
    <app-container classes="py-10 grid gap-6">
      <div class="grid gap-2">
        <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">{{ 'auth.verifyEmail.title' | translate }}</h1>
        <p class="text-sm text-slate-600 dark:text-slate-300">{{ subtitle }}</p>
      </div>

      <div
        *ngIf="status === 'error'"
        class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100"
      >
        {{ errorMessage }}
      </div>

      <div class="flex flex-wrap gap-2" *ngIf="status === 'success'">
        <app-button
          *ngIf="kind === 'guest'"
          variant="ghost"
          [label]="'auth.verifyEmail.ctaCheckout' | translate"
          routerLink="/checkout"
        ></app-button>
        <app-button
          *ngIf="auth.isAuthenticated()"
          variant="ghost"
          [label]="'auth.verifyEmail.ctaAccount' | translate"
          routerLink="/account"
        ></app-button>
        <app-button
          *ngIf="!auth.isAuthenticated()"
          variant="ghost"
          [label]="'auth.verifyEmail.ctaLogin' | translate"
          routerLink="/login"
        ></app-button>
      </div>
    </app-container>
  `
})
export class VerifyEmailComponent implements OnInit {
  status: 'verifying' | 'success' | 'error' = 'verifying';
  kind: VerifyKind = 'primary';
  subtitle = '';
  errorMessage = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    public auth: AuthService,
    private cartApi: CartApi,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    const rawToken = String(qp.get('token') || '').trim();
    const rawKind = String(qp.get('kind') || 'primary').trim().toLowerCase();
    const rawEmail = String(qp.get('email') || '').trim();
    const rawNext = String(qp.get('next') || '').trim();
    const kind = (rawKind === 'guest' || rawKind === 'secondary' ? rawKind : 'primary') as VerifyKind;

    this.kind = kind;
    this.subtitle = this.translate.instant('auth.verifyEmail.verifying');

    if (!rawToken) {
      this.fail(this.translate.instant('auth.verifyEmail.missingToken'));
      return;
    }

    if (kind === 'guest') {
      if (!rawEmail) {
        this.fail(this.translate.instant('auth.verifyEmail.missingEmail'));
        return;
      }
      this.api
        .post<{ email: string | null; verified: boolean }>(
          '/orders/guest-checkout/email/confirm',
          { email: rawEmail, token: rawToken },
          this.cartApi.headers()
        )
        .subscribe({
          next: (res) => {
            if (!res?.verified) {
              this.fail(this.translate.instant('auth.verifyEmail.invalidOrExpired'));
              return;
            }
            this.succeed(this.translate.instant('auth.verifyEmail.guestSuccess'));
            this.safeNavigateNext(rawNext, '/checkout');
          },
          error: () => {
            this.fail(this.translate.instant('auth.verifyEmail.guestDeviceHint'));
          }
        });
      return;
    }

    if (kind === 'secondary') {
      this.auth.confirmSecondaryEmailVerification(rawToken).subscribe({
        next: () => {
          this.succeed(this.translate.instant('auth.verifyEmail.secondarySuccess'));
          this.refreshAuthUserIfPossible();
        },
        error: () => this.fail(this.translate.instant('auth.verifyEmail.invalidOrExpired'))
      });
      return;
    }

    this.auth.confirmEmailVerification(rawToken).subscribe({
      next: () => {
        this.succeed(this.translate.instant('auth.verifyEmail.success'));
        this.refreshAuthUserIfPossible();
      },
      error: () => this.fail(this.translate.instant('auth.verifyEmail.invalidOrExpired'))
    });
  }

  private refreshAuthUserIfPossible(): void {
    if (!this.auth.isAuthenticated()) return;
    this.auth.loadCurrentUser().subscribe({
      error: () => {
        // Best-effort; showing success is still accurate even if the session expired.
      }
    });
  }

  private safeNavigateNext(next: string, fallback: string): void {
    const target = (next || '').trim();
    if (!target) {
      void this.router.navigateByUrl(fallback);
      return;
    }
    if (!target.startsWith('/')) {
      void this.router.navigateByUrl(fallback);
      return;
    }
    void this.router.navigateByUrl(target);
  }

  private succeed(message: string): void {
    this.status = 'success';
    this.subtitle = message;
    this.errorMessage = '';
  }

  private fail(message: string): void {
    this.status = 'error';
    this.subtitle = this.translate.instant('auth.verifyEmail.error');
    this.errorMessage = message;
  }
}

