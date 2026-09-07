import { CheckoutComponent } from './checkout.component';

/** Golden WU tip orphan — consentBlocking. */
describe('CheckoutComponent consentBlocking (golden WU)', () => {
  function bare(overrides: Record<string, unknown> = {}): CheckoutComponent {
    const cmp = Object.create(CheckoutComponent.prototype) as CheckoutComponent;
    Object.assign(cmp as any, {
      auth: { isAuthenticated: () => false },
      legalConsentsLoading: false,
      acceptTerms: false,
      acceptPrivacy: false,
      ...overrides,
    });
    return cmp;
  }

  it('blocks while consents loading for auth users or until both accepted', () => {
    expect(
      bare({
        auth: { isAuthenticated: () => true },
        legalConsentsLoading: true,
      }).consentBlocking(),
    ).toBe(true);
    expect(bare({ acceptTerms: true, acceptPrivacy: false }).consentBlocking()).toBe(true);
    expect(bare({ acceptTerms: true, acceptPrivacy: true }).consentBlocking()).toBe(false);
  });
});
