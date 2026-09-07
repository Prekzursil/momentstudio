import { ReceiptComponent } from './receipt.component';
/** Tip orphan — paymentMethodLabel stripe (2026-09-07T11:17:37Z). */
describe('ReceiptComponent paymentMethodLabel stripe helpers (golden WU)', () => {
  it('maps stripe', () => {
    const cmp = Object.create(ReceiptComponent.prototype) as ReceiptComponent;
    Object.assign(cmp as any, { receipt: { payment_method: 'stripe' } });
    expect(cmp.paymentMethodLabel()).toBe('Stripe');
  });
});
