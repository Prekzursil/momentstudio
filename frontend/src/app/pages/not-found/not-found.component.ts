import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '../../shared/button.component';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink, ButtonComponent],
  template: `
    <div class="text-center grid gap-4 py-16">
      <p class="text-sm uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">404</p>
      <h1 class="text-3xl font-semibold text-slate-900 dark:text-slate-50">Page not found</h1>
      <p class="text-slate-600 dark:text-slate-300">The page you are looking for doesn't exist. Try heading back home or search the shop.</p>
      <div class="flex justify-center gap-3 flex-wrap">
        <app-button routerLink="/" label="Back to home"></app-button>
        <app-button routerLink="/shop" variant="ghost" label="Browse shop"></app-button>
        <a class="text-sm text-indigo-600 dark:text-indigo-300 font-medium" href="mailto:hello@adrianaart.com">Contact support</a>
      </div>
    </div>
  `
})
export class NotFoundComponent {}
