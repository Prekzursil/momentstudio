import { CartComponent } from './cart.component';

/** Golden WU tip orphan — currency getter. */
describe('CartComponent currency (golden WU)', () => {
  function bare(overrides: Record<string, unknown> = {}): CartComponent {
    const cmp = Object.create(CartComponent.prototype) as CartComponent;
    Object.assign(cmp as any, {
      quote: () => ({}),
      items: () => [],
      ...overrides,
    });
    return cmp;
  }

  it('prefers quote currency, then item currency, then RON', () => {
    expect(bare({ quote: () => ({ currency: 'EUR' }) }).currency).toBe('EUR');
    expect(
      bare({ quote: () => ({}), items: () => [{ currency: 'USD' }] }).currency,
    ).toBe('USD');
    expect(bare().currency).toBe('RON');
  });
});
