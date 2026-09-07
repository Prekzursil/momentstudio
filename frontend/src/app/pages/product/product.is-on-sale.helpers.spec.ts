import { ProductComponent } from './product.component';

describe('ProductComponent isOnSale tip', () => {
  it('true when compareAt > price', () => {
    const c = Object.create(ProductComponent.prototype) as ProductComponent;
    expect(c.isOnSale({ price: 10, compareAtPrice: 20 } as any)).toBe(true);
  });
});
