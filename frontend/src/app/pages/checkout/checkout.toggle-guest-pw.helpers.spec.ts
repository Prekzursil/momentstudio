import { CheckoutComponent } from './checkout.component';

/** Golden WU tip orphan — toggleGuestPassword. */
describe('CheckoutComponent toggleGuestPassword (golden WU)', () => {
  function bare(): CheckoutComponent {
    const cmp = Object.create(CheckoutComponent.prototype) as CheckoutComponent;
    (cmp as any).guestShowPassword = false;
    return cmp;
  }

  it('flips guestShowPassword', () => {
    const cmp = bare();
    cmp.toggleGuestPassword();
    expect((cmp as any).guestShowPassword).toBe(true);
    cmp.toggleGuestPassword();
    expect((cmp as any).guestShowPassword).toBe(false);
  });
});
