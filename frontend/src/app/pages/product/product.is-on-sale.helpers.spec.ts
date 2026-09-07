import { ProductComponent } from './product.component';
import type { Product } from '../../core/catalog.service';

/** Golden WU product-onsale-price — isOnSale / displayPrice arms. */
describe('ProductComponent isOnSale (golden WU)', () => {
  function cmp() {
    return Object.create(ProductComponent.prototype) as ProductComponent;
  }

  it('detects finite sale price below base', () => {
    const onSale = { base_price: 100, sale_price: 80 } as Product;
    expect(cmp().isOnSale(onSale)).toBeTrue();
    expect(cmp().displayPrice(onSale)).toBe(80);
  });

  it('rejects missing or higher sale prices', () => {
    const regular = { base_price: 100, sale_price: null } as Product;
    expect(cmp().isOnSale(regular)).toBeFalse();
    expect(cmp().displayPrice(regular)).toBe(100);
  });
});
