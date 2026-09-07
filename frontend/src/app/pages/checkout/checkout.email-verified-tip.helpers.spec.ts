import { CheckoutComponent } from './checkout.component';
describe('CheckoutComponent emailVerified tip (golden WU)', () => {
  function bare(verified: boolean): CheckoutComponent {
    const cmp = Object.create(CheckoutComponent.prototype) as CheckoutComponent;
    Object.assign(cmp as any, { auth: { user: () => ({ email_verified: verified }) } });
    return cmp;
  }
  it('reads email_verified from auth.user', () => {
    expect(bare(true).emailVerified()).toBe(true);
    expect(bare(false).emailVerified()).toBe(false);
  });
});
