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

describe('CartComponent clear / promo / deliveryType helpers (golden WU)', () => {
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

  const saveDeliveryPrefs = jasmine.createSpy('saveDeliveryPrefs');

  const cartStub = {
    items: itemsSig.asReadonly(),
    quote: quoteSig.asReadonly(),
    subtotal: subtotalSig.asReadonly(),
    syncing: syncingSig.asReadonly(),
    loadFromBackend: jasmine.createSpy('loadFromBackend'),
    updateQuantity: jasmine.createSpy('updateQuantity').and.returnValue({}),
    remove: jasmine.createSpy('remove'),
    clear: jasmine.createSpy('clear'),
  };

  beforeEach(() => {
    itemsSig.set([]);
    subtotalSig.set(0);
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
    cartStub.clear.calls.reset();
    saveDeliveryPrefs.calls.reset();

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
            saveDeliveryPrefs,
          },
        },
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap({})) },
        },
        { provide: AnalyticsService, useValue: { track: () => {}, enabled: () => false } },
      ],
    });
  });

  function createCmp(): CartComponent {
    return TestBed.createComponent(CartComponent).componentInstance;
  }

  it('setDeliveryType updates deliveryType and persists checkout prefs', () => {
    const cmp = createCmp();
    cmp.courier = 'fan_courier';
    cmp.deliveryType = 'home';

    cmp.setDeliveryType('locker');

    expect(cmp.deliveryType).toBe('locker');
    expect(saveDeliveryPrefs).toHaveBeenCalledWith({
      courier: 'fan_courier',
      deliveryType: 'locker',
    });
  });

  it('clearPromo resets promo fields and reloads cart from backend', () => {
    const cmp = createCmp();
    cmp.promo = 'SAVE10';
    cmp.promoMessage = 'applied';
    cmp.promoStatus = 'success';
    cmp.promoValid = false;
    cmp.appliedCouponOffer = { eligible: true } as any;

    cmp.clearPromo();

    expect(cmp.promo).toBe('');
    expect(cmp.promoMessage).toBe('');
    expect(cmp.promoStatus).toBe('info');
    expect(cmp.promoValid).toBeTrue();
    expect(cmp.appliedCouponOffer).toBeNull();
    expect(cartStub.loadFromBackend).toHaveBeenCalled();
  });

  it('clearCart confirms before clearing store state and skips when cancelled', () => {
    const cmp = createCmp();
    cmp.promo = 'X';
    cmp.promoStatus = 'warn';
    cmp.itemErrors = { i1: 'cart.outOfStock' };
    cmp.movingToWishlist = { i1: true };

    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    cmp.clearCart();
    expect(cartStub.clear).not.toHaveBeenCalled();
    expect(cmp.promo).toBe('X');
    expect(cmp.itemErrors).toEqual({ i1: 'cart.outOfStock' });

    confirmSpy.and.returnValue(true);
    cmp.clearCart();
    expect(cartStub.clear).toHaveBeenCalled();
    expect(cmp.itemErrors).toEqual({});
    expect(cmp.movingToWishlist).toEqual({});
    expect(cmp.promo).toBe('');
    expect(cmp.promoStatus).toBe('info');
    expect(cmp.promoValid).toBeTrue();
    expect(cmp.appliedCouponOffer).toBeNull();
  });
});
