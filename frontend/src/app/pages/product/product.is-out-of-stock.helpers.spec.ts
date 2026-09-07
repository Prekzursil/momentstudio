import { ProductComponent } from './product.component';

describe('ProductComponent isOutOfStock tip', () => {
  it('true when stock 0', () => {
    const c = Object.create(ProductComponent.prototype) as ProductComponent;
    (c as any).product = () => ({ stock: 0 });
    expect(c.isOutOfStock()).toBe(true);
  });
  it('false when stock positive', () => {
    const c = Object.create(ProductComponent.prototype) as ProductComponent;
    (c as any).product = () => ({ stock: 3 });
    expect(c.isOutOfStock()).toBe(false);
  });
});
