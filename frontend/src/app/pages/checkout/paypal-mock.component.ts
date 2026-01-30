import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';

type MockOutcome = 'success' | 'decline';

@Component({
  selector: 'app-paypal-mock',
  standalone: true,
  imports: [CommonModule, ContainerComponent, BreadcrumbComponent, ButtonComponent],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <div
        class="rounded-2xl border border-slate-200 bg-white p-6 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <p class="text-sm font-semibold tracking-[0.2em] uppercase text-slate-600 dark:text-slate-300">PayPal (Mock)</p>
        <h1 class="mt-3 text-xl font-semibold text-slate-900 dark:text-slate-50">Mock checkout</h1>
        <p class="mt-2 text-sm text-slate-700 dark:text-slate-200">
          This is a local-only PayPal mock used for automated tests.
        </p>

        <div *ngIf="!token" class="mt-4 text-sm text-amber-800 dark:text-amber-200">Missing token.</div>

        <div class="mt-5 flex flex-wrap gap-3">
          <app-button [disabled]="!token" label="Simulate success" (action)="complete('success')"></app-button>
          <app-button
            [disabled]="!token"
            variant="ghost"
            label="Simulate decline"
            (action)="complete('decline')"
          ></app-button>
          <app-button [disabled]="!token" variant="ghost" label="Cancel payment" (action)="cancel()"></app-button>
        </div>
      </div>
    </app-container>
  `
})
export class PayPalMockComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'checkout.title', url: '/checkout' },
    { label: 'PayPal (Mock)' }
  ];

  token = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
  }

  complete(outcome: MockOutcome): void {
    if (!this.token) return;
    void this.router.navigate(['/checkout/paypal/return'], {
      queryParams: { token: this.token, mock: outcome }
    });
  }

  cancel(): void {
    if (!this.token) return;
    void this.router.navigate(['/checkout/paypal/cancel'], { queryParams: { token: this.token } });
  }
}
