import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { CheckoutReturnErrorCardComponent } from './checkout-return-error-card.component';
import { InlineErrorCardComponent } from '../../shared/inline-error-card.component';

/**
 * CheckoutReturnErrorCardComponent is a thin presentational wrapper that forwards
 * its inputs to the shared <app-inline-error-card> and re-emits its retry output.
 * These specs assert the real binding contract by reading the child component
 * instance's resolved @Input values after change detection, and verify that a
 * child retry event propagates through the wrapper's own retry EventEmitter.
 *
 * The child InlineErrorCardComponent template is overridden to an empty template
 * with no imports so the wrapper can be tested in isolation without pulling in
 * TranslateModule / RouterLink — the @Input values are still bound by Angular.
 */
@Component({
  standalone: true,
  imports: [CheckoutReturnErrorCardComponent],
  template: `
    <app-checkout-return-error-card
      [titleKey]="titleKey"
      [message]="message"
      [retryLabelKey]="retryLabelKey"
      [backLabelKey]="backLabelKey"
      [contactLabelKey]="contactLabelKey"
      [backToCheckoutUrl]="backToCheckoutUrl"
      [showContact]="showContact"
      (retry)="onRetry()"
    ></app-checkout-return-error-card>
  `,
})
class HostComponent {
  titleKey = 'errors.payment.title';
  message = 'Something went wrong';
  retryLabelKey = 'checkout.retry';
  backLabelKey = 'checkout.backToCheckout';
  contactLabelKey = 'nav.contact';
  backToCheckoutUrl: string | readonly string[] = '/checkout';
  showContact = true;
  retryCount = 0;

  onRetry(): void {
    this.retryCount += 1;
  }
}

function getCard(fixture: ComponentFixture<unknown>): CheckoutReturnErrorCardComponent {
  return fixture.debugElement.query(By.directive(CheckoutReturnErrorCardComponent))
    .componentInstance as CheckoutReturnErrorCardComponent;
}

function getChild(fixture: ComponentFixture<unknown>): InlineErrorCardComponent {
  return fixture.debugElement.query(By.directive(InlineErrorCardComponent))
    .componentInstance as InlineErrorCardComponent;
}

describe('CheckoutReturnErrorCardComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] }).overrideComponent(
      InlineErrorCardComponent,
      { set: { template: '', imports: [] } },
    );
  });

  it('creates with default input values', () => {
    TestBed.configureTestingModule({
      imports: [CheckoutReturnErrorCardComponent],
    }).overrideComponent(CheckoutReturnErrorCardComponent, { set: { template: '', imports: [] } });
    const fixture = TestBed.createComponent(CheckoutReturnErrorCardComponent);
    const cmp = fixture.componentInstance;

    expect(cmp).toBeTruthy();
    expect(cmp.titleKey).toBe('');
    expect(cmp.message).toBe('');
    expect(cmp.retryLabelKey).toBe('checkout.retry');
    expect(cmp.backLabelKey).toBe('checkout.backToCheckout');
    expect(cmp.contactLabelKey).toBe('nav.contact');
    expect(cmp.backToCheckoutUrl).toBe('/checkout');
    expect(cmp.showContact).toBe(true);
  });

  it('forwards all inputs to the inner inline-error-card', () => {
    const fixture = TestBed.createComponent(HostComponent);
    const host = fixture.componentInstance;
    host.titleKey = 'errors.refund.title';
    host.message = 'Refund failed';
    host.retryLabelKey = 'checkout.tryAgain';
    host.backLabelKey = 'checkout.goBack';
    host.contactLabelKey = 'nav.support';
    host.backToCheckoutUrl = ['/checkout', 'payment'];
    host.showContact = false;
    fixture.detectChanges();

    const child = getChild(fixture);
    expect(child.titleKey).toBe('errors.refund.title');
    expect(child.message).toBe('Refund failed');
    expect(child.retryLabelKey).toBe('checkout.tryAgain');
    expect(child.backLabelKey).toBe('checkout.goBack');
    expect(child.contactLabelKey).toBe('nav.support');
    expect(child.backToUrl).toEqual(['/checkout', 'payment']);
    expect(child.showContact).toBe(false);
    // The wrapper hard-codes showRetry to true on the inner card.
    expect(child.showRetry).toBe(true);
  });

  it('re-emits the inner card retry event through its own retry output', () => {
    const fixture = TestBed.createComponent(HostComponent);
    const host = fixture.componentInstance;
    fixture.detectChanges();

    const card = getCard(fixture);
    const emitSpy = jasmine.createSpy('retry');
    card.retry.subscribe(emitSpy);

    const child = getChild(fixture);
    child.retry.emit();

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(host.retryCount).toBe(1);
  });
});
