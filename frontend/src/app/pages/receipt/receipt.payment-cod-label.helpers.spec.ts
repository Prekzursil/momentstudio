import { ReceiptComponent } from './receipt.component';

/** Golden WU tip orphan — paymentMethodLabel cod branch. */
describe('ReceiptComponent paymentMethodLabel (golden WU)', () => {
  function bare(method: string): ReceiptComponent {
    const cmp = Object.create(ReceiptComponent.prototype) as ReceiptComponent;
    Object.assign(cmp as any, { receipt: { payment_method: method } });
    return cmp;
  }

  it('labels known payment methods', () => {
    expect(bare('cod').paymentMethodLabel()).toBe('Cash / Numerar');
    expect(bare('stripe').paymentMethodLabel()).toBe('Stripe');
    expect(bare('').paymentMethodLabel()).toBe('');
  });
});
