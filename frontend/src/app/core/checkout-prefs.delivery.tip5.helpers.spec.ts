import { CheckoutPrefsService } from './checkout-prefs.service';

/** Golden WU tip orphan — CheckoutPrefsService.tryLoadDeliveryPrefs. */
describe('CheckoutPrefsService delivery prefs (golden WU tip5)', () => {
  function bare(): CheckoutPrefsService {
    return Object.create(CheckoutPrefsService.prototype) as CheckoutPrefsService;
  }

  it('normalizes saved delivery prefs from localStorage', () => {
    localStorage.setItem('checkout_delivery_prefs', JSON.stringify({ courier: 'fan_courier', deliveryType: 'locker' }));
    const svc = bare();
    expect(CheckoutPrefsService.prototype.tryLoadDeliveryPrefs.call(svc)).toEqual({
      courier: 'fan_courier',
      deliveryType: 'locker',
    });
    localStorage.removeItem('checkout_delivery_prefs');
  });
});
