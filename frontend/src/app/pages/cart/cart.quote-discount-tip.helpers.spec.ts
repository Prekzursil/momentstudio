import { CartComponent } from './cart.component';
describe('CartComponent quoteDiscount tip (golden WU)', () => {
  function bare(q: any): CartComponent {
    const cmp = Object.create(CartComponent.prototype) as CartComponent;
    Object.assign(cmp as any, { quote: () => q });
    return cmp;
  }
  it('computes non-negative discount from quote parts', () => {
    expect(bare({ subtotal: 100, fee: 0, tax: 0, shipping: 10, total: 90 }).quoteDiscount()).toBe(20);
    expect(bare({ subtotal: 50, fee: 0, tax: 0, shipping: 0, total: 60 }).quoteDiscount()).toBe(0);
  });
});
