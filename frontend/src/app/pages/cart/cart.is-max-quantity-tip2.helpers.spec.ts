import { CartComponent } from './cart.component';

describe('CartComponent isMaxQuantity tip2', () => {
  it('exposes helper', () => {
    const c = Object.create(CartComponent.prototype) as CartComponent;
    expect(typeof c.isMaxQuantity).toBe('function');
  });
});
