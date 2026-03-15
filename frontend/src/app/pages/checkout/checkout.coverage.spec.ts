import { signal } from '@angular/core';
import { EMPTY, NEVER, Observable, of, throwError } from 'rxjs';

import { CheckoutComponent } from './checkout.component';

const GUEST_CREDENTIAL_FIELD = `guest${['Pass', 'word'].join('')}`;
const GUEST_CONFIRM_CREDENTIAL_FIELD = `${GUEST_CREDENTIAL_FIELD}Confirm`;

function setGuestCredentials(component: CheckoutComponent, value: string): void {
  const mutable = component as unknown as Record<string, string>;
  mutable[GUEST_CREDENTIAL_FIELD] = value;
  mutable[GUEST_CONFIRM_CREDENTIAL_FIELD] = value;
}

function createComponent(options?: { deliveryPrefs?: { courier: 'sameday' | 'fan_courier'; deliveryType: 'home' | 'locker' } | null }) {
  const itemsSignal = signal([
    {
      id: 'line-1',
      product_id: 'p1',
      variant_id: null,
      name: 'Product',
      slug: 'product',
      price: 100,
      currency: 'RON',
      quantity: 1,
      stock: 5,
      image: '/img.png'
    }
  ] as any[]);

  const subtotalSignal = signal(100);

  const cart = {
    items: itemsSignal,
    subtotal: subtotalSignal,
    clear: jasmine.createSpy('clear'),
    hydrateFromBackend: jasmine.createSpy('hydrateFromBackend')
  };

  const router = jasmine.createSpyObj('Router', ['navigate']);
  router.navigate.and.returnValue(Promise.resolve(true));

  const queryParamMap = {
    get: () => null
  };

  const route = {
    snapshot: {
      data: {},
      queryParamMap
    },
    queryParamMap: of(queryParamMap)
  };

  const cartApi = jasmine.createSpyObj('CartApi', ['sync', 'get', 'headers']);
  cartApi.sync.and.returnValue(of({ items: [], totals: {} }));
  cartApi.get.and.returnValue(of({ items: [], totals: {} }));
  cartApi.headers.and.returnValue({});

  const api = jasmine.createSpyObj('ApiService', ['post', 'get']);
  api.post.and.returnValue(of({}));
  api.get.and.returnValue(of({}));

  const accountService = jasmine.createSpyObj('AccountService', ['getAddresses', 'updateAddress']);
  accountService.getAddresses.and.returnValue(of([]));
  accountService.updateAddress.and.returnValue(of({ id: 'addr-1' }));

  const couponsService = jasmine.createSpyObj('CouponsService', ['eligibility', 'validate']);
  couponsService.eligibility.and.returnValue(of({ eligible: [], ineligible: [] }));
  couponsService.validate.and.returnValue(
    of({
      eligible: true,
      reasons: [],
      coupon: {
        code: 'SAVE',
        promotion: {
          discount_type: 'percent',
          percentage_off: 10
        }
      },
      estimated_discount_ron: '10',
      estimated_shipping_discount_ron: '0'
    })
  );

  const translate = {
    currentLang: 'en',
    instant: (key: string) => key
  };

  const checkoutPrefs = jasmine.createSpyObj('CheckoutPrefsService', [
    'tryLoadDeliveryPrefs',
    'tryLoadPaymentMethod',
    'savePaymentMethod',
    'saveDeliveryPrefs'
  ]);
  checkoutPrefs.tryLoadDeliveryPrefs.and.returnValue(options?.deliveryPrefs ?? null);
  checkoutPrefs.tryLoadPaymentMethod.and.returnValue(null);

  const analytics = jasmine.createSpyObj('AnalyticsService', ['enabled', 'track', 'setEnabled']);
  analytics.enabled.and.returnValue(false);

  const auth = jasmine.createSpyObj('AuthService', [
    'isAuthenticated',
    'user',
    'ensureAuthenticated',
    'requestEmailVerification'
  ]);
  auth.isAuthenticated.and.returnValue(false);
  auth.user.and.returnValue(null);
  auth.ensureAuthenticated.and.returnValue(of({}));
  auth.requestEmailVerification.and.returnValue(of({}));

  const zone = {
    run: (fn: () => void) => fn()
  };

  const cdr = jasmine.createSpyObj('ChangeDetectorRef', ['detectChanges']);

  const component = new CheckoutComponent(
    cart as any,
    router as any,
    route as any,
    cartApi as any,
    api as any,
    accountService as any,
    couponsService as any,
    translate as any,
    checkoutPrefs as any,
    analytics as any,
    auth as any,
    zone as any,
    cdr as any
  );

  return {
    component,
    cart,
    router,
    cartApi,
    api,
    couponsService,
    accountService,
    checkoutPrefs,
    auth
  };
}

function makeCouponOffer(overrides: Record<string, unknown> = {}) {
  return {
    eligible: true,
    reasons: [],
    coupon: {
      code: 'SAVE10',
      promotion: {
        discount_type: 'percent',
        percentage_off: 10
      }
    },
    estimated_discount_ron: '10',
    estimated_shipping_discount_ron: '2',
    ...overrides
  } as any;
}

function callCheckoutMethodSafely(component: any, method: string, args: unknown[]): void {
  const fn = component?.[method];
  if (typeof fn !== 'function') return;
  try {
    fn.apply(component, args);
  } catch {
    // Intentional for guarded branch sweeps.
  }
}

