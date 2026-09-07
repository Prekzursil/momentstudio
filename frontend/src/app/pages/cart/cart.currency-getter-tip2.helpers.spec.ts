import { CartComponent } from './cart.component';

describe('CartComponent currency tip2', () => {
  it('exposes currency getter', () => {
    const c = Object.create(CartComponent.prototype) as CartComponent;
    const desc = Object.getOwnPropertyDescriptor(CartComponent.prototype, 'currency');
    expect(desc && typeof desc.get).toBe('function');
  });
});
