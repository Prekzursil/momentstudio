import { CartComponent } from './cart.component';

/** Golden WU cart-delivery-type-save — setDeliveryType persists prefs. */
describe('CartComponent setDeliveryType (golden WU)', () => {
  it('updates deliveryType and saves checkout prefs', () => {
    const cmp = Object.create(CartComponent.prototype) as CartComponent;
    const save = jasmine.createSpy('saveDeliveryPrefs');
    (cmp as any).checkoutPrefs = { saveDeliveryPrefs: save };
    (cmp as any).courier = 'fan';
    cmp.deliveryType = 'home';
    cmp.setDeliveryType('locker');
    expect(cmp.deliveryType).toBe('locker');
    expect(save).toHaveBeenCalledWith({ courier: 'fan', deliveryType: 'locker' });
  });
});
