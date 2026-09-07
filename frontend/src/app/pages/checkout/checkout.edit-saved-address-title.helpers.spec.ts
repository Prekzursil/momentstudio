import { CheckoutComponent } from './checkout.component';

/** Golden WU tip orphan — editSavedAddressTitle. */
describe('CheckoutComponent editSavedAddressTitle (golden WU)', () => {
  function bare(target: 'shipping' | 'billing'): CheckoutComponent {
    const cmp = Object.create(CheckoutComponent.prototype) as CheckoutComponent;
    Object.assign(cmp as any, {
      editSavedAddressTarget: target,
      translate: { instant: (key: string) => key },
    });
    return cmp;
  }

  it('returns shipping vs billing title keys', () => {
    expect(bare('shipping').editSavedAddressTitle()).toBe('checkout.editShippingAddressTitle');
    expect(bare('billing').editSavedAddressTitle()).toBe('checkout.editBillingAddressTitle');
  });
});
