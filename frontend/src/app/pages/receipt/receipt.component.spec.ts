import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { FxRatesService } from '../../core/fx-rates.service';
import { ReceiptRead, ReceiptService } from '../../core/receipt.service';
import { ReceiptComponent } from './receipt.component';

/**
 * Golden WU rcpt47 — first receipt page specs.
 * Covers payment-method label mapping, missing-token empty/error, and
 * load/pdfUrl/toggleReveal + API error arms with light service stubs.
 */
describe('ReceiptComponent status / load helpers', () => {
  let receipts: jasmine.SpyObj<ReceiptService>;
  let paramMap$: BehaviorSubject<ParamMap>;

  const sampleReceipt: ReceiptRead = {
    order_id: 'ord-1',
    reference_code: 'REF-1',
    status: 'paid',
    created_at: '2026-01-01T00:00:00Z',
    currency: 'RON',
    payment_method: 'stripe',
    items: [],
  };

  function configure(token: string | null): void {
    receipts = jasmine.createSpyObj<ReceiptService>('ReceiptService', ['getByToken', 'pdfUrl']);
    receipts.pdfUrl.and.callFake((tok: string, opts?: { reveal?: boolean }) =>
      opts?.reveal ? `/pdf/${tok}?reveal=true` : `/pdf/${tok}`,
    );
    paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap(token ? { token } : {}));

    TestBed.configureTestingModule({
      imports: [ReceiptComponent, RouterTestingModule],
      providers: [
        { provide: ReceiptService, useValue: receipts },
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$.asObservable() } },
        {
          provide: FxRatesService,
          useValue: {
            ensureLoaded: () => undefined,
            snapshot: { loaded: false, eurPerRon: 0, usdPerRon: 0 },
          },
        },
      ],
    });
  }

  it('paymentMethodLabel maps known methods and uppercases unknowns', () => {
    configure(null);
    receipts.getByToken.and.returnValue(of(sampleReceipt));

    const fixture = TestBed.createComponent(ReceiptComponent);
    const cmp = fixture.componentInstance;

    cmp.receipt = { ...sampleReceipt, payment_method: 'stripe' };
    expect(cmp.paymentMethodLabel()).toBe('Stripe');

    cmp.receipt = { ...sampleReceipt, payment_method: ' paypal ' };
    expect(cmp.paymentMethodLabel()).toBe('PayPal');

    cmp.receipt = { ...sampleReceipt, payment_method: 'NETOPIA' };
    expect(cmp.paymentMethodLabel()).toBe('Netopia');

    cmp.receipt = { ...sampleReceipt, payment_method: 'cod' };
    expect(cmp.paymentMethodLabel()).toBe('Cash / Numerar');

    cmp.receipt = { ...sampleReceipt, payment_method: 'wire' };
    expect(cmp.paymentMethodLabel()).toBe('WIRE');

    cmp.receipt = { ...sampleReceipt, payment_method: '  ' };
    expect(cmp.paymentMethodLabel()).toBe('');

    cmp.receipt = null;
    expect(cmp.paymentMethodLabel()).toBe('');
  });

  it('ngOnInit missing-token sets empty error state and skips API', () => {
    configure(null);
    receipts.getByToken.and.returnValue(of(sampleReceipt));

    const fixture = TestBed.createComponent(ReceiptComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(cmp.token).toBe('');
    expect(cmp.loading).toBeFalse();
    expect(cmp.receipt).toBeNull();
    expect(cmp.error).toBe('Missing receipt token.');
    expect(receipts.getByToken).not.toHaveBeenCalled();
    expect(receipts.pdfUrl).not.toHaveBeenCalled();

    // toggleReveal is a no-op without a token
    cmp.toggleReveal();
    expect(cmp.reveal).toBeFalse();
    expect(receipts.getByToken).not.toHaveBeenCalled();
  });

  it('loads receipt + pdfUrl on token, surfaces API error detail, and toggleReveal reloads', () => {
    configure('tok-ok');
    receipts.getByToken.and.returnValue(of(sampleReceipt));

    const fixture = TestBed.createComponent(ReceiptComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;

    expect(cmp.token).toBe('tok-ok');
    expect(cmp.loading).toBeFalse();
    expect(cmp.receipt).toEqual(sampleReceipt);
    expect(cmp.error).toBe('');
    expect(receipts.pdfUrl).toHaveBeenCalledWith('tok-ok', { reveal: false });
    expect(cmp.pdfUrl).toBe('/pdf/tok-ok');
    expect(receipts.getByToken).toHaveBeenCalledWith('tok-ok', { reveal: false });

    // API error path uses detail (or fallback when absent)
    receipts.getByToken.and.returnValue(
      throwError(() => ({ error: { detail: 'backend-expired' } })),
    );
    paramMap$.next(convertToParamMap({ token: 'tok-err' }));
    expect(cmp.token).toBe('tok-err');
    expect(cmp.loading).toBeFalse();
    expect(cmp.receipt).toBeNull();
    expect(cmp.error).toBe('backend-expired');

    receipts.getByToken.and.returnValue(throwError(() => ({ error: {} })));
    paramMap$.next(convertToParamMap({ token: 'tok-fallback' }));
    expect(cmp.error).toBe('Receipt not found or link expired.');

    // toggleReveal flips reveal and reloads with reveal=true
    receipts.getByToken.and.returnValue(of({ ...sampleReceipt, pii_redacted: true }));
    cmp.token = 'tok-reveal';
    cmp.reveal = false;
    cmp.toggleReveal();
    expect(cmp.reveal).toBeTrue();
    expect(receipts.pdfUrl).toHaveBeenCalledWith('tok-reveal', { reveal: true });
    expect(cmp.pdfUrl).toBe('/pdf/tok-reveal?reveal=true');
    expect(receipts.getByToken).toHaveBeenCalledWith('tok-reveal', { reveal: true });
  });
});
