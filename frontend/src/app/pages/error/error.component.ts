import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { SiteSocialService } from '../../core/site-social.service';
import { ButtonComponent } from '../../shared/button.component';

@Component({
  selector: 'app-error',
  standalone: true,
  imports: [ButtonComponent, RouterLink],
  template: `
    <div class="text-center grid gap-4 py-16" role="alert" aria-live="assertive">
      <p class="text-sm uppercase tracking-[0.3em] text-red-500">Error</p>
      <h1 class="text-3xl font-semibold text-slate-900 dark:text-slate-50" data-route-heading="true" tabindex="-1">
        Something went wrong
      </h1>
      <p class="text-slate-600 dark:text-slate-300">We've logged the issue. Please try again, return home, or contact support.</p>
      <div class="flex justify-center gap-3 flex-wrap">
        <app-button label="Retry" (action)="onRetry()"></app-button>
        <app-button variant="ghost" routerLink="/" label="Go home"></app-button>
        <app-button variant="ghost" routerLink="/shop" label="Browse shop"></app-button>
        <app-button variant="ghost" routerLink="/blog" label="Read blog"></app-button>
        <a class="text-sm text-indigo-600 dark:text-indigo-300 font-medium" [href]="contactHref()">Contact support</a>
      </div>
    </div>
  `
})
export class ErrorComponent implements OnInit, OnDestroy {
  contactHref = signal('mailto:');
  private socialSub?: Subscription;

  constructor(private readonly social: SiteSocialService) {}

  ngOnInit(): void {
    this.socialSub = this.social.get().subscribe((data) => {
      this.contactHref.set(`mailto:${data.contact.email || ''}`);
    });
  }

  ngOnDestroy(): void {
    this.socialSub?.unsubscribe();
  }

  onRetry(): void {
    location.reload();
  }
}
