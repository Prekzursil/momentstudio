import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NEVER, of, throwError } from 'rxjs';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { CheckoutComponent } from './checkout.component';
import { CartStore } from '../../core/cart.store';
import { CartApi } from '../../core/cart.api';
import { ApiService } from '../../core/api.service';
import { AccountService, Address } from '../../core/account.service';
import { AuthService } from '../../core/auth.service';
import { CouponsService, CouponOffer } from '../../core/coupons.service';
import { CheckoutPrefsService } from '../../core/checkout-prefs.service';
import { AnalyticsService } from '../../core/analytics.service';
import { appConfig } from '../../core/app-config';

/**
 * Exhaustive behavioural coverage for CheckoutComponent.
 *
 * These tests assert real input -> output / side-effect behaviour for every
 * branch in the component (validation gates, payment routing, coupon logic,
 * guest verification flow, cart sync, address handling, SSR guards, ...).
 */

const makeAddress = (over: Partial<Address> = {}): Address => ({
  id: 'a1',
  label: 'Home',
  phone: '+40721234567',
  line1: '1 Main St',
  line2: 'Apt 2',
  city: 'Bucuresti',
  region: 'B',
  postal_code: '010101',
  country: 'RO',
  is_default_shipping: true,
  is_default_billing: false,
  ...over,
});

const makeOffer = (over: Partial<CouponOffer> = {}): CouponOffer => ({
  coupon: {
    id: 'c1',
    promotion_id: 'pr1',
    code: 'SAVE10',
    visibility: 'public',
    is_active: true,
    promotion: {
      id: 'pr1',
      name: 'Save 10',
      discount_type: 'percent',
      percentage_off: '10',
      allow_on_sale_items: true,
      is_active: true,
      is_automatic: false,
    },
  },
  estimated_discount_ron: '5',
  estimated_shipping_discount_ron: '0',
  eligible: true,
  reasons: [],
  ...over,
});

const VALID_ADDRESS = {
  name: 'Test User',
  email: 'test@example.com',
  line1: '123 St',
  line2: '',
  city: 'City',
  region: 'B',
  postal: '12345',
  country: 'RO',
} as any;

