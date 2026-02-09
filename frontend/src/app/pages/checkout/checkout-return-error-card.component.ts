import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ButtonComponent } from '../../shared/button.component';

@Component({
  selector: 'app-checkout-return-error-card',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, ButtonComponent],
  template: `
    <div
      class="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <p class="text-sm font-semibold tracking-[0.2em] uppercase">{{ titleKey | translate }}</p>
      <p class="mt-3 text-sm">{{ message }}</p>
      <div class="mt-5 flex flex-wrap gap-3">
        <app-button [label]="retryLabelKey | translate" (action)="retry.emit()"></app-button>
        <app-button [routerLink]="backToCheckoutUrl" variant="ghost" [label]="backLabelKey | translate"></app-button>
        <app-button *ngIf="showContact" routerLink="/contact" variant="ghost" [label]="contactLabelKey | translate"></app-button>
      </div>
    </div>
  `
})
export class CheckoutReturnErrorCardComponent {
  @Input({ required: true }) titleKey = '';
  @Input({ required: true }) message = '';
  @Input() retryLabelKey = 'checkout.retry';
  @Input() backLabelKey = 'checkout.backToCheckout';
  @Input() contactLabelKey = 'nav.contact';
  @Input() backToCheckoutUrl: string | readonly string[] = '/checkout';
  @Input() showContact = true;

  @Output() retry = new EventEmitter<void>();
}

