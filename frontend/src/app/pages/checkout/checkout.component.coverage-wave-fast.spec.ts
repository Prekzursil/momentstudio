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


const SHORT_AUTH_VALUE = '123';
const AUTH_VALUE = 'authValue';
const AUTH_VALUE_ALT = 'authValueAlt';


function invokeApplyPromo(cmp: any): void {
  (CheckoutComponent.prototype as any).applyPromo.call(cmp);
}

function buildCheckoutForm(valid: boolean): any {  return {
    valid,
    control: {
      updateValueAndValidity: jasmine.createSpy('updateValueAndValidity'),
    },
  };
}

describe('CheckoutComponent fast preference and coupon guards', () => {
  it('executes constructor defaults and saved-delivery preference branches', () => {
    const cartStoreStub = {
      items: () => [],
      subtotal: () => 0,
    };
    const routerStub = { navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)) };
    const routeStub = { snapshot: { queryParams: {} } };
    const cartApiStub = {};
    const apiStub = {};
    const accountServiceStub = {};
    const couponsServiceStub = {};
    const translateStub = { currentLang: 'ro', instant: (key: string) => key };
    const analyticsStub = { enabled: () => false, track: jasmine.createSpy('track') };
    const authStub = { isAuthenticated: () => false };
    const zoneStub = { run: (fn: () => void) => fn() };
    const cdrStub = { markForCheck: jasmine.createSpy('markForCheck') };

    const checkoutWithoutPrefs = new CheckoutComponent(
      cartStoreStub as any,
      routerStub as any,
      routeStub as any,
      cartApiStub as any,
      apiStub as any,
      accountServiceStub as any,
      couponsServiceStub as any,
      translateStub as any,
      { tryLoadDeliveryPrefs: () => null, tryLoadPaymentMethod: () => null } as any,
      analyticsStub as any,
      authStub as any,
      zoneStub as any,
      cdrStub as any,
    ) as any;

    expect(checkoutWithoutPrefs.deliveryType).toBe('home');
    expect(checkoutWithoutPrefs.locker).toBeNull();
    expect(checkoutWithoutPrefs.shippingCountryInput).toBeTruthy();
    expect(checkoutWithoutPrefs.billingCountryInput).toBeTruthy();
    expect(checkoutWithoutPrefs.countries.length).toBeGreaterThan(0);

    const checkoutWithPrefs = new CheckoutComponent(
      cartStoreStub as any,
      routerStub as any,
      routeStub as any,
      cartApiStub as any,
      apiStub as any,
      accountServiceStub as any,
      couponsServiceStub as any,
      translateStub as any,
      { tryLoadDeliveryPrefs: () => ({ courier: 'fan_courier', deliveryType: 'locker' }), tryLoadPaymentMethod: () => null } as any,
      analyticsStub as any,
      authStub as any,
      zoneStub as any,
      cdrStub as any,
    ) as any;

    expect(checkoutWithPrefs.deliveryType).toBe('locker');
    expect(checkoutWithPrefs.courier).toBe('fan_courier');
    expect(checkoutWithPrefs.paymentMethod).toMatch(/^(cod|netopia|paypal|stripe)$/);
  });
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

