import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonComponent } from '../../shared/button.component';

@Component({
  selector: 'app-offline',
  standalone: true,
  imports: [RouterLink, TranslateModule, ButtonComponent],
  template: `
    <div class="text-center grid gap-4 py-16" role="status" aria-live="polite">
      <p class="text-sm uppercase tracking-[0.3em] text-amber-700 dark:text-amber-200">{{ 'pwa.offlineBadge' | translate }}</p>
      <h1 class="text-3xl font-semibold text-slate-900 dark:text-slate-50">{{ 'pwa.offlineTitle' | translate }}</h1>
      <p class="text-slate-600 dark:text-slate-300">{{ 'pwa.offlineBody' | translate }}</p>
      <div class="flex justify-center gap-3 flex-wrap">
        <app-button [label]="'pwa.retry' | translate" (action)="onRetry()"></app-button>
        <app-button routerLink="/" variant="ghost" [label]="'pwa.goHome' | translate"></app-button>
      </div>
    </div>
  `
})
export class OfflineComponent {
  onRetry(): void {
    location.reload();
  }
}

