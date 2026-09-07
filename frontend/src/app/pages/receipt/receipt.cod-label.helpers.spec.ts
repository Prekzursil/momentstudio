import { ReceiptComponent } from './receipt.component';
/** Tip orphan — paymentMethodLabel COD (2026-09-07T09:58:49Z). */
describe('ReceiptComponent paymentMethodLabel COD helpers (golden WU)', () => {
  it('maps cod', () => {
    const cmp = Object.create(ReceiptComponent.prototype) as ReceiptComponent;
    Object.assign(cmp as any, { receipt: { payment_method: 'cod' } });
    expect(cmp.paymentMethodLabel()).toBe('Cash / Numerar');
  });
});