describe('CheckoutComponent fast promo error and guest branches', () => {
  it('handles applyPromo non-eligible, fallback-404, and generic-error branches', () => {
    const cmp = createCheckoutHarness();
    cmp.couponsService = {
      validate: jasmine
        .createSpy('validate')
        .and.returnValues(
          of({
            eligible: false,
            reasons: ['minimum_order'],
            coupon: { code: 'SAVE10' },
            estimated_discount_ron: '0',
            estimated_shipping_discount_ron: '0',
          }),
          throwError(() => ({ status: 404 })),
          throwError(() => ({ status: 500, error: { detail: 'coupon-api-error' } }))
        ),
    };
    cmp.describeCouponReasons = jasmine.createSpy('describeCouponReasons').and.returnValue('minimum order');
    cmp.minSubtotalShortfall = jasmine.createSpy('minSubtotalShortfall').and.returnValue({ remaining: 10, min: 50 });
    cmp.refreshQuote = jasmine.createSpy('refreshQuote');
    cmp.applyLegacyPromo = jasmine.createSpy('applyLegacyPromo');
    cmp.auth.isAuthenticated = () => true;
    cmp.promo = 'SAVE10';

    invokeApplyPromo(cmp);
    expect(cmp.promoStatus).toBe('warn');
    expect(cmp.promoValid).toBeFalse();
    expect(cmp.promoMessage).toContain('checkout.couponNotEligible');
    expect(cmp.refreshQuote).toHaveBeenCalledWith(null);

    invokeApplyPromo(cmp);
    expect(cmp.applyLegacyPromo).toHaveBeenCalledWith('SAVE10');

    invokeApplyPromo(cmp);
    expect(cmp.promoMessage).toContain('coupon-api-error');
  });

  it('requires login for promo application in guest mode', () => {
    const cmp = createCheckoutHarness();
    cmp.auth.isAuthenticated = () => false;
    cmp.refreshQuote = jasmine.createSpy('refreshQuote');
    cmp.promo = 'SAVEGUEST';

    invokeApplyPromo(cmp);
    expect(cmp.promoStatus).toBe('warn');
    expect(cmp.promoValid).toBeFalse();
    expect(cmp.promoMessage).toContain('checkout.couponsLoginRequired');
    expect(cmp.promo).toBe('');
    expect(cmp.refreshQuote).toHaveBeenCalledWith(null);
  });
});

describe('CheckoutComponent fast cart sync/load error branches', () => {
  it('queues sync when already syncing and flushes immediate sync without delay', () => {
    const cmp = createCheckoutHarness();
    cmp.syncing = true;
    cmp.syncQueued = false;
    cmp.queuedSyncItems = null;
    cmp.queueCartSync([{ sku: 'sku-1', quantity: 1 } as any]);
    expect(cmp.syncQueued).toBeTrue();
    expect(cmp.queuedSyncItems.length).toBe(1);

    cmp.syncing = false;
    cmp.syncBackendCart = jasmine.createSpy('syncBackendCart');
    spyOn(globalThis, 'setTimeout').and.callFake(((fn: unknown) => {
      if (typeof fn === 'function') fn();
      return 1 as any;
    }) as any);
    cmp.queueCartSync([{ sku: 'sku-2', quantity: 1 } as any], { immediate: true });
    expect(cmp.syncBackendCart).toHaveBeenCalled();
  });

  it('covers loadCartFromServer auth and cart-api error branches', () => {
    const cmp = createCheckoutHarness();
    cmp.cartApi = { get: jasmine.createSpy('get').and.returnValue(throwError(() => new Error('cart-error'))) };
    cmp.auth = {
      ensureAuthenticated: jasmine.createSpy('ensureAuthenticated').and.returnValue(of(true)),
      isAuthenticated: () => true,
      user: () => null,
    };
    cmp.cartQuoteParams = jasmine.createSpy('cartQuoteParams').and.returnValue({ country: 'RO' });
    cmp.hydrateCartAndQuote = jasmine.createSpy('hydrateCartAndQuote');

    cmp.loadCartFromServer();
    expect(cmp.syncing).toBeFalse();
    expect(cmp.errorMessage).toContain('checkout.cartLoadError');
    expect(cmp.hydrateCartAndQuote).not.toHaveBeenCalled();

    cmp.auth.ensureAuthenticated.and.returnValue(throwError(() => new Error('auth-error')));
    cmp.loadCartFromServer();
    expect(cmp.syncing).toBeFalse();
    expect(cmp.errorMessage).toContain('checkout.cartLoadError');
  });

  it('covers refreshQuote fallback when promo quote fails', () => {
    const cmp = createCheckoutHarness();
    const hydrated = jasmine.createSpy('hydrateCartAndQuote');
    cmp.hydrateCartAndQuote = hydrated;
    cmp.cartApi = {
      get: jasmine
        .createSpy('get')
        .and.returnValues(
          throwError(() => ({ error: { detail: 'promo quote failed' } })),
          of({ items: [], quote: { total: 1 } })
        ),
    };
    cmp.cartQuoteParams = jasmine.createSpy('cartQuoteParams').and.callFake((promo: string | null) =>
      promo ? { country: 'RO', promo_code: promo } : { country: 'RO' }
    );

    cmp.refreshQuote('SAVE10');
    expect(cmp.promoStatus).toBe('warn');
    expect(cmp.promoValid).toBeFalse();
    expect(cmp.promoMessage).toContain('promo quote failed');
    expect(cmp.cartApi.get).toHaveBeenCalledTimes(2);
    expect(hydrated).toHaveBeenCalled();
  });
});

