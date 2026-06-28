import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError, BehaviorSubject } from 'rxjs';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { CartComponent } from './cart.component';
import { CartItem, CartStore, CartQuote } from '../../core/cart.store';
import { CartApi } from '../../core/cart.api';
import { CouponsService } from '../../core/coupons.service';
import { WishlistService } from '../../core/wishlist.service';
import { ToastService } from '../../core/toast.service';
import { CatalogService, Product } from '../../core/catalog.service';
import { CheckoutPrefsService } from '../../core/checkout-prefs.service';
import { AnalyticsService } from '../../core/analytics.service';
import { AuthService } from '../../core/auth.service';

const SAVED_FOR_LATER_KEY = 'cart_saved_for_later';

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'line1',
    product_id: 'p1',
    variant_id: null,
    name: 'Prod One',
    slug: 'prod-one',
    price: 20,
    currency: 'RON',
    quantity: 1,
    stock: 5,
    image: '/img1.png',
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'rec1',
    slug: 'rec-one',
    name: 'Rec One',
    base_price: 30,
    sale_price: null,
    currency: 'RON',
    ...overrides,
  };
}

function makeQuote(overrides: Partial<CartQuote> = {}): CartQuote {
  return {
    subtotal: 20,
    fee: 0,
    tax: 0,
    shipping: 0,
    total: 20,
    currency: 'RON',
    freeShippingThresholdRon: null,
    ...overrides,
  };
}

