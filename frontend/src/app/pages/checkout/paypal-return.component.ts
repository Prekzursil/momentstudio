import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiService } from '../../core/api.service';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { ContainerComponent } from '../../layout/container.component';

@Component({
  selector: 'app-paypal-return',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, ContainerComponent, BreadcrumbComponent, ButtonComponent],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <div
        *ngIf="loading"
        class="rounded-2xl border border-slate-200 bg-white p-6 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <p class="text-sm font-semibold tracking-[0.2em] uppercase text-slate-600 dark:text-slate-300">
          {{ 'checkout.paypalReturnTitle' | translate }}
        </p>
        <p class="mt-3 text-sm text-slate-700 dark:text-slate-200">{{ 'checkout.paypalCapturing' | translate }}</p>
      </div>

      <div
        *ngIf="!loading && errorMessage"
        class="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
      >
        <p class="text-sm font-semibold tracking-[0.2em] uppercase">{{ 'checkout.paypalReturnTitle' | translate }}</p>
        <p class="mt-3 text-sm">{{ errorMessage }}</p>
        <div class="mt-5 flex flex-wrap gap-3">
          <app-button routerLink="/checkout" [label]="'checkout.backToCheckout' | translate"></app-button>
          <app-button routerLink="/cart" variant="ghost" [label]="'checkout.backToCart' | translate"></app-button>
        </div>
      </div>
    </app-container>
  `
})
export class PayPalReturnComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'checkout.title', url: '/checkout' },
    { label: 'checkout.paypalReturnTitle' }
  ];

  loading = true;
  errorMessage = '';

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private router: Router,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token') || '';
    if (!token) {
      this.loading = false;
      this.errorMessage = this.translate.instant('checkout.paypalMissingToken');
      return;
    }

    this.api
      .post<{ order_id: string; reference_code?: string; status: string; paypal_capture_id?: string | null }>(
        '/orders/paypal/capture',
        { paypal_order_id: token }
      )
      .subscribe({
        next: () => {
          this.loading = false;
          void this.router.navigate(['/checkout/success']);
        },
        error: (err) => {
          this.loading = false;
          this.errorMessage = err?.error?.detail || this.translate.instant('checkout.paypalCaptureFailed');
        }
      });
  }
}