describe('CheckoutComponent fast placeOrder guard branches', () => {
  it('returns early on invalid country, invalid form, missing locker, and missing verification', () => {
    const cmp = createCheckoutHarness();
    cmp.normalizeCheckoutCountries = jasmine.createSpy('normalizeCheckoutCountries').and.returnValue(false);
    cmp.focusFirstInvalidField = jasmine.createSpy('focusFirstInvalidField');
    cmp.focusLockerPicker = jasmine.createSpy('focusLockerPicker');
    cmp.emailVerified = jasmine.createSpy('emailVerified').and.returnValue(false);
    cmp.auth.isAuthenticated = () => true;

    cmp.placeOrder(buildCheckoutForm(true));
    expect(cmp.addressError).toContain('checkout.countryInvalid');

    cmp.normalizeCheckoutCountries.and.returnValue(true);
    cmp.placeOrder(buildCheckoutForm(false));
    expect(cmp.addressError).toContain('checkout.addressRequired');

    cmp.deliveryType = 'locker';
    cmp.locker = null;
    cmp.placeOrder(buildCheckoutForm(true));
    expect(cmp.deliveryError).toContain('checkout.deliveryLockerRequired');

    cmp.deliveryType = 'home';
    cmp.auth.isAuthenticated = () => true;
    cmp.placeOrder(buildCheckoutForm(true));
    expect(cmp.errorMessage).toContain('auth.emailVerificationNeeded');

    cmp.auth.isAuthenticated = () => false;
    cmp.guestEmailVerified = false;
    cmp.placeOrder(buildCheckoutForm(true));
    expect(cmp.errorMessage).toContain('auth.emailVerificationNeeded');
  });

  it('validates guest-create-account password and phone branches', () => {
    const cmp = createCheckoutHarness();
    cmp.normalizeCheckoutCountries = jasmine.createSpy('normalizeCheckoutCountries').and.returnValue(true);
    cmp.focusFirstInvalidField = jasmine.createSpy('focusFirstInvalidField');
    cmp.focusGlobalError = jasmine.createSpy('focusGlobalError');
    cmp.auth.isAuthenticated = () => false;
    cmp.guestEmailVerified = true;
    cmp.guestCreateAccount = true;
    cmp.guestPassword = SHORT_AUTH_VALUE;
    cmp.guestPasswordConfirm = SHORT_AUTH_VALUE;
    cmp.guestPhoneE164 = jasmine.createSpy('guestPhoneE164').and.returnValue(null);

    cmp.placeOrder(buildCheckoutForm(true));
    expect(cmp.errorMessage).toContain('validation.passwordMin');

    cmp.guestPassword = AUTH_VALUE;
    cmp.guestPasswordConfirm = AUTH_VALUE_ALT;
    cmp.placeOrder(buildCheckoutForm(true));
    expect(cmp.errorMessage).toContain('validation.passwordMismatch');

    cmp.guestPasswordConfirm = AUTH_VALUE;
    cmp.placeOrder(buildCheckoutForm(true));
    expect(cmp.errorMessage).toContain('validation.phoneInvalid');
  });
});

