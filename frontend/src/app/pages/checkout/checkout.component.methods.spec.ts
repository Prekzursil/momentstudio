import { of } from 'rxjs';

import { CheckoutComponent } from './checkout.component';

function instantTranslate(key: string, params?: Record<string, unknown>): string {
  if (!params) return key;
  const flattened = Object.entries(params)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(',');
  return `${key}:${flattened}`;
}

function createCheckoutHarness(): any {
  const cmp: any = Object.create(CheckoutComponent.prototype);
  cmp.auth = {
    isAuthenticated: () => false,
    user: () => null,
    requestEmailVerification: jasmine.createSpy('requestEmailVerification').and.returnValue(of({})),
  };
  cmp.translate = { instant: instantTranslate };
  cmp.checkoutPrefs = { saveDeliveryPrefs: jasmine.createSpy('saveDeliveryPrefs') };
  cmp.accountService = { getAddresses: jasmine.createSpy('getAddresses').and.returnValue(of([])) };
  cmp.router = { navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)) };
  cmp.cart = { clear: jasmine.createSpy('clear') };
  cmp.subtotal = () => 120;
  cmp.items = () => [];
  cmp.currency = 'RON';
  cmp.countries = [
    { code: 'RO', name: 'Romania' },
    { code: 'US', name: 'United States' },
  ];

  cmp.deliveryType = 'home';
  cmp.deliveryLockerAllowed = true;
  cmp.deliveryAllowedCouriers = ['sameday', 'fan_courier'];
  cmp.courier = 'sameday';
  cmp.deliveryError = '';
  cmp.locker = null;

  cmp.address = {
    name: '',
    email: '',
    line1: '',
    line2: '',
    city: '',
    region: '',
    postal: '',
    country: 'RO',
  };
  cmp.billing = {
    line1: '',
    line2: '',
    city: '',
    region: '',
    postal: '',
    country: 'RO',
  };
  cmp.shippingCountryInput = 'RO — Romania';
  cmp.billingCountryInput = 'RO — Romania';
  cmp.shippingCountryError = '';
  cmp.billingCountryError = '';

  cmp.phoneRequiredHome = true;
  cmp.phoneRequiredLocker = true;
  cmp.shippingPhoneCountry = 'RO';
  cmp.shippingPhoneNational = '0712345678';

  cmp.guestCreateAccount = false;
  cmp.guestUsername = '';
  cmp.guestPassword = '';
  cmp.guestPasswordConfirm = '';
  cmp.guestFirstName = '';
  cmp.guestLastName = '';
  cmp.guestDob = '';
  cmp.guestPhoneCountry = 'RO';
  cmp.guestPhoneNational = '';
  cmp.guestEmailVerified = false;
  cmp.lastGuestEmailVerified = null;
  cmp.lastGuestEmailRequested = null;
  cmp.guestVerificationSent = false;
  cmp.guestVerificationToken = '';
  cmp.guestEmailError = '';
  cmp.clearGuestResendCooldown = jasmine.createSpy('clearGuestResendCooldown');

  cmp.savedAddresses = [];
  cmp.savedAddressesLoading = false;
  cmp.savedAddressesError = '';
  cmp.selectedShippingAddressId = '';
  cmp.selectedBillingAddressId = '';
  cmp.billingSameAsShipping = false;

  cmp.promo = '';
  cmp.pendingPromoCode = '';
  cmp.appliedCouponOffer = null;
  cmp.suggestedCouponOffer = null;
  cmp.autoApplyBestCoupon = false;

  cmp.quote = null;
  cmp.saveAddress = false;
  cmp.checkoutFlowCompleted = false;
  cmp.placing = false;

  cmp.ensurePaymentMethodAvailable = jasmine.createSpy('ensurePaymentMethodAvailable');
  cmp.applySavedAddressToBilling = jasmine.createSpy('applySavedAddressToBilling');
  cmp.applySavedAddressToShipping = jasmine.createSpy('applySavedAddressToShipping');
  cmp.redirectToPaymentUrl = jasmine.createSpy('redirectToPaymentUrl');
  cmp.persistAddressIfRequested = jasmine.createSpy('persistAddressIfRequested');
  cmp.goToSuccess = jasmine.createSpy('goToSuccess');
  cmp.showPaymentNotReadyError = jasmine.createSpy('showPaymentNotReadyError');

  return cmp;
}

