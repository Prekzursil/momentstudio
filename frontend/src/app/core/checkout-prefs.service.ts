import { Injectable } from '@angular/core';
import { LockerProvider } from './shipping.service';

export type CheckoutDeliveryType = 'home' | 'locker';
export type CheckoutPaymentMethod = 'cod' | 'netopia' | 'paypal' | 'stripe';

export interface CheckoutDeliveryPrefs {
  courier: LockerProvider;
  deliveryType: CheckoutDeliveryType;
}

const DELIVERY_PREFS_KEY = 'checkout_delivery_prefs';
const PAYMENT_PREFS_KEY = 'checkout_payment_method';

@Injectable({ providedIn: 'root' })
export class CheckoutPrefsService {
  tryLoadDeliveryPrefs(): CheckoutDeliveryPrefs | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    try {
      const raw = localStorage.getItem(DELIVERY_PREFS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as any;
      const courier: LockerProvider = parsed?.courier === 'fan_courier' ? 'fan_courier' : 'sameday';
      const deliveryType: CheckoutDeliveryType = parsed?.deliveryType === 'locker' ? 'locker' : 'home';
      return { courier, deliveryType };
    } catch {
      return null;
    }
  }

  loadDeliveryPrefs(): CheckoutDeliveryPrefs {
    return this.tryLoadDeliveryPrefs() ?? { courier: 'sameday', deliveryType: 'home' };
  }

  saveDeliveryPrefs(prefs: CheckoutDeliveryPrefs): void {
    if (typeof localStorage === 'undefined') return;
    const courier: LockerProvider = prefs.courier === 'fan_courier' ? 'fan_courier' : 'sameday';
    const deliveryType: CheckoutDeliveryType = prefs.deliveryType === 'locker' ? 'locker' : 'home';
    localStorage.setItem(DELIVERY_PREFS_KEY, JSON.stringify({ courier, deliveryType }));
  }

  tryLoadPaymentMethod(): CheckoutPaymentMethod | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = (localStorage.getItem(PAYMENT_PREFS_KEY) || '').trim();
      if (raw === 'cod' || raw === 'netopia' || raw === 'paypal' || raw === 'stripe') return raw;
      return null;
    } catch {
      return null;
    }
  }

  savePaymentMethod(method: CheckoutPaymentMethod): void {
    if (typeof localStorage === 'undefined') return;
    const value: CheckoutPaymentMethod = method === 'netopia' || method === 'paypal' || method === 'stripe' ? method : 'cod';
    localStorage.setItem(PAYMENT_PREFS_KEY, value);
  }
}
