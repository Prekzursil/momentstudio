import { ProductComponent } from './product.component';

/** Golden WU product-stock-out — isOutOfStock stock/backorder arms. */
describe('ProductComponent isOutOfStock (golden WU)', () => {
  function cmp() {
    return Object.create(ProductComponent.prototype) as ProductComponent;
  }

  it('returns false when product is missing', () => {
    const c = cmp();
    c.product = null;
    expect(c.isOutOfStock()).toBeFalse();
  });

  it('returns true for zero stock without backorder', () => {
    const c = cmp();
    c.product = { stock_quantity: 0, allow_backorder: false, variants: [] } as any;
    expect(c.isOutOfStock()).toBeTrue();
  });

  it('returns false when backorder is allowed', () => {
    const c = cmp();
    c.product = { stock_quantity: 0, allow_backorder: true, variants: [] } as any;
    expect(c.isOutOfStock()).toBeFalse();
  });
});
