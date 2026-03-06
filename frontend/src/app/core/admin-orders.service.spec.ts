import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AdminOrdersService } from './admin-orders.service';

let adminOrdersService: AdminOrdersService;
let adminOrdersHttpMock: HttpTestingController;

function configureAdminOrdersServiceSpec(): void {
  TestBed.configureTestingModule({
    imports: [HttpClientTestingModule],
    providers: [AdminOrdersService]
  });
  adminOrdersService = TestBed.inject(AdminOrdersService);
  adminOrdersHttpMock = TestBed.inject(HttpTestingController);
}

function verifyAdminOrdersHttpMock(): void {
  adminOrdersHttpMock.verify();
}

describe('AdminOrdersService search', () => {
  beforeEach(configureAdminOrdersServiceSpec);
  afterEach(verifyAdminOrdersHttpMock);

  it('searches orders', () => {
    adminOrdersService.search({ q: 'ref', status: 'paid', page: 2, limit: 10 }).subscribe((res) => {
      expect(res.meta.page).toBe(2);
      expect(res.meta.limit).toBe(10);
    });

    const req = adminOrdersHttpMock.expectOne((r) => r.url === '/api/v1/orders/admin/search');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('ref');
    expect(req.request.params.get('status')).toBe('paid');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('limit')).toBe('10');
    req.flush({ items: [], meta: { total_items: 0, total_pages: 1, page: 2, limit: 10 } });
  });

  it('normalizes search item amounts and tags while honoring include_pii=false', () => {
    adminOrdersService.search({ q: 'money', include_pii: false }).subscribe((res) => {
      expect(res.items[0].total_amount).toBe(12.75);
      expect(res.items[0].tags).toEqual([]);
    });

    const req = adminOrdersHttpMock.expectOne((r) => r.url === '/api/v1/orders/admin/search');
    expect(req.request.params.get('include_pii')).toBe('false');
    req.flush({
      items: [{ id: 'o1', status: 'paid', total_amount: '12.75', currency: 'RON', created_at: '2000-01-01', tags: 17 }],
      meta: { total_items: 1, total_pages: 1, page: 1, limit: 25 }
    });
  });
});

describe('AdminOrdersService get', () => {
  beforeEach(configureAdminOrdersServiceSpec);
  afterEach(verifyAdminOrdersHttpMock);

  it('fetches an order', () => {
    adminOrdersService.get('o1').subscribe((res) => {
      expect(res.id).toBe('o1');
    });

    const req = adminOrdersHttpMock.expectOne((r) => r.url === '/api/v1/orders/admin/o1');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('include_pii')).toBe('true');
    req.flush({
      id: 'o1',
      status: 'pending',
      total_amount: 10,
      currency: 'RON',
      created_at: '2000-01-01T00:00:00+00:00',
      updated_at: '2000-01-01T00:00:00+00:00',
      items: []
    });
  });

  it('normalizes detail arrays and parses monetary fields for get()', () => {
    adminOrdersService.get('o2', { include_pii: false }).subscribe((res) => {
      expect(res.total_amount).toBe(19.95);
      expect(res.refunds).toEqual([]);
      expect(res.admin_notes).toEqual([]);
      expect(res.fraud_signals).toEqual([]);
      expect(res.shipments).toEqual([]);
      expect(res.items[0].subtotal).toBe(4.5);
    });

    const req = adminOrdersHttpMock.expectOne((r) => r.url === '/api/v1/orders/admin/o2');
    expect(req.request.params.get('include_pii')).toBe('false');
    req.flush({
      id: 'o2',
      status: 'pending',
      total_amount: '19.95',
      tax_amount: '3.1',
      fee_amount: null,
      shipping_amount: undefined,
      refunds: null,
      admin_notes: null,
      fraud_signals: 'bad',
      shipments: 'bad',
      items: [{ unit_price: '4.50', subtotal: '4.50' }]
    });
  });
});

describe('AdminOrdersService update', () => {
  beforeEach(configureAdminOrdersServiceSpec);
  afterEach(verifyAdminOrdersHttpMock);

  it('updates an order', () => {
    adminOrdersService.update('o1', { status: 'paid', tracking_number: 'T123' }).subscribe((res) => {
      expect(res.status).toBe('paid');
    });

    const req = adminOrdersHttpMock.expectOne((r) => r.url === '/api/v1/orders/admin/o1');
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
      items: []
    });
  });
});

describe('AdminOrdersService export', () => {
  beforeEach(configureAdminOrdersServiceSpec);
  afterEach(verifyAdminOrdersHttpMock);

  it('downloads order export', () => {
    adminOrdersService.downloadExport().subscribe((blob) => {
      expect(blob.size).toBe(3);
    });

    const req = adminOrdersHttpMock.expectOne((r) => r.url === '/api/v1/orders/admin/export');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('include_pii')).toBe('true');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['csv'], { type: 'text/csv' }));
  });

  it('filters empty export columns and propagates include_pii override', () => {
    adminOrdersService.downloadExport(['', ' total ', 'status', '  '], { include_pii: false }).subscribe();
    const req = adminOrdersHttpMock.expectOne((r) => r.url === '/api/v1/orders/admin/export');
    expect(req.request.params.getAll('columns')).toEqual([' total ', 'status']);
    expect(req.request.params.get('include_pii')).toBe('false');
    req.flush(new Blob(['csv'], { type: 'text/csv' }));
  });
});

describe('AdminOrdersService wrappers', () => {
  beforeEach(configureAdminOrdersServiceSpec);
  afterEach(verifyAdminOrdersHttpMock);

  it('defaults include_pii in listEmailEvents and returns [] for non-array payloads', () => {
    adminOrdersService.listEmailEvents('o1', { since_hours: 24 }).subscribe((events) => {
      expect(events).toEqual([]);
    });

    const req = adminOrdersHttpMock.expectOne((r) => r.url === '/api/v1/orders/admin/o1/email-events');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('since_hours')).toBe('24');
    expect(req.request.params.get('include_pii')).toBe('true');
    req.flush({ items: [] });
  });

  it('only sends shipping-label action query when action is print', () => {
    adminOrdersService.downloadShippingLabel('o1').subscribe();
    const defaultReq = adminOrdersHttpMock.expectOne('/api/v1/orders/admin/o1/shipping-label');
    expect(defaultReq.request.params.has('action')).toBeFalse();
    defaultReq.flush(new Blob(['pdf']));

    adminOrdersService.downloadShippingLabel('o1', { action: 'print' }).subscribe();
    const printReq = adminOrdersHttpMock.expectOne((r) => r.url.startsWith('/api/v1/orders/admin/o1/shipping-label'));
    expect(printReq.request.params.get('action')).toBe('print');
    printReq.flush(new Blob(['pdf']));
  });
});
