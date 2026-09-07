import { ProductComponent } from './product.component';

/** Tip orphan mint — ProductComponent.isOnSale (2026-09-07T07:54:52Z). */
describe('ProductComponent isOnSale onsale helpers (golden WU)', () => {
  function bare(): ProductComponent {
    return Object.create(ProductComponent.prototype) as ProductComponent;
  }

  it('true only when finite sale_price < base_price', () => {
    const cmp = bare();
    expect(cmp.isOnSale({ base_price: 10, sale_price: 9 } as any)).toBe(true);
    expect(cmp.isOnSale({ base_price: 10, sale_price: 11 } as any)).toBe(false);
    expect(cmp.isOnSale({ base_price: 10 } as any)).toBe(false);
  });
});
