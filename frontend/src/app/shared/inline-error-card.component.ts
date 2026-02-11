import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonComponent } from './button.component';
import { CopyButtonComponent } from './copy-button.component';

@Component({
  selector: 'app-inline-error-card',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, ButtonComponent, CopyButtonComponent],
  template: `
    <div class="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
      <p class="text-sm font-semibold tracking-[0.2em] uppercase">
        {{ title || (titleKey ? (titleKey | translate) : ('errors.unexpected.title' | translate)) }}
      </p>
      <p class="mt-3 text-sm leading-6">
        {{ message || (messageKey ? (messageKey | translate) : ('errors.unexpected.body' | translate)) }}
      </p>

      <div *ngIf="requestId" class="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-300/80 bg-white/60 px-2 py-1 text-xs font-medium text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100">
        <span>{{ 'adminUi.errors.requestId' | translate }}:</span>
        <span class="font-mono">{{ requestId }}</span>
        <app-copy-button [value]="requestId"></app-copy-button>
      </div>

      <div class="mt-5 flex flex-wrap items-center gap-3">
        <app-button *ngIf="showRetry" [label]="retryLabelKey | translate" (action)="retry.emit()"></app-button>
        <app-button
          *ngIf="backToUrl"
          variant="ghost"
          [routerLink]="backToUrl"
          [label]="backLabelKey | translate"
        ></app-button>
        <app-button
          *ngIf="showContact"
          variant="ghost"
          routerLink="/contact"
          [label]="contactLabelKey | translate"
        ></app-button>
      </div>
    </div>
  `
})
export class InlineErrorCardComponent {
  @Input() titleKey = '';
  @Input() title = '';
  @Input() messageKey = '';
  @Input() message = '';
  @Input() requestId: string | null = null;
  @Input() showRetry = true;
  @Input() retryLabelKey = 'checkout.retry';
  @Input() backToUrl: string | readonly string[] | null = '/checkout';
  @Input() backLabelKey = 'checkout.backToCheckout';
  @Input() showContact = true;
  @Input() contactLabelKey = 'nav.contact';

  @Output() retry = new EventEmitter<void>();
}

