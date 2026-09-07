import { CartComponent } from './cart.component';

/** Golden WU cart-currency-getter — currency getter precedence. */
describe('CartComponent currency getter (golden WU)', () => {
  function createCmp(quoteCurrency: string | null, itemCurrency?: string) {
    const cmp = Object.create(CartComponent.prototype) as CartComponent;
    (cmp as any).quote = () => ({ currency: quoteCurrency });
    (cmp as any).items = () => (itemCurrency ? [{ currency: itemCurrency }] : []);
    return cmp;
  }

  it('prefers quote currency', () => {
    expect(createCmp('EUR', 'USD').currency).toBe('EUR');
  });

  it('falls back to first item currency', () => {
    expect(createCmp(null, 'USD').currency).toBe('USD');
  });

  it('defaults to RON when nothing else is available', () => {
    expect(createCmp(null).currency).toBe('RON');
  });
});
