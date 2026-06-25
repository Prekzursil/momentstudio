import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AdminOrdersService } from './admin-orders.service';

describe('AdminOrdersService', () => {
  let service: AdminOrdersService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AdminOrdersService],
    });
    service = TestBed.inject(AdminOrdersService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('searches orders', () => {
    service.search({ q: 'ref', status: 'paid', page: 2, limit: 10 }).subscribe((res) => {
      expect(res.meta.page).toBe(2);
      expect(res.meta.limit).toBe(10);
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/orders/admin/search');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('ref');
    expect(req.request.params.get('status')).toBe('paid');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('limit')).toBe('10');
    req.flush({ items: [], meta: { total_items: 0, total_pages: 1, page: 2, limit: 10 } });
  });

  it('fetches an order', () => {
    service.get('o1').subscribe((res) => {
      expect(res.id).toBe('o1');
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/orders/admin/o1');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('include_pii')).toBe('true');
    req.flush({
      id: 'o1',
      status: 'pending',
      total_amount: 10,
      currency: 'RON',
      created_at: '2000-01-01T00:00:00+00:00',
      updated_at: '2000-01-01T00:00:00+00:00',
      items: [],
    });
  });

  it('updates an order', () => {
    service.update('o1', { status: 'paid', tracking_number: 'T123' }).subscribe((res) => {
      expect(res.status).toBe('paid');
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/orders/admin/o1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.params.get('include_pii')).toBe('true');
    expect(req.request.body).toEqual({ status: 'paid', tracking_number: 'T123' });
    req.flush({
      id: 'o1',
      status: 'paid',
      total_amount: 10,
      currency: 'RON',
      created_at: '2000-01-01T00:00:00+00:00',
      updated_at: '2000-01-01T00:00:00+00:00',
      items: [],
    });
  });

  it('downloads order export', () => {
    service.downloadExport().subscribe((blob) => {
      expect(blob.size).toBe(3);
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/orders/admin/export');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('include_pii')).toBe('true');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['csv'], { type: 'text/csv' }));
  });

  // A "rich" detail payload exercises the Array.isArray=true and `?? []`-present
  // branches plus parseMoney on nested rows.
  const richDetail = {
    id: 'o1',
    status: 'paid',
    total_amount: '10.50',
    tax_amount: '1.00',
    fee_amount: '0.50',
    shipping_amount: '2.00',
    currency: 'RON',
    created_at: 'd',
    updated_at: 'd',
    refunds: [{ id: 'r1', amount: '3.00' }],
    admin_notes: [{ id: 'a1', note: 'hi', created_at: 'd' }],
    fraud_signals: [{ code: 'x', severity: 'low' }],
    shipments: [{ id: 's1', order_id: 'o1', tracking_number: 'T', created_at: 'd' }],
    tags: ['vip'],
    items: [{ id: 'it1', unit_price: '5.00', subtotal: '5.00' }],
  };

  // A "minimal" payload exercises the `?? []` and Array.isArray=false branches.
  const minimalDetail = {
    id: 'o2',
    status: 'pending',
    total_amount: 1,
    currency: 'RON',
    created_at: 'd',
    updated_at: 'd',
    refunds: null,
    fraud_signals: 'nope',
    shipments: 'nope',
    items: null,
  };

  function expectDetailRequest(
    url: string,
    method: string,
    payload: Record<string, unknown>,
  ): void {
    const req = httpMock.expectOne((r) => r.url === url);
    expect(req.request.method).toBe(method);
    req.flush(payload);
  }

  it('searches with default include_pii and normalizes items', () => {
    service.search({}).subscribe((res) => {
      expect(res.items[0].total_amount).toBe(10.5);
      expect(res.items[0].tags).toEqual([]);
    });
    const req = httpMock.expectOne((r) => r.url === '/api/v1/orders/admin/search');
    expect(req.request.params.get('include_pii')).toBe('true');
    req.flush({
      items: [{ id: 'o1', total_amount: '10.50', status: 'paid', tags: 'not-array' }],
      meta: { total_items: 1, total_pages: 1, page: 1, limit: 12 },
    });
  });

  it('search keeps an array of tags as-is', () => {
    service.search({}).subscribe((res) => {
      expect(res.items[0].tags).toEqual(['a', 'b']);
    });
    httpMock
      .expectOne((r) => r.url === '/api/v1/orders/admin/search')
      .flush({
        items: [{ id: 'o1', total_amount: '1', status: 'paid', tags: ['a', 'b'] }],
        meta: { total_items: 1, total_pages: 1, page: 1, limit: 12 },
      });
  });

  it('search respects an explicit include_pii=false', () => {
    service.search({ include_pii: false }).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/orders/admin/search');
    expect(req.request.params.get('include_pii')).toBe('false');
    req.flush({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 12 } });
  });

  it('search tolerates a missing items array', () => {
    service.search({}).subscribe((res) => expect(res.items).toEqual([]));
    httpMock
      .expectOne((r) => r.url === '/api/v1/orders/admin/search')
      .flush({ meta: { total_items: 0, total_pages: 1, page: 1, limit: 12 } });
  });

  it('get normalizes a rich detail payload', () => {
    service.get('o1', { include_pii: false }).subscribe((o) => {
      expect(o.total_amount).toBe(10.5);
      expect(o.refunds?.[0].amount).toBe(3);
      expect(o.items[0].unit_price).toBe(5);
      expect(o.fraud_signals?.length).toBe(1);
    });
    const req = httpMock.expectOne((r) => r.url === '/api/v1/orders/admin/o1');
    expect(req.request.params.get('include_pii')).toBe('false');
    req.flush(richDetail);
  });

  it('get tolerates a minimal detail payload', () => {
    service.get('o2').subscribe((o) => {
      expect(o.refunds).toEqual([]);
      expect(o.fraud_signals).toEqual([]);
      expect(o.shipments).toEqual([]);
      expect(o.items).toEqual([]);
    });
    httpMock.expectOne((r) => r.url === '/api/v1/orders/admin/o2').flush(minimalDetail);
  });

  it('lists email events and tolerates a non-array response', () => {
    service.listEmailEvents('o1', { limit: 5 }).subscribe((rows) => expect(rows.length).toBe(1));
    httpMock
      .expectOne((r) => r.url === '/api/v1/orders/admin/o1/email-events')
      .flush([{ id: 'e1', to_email: 'a@b.c', subject: 's', status: 'sent', created_at: 'd' }]);

    service.listEmailEvents('o1').subscribe((rows) => expect(rows).toEqual([]));
    httpMock.expectOne((r) => r.url === '/api/v1/orders/admin/o1/email-events').flush('not-array');
  });

  // Run a detail-returning call against BOTH the rich and minimal payloads so
  // every normalize block hits the map-body (rich) and the `?? []`/Array.isArray
  // fallback (minimal) sides.
  function runDetailBoth(invoke: () => void, url: string, method: string): void {
    invoke();
    expectDetailRequest(url, method, richDetail);
    invoke();
    expectDetailRequest(url, method, minimalDetail);
  }

  it('updates an order against rich and minimal payloads', () => {
    runDetailBoth(
      () => service.update('o1', { status: 'paid' }).subscribe(),
      '/api/v1/orders/admin/o1',
      'PATCH',
    );
  });

  it('reviews fraud, updates addresses and manages shipments', () => {
    runDetailBoth(
      () => service.reviewFraud('o1', { decision: 'approve' }).subscribe(),
      '/api/v1/orders/admin/o1/fraud-review',
      'POST',
    );
    runDetailBoth(
      () => service.updateAddresses('o1', { rerate_shipping: true }).subscribe(),
      '/api/v1/orders/admin/o1/addresses',
      'PATCH',
    );
    runDetailBoth(
      () => service.createShipment('o1', { tracking_number: 'T' }).subscribe(),
      '/api/v1/orders/admin/o1/shipments',
      'POST',
    );
    runDetailBoth(
      () => service.updateShipment('o1', 's1', { tracking_number: 'T2' }).subscribe(),
      '/api/v1/orders/admin/o1/shipments/s1',
      'PATCH',
    );
    runDetailBoth(
      () => service.deleteShipment('o1', 's1').subscribe(),
      '/api/v1/orders/admin/o1/shipments/s1',
      'DELETE',
    );
    runDetailBoth(
      () => service.fulfillItem('o1', 'it1', 2).subscribe(),
      '/api/v1/orders/admin/o1/items/it1/fulfill',
      'POST',
    );
  });

  it('uploads and downloads/deletes the shipping label', () => {
    const file = new File(['x'], 'label.pdf', { type: 'application/pdf' });
    service.uploadShippingLabel('o1', file).subscribe();
    const up = httpMock.expectOne((r) => r.url === '/api/v1/orders/admin/o1/shipping-label');
    expect(up.request.method).toBe('POST');
    expect(up.request.body instanceof FormData).toBeTrue();
    up.flush(richDetail);

    service.downloadShippingLabel('o1').subscribe();
    httpMock
      .expectOne((r) => r.url === '/api/v1/orders/admin/o1/shipping-label' && r.method === 'GET')
      .flush(new Blob(['pdf']));

    service.downloadShippingLabel('o1', { action: 'print' }).subscribe();
    const printReq = httpMock.expectOne(
      (r) => r.url === '/api/v1/orders/admin/o1/shipping-label' && r.method === 'GET',
    );
    expect(printReq.request.params.get('action')).toBe('print');
    printReq.flush(new Blob(['pdf']));

    service.deleteShippingLabel('o1').subscribe();
    httpMock
      .expectOne((r) => r.url === '/api/v1/orders/admin/o1/shipping-label' && r.method === 'DELETE')
      .flush(null);
  });

  it('runs payment lifecycle actions', () => {
    const order = {
      id: 'o1',
      status: 'paid',
      total_amount: 1,
      currency: 'RON',
      created_at: 'd',
      updated_at: 'd',
      items: [],
    };
    service.retryPayment('o1').subscribe();
    httpMock.expectOne('/api/v1/orders/admin/o1/retry-payment').flush(order);
    service.capturePayment('o1').subscribe();
    httpMock.expectOne('/api/v1/orders/admin/o1/capture-payment').flush(order);
    service.voidPayment('o1').subscribe();
    httpMock.expectOne('/api/v1/orders/admin/o1/void-payment').flush(order);
    service.requestRefund('o1').subscribe();
    httpMock.expectOne('/api/v1/orders/admin/o1/refund').flush(order);
    service.requestRefund('o1', { note: 'n' }).subscribe();
    httpMock.expectOne('/api/v1/orders/admin/o1/refund').flush(order);
  });

  it('creates a partial refund and adds an admin note against both payloads', () => {
    runDetailBoth(
      () => service.createPartialRefund('o1', { amount: '5', note: 'n' }).subscribe(),
      '/api/v1/orders/admin/o1/refunds',
      'POST',
    );
    runDetailBoth(
      () => service.addAdminNote('o1', 'note text').subscribe(),
      '/api/v1/orders/admin/o1/notes',
      'POST',
    );
  });

  it('lists/normalizes order tags and stats and renames tags', () => {
    service.listOrderTags().subscribe((tags) => expect(tags).toEqual(['a', 'b']));
    httpMock.expectOne('/api/v1/orders/admin/tags').flush({ items: ['a', '', 'b', 5] });

    service.listOrderTags().subscribe((tags) => expect(tags).toEqual([]));
    httpMock.expectOne('/api/v1/orders/admin/tags').flush({ items: 'no' });

    service.listOrderTagStats().subscribe((stats) => {
      // '' is dropped (empty tag); 'y' kept with count clamped to 0.
      expect(stats).toEqual([
        { tag: 'x', count: 2 },
        { tag: 'y', count: 0 },
      ]);
    });
    httpMock.expectOne('/api/v1/orders/admin/tags/stats').flush({
      items: [
        { tag: 'x', count: 2 },
        { tag: '', count: 9 },
        { tag: 'y', count: -1 },
      ],
    });

    // y has count -1 -> Math.max(0,...) = 0; included since tag valid.
    service.listOrderTagStats().subscribe((stats) => expect(stats).toEqual([]));
    httpMock.expectOne('/api/v1/orders/admin/tags/stats').flush({ items: 'no' });

    service.renameOrderTag({ from_tag: 'a', to_tag: 'b' }).subscribe((res) => {
      expect(res.updated).toBe(3);
      expect(res.total).toBe(0);
    });
    httpMock
      .expectOne('/api/v1/orders/admin/tags/rename')
      .flush({ from_tag: 'a', to_tag: 'b', updated: 3, merged: 1 });
  });

  it('clamps non-numeric and missing tag stat counts to zero', () => {
    service.listOrderTagStats().subscribe((stats) => {
      expect(stats).toEqual([
        { tag: 'z', count: 0 },
        { tag: 'w', count: 0 },
      ]);
    });
    httpMock.expectOne('/api/v1/orders/admin/tags/stats').flush({
      items: [
        { tag: 'z', count: 'NaN' as unknown as number },
        { tag: 'w' }, // count missing -> row.count || 0 falsy branch
      ],
    });
  });

  it('coerces a sparse rename response to safe defaults', () => {
    service.renameOrderTag({ from_tag: 'a', to_tag: 'b' }).subscribe((res) => {
      expect(res).toEqual({ from_tag: '', to_tag: '', updated: 0, merged: 0, total: 0 });
    });
    httpMock.expectOne('/api/v1/orders/admin/tags/rename').flush({});
  });

  it('adds and removes order tags against both payloads', () => {
    runDetailBoth(
      () => service.addOrderTag('o1', 'vip').subscribe(),
      '/api/v1/orders/admin/o1/tags',
      'POST',
    );
    runDetailBoth(
      () => service.removeOrderTag('o1', 'vip').subscribe(),
      '/api/v1/orders/admin/o1/tags/vip',
      'DELETE',
    );
  });

  it('sends emails and downloads batch documents', () => {
    const order = {
      id: 'o1',
      status: 'paid',
      total_amount: 1,
      currency: 'RON',
      created_at: 'd',
      updated_at: 'd',
      items: [],
    };
    service.sendDeliveryEmail('o1').subscribe();
    httpMock.expectOne('/api/v1/orders/admin/o1/delivery-email').flush(order);
    service.resendOrderConfirmationEmail('o1').subscribe();
    httpMock.expectOne('/api/v1/orders/admin/o1/confirmation-email').flush(order);
    service.resendOrderConfirmationEmail('o1', 'note').subscribe();
    httpMock.expectOne('/api/v1/orders/admin/o1/confirmation-email').flush(order);
    service.resendDeliveryEmail('o1').subscribe();
    httpMock.expectOne('/api/v1/orders/admin/o1/delivery-email').flush(order);
    service.resendDeliveryEmail('o1', 'note').subscribe();
    httpMock.expectOne('/api/v1/orders/admin/o1/delivery-email').flush(order);

    service.downloadPackingSlip('o1').subscribe();
    httpMock.expectOne('/api/v1/orders/admin/o1/packing-slip').flush(new Blob(['x']));
    service.downloadBatchPackingSlips(['o1']).subscribe();
    httpMock.expectOne('/api/v1/orders/admin/batch/packing-slips').flush(new Blob(['x']));
    service.downloadPickListCsv(['o1']).subscribe();
    httpMock.expectOne('/api/v1/orders/admin/batch/pick-list.csv').flush(new Blob(['x']));
    service.downloadPickListPdf(['o1']).subscribe();
    httpMock.expectOne('/api/v1/orders/admin/batch/pick-list.pdf').flush(new Blob(['x']));
    service.downloadBatchShippingLabelsZip(['o1']).subscribe();
    httpMock.expectOne('/api/v1/orders/admin/batch/shipping-labels.zip').flush(new Blob(['x']));
    service.downloadReceiptPdf('o1').subscribe();
    httpMock.expectOne('/api/v1/orders/admin/o1/receipt').flush(new Blob(['x']));
  });

  it('lists/downloads document exports and downloads filtered export', () => {
    service.listDocumentExports({ page: 1 }).subscribe();
    httpMock
      .expectOne((r) => r.url === '/api/v1/orders/admin/exports')
      .flush({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 20 } });

    service.downloadDocumentExport('exp1').subscribe();
    httpMock.expectOne('/api/v1/orders/admin/exports/exp1/download').flush(new Blob(['x']));

    service.downloadExport(['col1', '  ', null as unknown as string, 'col2']).subscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/v1/orders/admin/export');
    expect(req.request.params.getAll('columns')).toEqual(['col1', 'col2']);
    req.flush(new Blob(['x']));
  });

  it('shares and revokes a receipt share token', () => {
    const token = { token: 't', enabled: true };
    service.shareReceipt('o1').subscribe();
    httpMock.expectOne('/api/v1/orders/o1/receipt/share').flush(token);
    service.revokeReceiptShare('o1').subscribe();
    httpMock.expectOne('/api/v1/orders/o1/receipt/revoke').flush(token);
  });
});
