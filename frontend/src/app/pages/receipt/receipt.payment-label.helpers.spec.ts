import { ReceiptComponent } from './receipt.component';

/** Tip orphan mint — ReceiptComponent.paymentMethodLabel (2026-09-07T07:33:00Z). */
describe('ReceiptComponent paymentMethodLabel (golden WU)', () => {
  function bare(receipt: unknown): ReceiptComponent {
    const cmp = Object.create(ReceiptComponent.prototype) as ReceiptComponent;
    Object.assign(cmp as any, { receipt });
    return cmp;
  }

  it('paymentMethodLabel maps known methods and uppercases unknown', () => {
    expect(bare(null).paymentMethodLabel()).toBe('');
    expect(bare({ payment_method: ' stripe ' }).paymentMethodLabel()).toBe('Stripe');
    expect(bare({ payment_method: 'PayPal' }).paymentMethodLabel()).toBe('PayPal');
    expect(bare({ payment_method: 'netopia' }).paymentMethodLabel()).toBe('Netopia');
    expect(bare({ payment_method: 'cod' }).paymentMethodLabel()).toBe('Cash / Numerar');
    expect(bare({ payment_method: 'wire' }).paymentMethodLabel()).toBe('WIRE');
  });
});
