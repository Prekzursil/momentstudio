import { CheckoutComponent } from './checkout.component';

/** Golden WU tip orphan — formatCountryOption. */
describe('CheckoutComponent formatCountryOption (golden WU)', () => {
  function bare(): CheckoutComponent {
    return Object.create(CheckoutComponent.prototype) as CheckoutComponent;
  }

  it('formats code and name with an em dash', () => {
    expect(bare().formatCountryOption({ code: 'RO', name: 'Romania' } as any)).toBe(
      'RO — Romania',
    );
    expect(bare().formatCountryOption({ code: 'US', name: 'United States' } as any)).toBe(
      'US — United States',
    );
  });
});
