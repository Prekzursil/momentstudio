import { CartComponent } from './cart.component';

/** Golden WU tip orphan — isMaxQuantity. */
describe('CartComponent isMaxQuantity (golden WU)', () => {
  function bare(): CartComponent {
    return Object.create(CartComponent.prototype) as CartComponent;
  }

  it('is true only when stock is positive and quantity meets stock', () => {
    expect(bare().isMaxQuantity({ stock: 2, quantity: 2 } as any)).toBe(true);
    expect(bare().isMaxQuantity({ stock: 2, quantity: 1 } as any)).toBe(false);
    expect(bare().isMaxQuantity({ stock: 0, quantity: 5 } as any)).toBe(false);
  });
});
