import { CheckoutComponent } from './checkout.component';

/** Golden WU tip orphan — shippingPhoneRequired. */
describe('CheckoutComponent shippingPhoneRequired (golden WU)', () => {
  function bare(overrides: Record<string, unknown> = {}): CheckoutComponent {
    const cmp = Object.create(CheckoutComponent.prototype) as CheckoutComponent;
    Object.assign(cmp as any, {
      deliveryType: 'home',
      phoneRequiredHome: true,
      phoneRequiredLocker: false,
      ...overrides,
    });
    return cmp;
  }

  it('uses locker vs home phone-required flags', () => {
    expect(bare({ deliveryType: 'home' }).shippingPhoneRequired()).toBe(true);
    expect(bare({ deliveryType: 'locker' }).shippingPhoneRequired()).toBe(false);
    expect(
      bare({ deliveryType: 'locker', phoneRequiredLocker: true }).shippingPhoneRequired(),
    ).toBe(true);
  });
});
