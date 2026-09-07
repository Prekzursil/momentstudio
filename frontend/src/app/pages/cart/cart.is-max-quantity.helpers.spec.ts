import { CartComponent } from './cart.component';
import type { CartItem } from '../../core/cart.store';

/** Golden WU cart-is-max-qty — isMaxQuantity stock guard. */
describe('CartComponent isMaxQuantity (golden WU)', () => {
  function cmp() {
    return Object.create(CartComponent.prototype) as CartComponent;
  }

  it('is true when quantity meets positive stock', () => {
    expect(cmp().isMaxQuantity({ quantity: 5, stock: 5 } as CartItem)).toBeTrue();
  });

  it('is false when below stock or stock is zero', () => {
    expect(cmp().isMaxQuantity({ quantity: 3, stock: 5 } as CartItem)).toBeFalse();
    expect(cmp().isMaxQuantity({ quantity: 1, stock: 0 } as CartItem)).toBeFalse();
  });
});
