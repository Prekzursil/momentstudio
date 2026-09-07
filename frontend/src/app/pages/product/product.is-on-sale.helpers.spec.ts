import { ProductComponent } from './product.component';

/** Tip orphan mint — ProductComponent.isOnSale (2026-09-07T07:33:00Z). */
describe('ProductComponent isOnSale (golden WU)', () => {
  function bare(): ProductComponent {
    return Object.create(ProductComponent.prototype) as ProductComponent;
  }

  it('isOnSale requires finite sale_price below base_price', () => {
    const cmp = bare();
    expect(cmp.isOnSale({ base_price: 100, sale_price: 80 } as any)).toBe(true);
    expect(cmp.isOnSale({ base_price: 100, sale_price: 100 } as any)).toBe(false);
    expect(cmp.isOnSale({ base_price: 100, sale_price: null } as any)).toBe(false);
    expect(cmp.isOnSale({ base_price: 100, sale_price: Number.NaN } as any)).toBe(false);
  });
});
