import { ProductComponent } from './product.component';

/** Tip orphan mint — ProductComponent sale/display helpers (2026-09-07T07:36:38Z). */
describe('ProductComponent sale/display helpers (golden WU)', () => {
  function bare(): ProductComponent {
    return Object.create(ProductComponent.prototype) as ProductComponent;
  }

  it('isOnSale and displayPrice agree on sale vs base', () => {
    const cmp = bare();
    const onSale = { base_price: 50, sale_price: 40 } as any;
    const notSale = { base_price: 50, sale_price: 60 } as any;
    expect(cmp.isOnSale(onSale)).toBe(true);
    expect(cmp.displayPrice(onSale)).toBe(40);
    expect(cmp.isOnSale(notSale)).toBe(false);
    expect(cmp.displayPrice(notSale)).toBe(50);
  });
});
