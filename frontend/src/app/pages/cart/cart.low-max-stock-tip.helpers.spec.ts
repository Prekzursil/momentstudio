import { CartComponent } from './cart.component';
describe('CartComponent isLowStock / isMaxQuantity tip (golden WU)', () => {
  function bare(): CartComponent { return Object.create(CartComponent.prototype) as CartComponent; }
  it('flags low stock and max quantity', () => {
    expect(bare().isLowStock({ stock: 2, quantity: 1 } as any)).toBe(true);
    expect(bare().isLowStock({ stock: 5, quantity: 1 } as any)).toBe(false);
    expect(bare().isMaxQuantity({ stock: 2, quantity: 2 } as any)).toBe(true);
    expect(bare().isMaxQuantity({ stock: 2, quantity: 1 } as any)).toBe(false);
  });
});
