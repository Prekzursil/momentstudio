import { ProductComponent } from './product.component';
/** Tip orphan — displayPrice base (2026-09-07T09:58:49Z). */
describe('ProductComponent displayPrice base helpers (golden WU)', () => {
  it('uses base when not on sale', () => {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    expect(cmp.displayPrice({ base_price: 42, sale_price: null } as any)).toBe(42);
  });
});