describe('CartComponent', () => {
  let itemsSig: ReturnType<typeof signal<CartItem[]>>;
  let subtotalSig: ReturnType<typeof signal<number>>;
  let quoteSig: ReturnType<typeof signal<CartQuote>>;
  let syncingSig: ReturnType<typeof signal<boolean>>;

  let cart: any;
  let cartApi: any;
  let coupons: any;
  let wishlist: any;
  let toast: any;
  let catalog: any;
  let checkoutPrefs: any;
  let analytics: any;
  let enabledSig: ReturnType<typeof signal<boolean>>;
  let auth: any;
  let route: any;
  let queryParams$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(() => {
    localStorage.clear();

    itemsSig = signal<CartItem[]>([makeItem()]);
    subtotalSig = signal<number>(20);
    quoteSig = signal<CartQuote>(makeQuote());
    syncingSig = signal<boolean>(false);

    cart = {
      items: itemsSig,
      subtotal: subtotalSig,
      quote: quoteSig,
      syncing: syncingSig,
      loadFromBackend: jasmine.createSpy('loadFromBackend'),
      hydrateFromBackend: jasmine.createSpy('hydrateFromBackend'),
      updateQuantity: jasmine.createSpy('updateQuantity').and.returnValue({}),
      remove: jasmine.createSpy('remove'),
      clear: jasmine.createSpy('clear'),
    };

    cartApi = jasmine.createSpyObj('CartApi', ['addItem', 'get']);
    cartApi.addItem.and.returnValue(of({}));
    cartApi.get.and.returnValue(of({ items: [], totals: {} }));

    coupons = jasmine.createSpyObj('CouponsService', ['validate']);
    coupons.validate.and.returnValue(
      of({ coupon: { code: 'SAVE10' }, eligible: true, reasons: [], estimated_shipping_discount_ron: '0' }),
    );

    wishlist = jasmine.createSpyObj('WishlistService', ['ensureLoaded', 'isWishlisted', 'add', 'addLocal']);
    wishlist.isWishlisted.and.returnValue(false);
    wishlist.add.and.returnValue(of(makeProduct()));

    toast = jasmine.createSpyObj('ToastService', ['error', 'info', 'success']);

    catalog = jasmine.createSpyObj('CatalogService', ['listProducts']);
    catalog.listProducts.and.returnValue(of({ items: [] }));

    checkoutPrefs = jasmine.createSpyObj('CheckoutPrefsService', ['loadDeliveryPrefs', 'saveDeliveryPrefs']);
    checkoutPrefs.loadDeliveryPrefs.and.returnValue({ courier: 'sameday', deliveryType: 'home' });

    enabledSig = signal<boolean>(false);
    analytics = {
      enabled: () => enabledSig(),
      track: jasmine.createSpy('track'),
    };

    auth = jasmine.createSpyObj('AuthService', ['isAuthenticated']);
    auth.isAuthenticated.and.returnValue(true);

    queryParams$ = new BehaviorSubject(convertToParamMap({}));
    route = { queryParamMap: queryParams$ };

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, CartComponent, TranslateModule.forRoot()],
      providers: [
        { provide: CartStore, useValue: cart },
        { provide: CartApi, useValue: cartApi },
        { provide: CouponsService, useValue: coupons },
        { provide: WishlistService, useValue: wishlist },
        { provide: ToastService, useValue: toast },
        { provide: CatalogService, useValue: catalog },
        { provide: CheckoutPrefsService, useValue: checkoutPrefs },
        { provide: AnalyticsService, useValue: analytics },
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: route },
      ],
    });
  });

  function create(detect = true) {
    const fixture = TestBed.createComponent(CartComponent);
    const cmp = fixture.componentInstance;
    if (detect) fixture.detectChanges();
    return { fixture, cmp };
  }

  it('creates and loads delivery prefs + recommendations on init', fakeAsync(() => {
    catalog.listProducts.and.returnValue(of({ items: [makeProduct(), makeProduct({ id: 'p1' })] }));
    const { cmp } = create();
    tick();
    expect(cmp).toBeTruthy();
    expect(cmp.courier).toBe('sameday');
    expect(cmp.deliveryType).toBe('home');
    expect(cart.loadFromBackend).toHaveBeenCalled();
    expect(wishlist.ensureLoaded).toHaveBeenCalled();
    // recommendations filtered to exclude cart product id p1
    expect(cmp.recommendations.every((p) => p.id !== 'p1')).toBeTrue();
    expect(cmp.recommendationsLoading).toBeFalse();
  }));

  it('clears recommendations when there are no cart product ids', fakeAsync(() => {
    const { cmp, fixture } = create();
    tick();
    itemsSig.set([makeItem({ product_id: '' })]);
    fixture.detectChanges();
    tick();
    expect(cmp.recommendations).toEqual([]);
    expect((cmp as any).recommendationsKey).toBe('');
  }));

  it('does not reload recommendations when product id set is unchanged', fakeAsync(() => {
    const { fixture } = create();
    tick();
    catalog.listProducts.calls.reset();
    // New array reference but identical product ids -> effect re-runs but key matches
    itemsSig.set([makeItem({ id: 'line-new', product_id: 'p1' })]);
    fixture.detectChanges();
    tick();
    expect(catalog.listProducts).not.toHaveBeenCalled();
  }));

  it('clears recommendations when the catalog response has no items field', fakeAsync(() => {
    catalog.listProducts.and.returnValue(of({}));
    const { cmp } = create();
    tick();
    expect(cmp.recommendations).toEqual([]);
    expect(cmp.recommendationsLoading).toBeFalse();
  }));

  it('handles recommendations load error', fakeAsync(() => {
    catalog.listProducts.and.returnValue(throwError(() => new Error('boom')));
    const { cmp } = create();
    tick();
    expect(cmp.recommendations).toEqual([]);
    expect(cmp.recommendationsLoading).toBeFalse();
    expect(cmp.recommendationsError).toContain('cart.recommendationsError');
  }));

  it('tracks view_cart once when analytics enabled and items present', fakeAsync(() => {
    enabledSig.set(true);
    // Include an item with falsy quantity to exercise the (quantity || 0) fallback
    itemsSig.set([makeItem({ id: 'l0', quantity: 0 }), makeItem({ id: 'l1', product_id: 'p1', quantity: 2 })]);
    const { fixture } = create();
    tick();
    expect(analytics.track).toHaveBeenCalledWith('view_cart', jasmine.objectContaining({ units: 2 }));
    analytics.track.calls.reset();
    // second flush should not track again (cartViewTracked)
    itemsSig.set([makeItem(), makeItem({ id: 'line2', product_id: 'p2' })]);
    fixture.detectChanges();
    tick();
    expect(analytics.track).not.toHaveBeenCalled();
  }));

  it('does not track view_cart when analytics disabled', fakeAsync(() => {
    enabledSig.set(false);
    create();
    tick();
    expect(analytics.track).not.toHaveBeenCalled();
  }));

  it('does not track view_cart when syncing', fakeAsync(() => {
    enabledSig.set(true);
    syncingSig.set(true);
    create();
    tick();
    expect(analytics.track).not.toHaveBeenCalled();
  }));

  it('does not track view_cart when no items', fakeAsync(() => {
    enabledSig.set(true);
    itemsSig.set([]);
    create();
    tick();
    expect(analytics.track).not.toHaveBeenCalled();
  }));

  it('reads redirectedFromCheckout from query params', fakeAsync(() => {
    queryParams$.next(convertToParamMap({ from: 'checkout' }));
    const { cmp } = create();
    tick();
    expect(cmp.redirectedFromCheckout).toBeTrue();
    queryParams$.next(convertToParamMap({ from: 'other' }));
    tick();
    expect(cmp.redirectedFromCheckout).toBeFalse();
  }));

  describe('currency + quote getters', () => {
    it('currency prefers quote currency', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ currency: 'EUR' }));
      expect(cmp.currency).toBe('EUR');
    });

    it('currency falls back to first item currency', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ currency: undefined as any }));
      itemsSig.set([makeItem({ currency: 'USD' })]);
      expect(cmp.currency).toBe('USD');
    });

    it('currency falls back to RON', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ currency: undefined as any }));
      itemsSig.set([makeItem({ currency: '' as any })]);
      expect(cmp.currency).toBe('RON');
    });

    it('quoteSubtotal uses quote when finite and positive', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ subtotal: 50 }));
      expect(cmp.quoteSubtotal()).toBe(50);
    });

    it('quoteSubtotal falls back to store subtotal', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ subtotal: 0 }));
      subtotalSig.set(33);
      expect(cmp.quoteSubtotal()).toBe(33);
    });

    it('quoteFee/Tax/Shipping default to 0', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ fee: undefined as any, tax: undefined as any, shipping: undefined as any }));
      expect(cmp.quoteFee()).toBe(0);
      expect(cmp.quoteTax()).toBe(0);
      expect(cmp.quoteShipping()).toBe(0);
    });

    it('quoteFee/Tax/Shipping return values', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ fee: 1, tax: 2, shipping: 3 }));
      expect(cmp.quoteFee()).toBe(1);
      expect(cmp.quoteTax()).toBe(2);
      expect(cmp.quoteShipping()).toBe(3);
    });

    it('quoteTotal uses quote when finite and positive', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ total: 77 }));
      expect(cmp.quoteTotal()).toBe(77);
    });

    it('quoteTotal falls back to store subtotal', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ total: 0 }));
      subtotalSig.set(44);
      expect(cmp.quoteTotal()).toBe(44);
    });

    it('quoteDiscount computes clamped difference', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ subtotal: 100, fee: 0, tax: 0, shipping: 0, total: 90 }));
      expect(cmp.quoteDiscount()).toBe(10);
      quoteSig.set(makeQuote({ subtotal: 100, fee: 0, tax: 0, shipping: 0, total: 120 }));
      expect(cmp.quoteDiscount()).toBe(0);
    });
  });

  describe('coupon shipping discount + promo savings', () => {
    it('returns 0 when no offer', () => {
      const { cmp } = create();
      cmp.appliedCouponOffer = null;
      expect(cmp.freeShippingAppliedByCoupon()).toBeFalse();
      expect(cmp.quotePromoSavings()).toBe(0);
    });

    it('returns 0 when offer not eligible', () => {
      const { cmp } = create();
      cmp.appliedCouponOffer = { coupon: { code: 'X' }, eligible: false, reasons: [], estimated_shipping_discount_ron: '5' } as any;
      cmp.promo = 'X';
      expect(cmp.freeShippingAppliedByCoupon()).toBeFalse();
    });

    it('returns 0 when no current code', () => {
      const { cmp } = create();
      cmp.appliedCouponOffer = { coupon: { code: 'X' }, eligible: true, reasons: [], estimated_shipping_discount_ron: '5' } as any;
      cmp.promo = '' as any;
      expect(cmp.freeShippingAppliedByCoupon()).toBeFalse();
    });

    it('returns 0 when code does not match coupon', () => {
      const { cmp } = create();
      cmp.appliedCouponOffer = { coupon: { code: 'OTHER' }, eligible: true, reasons: [], estimated_shipping_discount_ron: '5' } as any;
      cmp.promo = 'X';
      expect(cmp.freeShippingAppliedByCoupon()).toBeFalse();
    });

    it('returns shipping discount when eligible and matching', () => {
      const { cmp } = create();
      cmp.appliedCouponOffer = { coupon: { code: 'SAVE' }, eligible: true, reasons: [], estimated_shipping_discount_ron: '7' } as any;
      cmp.promo = 'save';
      expect(cmp.freeShippingAppliedByCoupon()).toBeTrue();
      quoteSig.set(makeQuote({ subtotal: 100, total: 100 }));
      expect(cmp.quotePromoSavings()).toBe(7);
    });
  });

  describe('free shipping calculations', () => {
    it('threshold returns null when quote threshold null', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ freeShippingThresholdRon: null }));
      expect(cmp.freeShippingThreshold()).toBeNull();
    });

    it('threshold returns null when not finite or negative', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ freeShippingThresholdRon: -1 }));
      expect(cmp.freeShippingThreshold()).toBeNull();
      quoteSig.set(makeQuote({ freeShippingThresholdRon: Infinity }));
      expect(cmp.freeShippingThreshold()).toBeNull();
    });

    it('threshold returns value', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ freeShippingThresholdRon: 200 }));
      expect(cmp.freeShippingThreshold()).toBe(200);
    });

    it('remaining returns null when no threshold', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ freeShippingThresholdRon: null }));
      expect(cmp.freeShippingRemaining()).toBeNull();
    });

    it('remaining computes remaining amount', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ subtotal: 50, total: 50, freeShippingThresholdRon: 200 }));
      expect(cmp.freeShippingRemaining()).toBe(150);
    });

    it('progress pct returns 0 when no threshold', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ freeShippingThresholdRon: null }));
      expect(cmp.freeShippingProgressPct()).toBe(0);
    });

    it('progress pct returns 100 when threshold <= 0', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ freeShippingThresholdRon: 0 }));
      expect(cmp.freeShippingProgressPct()).toBe(100);
    });

    it('progress pct clamps to range', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ subtotal: 50, total: 50, freeShippingThresholdRon: 200 }));
      expect(cmp.freeShippingProgressPct()).toBeCloseTo(25, 5);
    });
  });

  describe('suggestedAddOns', () => {
    it('returns [] when remaining is null', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ freeShippingThresholdRon: null }));
      expect(cmp.suggestedAddOns()).toEqual([]);
    });

    it('returns [] when recommendations is nullish', () => {
      const { cmp } = create();
      cmp.recommendations = null as any;
      quoteSig.set(makeQuote({ subtotal: 50, total: 50, freeShippingThresholdRon: 200 }));
      expect(cmp.suggestedAddOns()).toEqual([]);
    });

    it('returns [] when remaining <= 0', () => {
      const { cmp } = create();
      quoteSig.set(makeQuote({ subtotal: 300, total: 300, freeShippingThresholdRon: 200 }));
      expect(cmp.suggestedAddOns()).toEqual([]);
    });

    it('returns up to 2 add-ons under remaining', () => {
      const { cmp } = create();
      cmp.recommendations = [
        makeProduct({ id: 'a', base_price: 10 }),
        makeProduct({ id: 'b', base_price: 5 }),
        makeProduct({ id: 'c', base_price: 8 }),
      ];
      quoteSig.set(makeQuote({ subtotal: 50, total: 50, freeShippingThresholdRon: 200 }));
      const result = cmp.suggestedAddOns();
      expect(result.length).toBe(2);
      expect(result[0].id).toBe('b');
    });

    it('falls back to cheapest sorted when none under remaining', () => {
      const { cmp } = create();
      cmp.recommendations = [makeProduct({ id: 'a', base_price: 1000 }), makeProduct({ id: 'b', base_price: 900 })];
      quoteSig.set(makeQuote({ subtotal: 199, total: 199, freeShippingThresholdRon: 200 }));
      const result = cmp.suggestedAddOns();
      expect(result.length).toBe(2);
      expect(result[0].id).toBe('b');
    });
  });

  describe('delivery prefs + estimates', () => {
    it('setDeliveryType saves prefs', () => {
      const { cmp } = create();
      cmp.setDeliveryType('locker');
      expect(cmp.deliveryType).toBe('locker');
      expect(checkoutPrefs.saveDeliveryPrefs).toHaveBeenCalledWith({ courier: 'sameday', deliveryType: 'locker' });
    });

    it('onCourierChanged saves prefs', () => {
      const { cmp } = create();
      cmp.courier = 'fan_courier';
      cmp.onCourierChanged();
      expect(checkoutPrefs.saveDeliveryPrefs).toHaveBeenCalledWith({ courier: 'fan_courier', deliveryType: 'home' });
    });

    it('deliveryEstimate returns range and key/params for non-equal min/max', () => {
      const { cmp } = create();
      cmp.courier = 'sameday';
      cmp.deliveryType = 'home';
      expect(cmp.deliveryEstimate()).toEqual({ min: 1, max: 2 });
      expect(cmp.deliveryEstimateKey()).toBe('cart.deliveryEstimateRange');
      expect(cmp.deliveryEstimateParams()).toEqual({ min: 1, max: 2 });
    });

    it('deliveryEstimate returns single key/params when min equals max', () => {
      const { cmp } = create();
      // Patch estimate to equal values via fan_courier? choose a combo equal: none equal, so force via spy
      spyOn(cmp, 'deliveryEstimate').and.returnValue({ min: 2, max: 2 });
      expect(cmp.deliveryEstimateKey()).toBe('cart.deliveryEstimateSingle');
      expect(cmp.deliveryEstimateParams()).toEqual({ days: 2 });
    });

    it('deliveryEstimate returns null for unknown courier', () => {
      const { cmp } = create();
      cmp.courier = 'unknown' as any;
      expect(cmp.deliveryEstimate()).toBeNull();
      expect(cmp.deliveryEstimateKey()).toBeNull();
      expect(cmp.deliveryEstimateParams()).toEqual({});
    });
  });

  describe('displayProductPrice', () => {
    it('returns sale price when lower than base', () => {
      const { cmp } = create();
      expect(cmp.displayProductPrice(makeProduct({ base_price: 30, sale_price: 20 }))).toBe(20);
    });

    it('returns base price when no valid sale', () => {
      const { cmp } = create();
      expect(cmp.displayProductPrice(makeProduct({ base_price: 30, sale_price: null }))).toBe(30);
      expect(cmp.displayProductPrice(makeProduct({ base_price: 30, sale_price: 40 }))).toBe(30);
    });

    it('returns 0 when base price missing', () => {
      const { cmp } = create();
      expect(cmp.displayProductPrice(makeProduct({ base_price: undefined as any, sale_price: null }))).toBe(0);
    });
  });

  describe('onQuantityChange + stepQuantity', () => {
    it('ignores non-finite values', () => {
      const { cmp } = create();
      cmp.onQuantityChange('line1', 'abc');
      expect(cart.updateQuantity).not.toHaveBeenCalled();
    });

    it('clamps to min 1 and to stock, and marks promo refresh on success', () => {
      const { cmp } = create();
      cmp.promoStatus = 'success';
      itemsSig.set([makeItem({ id: 'line1', stock: 3 })]);
      cmp.onQuantityChange('line1', '0');
      expect(cart.updateQuantity).toHaveBeenCalledWith('line1', 1);
      cart.updateQuantity.calls.reset();
      cmp.onQuantityChange('line1', '99');
      expect(cart.updateQuantity).toHaveBeenCalledWith('line1', 3);
      expect((cmp as any).pendingPromoRefresh).toBeTrue();
    });

    it('handles unknown item (stock 0, no clamp)', () => {
      const { cmp } = create();
      cmp.onQuantityChange('missing', '5');
      expect(cart.updateQuantity).toHaveBeenCalledWith('missing', 5);
    });

    it('sets item error when updateQuantity returns errorKey', () => {
      const { cmp } = create();
      cart.updateQuantity.and.returnValue({ errorKey: 'cart.errors.insufficientStock' });
      cmp.onQuantityChange('line1', '2');
      expect(cmp.itemErrors['line1']).toBe('cart.errors.insufficientStock');
    });

    it('clears item error on success', () => {
      const { cmp } = create();
      cmp.itemErrors['line1'] = 'old';
      cart.updateQuantity.and.returnValue({});
      cmp.onQuantityChange('line1', '2');
      expect(cmp.itemErrors['line1']).toBeUndefined();
    });

    it('stepQuantity adjusts by delta', () => {
      const { cmp } = create();
      const item = makeItem({ id: 'line1', quantity: 2, stock: 9 });
      cmp.stepQuantity(item, 1);
      expect(cart.updateQuantity).toHaveBeenCalledWith('line1', 3);
    });
  });

  describe('stock helpers', () => {
    it('isLowStock', () => {
      const { cmp } = create();
      expect(cmp.isLowStock(makeItem({ stock: 2 }))).toBeTrue();
      expect(cmp.isLowStock(makeItem({ stock: 0 }))).toBeFalse();
      expect(cmp.isLowStock(makeItem({ stock: 9 }))).toBeFalse();
    });

    it('isMaxQuantity', () => {
      const { cmp } = create();
      expect(cmp.isMaxQuantity(makeItem({ stock: 3, quantity: 3 }))).toBeTrue();
      expect(cmp.isMaxQuantity(makeItem({ stock: 0, quantity: 5 }))).toBeFalse();
      expect(cmp.isMaxQuantity(makeItem({ stock: 5, quantity: 1 }))).toBeFalse();
    });
  });

  describe('remove', () => {
    it('removes item and clears related state, marks promo refresh', () => {
      const { cmp } = create();
      cmp.promoStatus = 'success';
      cmp.itemErrors['line1'] = 'e';
      cmp.movingToWishlist['line1'] = true;
      cmp.savingForLater['line1'] = true;
      cmp.remove('line1');
      expect(cart.remove).toHaveBeenCalledWith('line1');
      expect(cmp.itemErrors['line1']).toBeUndefined();
      expect((cmp as any).pendingPromoRefresh).toBeTrue();
    });

    it('does not mark promo refresh when promo not success', () => {
      const { cmp } = create();
      cmp.promoStatus = 'info';
      cmp.remove('line1');
      expect((cmp as any).pendingPromoRefresh).toBeFalse();
    });
  });

  describe('saveForLater', () => {
    it('does nothing without item id', () => {
      const { cmp } = create();
      cmp.saveForLater({ id: '' } as any);
      expect(cart.remove).not.toHaveBeenCalled();
    });

    it('does nothing when already saving', () => {
      const { cmp } = create();
      cmp.savingForLater['line1'] = true;
      cmp.saveForLater(makeItem({ id: 'line1' }));
      expect(cart.remove).not.toHaveBeenCalled();
    });

    it('saves to local on success', () => {
      const { cmp } = create();
      const item = makeItem({ id: 'line1' });
      cmp.saveForLater(item);
      const handlers = cart.remove.calls.mostRecent().args[1];
      handlers.onSuccess();
      expect(cmp.savedForLater.length).toBe(1);
      expect(cmp.savingForLater['line1']).toBeUndefined();
    });

    it('shows toast on error', () => {
      const { cmp } = create();
      cmp.saveForLater(makeItem({ id: 'line1' }));
      const handlers = cart.remove.calls.mostRecent().args[1];
      handlers.onError();
      expect(toast.error).toHaveBeenCalled();
      expect(cmp.savingForLater['line1']).toBeUndefined();
    });
  });

  describe('saveKey + saved for later persistence', () => {
    it('saveKey builds composite key', () => {
      const { cmp } = create();
      expect(cmp.saveKey({ product_id: 'p', variant_id: 'v' })).toBe('p::v');
      expect(cmp.saveKey({ product_id: 'p', variant_id: null })).toBe('p::');
    });

    it('addSavedForLater merges existing and unshifts new', () => {
      const { cmp } = create();
      const item = makeItem({ id: 'line1', product_id: 'p1', variant_id: null, quantity: 2 });
      (cmp as any).addSavedForLater(item);
      expect(cmp.savedForLater.length).toBe(1);
      expect(cmp.savedForLater[0].quantity).toBe(2);
      (cmp as any).addSavedForLater(makeItem({ id: 'line1', product_id: 'p1', variant_id: null, quantity: 3 }));
      expect(cmp.savedForLater.length).toBe(1);
      expect(cmp.savedForLater[0].quantity).toBe(5);
      (cmp as any).addSavedForLater(makeItem({ id: 'line2', product_id: 'p2', variant_id: 'v', quantity: 1 }));
      expect(cmp.savedForLater.length).toBe(2);
      expect(cmp.savedForLater[0].product_id).toBe('p2');
    });
  });

  describe('moveSavedToCart', () => {
    const saved = {
      product_id: 'p1',
      variant_id: null,
      quantity: 1,
      name: 'Saved',
      slug: 'saved',
      price: 10,
      currency: 'RON',
      image: '',
      saved_at: '',
    };

    it('does nothing when already restoring', () => {
      const { cmp } = create();
      cmp.restoringSaved['p1::'] = true;
      cmp.moveSavedToCart({ ...saved });
      expect(cartApi.addItem).not.toHaveBeenCalled();
    });

    it('moves to cart on success', fakeAsync(() => {
      const { cmp } = create();
      cmp.savedForLater = [{ ...saved }];
      cartApi.addItem.and.returnValue(of({}));
      cart.loadFromBackend.calls.reset();
      cmp.moveSavedToCart({ ...saved });
      tick();
      expect(cmp.savedForLater.length).toBe(0);
      expect(cart.loadFromBackend).toHaveBeenCalled();
      expect(cmp.restoringSaved['p1::']).toBeUndefined();
    }));

    it('shows toast on error', fakeAsync(() => {
      const { cmp } = create();
      cartApi.addItem.and.returnValue(throwError(() => new Error('x')));
      cmp.moveSavedToCart({ ...saved });
      tick();
      expect(toast.error).toHaveBeenCalled();
      expect(cmp.restoringSaved['p1::']).toBeUndefined();
    }));

    it('uses variant_id when present', fakeAsync(() => {
      const { cmp } = create();
      cartApi.addItem.and.returnValue(of({}));
      cmp.moveSavedToCart({ ...saved, variant_id: 'v9' });
      tick();
      expect(cartApi.addItem).toHaveBeenCalledWith(jasmine.objectContaining({ variant_id: 'v9' }));
    }));
  });

  describe('removeSavedForLater', () => {
    it('removes matching saved entry and persists', () => {
      const { cmp } = create();
      const entry = {
        product_id: 'p1',
        variant_id: null,
        quantity: 1,
        name: 'S',
        slug: 's',
        price: 1,
        currency: 'RON',
        image: '',
        saved_at: '',
      };
      cmp.savedForLater = [entry];
      cmp.restoringSaved['p1::'] = true;
      cmp.removeSavedForLater(entry);
      expect(cmp.savedForLater.length).toBe(0);
      expect(cmp.restoringSaved['p1::']).toBeUndefined();
      expect(localStorage.getItem(SAVED_FOR_LATER_KEY)).toBe('[]');
    });
  });

  describe('loadSavedForLater', () => {
    it('returns [] when nothing stored', () => {
      localStorage.removeItem(SAVED_FOR_LATER_KEY);
      const { cmp } = create();
      expect(cmp.savedForLater).toEqual([]);
    });

    it('returns [] when stored value is not an array', () => {
      localStorage.setItem(SAVED_FOR_LATER_KEY, JSON.stringify({ a: 1 }));
      const { cmp } = create();
      expect(cmp.savedForLater).toEqual([]);
    });

    it('returns [] on invalid JSON', () => {
      localStorage.setItem(SAVED_FOR_LATER_KEY, 'not-json{');
      const { cmp } = create();
      expect(cmp.savedForLater).toEqual([]);
    });

    it('parses valid entries and filters invalid ones', () => {
      localStorage.setItem(
        SAVED_FOR_LATER_KEY,
        JSON.stringify([
          { product_id: 'p1', variant_id: 'v', quantity: 2, name: 'Ok', slug: 'ok', price: 10, currency: 'RON', image: 'i.png', saved_at: 't' },
          { product_id: '', variant_id: null, quantity: 0, name: '', slug: '', price: 'x', currency: '', image: null, saved_at: null },
        ]),
      );
      const { cmp } = create();
      expect(cmp.savedForLater.length).toBe(1);
      expect(cmp.savedForLater[0].product_id).toBe('p1');
      expect(cmp.savedForLater[0].variant_id).toBe('v');
      expect(cmp.savedForLater[0].image).toBe('i.png');
    });

    it('handles entry with null variant and missing image', () => {
      localStorage.setItem(
        SAVED_FOR_LATER_KEY,
        JSON.stringify([
          { product_id: 'p2', quantity: 1, name: 'Nm', slug: 'sl', price: 5, currency: 'RON', saved_at: '' },
        ]),
      );
      const { cmp } = create();
      expect(cmp.savedForLater[0].variant_id).toBeNull();
      expect(cmp.savedForLater[0].image).toBe('');
    });

    it('coerces a falsy price to 0', () => {
      localStorage.setItem(
        SAVED_FOR_LATER_KEY,
        JSON.stringify([
          { product_id: 'p3', variant_id: null, quantity: 1, name: 'Free', slug: 'free', price: 0, currency: 'RON', image: '', saved_at: '' },
        ]),
      );
      const { cmp } = create();
      expect(cmp.savedForLater.length).toBe(1);
      expect(cmp.savedForLater[0].price).toBe(0);
    });
  });

  describe('localStorage unavailable (SSR-like) branches', () => {
    let original: PropertyDescriptor | undefined;
    let overridden = false;

    afterEach(() => {
      if (!overridden) return;
      if (original) {
        Object.defineProperty(window, 'localStorage', original);
      } else {
        delete (window as any).localStorage;
      }
      overridden = false;
    });

    it('loadSavedForLater returns [] and persist is a no-op without localStorage', () => {
      original = Object.getOwnPropertyDescriptor(window, 'localStorage');
      Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });
      overridden = true;
      const { cmp } = create();
      expect(cmp.savedForLater).toEqual([]);
      // persistSavedForLater should not throw
      expect(() => (cmp as any).persistSavedForLater()).not.toThrow();
    });
  });

  describe('clearCart', () => {
    it('does nothing when not confirmed', () => {
      const { cmp } = create();
      spyOn(window, 'confirm').and.returnValue(false);
      cmp.clearCart();
      expect(cart.clear).not.toHaveBeenCalled();
    });

    it('clears cart and resets state when confirmed', () => {
      const { cmp } = create();
      spyOn(window, 'confirm').and.returnValue(true);
      cmp.itemErrors['line1'] = 'e';
      cmp.promo = 'X';
      cmp.clearCart();
      expect(cart.clear).toHaveBeenCalled();
      expect(cmp.itemErrors).toEqual({});
      expect(cmp.promo).toBe('');
      expect(cmp.promoStatus).toBe('info');
    });
  });

  describe('moveToWishlist', () => {
    it('returns when not authenticated', () => {
      const { cmp } = create();
      auth.isAuthenticated.and.returnValue(false);
      cmp.moveToWishlist(makeItem());
      expect(wishlist.add).not.toHaveBeenCalled();
    });

    it('returns when no product id', () => {
      const { cmp } = create();
      cmp.moveToWishlist(makeItem({ product_id: '' }));
      expect(wishlist.add).not.toHaveBeenCalled();
    });

    it('removes and toasts info when already wishlisted', () => {
      const { cmp } = create();
      wishlist.isWishlisted.and.returnValue(true);
      cmp.moveToWishlist(makeItem({ id: 'line1', product_id: 'p1' }));
      expect(cart.remove).toHaveBeenCalledWith('line1');
      expect(toast.info).toHaveBeenCalled();
      expect(wishlist.add).not.toHaveBeenCalled();
    });

    it('adds to wishlist on success', () => {
      const { cmp } = create();
      const prod = makeProduct();
      wishlist.add.and.returnValue(of(prod));
      cmp.moveToWishlist(makeItem({ id: 'line1', product_id: 'p1' }));
      expect(wishlist.addLocal).toHaveBeenCalledWith(prod);
      expect(cart.remove).toHaveBeenCalledWith('line1');
      expect(toast.success).toHaveBeenCalled();
      expect(cmp.movingToWishlist['line1']).toBeUndefined();
    });

    it('shows error toast with server detail on failure', () => {
      const { cmp } = create();
      wishlist.add.and.returnValue(throwError(() => ({ error: { detail: 'nope' } })));
      cmp.moveToWishlist(makeItem({ id: 'line1', product_id: 'p1' }));
      expect(toast.error).toHaveBeenCalledWith(jasmine.any(String), 'nope');
      expect(cmp.movingToWishlist['line1']).toBeUndefined();
    });

    it('shows error toast with fallback message when no detail', () => {
      const { cmp } = create();
      wishlist.add.and.returnValue(throwError(() => ({})));
      cmp.moveToWishlist(makeItem({ id: 'line1', product_id: 'p1' }));
      expect(toast.error).toHaveBeenCalled();
    });
  });

  describe('clearPromo + resetPromoState', () => {
    it('resets promo state and reloads cart', () => {
      const { cmp } = create();
      cmp.promo = 'X';
      cmp.promoStatus = 'success';
      cmp.appliedCouponOffer = { coupon: { code: 'X' } } as any;
      cart.loadFromBackend.calls.reset();
      cmp.clearPromo();
      expect(cmp.promo).toBe('');
      expect(cmp.promoStatus).toBe('info');
      expect(cmp.appliedCouponOffer).toBeNull();
      expect(cart.loadFromBackend).toHaveBeenCalled();
    });
  });

  describe('applyPromo', () => {
    it('clears promo when normalized code is empty', () => {
      const { cmp } = create();
      cmp.promo = '' as any;
      cart.loadFromBackend.calls.reset();
      cmp.applyPromo();
      expect(cmp.promoStatus).toBe('info');
      expect(cart.loadFromBackend).toHaveBeenCalled();
    });

    it('warns when not authenticated', () => {
      const { cmp } = create();
      auth.isAuthenticated.and.returnValue(false);
      cmp.promo = 'save10';
      cmp.applyPromo();
      expect(cmp.promoStatus).toBe('warn');
      expect(cmp.promoValid).toBeFalse();
      expect(cmp.promo).toBe('');
      expect(cmp.appliedCouponOffer).toBeNull();
      expect(cart.loadFromBackend).toHaveBeenCalled();
    });

    it('applies eligible coupon and refreshes quote', fakeAsync(() => {
      const { cmp } = create();
      coupons.validate.and.returnValue(
        of({ coupon: { code: 'SAVE10' }, eligible: true, reasons: [], estimated_shipping_discount_ron: '0' }),
      );
      cartApi.get.and.returnValue(of({ items: [], totals: {} }));
      cmp.promo = 'save10';
      cmp.applyPromo();
      tick();
      expect(cmp.promoStatus).toBe('success');
      expect(cmp.promoApplying).toBeFalse();
      expect(cart.hydrateFromBackend).toHaveBeenCalled();
    }));

    it('warns for ineligible coupon with reasons (untranslated keys)', fakeAsync(() => {
      const { cmp } = create();
      coupons.validate.and.returnValue(
        of({ coupon: { code: 'SAVE10' }, eligible: false, reasons: ['min_order', 'unknown_reason'], estimated_shipping_discount_ron: '0' }),
      );
      cmp.promo = 'save10';
      cmp.applyPromo();
      tick();
      expect(cmp.promoStatus).toBe('warn');
      expect(cmp.promoValid).toBeFalse();
      // No active translation: each reason key falls through to the raw key
      expect(cmp.promoMessage).toContain('min_order');
      expect(cmp.promoMessage).toContain('unknown_reason');
    }));

    it('describeCouponReasons uses translated label when available', () => {
      const ts = TestBed.inject(TranslateService);
      ts.setTranslation('en', { checkout: { couponReasons: { min_order: 'Minimum order' } } }, true);
      ts.use('en');
      // Skip change detection so the localized-currency pipe never triggers an fx fetch
      const { cmp } = create(false);
      const out = (cmp as any).describeCouponReasons(['min_order', 'unknown_reason']);
      expect(out).toContain('Minimum order');
      expect(out).toContain('unknown_reason');
    });

    it('treats 404 as applied promo and refreshes quote', fakeAsync(() => {
      const { cmp } = create();
      coupons.validate.and.returnValue(throwError(() => ({ status: 404 })));
      cartApi.get.and.returnValue(of({ items: [], totals: {} }));
      cmp.promo = 'save10';
      cmp.applyPromo();
      tick();
      expect(cmp.appliedCouponOffer).toBeNull();
      expect(cmp.promoStatus).toBe('success');
      expect(cart.hydrateFromBackend).toHaveBeenCalled();
    }));

    it('warns on validate error with server detail', fakeAsync(() => {
      const { cmp } = create();
      coupons.validate.and.returnValue(throwError(() => ({ status: 500, error: { detail: 'bad coupon' } })));
      cmp.promo = 'save10';
      cmp.applyPromo();
      tick();
      expect(cmp.promoStatus).toBe('warn');
      expect(cmp.promoMessage).toBe('bad coupon');
      expect(cart.loadFromBackend).toHaveBeenCalled();
    }));

    it('warns on validate error with fallback message', fakeAsync(() => {
      const { cmp } = create();
      coupons.validate.and.returnValue(throwError(() => ({ status: 500 })));
      cmp.promo = 'save10';
      cmp.applyPromo();
      tick();
      expect(cmp.promoStatus).toBe('warn');
      expect(cmp.promoMessage).toBeTruthy();
    }));

    it('describes reasons with empty list fallback', fakeAsync(() => {
      const { cmp } = create();
      coupons.validate.and.returnValue(
        of({ coupon: { code: 'SAVE10' }, eligible: false, reasons: [], estimated_shipping_discount_ron: '0' }),
      );
      cmp.promo = 'save10';
      cmp.applyPromo();
      tick();
      expect(cmp.promoMessage).toContain('checkout.couponNotEligible');
    }));

    it('describes reasons when reasons is undefined', fakeAsync(() => {
      const { cmp } = create();
      coupons.validate.and.returnValue(
        of({ coupon: { code: 'SAVE10' }, eligible: false, estimated_shipping_discount_ron: '0' } as any),
      );
      cmp.promo = 'save10';
      cmp.applyPromo();
      tick();
      expect(cmp.promoStatus).toBe('warn');
    }));
  });

  describe('refreshPromoQuote via pending promo effect', () => {
    it('refreshes promo quote when syncing settles', fakeAsync(() => {
      const { fixture, cmp } = create();
      tick();
      cmp.promoStatus = 'success';
      cmp.promo = 'SAVE10';
      (cmp as any).pendingPromoRefresh = true;
      cartApi.get.and.returnValue(of({ items: [], totals: {} }));
      cart.hydrateFromBackend.calls.reset();
      syncingSig.set(true);
      fixture.detectChanges();
      tick();
      syncingSig.set(false);
      fixture.detectChanges();
      tick();
      expect(cartApi.get).toHaveBeenCalledWith({ promo_code: 'SAVE10' });
      expect(cart.hydrateFromBackend).toHaveBeenCalled();
      expect((cmp as any).pendingPromoRefresh).toBeFalse();
    }));

    it('skips promo refresh when not success status', fakeAsync(() => {
      const { fixture, cmp } = create();
      tick();
      cmp.promoStatus = 'info';
      (cmp as any).pendingPromoRefresh = true;
      cartApi.get.calls.reset();
      syncingSig.set(true);
      fixture.detectChanges();
      tick();
      syncingSig.set(false);
      fixture.detectChanges();
      tick();
      expect(cartApi.get).not.toHaveBeenCalled();
    }));

    it('skips promo refresh when code blank', fakeAsync(() => {
      const { fixture, cmp } = create();
      tick();
      cmp.promoStatus = 'success';
      cmp.promo = '' as any;
      (cmp as any).pendingPromoRefresh = true;
      cartApi.get.calls.reset();
      syncingSig.set(true);
      fixture.detectChanges();
      tick();
      syncingSig.set(false);
      fixture.detectChanges();
      tick();
      expect(cartApi.get).not.toHaveBeenCalled();
    }));

    it('handles refresh promo quote error', fakeAsync(() => {
      const { fixture, cmp } = create();
      tick();
      cmp.promoStatus = 'success';
      cmp.promo = 'SAVE10';
      (cmp as any).pendingPromoRefresh = true;
      cartApi.get.and.returnValue(throwError(() => ({ error: { detail: 'quote failed' } })));
      cart.loadFromBackend.calls.reset();
      syncingSig.set(true);
      fixture.detectChanges();
      tick();
      syncingSig.set(false);
      fixture.detectChanges();
      tick();
      expect(cmp.promoStatus).toBe('warn');
      expect(cmp.promoMessage).toBe('quote failed');
      expect(cmp.appliedCouponOffer).toBeNull();
      expect(cart.loadFromBackend).toHaveBeenCalled();
    }));

    it('handles refresh promo quote error with fallback message', fakeAsync(() => {
      const { fixture, cmp } = create();
      tick();
      cmp.promoStatus = 'success';
      cmp.promo = 'SAVE10';
      (cmp as any).pendingPromoRefresh = true;
      cartApi.get.and.returnValue(throwError(() => ({})));
      syncingSig.set(true);
      fixture.detectChanges();
      tick();
      syncingSig.set(false);
      fixture.detectChanges();
      tick();
      expect(cmp.promoStatus).toBe('warn');
      expect(cmp.promoMessage).toBeTruthy();
    }));

    it('does not refresh while still syncing', fakeAsync(() => {
      const { fixture, cmp } = create();
      tick();
      cmp.promoStatus = 'success';
      cmp.promo = 'SAVE10';
      (cmp as any).pendingPromoRefresh = true;
      cartApi.get.calls.reset();
      syncingSig.set(true);
      fixture.detectChanges();
      tick();
      expect(cartApi.get).not.toHaveBeenCalled();
    }));
  });
});
