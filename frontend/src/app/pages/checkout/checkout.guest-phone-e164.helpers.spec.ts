import { CheckoutComponent } from './checkout.component';

/** Golden WU tip orphan — guestPhoneE164. */
describe('CheckoutComponent guestPhoneE164 (golden WU)', () => {
  function bare(overrides: Record<string, unknown> = {}): CheckoutComponent {
    const cmp = Object.create(CheckoutComponent.prototype) as CheckoutComponent;
    Object.assign(cmp as any, {
      guestPhoneCountry: 'RO',
      guestPhoneNational: '',
      ...overrides,
    });
    return cmp;
  }

  it('returns null for empty national and builds E.164 for a valid RO mobile', () => {
    expect(bare().guestPhoneE164()).toBeNull();
    expect(bare({ guestPhoneNational: '712345678' }).guestPhoneE164()).toBe('+40712345678');
  });
});
