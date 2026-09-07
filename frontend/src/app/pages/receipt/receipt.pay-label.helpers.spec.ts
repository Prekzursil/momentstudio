import { ReceiptComponent } from './receipt.component';

/** Tip orphan mint — ReceiptComponent.paymentMethodLabel (2026-09-07T07:50:32Z). */
describe('ReceiptComponent paymentMethodLabel pay-label helpers (golden WU)', () => {
  function bare(receipt: unknown): ReceiptComponent {
    const cmp = Object.create(ReceiptComponent.prototype) as ReceiptComponent;
    Object.assign(cmp as any, { receipt });
    return cmp;
  }

  it('maps stripe/paypal/netopia/cod and uppercases unknown', () => {
    expect(bare({ payment_method: 'stripe' }).paymentMethodLabel()).toBe('Stripe');
    expect(bare({ payment_method: 'paypal' }).paymentMethodLabel()).toBe('PayPal');
    expect(bare({ payment_method: 'netopia' }).paymentMethodLabel()).toBe('Netopia');
    expect(bare({ payment_method: 'cod' }).paymentMethodLabel()).toBe('Cash / Numerar');
    expect(bare({ payment_method: 'foo' }).paymentMethodLabel()).toBe('FOO');
    expect(bare(null).paymentMethodLabel()).toBe('');
  });
});
