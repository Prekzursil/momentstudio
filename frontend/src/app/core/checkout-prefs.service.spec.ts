import { TestBed } from '@angular/core/testing';

import { CheckoutPrefsService } from './checkout-prefs.service';

describe('CheckoutPrefsService', () => {
  let service: CheckoutPrefsService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [CheckoutPrefsService] });
    service = TestBed.inject(CheckoutPrefsService);
    localStorage.clear();
  });

  afterEach(() => localStorage.clear());

  describe('delivery prefs', () => {
    it('returns null when nothing is stored', () => {
      expect(service.tryLoadDeliveryPrefs()).toBeNull();
    });

    it('returns defaults from loadDeliveryPrefs when nothing is stored', () => {
      expect(service.loadDeliveryPrefs()).toEqual({ courier: 'sameday', deliveryType: 'home' });
    });

    it('parses stored fan_courier + locker prefs', () => {
      localStorage.setItem(
        'checkout_delivery_prefs',
        JSON.stringify({ courier: 'fan_courier', deliveryType: 'locker' }),
      );
      expect(service.tryLoadDeliveryPrefs()).toEqual({
        courier: 'fan_courier',
        deliveryType: 'locker',
      });
    });

    it('falls back to defaults for unknown stored values', () => {
      localStorage.setItem(
        'checkout_delivery_prefs',
        JSON.stringify({ courier: 'other', deliveryType: 'other' }),
      );
      expect(service.tryLoadDeliveryPrefs()).toEqual({ courier: 'sameday', deliveryType: 'home' });
    });

    it('returns null on invalid JSON', () => {
      localStorage.setItem('checkout_delivery_prefs', 'not json');
      expect(service.tryLoadDeliveryPrefs()).toBeNull();
    });

    it('saves normalized delivery prefs', () => {
      service.saveDeliveryPrefs({ courier: 'fan_courier', deliveryType: 'locker' });
      expect(JSON.parse(localStorage.getItem('checkout_delivery_prefs') || '{}')).toEqual({
        courier: 'fan_courier',
        deliveryType: 'locker',
      });
    });

    it('normalizes unknown values on save', () => {
      service.saveDeliveryPrefs({ courier: 'x' as never, deliveryType: 'y' as never });
      expect(JSON.parse(localStorage.getItem('checkout_delivery_prefs') || '{}')).toEqual({
        courier: 'sameday',
        deliveryType: 'home',
      });
    });
  });

  describe('payment method', () => {
    it('returns null when nothing is stored', () => {
      expect(service.tryLoadPaymentMethod()).toBeNull();
    });

    it('returns each valid stored method', () => {
      for (const method of ['cod', 'netopia', 'paypal', 'stripe'] as const) {
        localStorage.setItem('checkout_payment_method', method);
        expect(service.tryLoadPaymentMethod()).toBe(method);
      }
    });

    it('returns null for an unknown stored method', () => {
      localStorage.setItem('checkout_payment_method', 'bitcoin');
      expect(service.tryLoadPaymentMethod()).toBeNull();
    });

    it('saves a valid method as-is', () => {
      service.savePaymentMethod('stripe');
      expect(localStorage.getItem('checkout_payment_method')).toBe('stripe');
    });

    it('normalizes an unknown method to cod', () => {
      service.savePaymentMethod('weird' as never);
      expect(localStorage.getItem('checkout_payment_method')).toBe('cod');
    });
  });

  describe('when localStorage is unavailable', () => {
    let original: PropertyDescriptor | undefined;

    beforeEach(() => {
      original = Object.getOwnPropertyDescriptor(window, 'localStorage');
      Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });
    });

    afterEach(() => {
      if (original) Object.defineProperty(window, 'localStorage', original);
    });

    it('returns null / defaults and is a no-op on save', () => {
      expect(service.tryLoadDeliveryPrefs()).toBeNull();
      expect(service.loadDeliveryPrefs()).toEqual({ courier: 'sameday', deliveryType: 'home' });
      expect(service.tryLoadPaymentMethod()).toBeNull();
      expect(() =>
        service.saveDeliveryPrefs({ courier: 'sameday', deliveryType: 'home' }),
      ).not.toThrow();
      expect(() => service.savePaymentMethod('cod')).not.toThrow();
    });
  });

  it('catches localStorage read errors for the payment method', () => {
    spyOn(Storage.prototype, 'getItem').and.throwError('blocked');
    expect(service.tryLoadPaymentMethod()).toBeNull();
  });
});
