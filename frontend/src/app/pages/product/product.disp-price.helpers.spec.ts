import { ProductComponent } from './product.component';

/** Tip orphan mint — ProductComponent.displayPrice (2026-09-07T07:54:52Z). */
describe('ProductComponent displayPrice disp-price helpers (golden WU)', () => {
  function bare(): ProductComponent {
    return Object.create(ProductComponent.prototype) as ProductComponent;
  }

  it('returns sale when on sale else base_price', () => {
    const cmp = bare();
    expect(cmp.displayPrice({ base_price: 20, sale_price: 15 } as any)).toBe(15);
    expect(cmp.displayPrice({ base_price: 20, sale_price: 25 } as any)).toBe(20);
  });
});