describe('CheckoutComponent fast payment/analytics/finalize branches', () => {
  it('covers checkout start response branches for paypal/stripe/netopia/cod/default', () => {
    const cmp = createCheckoutHarness();
    cmp.persistAddressIfRequested = jasmine.createSpy('persistAddressIfRequested');
    cmp.redirectToPaymentUrl = jasmine.createSpy('redirectToPaymentUrl');
    cmp.cart = { clear: jasmine.createSpy('clear') };
    cmp.goToSuccess = jasmine.createSpy('goToSuccess');
    cmp.showPaymentNotReadyError = jasmine.createSpy('showPaymentNotReadyError');
    cmp.buildSuccessSummary = jasmine.createSpy('buildSuccessSummary').and.returnValue({ id: 'summary' });

    cmp.paymentMethod = 'paypal';
    cmp.handleCheckoutStartResponse({ order_id: 'o1', reference_code: 'R1', payment_method: 'paypal', paypal_approval_url: 'https://paypal.com/x' });
    expect(cmp.redirectToPaymentUrl).toHaveBeenCalledWith('https://paypal.com/x', ['paypal.com']);

    cmp.paymentMethod = 'stripe';
    cmp.handleCheckoutStartResponse({ order_id: 'o2', reference_code: 'R2', payment_method: 'stripe', stripe_checkout_url: 'https://checkout.stripe.com/x' });
    expect(cmp.redirectToPaymentUrl).toHaveBeenCalledWith('https://checkout.stripe.com/x', ['checkout.stripe.com']);

    cmp.paymentMethod = 'netopia';
    cmp.handleCheckoutStartResponse({ order_id: 'o3', reference_code: 'R3', payment_method: 'netopia', netopia_payment_url: 'https://secure.netopia-payments.com/x' });
    expect(cmp.redirectToPaymentUrl).toHaveBeenCalledWith('https://secure.netopia-payments.com/x', ['mobilpay.ro', 'netopia-payments.com']);

    cmp.paymentMethod = 'cod';
    cmp.handleCheckoutStartResponse({ order_id: 'o4', reference_code: 'R4', payment_method: 'cod' });
    expect(cmp.cart.clear).toHaveBeenCalled();
    expect(cmp.goToSuccess).toHaveBeenCalled();

    cmp.paymentMethod = 'unknown';
    cmp.handleCheckoutStartResponse({ order_id: 'o5', reference_code: 'R5', payment_method: 'unknown' });
    expect(cmp.showPaymentNotReadyError).toHaveBeenCalled();
  });

  it('covers request-error/finalize and analytics tracking guard branches', () => {
    const cmp = createCheckoutHarness();
    cmp.detectChangesSafe = jasmine.createSpy('detectChangesSafe');
    cmp.announceAssertive = jasmine.createSpy('announceAssertive');
    cmp.focusGlobalError = jasmine.createSpy('focusGlobalError');

    cmp.handleCheckoutRequestError({ name: 'TimeoutError' });
    expect(cmp.errorMessage).toContain('checkout.checkoutFailed');

    cmp.checkoutFlowCompleted = false;
    cmp.errorMessage = '';
    cmp.handleCheckoutFinalize(false);
    expect(cmp.announceAssertive).toHaveBeenCalled();
    expect(cmp.focusGlobalError).toHaveBeenCalled();

    cmp.analytics = {
      enabled: jasmine.createSpy('enabled').and.returnValue(true),
      track: jasmine.createSpy('track'),
    };
    cmp.checkoutStartTracked = false;
    cmp.items = () => [{ quantity: 2, currency: 'RON' }, { quantity: 1, currency: 'RON' }];
    cmp.subtotal = () => 150;
    cmp.quoteTotal = () => 170;
    cmp.step1Complete = jasmine.createSpy('step1Complete').and.returnValue(true);
    cmp.step2Complete = jasmine.createSpy('step2Complete').and.returnValue(false);
    cmp.auth.isAuthenticated = () => false;

    cmp.trackCheckoutStart();
    cmp.trackCheckoutAbandon();
    expect(cmp.analytics.track).toHaveBeenCalledWith(
      'checkout_start',
      jasmine.objectContaining({ line_items: 2, units: 3, subtotal: 150, total: 170 })
    );
    expect(cmp.analytics.track).toHaveBeenCalledWith(
      'checkout_abandon',
      jasmine.objectContaining({ payment_method: cmp.paymentMethod, signed_in: false })
    );
  });

  it('covers submitCheckoutRequest success and error observer branches', () => {
    const cmp = createCheckoutHarness();
    cmp.zone = { run: (fn: () => void) => fn() };
    cmp.cartApi = { headers: jasmine.createSpy('headers').and.returnValue({}) };
    cmp.handleCheckoutStartResponse = jasmine.createSpy('handleCheckoutStartResponse');
    cmp.handleCheckoutRequestError = jasmine.createSpy('handleCheckoutRequestError');
    cmp.handleCheckoutFinalize = jasmine.createSpy('handleCheckoutFinalize');
    cmp.api = {
      post: jasmine
        .createSpy('post')
        .and.returnValues(
          of({ order_id: 'o1', reference_code: 'R1', payment_method: 'cod' }),
          throwError(() => ({ error: { detail: 'boom' } }))
        ),
    };

    cmp.submitCheckoutRequest('/orders/checkout', { payload: true });
    expect(cmp.handleCheckoutStartResponse).toHaveBeenCalled();
    expect(cmp.handleCheckoutFinalize).toHaveBeenCalled();

    cmp.submitCheckoutRequest('/orders/checkout', { payload: true });
    expect(cmp.handleCheckoutRequestError).toHaveBeenCalled();
  });
});


