import { ProductComponent } from './product.component';

/** Golden WU tip orphan — displayPrice. */
describe('ProductComponent displayPrice (golden WU)', () => {
  function bare(): ProductComponent {
    const cmp = Object.create(ProductComponent.prototype) as ProductComponent;
    return cmp;
  }

  it('uses sale_price when on sale, otherwise base_price', () => {
    const cmp = bare();
    spyOn(cmp, 'isOnSale').and.returnValues(true, false);
    expect(cmp.displayPrice({ sale_price: 10, base_price: 20 } as any)).toBe(10);
    expect(cmp.displayPrice({ sale_price: 10, base_price: 20 } as any)).toBe(20);
  });
});
