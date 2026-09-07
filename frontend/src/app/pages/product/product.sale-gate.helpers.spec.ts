import { ProductComponent } from './product.component';

/** Tip orphan mint — isOnSale gate (2026-09-07T09:05:48Z). */
describe('ProductComponent isOnSale gate helpers (golden WU)', () => {
  function bare(): ProductComponent {
    return Object.create(ProductComponent.prototype) as ProductComponent;
  }
  it('rejects non-finite sale prices', () => {
    expect(bare().isOnSale({ base_price: 5, sale_price: Infinity } as any)).toBe(false);
    expect(bare().isOnSale({ base_price: 5, sale_price: 4 } as any)).toBe(true);
  });
});
