import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ContainerComponent } from '../../layout/container.component';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';

type MockOutcome = 'success' | 'decline';

@Component({
  selector: 'app-stripe-mock',
  standalone: true,
  imports: [CommonModule, ContainerComponent, BreadcrumbComponent, ButtonComponent],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>

      <div
        class="rounded-2xl border border-slate-200 bg-white p-6 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <p class="text-sm font-semibold tracking-[0.2em] uppercase text-slate-600 dark:text-slate-300">Stripe (Mock)</p>
        <h1 class="mt-3 text-xl font-semibold text-slate-900 dark:text-slate-50">Mock checkout</h1>
        <p class="mt-2 text-sm text-slate-700 dark:text-slate-200">
          This is a local-only Stripe mock used for automated tests.
        </p>

        <div *ngIf="!sessionId" class="mt-4 text-sm text-amber-800 dark:text-amber-200">
          Missing session id.
        </div>

        <div class="mt-5 flex flex-wrap gap-3">
          <app-button [disabled]="!sessionId" label="Simulate success" (action)="complete('success')"></app-button>
          <app-button
            [disabled]="!sessionId"
            variant="ghost"
            label="Simulate decline"
            (action)="complete('decline')"
          ></app-button>
          <app-button [disabled]="!sessionId" variant="ghost" label="Cancel payment" (action)="cancel()"></app-button>
        </div>
      </div>
    </app-container>
  `
})
export class StripeMockComponent implements OnInit {
  crumbs = [
    { label: 'nav.home', url: '/' },
    { label: 'checkout.title', url: '/checkout' },
    { label: 'Stripe (Mock)' }
  ];

  sessionId = '';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.sessionId = this.route.snapshot.queryParamMap.get('session_id') || '';
  }

  complete(outcome: MockOutcome): void {
    if (!this.sessionId) return;
    void this.router.navigate(['/checkout/stripe/return'], {
      queryParams: { session_id: this.sessionId, mock: outcome }
    });
  }

  cancel(): void {
    if (!this.sessionId) return;
    void this.router.navigate(['/checkout/stripe/cancel'], { queryParams: { session_id: this.sessionId } });
  }
}