describe('CheckoutComponent fast residual focus/address/sync branches', () => {
  it('covers focusFirstInvalidField and focusElementById guarded setTimeout branches', () => {
    const cmp = createCheckoutHarness();
    const invalid = document.createElement('input');
    cmp.checkoutFormEl = { nativeElement: document.createElement('form') };
    cmp.findFirstInvalidField = jasmine.createSpy('findFirstInvalidField').and.returnValue(invalid);
    cmp.scrollAndFocus = jasmine.createSpy('scrollAndFocus');

    spyOn(globalThis, 'setTimeout').and.callFake(((fn: unknown) => {
      if (typeof fn === 'function') fn();
      return 1 as any;
    }) as any);

    cmp.focusFirstInvalidField();
    expect(cmp.findFirstInvalidField).toHaveBeenCalled();
    expect(cmp.scrollAndFocus).toHaveBeenCalledWith(invalid);

    const target = document.createElement('div');
    target.id = 'checkout-global-error';
    document.body.appendChild(target);
    cmp.focusElementById('checkout-global-error');
    expect(cmp.scrollAndFocus).toHaveBeenCalledWith(target);
    target.remove();
  });

  it('covers saved-address defaults and billing prefill guard matrix', () => {
    const cmp = createCheckoutHarness();
    cmp.countryInputFromCode = jasmine.createSpy('countryInputFromCode').and.returnValue('RO');
    cmp.applySavedAddressToBilling = jasmine.createSpy('applySavedAddressToBilling');
    cmp.applySavedAddressToShipping = jasmine.createSpy('applySavedAddressToShipping');
    cmp.savedAddressesLoading = true;
    cmp.selectedBillingAddressId = '';
    cmp.billingSameAsShipping = false;
    cmp.billing = { line1: '', city: '', postal: '', line2: '', region: '', country: '' };
    cmp.address = { ...cmp.address, line1: '', city: '', postal: '', line2: '', region: '', country: 'RO' };

    const shipping = { id: 's-1', is_default_shipping: true, is_default_billing: false, line1: 'Ship', city: 'S', postal_code: '1', country: 'RO' } as any;
    const billing = { id: 'b-1', is_default_shipping: false, is_default_billing: true, line1: 'Bill', city: 'B', postal_code: '2', country: 'RO' } as any;
    cmp.handleSavedAddressesLoaded([shipping, billing]);

    expect(cmp.selectedBillingAddressId).toBe('b-1');
    expect(cmp.applySavedAddressToBilling).toHaveBeenCalledWith(billing);
    expect(cmp.applySavedAddressToShipping).toHaveBeenCalledWith(shipping);
    expect(cmp.savedAddressesLoading).toBeFalse();

    cmp.billing.line1 = 'already-filled';
    expect(cmp.shouldPrefillBillingFromSavedAddress()).toBeFalse();
  });

  it('covers syncBackendCart queued follow-up branch', () => {
    const cmp = createCheckoutHarness();
    cmp.cartApi = { sync: jasmine.createSpy('sync').and.returnValue(of({ items: [], quote: { total: 0 } })) };
    cmp.hydrateCartAndQuote = jasmine.createSpy('hydrateCartAndQuote');
    cmp.queueCartSync = jasmine.createSpy('queueCartSync');
    cmp.queuedSyncItems = [{ sku: 'queued', quantity: 2 } as any];

    cmp.syncBackendCart([{ sku: 'main', quantity: 1 } as any]);

    expect(cmp.hydrateCartAndQuote).toHaveBeenCalled();
    expect(cmp.queueCartSync).toHaveBeenCalledWith([{ sku: 'queued', quantity: 2 } as any], { immediate: true });
    expect(cmp.queuedSyncItems).toBeNull();
  });
});
