import { CheckoutComponent } from './checkout.component';
import { of, throwError } from 'rxjs';

function createCheckoutHarness(): any {
  const cmp: any = Object.create(CheckoutComponent.prototype);
  cmp.auth = { isAuthenticated: () => true };
  cmp.translate = {
    instant: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.keys(params).join(',')}` : key,
  };
  cmp.checkoutPrefs = { saveDeliveryPrefs: jasmine.createSpy('saveDeliveryPrefs') };
  cmp.router = { navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)) };
  cmp.subtotal = () => 100;
  cmp.items = () => [
    { name: 'Item', slug: 'item', quantity: 2, price: 25, currency: 'RON' },
  ];
  cmp.currency = 'RON';
  cmp.quote = null;
  cmp.courier = 'sameday';
  cmp.deliveryType = 'home';
  cmp.locker = null;
  cmp.saveAddress = false;
  cmp.paymentMethod = 'card';
  cmp.placing = false;
  cmp.errorMessage = '';

  cmp.autoApplyBestCoupon = false;
  cmp.pendingPromoCode = null;
  cmp.promo = '';
  cmp.appliedCouponOffer = null;
  cmp.suggestedCouponOffer = null;
  cmp.couponEligibility = null;
  cmp.couponEligibilityLoading = true;

  cmp.cartSyncPending = jasmine.createSpy('cartSyncPending').and.returnValue(false);
  cmp.applyCouponOffer = jasmine.createSpy('applyCouponOffer');
  cmp.applyPromo = jasmine.createSpy('applyPromo');
  cmp.announceAssertive = jasmine.createSpy('announceAssertive');
  cmp.focusGlobalError = jasmine.createSpy('focusGlobalError');
  cmp.detectChangesSafe = jasmine.createSpy('detectChangesSafe');

  cmp.address = { country: ' RO ' };

  return cmp;
}

describe('CheckoutComponent fast preference and coupon guards', () => {
  it('reads and persists auto-apply preference safely', () => {
    const cmp = createCheckoutHarness();
    const getSpy = spyOn(localStorage, 'getItem').and.returnValue('true');
    const setSpy = spyOn(localStorage, 'setItem');

    expect(cmp.loadAutoApplyBestCouponPreference()).toBeTrue();
    expect(getSpy).toHaveBeenCalled();

    cmp.persistAutoApplyBestCouponPreference(true);
    expect(setSpy).toHaveBeenCalled();

    getSpy.and.returnValue('{bad');
    expect(cmp.loadAutoApplyBestCouponPreference()).toBeFalse();
  });

  it('applies suggested coupon only when all eligibility guards pass', () => {
    const cmp = createCheckoutHarness();
    cmp.autoApplyBestCoupon = true;
    cmp.suggestedCouponOffer = {
      eligible: true,
      coupon: { code: 'SAVE10' },
      estimated_discount_ron: '10',
      estimated_shipping_discount_ron: '0',
    };

    cmp.auth.isAuthenticated = () => false;
    cmp.maybeAutoApplyBestCoupon();
    expect(cmp.applyCouponOffer).not.toHaveBeenCalled();

    cmp.auth.isAuthenticated = () => true;
    cmp.pendingPromoCode = 'SAVE';
    cmp.maybeAutoApplyBestCoupon();
    expect(cmp.applyCouponOffer).not.toHaveBeenCalled();

    cmp.pendingPromoCode = null;
    cmp.cartSyncPending.and.returnValue(true);
    cmp.maybeAutoApplyBestCoupon();
    expect(cmp.applyCouponOffer).not.toHaveBeenCalled();

    cmp.cartSyncPending.and.returnValue(false);
    cmp.maybeAutoApplyBestCoupon();
    expect(cmp.applyCouponOffer).toHaveBeenCalledWith(cmp.suggestedCouponOffer);
  });
});

describe('CheckoutComponent fast discount and summary helpers', () => {
  it('computes shipping discount only when applied code matches current promo', () => {
    const cmp = createCheckoutHarness();
    cmp.appliedCouponOffer = {
      eligible: true,
      coupon: { code: 'SAVE5' },
      estimated_discount_ron: '0',
      estimated_shipping_discount_ron: '5',
    };

    cmp.promo = 'save5';
    expect(cmp.couponShippingDiscount()).toBe(5);

    cmp.promo = 'other';
    expect(cmp.couponShippingDiscount()).toBe(0);

    cmp.appliedCouponOffer = { ...cmp.appliedCouponOffer, eligible: false };
    expect(cmp.couponShippingDiscount()).toBe(0);
  });

  it('builds checkout success summary from quote and items', () => {
    const cmp = createCheckoutHarness();
    cmp.quote = {
      subtotal: 100,
      fee: 5,
      tax: 10,
      shipping: 15,
      total: 110,
      currency: 'RON',
    };

    const summary = cmp.buildSuccessSummary('order-1', 'REF-1', 'card');

    expect(summary.order_id).toBe('order-1');
    expect(summary.reference_code).toBe('REF-1');
    expect(summary.totals.discount).toBe(20);
    expect(summary.items.length).toBe(1);
    expect(summary.items[0].currency).toBe('RON');
  });
});

describe('CheckoutComponent fast promo and redirect helpers', () => {
  it('normalizes promo code lookup and applies pending promo for authenticated users', () => {
    const cmp = createCheckoutHarness();
    const eligibility = {
      eligible: [{ coupon: { code: 'SAVE10' }, eligible: true }],
      ineligible: [{ coupon: { code: 'SAVE5' }, eligible: false }],
    };

    cmp.promo = ' save10 ';
    expect(cmp.currentPromoCode()).toBe('SAVE10');
    expect(cmp.findCouponOfferByCode(eligibility, 'SAVE10')?.coupon?.code).toBe('SAVE10');

    cmp.pendingPromoCode = ' save5 ';
    cmp.applyPendingPromoCode();
    expect(cmp.promo).toBe('SAVE5');
    expect(cmp.applyPromo).toHaveBeenCalled();

    cmp.applyPromo.calls.reset();
    cmp.auth.isAuthenticated = () => false;
    cmp.pendingPromoCode = 'save10';
    cmp.applyPendingPromoCode();
    expect(cmp.applyPromo).not.toHaveBeenCalled();
  });

  it('normalizes payment redirect URLs with strict host and protocol checks', () => {
    const cmp = createCheckoutHarness();

    const allowed = cmp.normalizePaymentRedirectUrl('https://checkout.stripe.com/pay/cs_test', ['checkout.stripe.com']);
    expect(allowed).toContain('checkout.stripe.com');

    const allowedSubdomain = cmp.normalizePaymentRedirectUrl('https://safe.paypal.com/path', ['paypal.com']);
    expect(allowedSubdomain).toContain('paypal.com');

    expect(cmp.normalizePaymentRedirectUrl('http://evil.example.com/pay', ['paypal.com'])).toBeNull();
    expect(cmp.normalizePaymentRedirectUrl('javascript:alert(1)', ['paypal.com'])).toBeNull();
  });

  it('emits payment-not-ready fallback state when redirect target is invalid', () => {
    const cmp = createCheckoutHarness();

    cmp.redirectToPaymentUrl('https://evil.example.com/pay', ['paypal.com']);

    expect(cmp.errorMessage).toContain('checkout.paymentNotReady');
    expect(cmp.announceAssertive).toHaveBeenCalled();
    expect(cmp.focusGlobalError).toHaveBeenCalled();
    expect(cmp.detectChangesSafe).toHaveBeenCalled();
  });
});

describe('CheckoutComponent fast quote eligibility helpers', () => {
  it('builds quote params and coupon eligibility state transitions', () => {
    const cmp = createCheckoutHarness();

    expect(cmp.cartQuoteParams(' SAVE ')).toEqual({ country: 'RO', promo_code: 'SAVE' });
    expect(cmp.cartQuoteParams(null)).toEqual({ country: 'RO' });

    cmp.promo = 'SAVE10';
    cmp.pickBestCouponOffer = jasmine
      .createSpy('pickBestCouponOffer')
      .and.returnValue({ coupon: { code: 'AUTO' }, eligible: true });
    cmp.findAppliedCouponOffer = jasmine
      .createSpy('findAppliedCouponOffer')
      .and.returnValue({ coupon: { code: 'SAVE10' }, eligible: true });
    spyOn(cmp, 'maybeAutoApplyBestCoupon').and.stub();

    cmp.handleCouponEligibilityLoaded({ eligible: [], ineligible: [] });

    expect(cmp.couponEligibilityLoading).toBeFalse();
    expect(cmp.suggestedCouponOffer.coupon.code).toBe('AUTO');
    expect(cmp.appliedCouponOffer.coupon.code).toBe('SAVE10');
    expect(cmp.maybeAutoApplyBestCoupon).toHaveBeenCalled();
  });
});

describe('CheckoutComponent fast step verification branch', () => {
  it('evaluates step2 completion guards for country, locker, and guest verification', () => {
    const cmp = createCheckoutHarness();
    cmp.address = {
      name: 'Buyer',
      email: 'buyer@example.com',
      line1: 'Main 1',
      line2: '',
      city: 'Bucharest',
      region: 'B',
      postal: '010101',
      country: 'RO',
      password: '',
    };
    cmp.billingSameAsShipping = true;
    cmp.deliveryType = 'home';
    cmp.shippingCountryInput = 'Romania';
    cmp.billingCountryInput = 'Romania';
    cmp.shippingCountryError = '';
    cmp.billingCountryError = '';
    cmp.resolveCountryCode = jasmine.createSpy('resolveCountryCode').and.returnValue('RO');
    cmp.shippingPhoneRequired = jasmine.createSpy('shippingPhoneRequired').and.returnValue(false);
    cmp.emailVerified = jasmine.createSpy('emailVerified').and.returnValue(true);
    cmp.auth.isAuthenticated = () => true;

    expect(cmp.step2Complete()).toBeTrue();

    cmp.shippingCountryError = 'country-error';
    expect(cmp.step2Complete()).toBeFalse();

    cmp.shippingCountryError = '';
    cmp.deliveryType = 'locker';
    cmp.locker = null;
    expect(cmp.step2Complete()).toBeFalse();

    cmp.deliveryType = 'home';
    cmp.auth.isAuthenticated = () => false;
    cmp.guestEmailVerified = false;
    expect(cmp.step2Complete()).toBeFalse();
  });
});

describe('CheckoutComponent fast billing copy and fallback branch', () => {
  it('copies shipping data to billing and resolves fallback saved billing address', () => {
    const cmp = createCheckoutHarness();
    cmp.countryInputFromCode = jasmine.createSpy('countryInputFromCode').and.callFake((code: string) => code);
    cmp.applySavedAddressToBilling = jasmine.createSpy('applySavedAddressToBilling');
    cmp.address = {
      ...cmp.address,
      line1: 'Ship line',
      line2: 'Ship line 2',
      city: 'Ship city',
      region: 'Ship region',
      postal: '1000',
      country: 'RO',
    };
    cmp.billing = { line1: '', line2: '', city: '', region: '', postal: '', country: '' };

    cmp.billingSameAsShipping = true;
    cmp.onBillingSameAsShippingChanged();
    expect(cmp.billing.line1).toBe('Ship line');
    expect(cmp.billing.city).toBe('Ship city');
    expect(cmp.billingCountryInput).toBe('RO');

    cmp.billingSameAsShipping = false;
    cmp.billing = { line1: '', line2: '', city: '', region: '', postal: '', country: '' };
    cmp.savedAddresses = [
      {
        id: 'addr-1',
        line1: 'Billing line',
        line2: null,
        city: 'Billing city',
        region: 'B',
        postal_code: '2000',
        country: 'RO',
        is_default_billing: true,
        is_default_shipping: false,
      },
    ];
    cmp.selectedBillingAddressId = '';

    cmp.onBillingSameAsShippingChanged();
    expect(cmp.selectedBillingAddressId).toBe('addr-1');
    expect(cmp.applySavedAddressToBilling).toHaveBeenCalledWith(cmp.savedAddresses[0]);
  });
});

describe('CheckoutComponent fast primary-email resend branch', () => {
  it('covers resendPrimaryEmailVerification success and error status updates', () => {
    const cmp = createCheckoutHarness();
    cmp.auth.isAuthenticated = () => true;
    cmp.primaryEmailVerificationBusy = false;
    cmp.primaryEmailVerificationStatus = '';
    cmp.primaryEmailVerificationResendRemainingSeconds = jasmine
      .createSpy('primaryEmailVerificationResendRemainingSeconds')
      .and.returnValue(0);
    cmp.auth.requestEmailVerification = jasmine.createSpy('requestEmailVerification').and.returnValue(of({ ok: true }));
    spyOn(Date, 'now').and.returnValue(1_000);

    cmp.resendPrimaryEmailVerification();
    expect(cmp.auth.requestEmailVerification).toHaveBeenCalledWith('/checkout');
    expect(cmp.primaryEmailVerificationStatus).toContain('account.verification.sentStatus');
    expect(cmp.primaryEmailVerificationBusy).toBeFalse();
    expect(cmp.primaryEmailVerificationResendUntil).toBe(61_000);

    cmp.auth.requestEmailVerification.and.returnValue(throwError(() => new Error('boom')));
    cmp.resendPrimaryEmailVerification();
    expect(cmp.primaryEmailVerificationStatus).toContain('account.verification.sendError');
    expect(cmp.primaryEmailVerificationBusy).toBeFalse();
  });
});
