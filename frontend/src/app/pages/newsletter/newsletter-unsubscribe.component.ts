import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { ContainerComponent } from '../../layout/container.component';
import { NewsletterService } from '../../core/newsletter.service';

@Component({
  selector: 'app-newsletter-unsubscribe',
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
          {{ 'newsletter.unsubscribe.title' | translate }}
        </p>
        <p class="mt-3 text-sm text-slate-700 dark:text-slate-200">{{ 'newsletter.unsubscribe.loading' | translate }}</p>
      </div>

      <div
        *ngIf="!loading && success"
        class="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
      >
        <p class="text-sm font-semibold tracking-[0.2em] uppercase">{{ 'newsletter.unsubscribe.successTitle' | translate }}</p>
        <p class="mt-3 text-sm">{{ 'newsletter.unsubscribe.successCopy' | translate }}</p>
        <div class="mt-5 flex flex-wrap gap-3">
          <app-button routerLink="/account/notifications/settings" variant="ghost" [label]="'newsletter.unsubscribe.manage' | translate"></app-button>
          <app-button routerLink="/" variant="ghost" [label]="'nav.home' | translate"></app-button>
        </div>
      </div>

      <div
        *ngIf="!loading && !success && token && !errorMessage"
        class="rounded-2xl border border-slate-200 bg-white p-6 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <p class="text-sm font-semibold tracking-[0.2em] uppercase">{{ 'newsletter.unsubscribe.title' | translate }}</p>
        <p class="mt-3 text-sm text-slate-700 dark:text-slate-200">{{ 'newsletter.unsubscribe.prompt' | translate }}</p>
        <div class="mt-5 flex flex-wrap gap-3">
          <app-button [label]="'newsletter.unsubscribe.cta' | translate" (action)="unsubscribe()"></app-button>
          <app-button routerLink="/" variant="ghost" [label]="'newsletter.unsubscribe.keep' | translate"></app-button>
        </div>
      </div>

      <div
        *ngIf="!loading && !success && errorMessage"
        class="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
      >
        <p class="text-sm font-semibold tracking-[0.2em] uppercase">{{ 'newsletter.unsubscribe.title' | translate }}</p>
        <p class="mt-3 text-sm">{{ errorMessage }}</p>
        <div class="mt-5 flex flex-wrap gap-3">
          <app-button routerLink="/" variant="ghost" [label]="'nav.home' | translate"></app-button>
        </div>
      </div>
    </app-container>
  `
})
export class NewsletterUnsubscribeComponent implements OnInit {
  crumbs = [{ label: 'nav.home', url: '/' }, { label: 'newsletter.unsubscribe.title' }];

  loading = true;
  success = false;
  errorMessage = '';
  token = '';

  constructor(
    private route: ActivatedRoute,
    private newsletter: NewsletterService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
    this.loading = false;
    if (!this.token) {
      this.errorMessage = this.translate.instant('newsletter.unsubscribe.missingToken');
    }
  }

  unsubscribe(): void {
    if (this.loading || this.success) return;
    if (!this.token) return;
    this.loading = true;
    this.errorMessage = '';
    this.newsletter.unsubscribe(this.token).subscribe({
      next: () => {
        this.loading = false;
        this.success = true;
      },
      error: (err) => {
        this.loading = false;
        this.success = false;
        this.errorMessage = err?.error?.detail || this.translate.instant('newsletter.unsubscribe.errorCopy');
      }
    });
  }
}