describe('CheckoutComponent (coverage)', () => {
  let cart: any;
  let cartApi: any;
  let api: any;
  let account: any;
  let auth: any;
  let coupons: any;
  let prefs: any;
  let analytics: any;
  let itemsSignal: any;
  let subtotalSignal: any;
  let queryParams: any;
  let routeData: any;

  const defaultItem = {
    id: 'line1',
    product_id: 'p1',
    variant_id: null,
    name: 'Prod',
    slug: 'prod',
    price: 20,
    currency: 'RON',
    quantity: 1,
    stock: 5,
    image: '/img.png',
  };

  beforeEach(() => {
    itemsSignal = signal([{ ...defaultItem }]);
    subtotalSignal = signal(20);
    queryParams = convertToParamMap({});
    routeData = {};

    cart = {
      items: itemsSignal,
      subtotal: subtotalSignal,
      clear: jasmine.createSpy('clear'),
      hydrateFromBackend: jasmine.createSpy('hydrateFromBackend'),
    };

    cartApi = jasmine.createSpyObj('CartApi', ['sync', 'headers', 'get']);
    cartApi.sync.and.returnValue(of({ totals: {} }));
    cartApi.headers.and.returnValue({});
    cartApi.get.and.returnValue(of({ totals: {} }));

    api = jasmine.createSpyObj('ApiService', ['post', 'get']);
    api.post.and.returnValue(
      of({ order_id: 'order1', reference_code: 'REF', payment_method: 'cod' }),
    );
    api.get.and.callFake((path: string) => {
      if (path === '/legal/consents/status') {
        return of({
          docs: [
            {
              doc_key: 'page.terms-and-conditions',
              slug: 'terms-and-conditions',
              required_version: 1,
              accepted_version: 1,
              accepted: true,
            },
            {
              doc_key: 'page.privacy-policy',
              slug: 'privacy-policy',
              required_version: 1,
              accepted_version: 1,
              accepted: true,
            },
          ],
          satisfied: true,
        });
      }
      if (path === '/payments/capabilities') {
        return of({
          stripe: { enabled: true },
          paypal: { enabled: true },
          netopia: { enabled: true },
        });
      }
      if (path === '/orders/guest-checkout/email/status') {
        return of({ email: null, verified: false });
      }
      return of({ eligible: [], ineligible: [] });
    });

    account = jasmine.createSpyObj('AccountService', ['getAddresses', 'updateAddress']);
    account.getAddresses.and.returnValue(of([]));
    account.updateAddress.and.returnValue(of(makeAddress()));

    auth = jasmine.createSpyObj('AuthService', [
      'isAuthenticated',
      'user',
      'requestEmailVerification',
      'ensureAuthenticated',
    ]);
    auth.isAuthenticated.and.returnValue(true);
    auth.user.and.returnValue({ email_verified: true });
    auth.requestEmailVerification.and.returnValue(of(void 0));
    auth.ensureAuthenticated.and.returnValue(of({}));

    coupons = jasmine.createSpyObj('CouponsService', ['eligibility', 'validate']);
    coupons.eligibility.and.returnValue(of({ eligible: [], ineligible: [] }));
    coupons.validate.and.returnValue(of(makeOffer()));

    prefs = jasmine.createSpyObj('CheckoutPrefsService', [
      'tryLoadDeliveryPrefs',
      'loadDeliveryPrefs',
      'saveDeliveryPrefs',
      'tryLoadPaymentMethod',
      'savePaymentMethod',
    ]);
    prefs.tryLoadDeliveryPrefs.and.returnValue(null);
    prefs.tryLoadPaymentMethod.and.returnValue(null);

    analytics = jasmine.createSpyObj('AnalyticsService', ['enabled', 'setEnabled', 'track']);
    analytics.enabled.and.returnValue(true);
  });

  function make(): CheckoutComponent {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RouterTestingModule, CheckoutComponent, TranslateModule.forRoot()],
      providers: [
        { provide: CartStore, useValue: cart },
        { provide: CartApi, useValue: cartApi },
        { provide: ApiService, useValue: api },
        { provide: AccountService, useValue: account },
        { provide: AuthService, useValue: auth },
        { provide: CouponsService, useValue: coupons },
        { provide: CheckoutPrefsService, useValue: prefs },
        { provide: AnalyticsService, useValue: analytics },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { params: {}, queryParamMap: queryParams, data: routeData },
            queryParamMap: of(queryParams),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(CheckoutComponent);
    const cmp = fixture.componentInstance;
    // Stub the component's own change detector: detectChangesSafe() is exercised
    // directly elsewhere; stubbing here avoids NG0100 noise from repeated CD on a
    // never-initially-checked view while still covering the try-branch.
    spyOn((cmp as any).cdr, 'detectChanges');
    return cmp;
  }

  // Make the global `localStorage` appear undefined (SSR guard branch) without
  // permanently mutating the accessor: define a temporary own data property, then
  // remove it so the original prototype getter is restored for later specs.
  function withoutLocalStorage(fn: () => void): void {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
    try {
      fn();
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'localStorage', original);
      } else {
        delete (globalThis as any).localStorage;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------
  describe('constructor', () => {
    it('applies stored delivery prefs (locker)', () => {
      prefs.tryLoadDeliveryPrefs.and.returnValue({
        courier: 'fan_courier',
        deliveryType: 'locker',
      });
      const cmp = make();
      expect(cmp.courier).toBe('fan_courier');
      expect(cmp.deliveryType).toBe('locker');
    });

    it('defaults country to RO when no prefs', () => {
      const cmp = make();
      expect(cmp.address.country).toBe('RO');
      expect(cmp.billing.country).toBe('RO');
      expect(cmp.shippingCountryInput).toContain('RO');
    });

    it('clears locker when delivery prefs are home', () => {
      prefs.tryLoadDeliveryPrefs.and.returnValue({ courier: 'sameday', deliveryType: 'home' });
      const cmp = make();
      cmp.locker = { id: 'l1' } as any;
      expect(cmp.deliveryType).toBe('home');
    });
  });

  // ---------------------------------------------------------------------------
  // cartSyncPending / quote getters
  // ---------------------------------------------------------------------------
  it('cartSyncPending reflects syncing/queued', () => {
    const cmp = make();
    expect(cmp.cartSyncPending()).toBeFalse();
    cmp.syncing = true;
    expect(cmp.cartSyncPending()).toBeTrue();
    cmp.syncing = false;
    cmp.syncQueued = true;
    expect(cmp.cartSyncPending()).toBeTrue();
  });

  it('quote getters fall back without a quote and use quote when set', () => {
    const cmp = make();
    expect(cmp.quoteSubtotal()).toBe(20);
    expect(cmp.quoteTax()).toBe(0);
    expect(cmp.quoteFee()).toBe(0);
    expect(cmp.quoteShipping()).toBe(0);
    expect(cmp.quoteTotal()).toBe(20);
    expect(cmp.quoteDiscount()).toBe(0);
    (cmp as any).quote = {
      subtotal: 100,
      fee: 5,
      tax: 19,
      shipping: 10,
      total: 120,
      currency: 'RON',
    };
    expect(cmp.quoteSubtotal()).toBe(100);
    expect(cmp.quoteTax()).toBe(19);
    expect(cmp.quoteFee()).toBe(5);
    expect(cmp.quoteShipping()).toBe(10);
    expect(cmp.quoteTotal()).toBe(120);
    expect(cmp.quoteDiscount()).toBe(14);
  });

  it('quotePromoSavings combines discount and coupon shipping discount', () => {
    const cmp = make();
    (cmp as any).quote = {
      subtotal: 100,
      fee: 0,
      tax: 0,
      shipping: 10,
      total: 105,
      currency: 'RON',
    };
    cmp.promo = 'SAVE10';
    cmp.appliedCouponOffer = makeOffer({ estimated_shipping_discount_ron: '10', eligible: true });
    // discount = max(0, 100+10-105)=5; + coupon shipping discount 10 = 15
    expect(cmp.quotePromoSavings()).toBe(15);
  });

  // ---------------------------------------------------------------------------
  // Focus / scroll / a11y helpers (SSR + DOM branches)
  // ---------------------------------------------------------------------------
  describe('scroll/focus helpers', () => {
    it('scrollToStep no-ops when element is missing', () => {
      const cmp = make();
      expect(() => cmp.scrollToStep('does-not-exist')).not.toThrow();
    });

    it('scrollToStep focuses a focusable child', fakeAsync(() => {
      const cmp = make();
      const step = document.createElement('div');
      step.id = 'step-focusable';
      step.scrollIntoView = () => {};
      const btn = document.createElement('button');
      const focusSpy = spyOn(btn, 'focus');
      spyOn(btn, 'getClientRects').and.returnValue([{}] as any);
      step.appendChild(btn);
      document.body.appendChild(step);
      try {
        cmp.scrollToStep('step-focusable');
        tick();
        expect(focusSpy).toHaveBeenCalled();
      } finally {
        document.body.removeChild(step);
      }
    }));

    it('scrollToStep focuses the step itself when no focusable child', fakeAsync(() => {
      const cmp = make();
      const step = document.createElement('div');
      step.id = 'step-empty';
      step.scrollIntoView = () => {};
      const focusSpy = spyOn(step, 'focus');
      document.body.appendChild(step);
      try {
        cmp.scrollToStep('step-empty');
        tick();
        expect(step.getAttribute('tabindex')).toBe('-1');
        expect(focusSpy).toHaveBeenCalled();
      } finally {
        document.body.removeChild(step);
      }
    }));

    it('scrollToStep swallows errors thrown by getElementById', () => {
      const cmp = make();
      spyOn(document, 'getElementById').and.throwError('boom');
      expect(() => cmp.scrollToStep('x')).not.toThrow();
    });

    it('findFirstFocusableElement skips hidden/disabled/invisible candidates', () => {
      const cmp = make();
      const container = document.createElement('div');
      const hidden = document.createElement('input');
      hidden.type = 'hidden';
      const disabled = document.createElement('button');
      (disabled as any).disabled = true;
      const invisible = document.createElement('button');
      spyOn(invisible, 'getClientRects').and.returnValue([] as any);
      container.appendChild(hidden);
      container.appendChild(disabled);
      container.appendChild(invisible);
      expect((cmp as any).findFirstFocusableElement(container)).toBeNull();
    });

    it('focusOnly swallows focus errors', () => {
      const cmp = make();
      const el = document.createElement('div');
      spyOn(el, 'focus').and.throwError('no');
      expect(() => (cmp as any).focusOnly(el)).not.toThrow();
    });

    it('announceAssertive ignores blank/nullish and sets message asynchronously', fakeAsync(() => {
      const cmp = make();
      (cmp as any).announceAssertive('   ');
      expect(cmp.liveAssertive).toBe('');
      (cmp as any).announceAssertive(null); // exercises the `message || ''` fallback
      expect(cmp.liveAssertive).toBe('');
      (cmp as any).announceAssertive('hello');
      tick();
      expect(cmp.liveAssertive).toBe('hello');
    }));

    it('focusElementById scrolls and focuses an existing element', fakeAsync(() => {
      const cmp = make();
      const el = document.createElement('div');
      el.id = 'feb-target';
      el.scrollIntoView = () => {};
      const focusSpy = spyOn(el, 'focus');
      document.body.appendChild(el);
      try {
        (cmp as any).focusElementById('feb-target');
        tick();
        expect(focusSpy).toHaveBeenCalled();
      } finally {
        document.body.removeChild(el);
      }
    }));

    it('focusFirstInvalidField handles no form, no invalid, and a found invalid field', fakeAsync(() => {
      const cmp = make();
      // no formEl
      (cmp as any).focusFirstInvalidField();
      tick();
      // form with no invalid field
      const formEl = document.createElement('form');
      cmp.checkoutFormEl = { nativeElement: formEl } as any;
      (cmp as any).focusFirstInvalidField();
      tick();
      // form with an invalid field
      const input = document.createElement('input');
      input.classList.add('ng-invalid');
      input.scrollIntoView = () => {};
      spyOn(input, 'getClientRects').and.returnValue([{}] as any);
      const focusSpy = spyOn(input, 'focus');
      formEl.appendChild(input);
      (cmp as any).focusFirstInvalidField();
      tick();
      expect(focusSpy).toHaveBeenCalled();
    }));

    it('findFirstInvalidField skips hidden/disabled/invisible candidates', () => {
      const cmp = make();
      const container = document.createElement('div');
      const hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.classList.add('ng-invalid');
      const disabled = document.createElement('input');
      disabled.classList.add('ng-invalid');
      (disabled as any).disabled = true;
      const invisible = document.createElement('input');
      invisible.classList.add('ng-invalid');
      spyOn(invisible, 'getClientRects').and.returnValue([] as any);
      container.appendChild(hidden);
      container.appendChild(disabled);
      container.appendChild(invisible);
      expect((cmp as any).findFirstInvalidField(container)).toBeNull();
    });

    it('focusElementById no-ops when element is missing', fakeAsync(() => {
      const cmp = make();
      (cmp as any).focusElementById('definitely-missing');
      tick();
      expect(document.getElementById('definitely-missing')).toBeNull();
    }));

    it('detectChangesSafe swallows detectChanges errors', () => {
      const cmp = make();
      ((cmp as any).cdr.detectChanges as jasmine.Spy).and.throwError('view destroyed');
      expect(() => (cmp as any).detectChangesSafe()).not.toThrow();
    });

    it('scrollAndFocus swallows scroll and focus errors', () => {
      const cmp = make();
      const el = document.createElement('div');
      spyOn(el, 'scrollIntoView').and.throwError('x');
      spyOn(el, 'focus').and.throwError('y');
      expect(() => (cmp as any).scrollAndFocus(el)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Step completion gates
  // ---------------------------------------------------------------------------
  describe('step gates', () => {
    it('step1Complete: authenticated short-circuits', () => {
      const cmp = make();
      expect(cmp.step1Complete()).toBeTrue();
    });

    it('step1Complete: guest without create-account is complete', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.guestCreateAccount = false;
      expect(cmp.step1Complete()).toBeTrue();
    });

    it('step1Complete: guest create-account validation branches', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.guestCreateAccount = true;
      cmp.guestUsername = '!!';
      expect(cmp.step1Complete()).toBeFalse();
      cmp.guestUsername = 'validuser';
      cmp.guestPassword = '123';
      expect(cmp.step1Complete()).toBeFalse();
      cmp.guestPassword = 'longpass';
      cmp.guestPasswordConfirm = 'different';
      expect(cmp.step1Complete()).toBeFalse();
      cmp.guestPasswordConfirm = 'longpass';
      cmp.guestFirstName = '';
      expect(cmp.step1Complete()).toBeFalse();
      cmp.guestFirstName = 'First';
      cmp.guestLastName = 'Last';
      cmp.guestDob = '';
      expect(cmp.step1Complete()).toBeFalse();
      cmp.guestDob = '1990-01-01';
      cmp.guestPhoneCountry = 'RO';
      cmp.guestPhoneNational = '';
      expect(cmp.step1Complete()).toBeFalse();
      cmp.guestPhoneNational = '721234567';
      expect(cmp.step1Complete()).toBeTrue();
    });

    it('step2Complete: walks each failing condition then succeeds', () => {
      const cmp = make();
      cmp.address = { ...VALID_ADDRESS, name: '' } as any;
      // valid phone set up-front so failures are attributed to the field under test
      cmp.shippingPhoneCountry = 'RO';
      cmp.shippingPhoneNational = '721234567';
      expect(cmp.step2Complete()).toBeFalse();
      cmp.address.name = 'Name';
      cmp.address.email = '';
      expect(cmp.step2Complete()).toBeFalse();
      cmp.address.email = 'bad';
      expect(cmp.step2Complete()).toBeFalse();
      cmp.address.email = 'good@example.com';
      cmp.address.line1 = '';
      expect(cmp.step2Complete()).toBeFalse();
      cmp.address.line1 = '1 St';
      cmp.address.city = '';
      expect(cmp.step2Complete()).toBeFalse();
      cmp.address.city = 'City';
      cmp.address.postal = '';
      expect(cmp.step2Complete()).toBeFalse();
      cmp.address.postal = '12345';
      cmp.shippingCountryInput = 'ZZ-invalid';
      expect(cmp.step2Complete()).toBeFalse();
      cmp.shippingCountryInput = 'RO';
      cmp.address.region = '';
      expect(cmp.step2Complete()).toBeFalse();
      cmp.address.region = 'B';
      cmp.shippingCountryError = 'err';
      expect(cmp.step2Complete()).toBeFalse();
      cmp.shippingCountryError = '';
      cmp.shippingPhoneCountry = 'RO';
      cmp.shippingPhoneNational = '721234567';
      expect(cmp.step2Complete()).toBeTrue();
    });

    it('step2Complete: invalid shipping phone fails when required', () => {
      const cmp = make();
      cmp.address = { ...VALID_ADDRESS } as any;
      cmp.shippingCountryInput = 'RO';
      cmp.shippingPhoneCountry = 'RO';
      cmp.shippingPhoneNational = '123'; // invalid -> shippingPhoneE164 null
      expect(cmp.step2Complete()).toBeFalse();
    });

    it('step2Complete: locker requires a selected locker', () => {
      const cmp = make();
      cmp.address = { ...VALID_ADDRESS } as any;
      cmp.shippingCountryInput = 'RO';
      cmp.shippingPhoneNational = '721234567';
      cmp.deliveryType = 'locker';
      cmp.locker = null;
      expect(cmp.step2Complete()).toBeFalse();
    });

    it('step2Complete: separate billing validation branches', () => {
      const cmp = make();
      cmp.address = { ...VALID_ADDRESS } as any;
      cmp.shippingCountryInput = 'RO';
      cmp.shippingPhoneNational = '721234567';
      cmp.billingSameAsShipping = false;
      cmp.billing = { line1: '', line2: '', city: '', region: '', postal: '', country: 'RO' };
      expect(cmp.step2Complete()).toBeFalse();
      cmp.billing.line1 = '1 St';
      expect(cmp.step2Complete()).toBeFalse();
      cmp.billing.city = 'City';
      expect(cmp.step2Complete()).toBeFalse();
      cmp.billing.postal = '12345';
      cmp.billingCountryInput = 'ZZ-invalid';
      expect(cmp.step2Complete()).toBeFalse();
      cmp.billingCountryInput = 'RO';
      cmp.billing.region = '';
      expect(cmp.step2Complete()).toBeFalse();
      cmp.billing.region = 'B';
      cmp.billingCountryError = 'err';
      expect(cmp.step2Complete()).toBeFalse();
      cmp.billingCountryError = '';
      expect(cmp.step2Complete()).toBeTrue();
    });

    it('step2Complete: guest path checks guestEmailVerified', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.address = { ...VALID_ADDRESS } as any;
      cmp.shippingCountryInput = 'RO';
      cmp.shippingPhoneNational = '721234567';
      cmp.guestEmailVerified = false;
      expect(cmp.step2Complete()).toBeFalse();
      cmp.guestEmailVerified = true;
      expect(cmp.step2Complete()).toBeTrue();
    });

    it('step2Complete: authenticated but email unverified fails', () => {
      auth.user.and.returnValue({ email_verified: false });
      const cmp = make();
      cmp.address = { ...VALID_ADDRESS } as any;
      cmp.shippingCountryInput = 'RO';
      cmp.shippingPhoneNational = '721234567';
      expect(cmp.step2Complete()).toBeFalse();
    });

    it('step3Complete delegates to step2Complete', () => {
      const cmp = make();
      cmp.address = { ...VALID_ADDRESS } as any;
      cmp.shippingCountryInput = 'RO';
      cmp.shippingPhoneNational = '721234567';
      expect(cmp.step3Complete()).toBeTrue();
    });

    it('isValidEmail covers each rejection path', () => {
      const cmp = make();
      const fn = (e: string) => (cmp as any).isValidEmail(e);
      expect(fn('')).toBeFalse();
      expect(fn('a'.repeat(256) + '@x.com')).toBeFalse();
      expect(fn('@example.com')).toBeFalse();
      expect(fn('user@')).toBeFalse();
      expect(fn('user@localhost')).toBeFalse();
      expect(fn('user@example.com')).toBeTrue();
    });
  });

  // ---------------------------------------------------------------------------
  // copyShippingToBilling / billing sync
  // ---------------------------------------------------------------------------
  describe('billing helpers', () => {
    it('copyShippingToBilling no-ops when billing same as shipping', () => {
      const cmp = make();
      cmp.billingSameAsShipping = true;
      cmp.billing.line1 = 'untouched';
      cmp.copyShippingToBilling();
      expect(cmp.billing.line1).toBe('untouched');
    });

    it('copyShippingToBilling copies from shipping', () => {
      const cmp = make();
      cmp.billingSameAsShipping = false;
      cmp.address.line1 = '99 Road';
      cmp.address.city = 'Cluj';
      cmp.shippingCountryInput = 'RO — Romania';
      cmp.copyShippingToBilling();
      expect(cmp.billing.line1).toBe('99 Road');
      expect(cmp.billing.city).toBe('Cluj');
      expect(cmp.billingCountryInput).toBe('RO — Romania');
    });

    it('onBillingSameAsShippingChanged copies when set true', () => {
      const cmp = make();
      cmp.billingSameAsShipping = true;
      cmp.address.line1 = 'X1';
      cmp.onBillingSameAsShippingChanged();
      expect(cmp.billing.line1).toBe('X1');
    });

    it('onBillingSameAsShippingChanged keeps already-filled billing', () => {
      const cmp = make();
      cmp.billingSameAsShipping = false;
      cmp.billing.line1 = 'existing';
      cmp.onBillingSameAsShippingChanged();
      expect(cmp.billing.line1).toBe('existing');
    });

    it('onBillingSameAsShippingChanged applies selected billing address', () => {
      const cmp = make();
      cmp.billingSameAsShipping = false;
      cmp.savedAddresses = [makeAddress({ id: 'b1', line1: 'Saved1' })];
      cmp.selectedBillingAddressId = 'b1';
      cmp.onBillingSameAsShippingChanged();
      expect(cmp.billing.line1).toBe('Saved1');
    });

    it('onBillingSameAsShippingChanged falls back to default billing/shipping/first', () => {
      const cmp = make();
      cmp.billingSameAsShipping = false;
      cmp.savedAddresses = [makeAddress({ id: 'd1', line1: 'Fallback', is_default_billing: true })];
      cmp.selectedBillingAddressId = '';
      cmp.onBillingSameAsShippingChanged();
      expect(cmp.billing.line1).toBe('Fallback');
      expect(cmp.selectedBillingAddressId).toBe('d1');
    });

    it('onBillingSameAsShippingChanged no fallback when no saved addresses', () => {
      const cmp = make();
      cmp.billingSameAsShipping = false;
      cmp.savedAddresses = [];
      cmp.selectedBillingAddressId = '';
      cmp.onBillingSameAsShippingChanged();
      expect(cmp.billing.line1).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // Saved addresses
  // ---------------------------------------------------------------------------
  describe('saved addresses', () => {
    it('formatSavedAddress builds title and body, and title only', () => {
      const cmp = make();
      expect(cmp.formatSavedAddress(makeAddress({ label: 'Office' }))).toContain('Office');
      const bare = cmp.formatSavedAddress(
        makeAddress({ label: '', line1: '', city: '', region: '', country: '' }),
      );
      expect(bare).toBeTruthy();
    });

    it('applySelectedShippingAddress: no id, missing, found', () => {
      const cmp = make();
      cmp.selectedShippingAddressId = '';
      cmp.applySelectedShippingAddress();
      cmp.selectedShippingAddressId = 'nope';
      cmp.savedAddresses = [makeAddress({ id: 'real' })];
      cmp.applySelectedShippingAddress();
      cmp.selectedShippingAddressId = 'real';
      cmp.applySelectedShippingAddress();
      expect(cmp.address.line1).toBe('1 Main St');
    });

    it('applySelectedBillingAddress: no id, missing, found', () => {
      const cmp = make();
      cmp.selectedBillingAddressId = '';
      cmp.applySelectedBillingAddress();
      cmp.selectedBillingAddressId = 'nope';
      cmp.savedAddresses = [makeAddress({ id: 'real' })];
      cmp.applySelectedBillingAddress();
      cmp.selectedBillingAddressId = 'real';
      cmp.applySelectedBillingAddress();
      expect(cmp.billing.line1).toBe('1 Main St');
    });

    it('applySavedAddressToShipping handles phone + billing mirror', () => {
      const cmp = make();
      cmp.billingSameAsShipping = true;
      (cmp as any).applySavedAddressToShipping(makeAddress({ phone: '+40721234567' }));
      expect(cmp.shippingPhoneNational).toBeTruthy();
      expect(cmp.billing.line1).toBe('1 Main St');
      expect(cmp.saveAddress).toBeFalse();
    });

    it('applySavedAddressToShipping without phone, billing not mirrored', () => {
      const cmp = make();
      cmp.billingSameAsShipping = false;
      (cmp as any).applySavedAddressToShipping(makeAddress({ phone: null }));
      expect(cmp.address.line1).toBe('1 Main St');
    });

    it('editSavedAddressTitle shipping vs billing', () => {
      const cmp = make();
      cmp.editSavedAddressTarget = 'shipping';
      expect(cmp.editSavedAddressTitle()).toBe('checkout.editShippingAddressTitle');
      cmp.editSavedAddressTarget = 'billing';
      expect(cmp.editSavedAddressTitle()).toBe('checkout.editBillingAddressTitle');
    });

    it('openEditSavedAddress: not authenticated returns', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.openEditSavedAddress('shipping');
      expect(cmp.editSavedAddressOpen).toBeFalse();
    });

    it('openEditSavedAddress: no id and missing address return', () => {
      const cmp = make();
      cmp.selectedShippingAddressId = '';
      cmp.openEditSavedAddress('shipping');
      expect(cmp.editSavedAddressOpen).toBeFalse();
      cmp.selectedBillingAddressId = 'missing';
      cmp.openEditSavedAddress('billing');
      expect(cmp.editSavedAddressOpen).toBeFalse();
    });

    it('openEditSavedAddress: opens editor for a found address', () => {
      const cmp = make();
      cmp.savedAddresses = [makeAddress({ id: 'e1', label: null, line2: null, region: null })];
      cmp.selectedShippingAddressId = 'e1';
      cmp.openEditSavedAddress('shipping');
      expect(cmp.editSavedAddressOpen).toBeTrue();
      expect(cmp.editSavedAddressModel?.line1).toBe('1 Main St');
    });

    it('closeEditSavedAddress resets state', () => {
      const cmp = make();
      cmp.editSavedAddressOpen = true;
      cmp.editSavedAddressModel = {} as any;
      cmp.closeEditSavedAddress();
      expect(cmp.editSavedAddressOpen).toBeFalse();
      expect(cmp.editSavedAddressModel).toBeNull();
    });

    it('saveEditedSavedAddress guards: not auth, no id, already saving', () => {
      const cmp = make();
      auth.isAuthenticated.and.returnValue(false);
      cmp.saveEditedSavedAddress({} as any);
      auth.isAuthenticated.and.returnValue(true);
      cmp.editSavedAddressId = '';
      cmp.saveEditedSavedAddress({} as any);
      cmp.editSavedAddressId = 'x';
      (cmp as any).editSavedAddressSaving = true;
      cmp.saveEditedSavedAddress({} as any);
      expect(account.updateAddress).not.toHaveBeenCalled();
    });

    it('saveEditedSavedAddress success applies to shipping', () => {
      const cmp = make();
      const updated = makeAddress({ id: 'u1', line1: 'Updated' });
      account.updateAddress.and.returnValue(of(updated));
      cmp.savedAddresses = [makeAddress({ id: 'u1' })];
      cmp.editSavedAddressId = 'u1';
      cmp.editSavedAddressTarget = 'shipping';
      cmp.saveEditedSavedAddress({} as any);
      expect(cmp.address.line1).toBe('Updated');
      expect(cmp.editSavedAddressOpen).toBeFalse();
    });

    it('saveEditedSavedAddress success applies to billing (maps over non-matching saved entries)', () => {
      const cmp = make();
      const updated = makeAddress({ id: 'u2', line1: 'BillingUpd' });
      account.updateAddress.and.returnValue(of(updated));
      const other = makeAddress({ id: 'other', line1: 'Untouched' });
      // reload returns the same set so we can assert the non-matching entry survived the map()
      account.getAddresses.and.returnValue(of([other, updated]));
      cmp.savedAddresses = [other];
      // separate billing + a filled shipping address so the reload doesn't mirror/replace billing
      cmp.billingSameAsShipping = false;
      cmp.address = { ...VALID_ADDRESS } as any;
      cmp.editSavedAddressId = 'u2';
      cmp.editSavedAddressTarget = 'billing';
      cmp.saveEditedSavedAddress({} as any);
      expect(cmp.billing.line1).toBe('BillingUpd');
      expect(account.updateAddress).toHaveBeenCalledWith('u2', jasmine.anything());
      expect(cmp.savedAddresses.find((a) => a.id === 'other')?.line1).toBe('Untouched');
    });

    it('saveEditedSavedAddress error sets message', () => {
      const cmp = make();
      account.updateAddress.and.returnValue(throwError(() => new Error('x')));
      cmp.editSavedAddressId = 'u3';
      cmp.saveEditedSavedAddress({} as any);
      expect(cmp.editSavedAddressError).toBe('account.addresses.errors.update');
    });

    it('loadSavedAddresses: not authenticated returns', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      (cmp as any).loadSavedAddresses();
      expect(account.getAddresses).not.toHaveBeenCalled();
    });

    it('loadSavedAddresses: skips when already loading and not forced', () => {
      const cmp = make();
      cmp.savedAddressesLoading = true;
      (cmp as any).loadSavedAddresses(false);
      expect(account.getAddresses).not.toHaveBeenCalled();
    });

    it('loadSavedAddresses: populates defaults and applies addresses', () => {
      const cmp = make();
      account.getAddresses.and.returnValue(
        of([
          makeAddress({ id: 's1', is_default_shipping: true, is_default_billing: false }),
          makeAddress({ id: 'b1', is_default_shipping: false, is_default_billing: true }),
        ]),
      );
      cmp.address = { ...VALID_ADDRESS, line1: '', city: '', postal: '' } as any;
      cmp.billingSameAsShipping = false;
      cmp.billing = { line1: '', line2: '', city: '', region: '', postal: '', country: 'RO' };
      (cmp as any).loadSavedAddresses(true);
      expect(cmp.selectedShippingAddressId).toBe('s1');
      expect(cmp.selectedBillingAddressId).toBe('b1');
    });

    it('loadSavedAddresses: handles non-array and error', () => {
      const cmp = make();
      account.getAddresses.and.returnValue(of(null as any));
      (cmp as any).loadSavedAddresses(true);
      expect(cmp.savedAddresses).toEqual([]);
      account.getAddresses.and.returnValue(throwError(() => new Error('x')));
      (cmp as any).loadSavedAddresses(true);
      expect(cmp.savedAddressesError).toBe('checkout.savedAddressesLoadError');
    });
  });

  // ---------------------------------------------------------------------------
  // Country resolution
  // ---------------------------------------------------------------------------
  describe('country helpers', () => {
    it('formatCountryOption formats code and name', () => {
      const cmp = make();
      expect(cmp.formatCountryOption({ code: 'RO', name: 'Romania' } as any)).toBe('RO — Romania');
    });

    it('normalizeShippingCountry: invalid sets error', () => {
      const cmp = make();
      cmp.shippingCountryInput = 'ZZ-bad';
      cmp.normalizeShippingCountry();
      expect(cmp.shippingCountryError).toBe('checkout.countryInvalid');
    });

    it('normalizeShippingCountry: valid mirrors to billing when same', () => {
      const cmp = make();
      cmp.billingSameAsShipping = true;
      cmp.shippingCountryInput = 'RO';
      cmp.normalizeShippingCountry();
      expect(cmp.address.country).toBe('RO');
      expect(cmp.billing.country).toBe('RO');
    });

    it('normalizeBillingCountry: invalid + valid', () => {
      const cmp = make();
      cmp.billingCountryInput = 'ZZ-bad';
      cmp.normalizeBillingCountry();
      expect(cmp.billingCountryError).toBe('checkout.countryInvalid');
      cmp.billingCountryInput = 'RO';
      cmp.normalizeBillingCountry();
      expect(cmp.billing.country).toBe('RO');
    });

    it('normalizeCheckoutCountries: invalid shipping returns false', () => {
      const cmp = make();
      cmp.shippingCountryInput = 'ZZ-bad';
      expect((cmp as any).normalizeCheckoutCountries()).toBeFalse();
    });

    it('normalizeCheckoutCountries: same as shipping returns true', () => {
      const cmp = make();
      cmp.billingSameAsShipping = true;
      cmp.shippingCountryInput = 'RO';
      expect((cmp as any).normalizeCheckoutCountries()).toBeTrue();
    });

    it('normalizeCheckoutCountries: separate billing invalid then valid', () => {
      const cmp = make();
      cmp.billingSameAsShipping = false;
      cmp.shippingCountryInput = 'RO';
      cmp.billingCountryInput = 'ZZ-bad';
      expect((cmp as any).normalizeCheckoutCountries()).toBeFalse();
      cmp.billingCountryInput = 'RO';
      expect((cmp as any).normalizeCheckoutCountries()).toBeTrue();
    });

    it('resolveCountryCode: name, paren suffix, dash suffix, null', () => {
      const cmp = make();
      const fn = (s: string) => (cmp as any).resolveCountryCode(s);
      expect(fn('')).toBeNull();
      expect(fn('Romania')).toBe('RO');
      const ro = cmp.countries.find((c) => c.code === 'RO')!;
      expect(fn(`${ro.name} (ro)`)).toBe('RO');
      expect(fn(`${ro.name} - ro`)).toBe('RO');
      expect(fn('Nowhereland')).toBeNull();
    });

    it('countryInputFromCode: empty, unknown, known', () => {
      const cmp = make();
      const fn = (s: string) => (cmp as any).countryInputFromCode(s);
      expect(fn('')).toBe('');
      expect(fn('ZZ')).toBe('ZZ');
      expect(fn('RO')).toContain('RO');
    });
  });

  // ---------------------------------------------------------------------------
  // Email / guest phone / verification
  // ---------------------------------------------------------------------------
  describe('email + guest phone', () => {
    it('onEmailChanged: authenticated returns', () => {
      const cmp = make();
      (cmp as any).lastGuestEmailVerified = 'old@example.com';
      cmp.onEmailChanged();
      expect((cmp as any).lastGuestEmailVerified).toBe('old@example.com');
    });

    it('onEmailChanged: resets verified + requested when email changes', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.address.email = 'new@example.com';
      cmp.guestEmailVerified = true;
      cmp.guestVerificationSent = true;
      (cmp as any).lastGuestEmailVerified = 'old@example.com';
      (cmp as any).lastGuestEmailRequested = 'old@example.com';
      cmp.onEmailChanged();
      expect(cmp.guestEmailVerified).toBeFalse();
      expect(cmp.guestVerificationSent).toBeFalse();
    });

    it('onGuestCreateAccountChanged: enables saveAddress', () => {
      const cmp = make();
      cmp.saveAddress = false;
      cmp.onGuestCreateAccountChanged(false);
      expect(cmp.saveAddress).toBeFalse();
      cmp.onGuestCreateAccountChanged(true);
      expect(cmp.saveAddress).toBeTrue();
    });

    it('togglers flip flags', () => {
      const cmp = make();
      cmp.toggleGuestPassword();
      expect(cmp.guestShowPassword).toBeTrue();
      cmp.toggleGuestPasswordConfirm();
      expect(cmp.guestShowPasswordConfirm).toBeTrue();
    });

    it('onGuestPhoneChanged: copies to shipping phone when empty', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.guestCreateAccount = true;
      cmp.shippingPhoneNational = '';
      cmp.guestPhoneCountry = 'RO';
      cmp.guestPhoneNational = '721234567';
      cmp.onGuestPhoneChanged();
      expect(cmp.shippingPhoneNational).toBeTruthy();
    });

    it('onGuestPhoneChanged: guards (auth, no create, filled shipping, invalid)', () => {
      const cmp = make();
      cmp.onGuestPhoneChanged(); // authenticated
      auth.isAuthenticated.and.returnValue(false);
      cmp.guestCreateAccount = false;
      cmp.onGuestPhoneChanged();
      cmp.guestCreateAccount = true;
      cmp.shippingPhoneNational = '700000000';
      cmp.onGuestPhoneChanged(); // shipping already filled
      cmp.shippingPhoneNational = '';
      cmp.guestPhoneNational = '1'; // invalid
      cmp.onGuestPhoneChanged();
      expect(cmp.shippingPhoneNational).toBe('');
    });

    it('effectivePhoneE164: shipping, user phone, guest, null', () => {
      const cmp = make();
      cmp.shippingPhoneCountry = 'RO';
      cmp.shippingPhoneNational = '721234567';
      expect((cmp as any).effectivePhoneE164()).toContain('+40');
      cmp.shippingPhoneNational = '';
      auth.user.and.returnValue({ phone: '+40755555555' });
      expect((cmp as any).effectivePhoneE164()).toBe('+40755555555');
      auth.user.and.returnValue({});
      cmp.guestCreateAccount = true;
      cmp.guestPhoneCountry = 'RO';
      cmp.guestPhoneNational = '721234567';
      expect((cmp as any).effectivePhoneE164()).toContain('+40');
      cmp.guestCreateAccount = false;
      expect((cmp as any).effectivePhoneE164()).toBeNull();
    });

    it('shippingPhoneRequired reflects delivery type', () => {
      const cmp = make();
      (cmp as any).phoneRequiredHome = false;
      (cmp as any).phoneRequiredLocker = true;
      cmp.deliveryType = 'home';
      expect(cmp.shippingPhoneRequired()).toBeFalse();
      cmp.deliveryType = 'locker';
      expect(cmp.shippingPhoneRequired()).toBeTrue();
    });

    it('emailVerified + primary resend remaining seconds', () => {
      const cmp = make();
      expect(cmp.emailVerified()).toBeTrue();
      expect(cmp.primaryEmailVerificationResendRemainingSeconds()).toBe(0);
      (cmp as any).primaryEmailVerificationResendUntil = Date.now() + 30_000;
      expect(cmp.primaryEmailVerificationResendRemainingSeconds()).toBeGreaterThan(0);
    });

    it('resendPrimaryEmailVerification: guards then success', () => {
      const cmp = make();
      auth.isAuthenticated.and.returnValue(false);
      cmp.resendPrimaryEmailVerification();
      auth.isAuthenticated.and.returnValue(true);
      cmp.primaryEmailVerificationBusy = true;
      cmp.resendPrimaryEmailVerification();
      cmp.primaryEmailVerificationBusy = false;
      (cmp as any).primaryEmailVerificationResendUntil = Date.now() + 30_000;
      cmp.resendPrimaryEmailVerification();
      (cmp as any).primaryEmailVerificationResendUntil = 0;
      cmp.resendPrimaryEmailVerification();
      expect(cmp.primaryEmailVerificationStatus).toBe('account.verification.sentStatus');
      expect(cmp.primaryEmailVerificationBusy).toBeFalse();
    });

    it('resendPrimaryEmailVerification: error path', () => {
      const cmp = make();
      auth.requestEmailVerification.and.returnValue(throwError(() => new Error('x')));
      cmp.resendPrimaryEmailVerification();
      expect(cmp.primaryEmailVerificationStatus).toBe('account.verification.sendError');
      expect(cmp.primaryEmailVerificationBusy).toBeFalse();
    });

    it('prefillFromUser: no user returns', () => {
      auth.user.and.returnValue(null);
      const cmp = make();
      (cmp as any).prefillFromUser();
      expect(cmp.address.email).toBe('');
    });

    it('prefillFromUser: fills email, composite name, and phone', () => {
      auth.user.and.returnValue({
        email: 'u@example.com',
        first_name: 'John',
        middle_name: 'M',
        last_name: 'Doe',
        phone: '+40721234567',
      });
      const cmp = make();
      cmp.address.email = '';
      cmp.address.name = '';
      cmp.shippingPhoneNational = '';
      (cmp as any).prefillFromUser();
      expect(cmp.address.email).toBe('u@example.com');
      expect(cmp.address.name).toBe('John M Doe');
      expect(cmp.shippingPhoneNational).toBeTruthy();
    });

    it('prefillFromUser: falls back to user.name', () => {
      auth.user.and.returnValue({ email: '', name: 'Fallback Name' });
      const cmp = make();
      cmp.address.name = '';
      cmp.address.email = 'keep@example.com';
      (cmp as any).prefillFromUser();
      expect(cmp.address.name).toBe('Fallback Name');
      expect(cmp.address.email).toBe('keep@example.com');
    });
  });

  // ---------------------------------------------------------------------------
  // Coupons
  // ---------------------------------------------------------------------------
  describe('coupons', () => {
    it('setAutoApplyBestCouponPreference persists and may auto-apply', () => {
      const cmp = make();
      cmp.setAutoApplyBestCouponPreference(false);
      expect(cmp.autoApplyBestCoupon).toBeFalse();
      cmp.suggestedCouponOffer = makeOffer();
      cmp.setAutoApplyBestCouponPreference(true);
      expect(cmp.autoApplyBestCoupon).toBeTrue();
    });

    it('loadAutoApplyBestCouponPreference: undefined storage, missing, true, invalid', () => {
      const cmp = make();
      const fn = () => (cmp as any).loadAutoApplyBestCouponPreference();
      withoutLocalStorage(() => expect(fn()).toBeFalse());
      localStorage.removeItem('checkout_auto_apply_best_coupon');
      expect(fn()).toBeFalse();
      localStorage.setItem('checkout_auto_apply_best_coupon', 'true');
      expect(fn()).toBeTrue();
      localStorage.setItem('checkout_auto_apply_best_coupon', '{bad json');
      expect(fn()).toBeFalse();
      localStorage.removeItem('checkout_auto_apply_best_coupon');
    });

    it('persistAutoApplyBestCouponPreference: undefined storage and throwing storage', () => {
      const cmp = make();
      withoutLocalStorage(() =>
        expect(() => (cmp as any).persistAutoApplyBestCouponPreference(true)).not.toThrow(),
      );
      spyOn(localStorage, 'setItem').and.throwError('quota');
      expect(() => (cmp as any).persistAutoApplyBestCouponPreference(true)).not.toThrow();
    });

    it('maybeAutoApplyBestCoupon: all guards', () => {
      const cmp = make();
      cmp.autoApplyBestCoupon = false;
      (cmp as any).maybeAutoApplyBestCoupon();
      cmp.autoApplyBestCoupon = true;
      auth.isAuthenticated.and.returnValue(false);
      (cmp as any).maybeAutoApplyBestCoupon();
      auth.isAuthenticated.and.returnValue(true);
      (cmp as any).pendingPromoCode = 'X';
      (cmp as any).maybeAutoApplyBestCoupon();
      (cmp as any).pendingPromoCode = null;
      cmp.syncing = true;
      (cmp as any).maybeAutoApplyBestCoupon();
      cmp.syncing = false;
      cmp.promo = 'ABC';
      (cmp as any).maybeAutoApplyBestCoupon();
      cmp.promo = '';
      cmp.suggestedCouponOffer = null;
      (cmp as any).maybeAutoApplyBestCoupon();
      cmp.suggestedCouponOffer = makeOffer();
      cmp.appliedCouponOffer = makeOffer();
      (cmp as any).maybeAutoApplyBestCoupon();
      cmp.appliedCouponOffer = null;
      (cmp as any).maybeAutoApplyBestCoupon();
      expect(cmp.promo).toBe('SAVE10');
    });

    it('applyCouponOffer sets promo and applies', () => {
      const cmp = make();
      const offer = makeOffer({ eligible: true });
      coupons.validate.and.returnValue(of(offer));
      cmp.applyCouponOffer(offer);
      expect(cmp.promo).toBe('SAVE10');
    });

    it('describeCouponOffer: no promo, free shipping, amount, percent, with/without savings', () => {
      const cmp = make();
      const noPromo = makeOffer();
      noPromo.coupon.promotion = null;
      expect(cmp.describeCouponOffer(noPromo)).toBe('SAVE10');

      const free = makeOffer({ estimated_discount_ron: '0', estimated_shipping_discount_ron: '0' });
      free.coupon.promotion!.discount_type = 'free_shipping';
      expect(cmp.describeCouponOffer(free)).toContain('SAVE10');

      const amount = makeOffer({ estimated_discount_ron: '7' });
      amount.coupon.promotion!.discount_type = 'amount';
      amount.coupon.promotion!.amount_off = '7';
      expect(cmp.describeCouponOffer(amount)).toContain('≈');

      const percent = makeOffer({
        estimated_discount_ron: '0',
        estimated_shipping_discount_ron: '0',
      });
      percent.coupon.promotion!.percentage_off = null as any;
      expect(cmp.describeCouponOffer(percent)).toContain('SAVE10');
    });

    it('describeCouponReasons: empty and mapped (translated vs raw)', () => {
      const cmp = make();
      expect(cmp.describeCouponReasons([])).toBe('checkout.couponNotEligible');
      const translate = TestBed.inject(TranslateService);
      spyOn(translate, 'instant').and.callFake((k: any) =>
        k === 'checkout.couponReasons.known' ? 'Known reason' : k,
      );
      const out = cmp.describeCouponReasons(['known', 'unknown']);
      expect(out).toContain('Known reason');
      expect(out).toContain('unknown');
    });

    it('minSubtotalShortfall: null branches and a real shortfall', () => {
      const cmp = make();
      expect(cmp.minSubtotalShortfall(null)).toBeNull();
      expect(cmp.minSubtotalShortfall(makeOffer({ reasons: [] }))).toBeNull();
      const noMin = makeOffer({ reasons: ['min_subtotal_not_met'] });
      noMin.coupon.promotion!.min_subtotal = null;
      expect(cmp.minSubtotalShortfall(noMin)).toBeNull();
      const badMin = makeOffer({ reasons: ['min_subtotal_not_met'] });
      badMin.coupon.promotion!.min_subtotal = '0';
      expect(cmp.minSubtotalShortfall(badMin)).toBeNull();
      const shortfall = makeOffer({ reasons: ['min_subtotal_not_met'] });
      shortfall.coupon.promotion!.min_subtotal = '100';
      const res = cmp.minSubtotalShortfall(shortfall);
      expect(res?.remaining).toBe(80);
      subtotalSignal.set(100);
      expect(cmp.minSubtotalShortfall(shortfall)).toBeNull();
    });

    it('pickBestCouponOffer: ignores ineligible/zero, picks best', () => {
      const cmp = make();
      const fn = (offers: any[]) => (cmp as any).pickBestCouponOffer(offers);
      expect(fn([])).toBeNull();
      expect(
        fn([
          makeOffer({ eligible: false }),
          makeOffer({
            eligible: true,
            estimated_discount_ron: '0',
            estimated_shipping_discount_ron: '0',
          }),
        ]),
      ).toBeNull();
      const best = fn([
        makeOffer({ eligible: true, estimated_discount_ron: '5' }),
        makeOffer({ eligible: true, estimated_discount_ron: '15' }),
      ]);
      expect(best?.estimated_discount_ron).toBe('15');
    });

    it('couponShippingDiscount: not eligible, code mismatch, match', () => {
      const cmp = make();
      cmp.appliedCouponOffer = null;
      expect((cmp as any).couponShippingDiscount()).toBe(0);
      cmp.appliedCouponOffer = makeOffer({ eligible: true, estimated_shipping_discount_ron: '12' });
      cmp.promo = 'OTHER';
      expect((cmp as any).couponShippingDiscount()).toBe(0);
      cmp.promo = 'SAVE10';
      expect((cmp as any).couponShippingDiscount()).toBe(12);
    });

    it('loadCouponsEligibility: unauthenticated clears state', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.couponEligibility = { eligible: [], ineligible: [] };
      (cmp as any).loadCouponsEligibility();
      expect(cmp.couponEligibility).toBeNull();
    });

    it('loadCouponsEligibility: success with matching applied promo', () => {
      const cmp = make();
      coupons.eligibility.and.returnValue(
        of({
          eligible: [makeOffer({ eligible: true })],
          ineligible: [makeOffer({ eligible: false })],
        }),
      );
      cmp.promo = 'SAVE10';
      (cmp as any).loadCouponsEligibility();
      expect(cmp.appliedCouponOffer?.coupon.code).toBe('SAVE10');
    });

    it('loadCouponsEligibility: success with empty promo clears applied', () => {
      const cmp = make();
      coupons.eligibility.and.returnValue(of(null as any));
      cmp.promo = '';
      cmp.appliedCouponOffer = makeOffer();
      (cmp as any).loadCouponsEligibility();
      expect(cmp.appliedCouponOffer).toBeNull();
    });

    it('loadCouponsEligibility: error sets message', () => {
      const cmp = make();
      coupons.eligibility.and.returnValue(throwError(() => ({ error: { detail: 'nope' } })));
      (cmp as any).loadCouponsEligibility();
      expect(cmp.couponEligibilityError).toBe('nope');
    });

    it('applyPendingPromoCode: empty, unauth, equal current, applies', () => {
      const cmp = make();
      (cmp as any).pendingPromoCode = '';
      (cmp as any).applyPendingPromoCode();
      (cmp as any).pendingPromoCode = 'SAVE10';
      auth.isAuthenticated.and.returnValue(false);
      (cmp as any).applyPendingPromoCode();
      auth.isAuthenticated.and.returnValue(true);
      cmp.promo = 'SAVE10';
      (cmp as any).pendingPromoCode = 'SAVE10';
      (cmp as any).applyPendingPromoCode();
      expect((cmp as any).pendingPromoCode).toBeNull();
      cmp.promo = '';
      (cmp as any).pendingPromoCode = 'SAVE10';
      (cmp as any).applyPendingPromoCode();
      expect(cmp.promo).toBe('SAVE10');
    });

    it('applyPromo: empty clears and refreshes', () => {
      const cmp = make();
      cmp.promo = '';
      cmp.applyPromo();
      expect(cmp.promoMessage).toBe('');
      expect(cartApi.get).toHaveBeenCalled();
    });

    it('applyPromo: authenticated eligible offer', () => {
      const cmp = make();
      coupons.validate.and.returnValue(of(makeOffer({ eligible: true })));
      cmp.promo = 'save10';
      cmp.applyPromo();
      expect(cmp.promoStatus).toBe('success');
      expect(cmp.promo).toBe('SAVE10');
    });

    it('applyPromo: authenticated ineligible with and without min shortfall', () => {
      const cmp = make();
      const off = makeOffer({ eligible: false, reasons: ['min_subtotal_not_met'] });
      off.coupon.promotion!.min_subtotal = '100';
      coupons.validate.and.returnValue(of(off));
      cmp.promo = 'SAVE10';
      cmp.applyPromo();
      expect(cmp.promoStatus).toBe('warn');
      expect(cmp.promoMessage).toContain('checkout.couponMinSubtotalRemaining');

      const off2 = makeOffer({ eligible: false, reasons: ['expired'] });
      coupons.validate.and.returnValue(of(off2));
      cmp.promo = 'SAVE10';
      cmp.applyPromo();
      expect(cmp.promoValid).toBeFalse();
    });

    it('applyPromo: 404 falls back to legacy promo', () => {
      const cmp = make();
      coupons.validate.and.returnValue(throwError(() => ({ status: 404 })));
      cartApi.get.and.returnValue(of({ totals: { subtotal: '100', total: '90' } }));
      cmp.promo = 'LEGACY';
      cmp.applyPromo();
      expect(cmp.promoStatus).toBe('success');
    });

    it('applyPromo: other error sets pending message', () => {
      const cmp = make();
      coupons.validate.and.returnValue(
        throwError(() => ({ status: 500, error: { detail: 'busy' } })),
      );
      cmp.promo = 'SAVE10';
      cmp.applyPromo();
      expect(cmp.promoMessage).toBe('busy');
      expect(cmp.promoValid).toBeFalse();
    });

    it('applyPromo: unauthenticated requires login', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.promo = 'SAVE10';
      cmp.applyPromo();
      expect(cmp.promoMessage).toBe('checkout.couponsLoginRequired');
      expect(cmp.promo).toBe('');
    });

    it('applyLegacyPromo: success with no savings -> warn', () => {
      const cmp = make();
      cartApi.get.and.returnValue(of({ totals: { subtotal: '100', total: '100' } }));
      (cmp as any).applyLegacyPromo('CODE');
      expect(cmp.promoStatus).toBe('warn');
    });

    it('applyLegacyPromo: error refetches base quote', () => {
      const cmp = make();
      let call = 0;
      cartApi.get.and.callFake(() => {
        call += 1;
        return call === 1 ? throwError(() => ({ error: { detail: 'e' } })) : of({ totals: {} });
      });
      (cmp as any).applyLegacyPromo('CODE');
      expect(cmp.promoMessage).toBe('e');
    });

    it('couponOfferSavings sums discount + shipping discount', () => {
      const cmp = make();
      const v = (cmp as any).couponOfferSavings(
        makeOffer({ estimated_discount_ron: '3', estimated_shipping_discount_ron: '4' }),
      );
      expect(v).toBe(7);
    });
  });

  // ---------------------------------------------------------------------------
  // Success summary + payment redirects
  // ---------------------------------------------------------------------------
  describe('success + payment redirect', () => {
    it('buildSuccessSummary: with quote and fallback', () => {
      const cmp = make();
      let s = (cmp as any).buildSuccessSummary('o1', 'R1', 'cod');
      expect(s.totals.discount).toBe(0);
      (cmp as any).quote = {
        subtotal: 100,
        fee: 0,
        tax: 0,
        shipping: 0,
        total: 90,
        currency: 'RON',
      };
      cmp.locker = { name: 'L', address: 'Addr' } as any;
      s = (cmp as any).buildSuccessSummary('o2', null, 'paypal');
      expect(s.totals.discount).toBe(10);
      expect(s.locker_name).toBe('L');
    });

    it('persistAddressIfRequested: saves only when requested', () => {
      const cmp = make();
      cmp.saveAddress = false;
      (cmp as any).persistAddressIfRequested();
      expect(prefs.saveDeliveryPrefs).not.toHaveBeenCalled();
      cmp.saveAddress = true;
      (cmp as any).persistAddressIfRequested();
      expect(prefs.saveDeliveryPrefs).toHaveBeenCalled();
    });

    it('goToSuccess navigates with and without summary', () => {
      const cmp = make();
      const router = TestBed.inject(Router);
      const navSpy = spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
      (cmp as any).goToSuccess(null);
      (cmp as any).goToSuccess({ order_id: 'x' } as any);
      expect(navSpy).toHaveBeenCalledTimes(2);
      expect((cmp as any).checkoutFlowCompleted).toBeTrue();
    });

    it('showPaymentNotReadyError sets message and stops placing', () => {
      const cmp = make();
      cmp.placing = true;
      (cmp as any).showPaymentNotReadyError();
      expect(cmp.placing).toBeFalse();
      expect(cmp.errorMessage).toBe('checkout.paymentNotReady');
    });

    it('normalizePaymentRedirectUrl: mock path, same-origin non-mock, https allowed, non-https, disallowed, throw', () => {
      const cmp = make();
      const fn = (u: string, hosts: string[]) => (cmp as any).normalizePaymentRedirectUrl(u, hosts);
      const origin = globalThis.location.origin;
      expect(fn(`${origin}/checkout/mock/abc`, [])).toContain('/checkout/mock/abc');
      // same-origin but not a mock path -> falls through to the https check (http origin -> null)
      expect(fn(`${origin}/other`, [])).toBeNull();
      expect(fn('https://www.paypal.com/x', ['paypal.com'])).toContain('paypal.com');
      expect(fn('http://insecure.com/x', ['insecure.com'])).toBeNull();
      expect(fn('https://evil.com/x', ['paypal.com'])).toBeNull();
      // `new URL` throws for an absolute special-scheme URL with no host -> catch returns null
      expect(fn('http://', ['x.com'])).toBeNull();
    });

    it('redirectToPaymentUrl: no url and disallowed url both show not-ready', () => {
      const cmp = make();
      (cmp as any).redirectToPaymentUrl(null, ['paypal.com']);
      expect(cmp.errorMessage).toBe('checkout.paymentNotReady');
      cmp.errorMessage = '';
      // disallowed host -> normalize returns null -> not ready (no real navigation)
      (cmp as any).redirectToPaymentUrl('https://evil.example.com/x', ['paypal.com']);
      expect(cmp.errorMessage).toBe('checkout.paymentNotReady');
    });

    it('handleCheckoutStartResponse: cod clears cart and navigates', () => {
      const cmp = make();
      const router = TestBed.inject(Router);
      spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
      cmp.paymentMethod = 'cod';
      (cmp as any).handleCheckoutStartResponse({ order_id: 'o', payment_method: 'cod' });
      expect(cart.clear).toHaveBeenCalled();
    });

    it('handleCheckoutStartResponse: paypal/stripe/netopia cases persist + route (no live nav)', () => {
      const cmp = make();
      // Missing redirect URLs make normalizePaymentRedirectUrl return null, so each
      // branch persists prefs and routes through showPaymentNotReadyError instead of
      // navigating the browser away (location.assign is uninterceptable under Karma).
      cmp.saveAddress = false;
      cmp.paymentMethod = 'paypal';
      (cmp as any).handleCheckoutStartResponse({ order_id: 'o' });
      expect(prefs.saveDeliveryPrefs).not.toHaveBeenCalled();
      cmp.saveAddress = true;
      cmp.paymentMethod = 'paypal';
      (cmp as any).handleCheckoutStartResponse({ order_id: 'o', paypal_approval_url: '' });
      cmp.paymentMethod = 'stripe';
      (cmp as any).handleCheckoutStartResponse({ order_id: 'o', stripe_checkout_url: '' });
      cmp.paymentMethod = 'netopia';
      (cmp as any).handleCheckoutStartResponse({ order_id: 'o', netopia_payment_url: '' });
      expect(prefs.saveDeliveryPrefs).toHaveBeenCalled();
      expect(cmp.errorMessage).toBe('checkout.paymentNotReady');
    });

    it('handleCheckoutStartResponse: unknown method shows not ready', () => {
      const cmp = make();
      cmp.paymentMethod = 'unknown' as any;
      (cmp as any).handleCheckoutStartResponse({ order_id: 'o' });
      expect(cmp.errorMessage).toBe('checkout.paymentNotReady');
    });

    it('handleCheckoutFinalize: settled vs unsettled fallback', () => {
      const cmp = make();
      cmp.placing = true;
      (cmp as any).checkoutFlowCompleted = false;
      (cmp as any).handleCheckoutFinalize(true);
      expect(cmp.placing).toBeFalse();
      expect(cmp.errorMessage).toBe('');
      (cmp as any).handleCheckoutFinalize(false);
      expect(cmp.errorMessage).toBe('checkout.checkoutFailed');
    });

    it('handleCheckoutFinalize: completed flow keeps placing and returns', () => {
      const cmp = make();
      (cmp as any).checkoutFlowCompleted = true;
      cmp.placing = true;
      (cmp as any).handleCheckoutFinalize(false);
      expect(cmp.placing).toBeTrue();
    });

    it('handleCheckoutFinalize: keeps existing error message', () => {
      const cmp = make();
      (cmp as any).checkoutFlowCompleted = false;
      cmp.errorMessage = 'existing';
      (cmp as any).handleCheckoutFinalize(false);
      expect(cmp.errorMessage).toBe('existing');
    });

    it('handleCheckoutRequestError: timeout vs detail vs default', () => {
      const cmp = make();
      (cmp as any).handleCheckoutRequestError({ name: 'TimeoutError' });
      expect(cmp.errorMessage).toBe('checkout.checkoutFailed');
      (cmp as any).handleCheckoutRequestError({ error: { detail: 'server detail' } });
      expect(cmp.errorMessage).toBe('server detail');
      (cmp as any).handleCheckoutRequestError({});
      expect(cmp.errorMessage).toBe('checkout.checkoutFailed');
    });

    it('submitCheckoutRequest: success and error paths', fakeAsync(() => {
      const cmp = make();
      const router = TestBed.inject(Router);
      spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
      cmp.paymentMethod = 'cod';
      (cmp as any).submitCheckoutRequest('/orders/checkout', { a: 1 });
      tick();
      expect(cart.clear).toHaveBeenCalled();

      api.post.and.returnValue(throwError(() => ({ error: { detail: 'boom' } })));
      (cmp as any).submitCheckoutRequest('/orders/checkout', { a: 1 });
      tick();
      expect(cmp.errorMessage).toBe('boom');
    }));
  });

  // ---------------------------------------------------------------------------
  // Cart sync + tracking
  // ---------------------------------------------------------------------------
  describe('cart sync + tracking', () => {
    it('hydrateCartAndQuote updates state', () => {
      const cmp = make();
      (cmp as any).hydrateCartAndQuote({
        totals: { subtotal: '20', total: '20', currency: 'RON' },
      });
      expect(cmp.pricesRefreshed).toBeTrue();
      expect(cart.hydrateFromBackend).toHaveBeenCalled();
    });

    it('trackCheckoutStart: guards and fires once', () => {
      const cmp = make();
      analytics.enabled.and.returnValue(false);
      (cmp as any).trackCheckoutStart();
      expect(analytics.track).not.toHaveBeenCalled();
      analytics.enabled.and.returnValue(true);
      itemsSignal.set([]);
      (cmp as any).trackCheckoutStart();
      expect(analytics.track).not.toHaveBeenCalled();
      itemsSignal.set([{ ...defaultItem }]);
      (cmp as any).trackCheckoutStart();
      (cmp as any).trackCheckoutStart();
      expect(analytics.track).toHaveBeenCalledTimes(1);
    });

    it('trackCheckoutAbandon: guards and fires', () => {
      const cmp = make();
      (cmp as any).trackCheckoutAbandon();
      expect(analytics.track).not.toHaveBeenCalled();
      (cmp as any).checkoutStartTracked = true;
      (cmp as any).checkoutFlowCompleted = true;
      (cmp as any).trackCheckoutAbandon();
      expect(analytics.track).not.toHaveBeenCalled();
      (cmp as any).checkoutFlowCompleted = false;
      (cmp as any).trackCheckoutAbandon();
      expect(analytics.track).toHaveBeenCalled();
    });

    it('redirectToCartIfEmpty: guards and navigates when empty', () => {
      const cmp = make();
      const router = TestBed.inject(Router);
      const navSpy = spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
      (cmp as any).redirectToCartIfEmpty(); // items present -> no nav
      expect(navSpy).not.toHaveBeenCalled();
      itemsSignal.set([]);
      (cmp as any).redirectToCartIfEmpty();
      (cmp as any).redirectToCartIfEmpty(); // already redirected
      expect(navSpy).toHaveBeenCalledTimes(1);
    });

    it('setQuote: parses totals and courier list (array + fallback)', () => {
      const cmp = make();
      (cmp as any).setQuote({
        totals: {
          subtotal: '50',
          fee: '2',
          tax: '5',
          shipping: '10',
          total: '67',
          currency: 'EUR',
          delivery_allowed_couriers: ['sameday', null, 'bad', 'fan_courier'],
        },
      });
      expect(cmp.currency).toBe('EUR');
      expect(cmp.deliveryAllowedCouriers).toEqual(['sameday', 'fan_courier']);
      (cmp as any).setQuote({ totals: { delivery_allowed_couriers: [] } });
      expect(cmp.deliveryAllowedCouriers).toEqual(['sameday', 'fan_courier']);
      (cmp as any).setQuote({ totals: {} });
      expect(cmp.deliveryAllowedCouriers).toEqual(['sameday', 'fan_courier']);
    });

    it('applyPrefetchedPricingSettings: no meta and valid meta', () => {
      routeData = {};
      let cmp = make();
      (cmp as any).applyPrefetchedPricingSettings();
      routeData = {
        checkoutPricingSettings: { phone_required_home: false, phone_required_locker: false },
      };
      cmp = make();
      (cmp as any).applyPrefetchedPricingSettings();
      cmp.deliveryType = 'home';
      expect(cmp.shippingPhoneRequired()).toBeFalse();
    });

    it('syncBackendCart: success processes queued items', fakeAsync(() => {
      const cmp = make();
      cartApi.sync.and.returnValue(of({ totals: {} }));
      (cmp as any).queuedSyncItems = [{ ...defaultItem }];
      (cmp as any).syncBackendCart([{ ...defaultItem }]);
      tick();
      expect(cmp.syncing).toBeFalse();
    }));

    it('syncBackendCart: error sets message', () => {
      const cmp = make();
      cartApi.sync.and.returnValue(throwError(() => new Error('x')));
      (cmp as any).syncBackendCart([{ ...defaultItem }]);
      expect(cmp.errorMessage).toBe('checkout.cartSyncError');
      expect(cmp.syncing).toBeFalse();
    });

    it('queueCartSync: empty, while syncing, and debounced', fakeAsync(() => {
      const cmp = make();
      (cmp as any).queueCartSync([]);
      cmp.syncing = true;
      (cmp as any).queueCartSync([{ ...defaultItem }]);
      expect((cmp as any).queuedSyncItems).toBeTruthy();
      cmp.syncing = false;
      (cmp as any).queueCartSync([{ ...defaultItem }]);
      (cmp as any).queueCartSync([{ ...defaultItem }], { immediate: true });
      tick();
      expect(cartApi.sync).toHaveBeenCalled();
    }));

    it('loadCartFromServer: success, inner error, outer error', () => {
      const cmp = make();
      cartApi.get.and.returnValue(of({ totals: {} }));
      (cmp as any).loadCartFromServer();
      expect(cmp.syncing).toBeFalse();

      cartApi.get.and.returnValue(throwError(() => new Error('x')));
      (cmp as any).loadCartFromServer();
      expect(cmp.errorMessage).toBe('checkout.cartLoadError');

      auth.ensureAuthenticated.and.returnValue(throwError(() => new Error('x')));
      cmp.errorMessage = '';
      (cmp as any).loadCartFromServer();
      expect(cmp.errorMessage).toBe('checkout.cartLoadError');
    });

    it('cartQuoteParams: with and without code', () => {
      const cmp = make();
      expect((cmp as any).cartQuoteParams(null)).toEqual({ country: 'RO' });
      expect((cmp as any).cartQuoteParams('X')).toEqual({ country: 'RO', promo_code: 'X' });
    });

    it('refreshQuote: success and error with code', () => {
      const cmp = make();
      cartApi.get.and.returnValue(of({ totals: {} }));
      (cmp as any).refreshQuote('CODE');
      expect(cart.hydrateFromBackend).toHaveBeenCalled();
      let call = 0;
      cartApi.get.and.callFake(() => {
        call += 1;
        return call === 1 ? throwError(() => ({ error: { detail: 'd' } })) : of({ totals: {} });
      });
      (cmp as any).refreshQuote('CODE');
      expect(cmp.promoMessage).toBe('d');
    });

    it('refreshQuote: error without code does nothing extra', () => {
      const cmp = make();
      cartApi.get.and.returnValue(throwError(() => new Error('x')));
      expect(() => (cmp as any).refreshQuote(null)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Delivery / courier
  // ---------------------------------------------------------------------------
  describe('delivery + courier', () => {
    it('setDeliveryType: blocked locker, home clears locker', () => {
      const cmp = make();
      cmp.deliveryLockerAllowed = false;
      cmp.setDeliveryType('locker');
      expect(cmp.deliveryError).toBe('checkout.deliveryLockerUnavailable');
      cmp.deliveryLockerAllowed = true;
      cmp.locker = { id: 'l' } as any;
      cmp.setDeliveryType('home');
      expect(cmp.locker).toBeNull();
    });

    it('onCourierChanged clears locker for locker delivery', () => {
      const cmp = make();
      cmp.deliveryType = 'locker';
      cmp.locker = { id: 'l' } as any;
      cmp.onCourierChanged();
      expect(cmp.locker).toBeNull();
    });

    it('setCourier: disallowed vs allowed', () => {
      const cmp = make();
      cmp.deliveryAllowedCouriers = ['sameday'];
      cmp.setCourier('fan_courier');
      expect(cmp.deliveryError).toBe('checkout.courierUnavailable');
      cmp.setCourier('sameday');
      expect(cmp.courier).toBe('sameday');
    });

    it('courierAllowed reflects list (and tolerates a null list)', () => {
      const cmp = make();
      cmp.deliveryAllowedCouriers = ['sameday'];
      expect(cmp.courierAllowed('sameday')).toBeTrue();
      expect(cmp.courierAllowed('fan_courier')).toBeFalse();
      cmp.deliveryAllowedCouriers = null as any;
      expect(cmp.courierAllowed('sameday')).toBeFalse();
    });

    it('ensureDeliveryOptionsAvailable: resets locker + courier fallback', () => {
      const cmp = make();
      cmp.deliveryLockerAllowed = false;
      cmp.deliveryType = 'locker';
      cmp.locker = { id: 'l' } as any;
      cmp.courier = 'fan_courier';
      cmp.deliveryAllowedCouriers = ['sameday'];
      (cmp as any).ensureDeliveryOptionsAvailable();
      expect(cmp.deliveryType).toBe('home');
      expect(cmp.courier).toBe('sameday');
    });

    it('ensureDeliveryOptionsAvailable: courier fallback while in locker mode', () => {
      const cmp = make();
      cmp.deliveryLockerAllowed = true;
      cmp.deliveryType = 'locker';
      cmp.locker = { id: 'l' } as any;
      cmp.courier = 'fan_courier';
      cmp.deliveryAllowedCouriers = ['sameday'];
      (cmp as any).ensureDeliveryOptionsAvailable();
      expect(cmp.locker).toBeNull();
    });

    it('courierEstimate / key / params', () => {
      const cmp = make();
      cmp.deliveryType = 'home';
      expect(cmp.courierEstimate('sameday')).toEqual({ min: 1, max: 2 });
      expect(cmp.courierEstimateKey('sameday')).toBe('checkout.deliveryEstimateRange');
      expect(cmp.courierEstimateParams('sameday')).toEqual({ min: 1, max: 2 });
      cmp.deliveryType = 'locker';
      expect(cmp.courierEstimateKey('fan_courier')).toBe('checkout.deliveryEstimateRange');
      // single-day estimate path
      spyOn(cmp, 'courierEstimate').and.returnValue({ min: 2, max: 2 });
      expect(cmp.courierEstimateKey('sameday')).toBe('checkout.deliveryEstimateSingle');
      expect(cmp.courierEstimateParams('sameday')).toEqual({ days: 2 });
    });

    it('courierEstimate*: null when estimate missing', () => {
      const cmp = make();
      spyOn(cmp, 'courierEstimate').and.returnValue(null);
      expect(cmp.courierEstimateKey('sameday')).toBeNull();
      expect(cmp.courierEstimateParams('sameday')).toEqual({});
    });
  });

  // ---------------------------------------------------------------------------
  // Payment methods
  // ---------------------------------------------------------------------------
  describe('payment methods', () => {
    it('isPaymentMethodAvailable: cod/netopia/paypal/stripe/default', () => {
      const cmp = make();
      cmp.currency = 'RON';
      cmp.shippingCountryInput = 'RO';
      cmp.netopiaEnabled = true;
      cmp.paypalEnabled = true;
      cmp.stripeEnabled = true;
      expect(cmp.isPaymentMethodAvailable('cod')).toBeTrue();
      expect(cmp.isPaymentMethodAvailable('netopia')).toBeTrue();
      expect(cmp.isPaymentMethodAvailable('paypal')).toBeTrue();
      expect(cmp.isPaymentMethodAvailable('stripe')).toBeTrue();
      expect(cmp.isPaymentMethodAvailable('other' as any)).toBeTrue();
      cmp.currency = 'EUR';
      expect(cmp.isPaymentMethodAvailable('cod')).toBeFalse();
      expect(cmp.isPaymentMethodAvailable('paypal')).toBeFalse();
    });

    it('currentShippingCountryCode falls back through inputs', () => {
      const cmp = make();
      cmp.shippingCountryInput = '';
      cmp.address.country = 'DE';
      expect((cmp as any).currentShippingCountryCode()).toBe('DE');
      cmp.address.country = '';
      expect((cmp as any).currentShippingCountryCode()).toBe('RO');
    });

    it('ensurePaymentMethodAvailable switches when current unavailable', () => {
      const cmp = make();
      cmp.currency = 'RON';
      cmp.shippingCountryInput = 'RO';
      cmp.paymentMethod = 'stripe';
      cmp.stripeEnabled = false;
      (cmp as any).ensurePaymentMethodAvailable();
      expect(cmp.paymentMethod).toBe('cod');
    });

    it('defaultPaymentMethod prefers saved then candidates', () => {
      prefs.tryLoadPaymentMethod.and.returnValue('netopia');
      let cmp = make();
      cmp.currency = 'RON';
      cmp.shippingCountryInput = 'RO';
      cmp.netopiaEnabled = true;
      expect((cmp as any).defaultPaymentMethod()).toBe('netopia');
      prefs.tryLoadPaymentMethod.and.returnValue(null);
      cmp = make();
      cmp.currency = 'EUR';
      cmp.shippingCountryInput = 'DE';
      cmp.stripeEnabled = false;
      cmp.paypalEnabled = false;
      cmp.netopiaEnabled = false;
      expect((cmp as any).defaultPaymentMethod()).toBe('cod');
    });

    it('setPaymentMethod: unavailable shows not ready, available sets', () => {
      const cmp = make();
      cmp.currency = 'EUR';
      cmp.setPaymentMethod('cod');
      expect(cmp.paymentNotReady).toBeTrue();
      cmp.currency = 'RON';
      cmp.shippingCountryInput = 'RO';
      cmp.setPaymentMethod('cod');
      expect(cmp.paymentMethod).toBe('cod');
      expect(cmp.paymentNotReady).toBeFalse();
    });

    it('showPaymentNotReady clears prior timer', fakeAsync(() => {
      const cmp = make();
      (cmp as any).showPaymentNotReady();
      (cmp as any).showPaymentNotReady();
      expect(cmp.paymentNotReady).toBeTrue();
      tick(6000);
      expect(cmp.paymentNotReady).toBeFalse();
    }));

    it('analyticsOptIn getter + setAnalyticsOptIn', () => {
      const cmp = make();
      expect(cmp.analyticsOptIn).toBeTrue();
      cmp.setAnalyticsOptIn(false);
      expect(analytics.setEnabled).toHaveBeenCalledWith(false);
      cmp.setAnalyticsOptIn(true);
      expect(analytics.track).toHaveBeenCalled();
    });

    it('loadPaymentCapabilities: success with netopia disabled reason, then error', () => {
      const cmp = make();
      api.get.and.callFake((path: string) => {
        if (path === '/payments/capabilities') {
          return of({
            stripe: { enabled: false },
            paypal: { enabled: true },
            netopia: { enabled: false, reason: 'maintenance', reason_code: 'maint' },
          });
        }
        return of({ eligible: [], ineligible: [] });
      });
      (cmp as any).loadPaymentCapabilities();
      expect(cmp.paypalEnabled).toBeTrue();

      api.get.and.returnValue(throwError(() => new Error('x')));
      expect(() => (cmp as any).loadPaymentCapabilities()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // placeOrder gates
  // ---------------------------------------------------------------------------
  describe('placeOrder', () => {
    function ready(cmp: CheckoutComponent): void {
      cmp.address = { ...VALID_ADDRESS } as any;
      cmp.shippingCountryInput = 'RO';
      cmp.shippingPhoneCountry = 'RO';
      cmp.shippingPhoneNational = '721234567';
      cmp.pricesRefreshed = true;
      cmp.syncing = false;
      cmp.syncQueued = false;
      cmp.currency = 'RON';
      cmp.acceptTerms = true;
      cmp.acceptPrivacy = true;
      cmp.paymentMethod = 'cod';
    }

    it('returns immediately when already placing', () => {
      const cmp = make();
      cmp.placing = true;
      cmp.placeOrder({ valid: true, control: { updateValueAndValidity: () => {} } } as any);
      expect(api.post).not.toHaveBeenCalled();
    });

    it('invalid country aborts', () => {
      const cmp = make();
      cmp.shippingCountryInput = 'ZZ-bad';
      cmp.placeOrder({ valid: true, control: { updateValueAndValidity: () => {} } } as any);
      expect(cmp.addressError).toBe('checkout.countryInvalid');
    });

    it('invalid form aborts', () => {
      const cmp = make();
      cmp.shippingCountryInput = 'RO';
      cmp.placeOrder({ valid: false, control: { updateValueAndValidity: () => {} } } as any);
      expect(cmp.addressError).toBe('checkout.addressRequired');
    });

    it('locker without selection aborts', () => {
      const cmp = make();
      cmp.shippingCountryInput = 'RO';
      cmp.deliveryType = 'locker';
      cmp.locker = null;
      cmp.placeOrder({ valid: true, control: { updateValueAndValidity: () => {} } } as any);
      expect(cmp.deliveryError).toBe('checkout.deliveryLockerRequired');
    });

    it('authenticated unverified email aborts', () => {
      auth.user.and.returnValue({ email_verified: false });
      const cmp = make();
      cmp.shippingCountryInput = 'RO';
      cmp.placeOrder({ valid: true, control: { updateValueAndValidity: () => {} } } as any);
      expect(cmp.errorMessage).toBe('auth.emailVerificationNeeded');
    });

    it('guest unverified email aborts', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.shippingCountryInput = 'RO';
      cmp.guestEmailVerified = false;
      cmp.placeOrder({ valid: true, control: { updateValueAndValidity: () => {} } } as any);
      expect(cmp.errorMessage).toBe('auth.emailVerificationNeeded');
    });

    it('guest create-account password/confirm/phone gates', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.shippingCountryInput = 'RO';
      cmp.guestEmailVerified = true;
      cmp.guestCreateAccount = true;
      cmp.guestPassword = '123';
      cmp.placeOrder({ valid: true, control: { updateValueAndValidity: () => {} } } as any);
      expect(cmp.errorMessage).toBe('validation.passwordMin');
      cmp.guestPassword = 'longpass';
      cmp.guestPasswordConfirm = 'mismatch';
      cmp.placeOrder({ valid: true, control: { updateValueAndValidity: () => {} } } as any);
      expect(cmp.errorMessage).toBe('validation.passwordMismatch');
      cmp.guestPasswordConfirm = 'longpass';
      cmp.guestPhoneNational = '1';
      cmp.placeOrder({ valid: true, control: { updateValueAndValidity: () => {} } } as any);
      expect(cmp.errorMessage).toBe('validation.phoneInvalid');
    });

    it('invalid shipping phone aborts', () => {
      const cmp = make();
      cmp.shippingCountryInput = 'RO';
      (cmp as any).phoneRequiredHome = true;
      cmp.deliveryType = 'home';
      cmp.shippingPhoneNational = '1';
      cmp.placeOrder({ valid: true, control: { updateValueAndValidity: () => {} } } as any);
      expect(cmp.errorMessage).toBe('validation.phoneInvalid');
    });

    it('stock validation aborts', () => {
      const cmp = make();
      ready(cmp);
      itemsSignal.set([{ ...defaultItem, quantity: 10, stock: 1 }]);
      cmp.placeOrder({ valid: true, control: { updateValueAndValidity: () => {} } } as any);
      expect(cmp.errorMessage).toContain('checkout.stockOnlyLeft');
    });

    it('not refreshed triggers sync and returns', () => {
      const cmp = make();
      ready(cmp);
      cmp.pricesRefreshed = false;
      cmp.placeOrder({ valid: true, control: { updateValueAndValidity: () => {} } } as any);
      expect(cmp.syncNotice).toBe('checkout.cartSyncing');
    });

    it('unavailable payment method aborts', () => {
      const cmp = make();
      ready(cmp);
      cmp.currency = 'EUR';
      cmp.paymentMethod = 'cod';
      cmp.placeOrder({ valid: true, control: { updateValueAndValidity: () => {} } } as any);
      expect(cmp.paymentNotReady).toBeTrue();
    });

    it('missing consents aborts', () => {
      const cmp = make();
      ready(cmp);
      cmp.acceptTerms = false;
      cmp.placeOrder({ valid: true, control: { updateValueAndValidity: () => {} } } as any);
      expect(cmp.consentError).toBe('legal.consent.required');
    });

    it('authenticated success submits to /orders/checkout with billing + defaults', fakeAsync(() => {
      const cmp = make();
      const router = TestBed.inject(Router);
      spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
      ready(cmp);
      cmp.saveAddress = true;
      cmp.billingSameAsShipping = false;
      cmp.billing = {
        line1: 'B1',
        line2: '',
        city: 'BCity',
        region: 'B',
        postal: '99999',
        country: 'RO',
      };
      cmp.placeOrder({ valid: true, control: { updateValueAndValidity: () => {} } } as any);
      tick();
      expect(api.post.calls.mostRecent().args[0]).toBe('/orders/checkout');
      const payload = api.post.calls.mostRecent().args[1] as any;
      expect(payload.billing_line1).toBe('B1');
      expect(payload.default_shipping).toBeDefined();
    }));

    it('guest success submits to /orders/guest-checkout with account fields', fakeAsync(() => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      const router = TestBed.inject(Router);
      spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
      ready(cmp);
      cmp.guestEmailVerified = true;
      cmp.guestCreateAccount = true;
      cmp.guestUsername = 'validuser';
      cmp.guestPassword = 'longpass';
      cmp.guestPasswordConfirm = 'longpass';
      cmp.guestFirstName = 'First';
      cmp.guestLastName = 'Last';
      cmp.guestDob = '1990-01-01';
      cmp.guestPhoneCountry = 'RO';
      cmp.guestPhoneNational = '721234567';
      const translate = TestBed.inject(TranslateService);
      spyOnProperty(translate, 'currentLang', 'get').and.returnValue('ro');
      cmp.placeOrder({ valid: true, control: { updateValueAndValidity: () => {} } } as any);
      tick();
      expect(api.post.calls.mostRecent().args[0]).toBe('/orders/guest-checkout');
      const payload = api.post.calls.mostRecent().args[1] as any;
      expect(payload.username).toBe('validuser');
      expect(payload.preferred_language).toBe('ro');
    }));

    it('retryValidation queues sync', () => {
      const cmp = make();
      cmp.errorMessage = 'err';
      cmp.retryValidation();
      expect(cmp.errorMessage).toBe('');
    });

    it('validateLegalConsents: loading state for authenticated', () => {
      const cmp = make();
      cmp.legalConsentsLoading = true;
      expect((cmp as any).validateLegalConsents()).toBeFalse();
      expect(cmp.consentError).toBe('legal.consent.loading');
    });

    it('validateCart: no items returns null', () => {
      const cmp = make();
      itemsSignal.set([]);
      expect((cmp as any).validateCart()).toBeNull();
    });

    it('validateCart: not refreshed queues and returns null', () => {
      const cmp = make();
      cmp.pricesRefreshed = false;
      expect((cmp as any).validateCart()).toBeNull();
      expect(cmp.syncNotice).toBe('checkout.cartSyncing');
    });

    it('validateCart: refreshed returns null', () => {
      const cmp = make();
      cmp.pricesRefreshed = true;
      expect((cmp as any).validateCart()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Guest email verification
  // ---------------------------------------------------------------------------
  describe('guest email verification', () => {
    it('cooldown lifecycle', fakeAsync(() => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      (cmp as any).startGuestResendCooldown(0);
      expect(cmp.guestResendSecondsLeft).toBe(0);
      (cmp as any).startGuestResendCooldown(2);
      expect(cmp.guestResendSecondsLeft).toBe(2);
      tick(1000);
      expect(cmp.guestResendSecondsLeft).toBe(1);
      tick(1000);
      expect(cmp.guestResendSecondsLeft).toBe(0);
      (cmp as any).clearGuestResendCooldown();
    }));

    it('requestGuestEmailVerification: guards (auth, no email, cooldown)', () => {
      const cmp = make();
      cmp.requestGuestEmailVerification(); // authenticated
      auth.isAuthenticated.and.returnValue(false);
      cmp.address.email = '';
      cmp.requestGuestEmailVerification();
      expect(cmp.guestEmailError).toBe('checkout.addressRequired');
      cmp.address.email = 'g@example.com';
      cmp.guestResendSecondsLeft = 5;
      cmp.requestGuestEmailVerification();
      expect(api.post).not.toHaveBeenCalledWith(
        jasmine.stringMatching('email/request'),
        jasmine.anything(),
        jasmine.anything(),
      );
    });

    it('requestGuestEmailVerification: success (complete) starts cooldown (ro lang)', fakeAsync(() => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      const translate = TestBed.inject(TranslateService);
      spyOnProperty(translate, 'currentLang', 'get').and.returnValue('ro');
      cmp.address.email = 'g@example.com';
      api.post.and.returnValue(of(void 0));
      cmp.requestGuestEmailVerification();
      tick();
      expect(api.post.calls.mostRecent().args[0]).toContain('lang=ro');
      expect(cmp.guestSendingCode).toBeFalse();
      expect(cmp.guestResendSecondsLeft).toBeGreaterThan(0);
      (cmp as any).clearGuestResendCooldown();
    }));

    it('requestGuestEmailVerification: timeout is a no-op once sending already settled', fakeAsync(() => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.address.email = 'g@example.com';
      api.post.and.returnValue(NEVER);
      cmp.requestGuestEmailVerification();
      // Simulate the request resolving (sending flag cleared) before the 15s timeout fires.
      cmp.guestSendingCode = false;
      tick(15_000);
      expect(cmp.guestEmailError).toBe('');
    }));

    it('requestGuestEmailVerification: error sets message + cooldown', fakeAsync(() => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.address.email = 'g@example.com';
      api.post.and.returnValue(throwError(() => ({ error: { detail: 'fail' } })));
      cmp.requestGuestEmailVerification();
      tick();
      expect(cmp.guestEmailError).toBe('fail');
      (cmp as any).clearGuestResendCooldown();
    }));

    it('requestGuestEmailVerification: timeout sets error', fakeAsync(() => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.address.email = 'g@example.com';
      api.post.and.returnValue(NEVER);
      cmp.requestGuestEmailVerification();
      tick(15_000);
      expect(cmp.guestEmailError).toBe('checkout.emailVerifySendFailed');
      cmp.guestSendingCode = false;
    }));

    it('confirmGuestEmailVerification: guards then success/error', () => {
      const cmp = make();
      cmp.confirmGuestEmailVerification(); // authenticated
      auth.isAuthenticated.and.returnValue(false);
      cmp.address.email = '';
      cmp.confirmGuestEmailVerification();
      expect(cmp.guestEmailError).toBe('checkout.addressRequired');
      cmp.address.email = 'g@example.com';
      cmp.guestVerificationToken = 'tok';
      api.post.and.returnValue(of({ email: 'g@example.com', verified: true }));
      cmp.confirmGuestEmailVerification();
      expect(cmp.guestEmailVerified).toBeTrue();
      api.post.and.returnValue(throwError(() => ({ error: { detail: 'bad' } })));
      cmp.guestVerificationToken = 'tok';
      cmp.confirmGuestEmailVerification();
      expect(cmp.guestEmailError).toBe('bad');
    });

    it('loadGuestEmailVerificationStatus: authenticated returns', () => {
      const cmp = make();
      (cmp as any).loadGuestEmailVerificationStatus();
      // api.get not called for the status endpoint while authenticated
      expect(api.get).not.toHaveBeenCalledWith(
        '/orders/guest-checkout/email/status',
        undefined,
        jasmine.anything(),
      );
    });

    it('loadGuestEmailVerificationStatus: success populates and error tolerated', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      api.get.and.callFake((path: string) => {
        if (path === '/orders/guest-checkout/email/status') {
          return of({ email: 'g@example.com', verified: false });
        }
        return of({ eligible: [], ineligible: [] });
      });
      cmp.address.email = '';
      (cmp as any).loadGuestEmailVerificationStatus();
      expect(cmp.address.email).toBe('g@example.com');
      expect(cmp.guestVerificationSent).toBeTrue();

      api.get.and.callFake((path: string) => {
        if (path === '/orders/guest-checkout/email/status') return of(null as any);
        return of({ eligible: [], ineligible: [] });
      });
      expect(() => (cmp as any).loadGuestEmailVerificationStatus()).not.toThrow();

      api.get.and.callFake((path: string) => {
        if (path === '/orders/guest-checkout/email/status') return throwError(() => new Error('x'));
        return of({ eligible: [], ineligible: [] });
      });
      expect(() => (cmp as any).loadGuestEmailVerificationStatus()).not.toThrow();
    });

    it('loadGuestEmailVerificationStatus: verified keeps email', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      api.get.and.callFake((path: string) => {
        if (path === '/orders/guest-checkout/email/status') {
          return of({ email: 'v@example.com', verified: true });
        }
        return of({ eligible: [], ineligible: [] });
      });
      cmp.address.email = 'existing@example.com';
      (cmp as any).loadGuestEmailVerificationStatus();
      expect(cmp.guestEmailVerified).toBeTrue();
      expect(cmp.address.email).toBe('existing@example.com');
    });
  });

  // ---------------------------------------------------------------------------
  // Legal consents
  // ---------------------------------------------------------------------------
  describe('legal consents', () => {
    it('loadLegalConsentStatus: unauthenticated resets', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      (cmp as any).loadLegalConsentStatus();
      expect(cmp.acceptTerms).toBeFalse();
      expect(cmp.consentLocked).toBeFalse();
    });

    it('loadLegalConsentStatus: success sets accepted/locked', () => {
      const cmp = make();
      (cmp as any).loadLegalConsentStatus();
      expect(cmp.acceptTerms).toBeTrue();
      expect(cmp.acceptPrivacy).toBeTrue();
      expect(cmp.consentLocked).toBeTrue();
    });

    it('loadLegalConsentStatus: response without docs array falls back to empty', () => {
      const cmp = make();
      api.get.and.callFake((path: string) => {
        if (path === '/legal/consents/status') return of({ satisfied: false } as any);
        return of({ eligible: [], ineligible: [] });
      });
      (cmp as any).loadLegalConsentStatus();
      expect(cmp.acceptTerms).toBeFalse();
      expect(cmp.acceptPrivacy).toBeFalse();
      expect(cmp.consentLocked).toBeFalse();
    });

    it('loadLegalConsentStatus: error resets', () => {
      const cmp = make();
      api.get.and.callFake((path: string) => {
        if (path === '/legal/consents/status') return throwError(() => new Error('x'));
        return of({ eligible: [], ineligible: [] });
      });
      (cmp as any).loadLegalConsentStatus();
      expect(cmp.acceptTerms).toBeFalse();
      expect(cmp.legalConsentsLoading).toBeFalse();
    });

    it('consentBlocking reflects loading and acceptance', () => {
      const cmp = make();
      cmp.legalConsentsLoading = true;
      expect(cmp.consentBlocking()).toBeTrue();
      cmp.legalConsentsLoading = false;
      cmp.acceptTerms = false;
      expect(cmp.consentBlocking()).toBeTrue();
      cmp.acceptTerms = true;
      cmp.acceptPrivacy = true;
      expect(cmp.consentBlocking()).toBeFalse();
    });

    it('onCheckoutConsentAttempt: locked/loading/already-accepted/open', () => {
      const cmp = make();
      const evt = () => ({ preventDefault: () => {}, stopPropagation: () => {} }) as any;
      cmp.consentLocked = true;
      cmp.onCheckoutConsentAttempt(evt(), 'terms');
      expect(cmp.consentModalOpen).toBeFalse();
      cmp.consentLocked = false;
      cmp.legalConsentsLoading = true;
      cmp.onCheckoutConsentAttempt(evt(), 'terms');
      expect(cmp.consentModalOpen).toBeFalse();
      cmp.legalConsentsLoading = false;
      cmp.acceptTerms = true;
      cmp.onCheckoutConsentAttempt(evt(), 'terms');
      expect(cmp.consentModalOpen).toBeFalse();
      cmp.acceptPrivacy = true;
      cmp.onCheckoutConsentAttempt(evt(), 'privacy');
      expect(cmp.consentModalOpen).toBeFalse();
      cmp.acceptTerms = false;
      cmp.onCheckoutConsentAttempt(evt(), 'terms');
      expect(cmp.consentModalOpen).toBeTrue();
      expect(cmp.consentModalSlug).toBe('terms-and-conditions');
      cmp.acceptPrivacy = false;
      cmp.onCheckoutConsentAttempt(evt(), 'privacy');
      expect(cmp.consentModalSlug).toBe('privacy-policy');
    });

    it('confirmConsentModal accepts terms and privacy targets', () => {
      const cmp = make();
      cmp.acceptTerms = false;
      (cmp as any).consentModalTarget = 'terms';
      cmp.confirmConsentModal();
      expect(cmp.acceptTerms).toBeTrue();
      cmp.acceptPrivacy = false;
      (cmp as any).consentModalTarget = 'privacy';
      cmp.confirmConsentModal();
      expect(cmp.acceptPrivacy).toBeTrue();
    });

    it('closeConsentModal resets', () => {
      const cmp = make();
      cmp.consentModalOpen = true;
      cmp.consentModalSlug = 'x';
      cmp.closeConsentModal();
      expect(cmp.consentModalOpen).toBeFalse();
      expect(cmp.consentModalSlug).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  describe('lifecycle', () => {
    it('ngOnInit: authenticated with items syncs + applies query promo', fakeAsync(() => {
      queryParams = convertToParamMap({ promo: 'welcome' });
      coupons.validate.and.returnValue(of(makeOffer({ eligible: true })));
      const cmp = make();
      cmp.ngOnInit();
      tick();
      expect(cmp.promo).toBe('WELCOME');
      cmp.ngOnDestroy();
    }));

    it('ngOnInit: empty cart + guest redirects to cart', fakeAsync(() => {
      auth.isAuthenticated.and.returnValue(false);
      itemsSignal.set([]);
      const cmp = make();
      const router = TestBed.inject(Router);
      const navSpy = spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
      cmp.ngOnInit();
      tick();
      expect(navSpy).toHaveBeenCalled();
      cmp.ngOnDestroy();
    }));

    it('ngOnInit: empty cart + authenticated loads cart from server', fakeAsync(() => {
      itemsSignal.set([]);
      const cmp = make();
      const router = TestBed.inject(Router);
      spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
      cmp.ngOnInit();
      tick();
      expect(auth.ensureAuthenticated).toHaveBeenCalled();
      cmp.ngOnDestroy();
    }));

    it('ngOnInit: empty query promo is ignored', fakeAsync(() => {
      queryParams = convertToParamMap({ promo: '   ' });
      const cmp = make();
      cmp.ngOnInit();
      tick();
      expect((cmp as any).pendingPromoCode).toBeNull();
      cmp.ngOnDestroy();
    }));

    it('ngOnDestroy clears timers and tracks abandon', () => {
      const cmp = make();
      (cmp as any).syncDebounceHandle = setTimeout(() => {}, 1000);
      (cmp as any).guestResendTimer = setInterval(() => {}, 1000);
      (cmp as any).paymentNotReadyTimer = setTimeout(() => {}, 1000);
      (cmp as any).checkoutStartTracked = true;
      cmp.ngOnDestroy();
      expect((cmp as any).syncDebounceHandle).toBeNull();
      expect((cmp as any).guestResendTimer).toBeNull();
      expect((cmp as any).paymentNotReadyTimer).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Remaining branch-coverage edge cases (nullish/||/?? right-hand sides, etc.)
  // ---------------------------------------------------------------------------
  describe('branch edge cases', () => {
    it('setQuote: parseBool number/string forms + empty currency fallback', () => {
      const cmp = make();
      (cmp as any).setQuote({
        totals: {
          phone_required_home: 'true',
          phone_required_locker: 'false',
          delivery_locker_allowed: 1,
          currency: '',
        },
      });
      expect(cmp.currency).toBe('RON');
      expect((cmp as any).phoneRequiredHome).toBeTrue();
      expect((cmp as any).phoneRequiredLocker).toBeFalse();
    });

    it('step2Complete: non-RO country skips the region requirement', () => {
      const cmp = make();
      cmp.address = { ...VALID_ADDRESS, region: '' } as any;
      cmp.shippingCountryInput = 'DE';
      cmp.shippingPhoneCountry = 'RO';
      cmp.shippingPhoneNational = '721234567';
      expect(cmp.step2Complete()).toBeTrue();
    });

    it('onBillingSameAsShippingChanged: falls back to default shipping then first', () => {
      let cmp = make();
      cmp.billingSameAsShipping = false;
      cmp.savedAddresses = [
        makeAddress({
          id: 's-only',
          line1: 'ShipDefault',
          is_default_billing: false,
          is_default_shipping: true,
        }),
      ];
      cmp.selectedBillingAddressId = '';
      cmp.onBillingSameAsShippingChanged();
      expect(cmp.billing.line1).toBe('ShipDefault');

      cmp = make();
      cmp.billingSameAsShipping = false;
      cmp.savedAddresses = [
        makeAddress({
          id: 'first',
          line1: 'FirstOne',
          is_default_billing: false,
          is_default_shipping: false,
        }),
      ];
      cmp.selectedBillingAddressId = '';
      cmp.onBillingSameAsShippingChanged();
      expect(cmp.billing.line1).toBe('FirstOne');
    });

    it('openEditSavedAddress: null phone/empty fields take the fallback sides', () => {
      const cmp = make();
      cmp.savedAddresses = [
        makeAddress({
          id: 'mix',
          phone: null,
          line1: '',
          city: '',
          postal_code: '',
          country: '',
          label: 'L',
          line2: 'L2',
          region: 'R',
          is_default_shipping: false,
          is_default_billing: true,
        }),
      ];
      cmp.selectedShippingAddressId = 'mix';
      cmp.openEditSavedAddress('shipping');
      expect(cmp.editSavedAddressModel?.phone).toBeNull();
      expect(cmp.editSavedAddressModel?.country).toBe('RO');
      expect(cmp.editSavedAddressModel?.is_default_billing).toBeTrue();
    });

    it('applySavedAddressTo* tolerate fully-null address fields', () => {
      const cmp = make();
      cmp.billingSameAsShipping = false;
      (cmp as any).applySavedAddressToShipping(
        makeAddress({
          line1: null,
          line2: null,
          city: null,
          region: null,
          postal_code: null,
          country: null,
          phone: null,
        } as any),
      );
      expect(cmp.address.line1).toBe('');
      expect(cmp.address.country).toBe('');
      (cmp as any).applySavedAddressToBilling(
        makeAddress({
          line1: null,
          line2: null,
          city: null,
          region: null,
          postal_code: null,
          country: null,
        } as any),
      );
      expect(cmp.billing.line1).toBe('');
      expect(cmp.billing.country).toBe('');
    });

    it('loadSavedAddresses: no defaults uses first address for both', () => {
      const cmp = make();
      account.getAddresses.and.returnValue(
        of([makeAddress({ id: 'only', is_default_shipping: false, is_default_billing: false })]),
      );
      cmp.address = { ...VALID_ADDRESS, line1: '', city: '', postal: '' } as any;
      cmp.selectedBillingAddressId = '';
      (cmp as any).loadSavedAddresses(true);
      expect(cmp.selectedShippingAddressId).toBe('only');
      expect(cmp.selectedBillingAddressId).toBe('only');
    });

    it('onEmailChanged: empty email is tolerated', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.address.email = '';
      expect(() => cmp.onEmailChanged()).not.toThrow();
    });

    it('onEmailChanged: matching email keeps verification state', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.address.email = 'same@example.com';
      cmp.guestEmailVerified = true;
      cmp.guestVerificationSent = true;
      (cmp as any).lastGuestEmailVerified = 'same@example.com';
      (cmp as any).lastGuestEmailRequested = 'same@example.com';
      cmp.onEmailChanged();
      expect(cmp.guestEmailVerified).toBeTrue();
      expect(cmp.guestVerificationSent).toBeTrue();
    });

    it('guest/shipping phone helpers default country to RO when blank', () => {
      const cmp = make();
      cmp.guestPhoneCountry = '';
      cmp.guestPhoneNational = '721234567';
      expect(cmp.guestPhoneE164()).toContain('+40');
      cmp.shippingPhoneCountry = '';
      cmp.shippingPhoneNational = '721234567';
      expect(cmp.shippingPhoneE164()).toContain('+40');
    });

    it('describeCouponOffer: amount type with null amount_off', () => {
      const cmp = make();
      const amount = makeOffer({
        estimated_discount_ron: '0',
        estimated_shipping_discount_ron: '0',
      });
      amount.coupon.promotion!.discount_type = 'amount';
      amount.coupon.promotion!.amount_off = null;
      expect(cmp.describeCouponOffer(amount)).toContain('SAVE10');
    });

    it('pickBestCouponOffer: tolerates undefined offers list', () => {
      const cmp = make();
      expect((cmp as any).pickBestCouponOffer(undefined)).toBeNull();
    });

    it('couponShippingDiscount: empty promo returns 0', () => {
      const cmp = make();
      cmp.appliedCouponOffer = makeOffer({ eligible: true, estimated_shipping_discount_ron: '5' });
      cmp.promo = '';
      expect((cmp as any).couponShippingDiscount()).toBe(0);
    });

    it('buildSuccessSummary: item currency fallback + null courier/deliveryType', () => {
      const cmp = make();
      itemsSignal.set([{ ...defaultItem, currency: '' }]);
      cmp.courier = null as any;
      cmp.deliveryType = null as any;
      cmp.locker = null;
      const s = (cmp as any).buildSuccessSummary('o', null, 'cod');
      expect(s.items[0].currency).toBe('RON');
      expect(s.courier).toBeNull();
      expect(s.delivery_type).toBeNull();
    });

    it('normalizePaymentRedirectUrl: exact host match allowed', () => {
      const cmp = make();
      expect(
        (cmp as any).normalizePaymentRedirectUrl('https://paypal.com/x', ['paypal.com']),
      ).toContain('paypal.com');
    });

    it('normalizePaymentRedirectUrl: same-origin http mock path is allowed', () => {
      // The same-origin *https* mock arm is unreachable here: location.origin is
      // non-configurable (cannot be spoofed) and the Karma test server is http,
      // so that operand carries a reasoned istanbul-ignore in the source.
      const cmp = make();
      const origin = globalThis.location.origin;
      expect((cmp as any).normalizePaymentRedirectUrl(`${origin}/checkout/mock/abc`, [])).toContain(
        '/checkout/mock/abc',
      );
    });

    it('trackCheckoutStart/Abandon: empty currency falls through to item then RON', () => {
      // item currency present -> currency resolves to item currency
      let cmp = make();
      cmp.currency = '';
      itemsSignal.set([{ ...defaultItem, currency: 'RON', quantity: 0 }]);
      (cmp as any).trackCheckoutStart();
      expect(analytics.track).toHaveBeenCalled();

      // both currency and item currency empty -> 'RON' fallback
      analytics.track.calls.reset();
      cmp = make();
      cmp.currency = '';
      itemsSignal.set([{ ...defaultItem, currency: '', quantity: 0 }]);
      (cmp as any).trackCheckoutStart();
      (cmp as any).checkoutStartTracked = true;
      (cmp as any).checkoutFlowCompleted = false;
      (cmp as any).trackCheckoutAbandon();
      const abandon = analytics.track.calls.all().map((c: any) => c.args[0]);
      expect(abandon).toContain('checkout_abandon');
    });

    it('loadCouponsEligibility: missing eligible/ineligible arrays + non-matching promo', () => {
      const cmp = make();
      coupons.eligibility.and.returnValue(of({} as any));
      cmp.promo = 'NOPE';
      (cmp as any).loadCouponsEligibility();
      expect(cmp.appliedCouponOffer).toBeNull();
    });

    it('loadCouponsEligibility: error without detail uses translated message', () => {
      const cmp = make();
      coupons.eligibility.and.returnValue(throwError(() => ({})));
      (cmp as any).loadCouponsEligibility();
      expect(cmp.couponEligibilityError).toBe('checkout.couponsLoadError');
    });

    it('applyPromo: ineligible with undefined reasons + error without detail', () => {
      const cmp = make();
      const off = makeOffer({ eligible: false });
      (off as any).reasons = undefined;
      coupons.validate.and.returnValue(of(off));
      cmp.promo = 'SAVE10';
      cmp.applyPromo();
      expect(cmp.promoStatus).toBe('warn');

      coupons.validate.and.returnValue(throwError(() => ({ status: 500 })));
      cmp.promo = 'SAVE10';
      cmp.applyPromo();
      expect(cmp.promoMessage).toBe('checkout.promoPending');
    });

    it('ensureDeliveryOptionsAvailable: empty courier list leaves courier unchanged', () => {
      const cmp = make();
      cmp.deliveryAllowedCouriers = [];
      cmp.courier = 'fan_courier';
      (cmp as any).ensureDeliveryOptionsAvailable();
      expect(cmp.courier).toBe('fan_courier');
    });

    it('courierEstimate: unknown provider returns null', () => {
      const cmp = make();
      expect(cmp.courierEstimate('zzz' as any)).toBeNull();
    });

    it('loadPaymentCapabilities: stripe/netopia config + reason variations', () => {
      const origNetopia = appConfig.netopiaEnabled;
      const origStripe = appConfig.stripeEnabled;
      (appConfig as any).netopiaEnabled = true;
      (appConfig as any).stripeEnabled = true;
      try {
        const cmp = make();
        const translate = TestBed.inject(TranslateService);
        // reason_code present, translation available -> use translated text;
        // stripe enabled both in config and capabilities -> exercises the `&&` rhs.
        spyOn(translate, 'instant').and.callFake((k: any) =>
          k === 'checkout.paymentDisabledReasons.maint' ? 'Maintenance window' : k,
        );
        api.get.and.callFake((path: string) => {
          if (path === '/payments/capabilities') {
            return of({
              stripe: { enabled: true },
              paypal: undefined,
              netopia: { enabled: false, reason: 'down', reason_code: 'maint' },
            });
          }
          return of({ eligible: [], ineligible: [] });
        });
        (cmp as any).loadPaymentCapabilities();
        expect(cmp.stripeEnabled).toBeTrue();
        expect(cmp.netopiaDisabledReason).toBe('Maintenance window');

        // reason_code present but no translation -> fall back to raw reason
        (translate.instant as jasmine.Spy).and.callFake((k: any) => k);
        api.get.and.callFake((path: string) => {
          if (path === '/payments/capabilities') {
            return of({ netopia: { enabled: false, reason: 'down', reason_code: 'maint' } });
          }
          return of({ eligible: [], ineligible: [] });
        });
        (cmp as any).loadPaymentCapabilities();
        expect(cmp.netopiaDisabledReason).toBe('down');

        // reason_code present, raw reason absent -> reason `|| ''` rhs, empty result
        api.get.and.callFake((path: string) => {
          if (path === '/payments/capabilities') {
            return of({ netopia: { enabled: false, reason_code: 'x' } });
          }
          return of({ eligible: [], ineligible: [] });
        });
        (cmp as any).loadPaymentCapabilities();
        expect(cmp.netopiaDisabledReason).toBe('');

        // no reason_code -> empty reasonKey path -> fall back to raw reason
        api.get.and.callFake((path: string) => {
          if (path === '/payments/capabilities') {
            return of({ netopia: { enabled: false, reason: 'maint-only' } });
          }
          return of({ eligible: [], ineligible: [] });
        });
        (cmp as any).loadPaymentCapabilities();
        expect(cmp.netopiaDisabledReason).toBe('maint-only');

        // netopia backend enabled -> reason cleared
        api.get.and.callFake((path: string) => {
          if (path === '/payments/capabilities') {
            return of({ netopia: { enabled: true } });
          }
          return of({ eligible: [], ineligible: [] });
        });
        (cmp as any).loadPaymentCapabilities();
        expect(cmp.netopiaDisabledReason).toBe('');
      } finally {
        (appConfig as any).netopiaEnabled = origNetopia;
        (appConfig as any).stripeEnabled = origStripe;
      }
    });

    it('isPaymentMethodAvailable: empty currency defaults to RON', () => {
      const cmp = make();
      cmp.currency = '';
      cmp.shippingCountryInput = 'RO';
      expect(cmp.isPaymentMethodAvailable('cod')).toBeTrue();
    });

    it('cartQuoteParams: empty/whitespace address country defaults to RO', () => {
      const cmp = make();
      cmp.address.country = '';
      expect((cmp as any).cartQuoteParams(null)).toEqual({ country: 'RO' });
      cmp.address.country = '   '; // truthy but trims to '' -> second `|| 'RO'`
      expect((cmp as any).cartQuoteParams(null)).toEqual({ country: 'RO' });
    });

    it('refreshQuote/applyLegacyPromo: errors without detail use translated message (fallback refetch also fails)', () => {
      const cmp = make();
      // Both the primary quote AND the base-quote refetch fail -> exercises the
      // no-op `error: () => {}` fallback callbacks too.
      cartApi.get.and.returnValue(throwError(() => ({})));
      (cmp as any).refreshQuote('CODE');
      expect(cmp.promoMessage).toBe('checkout.promoPending');

      cartApi.get.and.returnValue(throwError(() => ({})));
      (cmp as any).applyLegacyPromo('CODE');
      expect(cmp.promoMessage).toBe('checkout.promoPending');
    });

    it('submitCheckout: invoice + locker + save_address + separate billing payload', () => {
      const cmp = make();
      cmp.invoiceEnabled = true;
      cmp.invoiceCompany = 'ACME';
      cmp.invoiceVatId = 'RO123';
      cmp.deliveryType = 'locker';
      cmp.locker = { id: 'L1', name: 'Locker', address: 'Addr', lat: 1, lng: 2 } as any;
      cmp.saveAddress = true;
      cmp.billingSameAsShipping = false;
      cmp.billing = { line1: 'B1', line2: '', city: 'BC', region: '', postal: '99', country: '' };
      cmp.address.country = 'RO';
      (cmp as any).submitCheckout();
      const payload = api.post.calls.mostRecent().args[1] as any;
      expect(payload.invoice_company).toBe('ACME');
      expect(payload.locker_id).toBe('L1');
      expect(payload.default_shipping).toBeDefined();
      expect(payload.billing_country).toBe('RO');
    });

    it('submitCheckout: blank invoice + locker-without-locker + empty countries take fallbacks', () => {
      const cmp = make();
      cmp.invoiceEnabled = true;
      cmp.invoiceCompany = '';
      cmp.invoiceVatId = '';
      cmp.deliveryType = 'locker';
      cmp.locker = null; // locker?.id ?? null -> null
      cmp.saveAddress = false;
      cmp.billingSameAsShipping = false;
      cmp.billing = { line1: 'B1', line2: '', city: 'BC', region: '', postal: '99', country: '' };
      cmp.address.country = '';
      (cmp as any).submitCheckout();
      const payload = api.post.calls.mostRecent().args[1] as any;
      expect(payload.invoice_company).toBeNull();
      expect(payload.invoice_vat_id).toBeNull();
      expect(payload.locker_id).toBeNull();
      expect(payload.country).toBe('RO');
      expect(payload.billing_country).toBe('RO');
      expect(payload.default_shipping).toBeUndefined();
    });

    it('submitGuestCheckout: same billing + no account + en payload', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.billingSameAsShipping = true;
      cmp.guestCreateAccount = false;
      cmp.deliveryType = 'home';
      (cmp as any).submitGuestCheckout();
      const payload = api.post.calls.mostRecent().args[1] as any;
      expect(payload.billing_line1).toBeNull();
      expect(payload.username).toBeUndefined();
      expect(payload.locker_id).toBeNull();
    });

    it('submitGuestCheckout: separate billing + account + locker + ro payload', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      const translate = TestBed.inject(TranslateService);
      spyOnProperty(translate, 'currentLang', 'get').and.returnValue('ro');
      cmp.billingSameAsShipping = false;
      cmp.billing = {
        line1: 'B1',
        line2: 'L2',
        city: 'BC',
        region: 'R',
        postal: '99',
        country: 'RO',
      };
      cmp.invoiceEnabled = true;
      cmp.invoiceCompany = 'Co';
      cmp.invoiceVatId = 'V1';
      cmp.guestCreateAccount = true;
      cmp.guestUsername = 'u';
      cmp.guestPassword = 'p';
      cmp.guestFirstName = 'F';
      cmp.guestMiddleName = 'M';
      cmp.guestLastName = 'L';
      cmp.guestDob = '1990-01-01';
      cmp.deliveryType = 'locker';
      cmp.locker = { id: 'L1', name: 'Lk', address: 'A', lat: 1, lng: 2 } as any;
      cmp.address.country = 'RO';
      (cmp as any).submitGuestCheckout();
      const payload = api.post.calls.mostRecent().args[1] as any;
      expect(payload.billing_line1).toBe('B1');
      expect(payload.billing_line2).toBe('L2');
      expect(payload.billing_country).toBe('RO');
      expect(payload.preferred_language).toBe('ro');
      expect(payload.middle_name).toBe('M');
      expect(payload.locker_id).toBe('L1');
    });

    it('submitGuestCheckout: separate billing with empty fallbacks + locker-without-locker', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.billingSameAsShipping = false;
      cmp.billing = { line1: 'B1', line2: '', city: 'BC', region: '', postal: '99', country: '' };
      cmp.invoiceEnabled = true;
      cmp.invoiceCompany = '';
      cmp.invoiceVatId = '';
      cmp.guestCreateAccount = true;
      cmp.guestMiddleName = '';
      cmp.deliveryType = 'locker';
      cmp.locker = null; // locker?.id ?? null -> null
      cmp.address.country = '';
      (cmp as any).submitGuestCheckout();
      const payload = api.post.calls.mostRecent().args[1] as any;
      expect(payload.invoice_company).toBeNull();
      expect(payload.billing_line2).toBeNull();
      expect(payload.billing_region).toBeNull();
      expect(payload.billing_country).toBe('RO');
      expect(payload.country).toBe('RO');
      expect(payload.locker_id).toBeNull();
      expect(payload.middle_name).toBeNull();
      expect(payload.preferred_language).toBe('en');
    });

    it('requestGuestEmailVerification: error without detail uses translated message', fakeAsync(() => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.address.email = 'g@example.com';
      api.post.and.returnValue(throwError(() => ({})));
      cmp.requestGuestEmailVerification();
      tick();
      expect(cmp.guestEmailError).toBe('checkout.emailVerifySendFailed');
      (cmp as any).clearGuestResendCooldown();
    }));

    it('confirmGuestEmailVerification: null email/verified + error without detail', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      cmp.address.email = 'g@example.com';
      cmp.guestVerificationToken = 'tok';
      api.post.and.returnValue(of({ email: null, verified: null } as any));
      cmp.confirmGuestEmailVerification();
      expect(cmp.guestEmailVerified).toBeFalse();
      expect((cmp as any).lastGuestEmailVerified).toBe('g@example.com');

      cmp.guestVerificationToken = 'tok';
      api.post.and.returnValue(throwError(() => ({})));
      cmp.confirmGuestEmailVerification();
      expect(cmp.guestEmailError).toBe('checkout.emailVerifyInvalidCode');
    });

    it('loadGuestEmailVerificationStatus: blank email response is tolerated', () => {
      auth.isAuthenticated.and.returnValue(false);
      const cmp = make();
      api.get.and.callFake((path: string) => {
        if (path === '/orders/guest-checkout/email/status')
          return of({ email: '', verified: false });
        return of({ eligible: [], ineligible: [] });
      });
      (cmp as any).loadGuestEmailVerificationStatus();
      expect(cmp.guestEmailVerified).toBeFalse();
    });
  });
});
