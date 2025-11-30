import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '../../shared/button.component';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink, ButtonComponent],
  template: `
    <div class="text-center grid gap-4 py-16">
      <p class="text-sm uppercase tracking-[0.3em] text-slate-500">404</p>
      <h1 class="text-3xl font-semibold text-slate-900">Page not found</h1>
      <p class="text-slate-600">The page you are looking for doesn't exist. Try heading back home.</p>
      <div class="flex justify-center">
        <app-button routerLink="/" label="Back to home"></app-button>
      </div>
    </div>
  `
})
export class NotFoundComponent {}
