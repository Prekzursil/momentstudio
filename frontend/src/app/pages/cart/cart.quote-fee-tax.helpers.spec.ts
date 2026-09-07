import { CartComponent } from './cart.component';

/** Golden WU tip orphan — quoteFee / quoteTax / quoteShipping. */
describe('CartComponent quote fee/tax/shipping (golden WU)', () => {
  function bare(q: Record<string, unknown>): CartComponent {
    const cmp = Object.create(CartComponent.prototype) as CartComponent;
    Object.assign(cmp as any, { quote: () => q });
    return cmp;
  }

  it('returns fee/tax/shipping with zero defaults', () => {
    const cmp = bare({ fee: 3, tax: 2, shipping: 15 });
    expect(cmp.quoteFee()).toBe(3);
    expect(cmp.quoteTax()).toBe(2);
    expect(cmp.quoteShipping()).toBe(15);
    const empty = bare({});
    expect(empty.quoteFee()).toBe(0);
    expect(empty.quoteTax()).toBe(0);
    expect(empty.quoteShipping()).toBe(0);
  });
});
