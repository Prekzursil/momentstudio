import { CheckoutComponent } from './checkout.component';
describe('CheckoutComponent scrollToStep tip (golden WU)', () => {
  it('no-ops when document is undefined', () => {
    const cmp = Object.create(CheckoutComponent.prototype) as CheckoutComponent;
    // should not throw in non-DOM context of unit bare call when document undefined guard hits
    expect(() => cmp.scrollToStep('checkout-step-1')).not.toThrow();
  });
});
