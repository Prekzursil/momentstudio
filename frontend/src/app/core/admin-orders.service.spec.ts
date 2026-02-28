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
});
