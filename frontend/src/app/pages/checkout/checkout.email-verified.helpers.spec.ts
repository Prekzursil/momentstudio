import { CheckoutComponent } from './checkout.component';

/** Golden WU tip orphan — emailVerified. */
describe('CheckoutComponent emailVerified (golden WU)', () => {
  function bare(verified: boolean | undefined): CheckoutComponent {
    const cmp = Object.create(CheckoutComponent.prototype) as CheckoutComponent;
    Object.assign(cmp as any, {
      auth: { user: () => (verified === undefined ? null : { email_verified: verified }) },
    });
    return cmp;
  }

  it('reflects auth.user().email_verified', () => {
    expect(bare(true).emailVerified()).toBe(true);
    expect(bare(false).emailVerified()).toBe(false);
    expect(bare(undefined).emailVerified()).toBe(false);
  });
});
