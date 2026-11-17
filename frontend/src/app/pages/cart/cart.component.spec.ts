import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';

import { CartComponent } from './cart.component';
import { CartItem, CartQuote, CartStore } from '../../core/cart.store';
import { AuthService } from '../../core/auth.service';
import { CartApi } from '../../core/cart.api';
import { CouponsService } from '../../core/coupons.service';
import { WishlistService } from '../../core/wishlist.service';
import { ToastService } from '../../core/toast.service';
import { CatalogService } from '../../core/catalog.service';
import { CheckoutPrefsService } from '../../core/checkout-prefs.service';
import { AnalyticsService } from '../../core/analytics.service';

describe('CartComponent quote / stock helpers', () => {
  const itemsSig = signal<CartItem[]>([]);
  const quoteSig = signal<CartQuote>({
    subtotal: 0,
    fee: 0,
    tax: 0,
    shipping: 0,
    total: 0,
    currency: 'RON',
    freeShippingThresholdRon: null,
  });
  const subtotalSig = signal(0);
  const syncingSig = signal(false);

  const cartStub = {
    items: itemsSig.asReadonly(),
    quote: quoteSig.asReadonly(),
    subtotal: subtotalSig.asReadonly(),
    syncing: syncingSig.asReadonly(),
    loadFromBackend: jasmine.createSpy('loadFromBackend'),
    updateQuantity: jasmine.createSpy('updateQuantity').and.returnValue({}),
    remove: jasmine.createSpy('remove'),
  };

  beforeEach(() => {
    itemsSig.set([]);
    subtotalSig.set(42);
    quoteSig.set({
      subtotal: 0,
      fee: 0,
      tax: 0,
      shipping: 0,
      total: 0,
      currency: 'RON',
      freeShippingThresholdRon: null,
    });
    syncingSig.set(false);
    cartStub.loadFromBackend.calls.reset();
    cartStub.updateQuantity.calls.reset();

    TestBed.configureTestingModule({
      imports: [CartComponent, TranslateModule.forRoot()],
      providers: [
        { provide: CartStore, useValue: cartStub },
        { provide: AuthService, useValue: { isAuthenticated: () => false } },
        { provide: CartApi, useValue: {} },
        { provide: CouponsService, useValue: {} },
        { provide: WishlistService, useValue: { ensureLoaded: () => undefined } },
        { provide: ToastService, useValue: { success: () => {}, error: () => {} } },
        { provide: CatalogService, useValue: {} },
        {
          provide: CheckoutPrefsService,
          useValue: {
            loadDeliveryPrefs: () => ({ courier: 'sameday', deliveryType: 'home' }),
            saveDeliveryPrefs: jasmine.createSpy('saveDeliveryPrefs'),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap({})) },
        },
        { provide: AnalyticsService, useValue: { track: () => {} } },
      ],
    });
  });

  function createCmp(): CartComponent {
    return TestBed.createComponent(CartComponent).componentInstance;
  }

  it('quoteSubtotal and quoteTotal fall back to cart.subtotal when quote amounts are non-positive', () => {
    const cmp = createCmp();
    quoteSig.set({
      subtotal: 0,
      fee: 1,
      tax: 1,
      shipping: 1,
      total: 0,
      currency: 'RON',
      freeShippingThresholdRon: null,
    });
    subtotalSig.set(55);
    expect(cmp.quoteSubtotal()).toBe(55);
    expect(cmp.quoteTotal()).toBe(55);

    quoteSig.set({
      subtotal: 80,
      fee: 2,
      tax: 3,
      shipping: 5,
      total: 90,
      currency: 'RON',
      freeShippingThresholdRon: null,
    });
    expect(cmp.quoteSubtotal()).toBe(80);
    expect(cmp.quoteTotal()).toBe(90);
  });

  it('freeShippingProgressPct clamps and freeShippingRemaining uses taxable subtotal', () => {
    const cmp = createCmp();
    quoteSig.set({
      subtotal: 40,
      fee: 0,
      tax: 0,
      shipping: 0,
      total: 40,
      currency: 'RON',
      freeShippingThresholdRon: 100,
    });
    expect(cmp.freeShippingRemaining()).toBe(60);
    expect(cmp.freeShippingProgressPct()).toBe(40);

    quoteSig.set({
      subtotal: 250,
      fee: 0,
      tax: 0,
      shipping: 0,
      total: 250,
      currency: 'RON',
      freeShippingThresholdRon: 100,
    });
    expect(cmp.freeShippingRemaining()).toBe(0);
    expect(cmp.freeShippingProgressPct()).toBe(100);

    quoteSig.set({
      subtotal: 10,
      fee: 0,
      tax: 0,
      shipping: 0,
      total: 10,
      currency: 'RON',
      freeShippingThresholdRon: null,
    });
    expect(cmp.freeShippingRemaining()).toBeNull();
    expect(cmp.freeShippingProgressPct()).toBe(0);
  });

  it('isLowStock / isMaxQuantity and stepQuantity clamp against stock', () => {
    const cmp = createCmp();
    const low: CartItem = {
      id: 'i1',
      product_id: 'p1',
      name: 'Mug',
      slug: 'mug',
      price: 10,
      currency: 'RON',
      quantity: 2,
      stock: 3,
    };
    const maxed: CartItem = { ...low, id: 'i2', quantity: 3, stock: 3 };
    const unlimited: CartItem = { ...low, id: 'i3', quantity: 9, stock: 0 };

    expect(cmp.isLowStock(low)).toBeTrue();
    expect(cmp.isMaxQuantity(low)).toBeFalse();
    expect(cmp.isMaxQuantity(maxed)).toBeTrue();
    expect(cmp.isLowStock(unlimited)).toBeFalse();
    expect(cmp.isMaxQuantity(unlimited)).toBeFalse();

    itemsSig.set([low]);
    cmp.stepQuantity(low, 5);
    expect(cartStub.updateQuantity).toHaveBeenCalledWith('i1', 3);
  });

  it('quoteFee/Tax/Shipping/Discount/PromoSavings and freeShippingThreshold read quote arms', () => {
    const cmp = createCmp();
    quoteSig.set({
      subtotal: 100,
      fee: 5,
      tax: 19,
      shipping: 15,
      total: 120,
      currency: 'RON',
      freeShippingThresholdRon: 200,
    });
    expect(cmp.quoteFee()).toBe(5);
    expect(cmp.quoteTax()).toBe(19);
    expect(cmp.quoteShipping()).toBe(15);
    // discount = subtotal+fee+tax+shipping - total = 100+5+19+15-120 = 19
    expect(cmp.quoteDiscount()).toBe(19);
    expect(cmp.quotePromoSavings()).toBe(19);
    expect(cmp.freeShippingThreshold()).toBe(200);

    quoteSig.set({
      subtotal: 100,
      fee: 0,
      tax: 0,
      shipping: 0,
      total: 100,
      currency: 'RON',
      freeShippingThresholdRon: null,
    });
    expect(cmp.freeShippingThreshold()).toBeNull();
    expect(cmp.quoteDiscount()).toBe(0);
    expect(cmp.quotePromoSavings()).toBe(0);
  });

  it('displayProductPrice prefers finite sale below base; delivery estimate keys/params cover arms', () => {
    const cmp = createCmp();
    expect(cmp.displayProductPrice({ base_price: 40, sale_price: 25 } as any)).toBe(25);
    expect(cmp.displayProductPrice({ base_price: 40, sale_price: 50 } as any)).toBe(40);
    expect(cmp.displayProductPrice({ base_price: 40, sale_price: null } as any)).toBe(40);

    cmp.courier = 'sameday';
    cmp.deliveryType = 'home';
    expect(cmp.deliveryEstimate()).toEqual({ min: 1, max: 2 });
    expect(cmp.deliveryEstimateKey()).toBe('cart.deliveryEstimateRange');
    expect(cmp.deliveryEstimateParams()).toEqual({ min: 1, max: 2 });

    cmp.courier = 'fan_courier';
    cmp.deliveryType = 'locker';
    expect(cmp.deliveryEstimate()).toEqual({ min: 2, max: 4 });

    // Force single-day by stubbing estimate
    spyOn(cmp, 'deliveryEstimate').and.returnValue({ min: 2, max: 2 });
    expect(cmp.deliveryEstimateKey()).toBe('cart.deliveryEstimateSingle');
    expect(cmp.deliveryEstimateParams()).toEqual({ days: 2 });

    (cmp.deliveryEstimate as jasmine.Spy).and.returnValue(null);
    expect(cmp.deliveryEstimateKey()).toBeNull();
    expect(cmp.deliveryEstimateParams()).toEqual({});
  });

  it('setDeliveryType and onCourierChanged persist prefs; freeShippingAppliedByCoupon gates coupon discount', () => {
    const cmp = createCmp();
    const prefs = TestBed.inject(CheckoutPrefsService) as any;
    cmp.setDeliveryType('locker');
    expect(cmp.deliveryType).toBe('locker');
    expect(prefs.saveDeliveryPrefs).toHaveBeenCalled();

    cmp.courier = 'fan_courier';
    cmp.onCourierChanged();
    expect(prefs.saveDeliveryPrefs).toHaveBeenCalledWith({
      courier: 'fan_courier',
      deliveryType: 'locker',
    });

    expect(cmp.freeShippingAppliedByCoupon()).toBeFalse();
    (cmp as any).promo = 'FREE';
    (cmp as any).appliedCouponOffer = {
      eligible: true,
      coupon: { code: 'FREE' },
      estimated_shipping_discount_ron: '12.5',
    };
    expect(cmp.freeShippingAppliedByCoupon()).toBeTrue();
    expect(cmp.quotePromoSavings()).toBeGreaterThanOrEqual(12.5);
  });

  it('suggestedAddOns picks products under remaining free-shipping amount', () => {
    const cmp = createCmp();
    quoteSig.set({
      subtotal: 80,
      fee: 0,
      tax: 0,
      shipping: 0,
      total: 80,
      currency: 'RON',
      freeShippingThresholdRon: 100,
    });
    (cmp as any).recommendations = [
      { id: 'a', base_price: 30, sale_price: null },
      { id: 'b', base_price: 10, sale_price: null },
      { id: 'c', base_price: 50, sale_price: null },
    ];
    const addOns = cmp.suggestedAddOns();
    // remaining free-shipping = 20 → only product b (10) qualifies; a (30) does not
    expect(addOns.map((p: any) => p.id)).toEqual(['b']);

    quoteSig.set({
      subtotal: 100,
      fee: 0,
      tax: 0,
      shipping: 0,
      total: 100,
      currency: 'RON',
      freeShippingThresholdRon: 100,
    });
    expect(cmp.suggestedAddOns()).toEqual([]);

    // when nothing is under remaining, fall back to cheapest two overall
    quoteSig.set({
      subtotal: 95,
      fee: 0,
      tax: 0,
      shipping: 0,
      total: 95,
      currency: 'RON',
      freeShippingThresholdRon: 100,
    });
    (cmp as any).recommendations = [
      { id: 'x', base_price: 40, sale_price: null },
      { id: 'y', base_price: 25, sale_price: null },
      { id: 'z', base_price: 60, sale_price: null },
    ];
    expect(cmp.suggestedAddOns().map((p: any) => p.id)).toEqual(['y', 'x']);
  });
});
