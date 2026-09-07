import { ReceiptComponent } from './receipt.component';
/** Tip orphan — paymentMethodLabel paypal (2026-09-07T13:00:55Z). */
describe('ReceiptComponent paymentMethodLabel paypal helpers (golden WU)', () => {
  it('maps paypal', () => {
    const cmp = Object.create(ReceiptComponent.prototype) as ReceiptComponent;
    Object.assign(cmp as any, { receipt: { payment_method: 'paypal' } });
    expect(cmp.paymentMethodLabel()).toBe('PayPal');
  });
});
