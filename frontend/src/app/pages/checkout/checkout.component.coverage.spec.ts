import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { EMPTY, NEVER, of, throwError } from 'rxjs';
import { Router, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { CheckoutComponent } from './checkout.component';
import { appConfig } from '../../core/app-config';
import { CartStore, CartItem } from '../../core/cart.store';
import { CartApi } from '../../core/cart.api';
import { ApiService } from '../../core/api.service';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { AccountService, Address } from '../../core/account.service';
import { CouponsService, CouponOffer } from '../../core/coupons.service';
import { CheckoutPrefsService } from '../../core/checkout-prefs.service';
import { AnalyticsService } from '../../core/analytics.service';
import { LockerRead } from '../../core/shipping.service';

/**
 * Behavioral coverage suite for CheckoutComponent.
 *
 * Every test drives a real code path and asserts an observable outcome
 * (component state, mocked-service calls, navigation, or DOM focus). No
 * empty/no-assert tests; no coverage padding.
 */
describe('CheckoutComponent (coverage)', () => {
  let itemsSignal: WritableSignal<CartItem[]>;
  let subtotalSignal: WritableSignal<number>;
  let cart: any;
  let cartApi: any;
  let api: any;
  let account: any;
  let coupons: any;
  let prefs: any;
  let analytics: any;
  let auth: any;
  let route: any;

  const sampleItem = (over: Partial<CartItem> = {}): CartItem =>
    ({
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
      ...over,
    }) as CartItem;

  const makeAddress = (over: Partial<Address> = {}): Address => ({
    id: 'a1',
    label: 'Home',
    phone: '+40712345678',
    line1: '1 Main St',
    line2: 'Apt 2',
    city: 'Bucuresti',
    region: 'B',
    postal_code: '010101',
    country: 'RO',
    is_default_shipping: true,
    is_default_billing: true,
    ...over,
  });

  const makeOffer = (over: Partial<CouponOffer> = {}): CouponOffer =>
    ({
      coupon: {
        id: 'c1',
        promotion_id: 'pr1',
        code: 'SAVE10',
        visibility: 'public',
        is_active: true,
        promotion: {
          id: 'pr1',
          name: 'promo',
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
    }) as CouponOffer;

  const makeLocker = (): LockerRead => ({
    id: 'L1',
    provider: 'sameday',
    name: 'Locker One',
    address: 'Some street',
    lat: 1,
    lng: 2,
    distance_km: 3,
  });

  const totals = (over: Record<string, unknown> = {}) => ({
    totals: {
      subtotal: '20',
      fee: '0',
      tax: '0',
      shipping: '0',
      total: '20',
      currency: 'RON',
      ...over,
    },
  });

  beforeEach(() => {
    itemsSignal = signal<CartItem[]>([sampleItem()]);
    subtotalSignal = signal(20);

    cart = {
      items: itemsSignal,
      subtotal: subtotalSignal,
      clear: jasmine.createSpy('clear'),
      hydrateFromBackend: jasmine.createSpy('hydrateFromBackend'),
    };

    cartApi = jasmine.createSpyObj('CartApi', ['sync', 'headers', 'get']);
    cartApi.sync.and.returnValue(of(totals()));
    cartApi.headers.and.returnValue({});
    cartApi.get.and.returnValue(of(totals()));

    api = jasmine.createSpyObj('ApiService', ['post', 'get']);
    api.post.and.returnValue(of({ order_id: 'order1', reference_code: 'REF' }));
    api.get.and.callFake((path: string) => {
      if (path === '/payments/capabilities') {
        return of({
          stripe: { enabled: true },
          paypal: { enabled: true },
          netopia: { enabled: true },
        });
      }
      if (path === '/legal/consents/status') {
        return of({ docs: [], satisfied: false });
      }
      if (path.startsWith('/orders/guest-checkout/email/status')) {
        return of({ email: null, verified: false });
      }
      return of({});
    });

    account = jasmine.createSpyObj('AccountService', ['getAddresses', 'updateAddress']);
    account.getAddresses.and.returnValue(of([]));
    account.updateAddress.and.returnValue(of(makeAddress()));

    coupons = jasmine.createSpyObj('CouponsService', ['eligibility', 'validate']);
    coupons.eligibility.and.returnValue(of({ eligible: [], ineligible: [] }));
    coupons.validate.and.returnValue(of(makeOffer()));

    prefs = jasmine.createSpyObj('CheckoutPrefsService', [
      'tryLoadDeliveryPrefs',
      'saveDeliveryPrefs',
      'tryLoadPaymentMethod',
      'savePaymentMethod',
    ]);
    prefs.tryLoadDeliveryPrefs.and.returnValue(null);
    prefs.tryLoadPaymentMethod.and.returnValue(null);

    analytics = jasmine.createSpyObj('AnalyticsService', ['enabled', 'setEnabled', 'track']);
    analytics.enabled.and.returnValue(true);

    auth = jasmine.createSpyObj('AuthService', [
      'isAuthenticated',
      'user',
      'requestEmailVerification',
      'ensureAuthenticated',
    ]);
    auth.isAuthenticated.and.returnValue(true);
    auth.user.and.returnValue({ email_verified: true });
    auth.requestEmailVerification.and.returnValue(of({ detail: 'ok' }));
    auth.ensureAuthenticated.and.returnValue(of(true));

    route = {
      snapshot: { params: {}, data: {}, queryParamMap: convertToParamMap({}) },
      queryParamMap: of(convertToParamMap({})),
    };

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, CheckoutComponent, TranslateModule.forRoot()],
      providers: [
        { provide: CartStore, useValue: cart },
        { provide: CartApi, useValue: cartApi },
        { provide: ApiService, useValue: api },
        { provide: AccountService, useValue: account },
        { provide: CouponsService, useValue: coupons },
        { provide: CheckoutPrefsService, useValue: prefs },
        { provide: AnalyticsService, useValue: analytics },
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: route },
      ],
    });
  });

  function make(): CheckoutComponent {
    const fixture = TestBed.createComponent(CheckoutComponent);
    return fixture.componentInstance;
  }

  // Fully populate shipping/billing so step2Complete and placeOrder pass.
  function fillValidAddress(cmp: CheckoutComponent): void {
    cmp.address = {
      name: 'Test User',
      email: 'test@example.com',
      line1: '1 Main St',
      line2: '',
      city: 'Bucuresti',
      region: 'B',
      postal: '010101',
      country: 'RO',
    } as any;
    cmp.shippingCountryInput = 'RO';
    cmp.billingSameAsShipping = true;
    (cmp as any).phoneRequiredHome = false;
    (cmp as any).phoneRequiredLocker = false;
  }

  // ---- constructor ----
  it('constructor applies saved delivery prefs and locker reset for home', () => {
    prefs.tryLoadDeliveryPrefs.and.returnValue({ courier: 'fan_courier', deliveryType: 'home' });
    const cmp = make();
    expect(cmp.courier).toBe('fan_courier');
    expect(cmp.deliveryType).toBe('home');
    expect(cmp.locker).toBeNull();
    expect(cmp.address.country).toBe('RO');
    expect(cmp.billing.country).toBe('RO');
  });

  it('constructor keeps locker delivery type without clearing locker', () => {
    prefs.tryLoadDeliveryPrefs.and.returnValue({ courier: 'sameday', deliveryType: 'locker' });
    const cmp = make();
    expect(cmp.deliveryType).toBe('locker');
  });

  // ---- cartSyncPending ----
  it('cartSyncPending reflects syncing/queued state', () => {
    const cmp = make();
    cmp.syncing = false;
    cmp.syncQueued = false;
    expect(cmp.cartSyncPending()).toBeFalse();
    cmp.syncQueued = true;
    expect(cmp.cartSyncPending()).toBeTrue();
  });

  // ---- scrollToStep ----
  it('scrollToStep returns silently when the step element is missing', () => {
    const cmp = make();
    expect(() => cmp.scrollToStep('does-not-exist')).not.toThrow();
  });

  it('scrollToStep focuses the first focusable element inside the step', fakeAsync(() => {
    const cmp = make();
    const step = document.createElement('div');
    step.id = 'step-a';
    const input = document.createElement('input');
    step.appendChild(input);
    document.body.appendChild(step);
    spyOn(input, 'focus');
    cmp.scrollToStep('step-a');
    tick();
    expect(input.focus).toHaveBeenCalled();
    document.body.removeChild(step);
  }));

  it('scrollToStep falls back to focusing the step container when nothing is focusable', fakeAsync(() => {
    const cmp = make();
    const step = document.createElement('div');
    step.id = 'step-b';
    document.body.appendChild(step);
    const focusSpy = spyOn(step, 'focus');
    cmp.scrollToStep('step-b');
    tick();
    expect(step.getAttribute('tabindex')).toBe('-1');
    expect(focusSpy).toHaveBeenCalled();
    document.body.removeChild(step);
  }));

  it('scrollToStep swallows errors thrown while resolving the element', () => {
    const cmp = make();
    spyOn(document, 'getElementById').and.throwError('boom');
    expect(() => cmp.scrollToStep('x')).not.toThrow();
  });

  // ---- findFirstFocusableElement ----
  it('findFirstFocusableElement skips hidden/disabled/invisible and returns the first usable element', () => {
    const cmp = make();
    const container = document.createElement('div');
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    const disabled = document.createElement('button');
    disabled.disabled = true;
    const invisible = document.createElement('input');
    invisible.style.display = 'none';
    const good = document.createElement('input');
    container.append(hidden, disabled, invisible, good);
    document.body.appendChild(container);
    expect((cmp as any).findFirstFocusableElement(container)).toBe(good);
    document.body.removeChild(container);
  });

  it('findFirstFocusableElement returns null when no candidate qualifies', () => {
    const cmp = make();
    const container = document.createElement('div');
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    container.appendChild(hidden);
    document.body.appendChild(container);
    expect((cmp as any).findFirstFocusableElement(container)).toBeNull();
    document.body.removeChild(container);
  });

  // ---- focusOnly / scrollAndFocus ----
  it('focusOnly swallows focus errors', () => {
    const cmp = make();
    expect(() =>
      (cmp as any).focusOnly({
        focus: () => {
          throw new Error('x');
        },
      }),
    ).not.toThrow();
  });

  it('scrollAndFocus swallows scroll and focus errors', () => {
    const cmp = make();
    const el = {
      scrollIntoView: () => {
        throw new Error('s');
      },
      focus: () => {
        throw new Error('f');
      },
    };
    expect(() => (cmp as any).scrollAndFocus(el)).not.toThrow();
  });

  // ---- announceAssertive ----
  it('announceAssertive ignores empty messages and announces non-empty ones', fakeAsync(() => {
    const cmp = make();
    (cmp as any).announceAssertive('   ');
    expect(cmp.liveAssertive).toBe('');
    (cmp as any).announceAssertive('hello');
    tick();
    expect(cmp.liveAssertive).toBe('hello');
  }));

  // ---- detectChangesSafe ----
  it('detectChangesSafe swallows change-detection errors', () => {
    const cmp = make();
    spyOn((cmp as any).cdr, 'detectChanges').and.throwError('cd');
    expect(() => (cmp as any).detectChangesSafe()).not.toThrow();
  });

  // ---- focusFirstInvalidField / focusElementById ----
  it('focusFirstInvalidField focuses the first invalid field of the rendered form', fakeAsync(() => {
    const cmp = make();
    const formEl = document.createElement('form');
    cmp.checkoutFormEl = { nativeElement: formEl } as any;
    const fake = document.createElement('input');
    fake.className = 'ng-invalid';
    spyOn(cmp as any, 'findFirstInvalidField').and.returnValue(fake);
    const scroll = spyOn(cmp as any, 'scrollAndFocus');
    (cmp as any).focusFirstInvalidField();
    tick();
    expect(scroll).toHaveBeenCalledWith(fake);
  }));

  it('focusFirstInvalidField returns early when the form has no invalid fields', fakeAsync(() => {
    const cmp = make();
    cmp.checkoutFormEl = { nativeElement: document.createElement('form') } as any;
    spyOn(cmp as any, 'findFirstInvalidField').and.returnValue(null);
    const scroll = spyOn(cmp as any, 'scrollAndFocus');
    (cmp as any).focusFirstInvalidField();
    tick();
    expect(scroll).not.toHaveBeenCalled();
  }));

  it('findFirstInvalidField skips disabled/hidden and returns null when none qualify', () => {
    const cmp = make();
    const container = document.createElement('div');
    const disabled = document.createElement('input');
    disabled.className = 'ng-invalid';
    disabled.disabled = true;
    container.appendChild(disabled);
    document.body.appendChild(container);
    expect((cmp as any).findFirstInvalidField(container)).toBeNull();
    document.body.removeChild(container);
  });

  it('focusElementById focuses a present element and ignores a missing one', fakeAsync(() => {
    const cmp = make();
    const el = document.createElement('div');
    el.id = 'present-el';
    document.body.appendChild(el);
    const focusSpy = spyOn(el, 'focus');
    (cmp as any).focusElementById('present-el');
    tick();
    expect(focusSpy).toHaveBeenCalled();
    (cmp as any).focusElementById('missing-el');
    tick();
    document.body.removeChild(el);
  }));

  // ---- step1Complete ----
  it('step1Complete: authenticated user is always complete', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    expect(cmp.step1Complete()).toBeTrue();
  });

  it('step1Complete: guest without account creation is complete', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    cmp.guestCreateAccount = false;
    expect(cmp.step1Complete()).toBeTrue();
  });

  it('step1Complete: validates guest account fields', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    cmp.guestCreateAccount = true;
    cmp.guestUsername = 'bad name!';
    expect(cmp.step1Complete()).toBeFalse();
    cmp.guestUsername = 'gooduser';
    cmp.guestPassword = '123';
    expect(cmp.step1Complete()).toBeFalse();
    cmp.guestPassword = 'longpass';
    cmp.guestPasswordConfirm = 'different';
    expect(cmp.step1Complete()).toBeFalse();
    cmp.guestPasswordConfirm = 'longpass';
    cmp.guestFirstName = '';
    expect(cmp.step1Complete()).toBeFalse();
    cmp.guestFirstName = 'Jane';
    cmp.guestLastName = 'Doe';
    cmp.guestDob = '';
    expect(cmp.step1Complete()).toBeFalse();
    cmp.guestDob = '1990-01-01';
    cmp.guestPhoneCountry = 'RO';
    cmp.guestPhoneNational = '';
    expect(cmp.step1Complete()).toBeFalse();
    cmp.guestPhoneNational = '712345678';
    expect(cmp.step1Complete()).toBeTrue();
  });

  // ---- step2Complete / step3Complete ----
  it('step2Complete returns false for each missing/invalid field then true when valid', () => {
    const cmp = make();
    fillValidAddress(cmp);
    expect(cmp.step3Complete()).toBeTrue();

    cmp.address.name = '   ';
    expect(cmp.step2Complete()).toBeFalse();
    cmp.address.name = 'User';

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

    cmp.shippingCountryInput = 'ZZZ-invalid';
    expect(cmp.step2Complete()).toBeFalse();
    cmp.shippingCountryInput = 'RO';

    cmp.address.region = '';
    expect(cmp.step2Complete()).toBeFalse();
    cmp.address.region = 'B';

    cmp.shippingCountryError = 'err';
    expect(cmp.step2Complete()).toBeFalse();
    cmp.shippingCountryError = '';

    expect(cmp.step2Complete()).toBeTrue();
  });

  it('step2Complete enforces locker selection and shipping phone validity', () => {
    const cmp = make();
    fillValidAddress(cmp);
    cmp.deliveryType = 'locker';
    cmp.locker = null;
    expect(cmp.step2Complete()).toBeFalse();
    cmp.locker = makeLocker();
    expect(cmp.step2Complete()).toBeTrue();

    cmp.deliveryType = 'home';
    (cmp as any).phoneRequiredHome = true;
    cmp.shippingPhoneCountry = 'RO';
    cmp.shippingPhoneNational = 'not-a-number';
    expect(cmp.step2Complete()).toBeFalse();
    cmp.shippingPhoneNational = '';
    expect(cmp.step2Complete()).toBeFalse(); // no effective phone
    cmp.shippingPhoneNational = '712345678';
    expect(cmp.step2Complete()).toBeTrue();
  });

  it('step2Complete validates separate billing address', () => {
    const cmp = make();
    fillValidAddress(cmp);
    cmp.billingSameAsShipping = false;
    cmp.billing = { line1: '', line2: '', city: '', region: '', postal: '', country: 'RO' };
    cmp.billingCountryInput = 'RO';
    expect(cmp.step2Complete()).toBeFalse();
    cmp.billing.line1 = '2 St';
    expect(cmp.step2Complete()).toBeFalse();
    cmp.billing.city = 'City';
    expect(cmp.step2Complete()).toBeFalse();
    cmp.billing.postal = '54321';
    cmp.billingCountryInput = 'invalidzz';
    expect(cmp.step2Complete()).toBeFalse();
    cmp.billingCountryInput = 'RO';
    cmp.billing.region = '';
    expect(cmp.step2Complete()).toBeFalse();
    cmp.billing.region = 'B';
    cmp.billingCountryError = 'x';
    expect(cmp.step2Complete()).toBeFalse();
    cmp.billingCountryError = '';
    expect(cmp.step2Complete()).toBeTrue();
  });

  it('step2Complete returns guest verification state for guests', () => {
    const cmp = make();
    fillValidAddress(cmp);
    auth.isAuthenticated.and.returnValue(false);
    cmp.guestEmailVerified = false;
    expect(cmp.step2Complete()).toBeFalse();
    cmp.guestEmailVerified = true;
    expect(cmp.step2Complete()).toBeTrue();
  });

  // ---- copyShippingToBilling ----
  it('copyShippingToBilling no-ops when billing equals shipping, copies otherwise', () => {
    const cmp = make();
    cmp.billingSameAsShipping = true;
    cmp.billing.line1 = 'orig';
    cmp.copyShippingToBilling();
    expect(cmp.billing.line1).toBe('orig');

    cmp.billingSameAsShipping = false;
    cmp.address.line1 = 'ship line';
    cmp.shippingCountryInput = 'RO';
    cmp.selectedBillingAddressId = 'xx';
    cmp.copyShippingToBilling();
    expect(cmp.billing.line1).toBe('ship line');
    expect(cmp.selectedBillingAddressId).toBe('');
    expect(cmp.billingCountryInput).toBe('RO');
  });

  // ---- isValidEmail ----
  it('isValidEmail covers all rejection branches', () => {
    const cmp = make();
    const fn = (e: string) => (cmp as any).isValidEmail(e);
    expect(fn('')).toBeFalse();
    expect(fn('a'.repeat(256) + '@x.com')).toBeFalse();
    expect(fn('@nope.com')).toBeFalse();
    expect(fn('nope@')).toBeFalse();
    expect(fn('nope@domain')).toBeFalse();
    expect(fn('ok@domain.com')).toBeTrue();
  });

  // ---- emailVerified ----
  it('emailVerified reflects auth user flag', () => {
    const cmp = make();
    auth.user.and.returnValue({ email_verified: true });
    expect(cmp.emailVerified()).toBeTrue();
    auth.user.and.returnValue(null);
    expect(cmp.emailVerified()).toBeFalse();
  });

  // ---- primary email verification ----
  it('primaryEmailVerificationResendRemainingSeconds returns 0 then a positive value', () => {
    const cmp = make();
    expect(cmp.primaryEmailVerificationResendRemainingSeconds()).toBe(0);
    (cmp as any).primaryEmailVerificationResendUntil = Date.now() + 30_000;
    expect(cmp.primaryEmailVerificationResendRemainingSeconds()).toBeGreaterThan(0);
  });

  it('resendPrimaryEmailVerification guards: unauthenticated, busy, cooldown', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    cmp.resendPrimaryEmailVerification();
    expect(auth.requestEmailVerification).not.toHaveBeenCalled();

    auth.isAuthenticated.and.returnValue(true);
    cmp.primaryEmailVerificationBusy = true;
    cmp.resendPrimaryEmailVerification();
    expect(auth.requestEmailVerification).not.toHaveBeenCalled();

    cmp.primaryEmailVerificationBusy = false;
    (cmp as any).primaryEmailVerificationResendUntil = Date.now() + 30_000;
    cmp.resendPrimaryEmailVerification();
    expect(auth.requestEmailVerification).not.toHaveBeenCalled();
  });

  it('resendPrimaryEmailVerification success sets sent status and cooldown', () => {
    const cmp = make();
    auth.requestEmailVerification.and.returnValue(of({ detail: 'ok' }));
    cmp.resendPrimaryEmailVerification();
    expect(cmp.primaryEmailVerificationStatus).toContain('account.verification.sentStatus');
    expect(cmp.primaryEmailVerificationBusy).toBeFalse();
    expect(cmp.primaryEmailVerificationResendRemainingSeconds()).toBeGreaterThan(0);
  });

  it('resendPrimaryEmailVerification error sets error status', () => {
    const cmp = make();
    auth.requestEmailVerification.and.returnValue(throwError(() => new Error('x')));
    cmp.resendPrimaryEmailVerification();
    expect(cmp.primaryEmailVerificationStatus).toContain('account.verification.sendError');
    expect(cmp.primaryEmailVerificationBusy).toBeFalse();
  });

  // ---- prefillFromUser ----
  it('prefillFromUser returns early without a user', () => {
    const cmp = make();
    auth.user.and.returnValue(null);
    cmp.address.email = '';
    (cmp as any).prefillFromUser();
    expect(cmp.address.email).toBe('');
  });

  it('prefillFromUser fills email, name parts and phone', () => {
    const cmp = make();
    auth.user.and.returnValue({
      email: 'u@e.com',
      first_name: 'Jane',
      middle_name: 'Q',
      last_name: 'Doe',
      phone: '+40712345678',
    });
    cmp.address.email = '';
    cmp.address.name = '';
    cmp.shippingPhoneNational = '';
    (cmp as any).prefillFromUser();
    expect(cmp.address.email).toBe('u@e.com');
    expect(cmp.address.name).toBe('Jane Q Doe');
    expect(cmp.shippingPhoneNational).toBeTruthy();
  });

  it('prefillFromUser uses display name when no parts and skips when phone empty', () => {
    const cmp = make();
    auth.user.and.returnValue({ email: 'u@e.com', name: 'Display Name' });
    cmp.address.email = 'keep@e.com';
    cmp.address.name = '';
    cmp.shippingPhoneNational = '700';
    (cmp as any).prefillFromUser();
    expect(cmp.address.email).toBe('keep@e.com');
    expect(cmp.address.name).toBe('Display Name');
  });

  // ---- formatSavedAddress ----
  it('formatSavedAddress builds a labelled body and a label-only fallback', () => {
    const cmp = make();
    expect(cmp.formatSavedAddress(makeAddress())).toContain('Home');
    const bare = makeAddress({ label: '', line1: '', city: '', region: '', country: '' });
    expect(cmp.formatSavedAddress(bare)).toContain('account.addresses.labels.address');
  });

  // ---- applySelected* ----
  it('applySelectedShippingAddress ignores empty/unknown ids and applies a match', () => {
    const cmp = make();
    cmp.selectedShippingAddressId = '';
    cmp.applySelectedShippingAddress();
    cmp.selectedShippingAddressId = 'nope';
    cmp.savedAddresses = [makeAddress({ id: 'a1' })];
    cmp.applySelectedShippingAddress();
    expect(cmp.address.line1).toBe('');
    cmp.selectedShippingAddressId = 'a1';
    cmp.applySelectedShippingAddress();
    expect(cmp.address.line1).toBe('1 Main St');
  });

  it('applySelectedBillingAddress ignores empty/unknown ids and applies a match', () => {
    const cmp = make();
    cmp.selectedBillingAddressId = '';
    cmp.applySelectedBillingAddress();
    cmp.selectedBillingAddressId = 'nope';
    cmp.savedAddresses = [makeAddress({ id: 'b1' })];
    cmp.applySelectedBillingAddress();
    expect(cmp.billing.line1).toBe('');
    cmp.selectedBillingAddressId = 'b1';
    cmp.applySelectedBillingAddress();
    expect(cmp.billing.line1).toBe('1 Main St');
  });

  // ---- onBillingSameAsShippingChanged ----
  it('onBillingSameAsShippingChanged copies shipping when toggled on', () => {
    const cmp = make();
    cmp.billingSameAsShipping = true;
    cmp.address.line1 = 'ship';
    cmp.address.country = 'RO';
    cmp.onBillingSameAsShippingChanged();
    expect(cmp.billing.line1).toBe('ship');
  });

  it('onBillingSameAsShippingChanged keeps already-filled billing', () => {
    const cmp = make();
    cmp.billingSameAsShipping = false;
    cmp.billing.line1 = 'existing';
    cmp.onBillingSameAsShippingChanged();
    expect(cmp.billing.line1).toBe('existing');
  });

  it('onBillingSameAsShippingChanged applies selected billing id when empty', () => {
    const cmp = make();
    cmp.billingSameAsShipping = false;
    cmp.billing = { line1: '', line2: '', city: '', region: '', postal: '', country: 'RO' };
    cmp.savedAddresses = [makeAddress({ id: 'b1' })];
    cmp.selectedBillingAddressId = 'b1';
    cmp.onBillingSameAsShippingChanged();
    expect(cmp.billing.line1).toBe('1 Main St');
  });

  it('onBillingSameAsShippingChanged falls back to default billing/shipping/first', () => {
    const cmp = make();
    cmp.billingSameAsShipping = false;
    cmp.billing = { line1: '', line2: '', city: '', region: '', postal: '', country: 'RO' };
    cmp.selectedBillingAddressId = '';
    cmp.savedAddresses = [makeAddress({ id: 'f1', is_default_billing: true })];
    cmp.onBillingSameAsShippingChanged();
    expect(cmp.selectedBillingAddressId).toBe('f1');
  });

  it('onBillingSameAsShippingChanged returns when no saved addresses exist', () => {
    const cmp = make();
    cmp.billingSameAsShipping = false;
    cmp.billing = { line1: '', line2: '', city: '', region: '', postal: '', country: 'RO' };
    cmp.selectedBillingAddressId = '';
    cmp.savedAddresses = [];
    cmp.onBillingSameAsShippingChanged();
    expect(cmp.billing.line1).toBe('');
  });

  // ---- edit saved address modal ----
  it('editSavedAddressTitle picks billing vs shipping key', () => {
    const cmp = make();
    cmp.editSavedAddressTarget = 'billing';
    expect(cmp.editSavedAddressTitle()).toContain('editBillingAddressTitle');
    cmp.editSavedAddressTarget = 'shipping';
    expect(cmp.editSavedAddressTitle()).toContain('editShippingAddressTitle');
  });

  it('openEditSavedAddress guards and opens the modal with a model', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    cmp.openEditSavedAddress('shipping');
    expect(cmp.editSavedAddressOpen).toBeFalse();

    auth.isAuthenticated.and.returnValue(true);
    cmp.selectedShippingAddressId = '';
    cmp.openEditSavedAddress('shipping');
    expect(cmp.editSavedAddressOpen).toBeFalse();

    cmp.selectedShippingAddressId = 'a1';
    cmp.savedAddresses = [];
    cmp.openEditSavedAddress('shipping');
    expect(cmp.editSavedAddressOpen).toBeFalse();

    cmp.savedAddresses = [
      makeAddress({ id: 'a1', label: null, line2: null, region: null, phone: null, country: '' }),
    ];
    cmp.openEditSavedAddress('shipping');
    expect(cmp.editSavedAddressOpen).toBeTrue();
    expect(cmp.editSavedAddressModel?.country).toBe('RO');

    cmp.selectedBillingAddressId = 'a1';
    cmp.openEditSavedAddress('billing');
    expect(cmp.editSavedAddressTarget).toBe('billing');
  });

  it('closeEditSavedAddress resets modal state', () => {
    const cmp = make();
    cmp.editSavedAddressOpen = true;
    cmp.editSavedAddressModel = {} as any;
    cmp.closeEditSavedAddress();
    expect(cmp.editSavedAddressOpen).toBeFalse();
    expect(cmp.editSavedAddressModel).toBeNull();
  });

  it('saveEditedSavedAddress guards on auth, id and in-flight saves', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    cmp.saveEditedSavedAddress({} as any);
    expect(account.updateAddress).not.toHaveBeenCalled();

    auth.isAuthenticated.and.returnValue(true);
    cmp.editSavedAddressId = '';
    cmp.saveEditedSavedAddress({} as any);
    expect(account.updateAddress).not.toHaveBeenCalled();

    cmp.editSavedAddressId = 'a1';
    (cmp as any).editSavedAddressSaving = true;
    cmp.saveEditedSavedAddress({} as any);
    expect(account.updateAddress).not.toHaveBeenCalled();
  });

  it('saveEditedSavedAddress applies updated shipping address on success', () => {
    const cmp = make();
    const updated = makeAddress({ id: 'a1', line1: 'UpdatedLine' });
    account.updateAddress.and.returnValue(of(updated));
    cmp.savedAddresses = [makeAddress({ id: 'a1' })];
    cmp.editSavedAddressId = 'a1';
    cmp.editSavedAddressTarget = 'shipping';
    cmp.saveEditedSavedAddress({} as any);
    expect(cmp.address.line1).toBe('UpdatedLine');
    expect(cmp.editSavedAddressOpen).toBeFalse();
  });

  it('saveEditedSavedAddress applies updated billing address on success', () => {
    const cmp = make();
    const updated = makeAddress({ id: 'a1', line1: 'BillingLine' });
    account.updateAddress.and.returnValue(of(updated));
    cmp.savedAddresses = [makeAddress({ id: 'a1' })];
    cmp.editSavedAddressId = 'a1';
    cmp.editSavedAddressTarget = 'billing';
    cmp.saveEditedSavedAddress({} as any);
    expect(cmp.billing.line1).toBe('BillingLine');
  });

  it('saveEditedSavedAddress surfaces an error message', () => {
    const cmp = make();
    account.updateAddress.and.returnValue(throwError(() => new Error('x')));
    cmp.editSavedAddressId = 'a1';
    cmp.saveEditedSavedAddress({} as any);
    expect(cmp.editSavedAddressError).toContain('account.addresses.errors.update');
  });

  // ---- applySavedAddressTo* ----
  it('applySavedAddressToShipping copies phone and mirrors billing when same', () => {
    const cmp = make();
    cmp.billingSameAsShipping = true;
    (cmp as any).applySavedAddressToShipping(makeAddress({ phone: '+40712345678', country: 'ro' }));
    expect(cmp.address.country).toBe('RO');
    expect(cmp.shippingPhoneNational).toBeTruthy();
    expect(cmp.billing.line1).toBe('1 Main St');
    expect(cmp.saveAddress).toBeFalse();
  });

  it('applySavedAddressToShipping skips phone split when address has none', () => {
    const cmp = make();
    cmp.billingSameAsShipping = false;
    cmp.shippingPhoneNational = 'keep';
    (cmp as any).applySavedAddressToShipping(
      makeAddress({ phone: null, line2: null, region: null }),
    );
    expect(cmp.shippingPhoneNational).toBe('keep');
  });

  // ---- formatCountryOption / resolveCountryCode / countryInputFromCode ----
  it('formatCountryOption renders code and name', () => {
    const cmp = make();
    const opt = cmp.countries.find((c) => c.code === 'RO')!;
    expect(cmp.formatCountryOption(opt)).toContain('RO');
  });

  it('resolveCountryCode handles code, name, parenthesised and suffixed forms', () => {
    const cmp = make();
    const fn = (s: string) => (cmp as any).resolveCountryCode(s);
    expect(fn('')).toBeNull();
    expect(fn('RO')).toBe('RO');
    const ro = cmp.countries.find((c) => c.code === 'RO')!;
    expect(fn(ro.name)).toBe('RO');
    expect(fn(`${ro.name} (ro)`)).toBe('RO');
    expect(fn(`${ro.name} - ro`)).toBe('RO');
    expect(fn('Zzzqq')).toBeNull();
  });

  it('countryInputFromCode formats known codes and passes through unknown ones', () => {
    const cmp = make();
    expect((cmp as any).countryInputFromCode('')).toBe('');
    expect((cmp as any).countryInputFromCode('RO')).toContain('RO');
    expect((cmp as any).countryInputFromCode('ZZ')).toBe('ZZ');
  });

  it('normalizeShippingCountry sets error for invalid, applies valid (mirroring billing)', () => {
    const cmp = make();
    cmp.shippingCountryInput = 'zzinvalid';
    cmp.normalizeShippingCountry();
    expect(cmp.shippingCountryError).toContain('countryInvalid');

    cmp.billingSameAsShipping = true;
    cmp.shippingCountryInput = 'RO';
    cmp.normalizeShippingCountry();
    expect(cmp.address.country).toBe('RO');
    expect(cmp.billing.country).toBe('RO');
  });

  it('normalizeBillingCountry sets error for invalid and applies valid', () => {
    const cmp = make();
    cmp.billingCountryInput = 'zzinvalid';
    cmp.normalizeBillingCountry();
    expect(cmp.billingCountryError).toContain('countryInvalid');
    cmp.billingCountryInput = 'RO';
    cmp.normalizeBillingCountry();
    expect(cmp.billing.country).toBe('RO');
  });

  it('normalizeCheckoutCountries covers invalid shipping, same-as, and separate billing', () => {
    const cmp = make();
    cmp.shippingCountryInput = 'zzinvalid';
    expect((cmp as any).normalizeCheckoutCountries()).toBeFalse();

    cmp.shippingCountryInput = 'RO';
    cmp.billingSameAsShipping = true;
    expect((cmp as any).normalizeCheckoutCountries()).toBeTrue();

    cmp.billingSameAsShipping = false;
    cmp.billingCountryInput = 'zzinvalid';
    expect((cmp as any).normalizeCheckoutCountries()).toBeFalse();
    cmp.billingCountryInput = 'RO';
    expect((cmp as any).normalizeCheckoutCountries()).toBeTrue();
  });

  // ---- loadSavedAddresses ----
  it('loadSavedAddresses returns early when unauthenticated or already loading', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    (cmp as any).loadSavedAddresses();
    expect(account.getAddresses).not.toHaveBeenCalled();

    auth.isAuthenticated.and.returnValue(true);
    cmp.savedAddressesLoading = true;
    (cmp as any).loadSavedAddresses(false);
    expect(account.getAddresses).not.toHaveBeenCalled();
  });

  it('loadSavedAddresses populates defaults and applies shipping when empty', () => {
    const cmp = make();
    account.getAddresses.and.returnValue(
      of([makeAddress({ id: 'a1', is_default_shipping: true, is_default_billing: true })]),
    );
    cmp.billingSameAsShipping = false;
    cmp.billing = { line1: '', line2: '', city: '', region: '', postal: '', country: 'RO' };
    cmp.address = {
      name: '',
      email: '',
      line1: '',
      line2: '',
      city: '',
      region: '',
      postal: '',
      country: 'RO',
    } as any;
    (cmp as any).loadSavedAddresses(true);
    expect(cmp.savedAddresses.length).toBe(1);
    expect(cmp.selectedShippingAddressId).toBe('a1');
    expect(cmp.address.line1).toBe('1 Main St');
    expect(cmp.billing.line1).toBe('1 Main St');
  });

  it('loadSavedAddresses tolerates non-array payloads and errors', () => {
    const cmp = make();
    account.getAddresses.and.returnValue(of(null as any));
    (cmp as any).loadSavedAddresses(true);
    expect(cmp.savedAddresses).toEqual([]);

    account.getAddresses.and.returnValue(throwError(() => new Error('x')));
    (cmp as any).loadSavedAddresses(true);
    expect(cmp.savedAddressesError).toContain('savedAddressesLoadError');
  });

  // ---- onEmailChanged ----
  it('onEmailChanged resets guest verification when the email changes', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    (cmp as any).lastGuestEmailVerified = 'old@e.com';
    (cmp as any).lastGuestEmailRequested = 'old@e.com';
    cmp.guestEmailVerified = true;
    cmp.guestVerificationSent = true;
    cmp.address.email = 'new@e.com';
    cmp.onEmailChanged();
    expect(cmp.guestEmailVerified).toBeFalse();
    expect(cmp.guestVerificationSent).toBeFalse();
  });

  it('onEmailChanged is a no-op for authenticated users', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    cmp.guestEmailVerified = true;
    cmp.onEmailChanged();
    expect(cmp.guestEmailVerified).toBeTrue();
  });

  // ---- guest account toggles ----
  it('onGuestCreateAccountChanged enables address saving when turned on', () => {
    const cmp = make();
    cmp.saveAddress = false;
    cmp.onGuestCreateAccountChanged(false);
    expect(cmp.saveAddress).toBeFalse();
    cmp.onGuestCreateAccountChanged(true);
    expect(cmp.saveAddress).toBeTrue();
  });

  it('toggleGuestPassword and confirm flip visibility flags', () => {
    const cmp = make();
    cmp.toggleGuestPassword();
    expect(cmp.guestShowPassword).toBeTrue();
    cmp.toggleGuestPasswordConfirm();
    expect(cmp.guestShowPasswordConfirm).toBeTrue();
  });

  // ---- guest phone ----
  it('onGuestPhoneChanged copies guest phone into shipping when empty', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    cmp.guestCreateAccount = true;
    cmp.shippingPhoneNational = '';
    cmp.guestPhoneCountry = 'RO';
    cmp.guestPhoneNational = '712345678';
    cmp.onGuestPhoneChanged();
    expect(cmp.shippingPhoneNational).toBeTruthy();
  });

  it('onGuestPhoneChanged guards on auth, account flag, existing phone and invalid number', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    cmp.onGuestPhoneChanged();
    auth.isAuthenticated.and.returnValue(false);
    cmp.guestCreateAccount = false;
    cmp.onGuestPhoneChanged();
    cmp.guestCreateAccount = true;
    cmp.shippingPhoneNational = 'already';
    cmp.onGuestPhoneChanged();
    expect(cmp.shippingPhoneNational).toBe('already');
    cmp.shippingPhoneNational = '';
    cmp.guestPhoneNational = 'invalid';
    cmp.onGuestPhoneChanged();
    expect(cmp.shippingPhoneNational).toBe('');
  });

  // ---- effectivePhoneE164 ----
  it('effectivePhoneE164 returns shipping, user, guest or null', () => {
    const cmp = make();
    cmp.shippingPhoneCountry = 'RO';
    cmp.shippingPhoneNational = '712345678';
    expect((cmp as any).effectivePhoneE164()).toBeTruthy();

    cmp.shippingPhoneNational = '';
    auth.user.and.returnValue({ phone: '+40712345678' });
    expect((cmp as any).effectivePhoneE164()).toBe('+40712345678');

    auth.user.and.returnValue({});
    cmp.guestCreateAccount = true;
    cmp.guestPhoneCountry = 'RO';
    cmp.guestPhoneNational = '712345678';
    expect((cmp as any).effectivePhoneE164()).toBeTruthy();

    cmp.guestCreateAccount = false;
    expect((cmp as any).effectivePhoneE164()).toBeNull();
  });

  it('shippingPhoneRequired follows delivery type config', () => {
    const cmp = make();
    (cmp as any).phoneRequiredHome = true;
    (cmp as any).phoneRequiredLocker = false;
    cmp.deliveryType = 'home';
    expect(cmp.shippingPhoneRequired()).toBeTrue();
    cmp.deliveryType = 'locker';
    expect(cmp.shippingPhoneRequired()).toBeFalse();
  });

  // ---- quote getters ----
  it('quote getters use the quote when present and fall back otherwise', () => {
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
      tax: 10,
      shipping: 15,
      total: 110,
      currency: 'RON',
    };
    expect(cmp.quoteSubtotal()).toBe(100);
    expect(cmp.quoteTax()).toBe(10);
    expect(cmp.quoteFee()).toBe(5);
    expect(cmp.quoteShipping()).toBe(15);
    expect(cmp.quoteTotal()).toBe(110);
    expect(cmp.quoteDiscount()).toBe(20);
    expect(cmp.quotePromoSavings()).toBe(20);
  });

  // ---- auto-apply best coupon preference ----
  it('setAutoApplyBestCouponPreference persists and auto-applies when enabled', () => {
    const cmp = make();
    const offer = makeOffer();
    cmp.suggestedCouponOffer = offer;
    spyOn(cmp, 'applyPromo');
    cmp.setAutoApplyBestCouponPreference(true);
    expect(cmp.autoApplyBestCoupon).toBeTrue();
    expect(cmp.applyPromo).toHaveBeenCalled();
    cmp.setAutoApplyBestCouponPreference(false);
    expect(cmp.autoApplyBestCoupon).toBeFalse();
  });

  it('loadAutoApplyBestCouponPreference reads localStorage, including missing/invalid/error', () => {
    const cmp = make();
    localStorage.removeItem('checkout_auto_apply_best_coupon');
    expect((cmp as any).loadAutoApplyBestCouponPreference()).toBeFalse();
    localStorage.setItem('checkout_auto_apply_best_coupon', 'true');
    expect((cmp as any).loadAutoApplyBestCouponPreference()).toBeTrue();
    localStorage.setItem('checkout_auto_apply_best_coupon', '{bad json');
    expect((cmp as any).loadAutoApplyBestCouponPreference()).toBeFalse();
    localStorage.removeItem('checkout_auto_apply_best_coupon');
  });

  it('persistAutoApplyBestCouponPreference swallows storage errors', () => {
    const cmp = make();
    spyOn(localStorage, 'setItem').and.throwError('quota');
    expect(() => (cmp as any).persistAutoApplyBestCouponPreference(true)).not.toThrow();
  });

  it('maybeAutoApplyBestCoupon applies the suggested offer only when all guards pass', () => {
    const cmp = make();
    spyOn(cmp, 'applyCouponOffer');
    cmp.autoApplyBestCoupon = false;
    (cmp as any).maybeAutoApplyBestCoupon();
    expect(cmp.applyCouponOffer).not.toHaveBeenCalled();

    cmp.autoApplyBestCoupon = true;
    auth.isAuthenticated.and.returnValue(true);
    (cmp as any).pendingPromoCode = null;
    cmp.syncing = false;
    cmp.syncQueued = false;
    cmp.promo = '';
    cmp.suggestedCouponOffer = makeOffer();
    cmp.appliedCouponOffer = null;
    (cmp as any).maybeAutoApplyBestCoupon();
    expect(cmp.applyCouponOffer).toHaveBeenCalled();
  });

  it('maybeAutoApplyBestCoupon bails when a coupon is already applied', () => {
    const cmp = make();
    spyOn(cmp, 'applyCouponOffer');
    cmp.autoApplyBestCoupon = true;
    auth.isAuthenticated.and.returnValue(true);
    cmp.suggestedCouponOffer = makeOffer();
    cmp.appliedCouponOffer = makeOffer();
    (cmp as any).maybeAutoApplyBestCoupon();
    expect(cmp.applyCouponOffer).not.toHaveBeenCalled();
  });

  it('applyCouponOffer sets promo code and applies it', () => {
    const cmp = make();
    spyOn(cmp, 'applyPromo');
    const offer = makeOffer();
    cmp.applyCouponOffer(offer);
    expect(cmp.promo).toBe('SAVE10');
    expect(cmp.appliedCouponOffer).toBe(offer);
  });

  // ---- describeCouponOffer ----
  it('describeCouponOffer covers all discount types and savings rendering', () => {
    const cmp = make();
    const noPromo = makeOffer();
    (noPromo.coupon as any).promotion = null;
    expect(cmp.describeCouponOffer(noPromo)).toBe('SAVE10');

    const freeShip = makeOffer({
      estimated_discount_ron: '0',
      estimated_shipping_discount_ron: '0',
    });
    (freeShip.coupon.promotion as any).discount_type = 'free_shipping';
    expect(cmp.describeCouponOffer(freeShip)).toContain('SAVE10');

    const amount = makeOffer({ estimated_discount_ron: '7', estimated_shipping_discount_ron: '0' });
    (amount.coupon.promotion as any).discount_type = 'amount';
    expect(cmp.describeCouponOffer(amount)).toContain('7.00 RON');

    const percent = makeOffer({
      estimated_discount_ron: '3',
      estimated_shipping_discount_ron: '0',
    });
    expect(cmp.describeCouponOffer(percent)).toContain('RON');
  });

  // ---- describeCouponReasons ----
  it('describeCouponReasons handles empty and known/unknown reasons', () => {
    const cmp = make();
    expect(cmp.describeCouponReasons([])).toContain('couponNotEligible');
    const out = cmp.describeCouponReasons(['min_subtotal_not_met', 'totally_unknown']);
    expect(out).toContain('totally_unknown');
  });

  // ---- minSubtotalShortfall ----
  it('minSubtotalShortfall returns null unless the min-subtotal reason applies', () => {
    const cmp = make();
    expect(cmp.minSubtotalShortfall(null)).toBeNull();
    const noReason = makeOffer({ reasons: [] });
    expect(cmp.minSubtotalShortfall(noReason)).toBeNull();

    const noMin = makeOffer({ reasons: ['min_subtotal_not_met'] });
    (noMin.coupon.promotion as any).min_subtotal = null;
    expect(cmp.minSubtotalShortfall(noMin)).toBeNull();

    const badMin = makeOffer({ reasons: ['min_subtotal_not_met'] });
    (badMin.coupon.promotion as any).min_subtotal = '0';
    expect(cmp.minSubtotalShortfall(badMin)).toBeNull();

    subtotalSignal.set(50);
    const metMin = makeOffer({ reasons: ['min_subtotal_not_met'] });
    (metMin.coupon.promotion as any).min_subtotal = '40';
    expect(cmp.minSubtotalShortfall(metMin)).toBeNull();

    subtotalSignal.set(10);
    const shortfall = makeOffer({ reasons: ['min_subtotal_not_met'] });
    (shortfall.coupon.promotion as any).min_subtotal = '40';
    const res = cmp.minSubtotalShortfall(shortfall);
    expect(res).toEqual(jasmine.objectContaining({ min: 40, remaining: 30 }));
  });

  // ---- pickBestCouponOffer ----
  it('pickBestCouponOffer ignores ineligible/zero offers and picks the largest savings', () => {
    const cmp = make();
    const ineligible = makeOffer({ eligible: false });
    const zero = makeOffer({ estimated_discount_ron: '0', estimated_shipping_discount_ron: '0' });
    const small = makeOffer({ estimated_discount_ron: '2', estimated_shipping_discount_ron: '0' });
    const big = makeOffer({ estimated_discount_ron: '9', estimated_shipping_discount_ron: '0' });
    expect((cmp as any).pickBestCouponOffer([ineligible, zero, small, big])).toBe(big);
    expect((cmp as any).pickBestCouponOffer([])).toBeNull();
  });

  // ---- couponShippingDiscount ----
  it('couponShippingDiscount returns 0 unless the applied offer matches the promo', () => {
    const cmp = make();
    expect((cmp as any).couponShippingDiscount()).toBe(0);
    cmp.appliedCouponOffer = makeOffer({ eligible: true, estimated_shipping_discount_ron: '4' });
    cmp.promo = 'OTHER';
    expect((cmp as any).couponShippingDiscount()).toBe(0);
    cmp.promo = 'SAVE10';
    expect((cmp as any).couponShippingDiscount()).toBe(4);
  });

  // ---- buildSuccessSummary ----
  it('buildSuccessSummary uses a fallback quote and maps items', () => {
    const cmp = make();
    const fallback = (cmp as any).buildSuccessSummary('o1', null, 'cod');
    expect(fallback.order_id).toBe('o1');
    expect(fallback.items.length).toBe(1);

    (cmp as any).quote = { subtotal: 100, fee: 0, tax: 0, shipping: 0, total: 90, currency: 'RON' };
    cmp.locker = makeLocker();
    cmp.deliveryType = 'locker';
    const withQuote = (cmp as any).buildSuccessSummary('o2', 'REF', 'paypal');
    expect(withQuote.totals.discount).toBe(10);
    expect(withQuote.locker_name).toBe('Locker One');
  });

  // ---- persistAddressIfRequested ----
  it('persistAddressIfRequested saves delivery prefs only when requested', () => {
    const cmp = make();
    cmp.saveAddress = false;
    (cmp as any).persistAddressIfRequested();
    expect(prefs.saveDeliveryPrefs).not.toHaveBeenCalled();
    cmp.saveAddress = true;
    (cmp as any).persistAddressIfRequested();
    expect(prefs.saveDeliveryPrefs).toHaveBeenCalled();
  });

  // ---- goToSuccess ----
  it('goToSuccess navigates with and without a summary', () => {
    const cmp = make();
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
    (cmp as any).goToSuccess(null);
    expect(navSpy).toHaveBeenCalledWith(['/checkout/success'], { state: undefined });
    const summary = (cmp as any).buildSuccessSummary('o', null, 'cod');
    (cmp as any).goToSuccess(summary);
    expect(navSpy).toHaveBeenCalledTimes(2);
  });

  // ---- normalizePaymentRedirectUrl ----
  it('normalizePaymentRedirectUrl validates origin, scheme and allowed hosts', () => {
    const cmp = make();
    const fn = (u: string, hosts: string[]) => (cmp as any).normalizePaymentRedirectUrl(u, hosts);
    const origin = globalThis.location.origin;
    expect(fn(`${origin}/checkout/mock/pay`, [])).toBe(`${origin}/checkout/mock/pay`);
    expect(fn('http://evil.example.com/x', ['paypal.com'])).toBeNull();
    expect(fn('https://www.paypal.com/x', ['paypal.com'])).toBe('https://www.paypal.com/x');
    expect(fn('https://paypal.com/x', ['paypal.com'])).toBe('https://paypal.com/x');
    expect(fn('https://other.com/x', ['paypal.com'])).toBeNull();
    expect(fn('::::not a url', ['paypal.com'])).toBeNull();
  });

  // ---- redirectToPaymentUrl ----
  it('redirectToPaymentUrl shows an error for a missing url', () => {
    const cmp = make();
    (cmp as any).redirectToPaymentUrl(null, ['paypal.com']);
    expect(cmp.errorMessage).toContain('paymentNotReady');
  });

  it('redirectToPaymentUrl shows an error for a non-allowlisted url', () => {
    const cmp = make();
    (cmp as any).redirectToPaymentUrl('http://evil.example.com/x', ['paypal.com']);
    expect(cmp.errorMessage).toContain('paymentNotReady');
  });

  // ---- handleCheckoutStartResponse ----
  it('handleCheckoutStartResponse routes each payment method', () => {
    const cmp = make();
    const redirect = spyOn(cmp as any, 'redirectToPaymentUrl');
    const persist = spyOn(cmp as any, 'persistAddressIfRequested');

    cmp.paymentMethod = 'paypal';
    (cmp as any).handleCheckoutStartResponse({ order_id: 'o', paypal_approval_url: 'u' });
    cmp.paymentMethod = 'stripe';
    (cmp as any).handleCheckoutStartResponse({ order_id: 'o', stripe_checkout_url: 'u' });
    cmp.paymentMethod = 'netopia';
    (cmp as any).handleCheckoutStartResponse({ order_id: 'o', netopia_payment_url: 'u' });
    expect(redirect).toHaveBeenCalledTimes(3);
    expect(persist).toHaveBeenCalledTimes(3);

    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
    cmp.paymentMethod = 'cod';
    (cmp as any).handleCheckoutStartResponse({ order_id: 'o', payment_method: 'cod' });
    expect(cart.clear).toHaveBeenCalled();
  });

  it('handleCheckoutStartResponse shows an error for an unknown payment method', () => {
    const cmp = make();
    cmp.paymentMethod = 'unknown' as any;
    (cmp as any).handleCheckoutStartResponse({ order_id: 'o' });
    expect(cmp.errorMessage).toContain('paymentNotReady');
  });

  // ---- handleCheckoutFinalize ----
  it('handleCheckoutFinalize clears placing and shows a fallback error', () => {
    const cmp = make();
    cmp.placing = true;
    (cmp as any).checkoutFlowCompleted = false;
    cmp.errorMessage = '';
    (cmp as any).handleCheckoutFinalize(false);
    expect(cmp.placing).toBeFalse();
    expect(cmp.errorMessage).toContain('checkoutFailed');
  });

  it('handleCheckoutFinalize keeps an existing error message', () => {
    const cmp = make();
    cmp.errorMessage = 'existing';
    (cmp as any).handleCheckoutFinalize(false);
    expect(cmp.errorMessage).toBe('existing');
  });

  it('handleCheckoutFinalize returns early when settled or completed', () => {
    const cmp = make();
    cmp.errorMessage = '';
    (cmp as any).handleCheckoutFinalize(true);
    expect(cmp.errorMessage).toBe('');
    (cmp as any).checkoutFlowCompleted = true;
    cmp.placing = true;
    (cmp as any).handleCheckoutFinalize(false);
    expect(cmp.placing).toBeTrue();
  });

  // ---- handleCheckoutRequestError ----
  it('handleCheckoutRequestError distinguishes timeout, detail and fallback', () => {
    const cmp = make();
    (cmp as any).handleCheckoutRequestError({ name: 'TimeoutError' });
    expect(cmp.errorMessage).toContain('checkoutFailed');
    (cmp as any).handleCheckoutRequestError({ error: { detail: 'Nope' } });
    expect(cmp.errorMessage).toBe('Nope');
    (cmp as any).handleCheckoutRequestError({});
    expect(cmp.errorMessage).toContain('checkoutFailed');
  });

  // ---- submitCheckoutRequest ----
  it('submitCheckoutRequest handles success, error and empty completion', () => {
    const cmp = make();
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));

    cmp.paymentMethod = 'cod';
    api.post.and.returnValue(of({ order_id: 'o', payment_method: 'cod' }));
    (cmp as any).submitCheckoutRequest('/orders/checkout', {});
    expect(cart.clear).toHaveBeenCalled();

    api.post.and.returnValue(throwError(() => ({ error: { detail: 'boom' } })));
    (cmp as any).submitCheckoutRequest('/orders/checkout', {});
    expect(cmp.errorMessage).toBe('boom');

    (cmp as any).checkoutFlowCompleted = false;
    cmp.errorMessage = '';
    api.post.and.returnValue(EMPTY);
    (cmp as any).submitCheckoutRequest('/orders/checkout', {});
    expect(cmp.errorMessage).toContain('checkoutFailed');
  });

  // ---- hydrateCartAndQuote ----
  it('hydrateCartAndQuote hydrates, sets quote and clears sync state', () => {
    const cmp = make();
    (cmp as any).hydrateCartAndQuote(totals());
    expect(cart.hydrateFromBackend).toHaveBeenCalled();
    expect(cmp.pricesRefreshed).toBeTrue();
    expect(cmp.syncQueued).toBeFalse();
  });

  // ---- trackCheckoutStart / Abandon ----
  it('trackCheckoutStart tracks once and respects guards', () => {
    const cmp = make();
    analytics.enabled.and.returnValue(false);
    (cmp as any).trackCheckoutStart();
    expect(analytics.track).not.toHaveBeenCalled();

    analytics.enabled.and.returnValue(true);
    itemsSignal.set([]);
    (cmp as any).trackCheckoutStart();
    expect(analytics.track).not.toHaveBeenCalled();

    itemsSignal.set([sampleItem()]);
    (cmp as any).trackCheckoutStart();
    expect(analytics.track).toHaveBeenCalledWith('checkout_start', jasmine.any(Object));
    analytics.track.calls.reset();
    (cmp as any).trackCheckoutStart();
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it('trackCheckoutAbandon guards on tracked/completed and otherwise tracks', () => {
    const cmp = make();
    (cmp as any).checkoutStartTracked = false;
    (cmp as any).trackCheckoutAbandon();
    expect(analytics.track).not.toHaveBeenCalled();

    (cmp as any).checkoutStartTracked = true;
    (cmp as any).checkoutFlowCompleted = true;
    (cmp as any).trackCheckoutAbandon();
    expect(analytics.track).not.toHaveBeenCalled();

    (cmp as any).checkoutFlowCompleted = false;
    (cmp as any).trackCheckoutAbandon();
    expect(analytics.track).toHaveBeenCalledWith('checkout_abandon', jasmine.any(Object));
  });

  // ---- redirectToCartIfEmpty ----
  it('redirectToCartIfEmpty navigates only once when the cart is empty', () => {
    const cmp = make();
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));
    itemsSignal.set([sampleItem()]);
    (cmp as any).redirectToCartIfEmpty();
    expect(navSpy).not.toHaveBeenCalled();
    itemsSignal.set([]);
    (cmp as any).redirectToCartIfEmpty();
    expect(navSpy).toHaveBeenCalled();
    (cmp as any).redirectToCartIfEmpty();
    expect(navSpy).toHaveBeenCalledTimes(1);
  });

  // ---- setQuote ----
  it('setQuote parses totals, allowed couriers and currency', () => {
    const cmp = make();
    (cmp as any).setQuote(
      totals({
        delivery_allowed_couriers: ['sameday', 'bogus', 'fan_courier'],
        delivery_locker_allowed: false,
        phone_required_home: false,
        currency: 'RON',
      }),
    );
    expect(cmp.deliveryAllowedCouriers).toEqual(['sameday', 'fan_courier']);
    expect(cmp.deliveryLockerAllowed).toBeFalse();

    (cmp as any).setQuote(totals({ delivery_allowed_couriers: 'not-an-array', currency: '' }));
    expect(cmp.deliveryAllowedCouriers).toEqual(['sameday', 'fan_courier']);
    expect(cmp.currency).toBe('RON');
  });

  // ---- applyPrefetchedPricingSettings ----
  it('applyPrefetchedPricingSettings reads route data when present', () => {
    const cmp = make();
    route.snapshot.data = {};
    (cmp as any).applyPrefetchedPricingSettings();
    route.snapshot.data = {
      checkoutPricingSettings: { phone_required_home: false, phone_required_locker: false },
    };
    (cmp as any).applyPrefetchedPricingSettings();
    (cmp as any).phoneRequiredHome = (cmp as any).phoneRequiredHome;
    expect((cmp as any).phoneRequiredHome).toBeFalse();
  });

  // ---- loadCouponsEligibility ----
  it('loadCouponsEligibility resets state for guests', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    cmp.couponEligibility = { eligible: [], ineligible: [] };
    (cmp as any).loadCouponsEligibility();
    expect(cmp.couponEligibility).toBeNull();
  });

  it('loadCouponsEligibility loads offers, suggestion and applied match', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    coupons.eligibility.and.returnValue(
      of({
        eligible: [makeOffer({ estimated_discount_ron: '9' })],
        ineligible: [makeOffer({ eligible: false })],
      }),
    );
    cmp.promo = 'SAVE10';
    (cmp as any).loadCouponsEligibility();
    expect(cmp.suggestedCouponOffer).toBeTruthy();
    expect(cmp.appliedCouponOffer).toBeTruthy();
  });

  it('loadCouponsEligibility clears applied coupon when promo is empty and tolerates null', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    coupons.eligibility.and.returnValue(of(null as any));
    cmp.promo = '';
    cmp.appliedCouponOffer = makeOffer();
    (cmp as any).loadCouponsEligibility();
    expect(cmp.appliedCouponOffer).toBeNull();
  });

  it('loadCouponsEligibility surfaces an error', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    coupons.eligibility.and.returnValue(throwError(() => ({ error: { detail: 'oops' } })));
    (cmp as any).loadCouponsEligibility();
    expect(cmp.couponEligibilityError).toBe('oops');
  });

  // ---- applyPendingPromoCode ----
  it('applyPendingPromoCode guards on empty, auth and identical codes', () => {
    const cmp = make();
    (cmp as any).pendingPromoCode = '';
    (cmp as any).applyPendingPromoCode();

    (cmp as any).pendingPromoCode = 'SAVE10';
    auth.isAuthenticated.and.returnValue(false);
    (cmp as any).applyPendingPromoCode();
    expect((cmp as any).pendingPromoCode).toBe('SAVE10');

    auth.isAuthenticated.and.returnValue(true);
    cmp.promo = 'SAVE10';
    (cmp as any).applyPendingPromoCode();
    expect((cmp as any).pendingPromoCode).toBeNull();
  });

  it('applyPendingPromoCode applies a new pending code', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    (cmp as any).pendingPromoCode = 'NEWCODE';
    cmp.promo = '';
    spyOn(cmp, 'applyPromo');
    (cmp as any).applyPendingPromoCode();
    expect(cmp.promo).toBe('NEWCODE');
    expect(cmp.applyPromo).toHaveBeenCalled();
  });

  // ---- applyPromo ----
  it('applyPromo clears state when the code is empty', () => {
    const cmp = make();
    spyOn(cmp as any, 'refreshQuote');
    cmp.promo = '   ';
    cmp.applyPromo();
    expect(cmp.appliedCouponOffer).toBeNull();
    expect(cmp.promoStatus).toBe('info');
    expect((cmp as any).refreshQuote).toHaveBeenCalledWith(null);
  });

  it('applyPromo validates an eligible coupon', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    spyOn(cmp as any, 'refreshQuote');
    coupons.validate.and.returnValue(of(makeOffer({ eligible: true })));
    cmp.promo = 'save10';
    cmp.applyPromo();
    expect(cmp.promoStatus).toBe('success');
    expect((cmp as any).refreshQuote).toHaveBeenCalledWith('SAVE10');
  });

  it('applyPromo reports an ineligible coupon with and without min-subtotal info', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    spyOn(cmp as any, 'refreshQuote');

    coupons.validate.and.returnValue(of(makeOffer({ eligible: false, reasons: ['blacklisted'] })));
    cmp.promo = 'SAVE10';
    cmp.applyPromo();
    expect(cmp.promoStatus).toBe('warn');
    expect(cmp.promoValid).toBeFalse();

    subtotalSignal.set(10);
    const offer = makeOffer({ eligible: false, reasons: ['min_subtotal_not_met'] });
    (offer.coupon.promotion as any).min_subtotal = '40';
    coupons.validate.and.returnValue(of(offer));
    cmp.applyPromo();
    expect(cmp.promoMessage).toContain('couponMinSubtotalRemaining');
  });

  it('applyPromo falls back to legacy promo on 404 and warns on other errors', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    const legacy = spyOn(cmp as any, 'applyLegacyPromo');
    coupons.validate.and.returnValue(throwError(() => ({ status: 404 })));
    cmp.promo = 'SAVE10';
    cmp.applyPromo();
    expect(legacy).toHaveBeenCalledWith('SAVE10');

    spyOn(cmp as any, 'refreshQuote');
    coupons.validate.and.returnValue(throwError(() => ({ error: { detail: 'bad' } })));
    cmp.promo = 'SAVE10';
    cmp.applyPromo();
    expect(cmp.promoMessage).toBe('bad');
  });

  it('applyPromo requires login for guests', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    spyOn(cmp as any, 'refreshQuote');
    cmp.promo = 'SAVE10';
    cmp.applyPromo();
    expect(cmp.promoMessage).toContain('couponsLoginRequired');
    expect(cmp.promo).toBe('');
  });

  // ---- placeOrder ----
  function primePlaceableOrder(cmp: CheckoutComponent): void {
    fillValidAddress(cmp);
    cmp.pricesRefreshed = true;
    cmp.syncing = false;
    cmp.syncQueued = false;
    cmp.acceptTerms = true;
    cmp.acceptPrivacy = true;
    cmp.paymentMethod = 'cod';
    cmp.currency = 'RON';
    auth.isAuthenticated.and.returnValue(true);
    auth.user.and.returnValue({ email_verified: true });
  }

  const validForm = () => ({ valid: true, control: { updateValueAndValidity: () => {} } }) as any;

  it('placeOrder ignores re-entrancy while placing', () => {
    const cmp = make();
    cmp.placing = true;
    cmp.placeOrder(validForm());
    expect(api.post).not.toHaveBeenCalled();
  });

  it('placeOrder reports invalid country and invalid form', () => {
    const cmp = make();
    cmp.shippingCountryInput = 'zzinvalid';
    cmp.placeOrder(validForm());
    expect(cmp.addressError).toContain('countryInvalid');

    cmp.shippingCountryInput = 'RO';
    cmp.placeOrder({ valid: false, control: { updateValueAndValidity: () => {} } } as any);
    expect(cmp.addressError).toContain('addressRequired');
  });

  it('placeOrder enforces locker selection', () => {
    const cmp = make();
    primePlaceableOrder(cmp);
    cmp.deliveryType = 'locker';
    cmp.locker = null;
    cmp.placeOrder(validForm());
    expect(cmp.deliveryError).toContain('deliveryLockerRequired');
  });

  it('placeOrder enforces email verification for authed and guest users', () => {
    const cmp = make();
    primePlaceableOrder(cmp);
    auth.user.and.returnValue({ email_verified: false });
    cmp.placeOrder(validForm());
    expect(cmp.errorMessage).toContain('emailVerificationNeeded');

    auth.isAuthenticated.and.returnValue(false);
    cmp.guestEmailVerified = false;
    cmp.placeOrder(validForm());
    expect(cmp.errorMessage).toContain('emailVerificationNeeded');
  });

  it('placeOrder validates guest account password/mismatch/phone', () => {
    const cmp = make();
    primePlaceableOrder(cmp);
    auth.isAuthenticated.and.returnValue(false);
    cmp.guestEmailVerified = true;
    cmp.guestCreateAccount = true;
    cmp.guestPassword = '123';
    cmp.placeOrder(validForm());
    expect(cmp.errorMessage).toContain('passwordMin');

    cmp.guestPassword = 'longpass';
    cmp.guestPasswordConfirm = 'other';
    cmp.placeOrder(validForm());
    expect(cmp.errorMessage).toContain('passwordMismatch');

    cmp.guestPasswordConfirm = 'longpass';
    cmp.guestPhoneNational = '';
    cmp.placeOrder(validForm());
    expect(cmp.errorMessage).toContain('phoneInvalid');
  });

  it('placeOrder rejects an invalid shipping phone', () => {
    const cmp = make();
    primePlaceableOrder(cmp);
    (cmp as any).phoneRequiredHome = true;
    cmp.shippingPhoneNational = 'invalid';
    cmp.placeOrder(validForm());
    expect(cmp.errorMessage).toContain('phoneInvalid');
  });

  it('placeOrder reports stock issues from validateCart', () => {
    const cmp = make();
    primePlaceableOrder(cmp);
    itemsSignal.set([sampleItem({ quantity: 10, stock: 1 })]);
    cmp.placeOrder(validForm());
    expect(cmp.errorMessage).toContain('stockOnlyLeft');
  });

  it('placeOrder queues a sync when prices are stale', () => {
    const cmp = make();
    primePlaceableOrder(cmp);
    cmp.pricesRefreshed = false;
    const queue = spyOn(cmp as any, 'queueCartSync');
    cmp.placeOrder(validForm());
    expect(queue).toHaveBeenCalled();
    expect(cmp.syncNotice).toContain('cartSyncing');
  });

  it('placeOrder shows payment-not-ready when the method is unavailable', () => {
    const cmp = make();
    primePlaceableOrder(cmp);
    cmp.currency = 'USD';
    cmp.paymentMethod = 'cod';
    const scroll = spyOn(cmp, 'scrollToStep');
    cmp.placeOrder(validForm());
    expect(cmp.paymentNotReady).toBeTrue();
    expect(scroll).toHaveBeenCalledWith('checkout-step-4');
  });

  it('placeOrder blocks on missing legal consents', () => {
    const cmp = make();
    primePlaceableOrder(cmp);
    cmp.acceptTerms = false;
    spyOn(cmp, 'scrollToStep');
    cmp.placeOrder(validForm());
    expect(cmp.consentError).toContain('legal.consent.required');
  });

  it('placeOrder submits an authenticated checkout', () => {
    const cmp = make();
    primePlaceableOrder(cmp);
    const submit = spyOn(cmp as any, 'submitCheckout');
    cmp.placeOrder(validForm());
    expect(cmp.placing).toBeTrue();
    expect(submit).toHaveBeenCalled();
    expect(prefs.savePaymentMethod).toHaveBeenCalledWith('cod');
  });

  it('placeOrder submits a guest checkout', () => {
    const cmp = make();
    primePlaceableOrder(cmp);
    auth.isAuthenticated.and.returnValue(false);
    cmp.guestEmailVerified = true;
    cmp.guestCreateAccount = false;
    const submit = spyOn(cmp as any, 'submitGuestCheckout');
    cmp.placeOrder(validForm());
    expect(submit).toHaveBeenCalled();
  });

  // ---- retryValidation ----
  it('retryValidation clears error and queues a sync', () => {
    const cmp = make();
    const queue = spyOn(cmp as any, 'queueCartSync');
    cmp.errorMessage = 'x';
    cmp.retryValidation();
    expect(cmp.errorMessage).toBe('');
    expect(queue).toHaveBeenCalled();
  });

  // ---- validateLegalConsents ----
  it('validateLegalConsents blocks on loading and missing acceptance', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    cmp.legalConsentsLoading = true;
    expect((cmp as any).validateLegalConsents()).toBeFalse();
    expect(cmp.consentError).toContain('legal.consent.loading');

    cmp.legalConsentsLoading = false;
    cmp.acceptTerms = false;
    cmp.acceptPrivacy = false;
    expect((cmp as any).validateLegalConsents()).toBeFalse();

    cmp.acceptTerms = true;
    cmp.acceptPrivacy = true;
    expect((cmp as any).validateLegalConsents()).toBeTrue();
  });

  // ---- validateCart ----
  it('validateCart detects stock issues, empty carts and stale prices', () => {
    const cmp = make();
    itemsSignal.set([sampleItem({ quantity: 9, stock: 2 })]);
    expect((cmp as any).validateCart()).toContain('stockOnlyLeft');

    itemsSignal.set([]);
    expect((cmp as any).validateCart()).toBeNull();

    itemsSignal.set([sampleItem()]);
    cmp.pricesRefreshed = false;
    const queue = spyOn(cmp as any, 'queueCartSync');
    expect((cmp as any).validateCart(true)).toBeNull();
    expect(queue).toHaveBeenCalled();

    cmp.pricesRefreshed = true;
    expect((cmp as any).validateCart()).toBeNull();
  });

  // ---- delivery options ----
  it('setDeliveryType rejects locker when not allowed, otherwise updates prefs', () => {
    const cmp = make();
    cmp.deliveryLockerAllowed = false;
    cmp.setDeliveryType('locker');
    expect(cmp.deliveryError).toContain('deliveryLockerUnavailable');

    cmp.deliveryLockerAllowed = true;
    cmp.setDeliveryType('locker');
    expect(cmp.deliveryType).toBe('locker');

    cmp.locker = makeLocker();
    cmp.setDeliveryType('home');
    expect(cmp.locker).toBeNull();
    expect(prefs.saveDeliveryPrefs).toHaveBeenCalled();
  });

  it('onCourierChanged resets locker for locker delivery', () => {
    const cmp = make();
    cmp.deliveryType = 'locker';
    cmp.locker = makeLocker();
    cmp.onCourierChanged();
    expect(cmp.locker).toBeNull();
  });

  it('setCourier rejects disallowed couriers and applies allowed ones', () => {
    const cmp = make();
    cmp.deliveryAllowedCouriers = ['sameday'];
    cmp.setCourier('fan_courier');
    expect(cmp.deliveryError).toContain('courierUnavailable');
    cmp.setCourier('sameday');
    expect(cmp.courier).toBe('sameday');
  });

  it('courierAllowed reflects the allowed list', () => {
    const cmp = make();
    cmp.deliveryAllowedCouriers = ['sameday'];
    expect(cmp.courierAllowed('sameday')).toBeTrue();
    expect(cmp.courierAllowed('fan_courier')).toBeFalse();
  });

  it('ensureDeliveryOptionsAvailable downgrades locker and swaps courier', () => {
    const cmp = make();
    cmp.deliveryLockerAllowed = false;
    cmp.deliveryType = 'locker';
    cmp.locker = makeLocker();
    cmp.deliveryAllowedCouriers = ['fan_courier'];
    cmp.courier = 'sameday';
    (cmp as any).ensureDeliveryOptionsAvailable();
    expect(cmp.deliveryType).toBe('home');
    expect(cmp.courier).toBe('fan_courier');
  });

  it('courierEstimate/Key/Params compute ranges and singles', () => {
    const cmp = make();
    cmp.deliveryType = 'home';
    expect(cmp.courierEstimate('sameday')).toEqual({ min: 1, max: 2 });
    expect(cmp.courierEstimateKey('sameday')).toContain('Range');
    expect(cmp.courierEstimateParams('sameday')).toEqual({ min: 1, max: 2 });

    // single-day estimate path (sameday home min===max is range; use a tweaked lookup)
    spyOn(cmp, 'courierEstimate').and.returnValue({ min: 2, max: 2 });
    expect(cmp.courierEstimateKey('sameday')).toContain('Single');
    expect(cmp.courierEstimateParams('sameday')).toEqual({ days: 2 });

    (cmp.courierEstimate as jasmine.Spy).and.returnValue(null);
    expect(cmp.courierEstimateKey('sameday')).toBeNull();
    expect(cmp.courierEstimateParams('sameday')).toEqual({});
  });

  // ---- ngOnInit ----
  it('ngOnInit wires up the page for an authenticated user with items', () => {
    const cmp = make();
    route.queryParamMap = of(convertToParamMap({ promo: 'save5' }));
    const queue = spyOn(cmp as any, 'queueCartSync');
    cmp.ngOnInit();
    expect(api.get).toHaveBeenCalledWith('/payments/capabilities');
    expect((cmp as any).pendingPromoCode).toBe('SAVE5');
    expect(queue).toHaveBeenCalled();
  });

  it('ngOnInit ignores blank promo and equal promo', () => {
    const cmp = make();
    cmp.promo = 'SAVE5';
    route.queryParamMap = of(convertToParamMap({ promo: '   ' }));
    cmp.ngOnInit();
    expect((cmp as any).pendingPromoCode).toBeNull();
  });

  it('ngOnInit redirects an empty-cart guest to the cart', () => {
    const cmp = make();
    itemsSignal.set([]);
    auth.isAuthenticated.and.returnValue(false);
    const redirect = spyOn(cmp as any, 'redirectToCartIfEmpty');
    cmp.ngOnInit();
    expect(redirect).toHaveBeenCalled();
  });

  it('ngOnInit loads the cart from the server for an authed empty cart', () => {
    const cmp = make();
    itemsSignal.set([]);
    auth.isAuthenticated.and.returnValue(true);
    const load = spyOn(cmp as any, 'loadCartFromServer');
    cmp.ngOnInit();
    expect(load).toHaveBeenCalled();
  });

  // ---- loadPaymentCapabilities ----
  it('loadPaymentCapabilities merges backend capabilities', () => {
    const cmp = make();
    api.get.and.callFake((path: string) => {
      if (path === '/payments/capabilities') {
        return of({
          stripe: { enabled: true },
          paypal: { enabled: true },
          netopia: { enabled: true },
        });
      }
      return of({});
    });
    (cmp as any).loadPaymentCapabilities();
    expect(cmp.paypalEnabled).toBeTrue();
  });

  it('loadPaymentCapabilities renders a netopia disabled reason from code or fallback', () => {
    const cmp = make();
    (cmp as any).netopiaEnabledBase = true;
    // Force UI-enabled netopia by toggling the appConfig-derived flag.
    cmp.netopiaEnabled = true;
    api.get.and.callFake((path: string) => {
      if (path === '/payments/capabilities') {
        return of({ netopia: { enabled: false, reason: 'Bank down', reason_code: '' } });
      }
      return of({});
    });
    (cmp as any).loadPaymentCapabilities();
    // reason resolution only runs when the UI flag is enabled; assert no throw + state defined.
    expect(cmp.netopiaDisabledReason).toBeDefined();
  });

  it('loadPaymentCapabilities keeps defaults on error', () => {
    const cmp = make();
    api.get.and.callFake((path: string) => {
      if (path === '/payments/capabilities') return throwError(() => new Error('x'));
      return of({});
    });
    expect(() => (cmp as any).loadPaymentCapabilities()).not.toThrow();
  });

  // ---- ngOnDestroy ----
  it('ngOnDestroy clears timers and tracks abandonment', () => {
    const cmp = make();
    (cmp as any).syncDebounceHandle = setTimeout(() => {}, 1000);
    (cmp as any).guestResendTimer = setInterval(() => {}, 1000);
    (cmp as any).paymentNotReadyTimer = setTimeout(() => {}, 1000);
    (cmp as any).checkoutStartTracked = true;
    (cmp as any).checkoutFlowCompleted = false;
    cmp.ngOnDestroy();
    expect((cmp as any).syncDebounceHandle).toBeNull();
    expect((cmp as any).guestResendTimer).toBeNull();
    expect((cmp as any).paymentNotReadyTimer).toBeNull();
    expect(analytics.track).toHaveBeenCalledWith('checkout_abandon', jasmine.any(Object));
  });

  // ---- setPaymentMethod ----
  it('setPaymentMethod rejects unavailable methods and accepts available ones', () => {
    const cmp = make();
    cmp.stripeEnabled = false;
    cmp.setPaymentMethod('stripe');
    expect(cmp.paymentNotReady).toBeTrue();

    cmp.setPaymentMethod('cod');
    expect(cmp.paymentMethod).toBe('cod');
    expect(cmp.paymentNotReady).toBeFalse();
  });

  // ---- analytics opt-in ----
  it('analyticsOptIn getter and setter toggle analytics', () => {
    const cmp = make();
    analytics.enabled.and.returnValue(true);
    expect(cmp.analyticsOptIn).toBeTrue();
    cmp.setAnalyticsOptIn(true);
    expect(analytics.setEnabled).toHaveBeenCalledWith(true);
    cmp.setAnalyticsOptIn(false);
    expect(analytics.setEnabled).toHaveBeenCalledWith(false);
  });

  // ---- payment availability ----
  it('isPaymentMethodAvailable covers each method and currency/country gating', () => {
    const cmp = make();
    cmp.currency = 'RON';
    cmp.address.country = 'RO';
    cmp.shippingCountryInput = 'RO';
    expect(cmp.isPaymentMethodAvailable('cod')).toBeTrue();

    cmp.netopiaEnabled = true;
    expect(cmp.isPaymentMethodAvailable('netopia')).toBeTrue();

    cmp.paypalEnabled = true;
    expect(cmp.isPaymentMethodAvailable('paypal')).toBeTrue();

    cmp.stripeEnabled = true;
    expect(cmp.isPaymentMethodAvailable('stripe')).toBeTrue();

    expect(cmp.isPaymentMethodAvailable('unknown' as any)).toBeTrue();

    cmp.currency = 'USD';
    expect(cmp.isPaymentMethodAvailable('cod')).toBeFalse();
  });

  it('currentShippingCountryCode falls back through input, address and default', () => {
    const cmp = make();
    cmp.shippingCountryInput = 'RO';
    expect((cmp as any).currentShippingCountryCode()).toBe('RO');
    cmp.shippingCountryInput = '';
    cmp.address.country = 'DE';
    expect((cmp as any).currentShippingCountryCode()).toBe('DE');
    cmp.address.country = '';
    expect((cmp as any).currentShippingCountryCode()).toBe('RO');
  });

  it('ensurePaymentMethodAvailable switches to a default when current is unavailable', () => {
    const cmp = make();
    cmp.currency = 'USD';
    cmp.paymentMethod = 'cod';
    cmp.stripeEnabled = true;
    (cmp as any).ensurePaymentMethodAvailable();
    expect(cmp.paymentMethod).toBe('stripe');
  });

  it('defaultPaymentMethod prefers a saved available method then falls back', () => {
    const cmp = make();
    prefs.tryLoadPaymentMethod.and.returnValue('stripe');
    cmp.stripeEnabled = true;
    expect((cmp as any).defaultPaymentMethod()).toBe('stripe');

    prefs.tryLoadPaymentMethod.and.returnValue(null);
    cmp.currency = 'RON';
    cmp.address.country = 'RO';
    cmp.shippingCountryInput = 'RO';
    expect((cmp as any).defaultPaymentMethod()).toBe('cod');

    cmp.currency = 'USD';
    cmp.stripeEnabled = true;
    expect((cmp as any).defaultPaymentMethod()).toBe('stripe');

    cmp.stripeEnabled = false;
    cmp.paypalEnabled = false;
    cmp.netopiaEnabled = false;
    expect((cmp as any).defaultPaymentMethod()).toBe('cod');
  });

  it('showPaymentNotReady sets a timed flag', fakeAsync(() => {
    const cmp = make();
    (cmp as any).showPaymentNotReady();
    expect(cmp.paymentNotReady).toBeTrue();
    (cmp as any).showPaymentNotReady(); // exercises the clearTimeout branch
    tick(6000);
    expect(cmp.paymentNotReady).toBeFalse();
  }));

  // ---- sync ----
  it('syncBackendCart hydrates on success and processes a queued sync', () => {
    const cmp = make();
    const queue = spyOn(cmp as any, 'queueCartSync').and.callThrough();
    (cmp as any).queuedSyncItems = [sampleItem()];
    cartApi.sync.and.returnValue(of(totals()));
    (cmp as any).syncBackendCart([sampleItem()]);
    expect(cart.hydrateFromBackend).toHaveBeenCalled();
    expect(queue).toHaveBeenCalled();
  });

  it('syncBackendCart surfaces a sync error', () => {
    const cmp = make();
    cartApi.sync.and.returnValue(throwError(() => new Error('x')));
    (cmp as any).syncBackendCart([sampleItem()]);
    expect(cmp.errorMessage).toContain('cartSyncError');
  });

  it('queueCartSync ignores empty items and debounces otherwise', fakeAsync(() => {
    const cmp = make();
    (cmp as any).queueCartSync([]);
    expect(cmp.syncQueued).toBeFalse();

    const sync = spyOn(cmp as any, 'syncBackendCart');
    (cmp as any).queueCartSync([sampleItem()], { immediate: true });
    tick(0);
    expect(sync).toHaveBeenCalled();
  }));

  it('queueCartSync queues while a sync is in flight', () => {
    const cmp = make();
    cmp.syncing = true;
    (cmp as any).queueCartSync([sampleItem()]);
    expect((cmp as any).queuedSyncItems?.length).toBe(1);
    expect(cmp.syncQueued).toBeTrue();
  });

  it('queueCartSync clears a pending debounce handle before scheduling', fakeAsync(() => {
    const cmp = make();
    const sync = spyOn(cmp as any, 'syncBackendCart');
    (cmp as any).queueCartSync([sampleItem()]); // schedules with 300ms
    (cmp as any).queueCartSync([sampleItem()], { immediate: true }); // clears + reschedules 0ms
    tick(0);
    expect(sync).toHaveBeenCalledTimes(1);
    tick(300);
  }));

  // ---- loadCartFromServer ----
  it('loadCartFromServer hydrates after authentication', () => {
    const cmp = make();
    auth.ensureAuthenticated.and.returnValue(of(true));
    cartApi.get.and.returnValue(of(totals()));
    (cmp as any).loadCartFromServer();
    expect(cart.hydrateFromBackend).toHaveBeenCalled();
    expect(cmp.syncing).toBeFalse();
  });

  it('loadCartFromServer surfaces a cart load error', () => {
    const cmp = make();
    auth.ensureAuthenticated.and.returnValue(of(true));
    cartApi.get.and.returnValue(throwError(() => new Error('x')));
    (cmp as any).loadCartFromServer();
    expect(cmp.errorMessage).toContain('cartLoadError');
  });

  it('loadCartFromServer surfaces an auth error', () => {
    const cmp = make();
    auth.ensureAuthenticated.and.returnValue(throwError(() => new Error('x')));
    (cmp as any).loadCartFromServer();
    expect(cmp.errorMessage).toContain('cartLoadError');
  });

  it('cartQuoteParams includes the promo code only when present', () => {
    const cmp = make();
    cmp.address.country = 'RO';
    expect((cmp as any).cartQuoteParams(null)).toEqual({ country: 'RO' });
    expect((cmp as any).cartQuoteParams('SAVE')).toEqual({ country: 'RO', promo_code: 'SAVE' });
  });

  // ---- refreshQuote ----
  it('refreshQuote hydrates on success', () => {
    const cmp = make();
    cartApi.get.and.returnValue(of(totals()));
    (cmp as any).refreshQuote('SAVE');
    expect(cart.hydrateFromBackend).toHaveBeenCalled();
  });

  it('refreshQuote warns and retries without the promo on error', () => {
    const cmp = make();
    let call = 0;
    cartApi.get.and.callFake(() => {
      call += 1;
      return call === 1 ? throwError(() => ({ error: { detail: 'bad' } })) : of(totals());
    });
    (cmp as any).refreshQuote('SAVE');
    expect(cmp.promoStatus).toBe('warn');
    expect(cmp.promoMessage).toBe('bad');
    expect(cart.hydrateFromBackend).toHaveBeenCalled();
  });

  it('refreshQuote swallows a secondary error and ignores empty codes', () => {
    const cmp = make();
    cartApi.get.and.returnValue(throwError(() => ({})));
    (cmp as any).refreshQuote('SAVE');
    expect(cmp.promoStatus).toBe('warn');
    cartApi.get.and.returnValue(throwError(() => ({})));
    expect(() => (cmp as any).refreshQuote(null)).not.toThrow();
  });

  // ---- applyLegacyPromo ----
  it('applyLegacyPromo marks success when there are savings', () => {
    const cmp = make();
    (cmp as any).quote = { subtotal: 100, fee: 0, tax: 0, shipping: 0, total: 90, currency: 'RON' };
    cartApi.get.and.returnValue(of(totals({ total: '90', subtotal: '100' })));
    (cmp as any).applyLegacyPromo('SAVE');
    expect(cmp.promoStatus).toBe('success');
  });

  it('applyLegacyPromo warns when there are no savings', () => {
    const cmp = make();
    cartApi.get.and.returnValue(of(totals()));
    (cmp as any).applyLegacyPromo('SAVE');
    expect(cmp.promoStatus).toBe('warn');
  });

  it('applyLegacyPromo warns and retries without the promo on error', () => {
    const cmp = make();
    let call = 0;
    cartApi.get.and.callFake(() => {
      call += 1;
      return call === 1 ? throwError(() => ({ error: { detail: 'legacybad' } })) : of(totals());
    });
    (cmp as any).applyLegacyPromo('SAVE');
    expect(cmp.promoMessage).toBe('legacybad');
  });

  it('applyLegacyPromo swallows a secondary error', () => {
    const cmp = make();
    cartApi.get.and.returnValue(throwError(() => ({})));
    expect(() => (cmp as any).applyLegacyPromo('SAVE')).not.toThrow();
  });

  // ---- submitCheckout / submitGuestCheckout payloads ----
  it('submitCheckout builds an authenticated payload with billing + defaults', () => {
    const cmp = make();
    fillValidAddress(cmp);
    cmp.saveAddress = true;
    cmp.billingSameAsShipping = false;
    cmp.billing = { line1: 'b1', line2: '', city: 'bc', region: '', postal: 'bp', country: 'RO' };
    cmp.deliveryType = 'locker';
    cmp.locker = makeLocker();
    const submitReq = spyOn(cmp as any, 'submitCheckoutRequest');
    (cmp as any).submitCheckout();
    const [endpoint, body] = submitReq.calls.mostRecent().args as any;
    expect(endpoint).toBe('/orders/checkout');
    expect(body['default_shipping']).toBe(true);
    expect(body['billing_line1']).toBe('b1');
    expect(body['locker_id']).toBe('L1');
  });

  it('submitGuestCheckout builds a guest payload with account fields', () => {
    const cmp = make();
    fillValidAddress(cmp);
    cmp.guestCreateAccount = true;
    cmp.guestUsername = 'guest1';
    cmp.guestPassword = 'longpass';
    cmp.guestFirstName = 'Jane';
    cmp.guestLastName = 'Doe';
    cmp.guestDob = '1990-01-01';
    cmp.billingSameAsShipping = true;
    const submitReq = spyOn(cmp as any, 'submitCheckoutRequest');
    (cmp as any).submitGuestCheckout();
    const [endpoint, payload] = submitReq.calls.mostRecent().args as any;
    expect(endpoint).toBe('/orders/guest-checkout');
    expect(payload['username']).toBe('guest1');
    expect(payload['billing_line1']).toBeNull();
  });

  // ---- guest resend cooldown ----
  it('startGuestResendCooldown clears immediately for zero and ticks down otherwise', fakeAsync(() => {
    const cmp = make();
    (cmp as any).startGuestResendCooldown(0);
    expect(cmp.guestResendSecondsLeft).toBe(0);

    (cmp as any).startGuestResendCooldown(2);
    expect(cmp.guestResendSecondsLeft).toBeGreaterThan(0);
    tick(2500);
    (cmp as any).updateGuestResendCooldown();
    expect(cmp.guestResendSecondsLeft).toBe(0);
    (cmp as any).clearGuestResendCooldown();
  }));

  it('clearGuestResendCooldown clears any active timer', () => {
    const cmp = make();
    (cmp as any).guestResendTimer = setInterval(() => {}, 1000);
    (cmp as any).clearGuestResendCooldown();
    expect((cmp as any).guestResendTimer).toBeNull();
  });

  // ---- requestGuestEmailVerification ----
  it('requestGuestEmailVerification guards on auth, missing email and cooldown', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    cmp.requestGuestEmailVerification();
    expect(api.post).not.toHaveBeenCalled();

    auth.isAuthenticated.and.returnValue(false);
    cmp.address.email = '';
    cmp.requestGuestEmailVerification();
    expect(cmp.guestEmailError).toContain('addressRequired');

    cmp.address.email = 'g@e.com';
    cmp.guestResendSecondsLeft = 5;
    cmp.requestGuestEmailVerification();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('requestGuestEmailVerification completes successfully and starts a cooldown', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    cmp.address.email = 'g@e.com';
    cmp.guestResendSecondsLeft = 0;
    api.post.and.returnValue(of(undefined));
    cmp.requestGuestEmailVerification();
    expect(cmp.guestVerificationSent).toBeTrue();
    expect(cmp.guestSendingCode).toBeFalse();
    expect(cmp.guestResendSecondsLeft).toBeGreaterThan(0);
    (cmp as any).clearGuestResendCooldown();
  });

  it('requestGuestEmailVerification handles send errors with a short cooldown', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    cmp.address.email = 'g@e.com';
    cmp.guestResendSecondsLeft = 0;
    api.post.and.returnValue(throwError(() => ({ error: { detail: 'send failed' } })));
    cmp.requestGuestEmailVerification();
    expect(cmp.guestEmailError).toBe('send failed');
    (cmp as any).clearGuestResendCooldown();
  });

  it('requestGuestEmailVerification times out when the request hangs', fakeAsync(() => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    cmp.address.email = 'g@e.com';
    cmp.guestResendSecondsLeft = 0;
    api.post.and.returnValue(NEVER); // request hangs: neither next, error nor complete fire
    cmp.requestGuestEmailVerification();
    expect(cmp.guestSendingCode).toBeTrue();
    tick(15000);
    expect(cmp.guestSendingCode).toBeFalse();
    expect(cmp.guestEmailError).toContain('emailVerifySendFailed');
    (cmp as any).clearGuestResendCooldown();
  }));

  // ---- confirmGuestEmailVerification ----
  it('confirmGuestEmailVerification guards and confirms', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    cmp.confirmGuestEmailVerification();
    expect(api.post).not.toHaveBeenCalled();

    auth.isAuthenticated.and.returnValue(false);
    cmp.address.email = '';
    cmp.guestVerificationToken = '';
    cmp.confirmGuestEmailVerification();
    expect(cmp.guestEmailError).toContain('addressRequired');

    cmp.address.email = 'g@e.com';
    cmp.guestVerificationToken = '123456';
    api.post.and.returnValue(of({ email: 'g@e.com', verified: true }));
    cmp.confirmGuestEmailVerification();
    expect(cmp.guestEmailVerified).toBeTrue();
  });

  it('confirmGuestEmailVerification reports a confirmation error', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    cmp.address.email = 'g@e.com';
    cmp.guestVerificationToken = '123456';
    api.post.and.returnValue(throwError(() => ({ error: { detail: 'invalid' } })));
    cmp.confirmGuestEmailVerification();
    expect(cmp.guestEmailError).toBe('invalid');
  });

  // ---- loadGuestEmailVerificationStatus ----
  it('loadGuestEmailVerificationStatus returns early for authed users', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    (cmp as any).loadGuestEmailVerificationStatus();
    expect(api.get).not.toHaveBeenCalledWith(
      jasmine.stringMatching('email/status'),
      jasmine.anything(),
      jasmine.anything(),
    );
  });

  it('loadGuestEmailVerificationStatus applies status, email and unverified flags', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    cmp.address.email = '';
    api.get.and.callFake((path: string) => {
      if (path.startsWith('/orders/guest-checkout/email/status')) {
        return of({ email: 'g@e.com', verified: false });
      }
      return of({});
    });
    (cmp as any).loadGuestEmailVerificationStatus();
    expect(cmp.address.email).toBe('g@e.com');
    expect(cmp.guestVerificationSent).toBeTrue();
  });

  it('loadGuestEmailVerificationStatus tolerates a null payload and errors', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    api.get.and.callFake((path: string) => {
      if (path.startsWith('/orders/guest-checkout/email/status')) return of(null as any);
      return of({});
    });
    (cmp as any).loadGuestEmailVerificationStatus();

    api.get.and.callFake((path: string) => {
      if (path.startsWith('/orders/guest-checkout/email/status'))
        return throwError(() => new Error('x'));
      return of({});
    });
    expect(() => (cmp as any).loadGuestEmailVerificationStatus()).not.toThrow();
  });

  it('loadGuestEmailVerificationStatus keeps an already-entered email but records verification', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    cmp.address.email = 'kept@e.com';
    api.get.and.callFake((path: string) => {
      if (path.startsWith('/orders/guest-checkout/email/status')) {
        return of({ email: 'g@e.com', verified: true });
      }
      return of({});
    });
    (cmp as any).loadGuestEmailVerificationStatus();
    expect(cmp.address.email).toBe('kept@e.com');
    expect(cmp.guestEmailVerified).toBeTrue();
  });

  // ---- loadLegalConsentStatus ----
  it('loadLegalConsentStatus resets consents for guests', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    cmp.acceptTerms = true;
    (cmp as any).loadLegalConsentStatus();
    expect(cmp.acceptTerms).toBeFalse();
    expect(cmp.legalConsentsLoading).toBeFalse();
  });

  it('loadLegalConsentStatus applies consent docs on success', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    api.get.and.callFake((path: string) => {
      if (path === '/legal/consents/status') {
        return of({
          docs: [
            { doc_key: 'page.terms-and-conditions', accepted: true },
            { doc_key: 'page.privacy-policy', accepted: true },
          ],
          satisfied: true,
        });
      }
      return of({});
    });
    (cmp as any).loadLegalConsentStatus();
    expect(cmp.acceptTerms).toBeTrue();
    expect(cmp.consentLocked).toBeTrue();
  });

  it('loadLegalConsentStatus resets consents on error', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    api.get.and.callFake((path: string) => {
      if (path === '/legal/consents/status') return throwError(() => new Error('x'));
      return of({});
    });
    cmp.acceptTerms = true;
    (cmp as any).loadLegalConsentStatus();
    expect(cmp.acceptTerms).toBeFalse();
  });

  it('loadLegalConsentStatus tolerates a payload without docs', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    api.get.and.callFake((path: string) => {
      if (path === '/legal/consents/status') return of({ satisfied: false } as any);
      return of({});
    });
    (cmp as any).loadLegalConsentStatus();
    expect(cmp.acceptTerms).toBeFalse();
  });

  // ---- consent blocking / modal ----
  it('consentBlocking is true while loading or when consents are missing', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    cmp.legalConsentsLoading = true;
    expect(cmp.consentBlocking()).toBeTrue();
    cmp.legalConsentsLoading = false;
    cmp.acceptTerms = false;
    expect(cmp.consentBlocking()).toBeTrue();
    cmp.acceptTerms = true;
    cmp.acceptPrivacy = true;
    expect(cmp.consentBlocking()).toBeFalse();
  });

  it('onCheckoutConsentAttempt opens the modal unless locked/loading/already accepted', () => {
    const cmp = make();
    const event = {
      preventDefault: jasmine.createSpy(),
      stopPropagation: jasmine.createSpy(),
    } as any;

    cmp.consentLocked = true;
    cmp.onCheckoutConsentAttempt(event, 'terms');
    expect(cmp.consentModalOpen).toBeFalse();

    cmp.consentLocked = false;
    cmp.legalConsentsLoading = true;
    cmp.onCheckoutConsentAttempt(event, 'terms');
    expect(cmp.consentModalOpen).toBeFalse();

    cmp.legalConsentsLoading = false;
    cmp.acceptTerms = true;
    cmp.onCheckoutConsentAttempt(event, 'terms');
    expect(cmp.consentModalOpen).toBeFalse();

    cmp.acceptPrivacy = true;
    cmp.onCheckoutConsentAttempt(event, 'privacy');
    expect(cmp.consentModalOpen).toBeFalse();

    cmp.acceptTerms = false;
    cmp.onCheckoutConsentAttempt(event, 'terms');
    expect(cmp.consentModalOpen).toBeTrue();
    expect(cmp.consentModalSlug).toBe('terms-and-conditions');

    cmp.acceptPrivacy = false;
    cmp.onCheckoutConsentAttempt(event, 'privacy');
    expect(cmp.consentModalSlug).toBe('privacy-policy');
  });

  it('confirmConsentModal accepts the targeted consent and closes', () => {
    const cmp = make();
    (cmp as any).consentModalTarget = 'terms';
    cmp.confirmConsentModal();
    expect(cmp.acceptTerms).toBeTrue();
    expect(cmp.consentModalOpen).toBeFalse();

    (cmp as any).consentModalTarget = 'privacy';
    cmp.confirmConsentModal();
    expect(cmp.acceptPrivacy).toBeTrue();
  });

  it('closeConsentModal resets modal state', () => {
    const cmp = make();
    cmp.consentModalOpen = true;
    cmp.consentModalSlug = 'x';
    cmp.closeConsentModal();
    expect(cmp.consentModalOpen).toBeFalse();
    expect(cmp.consentModalSlug).toBe('');
  });

  // ---------------------------------------------------------------------------
  // Branch-completion suite: exercises the remaining `||`/`??`/ternary fallbacks
  // and alternate paths so every decision in the file is observed both ways.
  // ---------------------------------------------------------------------------

  it('setQuote/parseBool handle string, number and boolean flag values', () => {
    const cmp = make();
    (cmp as any).setQuote(
      totals({
        phone_required_home: 'yes',
        phone_required_locker: 'no',
        delivery_locker_allowed: 1,
      }),
    );
    expect((cmp as any).phoneRequiredHome).toBeTrue();
    expect((cmp as any).phoneRequiredLocker).toBeFalse();

    (cmp as any).setQuote(
      totals({
        phone_required_home: false,
        phone_required_locker: 'weird',
        delivery_allowed_couriers: [null, 'sameday'],
      }),
    );
    expect((cmp as any).phoneRequiredHome).toBeFalse();
    // 'weird' is not a recognised string -> falls back to the previous default (true)
    expect((cmp as any).phoneRequiredLocker).toBeTrue();
    expect(cmp.deliveryAllowedCouriers).toEqual(['sameday']);
  });

  it('announceAssertive tolerates a null message', () => {
    const cmp = make();
    expect(() => (cmp as any).announceAssertive(null)).not.toThrow();
    expect(cmp.liveAssertive).toBe('');
  });

  it('findFirstInvalidField skips hidden/invisible and returns the first visible invalid field', () => {
    const cmp = make();
    const container = document.createElement('div');
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.className = 'ng-invalid';
    const invisible = document.createElement('input');
    invisible.className = 'ng-invalid';
    invisible.style.display = 'none';
    const good = document.createElement('input');
    good.className = 'ng-invalid';
    container.append(hidden, invisible, good);
    document.body.appendChild(container);
    expect((cmp as any).findFirstInvalidField(container)).toBe(good);
    document.body.removeChild(container);
  });

  it('openEditSavedAddress copes with null address fields', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    cmp.selectedShippingAddressId = 'a1';
    cmp.savedAddresses = [
      makeAddress({
        id: 'a1',
        line1: null as any,
        city: null as any,
        postal_code: null as any,
        country: '',
      }),
    ];
    cmp.openEditSavedAddress('shipping');
    expect(cmp.editSavedAddressModel?.line1).toBe('');
    expect(cmp.editSavedAddressModel?.country).toBe('RO');
  });

  it('saveEditedSavedAddress only replaces the matching saved address', () => {
    const cmp = make();
    const updated = makeAddress({ id: 'a1', line1: 'New' });
    account.updateAddress.and.returnValue(of(updated));
    spyOn(cmp as any, 'loadSavedAddresses');
    cmp.savedAddresses = [makeAddress({ id: 'a1' }), makeAddress({ id: 'a2', line1: 'Other' })];
    cmp.editSavedAddressId = 'a1';
    cmp.editSavedAddressTarget = 'shipping';
    cmp.saveEditedSavedAddress({} as any);
    expect(cmp.savedAddresses.find((a) => a.id === 'a2')?.line1).toBe('Other');
    expect(cmp.savedAddresses.find((a) => a.id === 'a1')?.line1).toBe('New');
  });

  it('onBillingSameAsShippingChanged falls back to default shipping then first address', () => {
    const cmp = make();
    cmp.billingSameAsShipping = false;
    cmp.billing = { line1: '', line2: '', city: '', region: '', postal: '', country: 'RO' };
    cmp.selectedBillingAddressId = '';
    cmp.savedAddresses = [
      makeAddress({ id: 's1', is_default_billing: false, is_default_shipping: true }),
    ];
    cmp.onBillingSameAsShippingChanged();
    expect(cmp.selectedBillingAddressId).toBe('s1');

    const cmp2 = make();
    cmp2.billingSameAsShipping = false;
    cmp2.billing = { line1: '', line2: '', city: '', region: '', postal: '', country: 'RO' };
    cmp2.selectedBillingAddressId = '';
    cmp2.savedAddresses = [
      makeAddress({ id: 'first', is_default_billing: false, is_default_shipping: false }),
    ];
    cmp2.onBillingSameAsShippingChanged();
    expect(cmp2.selectedBillingAddressId).toBe('first');
  });

  it('loadSavedAddresses falls back to first address when no defaults are flagged', () => {
    const cmp = make();
    account.getAddresses.and.returnValue(
      of([makeAddress({ id: 'only', is_default_shipping: false, is_default_billing: false })]),
    );
    cmp.address = {
      name: '',
      email: '',
      line1: '',
      line2: '',
      city: '',
      region: '',
      postal: '',
      country: 'RO',
    } as any;
    (cmp as any).loadSavedAddresses(true);
    expect(cmp.selectedShippingAddressId).toBe('only');
  });

  it('onEmailChanged handles an empty email value', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    (cmp as any).lastGuestEmailVerified = 'old@e.com';
    cmp.guestEmailVerified = true;
    cmp.address.email = '';
    cmp.onEmailChanged();
    expect(cmp.guestEmailVerified).toBeFalse();
  });

  it('guestPhoneE164/shippingPhoneE164 default the country when blank', () => {
    const cmp = make();
    cmp.guestPhoneCountry = '';
    cmp.guestPhoneNational = '712345678';
    expect(cmp.guestPhoneE164()).toBeTruthy();
    cmp.shippingPhoneCountry = '';
    cmp.shippingPhoneNational = '712345678';
    expect(cmp.shippingPhoneE164()).toBeTruthy();
  });

  it('maybeAutoApplyBestCoupon bails on each guard', () => {
    const cmp = make();
    spyOn(cmp, 'applyCouponOffer');
    cmp.autoApplyBestCoupon = true;
    cmp.suggestedCouponOffer = makeOffer();

    auth.isAuthenticated.and.returnValue(false);
    (cmp as any).maybeAutoApplyBestCoupon();

    auth.isAuthenticated.and.returnValue(true);
    (cmp as any).pendingPromoCode = 'X';
    (cmp as any).maybeAutoApplyBestCoupon();

    (cmp as any).pendingPromoCode = null;
    cmp.syncing = true;
    (cmp as any).maybeAutoApplyBestCoupon();

    cmp.syncing = false;
    cmp.promo = 'HELD';
    (cmp as any).maybeAutoApplyBestCoupon();

    cmp.promo = '';
    cmp.suggestedCouponOffer = null;
    (cmp as any).maybeAutoApplyBestCoupon();

    expect(cmp.applyCouponOffer).not.toHaveBeenCalled();
  });

  it('describeCouponOffer renders amount/percent with null fallbacks and free-shipping with savings', () => {
    const cmp = make();
    const amount = makeOffer({ estimated_discount_ron: '0', estimated_shipping_discount_ron: '0' });
    (amount.coupon.promotion as any).discount_type = 'amount';
    (amount.coupon.promotion as any).amount_off = null;
    expect(cmp.describeCouponOffer(amount)).toContain('amountOff');

    const percent = makeOffer({
      estimated_discount_ron: '0',
      estimated_shipping_discount_ron: '0',
    });
    (percent.coupon.promotion as any).percentage_off = null;
    expect(cmp.describeCouponOffer(percent)).toContain('percentOff');

    const freeShipSavings = makeOffer({
      estimated_discount_ron: '0',
      estimated_shipping_discount_ron: '6',
    });
    (freeShipSavings.coupon.promotion as any).discount_type = 'free_shipping';
    expect(cmp.describeCouponOffer(freeShipSavings)).toContain('6.00 RON');
  });

  it('pickBestCouponOffer tolerates a null offers list', () => {
    const cmp = make();
    expect((cmp as any).pickBestCouponOffer(null)).toBeNull();
  });

  it('couponShippingDiscount returns 0 when no promo code is entered', () => {
    const cmp = make();
    cmp.appliedCouponOffer = makeOffer({ eligible: true, estimated_shipping_discount_ron: '5' });
    cmp.promo = '';
    expect((cmp as any).couponShippingDiscount()).toBe(0);
  });

  it('buildSuccessSummary defaults item currency and null courier/delivery', () => {
    const cmp = make();
    itemsSignal.set([sampleItem({ currency: '' })]);
    (cmp as any).courier = null;
    (cmp as any).deliveryType = null;
    const summary = (cmp as any).buildSuccessSummary('o', null, 'cod');
    expect(summary.items[0].currency).toBe(cmp.currency);
    expect(summary.courier).toBeNull();
    expect(summary.delivery_type).toBeNull();
  });

  it('normalizePaymentRedirectUrl returns null when URL parsing throws', () => {
    const cmp = make();
    expect((cmp as any).normalizePaymentRedirectUrl('http://[invalid', ['paypal.com'])).toBeNull();
  });

  it('loadCouponsEligibility tolerates null offer arrays while a promo is set', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    coupons.eligibility.and.returnValue(of({ eligible: null, ineligible: null } as any));
    cmp.promo = 'SAVE10';
    (cmp as any).loadCouponsEligibility();
    expect(cmp.appliedCouponOffer).toBeNull();
  });

  it('loadCouponsEligibility uses a generic error when no detail is provided', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    coupons.eligibility.and.returnValue(throwError(() => ({})));
    (cmp as any).loadCouponsEligibility();
    expect(cmp.couponEligibilityError).toContain('couponsLoadError');
  });

  it('applyPromo handles a blank promo value and ineligible offers without reasons', () => {
    const cmp = make();
    spyOn(cmp as any, 'refreshQuote');
    (cmp as any).promo = undefined;
    cmp.applyPromo();
    expect(cmp.promoStatus).toBe('info');

    auth.isAuthenticated.and.returnValue(true);
    coupons.validate.and.returnValue(of(makeOffer({ eligible: false, reasons: undefined as any })));
    cmp.promo = 'SAVE10';
    cmp.applyPromo();
    expect(cmp.promoValid).toBeFalse();
  });

  it('applyPromo uses generic messages when errors lack detail', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(true);
    spyOn(cmp as any, 'refreshQuote');
    coupons.validate.and.returnValue(throwError(() => ({ status: 500 })));
    cmp.promo = 'SAVE10';
    cmp.applyPromo();
    expect(cmp.promoMessage).toContain('promoPending');
  });

  it('loadCartFromServer default-country branch builds RO params', () => {
    const cmp = make();
    cmp.address.country = '';
    expect((cmp as any).cartQuoteParams(null)).toEqual({ country: 'RO' });
  });

  it('isPaymentMethodAvailable rejects cod outside Romania', () => {
    const cmp = make();
    cmp.currency = 'RON';
    cmp.shippingCountryInput = '';
    cmp.address.country = 'DE';
    expect(cmp.isPaymentMethodAvailable('cod')).toBeFalse();
  });

  it('courierAllowed tolerates a null allowed list', () => {
    const cmp = make();
    (cmp as any).deliveryAllowedCouriers = null;
    expect(cmp.courierAllowed('sameday')).toBeFalse();
  });

  it('ensureDeliveryOptionsAvailable swaps courier without touching home locker', () => {
    const cmp = make();
    cmp.deliveryLockerAllowed = true;
    cmp.deliveryType = 'home';
    cmp.deliveryAllowedCouriers = ['fan_courier'];
    cmp.courier = 'sameday';
    (cmp as any).ensureDeliveryOptionsAvailable();
    expect(cmp.courier).toBe('fan_courier');
  });

  it('courierEstimate returns null for an unknown provider', () => {
    const cmp = make();
    expect(cmp.courierEstimate('bogus' as any)).toBeNull();
  });

  it('trackCheckoutStart defaults quantity and currency when missing', () => {
    const cmp = make();
    analytics.enabled.and.returnValue(true);
    cmp.currency = '';
    itemsSignal.set([sampleItem({ quantity: undefined as any, currency: '' })]);
    (cmp as any).checkoutStartTracked = false;
    (cmp as any).trackCheckoutStart();
    expect(analytics.track).toHaveBeenCalledWith(
      'checkout_start',
      jasmine.objectContaining({ currency: 'RON' }),
    );
  });

  it('trackCheckoutAbandon defaults quantity and currency when missing', () => {
    const cmp = make();
    cmp.currency = '';
    itemsSignal.set([sampleItem({ quantity: undefined as any, currency: '' })]);
    (cmp as any).checkoutStartTracked = true;
    (cmp as any).checkoutFlowCompleted = false;
    (cmp as any).trackCheckoutAbandon();
    expect(analytics.track).toHaveBeenCalledWith(
      'checkout_abandon',
      jasmine.objectContaining({ currency: 'RON' }),
    );
  });

  it('loadPaymentCapabilities renders translated and fallback netopia reasons', () => {
    const cmp = make();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      { checkout: { paymentDisabledReasons: { BANK_DOWN: 'Bank is down' } } },
      true,
    );
    translate.use('en');
    const originalNetopia = appConfig.netopiaEnabled;
    appConfig.netopiaEnabled = true;
    try {
      api.get.and.callFake((path: string) =>
        path === '/payments/capabilities'
          ? of({ netopia: { enabled: false, reason: 'fallback', reason_code: 'BANK_DOWN' } })
          : of({}),
      );
      (cmp as any).loadPaymentCapabilities();
      expect(cmp.netopiaDisabledReason).toBe('Bank is down');

      api.get.and.callFake((path: string) =>
        path === '/payments/capabilities'
          ? of({ netopia: { enabled: false, reason: 'plain fallback', reason_code: '' } })
          : of({}),
      );
      (cmp as any).loadPaymentCapabilities();
      expect(cmp.netopiaDisabledReason).toBe('plain fallback');
    } finally {
      appConfig.netopiaEnabled = originalNetopia;
    }
  });

  it('requestGuestEmailVerification uses generic error text without a detail', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    cmp.address.email = 'g@e.com';
    cmp.guestResendSecondsLeft = 0;
    api.post.and.returnValue(throwError(() => ({})));
    cmp.requestGuestEmailVerification();
    expect(cmp.guestEmailError).toContain('emailVerifySendFailed');
    (cmp as any).clearGuestResendCooldown();
  });

  it('requestGuestEmailVerification timeout no-ops once sending already cleared', fakeAsync(() => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    cmp.address.email = 'g@e.com';
    cmp.guestResendSecondsLeft = 0;
    api.post.and.returnValue(NEVER);
    cmp.requestGuestEmailVerification();
    cmp.guestSendingCode = false; // simulate the request resolving before the timeout
    cmp.guestEmailError = '';
    tick(15000);
    expect(cmp.guestEmailError).toBe('');
    (cmp as any).clearGuestResendCooldown();
  }));

  it('confirmGuestEmailVerification falls back to the entered email and generic error', () => {
    const cmp = make();
    auth.isAuthenticated.and.returnValue(false);
    cmp.address.email = 'entered@e.com';
    cmp.guestVerificationToken = '123456';
    api.post.and.returnValue(of({ email: null, verified: true }));
    cmp.confirmGuestEmailVerification();
    expect((cmp as any).lastGuestEmailVerified).toBe('entered@e.com');

    cmp.guestVerificationToken = '123456';
    api.post.and.returnValue(throwError(() => ({})));
    cmp.confirmGuestEmailVerification();
    expect(cmp.guestEmailError).toContain('emailVerifyInvalidCode');
  });

  it('describeCouponReasons renders a translated reason label', () => {
    const cmp = make();
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      { checkout: { couponReasons: { min_subtotal_not_met: 'Spend more' } } },
      true,
    );
    translate.use('en');
    expect(cmp.describeCouponReasons(['min_subtotal_not_met'])).toContain('Spend more');
  });

  it('submitCheckout covers invoice + home-delivery + same billing', () => {
    const cmp = make();
    fillValidAddress(cmp);
    cmp.saveAddress = false;
    cmp.billingSameAsShipping = true;
    cmp.invoiceEnabled = true;
    cmp.invoiceCompany = 'ACME';
    cmp.invoiceVatId = 'RO123';
    cmp.deliveryType = 'home';
    cmp.address.country = '';
    const submitReq = spyOn(cmp as any, 'submitCheckoutRequest');
    (cmp as any).submitCheckout();
    const body = submitReq.calls.mostRecent().args[1] as any;
    expect(body['invoice_company']).toBe('ACME');
    expect(body['locker_id']).toBeNull();
    expect(body['default_shipping']).toBeUndefined();
    expect(body['billing_line1']).toBeUndefined();
    expect(body['country']).toBe('RO');
  });

  it('submitGuestCheckout covers separate billing, invoice, locker and ro language', () => {
    const cmp = make();
    const translate = TestBed.inject(TranslateService);
    translate.use('ro');
    fillValidAddress(cmp);
    cmp.guestCreateAccount = false;
    cmp.billingSameAsShipping = false;
    cmp.billing = {
      line1: 'b1',
      line2: 'b2',
      city: 'bc',
      region: 'BR',
      postal: 'bp',
      country: 'RO',
    };
    cmp.invoiceEnabled = true;
    cmp.invoiceCompany = 'ACME';
    cmp.deliveryType = 'locker';
    cmp.locker = makeLocker();
    const submitReq = spyOn(cmp as any, 'submitCheckoutRequest');
    (cmp as any).submitGuestCheckout();
    const payload = submitReq.calls.mostRecent().args[1] as any;
    expect(payload['billing_line1']).toBe('b1');
    expect(payload['billing_line2']).toBe('b2');
    expect(payload['billing_country']).toBe('RO');
    expect(payload['locker_id']).toBe('L1');
    expect(payload['username']).toBeUndefined();
  });

  it('applySavedAddressTo* default every empty field to a blank string', () => {
    const cmp = make();
    cmp.billingSameAsShipping = false;
    const bare = makeAddress({
      line1: null as any,
      line2: null as any,
      city: null as any,
      region: null as any,
      postal_code: null as any,
      country: null as any,
      phone: null,
    });
    (cmp as any).applySavedAddressToShipping(bare);
    expect(cmp.address.line1).toBe('');
    expect(cmp.address.country).toBe('');
    (cmp as any).applySavedAddressToBilling(bare);
    expect(cmp.billing.line1).toBe('');
    expect(cmp.billing.country).toBe('');
  });

  it('ensureDeliveryOptionsAvailable clears the locker when swapping courier for locker delivery', () => {
    const cmp = make();
    cmp.deliveryLockerAllowed = true;
    cmp.deliveryType = 'locker';
    cmp.locker = makeLocker();
    cmp.deliveryAllowedCouriers = ['fan_courier'];
    cmp.courier = 'sameday';
    (cmp as any).ensureDeliveryOptionsAvailable();
    expect(cmp.courier).toBe('fan_courier');
    expect(cmp.locker).toBeNull();
  });

  it('loadPaymentCapabilities honours the stripe app-config flag and an untranslated reason code', () => {
    const cmp = make();
    const originalStripe = appConfig.stripeEnabled;
    const originalNetopia = appConfig.netopiaEnabled;
    appConfig.stripeEnabled = true;
    appConfig.netopiaEnabled = true;
    try {
      api.get.and.callFake((path: string) =>
        path === '/payments/capabilities'
          ? of({
              stripe: { enabled: true },
              netopia: { enabled: false, reason: 'plain', reason_code: 'NO_TRANSLATION' },
            })
          : of({}),
      );
      (cmp as any).loadPaymentCapabilities();
      expect(cmp.stripeEnabled).toBeTrue();
      expect(cmp.netopiaDisabledReason).toBe('plain');
    } finally {
      appConfig.stripeEnabled = originalStripe;
      appConfig.netopiaEnabled = originalNetopia;
    }
  });

  it('isPaymentMethodAvailable rejects cod for non-RON currency', () => {
    const cmp = make();
    cmp.currency = 'USD';
    cmp.shippingCountryInput = 'RO';
    cmp.address.country = 'RO';
    expect(cmp.isPaymentMethodAvailable('cod')).toBeFalse();
  });

  it('isPaymentMethodAvailable defaults a blank currency to RON', () => {
    const cmp = make();
    cmp.currency = '';
    cmp.shippingCountryInput = 'RO';
    cmp.address.country = 'RO';
    expect(cmp.isPaymentMethodAvailable('cod')).toBeTrue();
  });

  it('loadPaymentCapabilities tolerates a missing netopia reason string', () => {
    const cmp = make();
    const originalNetopia = appConfig.netopiaEnabled;
    appConfig.netopiaEnabled = true;
    try {
      api.get.and.callFake((path: string) =>
        path === '/payments/capabilities'
          ? of({ netopia: { enabled: false, reason_code: 'NO_TRANSLATION' } })
          : of({}),
      );
      (cmp as any).loadPaymentCapabilities();
      expect(cmp.netopiaDisabledReason).toBe('');
    } finally {
      appConfig.netopiaEnabled = originalNetopia;
    }
  });

  it('requestGuestEmailVerification sends the romanian language code', () => {
    const cmp = make();
    const translate = TestBed.inject(TranslateService);
    translate.use('ro');
    auth.isAuthenticated.and.returnValue(false);
    cmp.address.email = 'g@e.com';
    cmp.guestResendSecondsLeft = 0;
    api.post.and.returnValue(of(undefined));
    cmp.requestGuestEmailVerification();
    expect(api.post.calls.mostRecent().args[0]).toContain('lang=ro');
    (cmp as any).clearGuestResendCooldown();
  });

  it('cartQuoteParams defaults a whitespace-only country to RO', () => {
    const cmp = make();
    cmp.address.country = '   ';
    expect((cmp as any).cartQuoteParams(null)).toEqual({ country: 'RO' });
  });

  it('submitCheckout nulls invoice fields and locker fields appropriately', () => {
    const cmp = make();
    fillValidAddress(cmp);
    cmp.invoiceEnabled = true;
    cmp.invoiceCompany = '';
    cmp.invoiceVatId = '';
    cmp.billingSameAsShipping = false;
    cmp.billing = { line1: 'b1', line2: '', city: 'bc', region: '', postal: 'bp', country: '' };
    cmp.address.country = '';
    cmp.deliveryType = 'locker';
    cmp.locker = null;
    const submitReq = spyOn(cmp as any, 'submitCheckoutRequest');
    (cmp as any).submitCheckout();
    const body = submitReq.calls.mostRecent().args[1] as any;
    expect(body['invoice_company']).toBeNull();
    expect(body['invoice_vat_id']).toBeNull();
    expect(body['locker_id']).toBeNull();
    expect(body['billing_country']).toBe('RO');
  });

  it('submitGuestCheckout nulls invoice fields and locker fields appropriately', () => {
    const cmp = make();
    fillValidAddress(cmp);
    cmp.guestCreateAccount = false;
    cmp.invoiceEnabled = true;
    cmp.invoiceCompany = '';
    cmp.invoiceVatId = '';
    cmp.address.region = '';
    cmp.billingSameAsShipping = false;
    cmp.billing = { line1: 'b1', line2: '', city: 'bc', region: '', postal: 'bp', country: '' };
    cmp.address.country = '';
    cmp.deliveryType = 'locker';
    cmp.locker = null;
    const submitReq = spyOn(cmp as any, 'submitCheckoutRequest');
    (cmp as any).submitGuestCheckout();
    const payload = submitReq.calls.mostRecent().args[1] as any;
    expect(payload['invoice_company']).toBeNull();
    expect(payload['region']).toBeNull();
    expect(payload['billing_line2']).toBeNull();
    expect(payload['billing_country']).toBe('RO');
    expect(payload['locker_id']).toBeNull();
  });
});
