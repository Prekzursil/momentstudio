import { ProductComponent } from './product.component';
/** Tip orphan — isOnSale lt (2026-09-07T11:17:37Z). */
describe('ProductComponent isOnSale lt helpers (golden WU)', () => {
  it('sale equal base is false', () => {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    expect(cmp.isOnSale({ base_price: 9, sale_price: 9 } as any)).toBe(false);
  });
});
