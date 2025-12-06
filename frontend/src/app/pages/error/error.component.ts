import { Component } from '@angular/core';
import { ButtonComponent } from '../../shared/button.component';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-error',
  standalone: true,
  imports: [ButtonComponent, RouterLink],
  template: `
    <div class="text-center grid gap-4 py-16" role="alert" aria-live="assertive">
      <p class="text-sm uppercase tracking-[0.3em] text-red-500">Error</p>
      <h1 class="text-3xl font-semibold text-slate-900">Something went wrong</h1>
      <p class="text-slate-600">We've logged the issue. Please try again, return home, or contact support.</p>
      <div class="flex justify-center gap-3 flex-wrap">
        <app-button label="Retry" (action)="onRetry()"></app-button>
        <app-button variant="ghost" routerLink="/" label="Go home"></app-button>
        <a class="text-sm text-indigo-600 font-medium" href="mailto:hello@adrianaart.com">Contact support</a>
      </div>
    </div>
  `
})
export class ErrorComponent {
  onRetry(): void {
    location.reload();
  }
}
