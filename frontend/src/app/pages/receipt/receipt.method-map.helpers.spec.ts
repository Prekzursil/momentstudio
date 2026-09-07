import { ReceiptComponent } from './receipt.component';

/** Tip orphan mint — ReceiptComponent.paymentMethodLabel map (2026-09-07T08:32:17Z). */
describe('ReceiptComponent paymentMethodLabel map helpers (golden WU)', () => {
  function bare(method: string | null): ReceiptComponent {
    const cmp = Object.create(ReceiptComponent.prototype) as ReceiptComponent;
    Object.assign(cmp as any, { receipt: method == null ? null : { payment_method: method } });
    return cmp;
  }

  it('maps known gateways', () => {
    expect(bare('STRIPE').paymentMethodLabel()).toBe('Stripe');
    expect(bare('PayPal').paymentMethodLabel()).toBe('PayPal');
    expect(bare('').paymentMethodLabel()).toBe('');
  });
});
