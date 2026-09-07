import { CartComponent } from './cart.component';

/** Golden WU tip orphan — stepQuantity. */
describe('CartComponent stepQuantity (golden WU)', () => {
  function bare(): CartComponent {
    const cmp = Object.create(CartComponent.prototype) as CartComponent;
    spyOn(cmp, 'onQuantityChange');
    return cmp;
  }

  it('forwards id and quantity+delta to onQuantityChange', () => {
    const cmp = bare();
    cmp.stepQuantity({ id: 'i1', quantity: 2 } as any, 1);
    expect(cmp.onQuantityChange).toHaveBeenCalledWith('i1', 3);
    cmp.stepQuantity({ id: 'i1', quantity: 2 } as any, -1);
    expect(cmp.onQuantityChange).toHaveBeenCalledWith('i1', 1);
  });
});
