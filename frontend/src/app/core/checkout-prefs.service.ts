import { Injectable } from '@angular/core';
import { LockerProvider } from './shipping.service';

export type CheckoutDeliveryType = 'home' | 'locker';

export interface CheckoutDeliveryPrefs {
  courier: LockerProvider;
  deliveryType: CheckoutDeliveryType;
}

const DELIVERY_PREFS_KEY = 'checkout_delivery_prefs';

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
}
