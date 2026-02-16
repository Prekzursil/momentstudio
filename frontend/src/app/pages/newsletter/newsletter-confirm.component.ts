import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BreadcrumbComponent } from '../../shared/breadcrumb.component';
import { ButtonComponent } from '../../shared/button.component';
import { ContainerComponent } from '../../layout/container.component';
import { NewsletterService } from '../../core/newsletter.service';

@Component({
  selector: 'app-newsletter-confirm',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, ContainerComponent, BreadcrumbComponent, ButtonComponent],
  template: `
    <app-container classes="py-10 grid gap-6">
      <app-breadcrumb [crumbs]="crumbs"></app-breadcrumb>
      <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-50">
        {{ 'newsletter.confirm.title' | translate }}
      </h1>

      <div
        *ngIf="loading"
        class="rounded-2xl border border-slate-200 bg-white p-6 text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <p class="text-sm font-semibold tracking-[0.2em] uppercase text-slate-600 dark:text-slate-300">
          {{ 'newsletter.confirm.title' | translate }}
        </p>
        <p class="mt-3 text-sm text-slate-700 dark:text-slate-200">{{ 'newsletter.confirm.loading' | translate }}</p>
      </div>

      <div
        *ngIf="!loading && success"
        class="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
      >
        <p class="text-sm font-semibold tracking-[0.2em] uppercase">{{ 'newsletter.confirm.successTitle' | translate }}</p>
        <p class="mt-3 text-sm">{{ 'newsletter.confirm.successCopy' | translate }}</p>
        <div class="mt-5 flex flex-wrap gap-3">
          <app-button routerLink="/blog" variant="ghost" [label]="'nav.blog' | translate"></app-button>
          <app-button routerLink="/" variant="ghost" [label]="'nav.home' | translate"></app-button>
        </div>
      </div>

      <div
        *ngIf="!loading && !success && errorMessage"
        class="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
      >
        <p class="text-sm font-semibold tracking-[0.2em] uppercase">{{ 'newsletter.confirm.title' | translate }}</p>
        <p class="mt-3 text-sm">{{ errorMessage }}</p>
        <div class="mt-5 flex flex-wrap gap-3">
          <app-button routerLink="/blog" variant="ghost" [label]="'nav.blog' | translate"></app-button>
          <app-button routerLink="/" variant="ghost" [label]="'nav.home' | translate"></app-button>
        </div>
      </div>
    </app-container>
  `
})
export class NewsletterConfirmComponent implements OnInit {
  crumbs = [{ label: 'nav.home', url: '/' }, { label: 'newsletter.confirm.title' }];

  loading = true;
  success = false;
  errorMessage = '';

  constructor(
    private route: ActivatedRoute,
    private newsletter: NewsletterService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token') || '';
    if (!token) {
      this.loading = false;
      this.success = false;
      this.errorMessage = this.translate.instant('newsletter.confirm.missingToken');
      return;
    }

    this.newsletter.confirm(token).subscribe({
      next: () => {
        this.loading = false;
        this.success = true;
      },
      error: (err) => {
        this.loading = false;
        this.success = false;
        this.errorMessage = err?.error?.detail || this.translate.instant('newsletter.confirm.errorCopy');
      }
    });
  }
}
