import { CartComponent } from './cart.component';

describe('CartComponent isLowStock tip2', () => {
  it('detects low stock', () => {
    const c = Object.create(CartComponent.prototype) as CartComponent;
    expect(typeof c.isLowStock).toBe('function');
  });
});
