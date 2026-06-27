import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { convertToParamMap, ParamMap } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { CartComponent } from './cart.component';
import { CartStore, CartItem, CartQuote } from '../../core/cart.store';
import { CartApi } from '../../core/cart.api';
import { AuthService } from '../../core/auth.service';
import { CouponsService } from '../../core/coupons.service';
import { WishlistService } from '../../core/wishlist.service';
import { ToastService } from '../../core/toast.service';
import { CatalogService } from '../../core/catalog.service';
import { CheckoutPrefsService } from '../../core/checkout-prefs.service';
import { AnalyticsService } from '../../core/analytics.service';

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
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
    ...overrides,
  };
}

function makeQuote(overrides: Partial<CartQuote> = {}): CartQuote {
  return {
    subtotal: 0,
    fee: 0,
    tax: 0,
    shipping: 0,
    total: 0,
    currency: 'RON',
    freeShippingThresholdRon: null,
    ...overrides,
  };
}

describe('CartComponent', () => {
  let items: ReturnType<typeof signal<CartItem[]>>;
  let quote: ReturnType<typeof signal<CartQuote>>;
  let syncing: ReturnType<typeof signal<boolean>>;
  let subtotalSig: ReturnType<typeof signal<number>>;

  let cart: any;
  let cartApi: any;
  let auth: any;
  let coupons: any;
  let wishlist: any;
  let toast: any;
  let catalog: any;
  let checkoutPrefs: any;
  let analytics: any;
  let queryParamMap$: Subject<ParamMap>;
  let prefs: { courier: string; deliveryType: string };

  beforeEach(() => {
    localStorage.clear();

    items = signal<CartItem[]>([]);
    quote = signal<CartQuote>(makeQuote());
    syncing = signal<boolean>(false);
    subtotalSig = signal<number>(0);

    cart = {
      items,
      quote,
      syncing,
      subtotal: subtotalSig,
      updateQuantity: jasmine.createSpy('updateQuantity').and.returnValue({}),
      remove: jasmine.createSpy('remove'),
      clear: jasmine.createSpy('clear'),
      loadFromBackend: jasmine.createSpy('loadFromBackend'),
      hydrateFromBackend: jasmine.createSpy('hydrateFromBackend'),
    };

    cartApi = jasmine.createSpyObj('CartApi', ['addItem', 'get']);
    cartApi.addItem.and.returnValue(of({}));
    cartApi.get.and.returnValue(of({ items: [], totals: {} }));

    auth = jasmine.createSpyObj('AuthService', ['isAuthenticated']);
    auth.isAuthenticated.and.returnValue(true);

    coupons = jasmine.createSpyObj('CouponsService', ['validate']);
    coupons.validate.and.returnValue(of({ eligible: true, coupon: { code: 'SAVE' }, reasons: [] }));

    wishlist = jasmine.createSpyObj('WishlistService', [
      'ensureLoaded',
      'isWishlisted',
      'add',
      'addLocal',
    ]);
    wishlist.isWishlisted.and.returnValue(false);
    wishlist.add.and.returnValue(of({ id: 'p1' }));

    toast = jasmine.createSpyObj('ToastService', ['error', 'info', 'success']);

    catalog = jasmine.createSpyObj('CatalogService', ['listProducts']);
    catalog.listProducts.and.returnValue(of({ items: [] }));

    prefs = { courier: 'sameday', deliveryType: 'home' };
    checkoutPrefs = jasmine.createSpyObj('CheckoutPrefsService', [
      'loadDeliveryPrefs',
      'saveDeliveryPrefs',
    ]);
    checkoutPrefs.loadDeliveryPrefs.and.callFake(() => prefs);

    analytics = jasmine.createSpyObj('AnalyticsService', ['enabled', 'track']);
    analytics.enabled.and.returnValue(false);

    queryParamMap$ = new Subject<ParamMap>();

    TestBed.configureTestingModule({
      imports: [CartComponent, TranslateModule.forRoot()],
      providers: [
        { provide: CartStore, useValue: cart },
        { provide: CartApi, useValue: cartApi },
        { provide: AuthService, useValue: auth },
        { provide: CouponsService, useValue: coupons },
        { provide: WishlistService, useValue: wishlist },
        { provide: ToastService, useValue: toast },
        { provide: CatalogService, useValue: catalog },
        { provide: CheckoutPrefsService, useValue: checkoutPrefs },
        { provide: AnalyticsService, useValue: analytics },
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParamMap$.asObservable() } },
      ],
    });

    // Replace the heavy inline template so effects flush without rendering
    // child components. The template is a decorator string and is not counted
    // toward cart.component.ts line/branch coverage.
    TestBed.overrideComponent(CartComponent, { set: { template: '' } });
  });

  function create() {
    const fixture = TestBed.createComponent(CartComponent);
    return { fixture, cmp: fixture.componentInstance };
  }

  // ---- constructor / preferences ----

  it('reads delivery prefs from CheckoutPrefsService in the constructor', () => {
    prefs = { courier: 'fan_courier', deliveryType: 'locker' };
    const { cmp } = create();
    expect(cmp.courier).toBe('fan_courier');
    expect(cmp.deliveryType).toBe('locker');
  });

  // ---- ngOnInit ----

  it('tracks redirectedFromCheckout from query params and loads data', () => {
    const { cmp } = create();
    cmp.ngOnInit();
    queryParamMap$.next(convertToParamMap({ from: 'checkout' }));
    expect(cmp.redirectedFromCheckout).toBeTrue();
    queryParamMap$.next(convertToParamMap({ from: 'elsewhere' }));
    expect(cmp.redirectedFromCheckout).toBeFalse();
    expect(cart.loadFromBackend).toHaveBeenCalled();
    expect(wishlist.ensureLoaded).toHaveBeenCalled();
  });

  // ---- currency getter ----

  it('resolves currency from quote, then item, then default RON', () => {
    const { cmp } = create();
    quote.set(makeQuote({ currency: 'USD' }));
    expect(cmp.currency).toBe('USD');

    quote.set(makeQuote({ currency: undefined as any }));
    items.set([makeItem({ currency: 'EUR' })]);
    expect(cmp.currency).toBe('EUR');

    items.set([makeItem({ currency: '' })]);
    expect(cmp.currency).toBe('RON');
  });

  // ---- quote helpers ----

  it('computes quoteSubtotal preferring a positive finite quote subtotal', () => {
    const { cmp } = create();
    quote.set(makeQuote({ subtotal: 50 }));
    expect(cmp.quoteSubtotal()).toBe(50);

    subtotalSig.set(30);
    quote.set(makeQuote({ subtotal: 0 }));
    expect(cmp.quoteSubtotal()).toBe(30);

    quote.set(makeQuote({ subtotal: Number.NaN }));
    expect(cmp.quoteSubtotal()).toBe(30);
  });

  it('computes quoteTotal preferring a positive finite quote total', () => {
    const { cmp } = create();
    quote.set(makeQuote({ total: 99 }));
    expect(cmp.quoteTotal()).toBe(99);

    subtotalSig.set(12);
    quote.set(makeQuote({ total: 0 }));
    expect(cmp.quoteTotal()).toBe(12);
  });

  it('returns fee/tax/shipping with nullish fallback to 0', () => {
    const { cmp } = create();
    quote.set(makeQuote({ fee: 5, tax: 3, shipping: 7 }));
    expect(cmp.quoteFee()).toBe(5);
    expect(cmp.quoteTax()).toBe(3);
    expect(cmp.quoteShipping()).toBe(7);

    quote.set(makeQuote({ fee: null as any, tax: null as any, shipping: null as any }));
    expect(cmp.quoteFee()).toBe(0);
    expect(cmp.quoteTax()).toBe(0);
    expect(cmp.quoteShipping()).toBe(0);
  });

  it('computes quoteDiscount as a non-negative difference', () => {
    const { cmp } = create();
    quote.set(makeQuote({ subtotal: 100, fee: 10, tax: 5, shipping: 8, total: 100 }));
    expect(cmp.quoteDiscount()).toBe(23);

    quote.set(makeQuote({ subtotal: 100, fee: 0, tax: 0, shipping: 0, total: 200 }));
    expect(cmp.quoteDiscount()).toBe(0);
  });

  // ---- coupon shipping discount / promo savings ----

  it('quotePromoSavings includes coupon shipping discount only for the matching code', () => {
    const { cmp } = create();
    quote.set(makeQuote({ subtotal: 100, fee: 0, tax: 0, shipping: 0, total: 90 }));

    // No applied offer -> only base discount.
    expect(cmp.quotePromoSavings()).toBe(10);

    // Offer not eligible -> ignored.
    cmp.appliedCouponOffer = { eligible: false, coupon: { code: 'SAVE' } } as any;
    cmp.promo = 'SAVE';
    expect(cmp.quotePromoSavings()).toBe(10);

    // Eligible but code does not match current promo -> ignored.
    cmp.appliedCouponOffer = {
      eligible: true,
      coupon: { code: 'OTHER' },
      estimated_shipping_discount_ron: '5',
    } as any;
    cmp.promo = 'SAVE';
    expect(cmp.quotePromoSavings()).toBe(10);

    // Eligible with empty current code -> ignored.
    cmp.promo = '';
    expect(cmp.quotePromoSavings()).toBe(10);

    // Eligible and matching -> adds shipping discount.
    cmp.appliedCouponOffer = {
      eligible: true,
      coupon: { code: 'SAVE' },
      estimated_shipping_discount_ron: '15.5',
    } as any;
    cmp.promo = 'save';
    expect(cmp.quotePromoSavings()).toBe(25.5);
    expect(cmp.freeShippingAppliedByCoupon()).toBeTrue();
  });

  it('freeShippingAppliedByCoupon is false without a matching coupon', () => {
    const { cmp } = create();
    expect(cmp.freeShippingAppliedByCoupon()).toBeFalse();
  });

  // ---- free shipping calculations ----

  it('freeShippingThreshold validates the quote threshold', () => {
    const { cmp } = create();
    quote.set(makeQuote({ freeShippingThresholdRon: null }));
    expect(cmp.freeShippingThreshold()).toBeNull();

    quote.set(makeQuote({ freeShippingThresholdRon: -5 }));
    expect(cmp.freeShippingThreshold()).toBeNull();

    quote.set(makeQuote({ freeShippingThresholdRon: Number.NaN }));
    expect(cmp.freeShippingThreshold()).toBeNull();

    quote.set(makeQuote({ freeShippingThresholdRon: 200 }));
    expect(cmp.freeShippingThreshold()).toBe(200);
  });

  it('freeShippingRemaining returns null without a threshold and a clamped remainder otherwise', () => {
    const { cmp } = create();
    quote.set(makeQuote({ freeShippingThresholdRon: null }));
    expect(cmp.freeShippingRemaining()).toBeNull();

    subtotalSig.set(50);
    quote.set(makeQuote({ subtotal: 50, total: 50, freeShippingThresholdRon: 200 }));
    expect(cmp.freeShippingRemaining()).toBe(150);
  });

  it('freeShippingProgressPct covers null, zero and partial thresholds', () => {
    const { cmp } = create();
    quote.set(makeQuote({ freeShippingThresholdRon: null }));
    expect(cmp.freeShippingProgressPct()).toBe(0);

    quote.set(makeQuote({ freeShippingThresholdRon: 0 }));
    expect(cmp.freeShippingProgressPct()).toBe(100);

    subtotalSig.set(50);
    quote.set(makeQuote({ subtotal: 50, total: 50, freeShippingThresholdRon: 200 }));
    expect(cmp.freeShippingProgressPct()).toBeCloseTo(25);
  });

  // ---- suggested add-ons ----

  it('suggestedAddOns is empty when there is no remaining gap', () => {
    const { cmp } = create();
    quote.set(makeQuote({ freeShippingThresholdRon: null }));
    expect(cmp.suggestedAddOns()).toEqual([]);
  });

  it('suggestedAddOns prefers products under the remaining gap', () => {
    const { cmp } = create();
    subtotalSig.set(50);
    quote.set(makeQuote({ subtotal: 50, total: 50, freeShippingThresholdRon: 200 }));
    cmp.recommendations = [
      { id: 'a', slug: 'a', name: 'A', base_price: 30, sale_price: null, currency: 'RON' },
      { id: 'b', slug: 'b', name: 'B', base_price: 10, sale_price: null, currency: 'RON' },
      { id: 'c', slug: 'c', name: 'C', base_price: 20, sale_price: null, currency: 'RON' },
    ] as any;
    const result = cmp.suggestedAddOns();
    expect(result.map((p) => p.id)).toEqual(['b', 'c']);
  });

  it('suggestedAddOns falls back to cheapest products when none are under the gap', () => {
    const { cmp } = create();
    subtotalSig.set(195);
    quote.set(makeQuote({ subtotal: 195, total: 195, freeShippingThresholdRon: 200 }));
    cmp.recommendations = null as any;
    expect(cmp.suggestedAddOns()).toEqual([]);

    cmp.recommendations = [
      { id: 'a', slug: 'a', name: 'A', base_price: 30, sale_price: null, currency: 'RON' },
      { id: 'b', slug: 'b', name: 'B', base_price: 10, sale_price: null, currency: 'RON' },
    ] as any;
    expect(cmp.suggestedAddOns().map((p) => p.id)).toEqual(['b', 'a']);
  });

  // ---- delivery preferences ----

  it('setDeliveryType updates state and persists prefs', () => {
    const { cmp } = create();
    cmp.setDeliveryType('locker');
    expect(cmp.deliveryType).toBe('locker');
    expect(checkoutPrefs.saveDeliveryPrefs).toHaveBeenCalledWith({
      courier: 'sameday',
      deliveryType: 'locker',
    });
  });

  it('onCourierChanged persists prefs', () => {
    const { cmp } = create();
    cmp.courier = 'fan_courier';
    cmp.onCourierChanged();
    expect(checkoutPrefs.saveDeliveryPrefs).toHaveBeenCalledWith({
      courier: 'fan_courier',
      deliveryType: 'home',
    });
  });

  // ---- delivery estimate ----

  it('deliveryEstimate returns a range for known courier/type and null otherwise', () => {
    const { cmp } = create();
    cmp.courier = 'sameday';
    cmp.deliveryType = 'home';
    expect(cmp.deliveryEstimate()).toEqual({ min: 1, max: 2 });

    cmp.courier = 'unknown' as any;
    expect(cmp.deliveryEstimate()).toBeNull();
    expect(cmp.deliveryEstimateKey()).toBeNull();
    expect(cmp.deliveryEstimateParams()).toEqual({});
  });

  it('deliveryEstimateKey/Params handle range vs single-day estimates', () => {
    const { cmp } = create();
    cmp.courier = 'sameday';
    cmp.deliveryType = 'home';
    expect(cmp.deliveryEstimateKey()).toBe('cart.deliveryEstimateRange');
    expect(cmp.deliveryEstimateParams()).toEqual({ min: 1, max: 2 });

    spyOn(cmp, 'deliveryEstimate').and.returnValue({ min: 2, max: 2 });
    expect(cmp.deliveryEstimateKey()).toBe('cart.deliveryEstimateSingle');
    expect(cmp.deliveryEstimateParams()).toEqual({ days: 2 });
  });

  // ---- product price display ----

  it('displayProductPrice returns sale price only when it is a valid discount', () => {
    const { cmp } = create();
    expect(cmp.displayProductPrice({ base_price: 10, sale_price: 5 } as any)).toBe(5);
    expect(cmp.displayProductPrice({ base_price: 10, sale_price: 20 } as any)).toBe(10);
    expect(cmp.displayProductPrice({ base_price: 10, sale_price: null } as any)).toBe(10);
    expect(cmp.displayProductPrice({ base_price: undefined } as any)).toBe(0);
  });

  // ---- quantity handling ----

  it('onQuantityChange ignores non-finite values', () => {
    const { cmp } = create();
    items.set([makeItem({ id: 'l1' })]);
    cmp.onQuantityChange('l1', 'abc');
    expect(cart.updateQuantity).not.toHaveBeenCalled();
  });

  it('onQuantityChange floors and clamps quantities to at least 1 and stock', () => {
    const { cmp } = create();
    items.set([makeItem({ id: 'l1', stock: 5 })]);

    cmp.onQuantityChange('l1', 0);
    expect(cart.updateQuantity).toHaveBeenCalledWith('l1', 1);

    cmp.onQuantityChange('l1', 100);
    expect(cart.updateQuantity).toHaveBeenCalledWith('l1', 5);
  });

  it('onQuantityChange handles missing item (stock 0) without clamping to stock', () => {
    const { cmp } = create();
    items.set([]);
    cmp.onQuantityChange('missing', 3);
    expect(cart.updateQuantity).toHaveBeenCalledWith('missing', 3);
  });

  it('onQuantityChange records an item error when the store reports one', () => {
    const { cmp } = create();
    items.set([makeItem({ id: 'l1' })]);
    cart.updateQuantity.and.returnValue({ errorKey: 'cart.errors.insufficientStock' });
    cmp.onQuantityChange('l1', 2);
    expect(cmp.itemErrors['l1']).toBe('cart.errors.insufficientStock');
  });

  it('onQuantityChange clears errors and flags a promo refresh on success', () => {
    const { cmp } = create();
    items.set([makeItem({ id: 'l1' })]);
    cmp.itemErrors['l1'] = 'old';
    cmp.promoStatus = 'success';
    cmp.onQuantityChange('l1', 2);
    expect(cmp.itemErrors['l1']).toBeUndefined();
    expect((cmp as any).pendingPromoRefresh).toBeTrue();
  });

  it('stepQuantity adjusts quantity by the delta', () => {
    const { cmp } = create();
    items.set([makeItem({ id: 'l1', quantity: 2, stock: 9 })]);
    cmp.stepQuantity(makeItem({ id: 'l1', quantity: 2, stock: 9 }), 1);
    expect(cart.updateQuantity).toHaveBeenCalledWith('l1', 3);
  });

  // ---- stock helpers ----

  it('isLowStock detects 1-3 units in stock', () => {
    const { cmp } = create();
    expect(cmp.isLowStock(makeItem({ stock: 2 }))).toBeTrue();
    expect(cmp.isLowStock(makeItem({ stock: 0 }))).toBeFalse();
    expect(cmp.isLowStock(makeItem({ stock: 5 }))).toBeFalse();
  });

  it('isMaxQuantity detects when quantity reaches stock', () => {
    const { cmp } = create();
    expect(cmp.isMaxQuantity(makeItem({ stock: 5, quantity: 5 }))).toBeTrue();
    expect(cmp.isMaxQuantity(makeItem({ stock: 0, quantity: 1 }))).toBeFalse();
    expect(cmp.isMaxQuantity(makeItem({ stock: 5, quantity: 3 }))).toBeFalse();
  });

  // ---- remove ----

  it('remove clears per-item state and flags a promo refresh when applied', () => {
    const { cmp } = create();
    cmp.itemErrors['l1'] = 'e';
    cmp.movingToWishlist['l1'] = true;
    cmp.savingForLater['l1'] = true;
    cmp.promoStatus = 'success';
    cmp.remove('l1');
    expect(cart.remove).toHaveBeenCalledWith('l1');
    expect(cmp.itemErrors['l1']).toBeUndefined();
    expect((cmp as any).pendingPromoRefresh).toBeTrue();
  });

  it('remove does not flag a promo refresh when no promo is applied', () => {
    const { cmp } = create();
    cmp.promoStatus = 'info';
    cmp.remove('l1');
    expect((cmp as any).pendingPromoRefresh).toBeFalse();
  });

  // ---- save for later ----

  it('saveForLater ignores items without an id', () => {
    const { cmp } = create();
    cmp.saveForLater({} as any);
    expect(cart.remove).not.toHaveBeenCalled();
  });

  it('saveForLater ignores items already being saved', () => {
    const { cmp } = create();
    cmp.savingForLater['l1'] = true;
    cmp.saveForLater(makeItem({ id: 'l1' }));
    expect(cart.remove).not.toHaveBeenCalled();
  });

  it('saveForLater removes from cart and stores the item on success', () => {
    const { cmp } = create();
    cart.remove.and.callFake((_id: string, handlers: any) => handlers?.onSuccess?.());
    cmp.saveForLater(makeItem({ id: 'l1', product_id: 'p1', variant_id: 'v1', quantity: 2 }));
    expect(cmp.savedForLater.length).toBe(1);
    expect(cmp.savedForLater[0].product_id).toBe('p1');
    expect(cmp.savingForLater['l1']).toBeUndefined();
  });

  it('saveForLater surfaces a toast on error', () => {
    const { cmp } = create();
    cart.remove.and.callFake((_id: string, handlers: any) => handlers?.onError?.());
    cmp.saveForLater(makeItem({ id: 'l1' }));
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.savingForLater['l1']).toBeUndefined();
  });

  it('addSavedForLater merges existing entries and keeps non-matching ones', () => {
    const { cmp } = create();
    cart.remove.and.callFake((_id: string, handlers: any) => handlers?.onSuccess?.());
    cmp.savedForLater = [
      {
        product_id: 'p1',
        variant_id: null,
        quantity: 1,
        name: 'A',
        slug: 'a',
        price: 10,
        currency: 'RON',
        image: '',
        saved_at: '2020',
      },
      {
        product_id: 'other',
        variant_id: null,
        quantity: 1,
        name: 'Z',
        slug: 'z',
        price: 5,
        currency: 'RON',
        image: '',
        saved_at: '2020',
      },
    ];
    cmp.saveForLater(
      makeItem({ id: 'l1', product_id: 'p1', variant_id: undefined, quantity: 3 }),
    );
    const merged = cmp.savedForLater.find((s) => s.product_id === 'p1');
    expect(merged?.quantity).toBe(4);
    expect(cmp.savedForLater.some((s) => s.product_id === 'other')).toBeTrue();
  });

  it('addSavedForLater unshifts a new entry with a null variant fallback', () => {
    const { cmp } = create();
    cart.remove.and.callFake((_id: string, handlers: any) => handlers?.onSuccess?.());
    cmp.savedForLater = [];
    cmp.saveForLater(makeItem({ id: 'l1', product_id: 'pX', variant_id: undefined }));
    expect(cmp.savedForLater.length).toBe(1);
    expect(cmp.savedForLater[0].variant_id).toBeNull();
  });

  // ---- saveKey ----

  it('saveKey combines product and variant ids', () => {
    const { cmp } = create();
    expect(cmp.saveKey({ product_id: 'p1', variant_id: 'v1' })).toBe('p1::v1');
    expect(cmp.saveKey({ product_id: 'p1', variant_id: null })).toBe('p1::');
  });

  // ---- moveSavedToCart ----

  function savedEntry(overrides: any = {}) {
    return {
      product_id: 'p1',
      variant_id: null,
      quantity: 2,
      name: 'A',
      slug: 'a',
      price: 10,
      currency: 'RON',
      image: '',
      saved_at: '2020',
      ...overrides,
    };
  }

  it('moveSavedToCart ignores entries already restoring', () => {
    const { cmp } = create();
    const saved = savedEntry();
    cmp.restoringSaved[cmp.saveKey(saved)] = true;
    cmp.moveSavedToCart(saved);
    expect(cartApi.addItem).not.toHaveBeenCalled();
  });

  it('moveSavedToCart adds to cart and reloads on success', () => {
    const { cmp } = create();
    const saved = savedEntry({ variant_id: 'v9' });
    cmp.savedForLater = [saved];
    cmp.moveSavedToCart(saved);
    expect(cartApi.addItem).toHaveBeenCalledWith({
      product_id: 'p1',
      variant_id: 'v9',
      quantity: 2,
    });
    expect(cart.loadFromBackend).toHaveBeenCalled();
    expect(cmp.savedForLater.length).toBe(0);
  });

  it('moveSavedToCart maps a null variant to undefined', () => {
    const { cmp } = create();
    const saved = savedEntry({ variant_id: null });
    cmp.savedForLater = [saved];
    cmp.moveSavedToCart(saved);
    expect(cartApi.addItem).toHaveBeenCalledWith({
      product_id: 'p1',
      variant_id: undefined,
      quantity: 2,
    });
  });

  it('moveSavedToCart surfaces a toast on error', () => {
    const { cmp } = create();
    cartApi.addItem.and.returnValue(throwError(() => ({})));
    const saved = savedEntry();
    cmp.moveSavedToCart(saved);
    expect(toast.error).toHaveBeenCalled();
    expect(cmp.restoringSaved[cmp.saveKey(saved)]).toBeUndefined();
  });

  // ---- removeSavedForLater ----

  it('removeSavedForLater filters and persists the list', () => {
    const { cmp } = create();
    const saved = savedEntry();
    cmp.savedForLater = [saved, savedEntry({ product_id: 'p2' })];
    cmp.removeSavedForLater(saved);
    expect(cmp.savedForLater.map((s) => s.product_id)).toEqual(['p2']);
    expect(JSON.parse(localStorage.getItem('cart_saved_for_later')!).length).toBe(1);
  });

  // ---- loadSavedForLater ----

  it('loadSavedForLater returns [] when no data exists', () => {
    const { cmp } = create();
    expect((cmp as any).loadSavedForLater()).toEqual([]);
  });

  it('loadSavedForLater returns [] when stored value is not an array', () => {
    const { cmp } = create();
    localStorage.setItem('cart_saved_for_later', '{}');
    expect((cmp as any).loadSavedForLater()).toEqual([]);
  });

  it('loadSavedForLater returns [] on malformed JSON', () => {
    const { cmp } = create();
    localStorage.setItem('cart_saved_for_later', 'not-json');
    expect((cmp as any).loadSavedForLater()).toEqual([]);
  });

  it('loadSavedForLater normalizes and filters stored entries', () => {
    const { cmp } = create();
    localStorage.setItem(
      'cart_saved_for_later',
      JSON.stringify([
        {
          product_id: 'p1',
          variant_id: 'v1',
          quantity: 2,
          name: 'A',
          slug: 'a',
          price: 10,
          currency: 'RON',
          image: '/i.png',
          saved_at: '2020',
        },
        {
          product_id: 'p2',
          variant_id: null,
          quantity: 0,
          name: 'B',
          slug: 'b',
          price: 5,
          currency: '',
          image: null,
          saved_at: null,
        },
        {
          product_id: 'p3',
          variant_id: 'v3',
          quantity: 2,
          name: 'C',
          slug: 'c',
          price: 0,
          currency: 'RON',
          image: '/c.png',
          saved_at: '2021',
        },
        { product_id: '', slug: '', name: '', price: 'x' },
      ]),
    );
    const result = (cmp as any).loadSavedForLater();
    expect(result.length).toBe(3);
    expect(result[0].variant_id).toBe('v1');
    expect(result[0].image).toBe('/i.png');
    expect(result[1].variant_id).toBeNull();
    expect(result[1].quantity).toBe(1);
    expect(result[1].currency).toBe('RON');
    expect(result[1].image).toBe('');
    expect(result[2].price).toBe(0);
  });

  it('loadSavedForLater and persistSavedForLater no-op without localStorage (SSR)', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    try {
      Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });
      const { cmp } = create();
      expect((cmp as any).loadSavedForLater()).toEqual([]);
      cmp.savedForLater = [savedEntry()];
      expect(() => (cmp as any).persistSavedForLater()).not.toThrow();
    } finally {
      Object.defineProperty(window, 'localStorage', original);
    }
  });

  // ---- clearCart ----

  it('clearCart does nothing when not confirmed', () => {
    const { cmp } = create();
    spyOn(window, 'confirm').and.returnValue(false);
    cmp.clearCart();
    expect(cart.clear).not.toHaveBeenCalled();
  });

  it('clearCart clears state when confirmed', () => {
    const { cmp } = create();
    spyOn(window, 'confirm').and.returnValue(true);
    cmp.itemErrors['l1'] = 'e';
    cmp.promo = 'X';
    cmp.clearCart();
    expect(cart.clear).toHaveBeenCalled();
    expect(cmp.itemErrors).toEqual({});
    expect(cmp.promo).toBe('');
    expect(cmp.promoStatus).toBe('info');
  });

  // ---- moveToWishlist ----

  it('moveToWishlist returns early when unauthenticated', () => {
    const { cmp } = create();
    auth.isAuthenticated.and.returnValue(false);
    cmp.moveToWishlist(makeItem());
    expect(wishlist.add).not.toHaveBeenCalled();
  });

  it('moveToWishlist returns early when the item has no product id', () => {
    const { cmp } = create();
    cmp.moveToWishlist(makeItem({ product_id: '' }));
    expect(wishlist.add).not.toHaveBeenCalled();
  });

  it('moveToWishlist removes silently when already wishlisted', () => {
    const { cmp } = create();
    wishlist.isWishlisted.and.returnValue(true);
    cmp.moveToWishlist(makeItem({ id: 'l1', product_id: 'p1' }));
    expect(cart.remove).toHaveBeenCalledWith('l1');
    expect(toast.info).toHaveBeenCalled();
    expect(wishlist.add).not.toHaveBeenCalled();
  });

  it('moveToWishlist adds, removes and toasts on success', () => {
    const { cmp } = create();
    wishlist.add.and.returnValue(of({ id: 'p1' }));
    cmp.moveToWishlist(makeItem({ id: 'l1', product_id: 'p1' }));
    expect(wishlist.addLocal).toHaveBeenCalledWith({ id: 'p1' } as any);
    expect(cart.remove).toHaveBeenCalledWith('l1');
    expect(toast.success).toHaveBeenCalled();
    expect(cmp.movingToWishlist['l1']).toBeUndefined();
  });

  it('moveToWishlist surfaces the server detail message on error', () => {
    const { cmp } = create();
    wishlist.add.and.returnValue(throwError(() => ({ error: { detail: 'nope' } })));
    cmp.moveToWishlist(makeItem({ id: 'l1', product_id: 'p1' }));
    expect(toast.error).toHaveBeenCalledWith(jasmine.any(String), 'nope');
    expect(cmp.movingToWishlist['l1']).toBeUndefined();
  });

  it('moveToWishlist falls back to a translated message on error without detail', () => {
    const { cmp } = create();
    wishlist.add.and.returnValue(throwError(() => ({})));
    cmp.moveToWishlist(makeItem({ id: 'l1', product_id: 'p1' }));
    expect(toast.error).toHaveBeenCalledWith(jasmine.any(String), 'cart.moveToWishlistFailed');
  });

  // ---- loadRecommendations ----

  it('loadRecommendations filters cart products and caps at four', () => {
    const { cmp } = create();
    catalog.listProducts.and.returnValue(
      of({
        items: [
          { id: 'a' },
          { id: null },
          { id: 'inCart' },
          { id: 'b' },
          { id: 'c' },
          { id: 'd' },
          { id: 'e' },
        ],
      }),
    );
    (cmp as any).loadRecommendations(new Set(['inCart']));
    expect(cmp.recommendations.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(cmp.recommendationsLoading).toBeFalse();
  });

  it('loadRecommendations tolerates an empty response body', () => {
    const { cmp } = create();
    catalog.listProducts.and.returnValue(of(null));
    (cmp as any).loadRecommendations(new Set());
    expect(cmp.recommendations).toEqual([]);
  });

  it('loadRecommendations records an error on failure', () => {
    const { cmp } = create();
    catalog.listProducts.and.returnValue(throwError(() => ({})));
    (cmp as any).loadRecommendations(new Set());
    expect(cmp.recommendations).toEqual([]);
    expect(cmp.recommendationsError).toBe('cart.recommendationsError');
    expect(cmp.recommendationsLoading).toBeFalse();
  });

  // ---- promo ----

  it('clearPromo resets state and reloads the cart', () => {
    const { cmp } = create();
    cmp.promo = 'X';
    cmp.promoStatus = 'success';
    cmp.clearPromo();
    expect(cmp.promo).toBe('');
    expect(cmp.promoStatus).toBe('info');
    expect(cart.loadFromBackend).toHaveBeenCalled();
  });

  it('applyPromo clears when the code is empty', () => {
    const { cmp } = create();
    cmp.promo = '' as any;
    cmp.applyPromo();
    expect(cart.loadFromBackend).toHaveBeenCalled();
    expect(coupons.validate).not.toHaveBeenCalled();
  });

  it('applyPromo warns when unauthenticated', () => {
    const { cmp } = create();
    auth.isAuthenticated.and.returnValue(false);
    cmp.promo = 'save';
    cmp.applyPromo();
    expect(cmp.promoStatus).toBe('warn');
    expect(cmp.promoValid).toBeFalse();
    expect(cmp.promo).toBe('');
    expect(cart.loadFromBackend).toHaveBeenCalled();
  });

  it('applyPromo applies an eligible coupon and refreshes the quote', () => {
    const { cmp } = create();
    coupons.validate.and.returnValue(of({ eligible: true, coupon: { code: 'SAVE' }, reasons: [] }));
    cartApi.get.and.returnValue(of({ items: [], totals: {} }));
    cmp.promo = 'save';
    cmp.applyPromo();
    expect(cmp.promoStatus).toBe('success');
    expect(cart.hydrateFromBackend).toHaveBeenCalled();
    expect(cmp.promoApplying).toBeFalse();
  });

  it('applyPromo warns for an ineligible coupon and lists reasons', () => {
    const { cmp } = create();
    coupons.validate.and.returnValue(
      of({ eligible: false, coupon: { code: 'SAVE' }, reasons: ['min_total', 'special'] }),
    );
    const translate = TestBed.inject(TranslateService);
    spyOn(translate, 'instant').and.callFake((key: any) =>
      key === 'checkout.couponReasons.special' ? 'Special reason' : key,
    );
    cmp.promo = 'save';
    cmp.applyPromo();
    expect(cmp.promoStatus).toBe('warn');
    expect(cmp.promoValid).toBeFalse();
    expect(cmp.promoMessage).toContain('min_total');
    expect(cmp.promoMessage).toContain('Special reason');
    expect(cart.loadFromBackend).toHaveBeenCalled();
  });

  it('applyPromo uses the fallback message when an ineligible coupon has no reasons', () => {
    const { cmp } = create();
    coupons.validate.and.returnValue(
      of({ eligible: false, coupon: { code: 'SAVE' }, reasons: undefined }),
    );
    cmp.promo = 'save';
    cmp.applyPromo();
    expect(cmp.promoStatus).toBe('warn');
    expect(cmp.promoMessage).toContain('checkout.couponNotEligible');
  });

  it('applyPromo treats a 404 from validate as a free-text promo and refreshes', () => {
    const { cmp } = create();
    coupons.validate.and.returnValue(throwError(() => ({ status: 404 })));
    cartApi.get.and.returnValue(of({ items: [], totals: {} }));
    cmp.promo = 'save';
    cmp.applyPromo();
    expect(cmp.promoStatus).toBe('success');
    expect(cmp.appliedCouponOffer).toBeNull();
    expect(cart.hydrateFromBackend).toHaveBeenCalled();
  });

  it('applyPromo warns with the server detail on a non-404 validate error', () => {
    const { cmp } = create();
    coupons.validate.and.returnValue(throwError(() => ({ status: 500, error: { detail: 'boom' } })));
    cmp.promo = 'save';
    cmp.applyPromo();
    expect(cmp.promoStatus).toBe('warn');
    expect(cmp.promoMessage).toBe('boom');
    expect(cart.loadFromBackend).toHaveBeenCalled();
  });

  it('applyPromo warns with a translated fallback when validate fails without detail', () => {
    const { cmp } = create();
    coupons.validate.and.returnValue(throwError(() => ({ status: 500 })));
    cmp.promo = 'save';
    cmp.applyPromo();
    expect(cmp.promoStatus).toBe('warn');
    expect(cmp.promoMessage).toContain('checkout.promoPending');
  });

  // ---- refreshPromoQuote ----

  it('refreshPromoQuote hydrates the store on success', () => {
    const { cmp } = create();
    cartApi.get.and.returnValue(of({ items: [{}], totals: {} }));
    (cmp as any).refreshPromoQuote('SAVE');
    expect(cartApi.get).toHaveBeenCalledWith({ promo_code: 'SAVE' });
    expect(cart.hydrateFromBackend).toHaveBeenCalled();
  });

  it('refreshPromoQuote warns with detail on error', () => {
    const { cmp } = create();
    cartApi.get.and.returnValue(throwError(() => ({ error: { detail: 'bad' } })));
    (cmp as any).refreshPromoQuote('SAVE');
    expect(cmp.promoStatus).toBe('warn');
    expect(cmp.promoMessage).toBe('bad');
    expect(cmp.appliedCouponOffer).toBeNull();
    expect(cart.loadFromBackend).toHaveBeenCalled();
  });

  it('refreshPromoQuote warns with a translated fallback on error without detail', () => {
    const { cmp } = create();
    cartApi.get.and.returnValue(throwError(() => ({})));
    (cmp as any).refreshPromoQuote('SAVE');
    expect(cmp.promoStatus).toBe('warn');
    expect(cmp.promoMessage).toContain('checkout.promoPending');
  });

  // ---- effects ----

  it('recommendations effect skips loading without product ids', () => {
    items.set([]);
    const { fixture, cmp } = create();
    fixture.detectChanges();
    expect(catalog.listProducts).not.toHaveBeenCalled();
    expect(cmp.recommendations).toEqual([]);
  });

  it('recommendations effect loads and caches by product-id key', () => {
    items.set([makeItem({ product_id: 'p1' }), makeItem({ id: 'l2', product_id: '' })]);
    const { fixture } = create();
    fixture.detectChanges();
    expect(catalog.listProducts).toHaveBeenCalledTimes(1);

    // Same ids (new array reference) -> cache hit, no reload.
    items.set([makeItem({ product_id: 'p1' })]);
    fixture.detectChanges();
    expect(catalog.listProducts).toHaveBeenCalledTimes(1);

    // Different ids -> reload.
    items.set([makeItem({ product_id: 'p9' })]);
    fixture.detectChanges();
    expect(catalog.listProducts).toHaveBeenCalledTimes(2);
  });

  it('analytics effect tracks view_cart once when enabled with items', () => {
    analytics.enabled.and.returnValue(true);
    items.set([makeItem({ quantity: 2 }), makeItem({ id: 'l2', quantity: 0 })]);
    quote.set(makeQuote({ subtotal: 40, total: 40, currency: 'RON' }));
    subtotalSig.set(40);
    const { fixture } = create();
    fixture.detectChanges();
    expect(analytics.track).toHaveBeenCalledTimes(1);
    const payload = analytics.track.calls.mostRecent().args[1];
    expect(payload.line_items).toBe(2);
    expect(payload.units).toBe(2);

    // Subsequent changes do not re-track.
    items.set([makeItem({ quantity: 5 })]);
    fixture.detectChanges();
    expect(analytics.track).toHaveBeenCalledTimes(1);
  });

  it('analytics effect skips when syncing', () => {
    analytics.enabled.and.returnValue(true);
    syncing.set(true);
    items.set([makeItem()]);
    const { fixture } = create();
    fixture.detectChanges();
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it('analytics effect skips when there are no items', () => {
    analytics.enabled.and.returnValue(true);
    items.set([]);
    const { fixture } = create();
    fixture.detectChanges();
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it('promo-refresh effect re-fetches the quote once syncing settles', () => {
    syncing.set(true);
    const { fixture, cmp } = create();
    fixture.detectChanges();

    cmp.promoStatus = 'success';
    cmp.promo = 'SAVE';
    (cmp as any).pendingPromoRefresh = true;
    cartApi.get.and.returnValue(of({ items: [], totals: {} }));

    syncing.set(false);
    fixture.detectChanges();
    expect(cartApi.get).toHaveBeenCalledWith({ promo_code: 'SAVE' });
    expect((cmp as any).pendingPromoRefresh).toBeFalse();
  });

  it('promo-refresh effect bails out while syncing', () => {
    syncing.set(false);
    const { fixture, cmp } = create();
    fixture.detectChanges();
    cmp.promoStatus = 'success';
    cmp.promo = 'SAVE';
    (cmp as any).pendingPromoRefresh = true;

    syncing.set(true);
    fixture.detectChanges();
    expect(cartApi.get).not.toHaveBeenCalled();
  });

  it('promo-refresh effect bails out without a pending refresh, wrong status or empty code', () => {
    syncing.set(true);
    const { fixture, cmp } = create();
    fixture.detectChanges();

    // pending refresh false
    syncing.set(false);
    fixture.detectChanges();
    expect(cartApi.get).not.toHaveBeenCalled();

    // pending but wrong status
    (cmp as any).pendingPromoRefresh = true;
    cmp.promoStatus = 'info';
    syncing.set(true);
    fixture.detectChanges();
    syncing.set(false);
    fixture.detectChanges();
    expect(cartApi.get).not.toHaveBeenCalled();

    // pending, success, but empty code
    cmp.promoStatus = 'success';
    cmp.promo = '' as any;
    syncing.set(true);
    fixture.detectChanges();
    syncing.set(false);
    fixture.detectChanges();
    expect(cartApi.get).not.toHaveBeenCalled();
  });
});
