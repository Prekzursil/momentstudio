import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { FxRatesService } from '../../core/fx-rates.service';
import { ReceiptRead, ReceiptService } from '../../core/receipt.service';
import { ReceiptComponent } from './receipt.component';

class FxRatesServiceStub {
  snap = { base: 'RON', eurPerRon: 0.2, usdPerRon: 0.22, loaded: true };
  ensureLoaded(): void {}
  get snapshot() {
    return this.snap;
  }
}

function makeReceipt(overrides: Partial<ReceiptRead> = {}): ReceiptRead {
  return {
    order_id: 'order-1',
    reference_code: 'REF-123',
    status: 'paid',
    created_at: '2026-01-01T10:00:00Z',
    currency: 'RON',
    payment_method: 'stripe',
    courier: 'DPD',
    delivery_type: 'courier',
    tracking_number: 'AWB-9',
    customer_email: 'a@b.com',
    customer_name: 'Alice',
    pii_redacted: false,
    shipping_amount: 10,
    tax_amount: 5,
    fee_amount: 2,
    total_amount: 117,
    shipping_address: {
      line1: 'Str. A 1',
      line2: 'Ap 2',
      city: 'Cluj',
      region: 'CJ',
      postal_code: '400000',
      country: 'RO',
    },
    billing_address: {
      line1: 'Str. B 3',
      city: 'Cluj',
      postal_code: '400001',
      country: 'RO',
    },
    items: [
      {
        product_id: 'p1',
        slug: 'prod-1',
        name: 'Product One',
        quantity: 2,
        unit_price: 50,
        subtotal: 100,
      },
    ],
    refunds: [
      {
        amount: 5,
        currency: 'RON',
        provider: 'stripe',
        note: 'partial',
        created_at: '2026-01-02T10:00:00Z',
      },
    ],
    ...overrides,
  };
}

