import { ProductComponent } from './product.component';

/** Tip orphan mint — ProductComponent.displayPrice (2026-09-07T07:34:20Z). */
describe('ProductComponent displayPrice (golden WU)', () => {
  function bare(): ProductComponent {
    return Object.create(ProductComponent.prototype) as ProductComponent;
  }

  it('displayPrice uses sale when on sale else base', () => {
    const cmp = bare();
    expect(cmp.displayPrice({ base_price: 100, sale_price: 75 } as any)).toBe(75);
    expect(cmp.displayPrice({ base_price: 100, sale_price: null } as any)).toBe(100);
  });
});
