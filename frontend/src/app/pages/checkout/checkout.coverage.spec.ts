import { signal } from '@angular/core';
import { of } from 'rxjs';

import { CheckoutComponent } from './checkout.component';

describe('CheckoutComponent coverage helpers', () => {
  function createComponent() {
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
    checkoutPrefs.tryLoadDeliveryPrefs.and.returnValue(null);
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

  it('validates guest account step one completion across branch conditions', () => {
    const { component, auth } = createComponent();

    auth.isAuthenticated.and.returnValue(true);
    expect(component.step1Complete()).toBeTrue();

    auth.isAuthenticated.and.returnValue(false);
    component.guestCreateAccount = false;
    expect(component.step1Complete()).toBeTrue();

    component.guestCreateAccount = true;
    component.guestUsername = 'x';
    component.guestPassword = '123456';
    component.guestPasswordConfirm = '123456';
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

    expect((component as any).normalizePaymentRedirectUrl('http://checkout.stripe.com/c/pay/test', ['checkout.stripe.com'])).toBeNull();
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
});
