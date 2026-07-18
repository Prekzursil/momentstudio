import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';

import { ApiService } from './api.service';
import { ReceiptService, type ReceiptRead } from './receipt.service';
import { appConfig } from './app-config';

describe('ReceiptService', () => {
  const apiMock = { get: jasmine.createSpy('get') };
  let service: ReceiptService;

  beforeEach(() => {
    apiMock.get.calls.reset();
    TestBed.configureTestingModule({
      providers: [ReceiptService, { provide: ApiService, useValue: apiMock }],
    });
    service = TestBed.inject(ReceiptService);
  });

  describe('getByToken', () => {
    it('requests the reveal param and normalizes a fully populated receipt', async () => {
      const raw = {
        order_id: 'o-1',
        status: 'paid',
        created_at: '2026-01-01T00:00:00Z',
        currency: 'RON',
        pii_redacted: 1,
        shipping_amount: '12.50',
        tax_amount: '3.10',
        fee_amount: 1.25,
        total_amount: '99.99',
        items: [
          { product_id: 'p-1', name: 'Mug', quantity: 2, unit_price: '10.00', subtotal: '20.00' },
        ],
        refunds: [
          {
            currency: 'RON',
            provider: 'stripe',
            created_at: '2026-02-01T00:00:00Z',
            amount: '5.00',
          },
        ],
      };
      apiMock.get.and.returnValue(of(raw));

      const result = await firstValueFrom(service.getByToken('tok 1', { reveal: true }));

      expect(apiMock.get).toHaveBeenCalledWith('/orders/receipt/tok%201', { reveal: true });
      expect(result.pii_redacted).toBe(true);
      expect(result.shipping_amount).toBe(12.5);
      expect(result.tax_amount).toBe(3.1);
      expect(result.fee_amount).toBe(1.25);
      expect(result.total_amount).toBe(99.99);
      expect(result.items).toEqual([
        { product_id: 'p-1', name: 'Mug', quantity: 2, unit_price: 10, subtotal: 20 },
      ]);
      expect(result.refunds).toEqual([
        { currency: 'RON', provider: 'stripe', created_at: '2026-02-01T00:00:00Z', amount: 5 },
      ]);
    });

    it('omits params and nulls out absent amounts and collections when no options given', async () => {
      const raw = {
        order_id: 'o-2',
        status: 'pending',
        created_at: '2026-01-02T00:00:00Z',
        currency: 'EUR',
        // pii_redacted, amounts, items and refunds intentionally absent
      };
      apiMock.get.and.returnValue(of(raw));

      const result = await firstValueFrom(service.getByToken('tok2'));

      expect(apiMock.get).toHaveBeenCalledWith('/orders/receipt/tok2', undefined);
      expect(result.pii_redacted).toBe(false);
      expect(result.shipping_amount).toBeNull();
      expect(result.tax_amount).toBeNull();
      expect(result.fee_amount).toBeNull();
      expect(result.total_amount).toBeNull();
      expect(result.items).toEqual([]);
      expect(result.refunds).toEqual([]);
    });

    it('treats a falsy reveal option as no params', async () => {
      apiMock.get.and.returnValue(
        of({ order_id: 'o-3', status: 'paid', created_at: 'x', currency: 'RON' }),
      );

      await firstValueFrom(service.getByToken('tok3', { reveal: false }));

      expect(apiMock.get).toHaveBeenCalledWith('/orders/receipt/tok3', undefined);
    });

    it('tolerates a null payload by emitting safe defaults', async () => {
      apiMock.get.and.returnValue(of(null));

      const result = await firstValueFrom(service.getByToken('tok4'));

      expect(result.pii_redacted).toBe(false);
      expect(result.shipping_amount).toBeNull();
      expect(result.total_amount).toBeNull();
      expect(result.items).toEqual([]);
      expect(result.refunds).toEqual([]);
    });

    it('coerces null entries inside items and refunds to zeroed amounts', async () => {
      const raw = {
        order_id: 'o-5',
        status: 'paid',
        created_at: 'x',
        currency: 'RON',
        items: [null],
        refunds: [null],
      };
      apiMock.get.and.returnValue(of(raw));

      const result = await firstValueFrom(service.getByToken('tok5'));

      expect(result.items).toEqual([{ unit_price: 0, subtotal: 0 } as never]);
      expect(result.refunds).toEqual([{ amount: 0 } as never]);
    });

    it('propagates explicit zero amounts without nulling them', async () => {
      const raw = {
        order_id: 'o-6',
        status: 'paid',
        created_at: 'x',
        currency: 'RON',
        shipping_amount: 0,
        tax_amount: 0,
        fee_amount: 0,
        total_amount: 0,
        items: [],
        refunds: [],
      } satisfies Partial<ReceiptRead>;
      apiMock.get.and.returnValue(of(raw));

      const result = await firstValueFrom(service.getByToken('tok6'));

      expect(result.shipping_amount).toBe(0);
      expect(result.tax_amount).toBe(0);
      expect(result.fee_amount).toBe(0);
      expect(result.total_amount).toBe(0);
    });
  });

  describe('pdfUrl', () => {
    const base = appConfig.apiBaseUrl.replace(/\/$/, '');

    it('builds an encoded pdf url without the reveal query by default', () => {
      expect(service.pdfUrl('tok 7')).toBe(`${base}/orders/receipt/tok%207/pdf`);
    });

    it('appends the reveal query when reveal is requested', () => {
      expect(service.pdfUrl('tok8', { reveal: true })).toBe(
        `${base}/orders/receipt/tok8/pdf?reveal=true`,
      );
    });

    it('omits the reveal query when reveal is falsy', () => {
      expect(service.pdfUrl('tok9', { reveal: false })).toBe(`${base}/orders/receipt/tok9/pdf`);
    });
  });
});
