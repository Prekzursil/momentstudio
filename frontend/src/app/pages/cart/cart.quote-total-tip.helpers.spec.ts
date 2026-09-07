import { CartComponent } from './cart.component';
describe('CartComponent quoteTotal tip (golden WU)', () => {
  function bare(q: any, sub: number): CartComponent {
    const cmp = Object.create(CartComponent.prototype) as CartComponent;
    Object.assign(cmp as any, { quote: () => q, subtotal: () => sub });
    return cmp;
  }
  it('prefers finite quote total else subtotal', () => {
    expect(bare({ total: 42 }, 10).quoteTotal()).toBe(42);
  });
});
