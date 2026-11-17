import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { AccountService } from '../../core/account.service';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CartApi } from '../../core/cart.api';
import { CartStore } from '../../core/cart.store';
import { CheckoutPrefsService } from '../../core/checkout-prefs.service';
import type { CouponOffer } from '../../core/coupons.service';
import { CheckoutComponent } from './checkout.component';

/**
 * Golden WU — pure checkout coupon/payment helpers still uncovered on main:
 * describeCouponOffer discount-type/zero-savings arms, describeCouponReasons join,
 * isPaymentMethodAvailable currency gates.
 */
describe('Checkout coupon/payment helpers (golden WU)', () => {
  const itemsSignal = signal([
    {
      id: 'line1',
      product_id: 'p1',
      variant_id: null,
      name: 'Prod',
      slug: 'prod',
      price: 50,
      currency: 'RON',
      quantity: 1,
      stock: 5,
      image: '/img.png',
    },
  ]);
  const subtotalSignal = signal(50);

  let auth: jasmine.SpyObj<AuthService>;

  beforeEach(() => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['isAuthenticated', 'user']);
    auth.isAuthenticated.and.returnValue(true);
    auth.user.and.returnValue({ email_verified: true } as any);

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
        {
          provide: CheckoutPrefsService,
          useValue: {
            tryLoadDeliveryPrefs: jasmine
              .createSpy('tryLoadDeliveryPrefs')
              .and.returnValue({ courier: 'sameday', deliveryType: 'home' }),
            saveDeliveryPrefs: jasmine.createSpy('saveDeliveryPrefs'),
            tryLoadPaymentMethod: jasmine.createSpy('tryLoadPaymentMethod').and.returnValue(null),
            savePaymentMethod: jasmine.createSpy('savePaymentMethod'),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { params: {}, queryParamMap: emptyQueryParamMap, data: {} },
            queryParamMap: of(emptyQueryParamMap),
          },
        },
      ],
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation(
      'en',
      {
        account: {
          coupons: {
            freeShipping: 'Free shipping',
            amountOff: '{{value}} off',
            percentOff: '{{value}}% off',
          },
        },
        checkout: {
          couponNotEligible: 'Not eligible',
          couponReasons: {
            min_subtotal_not_met: 'Minimum subtotal not met',
            excluded_items: 'Excluded items',
          },
        },
      },
      true,
    );
    translate.setDefaultLang('en');
    void translate.use('en');
  });

  function createCmp(): CheckoutComponent {
    return TestBed.createComponent(CheckoutComponent).componentInstance;
  }

  function offer(overrides: Partial<CouponOffer> = {}): CouponOffer {
    return {
      coupon: {
        id: 'c1',
        promotion_id: 'p1',
        code: 'SHIPFREE',
        visibility: 'public',
        is_active: true,
        promotion: {
          id: 'p1',
          name: 'Free ship',
          discount_type: 'free_shipping',
          allow_on_sale_items: true,
          is_active: true,
          is_automatic: false,
        },
      },
      estimated_discount_ron: '0',
      estimated_shipping_discount_ron: '0',
      eligible: true,
      reasons: [],
      ...overrides,
    };
  }

  it('describeCouponOffer covers free_shipping, amount, missing promo, and zero savings', () => {
    const cmp = createCmp();

    expect(cmp.describeCouponOffer(offer())).toBe('SHIPFREE · Free shipping');

    const amount = offer({
      coupon: {
        ...offer().coupon,
        code: 'TAKE5',
        promotion: {
          id: 'p2',
          name: 'Five off',
          discount_type: 'amount',
          amount_off: '5',
          allow_on_sale_items: true,
          is_active: true,
          is_automatic: false,
        },
      },
      estimated_discount_ron: '5.00',
    });
    const amountLabel = cmp.describeCouponOffer(amount);
    expect(amountLabel).toContain('TAKE5');
    expect(amountLabel).toContain('5 off');
    expect(amountLabel).toContain('≈5.00 RON');

    const bare = offer({
      coupon: {
        id: 'c0',
        promotion_id: 'p0',
        code: 'BARE',
        visibility: 'public',
        is_active: true,
        promotion: null,
      },
    });
    expect(cmp.describeCouponOffer(bare)).toBe('BARE');
  });

  it('describeCouponReasons joins translated and raw reasons', () => {
    const cmp = createCmp();

    expect(cmp.describeCouponReasons([])).toBe('Not eligible');
    expect(cmp.describeCouponReasons(null as unknown as string[])).toBe('Not eligible');
    expect(
      cmp.describeCouponReasons(['min_subtotal_not_met', 'excluded_items', 'custom_gate']),
    ).toBe('Minimum subtotal not met • Excluded items • custom_gate');
  });

  it('isPaymentMethodAvailable gates methods by currency and enabled flags', () => {
    const cmp = createCmp();
    cmp.address.country = 'RO';
    cmp.shippingCountryInput = 'RO';
    cmp.netopiaEnabled = true;
    cmp.paypalEnabled = true;
    cmp.stripeEnabled = true;

    cmp.currency = 'EUR';
    expect(cmp.isPaymentMethodAvailable('cod')).toBeFalse();
    expect(cmp.isPaymentMethodAvailable('netopia')).toBeFalse();
    expect(cmp.isPaymentMethodAvailable('paypal')).toBeFalse();
    expect(cmp.isPaymentMethodAvailable('stripe')).toBeTrue();

    cmp.currency = 'RON';
    expect(cmp.isPaymentMethodAvailable('cod')).toBeTrue();
    expect(cmp.isPaymentMethodAvailable('paypal')).toBeTrue();

    cmp.paypalEnabled = false;
    expect(cmp.isPaymentMethodAvailable('paypal')).toBeFalse();
  });
});
