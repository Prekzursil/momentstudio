import { ProductComponent } from './product.component';
/** Tip orphan — isOnSale finite (2026-09-07T13:00:55Z). */
describe('ProductComponent isOnSale finite helpers (golden WU)', () => {
  it('rejects NaN sale_price', () => {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    expect(cmp.isOnSale({ base_price: 3, sale_price: Number.NaN } as any)).toBe(false);
  });
});
