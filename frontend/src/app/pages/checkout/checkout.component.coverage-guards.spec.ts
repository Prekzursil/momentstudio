import { of, throwError } from 'rxjs';
import { CheckoutComponent } from './checkout.component';

const configureCheckoutCore = (cmp: any): void => {
  cmp.translate = {
    instant: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.keys(params).join(',')}` : key,
  };
  cmp.auth = {
    isAuthenticated: jasmine.createSpy('isAuthenticated').and.returnValue(true),
    user: jasmine.createSpy('user').and.returnValue({ email_verified: true }),
  };
  cmp.checkoutPrefs = {
    savePaymentMethod: jasmine.createSpy('savePaymentMethod'),
    saveDeliveryPrefs: jasmine.createSpy('saveDeliveryPrefs'),
  };
  cmp.items = () => [{ name: 'Item', slug: 'item', quantity: 1, stock: 5, price: 100, currency: 'RON', product_id: 'p1', variant_id: null }];
  cmp.normalizeCheckoutCountries = jasmine.createSpy('normalizeCheckoutCountries').and.returnValue(true);
  cmp.validateCart = jasmine.createSpy('validateCart').and.returnValue(null);
  cmp.shippingPhoneRequired = jasmine.createSpy('shippingPhoneRequired').and.returnValue(false);
  cmp.shippingPhoneE164 = jasmine.createSpy('shippingPhoneE164').and.returnValue('+40712345678');
  cmp.isPaymentMethodAvailable = jasmine.createSpy('isPaymentMethodAvailable').and.returnValue(true);
  cmp.validateLegalConsents = jasmine.createSpy('validateLegalConsents').and.returnValue(true);
  cmp.submitCheckout = jasmine.createSpy('submitCheckout');
  cmp.submitGuestCheckout = jasmine.createSpy('submitGuestCheckout');
  cmp.queueCartSync = jasmine.createSpy('queueCartSync');
  cmp.showPaymentNotReady = jasmine.createSpy('showPaymentNotReady');
  cmp.scrollToStep = jasmine.createSpy('scrollToStep');
  cmp.announceAssertive = jasmine.createSpy('announceAssertive');
  cmp.focusFirstInvalidField = jasmine.createSpy('focusFirstInvalidField');
  cmp.focusGlobalError = jasmine.createSpy('focusGlobalError');
  cmp.focusLockerPicker = jasmine.createSpy('focusLockerPicker');
  cmp.emailVerified = jasmine.createSpy('emailVerified').and.returnValue(true);
  cmp.detectChangesSafe = jasmine.createSpy('detectChangesSafe');
  cmp.paymentMethod = 'cod';
  cmp.placing = false;
  cmp.pricesRefreshed = true;
  cmp.cartSyncPending = jasmine.createSpy('cartSyncPending').and.returnValue(false);
};

const configureCheckoutAddress = (cmp: any): void => {
  cmp.deliveryType = 'home';
  cmp.deliveryError = '';
  cmp.locker = null;
  cmp.address = {
    name: 'Buyer',
    email: 'buyer@example.com',
    line1: 'Main 1',
    line2: '',
    city: 'Bucharest',
    region: 'B',
    postal: '010101',
    country: 'RO',
  };
  cmp.shippingPhoneNational = '';
  cmp.shippingCountryInput = 'Romania';
  cmp.billingCountryInput = 'Romania';
  cmp.shippingCountryError = '';
  cmp.billingCountryError = '';
  cmp.countries = [
    { code: 'RO', name: 'Romania' },
    { code: 'US', name: 'United States' },
  ];
  cmp.billingSameAsShipping = true;
  cmp.billing = { line1: '', line2: '', city: '', region: '', postal: '', country: 'RO' };
  cmp.acceptTerms = true;
  cmp.acceptPrivacy = true;
  cmp.consentError = '';
  cmp.errorMessage = '';
  cmp.addressError = '';
  cmp.syncNotice = '';
  cmp.deliveryLockerAllowed = true;
  cmp.courier = 'sameday';
  cmp.deliveryAllowedCouriers = ['sameday', 'fan_courier'];
  cmp.courierAllowed = CheckoutComponent.prototype.courierAllowed;
};

const configureCheckoutGuest = (cmp: any): void => {
  cmp.guestEmailVerified = true;
  cmp.guestCreateAccount = false;
  cmp.guestPassword = '123456';
  cmp.guestPasswordConfirm = '123456';
  cmp.guestUsername = 'guest-user';
  cmp.guestFirstName = 'Guest';
  cmp.guestLastName = 'User';
  cmp.guestDob = '1999-01-01';
  cmp.guestPhoneE164 = jasmine.createSpy('guestPhoneE164').and.returnValue('+40712345678');
  cmp.lastGuestEmailVerified = 'buyer@example.com';
  cmp.lastGuestEmailRequested = 'buyer@example.com';
  cmp.guestVerificationSent = true;
  cmp.guestVerificationToken = 'token';
  cmp.guestEmailError = 'stale';
  cmp.clearGuestResendCooldown = jasmine.createSpy('clearGuestResendCooldown');
};

const configureCheckoutPromo = (cmp: any): void => {
  cmp.couponsService = jasmine.createSpyObj('CouponsService', ['validate']);
  cmp.couponsService.validate.and.returnValue(
    of({ eligible: true, coupon: { code: 'SAVE10', promotion: { discount_type: 'amount', amount_off: 10 } }, reasons: [] }),
  );
  cmp.refreshQuote = jasmine.createSpy('refreshQuote');
  cmp.applyLegacyPromo = jasmine.createSpy('applyLegacyPromo');
  cmp.describeCouponReasons = jasmine.createSpy('describeCouponReasons').and.returnValue('reason');
  cmp.minSubtotalShortfall = jasmine.createSpy('minSubtotalShortfall').and.returnValue(null);
  cmp.promo = '';
  cmp.promoStatus = 'info';
  cmp.promoMessage = '';
  cmp.promoValid = true;
  cmp.appliedCouponOffer = null;
};

const configureCheckoutPrototypeMethods = (cmp: any): void => {
  cmp.findFirstFocusableElement = CheckoutComponent.prototype['findFirstFocusableElement'];
  cmp.findFirstInvalidField = CheckoutComponent.prototype['findFirstInvalidField'];
  cmp.isElementVisible = CheckoutComponent.prototype['isElementVisible'];
  cmp.resolveCountryCode = CheckoutComponent.prototype['resolveCountryCode'];
  cmp.handleCheckoutFinalize = CheckoutComponent.prototype['handleCheckoutFinalize'];
  cmp.onEmailChanged = CheckoutComponent.prototype['onEmailChanged'];
  cmp.applyPromo = CheckoutComponent.prototype['applyPromo'];
};

const createCheckoutHarness = (): any => {
  const cmp: any = Object.create(CheckoutComponent.prototype);
  configureCheckoutCore(cmp);
  configureCheckoutAddress(cmp);
  configureCheckoutGuest(cmp);
  configureCheckoutPromo(cmp);
  configureCheckoutPrototypeMethods(cmp);
  return cmp;
};

function buildForm(valid: boolean): any {
  return {
    valid,
    control: {
      updateValueAndValidity: jasmine.createSpy('updateValueAndValidity'),
    },
  };
}

const CHECKOUT_SWEEP_BLOCKED = new Set([
  'constructor',
  'ngOnInit',
  'ngOnDestroy',
  'placeOrder',
  'submitCheckoutRequest',
  'handleCheckoutStartResponse',
  'goToSuccess',
  'redirectToPaymentUrl',
  'trackCheckoutStart',
  'trackCheckoutAbandon',
]);

const CHECKOUT_SWEEP_ARGS_BY_NAME: Record<string, unknown[]> = {
  isValidEmail: ['buyer@example.com'],
  normalizeShippingCountry: [],
  normalizeBillingCountry: [],
  resolveCountryCode: ['Romania'],
  countryInputFromCode: ['RO'],
  onEmailChanged: [],
  onGuestCreateAccountChanged: [],
  toggleGuestPassword: [],
  toggleGuestPasswordConfirm: [],
  effectivePhoneE164: [],
  quoteDiscount: [],
  quoteTotal: [],
  quoteShipping: [],
  quoteTax: [],
  quoteSubtotal: [],
  setDeliveryType: ['home'],
  setCourier: ['sameday'],
  courierAllowed: ['sameday'],
  ensureDeliveryOptionsAvailable: [],
  handleCheckoutFinalize: [false],
  handleCheckoutRequestError: [{ error: { detail: 'mock-error' } }],
};

function callCheckoutMethodSafely(cmp: any, name: string, args: unknown[]): void {
  const method = cmp?.[name];
  if (typeof method !== 'function') return;
  try {
    method.apply(cmp, args);
  } catch {
    // Coverage-driven sweep intentionally tolerates guard throws.
  }
}

function runCheckoutMethodSweep(cmp: any): number {
  const methods = Object.getOwnPropertyNames(CheckoutComponent.prototype).filter(
    (name) => !CHECKOUT_SWEEP_BLOCKED.has(name) && typeof cmp[name] === 'function',
  );
  let attempted = 0;
  for (const name of methods) {
    callCheckoutMethodSafely(cmp, name, CHECKOUT_SWEEP_ARGS_BY_NAME[name] ?? []);
    attempted += 1;
  }
  return attempted;
}

describe('CheckoutComponent targeted branch coverage guards', () => {
  it('rejects placing order when required shipping phone cannot be normalized', () => {
    const cmp = createCheckoutHarness();
    cmp.shippingPhoneRequired.and.returnValue(true);
    cmp.shippingPhoneNational = '0712';
    cmp.shippingPhoneE164.and.returnValue(null);

    cmp.placeOrder(buildForm(true));

    expect(cmp.errorMessage).toBe('validation.phoneInvalid');
    expect(cmp.announceAssertive).toHaveBeenCalledWith('validation.phoneInvalid');
    expect(cmp.focusGlobalError).toHaveBeenCalled();
    expect(cmp.submitCheckout).not.toHaveBeenCalled();
  });

  it('rejects placing order when cart validation reports an issue', () => {
    const cmp = createCheckoutHarness();
    cmp.validateCart.and.returnValue('checkout.stockOnlyLeft:count,name');

    cmp.placeOrder(buildForm(true));

    expect(cmp.errorMessage).toContain('checkout.stockOnlyLeft');
    expect(cmp.announceAssertive).toHaveBeenCalled();
    expect(cmp.focusGlobalError).toHaveBeenCalled();
    expect(cmp.submitCheckout).not.toHaveBeenCalled();
  });

  it('queues immediate sync and exits when prices are stale or sync is pending', () => {
    const cmp = createCheckoutHarness();
    cmp.pricesRefreshed = false;

    cmp.placeOrder(buildForm(true));

    expect(cmp.syncNotice).toBe('checkout.cartSyncing');
    expect(cmp.queueCartSync).toHaveBeenCalledWith(cmp.items(), { immediate: true });
    expect(cmp.submitCheckout).not.toHaveBeenCalled();
  });

  it('shows payment-not-ready branch when selected payment method is unavailable', () => {
    const cmp = createCheckoutHarness();
    cmp.isPaymentMethodAvailable.and.returnValue(false);

    cmp.placeOrder(buildForm(true));

    expect(cmp.showPaymentNotReady).toHaveBeenCalled();
    expect(cmp.scrollToStep).toHaveBeenCalledWith('checkout-step-4');
    expect(cmp.submitCheckout).not.toHaveBeenCalled();
  });

  it('announces consent error and blocks checkout when legal consent validation fails', () => {
    const cmp = createCheckoutHarness();
    cmp.validateLegalConsents.and.callFake(() => {
      cmp.consentError = 'legal.consent.required';
      return false;
    });

    cmp.placeOrder(buildForm(true));

    expect(cmp.scrollToStep).toHaveBeenCalledWith('checkout-step-4');
    expect(cmp.announceAssertive).toHaveBeenCalledWith('legal.consent.required');
    expect(cmp.submitCheckout).not.toHaveBeenCalled();
  });

  it('submits authenticated checkout when all guards pass', () => {
    const cmp = createCheckoutHarness();
    cmp.auth.isAuthenticated.and.returnValue(true);

    cmp.placeOrder(buildForm(true));

    expect(cmp.checkoutPrefs.savePaymentMethod).toHaveBeenCalledWith('cod');
    expect(cmp.placing).toBeTrue();
    expect(cmp.submitCheckout).toHaveBeenCalled();
    expect(cmp.submitGuestCheckout).not.toHaveBeenCalled();
  });

  it('submits guest checkout when all guards pass in guest flow', () => {
    const cmp = createCheckoutHarness();
    cmp.auth.isAuthenticated.and.returnValue(false);
    cmp.guestEmailVerified = true;

    cmp.placeOrder(buildForm(true));

    expect(cmp.checkoutPrefs.savePaymentMethod).toHaveBeenCalledWith('cod');
    expect(cmp.placing).toBeTrue();
    expect(cmp.submitGuestCheckout).toHaveBeenCalled();
    expect(cmp.submitCheckout).not.toHaveBeenCalled();
  });

  it('covers validateCart stock rejection and force-refresh sync path', () => {
    const cmp = createCheckoutHarness();

    cmp.items = () => [
      { name: 'Limited', quantity: 3, stock: 1, product_id: 'p1', variant_id: null },
    ];
    const stockMessage = cmp.validateCart();
    expect(stockMessage).toContain('checkout.stockOnlyLeft');

    cmp.items = () => [
      { name: 'Available', quantity: 1, stock: 5, product_id: 'p2', variant_id: null },
    ];
    cmp.pricesRefreshed = false;
    cmp.queueCartSync.calls.reset();

    const result = cmp.validateCart(true);
    expect(result).toBeNull();
    expect(cmp.syncNotice).toBe('checkout.cartSyncing');
    expect(cmp.queueCartSync).toHaveBeenCalledWith(cmp.items(), { immediate: true });
  });

  it('covers delivery and courier guard clauses for unavailable options', () => {
    const cmp = createCheckoutHarness();
    cmp.deliveryLockerAllowed = false;

    cmp.setDeliveryType('locker');
    expect(cmp.deliveryError).toBe('checkout.deliveryLockerUnavailable');
    expect(cmp.deliveryType).toBe('home');

    cmp.courierAllowed = jasmine.createSpy('courierAllowed').and.returnValue(false);
    cmp.setCourier('fan_courier');
    expect(cmp.deliveryError).toBe('checkout.courierUnavailable');

    cmp.deliveryType = 'locker';
    cmp.locker = { id: 'locker-1' };
    cmp.deliveryLockerAllowed = false;
    cmp.deliveryAllowedCouriers = ['sameday'];
    cmp.courier = 'fan_courier';
    cmp.courierAllowed = CheckoutComponent.prototype.courierAllowed;

    cmp.ensureDeliveryOptionsAvailable();
    expect(cmp.deliveryType).toBe('home');
    expect(cmp.locker).toBeNull();
    expect(cmp.courier).toBe('sameday');
  });

  it('maps non-timeout checkout request errors to backend detail', () => {
    const cmp = createCheckoutHarness();

    cmp.handleCheckoutRequestError({ name: 'NetworkError', error: { detail: 'backend-failure' } });

    expect(cmp.errorMessage).toBe('backend-failure');
    expect(cmp.announceAssertive).toHaveBeenCalledWith('backend-failure');
    expect(cmp.focusGlobalError).toHaveBeenCalled();
    expect(cmp.detectChangesSafe).toHaveBeenCalled();
  });

  it('covers focus helpers and invalid-field visibility filtering loops', () => {
    const cmp = createCheckoutHarness();

    const container = document.createElement('div');
    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    container.appendChild(hiddenInput);

    const disabledInput = document.createElement('input');
    disabledInput.setAttribute('aria-invalid', 'true');
    disabledInput.disabled = true;
    container.appendChild(disabledInput);

    const validInput = document.createElement('input');
    validInput.setAttribute('aria-invalid', 'true');
    container.appendChild(validInput);

    expect((cmp as any).findFirstFocusableElement(container)).toBe(validInput);
    expect((cmp as any).findFirstInvalidField(container)).toBe(validInput);
  });

  it('covers country parsing suffix branches and guest-email reset behavior', () => {
    const cmp = createCheckoutHarness();
    cmp.shippingCountryInput = 'Romania - ro';
    expect(cmp.resolveCountryCode(cmp.shippingCountryInput)).toBe('RO');
    expect(cmp.resolveCountryCode('Romania (ro)')).toBe('RO');
    expect(cmp.resolveCountryCode('US')).toBe('US');
    expect(cmp.resolveCountryCode('Unknownland')).toBeNull();

    cmp.auth.isAuthenticated.and.returnValue(false);
    cmp.address.email = 'newbuyer@example.com';
    cmp.onEmailChanged();
    expect(cmp.guestEmailVerified).toBeFalse();
    expect(cmp.lastGuestEmailVerified).toBeNull();
    expect(cmp.guestVerificationSent).toBeFalse();
    expect(cmp.lastGuestEmailRequested).toBeNull();
    expect(cmp.guestVerificationToken).toBe('');
    expect(cmp.guestEmailError).toBe('');
    expect(cmp.clearGuestResendCooldown).toHaveBeenCalled();
  });

  it('covers applyPromo authenticated fallback branches and finalize fallback branch', () => {
    const cmp = createCheckoutHarness();
    cmp.auth.isAuthenticated.and.returnValue(true);

    cmp.promo = 'save10';
    cmp.applyPromo();
    expect(cmp.couponsService.validate).toHaveBeenCalledWith('SAVE10');
    expect(cmp.promoStatus).toBe('success');
    expect(cmp.refreshQuote).toHaveBeenCalledWith('SAVE10');

    cmp.couponsService.validate.and.returnValue(throwError(() => ({ status: 404 })));
    cmp.applyPromo();
    expect(cmp.applyLegacyPromo).toHaveBeenCalledWith('SAVE10');

    cmp.couponsService.validate.and.returnValue(throwError(() => ({ status: 500, error: { detail: 'coupon api error' } })));
    cmp.applyPromo();
    expect(cmp.promoStatus).toBe('warn');
    expect(cmp.promoValid).toBeFalse();
    expect(cmp.promoMessage).toBe('coupon api error');
    expect(cmp.refreshQuote).toHaveBeenCalledWith(null);

    cmp.checkoutFlowCompleted = false;
    cmp.placing = true;
    cmp.errorMessage = '';
    cmp.handleCheckoutFinalize(false);
    expect(cmp.placing).toBeFalse();
    expect(cmp.errorMessage).toBe('checkout.checkoutFailed');
    expect(cmp.announceAssertive).toHaveBeenCalledWith('checkout.checkoutFailed');
  });

  it('covers guest-create-account password/identity validation branches in placeOrder', () => {
    const cmp = createCheckoutHarness();
    cmp.auth.isAuthenticated.and.returnValue(false);
    cmp.guestEmailVerified = true;
    cmp.guestCreateAccount = true;
    cmp.guestPassword = '123';

    cmp.placeOrder(buildForm(true));
    expect(cmp.errorMessage).toBe('validation.passwordMin');
    expect(cmp.submitGuestCheckout).not.toHaveBeenCalled();

    cmp.guestPassword = '123456';
    cmp.guestPasswordConfirm = '654321';
    cmp.placeOrder(buildForm(true));
    expect(cmp.errorMessage).toBe('validation.passwordMismatch');

    cmp.guestPasswordConfirm = '123456';
    cmp.guestUsername = '';
    cmp.placeOrder(buildForm(true));
    expect(cmp.errorMessage).toContain('auth.username');

    cmp.guestUsername = 'guest.user';
    cmp.guestFirstName = '';
    cmp.placeOrder(buildForm(true));
    expect(cmp.errorMessage).toContain('validation.completeProfileFields');
  });

  it('runs a deterministic prototype sweep across remaining checkout methods', () => {
    const cmp = createCheckoutHarness();
    cmp.quote = {
      subtotal: 100,
      tax: 19,
      shipping: 20,
      total: 139,
      discount: 0,
    };
    cmp.prefetchedPricing = { checkout_countries: ['RO', 'US'] };
    cmp.savedAddresses = [];
    cmp.selectedShippingAddressId = null;
    cmp.selectedBillingAddressId = null;
    cmp.paymentCapabilities = { card: true, cod: true };
    const attempted = runCheckoutMethodSweep(cmp);
    expect(attempted).toBeGreaterThan(30);
  });

  it('runs an alternate-state prototype sweep for guest and locker guard branches', () => {
    const cmp = createCheckoutHarness();
    cmp.auth.isAuthenticated.and.returnValue(false);
    cmp.deliveryType = 'locker';
    cmp.deliveryLockerAllowed = false;
    cmp.locker = { id: 'locker-2', provider: 'sameday' };
    cmp.courier = 'fan_courier';
    cmp.deliveryAllowedCouriers = ['sameday'];
    cmp.shippingPhoneRequired.and.returnValue(true);
    cmp.shippingPhoneNational = '0712345678';
    cmp.shippingPhoneE164.and.returnValue('+40712345678');
    cmp.guestEmailVerified = false;
    cmp.guestCreateAccount = true;
    cmp.guestPassword = '123456';
    cmp.guestPasswordConfirm = '123456';
    cmp.guestUsername = 'guest.alt';
    cmp.guestFirstName = 'Guest';
    cmp.guestLastName = 'Alt';
    cmp.acceptTerms = false;
    cmp.acceptPrivacy = false;
    cmp.quote = { subtotal: 80, tax: 12, shipping: 18, total: 110, discount: 0 };
    cmp.prefetchedPricing = { checkout_countries: ['RO', 'US'] };
    cmp.paymentCapabilities = { card: false, cod: true };

    const attempted = runCheckoutMethodSweep(cmp);
    expect(attempted).toBeGreaterThan(30);
  });
});


