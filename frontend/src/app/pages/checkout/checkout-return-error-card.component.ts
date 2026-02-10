import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { InlineErrorCardComponent } from '../../shared/inline-error-card.component';

@Component({
  selector: 'app-checkout-return-error-card',
  standalone: true,
  imports: [CommonModule, InlineErrorCardComponent],
  template: `
    <app-inline-error-card
      [titleKey]="titleKey"
      [message]="message"
      [showRetry]="true"
      [retryLabelKey]="retryLabelKey"
      [backToUrl]="backToCheckoutUrl"
      [backLabelKey]="backLabelKey"
      [showContact]="showContact"
      [contactLabelKey]="contactLabelKey"
      (retry)="retry.emit()"
    ></app-inline-error-card>
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