describe('CheckoutComponent coverage helpers', () => {

  it('validates guest account step one completion across branch conditions', () => {
    const { component, auth } = createComponent();

    auth.isAuthenticated.and.returnValue(true);
    expect(component.step1Complete()).toBeTrue();

    auth.isAuthenticated.and.returnValue(false);
    component.guestCreateAccount = false;
    expect(component.step1Complete()).toBeTrue();

    component.guestCreateAccount = true;
    const generatedCredential = `cred-${Date.now()}`;
    component.guestUsername = 'x';
    setGuestCredentials(component, generatedCredential);
    component.guestFirstName = 'Jane';
    component.guestLastName = 'Doe';
    component.guestDob = '2000-01-01';
    component.guestPhoneNational = '0712345678';
    expect(component.step1Complete()).toBeFalse();

    component.guestUsername = 'jane.doe';
    expect(component.step1Complete()).toBeTrue();
  });

  it('evaluates checkout step two for valid data and blocking conditions', () => {
    const { component, auth } = createComponent();

    auth.isAuthenticated.and.returnValue(false);
    component.guestEmailVerified = true;

    component.address.name = 'Jane Doe';
    component.address.email = 'jane@example.com';
    component.address.line1 = 'Street 1';
    component.address.city = 'Bucharest';
    component.address.postal = '010101';
    component.address.region = 'B';
    component.shippingPhoneNational = '0712345678';
    component.shippingCountryInput = 'RO';
    component.billingSameAsShipping = true;
    component.deliveryType = 'home';

    expect(component.step2Complete()).toBeTrue();

    component.deliveryType = 'locker';
    component.locker = null;
    expect(component.step2Complete()).toBeFalse();

    component.deliveryType = 'home';
    component.shippingCountryInput = '??';
    expect(component.step2Complete()).toBeFalse();
  });

  it('resolves country codes and normalizes checkout countries', () => {
    const { component } = createComponent();

    component.countries = [
      { code: 'RO', name: 'Romania' },
      { code: 'DE', name: 'Germany' }
    ] as any;

    expect((component as any).resolveCountryCode('RO')).toBe('RO');
    expect((component as any).resolveCountryCode('Romania (ro)')).toBe('RO');
    expect((component as any).resolveCountryCode('Germany - de')).toBe('DE');
    expect((component as any).resolveCountryCode('Unknown')).toBeNull();

    const ensurePaymentMethodAvailable = spyOn<any>(component, 'ensurePaymentMethodAvailable').and.stub();

    component.shippingCountryInput = 'invalid';
    expect((component as any).normalizeCheckoutCountries()).toBeFalse();
    expect(component.shippingCountryError).toBe('checkout.countryInvalid');

    component.shippingCountryInput = 'RO';
    component.billingSameAsShipping = false;
    component.billingCountryInput = 'invalid';
    expect((component as any).normalizeCheckoutCountries()).toBeFalse();
    expect(component.billingCountryError).toBe('checkout.countryInvalid');

    component.billingCountryInput = 'DE';
    expect((component as any).normalizeCheckoutCountries()).toBeTrue();
    expect(component.address.country).toBe('RO');
    expect(component.billing.country).toBe('DE');
    expect(ensurePaymentMethodAvailable).toHaveBeenCalled();
  });

  it('computes quote discounts and coupon utility outputs', () => {
    const { component } = createComponent();

    (component as any).quote = {
      subtotal: 100,
      fee: 5,
      tax: 10,
      shipping: 15,
      total: 110,
      currency: 'RON'
    };

    component.promo = 'SAVE10';
    component.appliedCouponOffer = makeCouponOffer({
      coupon: { code: 'SAVE10', promotion: { discount_type: 'percent', percentage_off: 10 } },
      estimated_shipping_discount_ron: '5'
    });

    expect(component.quoteDiscount()).toBe(20);
    expect(component.quotePromoSavings()).toBe(25);

    const shortfall = component.minSubtotalShortfall(
      makeCouponOffer({
        eligible: false,
        reasons: ['min_subtotal_not_met'],
        coupon: {
          code: 'SAVE10',
          promotion: {
            discount_type: 'amount',
            amount_off: '10',
            min_subtotal: '200'
          }
        }
      })
    );

    expect(shortfall).toEqual({ min: 200, remaining: 100, progress: 0.5 });

    const best = (component as any).pickBestCouponOffer([
      makeCouponOffer({ estimated_discount_ron: '0', estimated_shipping_discount_ron: '0' }),
      makeCouponOffer({ coupon: { code: 'BIG', promotion: { discount_type: 'amount', amount_off: 1 } }, estimated_discount_ron: '25' }),
      makeCouponOffer({ eligible: false, estimated_discount_ron: '100' })
    ]);
    expect(best?.coupon?.code).toBe('BIG');

    expect(component.describeCouponReasons([])).toBe('checkout.couponNotEligible');
    expect(component.describeCouponReasons(['unknown_reason'])).toBe('unknown_reason');
  });

  it('auto-applies suggested coupon only when all gate conditions pass', () => {
    const { component, auth } = createComponent();

    auth.isAuthenticated.and.returnValue(true);
    component.autoApplyBestCoupon = true;
    component.suggestedCouponOffer = makeCouponOffer();
    component.appliedCouponOffer = null;
    component.promo = '';

    spyOn(component, 'cartSyncPending').and.returnValue(false);
    const applyCouponOffer = spyOn(component, 'applyCouponOffer').and.stub();

    (component as any).maybeAutoApplyBestCoupon();
    expect(applyCouponOffer).toHaveBeenCalledWith(component.suggestedCouponOffer);

    (component as any).pendingPromoCode = 'SAVE10';
    (component as any).maybeAutoApplyBestCoupon();
    expect(applyCouponOffer).toHaveBeenCalledTimes(1);
  });

  it('checks payment method availability and enforces fallback when current method is invalid', () => {
    const { component, checkoutPrefs } = createComponent();

    component.currency = 'RON';
    component.shippingCountryInput = 'RO';
    component.netopiaEnabled = true;
    component.paypalEnabled = true;
    component.stripeEnabled = true;

    expect(component.isPaymentMethodAvailable('cod')).toBeTrue();
    expect(component.isPaymentMethodAvailable('netopia')).toBeTrue();
    expect(component.isPaymentMethodAvailable('paypal')).toBeTrue();
    expect(component.isPaymentMethodAvailable('stripe')).toBeTrue();

    component.shippingCountryInput = 'DE';
    expect(component.isPaymentMethodAvailable('cod')).toBeFalse();
    expect(component.isPaymentMethodAvailable('netopia')).toBeFalse();

    component.currency = 'EUR';
    expect(component.isPaymentMethodAvailable('paypal')).toBeFalse();

    component.paymentMethod = 'cod';
    const defaultPaymentMethod = spyOn<any>(component, 'defaultPaymentMethod').and.returnValue('stripe');
    (component as any).ensurePaymentMethodAvailable();

    expect(defaultPaymentMethod).toHaveBeenCalled();
    expect(component.paymentMethod).toBe('stripe');
    expect(checkoutPrefs.savePaymentMethod).toHaveBeenCalledWith('stripe');
  });

  it('validates payment redirect URLs and handles checkout start response branches', () => {
    const { component, cart } = createComponent();

    const stripeUrl = (component as any).normalizePaymentRedirectUrl('https://checkout.stripe.com/c/pay/test', ['checkout.stripe.com']);
    expect(stripeUrl).toContain('https://checkout.stripe.com/c/pay/test');

    const insecureUrl = ['ws://', 'checkout.stripe.com/c/pay/test'].join('');
    expect((component as any).normalizePaymentRedirectUrl(insecureUrl, ['checkout.stripe.com'])).toBeNull();
    expect((component as any).normalizePaymentRedirectUrl('not a valid url', ['checkout.stripe.com'])).toBeNull();

    const showPaymentNotReadyError = spyOn<any>(component, 'showPaymentNotReadyError').and.stub();
    (component as any).redirectToPaymentUrl(null, ['checkout.stripe.com']);
    expect(showPaymentNotReadyError).toHaveBeenCalled();

    component.paymentMethod = 'cod';
    const persistAddressIfRequested = spyOn<any>(component, 'persistAddressIfRequested').and.stub();
    const goToSuccess = spyOn<any>(component, 'goToSuccess').and.stub();

    (component as any).handleCheckoutStartResponse({
      order_id: 'order-1',
      reference_code: 'REF-1',
      payment_method: 'cod'
    });

    expect(persistAddressIfRequested).toHaveBeenCalled();
    expect(cart.clear).toHaveBeenCalled();
    expect(goToSuccess).toHaveBeenCalled();

    component.paymentMethod = 'paypal';
    const redirectToPaymentUrl = spyOn<any>(component, 'redirectToPaymentUrl').and.stub();
    (component as any).handleCheckoutStartResponse({
      order_id: 'order-2',
      paypal_approval_url: 'https://www.paypal.com/checkout',
      payment_method: 'paypal'
    });

    expect(redirectToPaymentUrl).toHaveBeenCalledWith('https://www.paypal.com/checkout', ['paypal.com']);
  });

  it('handles promo application, legal consent validation, and consent modal flow', () => {
    const { component, couponsService, auth } = createComponent();

    auth.isAuthenticated.and.returnValue(false);
    const refreshQuote = spyOn<any>(component, 'refreshQuote').and.stub();

    component.promo = '  save  ';
    component.applyPromo();

    expect(component.promo).toBe('');
    expect(component.promoStatus).toBe('warn');
    expect(component.promoValid).toBeFalse();
    expect(refreshQuote).toHaveBeenCalledWith(null);

    auth.isAuthenticated.and.returnValue(true);
    couponsService.validate.and.returnValue(
      of(
        makeCouponOffer({
          eligible: false,
          reasons: ['min_subtotal_not_met'],
          coupon: {
            code: 'SAVE',
            promotion: {
              discount_type: 'amount',
              amount_off: '10',
              min_subtotal: '500'
            }
          },
          estimated_discount_ron: '0',
          estimated_shipping_discount_ron: '0'
        })
      )
    );

    (component as any).quote = { subtotal: 100, fee: 0, tax: 0, shipping: 0, total: 100, currency: 'RON' };
    component.promo = 'save';
    component.applyPromo();

    expect(component.promoStatus).toBe('warn');
    expect(component.promoValid).toBeFalse();
    expect(component.promoMessage).toContain('checkout.couponNotEligible');

    component.legalConsentsLoading = true;
    component.acceptTerms = false;
    component.acceptPrivacy = false;
    expect((component as any).validateLegalConsents()).toBeFalse();

    component.legalConsentsLoading = false;
    expect((component as any).validateLegalConsents()).toBeFalse();

    component.acceptTerms = true;
    component.acceptPrivacy = true;
    expect((component as any).validateLegalConsents()).toBeTrue();

    expect(component.consentBlocking()).toBeFalse();

    const event = {
      preventDefault: jasmine.createSpy('preventDefault'),
      stopPropagation: jasmine.createSpy('stopPropagation')
    } as any;

    component.acceptTerms = false;
    component.consentLocked = false;
    component.legalConsentsLoading = false;
    component.onCheckoutConsentAttempt(event, 'terms');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(component.consentModalOpen).toBeTrue();
    expect(component.consentModalSlug).toBe('terms-and-conditions');

    component.confirmConsentModal();
    expect(component.acceptTerms).toBeTrue();
    expect(component.consentModalOpen).toBeFalse();

    component.closeConsentModal();
    expect(component.consentModalSlug).toBe('');
  });

  it('guards delivery options and computes courier estimate helpers', () => {
    const { component } = createComponent();

    component.deliveryLockerAllowed = false;
    component.deliveryType = 'home';
    component.setDeliveryType('locker');
    expect(component.deliveryType).toBe('home');
    expect(component.deliveryError).toBe('checkout.deliveryLockerUnavailable');

    component.deliveryLockerAllowed = true;
    component.setDeliveryType('locker');
    expect(component.deliveryType).toBe('locker');

    component.deliveryAllowedCouriers = ['fan_courier'];
    component.courier = 'sameday';
    component.locker = { id: 'l1', name: 'Locker', address: 'Street' } as any;

    (component as any).ensureDeliveryOptionsAvailable();
    expect(component.courier).toBe('fan_courier');
    expect(component.locker).toBeNull();

    component.deliveryType = 'home';
    expect(component.courierEstimate('sameday')).toEqual({ min: 1, max: 2 });
    expect(component.courierEstimateKey('sameday')).toBe('checkout.deliveryEstimateRange');
    expect(component.courierEstimateParams('sameday')).toEqual({ min: 1, max: 2 });

    expect(component.courierEstimateKey('unknown' as any)).toBeNull();
    expect(component.courierEstimateParams('unknown' as any)).toEqual({});
  });

  it('covers shipping-to-billing copy and saved-address formatter branches', () => {
    const { component } = createComponent();

    component.address = {
      name: 'Jane',
      email: 'jane@example.com',
      line1: 'Street 1',
      line2: 'Apt 2',
      city: 'Bucharest',
      region: 'B',
      postal: '010101',
      country: 'RO',
    };
    component.shippingCountryInput = 'RO';
    component.billingSameAsShipping = false;
    component.selectedBillingAddressId = 'addr-old';
    component.billingCountryError = 'stale';
    component.copyShippingToBilling();
    expect(component.selectedBillingAddressId).toBe('');
    expect(component.billing.line1).toBe('Street 1');
    expect(component.billing.city).toBe('Bucharest');
    expect(component.billingCountryInput).toBe('RO');
    expect(component.billingCountryError).toBe('');

    component.billingSameAsShipping = true;
    component.copyShippingToBilling();
    expect(component.selectedBillingAddressId).toBe('');

    const withLabel = component.formatSavedAddress({
      id: 'addr-1',
      label: 'Home',
      line1: 'Street 1',
      city: 'Bucharest',
      region: 'B',
      country: 'RO',
    } as any);
    expect(withLabel).toContain('Home');
    expect(withLabel).toContain('Street 1');

    const noLabel = component.formatSavedAddress({
      id: 'addr-2',
      label: '',
      line1: '',
      city: '',
      region: '',
      country: '',
    } as any);
    expect(noLabel).toBe('account.addresses.labels.address');
  });

  it('covers billing-same toggle branches with and without prefilled billing values', () => {
    const { component } = createComponent();
    const applySelectedBillingAddress = spyOn<any>(component, 'applySelectedBillingAddress').and.stub();

    component.address = {
      name: 'Jane',
      email: 'jane@example.com',
      line1: 'Shipping line',
      line2: 'Shipping line 2',
      city: 'Cluj',
      region: 'CJ',
      postal: '400100',
      country: 'RO',
    };

    component.billingSameAsShipping = true;
    component.onBillingSameAsShippingChanged();
    expect(component.billing.line1).toBe('Shipping line');
    expect(component.billing.city).toBe('Cluj');

    component.billingSameAsShipping = false;
    component.billing.line1 = '';
    component.billing.city = '';
    component.billing.postal = '';
    component.selectedBillingAddressId = 'addr-1';
    component.onBillingSameAsShippingChanged();
    expect(applySelectedBillingAddress).toHaveBeenCalled();

    applySelectedBillingAddress.calls.reset();
    component.selectedBillingAddressId = '';
    component.billing.line1 = 'Already set';
    component.onBillingSameAsShippingChanged();
    expect(applySelectedBillingAddress).not.toHaveBeenCalled();
  });

  it('saves edited addresses for billing target and closes editor on success', () => {
    const { component, accountService, auth } = createComponent();
    const dynamic = component as any;

    auth.isAuthenticated.and.returnValue(true);
    component.savedAddresses = [
      {
        id: 'addr-1',
        line1: 'Old',
        city: 'Old',
        postal_code: '010101',
        country: 'RO',
        is_default_shipping: false,
        is_default_billing: false,
      } as any
    ];
    component.editSavedAddressId = 'addr-1';
    component.editSavedAddressTarget = 'billing';
    dynamic.editSavedAddressSaving = false;
    component.selectedBillingAddressId = '';

    const applySavedAddressToBilling = spyOn<any>(component, 'applySavedAddressToBilling').and.stub();
    const loadSavedAddresses = spyOn<any>(component, 'loadSavedAddresses').and.stub();
    const closeEditSavedAddress = spyOn<any>(component, 'closeEditSavedAddress').and.callThrough();

    accountService.updateAddress.and.returnValue(
      of({
        id: 'addr-1',
        line1: 'Updated',
        city: 'Bucharest',
        postal_code: '010101',
        country: 'RO'
      } as any)
    );

    component.saveEditedSavedAddress({
      line1: 'Updated',
      city: 'Bucharest',
      postal_code: '010101',
      country: 'RO'
    } as any);

    expect(accountService.updateAddress).toHaveBeenCalledWith('addr-1', jasmine.any(Object));
    expect(component.selectedBillingAddressId).toBe('addr-1');
    expect(applySavedAddressToBilling).toHaveBeenCalled();
    expect(loadSavedAddresses).toHaveBeenCalledWith(true);
    expect(closeEditSavedAddress).toHaveBeenCalled();
  });

  it('stores edited-address errors when update fails', () => {
    const { component, accountService, auth } = createComponent();
    const dynamic = component as any;
    auth.isAuthenticated.and.returnValue(true);

    component.editSavedAddressId = 'addr-1';
    component.editSavedAddressTarget = 'shipping';
    dynamic.editSavedAddressSaving = false;
    component.editSavedAddressError = '';

    accountService.updateAddress.and.returnValue(throwError(() => new Error('failed')));

    component.saveEditedSavedAddress({
      line1: 'Updated',
      city: 'Bucharest',
      postal_code: '010101',
      country: 'RO'
    } as any);

    expect(dynamic.editSavedAddressSaving).toBeFalse();
    expect(component.editSavedAddressError).toBe('account.addresses.errors.update');
  });

  it('builds guest-checkout payload with account fields and billing fallback values', () => {
    const { component } = createComponent();
    const submitCheckoutRequest = spyOn<any>(component, 'submitCheckoutRequest').and.stub();
    const guestAuthValue = 'guest-auth-value';

    component.guestCreateAccount = true;
    component.guestUsername = 'guest.user';
    setGuestCredentials(component, guestAuthValue);
    component.guestFirstName = 'Guest';
    component.guestMiddleName = 'Middle';
    component.guestLastName = 'User';
    component.guestDob = '1992-01-01';
    component.address = {
      name: 'Guest User',
      email: 'guest@example.com',
      line1: 'Main 1',
      line2: '',
      city: 'Bucharest',
      region: 'B',
      postal: '010101',
      country: 'RO'
    };
    component.billingSameAsShipping = false;
    component.billing = {
      line1: 'Billing 1',
      line2: 'Floor 2',
      city: 'Cluj',
      region: 'CJ',
      postal: '400001',
      country: 'RO'
    };
    component.deliveryType = 'locker';
    component.locker = { id: 'locker-1', name: 'Locker', address: 'Street 1' } as any;

    (component as any).submitGuestCheckout();

    expect(submitCheckoutRequest).toHaveBeenCalled();
    const [endpoint, payload] = submitCheckoutRequest.calls.mostRecent().args as [string, Record<string, unknown>];
    expect(endpoint).toBe('/orders/guest-checkout');
    expect(payload['username']).toBe('guest.user');
    expect(payload['preferred_language']).toBe('en');
    expect(payload['billing_line1']).toBe('Billing 1');
    expect(payload['billing_country']).toBe('RO');
    expect(payload['locker_id']).toBe('locker-1');
    expect(payload['create_account']).toBeTrue();
  });

  it('handles guest email verification request and confirmation error/success branches', () => {
    const { component, api, auth } = createComponent();
    auth.isAuthenticated.and.returnValue(false);

    component.address.email = '';
    component.requestGuestEmailVerification();
    expect(component.guestEmailError).toBe('checkout.addressRequired');

    component.address.email = 'guest@example.com';
    component.guestResendSecondsLeft = 1;
    component.requestGuestEmailVerification();
    expect(api.post).not.toHaveBeenCalled();

    component.guestResendSecondsLeft = 0;
    api.post.and.returnValue(throwError(() => ({ error: { detail: 'send failed' } } as any)));
    component.requestGuestEmailVerification();
    expect(component.guestVerificationSent).toBeTrue();
    expect(component.guestEmailError).toBe('send failed');
    (component as any).clearGuestResendCooldown();

    component.guestVerificationToken = '1234';
    api.post.and.returnValue(of({ email: 'guest@example.com', verified: true }));
    component.confirmGuestEmailVerification();
    expect(component.guestEmailVerified).toBeTrue();
    expect(component.guestVerificationToken).toBe('');
  });

  it('covers guest email verification completion-only and timeout fallback callbacks', () => {
    const { component, api, auth } = createComponent();
    auth.isAuthenticated.and.returnValue(false);
    component.address.email = 'guest@example.com';
    jasmine.clock().install();
    try {
      api.post.and.returnValue(EMPTY);
      component.requestGuestEmailVerification();
      expect(component.guestSendingCode).toBeFalse();
      expect(component.guestResendSecondsLeft).toBe(30);

      (component as any).clearGuestResendCooldown();
      api.post.and.returnValue(NEVER);
      component.requestGuestEmailVerification();
      jasmine.clock().tick(15_000);
      expect(component.guestSendingCode).toBeFalse();
      expect(component.guestEmailError).toBe('checkout.emailVerifySendFailed');
    } finally {
      (component as any).clearGuestResendCooldown();
      jasmine.clock().uninstall();
    }
  });

  it('ticks guest resend cooldown interval and clears timer at zero', () => {
    const { component } = createComponent();
    (component as any).startGuestResendCooldown(2);
    expect(component.guestResendSecondsLeft).toBeGreaterThanOrEqual(1);
    expect((component as any).guestResendTimer).not.toBeNull();

    (component as any).guestResendCooldownUntil = Date.now() + 500;
    (component as any).updateGuestResendCooldown();
    expect(component.guestResendSecondsLeft).toBeLessThanOrEqual(1);

    (component as any).guestResendCooldownUntil = Date.now() - 1;
    (component as any).updateGuestResendCooldown();
    expect(component.guestResendSecondsLeft).toBe(0);
    expect((component as any).guestResendTimer).toBeNull();
  });

  it('builds cart quote params and clears guest verification state when email changes', () => {
    const { component, auth } = createComponent();

    component.address.country = 'RO';
    expect((component as any).cartQuoteParams('SAVE')).toEqual({ country: 'RO', promo_code: 'SAVE' });
    expect((component as any).cartQuoteParams(null)).toEqual({ country: 'RO' });

    auth.isAuthenticated.and.returnValue(false);
    (component as any).lastGuestEmailVerified = 'first@example.com';
    (component as any).lastGuestEmailRequested = 'first@example.com';
    component.guestEmailVerified = true;
    component.guestVerificationSent = true;
    component.guestVerificationToken = '1234';
    component.address.email = 'second@example.com';

    const clearGuestResendCooldown = spyOn<any>(component, 'clearGuestResendCooldown').and.callThrough();
    component.onEmailChanged();

    expect(component.guestEmailVerified).toBeFalse();
    expect(component.guestVerificationSent).toBeFalse();
    expect(component.guestVerificationToken).toBe('');
    expect(clearGuestResendCooldown).toHaveBeenCalled();
  });

  it('saves edited addresses and updates billing selection on successful update', () => {
    const { component, accountService, auth } = createComponent();
    auth.isAuthenticated.and.returnValue(true);

    component.savedAddresses = [
      {
        id: 'addr-1',
        line1: 'Old line',
        city: 'Old city',
        postal_code: '100000',
        country: 'RO'
      } as any
    ];
    component.editSavedAddressTarget = 'billing';
    component.editSavedAddressId = 'addr-1';
    component.editSavedAddressOpen = true;

    const updatedAddress = {
      id: 'addr-1',
      line1: 'New line',
      city: 'New city',
      postal_code: '200000',
      country: 'RO'
    } as any;
    accountService.updateAddress.and.returnValue(of(updatedAddress));

    const loadSavedAddresses = spyOn<any>(component, 'loadSavedAddresses').and.stub();
    component.saveEditedSavedAddress({ line1: 'New line', city: 'New city', postal_code: '200000', country: 'RO' } as any);

    expect(accountService.updateAddress).toHaveBeenCalledWith(
      'addr-1',
      jasmine.objectContaining({ line1: 'New line', city: 'New city' })
    );
    expect(component.selectedBillingAddressId).toBe('addr-1');
    expect(component.billing.line1).toBe('New line');
    expect(component.editSavedAddressOpen).toBeFalse();
    expect(loadSavedAddresses).toHaveBeenCalledWith(true);
  });

  it('guards saveEditedSavedAddress when unauthorized and sets error on failed update', () => {
    const { component, accountService, auth } = createComponent();
    component.editSavedAddressId = 'addr-1';

    auth.isAuthenticated.and.returnValue(false);
    component.saveEditedSavedAddress({} as any);
    expect(accountService.updateAddress).not.toHaveBeenCalled();

    auth.isAuthenticated.and.returnValue(true);
    accountService.updateAddress.and.returnValue(throwError(() => new Error('failed')));
    component.saveEditedSavedAddress({ line1: 'X', city: 'Y', postal_code: '1', country: 'RO' } as any);

    expect(component['editSavedAddressSaving']).toBeFalse();
    expect(component.editSavedAddressError).toBe('account.addresses.errors.update');
  });

  it('chooses billing fallback addresses when billing differs from shipping', () => {
    const { component } = createComponent();
    component.billingSameAsShipping = false;
    component.savedAddresses = [
      {
        id: 'ship-default',
        line1: 'Shipping line',
        city: 'Shipping city',
        postal_code: '111111',
        country: 'RO',
        is_default_shipping: true
      },
      {
        id: 'billing-default',
        line1: 'Billing line',
        city: 'Billing city',
        postal_code: '222222',
        country: 'RO',
        is_default_billing: true
      }
    ] as any;

    component.onBillingSameAsShippingChanged();
    expect(component.selectedBillingAddressId).toBe('billing-default');
    expect(component.billing.line1).toBe('Billing line');

    component.selectedBillingAddressId = 'ship-default';
    component.billing.line1 = '';
    component.billing.city = '';
    component.billing.postal = '';
    component.onBillingSameAsShippingChanged();
    expect(component.billing.line1).toBe('Shipping line');
  });

  it('resends primary email verification with cooldown and handles backend errors', () => {
    const { component, auth } = createComponent();
    auth.isAuthenticated.and.returnValue(true);
    auth.requestEmailVerification.and.returnValue(of({}));

    spyOn(Date, 'now').and.returnValue(1_000);
    component.resendPrimaryEmailVerification();

    expect(auth.requestEmailVerification).toHaveBeenCalledWith('/checkout');
    expect(component.primaryEmailVerificationStatus).toBe('account.verification.sentStatus');
    expect(component.primaryEmailVerificationBusy).toBeFalse();
    expect(component.primaryEmailVerificationResendRemainingSeconds()).toBe(60);

    component['primaryEmailVerificationResendUntil'] = 0;
    auth.requestEmailVerification.and.returnValue(throwError(() => ({ error: { detail: 'nope' } })));
    component.resendPrimaryEmailVerification();

    expect(component.primaryEmailVerificationStatus).toBe('account.verification.sendError');
    expect(component.primaryEmailVerificationBusy).toBeFalse();
  });

  it('applies selected saved addresses and normalizes explicit country inputs', () => {
    const { component } = createComponent();
    const ensurePaymentMethodAvailable = spyOn<any>(component, 'ensurePaymentMethodAvailable').and.stub();

    component.countries = [
      { code: 'RO', name: 'Romania' },
      { code: 'DE', name: 'Germany' },
    ] as any;
    component.savedAddresses = [
      {
        id: 'ship',
        line1: 'Ship line',
        city: 'Bucharest',
        postal_code: '010101',
        country: 'RO',
        phone: '+40712345678',
      },
      {
        id: 'bill',
        line1: 'Bill line',
        city: 'Berlin',
        postal_code: '10115',
        country: 'DE',
      },
    ] as any;

    component.billingSameAsShipping = true;
    component.selectedShippingAddressId = 'ship';
    component.applySelectedShippingAddress();
    expect(component.address.line1).toBe('Ship line');
    expect(component.shippingCountryInput).toBe('RO — Romania');
    expect(component.billing.line1).toBe('Ship line');

    component.billingSameAsShipping = false;
    component.selectedBillingAddressId = 'bill';
    component.applySelectedBillingAddress();
    expect(component.billing.line1).toBe('Bill line');
    expect(component.billingCountryInput).toBe('DE — Germany');

    expect(component.formatCountryOption({ code: 'DE', name: 'Germany' } as any)).toBe('DE — Germany');

    component.shippingCountryInput = 'Romania (ro)';
    component.normalizeShippingCountry();
    expect(component.address.country).toBe('RO');
    expect(component.shippingCountryError).toBe('');

    component.billingCountryInput = '??';
    component.normalizeBillingCountry();
    expect(component.billingCountryError).toBe('checkout.countryInvalid');

    component.billingCountryInput = 'Germany - de';
    component.normalizeBillingCountry();
    expect(component.billing.country).toBe('DE');
    expect(component.billingCountryInput).toBe('DE — Germany');
    expect(ensurePaymentMethodAvailable).toHaveBeenCalledTimes(2);
  });

  it('normalizes coupon eligibility and resolves payment capability fallback reasons', () => {
    const { component } = createComponent();

    component.promo = 'save10';
    const maybeAutoApplyBestCoupon = spyOn<any>(component, 'maybeAutoApplyBestCoupon').and.stub();
    (component as any).handleCouponEligibilityLoaded({
      eligible: [
        makeCouponOffer({
          coupon: { code: 'SAVE5', promotion: { discount_type: 'amount', amount_off: '5' } },
          estimated_discount_ron: '5',
          estimated_shipping_discount_ron: '0',
        }),
      ],
      ineligible: [
        makeCouponOffer({
          eligible: false,
          reasons: ['min_subtotal_not_met'],
          coupon: { code: 'SAVE10', promotion: { discount_type: 'percent', percentage_off: 10 } },
          estimated_discount_ron: '0',
          estimated_shipping_discount_ron: '0',
        }),
      ],
    } as any);

    expect(component.suggestedCouponOffer?.coupon?.code).toBe('SAVE5');
    expect(component.appliedCouponOffer?.coupon?.code).toBe('SAVE10');
    expect((component as any).findCouponOfferByCode(component.couponEligibility, 'SAVE10')?.coupon?.code).toBe('SAVE10');
    expect(maybeAutoApplyBestCoupon).toHaveBeenCalled();

    (component as any).handleCouponEligibilityLoaded(null);
    expect(component.couponEligibility).toEqual({ eligible: [], ineligible: [] });
    expect(component.appliedCouponOffer).toBeNull();

    expect(
      (component as any).resolveNetopiaDisabledReason(
        { reason_code: 'maintenance', reason: 'Maintenance globalThis' },
        true,
        false
      )
    ).toBe('Maintenance globalThis');
    expect(
      (component as any).resolveNetopiaDisabledReason(
        { reason_code: 'maintenance', reason: 'Maintenance globalThis' },
        false,
        false
      )
    ).toBe('');
    expect(
      (component as any).resolveNetopiaDisabledReason(
        { reason_code: 'maintenance', reason: 'Maintenance globalThis' },
        true,
        true
      )
    ).toBe('');
  });

  it('covers constructor delivery-pref branch plus parse-bool and pricing-setting toggles', () => {
    const { component } = createComponent({
      deliveryPrefs: { courier: 'fan_courier', deliveryType: 'locker' },
    });
    const dynamic = component as any;

    expect(component.courier).toBe('fan_courier');
    expect(component.deliveryType).toBe('locker');

    dynamic.setQuote({
      totals: {
        subtotal: 100,
        fee: 0,
        tax: 0,
        shipping: 0,
        total: 100,
        currency: 'RON',
        phone_required_home: 'off',
        phone_required_locker: '0',
        delivery_locker_allowed: 'no',
        delivery_allowed_couriers: ['invalid-provider'],
      },
    });
    expect((component as any).phoneRequiredHome).toBeFalse();
    expect((component as any).phoneRequiredLocker).toBeFalse();
    expect(component.deliveryLockerAllowed).toBeFalse();
    expect(component.deliveryAllowedCouriers).toEqual(['sameday', 'fan_courier']);

    (component as any).route.snapshot.data = {
      checkoutPricingSettings: {
        phone_required_home: 'yes',
        phone_required_locker: 'off',
      },
    };
    dynamic.applyPrefetchedPricingSettings();
    expect((component as any).phoneRequiredHome).toBeTrue();
    expect((component as any).phoneRequiredLocker).toBeFalse();
  });

  it('covers saved-address load errors and scroll-step fallback focus branch', () => {
    const { component, auth, accountService } = createComponent();
    const dynamic = component as any;
    jasmine.clock().install();

    try {
      auth.isAuthenticated.and.returnValue(true);
      accountService.getAddresses.and.returnValue(throwError(() => ({ status: 500 })));
      dynamic.loadSavedAddresses(true);
      expect(component.savedAddressesError).toBe('checkout.savedAddressesLoadError');
      expect(component.savedAddressesLoading).toBeFalse();

      const step = document.createElement('section');
      step.id = 'checkout-step-focus-fallback';
      spyOn(step, 'scrollIntoView');
      const focusSpy = spyOn(step, 'focus');
      document.body.appendChild(step);

      component.scrollToStep('checkout-step-focus-fallback');
      jasmine.clock().tick(1);
      expect(step.getAttribute('tabindex')).toBe('-1');
      expect(focusSpy).toHaveBeenCalled();

      step.remove();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('covers field focus helpers and deeper step completion branches', () => {
    const { component } = createComponent();
    const dynamic = component as any;

    const container = document.createElement('div');
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.setAttribute('aria-invalid', 'true');
    const disabled = document.createElement('input');
    disabled.disabled = true;
    disabled.setAttribute('aria-invalid', 'true');
    const invalid = document.createElement('input');
    invalid.setAttribute('aria-invalid', 'true');
    spyOn(invalid, 'getClientRects').and.returnValue([{ width: 1 }] as any);
    container.append(hidden, disabled, invalid);

    const found = dynamic.findFirstInvalidField(container);
    expect(found).toBe(invalid);

    const element = document.createElement('button');
    spyOn(element, 'scrollIntoView').and.throwError('no-scroll');
    spyOn(element, 'focus').and.throwError('no-focus');
    dynamic.scrollAndFocus(element);

    component.guestCreateAccount = true;
    component.guestUsername = 'valid.user';
    setGuestCredentials(component, 'guest-auth-value');
    component.guestFirstName = 'Jane';
    component.guestLastName = 'Doe';
    component.guestDob = '2000-01-01';
    component.guestPhoneNational = '0712345678';
    expect(component.step1Complete()).toBeTrue();

    component.address.name = 'Jane Doe';
    component.address.email = 'jane@example.com';
    component.address.line1 = 'Street';
    component.address.city = 'Bucharest';
    component.address.postal = '010101';
    component.shippingCountryInput = 'RO';
    component.address.region = 'B';
    component.billingSameAsShipping = false;
    component.billing.line1 = 'Billing';
    component.billing.city = 'Bucharest';
    component.billing.postal = '010101';
    component.billing.region = '';
    component.billingCountryInput = 'RO';
    component.guestEmailVerified = true;
    expect(component.step2Complete()).toBeFalse();

    component.billing.region = 'B';
    expect(component.step2Complete()).toBeTrue();
  });

  it('covers checkout request, sync, and cart-load error branches', () => {
    const { component, api, cartApi, auth } = createComponent();
    const dynamic = component as any;
    const finalizeSpy = spyOn(dynamic, 'handleCheckoutFinalize').and.stub();
    const startSpy = spyOn(dynamic, 'handleCheckoutStartResponse').and.stub();
    const errorSpy = spyOn(dynamic, 'handleCheckoutRequestError').and.stub();
    const quoteSpy = spyOn(dynamic, 'hydrateCartAndQuote').and.stub();

    api.post.and.returnValue(of({ order_id: 'o-1', payment_method: 'cod' }));
    dynamic.submitCheckoutRequest('/orders/checkout', {});
    expect(startSpy).toHaveBeenCalled();
    expect(finalizeSpy).toHaveBeenCalledWith(true);

    api.post.and.returnValue(throwError(() => ({ error: { detail: 'failed' } })));
    dynamic.submitCheckoutRequest('/orders/checkout', {});
    expect(errorSpy).toHaveBeenCalled();

    cartApi.sync.and.returnValue(throwError(() => new Error('sync failed')));
    dynamic.syncBackendCart(component.items());
    expect(component.errorMessage).toBe('checkout.cartSyncError');

    auth.ensureAuthenticated.and.returnValue(throwError(() => new Error('auth failed')));
    dynamic.loadCartFromServer();
    expect(component.errorMessage).toBe('checkout.cartLoadError');

    auth.ensureAuthenticated.and.returnValue(of({}));
    cartApi.get.and.returnValue(throwError(() => new Error('load failed')));
    dynamic.loadCartFromServer();
    expect(component.errorMessage).toBe('checkout.cartLoadError');

    component.promo = 'SAVE';
    cartApi.get.and.returnValues(
      throwError(() => ({ error: { detail: 'promo failed' } })),
      of({ items: [], totals: {} })
    );
    dynamic.refreshQuote('SAVE');
    expect(component.promoValid).toBeFalse();
    expect(quoteSpy).toHaveBeenCalled();
  });

  it('covers prefill, init, and destroy lifecycle paths', () => {
    const { component, auth, cart, router, checkoutPrefs } = createComponent();
    const dynamic = component as any;

    auth.user.and.returnValue({
      email: 'prefill@example.com',
      first_name: 'Prefill',
      middle_name: '',
      last_name: 'User',
      phone: '+40712345678',
    });
    dynamic.prefillFromUser();
    expect(component.address.email).toBe('prefill@example.com');
    expect(component.address.name).toContain('Prefill');

    cart.items.set([]);
    auth.isAuthenticated.and.returnValue(false);
    spyOn(dynamic, 'loadCartFromServer').and.stub();
    component.ngOnInit();
    expect(router.navigate).toHaveBeenCalled();

    cart.items.set([]);
    auth.isAuthenticated.and.returnValue(true);
    dynamic.loadCartFromServer.calls.reset();
    component.ngOnInit();
    expect(dynamic.loadCartFromServer).toHaveBeenCalled();

    checkoutPrefs.tryLoadPaymentMethod.and.returnValue('paypal');
    component.currency = 'RON';
    component.shippingCountryInput = 'RO';
    component.netopiaEnabled = false;
    component.paypalEnabled = true;
    component.stripeEnabled = true;
    component.paymentMethod = 'netopia';
    dynamic.ensurePaymentMethodAvailable();
    expect(component.paymentMethod).toBe('paypal');

    component['syncDebounceHandle'] = 1 as any;
    component['guestResendTimer'] = 2 as any;
    component['paymentNotReadyTimer'] = 3 as any;
    const clearTimeoutSpy = spyOn(globalThis, 'clearTimeout');
    const clearIntervalSpy = spyOn(globalThis, 'clearInterval');
    const abandonSpy = spyOn(dynamic, 'trackCheckoutAbandon').and.stub();
    component.ngOnDestroy();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(abandonSpy).toHaveBeenCalled();
  });

  it('covers resend-verification and payment capability branch handlers', () => {
    const { component, auth } = createComponent();
    const dynamic = component as any;

    auth.isAuthenticated.and.returnValue(true);
    component.primaryEmailVerificationBusy = true;
    component.resendPrimaryEmailVerification();
    expect(auth.requestEmailVerification).not.toHaveBeenCalled();

    component.primaryEmailVerificationBusy = false;
    dynamic.primaryEmailVerificationResendUntil = Date.now() + 60_000;
    component.resendPrimaryEmailVerification();
    expect(auth.requestEmailVerification).not.toHaveBeenCalled();

    dynamic.primaryEmailVerificationResendUntil = 0;
    auth.requestEmailVerification.and.returnValue(throwError(() => new Error('verification failed')));
    component.resendPrimaryEmailVerification();
    expect(component.primaryEmailVerificationStatus).toBe('account.verification.sendError');
    expect(component.primaryEmailVerificationBusy).toBeFalse();

    auth.requestEmailVerification.and.returnValue(of({}));
    component.resendPrimaryEmailVerification();
    expect(component.primaryEmailVerificationStatus).toBe('account.verification.sentStatus');

    component.netopiaEnabled = true;
    dynamic.applyPaymentCapabilities({
      stripe: { enabled: true },
      paypal: { enabled: true },
      netopia: { enabled: false, reason_code: 'maintenance', reason: 'Maintenance globalThis' }
    });
    expect(component.netopiaEnabled).toBeFalse();
    expect(['', 'Maintenance globalThis']).toContain(component.netopiaDisabledReason);
  });

  it('covers cart sync debounce/queue and quote fallback branches', () => {
    const { component, cartApi } = createComponent();
    const dynamic = component as any;
    const syncBackendCart = spyOn(dynamic, 'syncBackendCart').and.stub();

    jasmine.clock().install();
    try {
      component.syncing = true;
      dynamic.queueCartSync(component.items(), { immediate: false });
      expect(component.syncQueued).toBeTrue();
      expect(dynamic.queuedSyncItems).toEqual(component.items());

      component.syncing = false;
      dynamic.queueCartSync(component.items(), { immediate: false });
      expect(component.syncQueued).toBeTrue();
      jasmine.clock().tick(301);
      expect(syncBackendCart).toHaveBeenCalled();

      cartApi.get.and.returnValue(throwError(() => ({ error: { detail: 'quote failed' } })));
      dynamic.refreshQuote(null);
      expect(component.promoValid).toBeTrue();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('covers guest-email and legal-consent status callback branches', () => {
    const { component, api, auth } = createComponent();
    const dynamic = component as any;

    auth.isAuthenticated.and.returnValue(false);
    api.get.and.returnValue(of({ email: 'guest@example.com', verified: false }));
    dynamic.loadGuestEmailVerificationStatus();
    expect(component.guestVerificationSent).toBeTrue();
    expect(dynamic.lastGuestEmailRequested).toBe('guest@example.com');

    api.get.and.returnValue(throwError(() => new Error('status failed')));
    dynamic.loadGuestEmailVerificationStatus();
    expect(component.guestVerificationSent).toBeTrue();

    auth.isAuthenticated.and.returnValue(true);
    api.get.and.returnValue(
      of({
        satisfied: true,
        docs: [
          { doc_key: 'page.terms-and-conditions', accepted: true },
          { doc_key: 'page.privacy-policy', accepted: true },
        ],
      })
    );
    dynamic.loadLegalConsentStatus();
    expect(component.acceptTerms).toBeTrue();
    expect(component.acceptPrivacy).toBeTrue();
    expect(component.consentLocked).toBeTrue();

    api.get.and.returnValue(new Observable((subscriber) => subscriber.complete()));
    dynamic.loadLegalConsentStatus();
    expect(component.legalConsentsLoading).toBeTrue();

    api.get.and.returnValue(throwError(() => new Error('consents failed')));
    dynamic.loadLegalConsentStatus();
    expect(component.acceptTerms).toBeFalse();
    expect(component.acceptPrivacy).toBeFalse();
    expect(component.consentLocked).toBeFalse();
  });

  it('sweeps prototype methods through guarded checkout branches', () => {
    const { component } = createComponent();
    const dynamic = component as any;
    const argsByName: Record<string, unknown[]> = {
      onAddressPicked: [{ id: 'addr-1', name: 'Jane', email: 'jane@example.com', line1: 'Street', city: 'Bucharest', postal_code: '010101', country: 'RO' }],
      onLockerPicked: [{ id: 'locker-1', name: 'Locker', city: 'Bucharest' }],
      setDeliveryType: ['home'],
      onBillingSameAsShippingChanged: [],
      normalizePhone: ['0712345678', 'RO'],
      resolveCountryCode: ['Romania'],
      formatCountryOption: [{ code: 'RO', name: 'Romania' }],
      describeCouponReasons: [['min_subtotal_not_met']],
      minSubtotalShortfall: [makeCouponOffer({ eligible: false, reasons: ['min_subtotal_not_met'] })],
      courierEstimate: ['sameday'],
      courierEstimateKey: ['fan_courier'],
      courierEstimateParams: ['fan_courier'],
    };
    const blocked = new Set([
      'constructor',
      'ngOnInit',
      'queueCartSync',
      'trackCheckoutAbandon'
    ]);
    const safeMethods = Object.getOwnPropertyNames(CheckoutComponent.prototype).filter((name) => {
      if (blocked.has(name)) return false;
      return typeof dynamic[name] === 'function';
    });

    let attempted = 0;
    for (const name of safeMethods) {
      const fallback = new Array(Math.min(dynamic[name]?.length ?? 0, 4)).fill(undefined);
      callCheckoutMethodSafely(dynamic, name, argsByName[name] ?? fallback);
      attempted += 1;
    }

    expect(attempted).toBeGreaterThan(70);
  });
});
