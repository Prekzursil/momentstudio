import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { ReceiptComponent } from './receipt.component';
import { ReceiptRead, ReceiptService } from '../../core/receipt.service';
import { ApiService } from '../../core/api.service';

function makeReceipt(overrides: Partial<ReceiptRead> = {}): ReceiptRead {
  return {
    order_id: 'order-123',
    reference_code: 'REF-9',
    status: 'paid',
    created_at: '2024-01-02T03:04:05+00:00',
    currency: 'RON',
    payment_method: 'stripe',
    courier: 'DHL',
    delivery_type: 'locker',
    locker_name: 'Locker A',
    locker_address: 'Str. Test 1',
    tracking_number: 'AWB-1',
    customer_email: 'buyer@example.com',
    customer_name: 'Buyer Name',
    pii_redacted: true,
    shipping_amount: 10,
    tax_amount: 5,
    fee_amount: 2,
    total_amount: 117,
    shipping_address: {
      line1: 'Ship 1',
      line2: 'Ap 2',
      city: 'Cluj',
      region: 'CJ',
      postal_code: '400000',
      country: 'RO',
    },
    billing_address: {
      line1: 'Bill 1',
      line2: null,
      city: 'Bucuresti',
      region: null,
      postal_code: '010000',
      country: 'RO',
    },
    items: [
      {
        product_id: 'p1',
        slug: 'product-one',
        name: 'Product One',
        quantity: 2,
        unit_price: 50,
        subtotal: 100,
      },
      {
        product_id: 'p2',
        slug: null,
        name: 'Product Two',
        quantity: 1,
        unit_price: 0,
        subtotal: 0,
      },
    ],
    refunds: [
      {
        amount: 7,
        currency: 'RON',
        provider: 'stripe',
        note: 'partial refund',
        created_at: '2024-02-02T00:00:00+00:00',
      },
    ],
    ...overrides,
  };
}

