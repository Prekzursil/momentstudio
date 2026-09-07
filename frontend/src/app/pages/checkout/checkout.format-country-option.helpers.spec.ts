import { CheckoutComponent } from './checkout.component';

/** Golden WU tip orphan — formatCountryOption. */
describe('CheckoutComponent formatCountryOption (golden WU)', () => {
  function bare(): CheckoutComponent {
    return Object.create(CheckoutComponent.prototype) as CheckoutComponent;
  }

  it('joins code and name with em dash', () => {
    expect(bare().formatCountryOption({ code: 'RO', name: 'Romania' } as any)).toBe(
      'RO — Romania',
    );
  });
});
