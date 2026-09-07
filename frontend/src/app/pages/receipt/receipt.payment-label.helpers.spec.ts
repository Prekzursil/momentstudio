import { ReceiptComponent } from './receipt.component';

/** Golden WU tip orphan — paymentMethodLabel. */
describe('ReceiptComponent paymentMethodLabel (golden WU)', () => {
  function bare(method: string | null): ReceiptComponent {
    const cmp = Object.create(ReceiptComponent.prototype) as ReceiptComponent;
    (cmp as any).receipt = method === null ? null : { payment_method: method };
    return cmp;
  }

  it('maps known methods and uppercases unknowns', () => {
    expect(bare(null).paymentMethodLabel()).toBe('');
    expect(bare('stripe').paymentMethodLabel()).toBe('Stripe');
    expect(bare('paypal').paymentMethodLabel()).toBe('PayPal');
    expect(bare('netopia').paymentMethodLabel()).toBe('Netopia');
    expect(bare('cod').paymentMethodLabel()).toBe('Cash / Numerar');
    expect(bare('wire').paymentMethodLabel()).toBe('WIRE');
  });
});