describe('ReceiptComponent', () => {
  let receipts: jasmine.SpyObj<ReceiptService>;
  let api: jasmine.SpyObj<ApiService>;
  let paramMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  function configure(): void {
    receipts = jasmine.createSpyObj<ReceiptService>('ReceiptService', ['getByToken', 'pdfUrl']);
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get']);
    api.get.and.returnValue(of({}));
    receipts.pdfUrl.and.callFake(
      (token: string, opts?: { reveal?: boolean }) =>
        `https://api.test/orders/receipt/${token}/pdf${opts?.reveal ? '?reveal=true' : ''}`,
    );
    receipts.getByToken.and.returnValue(of(makeReceipt()));

    TestBed.configureTestingModule({
      imports: [ReceiptComponent, RouterTestingModule, TranslateModule.forRoot()],
      providers: [
        { provide: ReceiptService, useValue: receipts },
        { provide: ApiService, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: paramMap$.asObservable() },
        },
      ],
    });
  }

  beforeEach(() => {
    paramMap$ = new BehaviorSubject(convertToParamMap({ token: 'tok-1' }));
  });

  function createFixture(): ComponentFixture<ReceiptComponent> {
    configure();
    return TestBed.createComponent(ReceiptComponent);
  }

  it('loads the receipt for the route token and renders its details', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(receipts.getByToken).toHaveBeenCalledWith('tok-1', { reveal: false });
    expect(receipts.pdfUrl).toHaveBeenCalledWith('tok-1', { reveal: false });
    expect(component.loading).toBeFalse();
    expect(component.error).toBe('');
    expect(component.receipt?.order_id).toBe('order-123');
    expect(component.pdfUrl).toBe('https://api.test/orders/receipt/tok-1/pdf');

    const html: string = fixture.nativeElement.textContent;
    expect(html).toContain('REF-9');
    expect(html).toContain('Buyer Name');
    expect(html).toContain('Product One');
    expect(html).toContain('Product Two');
    expect(html).toContain('Refunds / Rambursări');

    // Slug item renders a product link; no-slug item renders plain text.
    const productLink: HTMLAnchorElement | null =
      fixture.nativeElement.querySelector('a[href$="/products/product-one"]');
    expect(productLink?.textContent?.trim()).toBe('Product One');
  });

  it('shows an error and skips loading when the route has no token', () => {
    paramMap$ = new BehaviorSubject(convertToParamMap({}));
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.token).toBe('');
    expect(component.loading).toBeFalse();
    expect(component.receipt).toBeNull();
    expect(component.error).toBe('Missing receipt token.');
    expect(receipts.getByToken).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Missing receipt token.');
  });

  it('uses the server-provided detail message on load failure', () => {
    const fixture = createFixture();
    receipts.getByToken.and.returnValue(
      throwError(() => ({ error: { detail: 'Custom failure detail' } })),
    );
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.loading).toBeFalse();
    expect(component.receipt).toBeNull();
    expect(component.error).toBe('Custom failure detail');
    expect(fixture.nativeElement.textContent).toContain('Custom failure detail');
  });

  it('falls back to a generic message when the error has no detail', () => {
    const fixture = createFixture();
    receipts.getByToken.and.returnValue(throwError(() => ({})));
    fixture.detectChanges();
    const component = fixture.componentInstance;

    expect(component.error).toBe('Receipt not found or link expired.');
  });

  it('toggles reveal and reloads the receipt with reveal=true', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    receipts.getByToken.calls.reset();
    receipts.pdfUrl.calls.reset();

    component.toggleReveal();

    expect(component.reveal).toBeTrue();
    expect(receipts.getByToken).toHaveBeenCalledWith('tok-1', { reveal: true });
    expect(component.pdfUrl).toBe('https://api.test/orders/receipt/tok-1/pdf?reveal=true');

    component.toggleReveal();
    expect(component.reveal).toBeFalse();
  });

  it('does nothing on toggleReveal when there is no token', () => {
    paramMap$ = new BehaviorSubject(convertToParamMap({}));
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    receipts.getByToken.calls.reset();

    component.toggleReveal();

    expect(component.reveal).toBeFalse();
    expect(receipts.getByToken).not.toHaveBeenCalled();
  });

  it('resets reveal to false whenever the route token changes', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.reveal = true;

    paramMap$.next(convertToParamMap({ token: 'tok-2' }));

    expect(component.reveal).toBeFalse();
    expect(component.token).toBe('tok-2');
    expect(receipts.getByToken).toHaveBeenCalledWith('tok-2', { reveal: false });
  });

  describe('paymentMethodLabel', () => {
    let component: ReceiptComponent;

    beforeEach(() => {
      const fixture = createFixture();
      component = fixture.componentInstance;
    });

    it('returns an empty string when there is no receipt', () => {
      component.receipt = null;
      expect(component.paymentMethodLabel()).toBe('');
    });

    it('returns an empty string when the payment method is blank', () => {
      component.receipt = makeReceipt({ payment_method: '   ' });
      expect(component.paymentMethodLabel()).toBe('');
    });

    it('maps known payment methods to friendly labels', () => {
      component.receipt = makeReceipt({ payment_method: 'STRIPE' });
      expect(component.paymentMethodLabel()).toBe('Stripe');

      component.receipt = makeReceipt({ payment_method: 'paypal' });
      expect(component.paymentMethodLabel()).toBe('PayPal');

      component.receipt = makeReceipt({ payment_method: 'netopia' });
      expect(component.paymentMethodLabel()).toBe('Netopia');

      component.receipt = makeReceipt({ payment_method: 'cod' });
      expect(component.paymentMethodLabel()).toBe('Cash / Numerar');
    });

    it('uppercases unknown payment methods', () => {
      component.receipt = makeReceipt({ payment_method: 'bank-transfer' });
      expect(component.paymentMethodLabel()).toBe('BANK-TRANSFER');
    });
  });

  it('unsubscribes from the route subscription on destroy', () => {
    const fixture = createFixture();
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(paramMap$.observed).toBeTrue();

    component.ngOnDestroy();

    expect(paramMap$.observed).toBeFalse();
  });

  it('handles destroy safely when never initialized', () => {
    const fixture = createFixture();
    const component = fixture.componentInstance;

    // ngOnInit has not run (no detectChanges), so the subscription is undefined.
    expect(() => component.ngOnDestroy()).not.toThrow();
  });
});