describe('ReceiptComponent', () => {
  let receipts: jasmine.SpyObj<ReceiptService>;
  let paramMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  function setup() {
    receipts = jasmine.createSpyObj<ReceiptService>('ReceiptService', ['getByToken', 'pdfUrl']);
    receipts.pdfUrl.and.callFake(
      (token: string, opts?: { reveal?: boolean }) =>
        `https://api/orders/receipt/${token}/pdf${opts?.reveal ? '?reveal=true' : ''}`,
    );
    receipts.getByToken.and.returnValue(of(makeReceipt()));
    paramMap$ = new BehaviorSubject(convertToParamMap({ token: 'tok-1' }));

    TestBed.configureTestingModule({
      imports: [RouterTestingModule, ReceiptComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ReceiptService, useValue: receipts },
        { provide: FxRatesService, useClass: FxRatesServiceStub },
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$.asObservable() } },
      ],
    });
  }

  beforeEach(setup);

  it('loads the receipt for a valid token and renders the PDF link', () => {
    const fixture = TestBed.createComponent(ReceiptComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(receipts.getByToken).toHaveBeenCalledWith('tok-1', { reveal: false });
    expect(cmp.token).toBe('tok-1');
    expect(cmp.loading).toBeFalse();
    expect(cmp.error).toBe('');
    expect(cmp.receipt?.order_id).toBe('order-1');
    expect(cmp.pdfUrl).toBe('https://api/orders/receipt/tok-1/pdf');

    const html = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(html).toContain('Download PDF');
    expect(html).toContain('Product One');
    expect(html).toContain('Stripe');
  });

  it('shows a missing-token error when no token is in the route', () => {
    paramMap$.next(convertToParamMap({}));
    const fixture = TestBed.createComponent(ReceiptComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(cmp.token).toBe('');
    expect(receipts.getByToken).not.toHaveBeenCalled();
    expect(cmp.loading).toBeFalse();
    expect(cmp.receipt).toBeNull();
    expect(cmp.error).toBe('Missing receipt token.');
  });

  it('uses the server-provided detail message on a request failure', () => {
    receipts.getByToken.and.returnValue(throwError(() => ({ error: { detail: 'Link expired' } })));
    const fixture = TestBed.createComponent(ReceiptComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(cmp.loading).toBeFalse();
    expect(cmp.receipt).toBeNull();
    expect(cmp.error).toBe('Link expired');
  });

  it('falls back to a generic error when the failure has no detail', () => {
    receipts.getByToken.and.returnValue(throwError(() => null));
    const fixture = TestBed.createComponent(ReceiptComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(cmp.error).toBe('Receipt not found or link expired.');
  });

  it('toggleReveal does nothing without a token', () => {
    paramMap$.next(convertToParamMap({}));
    const fixture = TestBed.createComponent(ReceiptComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    receipts.getByToken.calls.reset();

    cmp.toggleReveal();

    expect(cmp.reveal).toBeFalse();
    expect(receipts.getByToken).not.toHaveBeenCalled();
  });

  it('toggleReveal flips the reveal flag and reloads with reveal=true', () => {
    const fixture = TestBed.createComponent(ReceiptComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    receipts.getByToken.calls.reset();

    cmp.toggleReveal();
    expect(cmp.reveal).toBeTrue();
    expect(receipts.getByToken).toHaveBeenCalledWith('tok-1', { reveal: true });
    expect(cmp.pdfUrl).toBe('https://api/orders/receipt/tok-1/pdf?reveal=true');

    cmp.toggleReveal();
    expect(cmp.reveal).toBeFalse();
    expect(receipts.getByToken).toHaveBeenCalledWith('tok-1', { reveal: false });
  });

  it('resets reveal to false when the route token changes', () => {
    const fixture = TestBed.createComponent(ReceiptComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.toggleReveal();
    expect(cmp.reveal).toBeTrue();

    paramMap$.next(convertToParamMap({ token: 'tok-2' }));
    expect(cmp.reveal).toBeFalse();
    expect(cmp.token).toBe('tok-2');
  });

  describe('paymentMethodLabel', () => {
    let cmp: ReceiptComponent;

    beforeEach(() => {
      const fixture = TestBed.createComponent(ReceiptComponent);
      cmp = fixture.componentInstance;
    });

    it('returns an empty string when there is no receipt', () => {
      cmp.receipt = null;
      expect(cmp.paymentMethodLabel()).toBe('');
    });

    it('returns an empty string when the payment method is empty', () => {
      cmp.receipt = makeReceipt({ payment_method: '' });
      expect(cmp.paymentMethodLabel()).toBe('');
    });

    it('maps the known payment methods to their display labels', () => {
      cmp.receipt = makeReceipt({ payment_method: 'STRIPE' });
      expect(cmp.paymentMethodLabel()).toBe('Stripe');
      cmp.receipt = makeReceipt({ payment_method: 'paypal' });
      expect(cmp.paymentMethodLabel()).toBe('PayPal');
      cmp.receipt = makeReceipt({ payment_method: 'netopia' });
      expect(cmp.paymentMethodLabel()).toBe('Netopia');
      cmp.receipt = makeReceipt({ payment_method: 'cod' });
      expect(cmp.paymentMethodLabel()).toBe('Cash / Numerar');
    });

    it('uppercases an unknown payment method', () => {
      cmp.receipt = makeReceipt({ payment_method: 'bank' });
      expect(cmp.paymentMethodLabel()).toBe('BANK');
    });
  });

  it('unsubscribes on destroy after init', () => {
    const fixture = TestBed.createComponent(ReceiptComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    const sub = (cmp as unknown as { sub: { unsubscribe(): void } }).sub;
    const spy = spyOn(sub, 'unsubscribe').and.callThrough();

    cmp.ngOnDestroy();

    expect(spy).toHaveBeenCalled();
  });

  it('does not throw on destroy when never initialized', () => {
    const fixture = TestBed.createComponent(ReceiptComponent);
    const cmp = fixture.componentInstance;
    expect(() => cmp.ngOnDestroy()).not.toThrow();
  });
});