describe('CheckoutComponent method harness', () => {
  it('evaluates step1 completion for guest create-account flows', () => {
    const cmp = createCheckoutHarness();

    cmp.guestCreateAccount = true;
    expect(cmp.step1Complete()).toBeFalse();

    cmp.guestUsername = 'guest.user';
    const guestPassphrase = `${cmp.guestUsername}-token`;
    cmp.guestPassword = guestPassphrase;
    cmp.guestPasswordConfirm = guestPassphrase;
    cmp.guestFirstName = 'Ana';
    cmp.guestLastName = 'Pop';
    cmp.guestDob = '1992-01-01';
    cmp.guestPhoneNational = '0712345678';
    expect(cmp.step1Complete()).toBeTrue();
  });

  it('evaluates step2 completion for required shipping/billing data', () => {
    const cmp = createCheckoutHarness();
    cmp.billingSameAsShipping = true;
    cmp.address = {
      name: 'Ana Pop',
      email: 'ana@example.com',
      line1: 'Main 1',
      city: 'Bucuresti',
      region: 'B',
      postal: '010101',
      country: 'RO',
    };
    cmp.guestEmailVerified = true;

    expect(cmp.step2Complete()).toBeTrue();

    cmp.shippingCountryInput = 'Unknown';
    expect(cmp.step2Complete()).toBeFalse();
  });

  it('copies shipping to billing and applies fallback billing defaults', () => {
    const cmp = createCheckoutHarness();
    cmp.address = {
      name: 'Ana',
      email: 'ana@example.com',
      line1: 'Main',
      line2: '',
      city: 'B',
      region: 'B',
      postal: '12345',
      country: 'RO',
    };

    cmp.billingSameAsShipping = true;
    cmp.onBillingSameAsShippingChanged();
    expect(cmp.billing.line1).toBe('Main');

    cmp.billingSameAsShipping = false;
    cmp.billing = { line1: '', line2: '', city: '', region: '', postal: '', country: 'RO' };
    cmp.savedAddresses = [
      { id: 'a1', is_default_billing: true, line1: 'Bill', city: 'Cluj', postal_code: '400', country: 'RO' },
    ];
    cmp.onBillingSameAsShippingChanged();
    expect(cmp.selectedBillingAddressId).toBe('a1');
    expect(cmp.applySavedAddressToBilling).toHaveBeenCalled();
  });

  it('parses and normalizes country inputs', () => {
    const cmp = createCheckoutHarness();
    expect(cmp.resolveCountryCode('RO - Romania')).toBe('RO');
    expect(cmp.resolveCountryCode('Romania')).toBe('RO');
    expect(cmp.resolveCountryCode('')).toBeNull();

    expect(cmp.countryInputFromCode('RO')).toContain('RO');
    expect(cmp.countryInputFromCode('DE')).toBe('DE');

    cmp.shippingCountryInput = 'US';
    cmp.normalizeShippingCountry();
    expect(cmp.address.country).toBe('US');
    expect(cmp.ensurePaymentMethodAvailable).toHaveBeenCalled();

    cmp.billingCountryInput = 'Bad';
    cmp.normalizeBillingCountry();
    expect(cmp.billingCountryError).toContain('checkout.countryInvalid');
  });

  it('computes quote and discount helpers', () => {
    const cmp = createCheckoutHarness();
    cmp.quote = { subtotal: 100, fee: 5, tax: 10, shipping: 15, total: 110, currency: 'RON' };
    cmp.appliedCouponOffer = {
      eligible: true,
      coupon: { code: 'SAVE10', promotion: { discount_type: 'amount', amount_off: '10' } },
      estimated_discount_ron: '10',
      estimated_shipping_discount_ron: '5',
    };
    cmp.promo = 'SAVE10';

    expect(cmp.quoteSubtotal()).toBe(100);
    expect(cmp.quoteDiscount()).toBe(20);
    expect(cmp.quotePromoSavings()).toBe(25);
    expect(cmp.describeCouponOffer(cmp.appliedCouponOffer)).toContain('SAVE10');
    expect(cmp.describeCouponReasons(['min_subtotal_not_met'])).toContain('min_subtotal_not_met');
  });

  it('selects best coupon offer and computes subtotal shortfall', () => {
    const cmp = createCheckoutHarness();
    cmp.quote = { subtotal: 90, fee: 0, tax: 0, shipping: 10, total: 100, currency: 'RON' };
    const offers = [
      { eligible: true, estimated_discount_ron: '5', estimated_shipping_discount_ron: '0', coupon: { code: 'A' } },
      { eligible: true, estimated_discount_ron: '12', estimated_shipping_discount_ron: '3', coupon: { code: 'B' } },
    ];
    expect(cmp['pickBestCouponOffer'](offers)?.coupon?.code).toBe('B');

    const shortfall = cmp.minSubtotalShortfall({
      eligible: false,
      reasons: ['min_subtotal_not_met'],
      coupon: { code: 'SAVE', promotion: { min_subtotal: '150' } },
      estimated_discount_ron: '0',
      estimated_shipping_discount_ron: '0',
    });
    expect(shortfall?.remaining).toBe(60);
    expect(shortfall?.progress).toBeCloseTo(0.6, 3);
  });

  it('normalizes payment redirect URLs with strict host and protocol checks', () => {
    const cmp = createCheckoutHarness();
    expect(cmp.normalizePaymentRedirectUrl('https://checkout.stripe.com/pay/cs_test', ['checkout.stripe.com'])).toContain(
      'checkout.stripe.com'
    );
    expect(cmp.normalizePaymentRedirectUrl('not-a-valid-payment-target', ['checkout.stripe.com'])).toBeNull();
    expect(cmp.normalizePaymentRedirectUrl('https://evil.com/pay', ['checkout.stripe.com'])).toBeNull();
  });

  it('applies delivery/courier availability constraints', () => {
    const cmp = createCheckoutHarness();
    cmp.deliveryLockerAllowed = false;
    cmp.setDeliveryType('locker');
    expect(cmp.deliveryError).toContain('checkout.deliveryLockerUnavailable');

    cmp.deliveryLockerAllowed = true;
    cmp.setDeliveryType('locker');
    expect(cmp.deliveryType).toBe('locker');

    cmp.deliveryAllowedCouriers = ['sameday'];
    cmp.setCourier('fan_courier');
    expect(cmp.deliveryError).toContain('checkout.courierUnavailable');

    cmp.courier = 'fan_courier';
    cmp['ensureDeliveryOptionsAvailable']();
    expect(cmp.courier).toBe('sameday');
  });

  it('handles checkout start response branches by payment method', () => {
    const cmp = createCheckoutHarness();
    cmp.quote = { subtotal: 100, fee: 0, tax: 0, shipping: 0, total: 100, currency: 'RON' };
    cmp.items = () => [{ name: 'Prod', slug: 'prod', quantity: 1, price: 100, currency: 'RON' }];

    cmp.paymentMethod = 'cod';
    cmp.handleCheckoutStartResponse({ order_id: 'o1', reference_code: 'REF' });
    expect(cmp.cart.clear).toHaveBeenCalled();
    expect(cmp.goToSuccess).toHaveBeenCalled();

    cmp.paymentMethod = 'paypal';
    cmp.handleCheckoutStartResponse({ order_id: 'o2', paypal_approval_url: 'https://paypal.com/checkoutnow' });
    expect(cmp.redirectToPaymentUrl).toHaveBeenCalled();

    cmp.paymentMethod = 'stripe';
    cmp.handleCheckoutStartResponse({ order_id: 'o3', stripe_checkout_url: 'https://checkout.stripe.com/c/pay' });
    expect(cmp.redirectToPaymentUrl).toHaveBeenCalled();
  });

  it('updates guest email verification state when email changes', () => {
    const cmp = createCheckoutHarness();
    cmp.address.email = 'new@example.com';
    cmp.lastGuestEmailVerified = 'old@example.com';
    cmp.lastGuestEmailRequested = 'old@example.com';
    cmp.guestVerificationSent = true;
    cmp.guestVerificationToken = 'token';
    cmp.onEmailChanged();

    expect(cmp.guestEmailVerified).toBeFalse();
    expect(cmp.guestVerificationSent).toBeFalse();
    expect(cmp.guestVerificationToken).toBe('');
    expect(cmp.clearGuestResendCooldown).toHaveBeenCalled();
  });
});
