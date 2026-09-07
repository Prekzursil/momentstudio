import { CheckoutPrefsService } from './checkout-prefs.service';

/** Golden WU tip orphan — CheckoutPrefsService.tryLoadPaymentMethod. */
describe('CheckoutPrefsService payment method (golden WU tip5)', () => {
  function bare(): CheckoutPrefsService {
    return Object.create(CheckoutPrefsService.prototype) as CheckoutPrefsService;
  }

  it('reads supported payment methods from localStorage', () => {
    localStorage.setItem('checkout_payment_method', 'stripe');
    const svc = bare();
    expect(CheckoutPrefsService.prototype.tryLoadPaymentMethod.call(svc)).toBe('stripe');
    localStorage.removeItem('checkout_payment_method');
  });
});
