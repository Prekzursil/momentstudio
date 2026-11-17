import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';

import { AccountService } from '../../core/account.service';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CartApi } from '../../core/cart.api';
import { CartStore } from '../../core/cart.store';
import { CheckoutPrefsService } from '../../core/checkout-prefs.service';
import { CheckoutComponent } from './checkout.component';

/**
 * Golden WU chk55 — N=3 NEW uncovered checkout helper arms:
 * step enablement, address country validate, shipping method guards.
 * Existing checkout.component.spec.ts / guest-flow.spec.ts only cover placeOrder paths.
 */
describe('Checkout arms (golden WU chk55)', () => {
  const itemsSignal = signal([
    {
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
    },
  ]);
  const subtotalSignal = signal(20);

  let auth: jasmine.SpyObj<AuthService>;
  let checkoutPrefs: {
    tryLoadDeliveryPrefs: jasmine.Spy;
    saveDeliveryPrefs: jasmine.Spy;
    tryLoadPaymentMethod: jasmine.Spy;
  };

  beforeEach(() => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['isAuthenticated', 'user']);
    auth.isAuthenticated.and.returnValue(true);
    auth.user.and.returnValue({ email_verified: true } as any);

    checkoutPrefs = {
      tryLoadDeliveryPrefs: jasmine
        .createSpy('tryLoadDeliveryPrefs')
        .and.returnValue({ courier: 'sameday', deliveryType: 'home' }),
      saveDeliveryPrefs: jasmine.createSpy('saveDeliveryPrefs'),
      tryLoadPaymentMethod: jasmine.createSpy('tryLoadPaymentMethod').and.returnValue(null),
    };

    const emptyQueryParamMap = convertToParamMap({});

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, CheckoutComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: CartStore,
          useValue: {
            items: itemsSignal,
            subtotal: subtotalSignal,
            clear: jasmine.createSpy('clear'),
            hydrateFromBackend: jasmine.createSpy('hydrateFromBackend'),
          },
        },
        {
          provide: CartApi,
          useValue: {
            sync: jasmine.createSpy('sync').and.returnValue(of({})),
            headers: jasmine.createSpy('headers').and.returnValue({}),
          },
        },
        {
          provide: ApiService,
          useValue: {
            post: jasmine.createSpy('post').and.returnValue(of({})),
            get: jasmine.createSpy('get').and.returnValue(of({ eligible: [], ineligible: [] })),
          },
        },
        {
          provide: AccountService,
          useValue: {
            getAddresses: jasmine.createSpy('getAddresses').and.returnValue(of([])),
          },
        },
        { provide: AuthService, useValue: auth },
        { provide: CheckoutPrefsService, useValue: checkoutPrefs },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { params: {}, queryParamMap: emptyQueryParamMap },
            queryParamMap: of(emptyQueryParamMap),
          },
        },
      ],
    });
  });

  function createCmp(): CheckoutComponent {
    return TestBed.createComponent(CheckoutComponent).componentInstance;
  }

  function fillValidShipping(cmp: CheckoutComponent): void {
    cmp.address = {
      name: 'Test User',
      email: 'test@example.com',
      line1: '123 St',
      city: 'Bucharest',
      postal: '010203',
      country: 'RO',
      region: 'B',
    };
    cmp.shippingCountryInput = 'RO';
    cmp.shippingCountryError = '';
    cmp.shippingPhoneCountry = 'RO';
    cmp.shippingPhoneNational = '723204204';
    cmp.billingSameAsShipping = true;
    cmp.deliveryType = 'home';
    cmp.locker = null;
  }

  it('step enablement: step1Complete guest create-account gates; step2/3 track address completeness', () => {
    const cmp = createCmp();

    auth.isAuthenticated.and.returnValue(false);
    cmp.guestCreateAccount = false;
    expect(cmp.step1Complete()).toBeTrue();

    cmp.guestCreateAccount = true;
    cmp.guestUsername = 'ab';
    cmp.guestPassword = 'short';
    cmp.guestPasswordConfirm = 'short';
    cmp.guestFirstName = '';
    cmp.guestLastName = '';
    cmp.guestDob = '';
    expect(cmp.step1Complete()).toBeFalse();

    cmp.guestUsername = 'guestuser';
    cmp.guestPassword = 'secret1';
    cmp.guestPasswordConfirm = 'secret1';
    cmp.guestFirstName = 'Guest';
    cmp.guestLastName = 'User';
    cmp.guestDob = '1990-01-01';
    cmp.guestPhoneCountry = 'RO';
    cmp.guestPhoneNational = '723204204';
    expect(cmp.step1Complete()).toBeTrue();

    auth.isAuthenticated.and.returnValue(true);
    fillValidShipping(cmp);
    expect(cmp.step2Complete()).toBeTrue();
    expect(cmp.step3Complete()).toBeTrue();

    cmp.address.name = '';
    expect(cmp.step2Complete()).toBeFalse();
    expect(cmp.step3Complete()).toBeFalse();

    fillValidShipping(cmp);
    cmp.deliveryType = 'locker';
    cmp.locker = null;
    expect(cmp.step2Complete()).toBeFalse();
  });

  it('address validate: normalizeShippingCountry rejects invalid and applies valid codes', () => {
    const cmp = createCmp();
    fillValidShipping(cmp);

    cmp.shippingCountryInput = 'NotARealCountry';
    cmp.normalizeShippingCountry();
    expect(cmp.shippingCountryError).toBeTruthy();
    expect(cmp.address.country).toBe('RO');

    cmp.shippingCountryInput = 'Romania';
    cmp.normalizeShippingCountry();
    expect(cmp.shippingCountryError).toBe('');
    expect(cmp.address.country).toBe('RO');
    expect(cmp.shippingCountryInput.toUpperCase()).toContain('RO');
  });

  it('shipping method guards: setDeliveryType / setCourier reject unavailable options', () => {
    const cmp = createCmp();
    cmp.deliveryLockerAllowed = false;
    cmp.deliveryType = 'home';
    cmp.deliveryError = '';
    cmp.setDeliveryType('locker');
    expect(cmp.deliveryType).toBe('home');
    expect(cmp.deliveryError).toBeTruthy();

    cmp.deliveryLockerAllowed = true;
    cmp.deliveryError = '';
    cmp.setDeliveryType('locker');
    expect(cmp.deliveryType).toBe('locker');
    expect(cmp.deliveryError).toBe('');
    expect(checkoutPrefs.saveDeliveryPrefs).toHaveBeenCalled();

    cmp.deliveryAllowedCouriers = ['sameday'];
    cmp.courier = 'sameday';
    cmp.deliveryError = '';
    expect(cmp.courierAllowed('fan_courier')).toBeFalse();
    cmp.setCourier('fan_courier');
    expect(cmp.courier).toBe('sameday');
    expect(cmp.deliveryError).toBeTruthy();

    cmp.deliveryError = '';
    cmp.setCourier('sameday');
    expect(cmp.courier).toBe('sameday');
    expect(cmp.deliveryError).toBe('');
  });
});
