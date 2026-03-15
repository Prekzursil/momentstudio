import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ApiService } from './api.service';
import { AccountService } from './account.service';

function expectDownloadExportFetchesJsonBlob(service: AccountService, httpMock: HttpTestingController): void {
  service.downloadExport().subscribe((blob) => {
    expect(blob).toBeTruthy();
  });

  const req = httpMock.expectOne('/api/v1/auth/me/export');
  expect(req.request.method).toBe('GET');
  expect(req.request.responseType).toBe('blob');
  req.flush(new Blob(['{}'], { type: 'application/json' }));
}

function expectRequestDeletionPostsConfirmText(service: AccountService, httpMock: HttpTestingController): void {
  service.requestAccountDeletion('DELETE', 'supersecret').subscribe((resp) => {
    expect(resp.cooldown_hours).toBe(24);
  });

  const req = httpMock.expectOne('/api/v1/auth/me/delete');
  expect(req.request.method).toBe('POST');
  expect(req.request.body).toEqual({ confirm: 'DELETE', password: 'supersecret' });
  req.flush({ requested_at: null, scheduled_for: '2030-01-01T00:00:00+00:00', deleted_at: null, cooldown_hours: 24 });
}

function expectGetDeletionStatusFetchesCurrentStatus(service: AccountService, httpMock: HttpTestingController): void {
  service.getDeletionStatus().subscribe((resp) => {
    expect(resp.cooldown_hours).toBe(24);
    expect(resp.scheduled_for).toBeNull();
  });

  const req = httpMock.expectOne('/api/v1/auth/me/delete/status');
  expect(req.request.method).toBe('GET');
  req.flush({ requested_at: null, scheduled_for: null, deleted_at: null, cooldown_hours: 24 });
}

function expectCancelAccountDeletionPostsToCancelEndpoint(service: AccountService, httpMock: HttpTestingController): void {
  service.cancelAccountDeletion().subscribe((resp) => {
    expect(resp.scheduled_for).toBeNull();
  });

  const req = httpMock.expectOne('/api/v1/auth/me/delete/cancel');
  expect(req.request.method).toBe('POST');
  expect(req.request.body).toEqual({});
  req.flush({ requested_at: null, scheduled_for: null, deleted_at: null, cooldown_hours: 24 });
}

describe('AccountService', () => {
  let service: AccountService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ApiService, AccountService]
    });
    service = TestBed.inject(AccountService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('downloadExport fetches a JSON blob', () => {
    expectDownloadExportFetchesJsonBlob(service, httpMock);
  });

  it('requestAccountDeletion posts confirm text', () => {
    expectRequestDeletionPostsConfirmText(service, httpMock);
  });

  it('getDeletionStatus fetches current deletion status', () => {
    expectGetDeletionStatusFetchesCurrentStatus(service, httpMock);
  });

  it('cancelAccountDeletion posts to cancel endpoint', () => {
    expectCancelAccountDeletionPostsToCancelEndpoint(service, httpMock);
  });
});

describe('AccountService coverage extensions', () => {
  let service: AccountService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ApiService, AccountService],
    });
    service = TestBed.inject(AccountService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('normalizes numeric order fields for paginated orders response', () => {
    let payload: any;
    service.getOrdersPage({ limit: 12, page: 2 }).subscribe((resp) => (payload = resp));

    const req = httpMock.expectOne((r) => r.url.startsWith('/api/v1/orders/me') && r.method === 'GET');
    expect(req.request.method).toBe('GET');
    req.flush({
      items: [
        {
          id: 'o1',
          status: 'paid',
          total_amount: '120.25',
          tax_amount: '22.00',
          fee_amount: '3.5',
          shipping_amount: '14.75',
          currency: 'RON',
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
          items: [{ id: 'i1', product_id: 'p1', quantity: 2, unit_price: '50.1', subtotal: '100.2' }],
        },
      ],
      meta: { total_items: '10', total_pages: '3', page: '2', limit: '12', pending_count: '1' },
    });

    expect(payload.items[0].total_amount).toBeCloseTo(120.25, 3);
    expect(payload.items[0].items[0].unit_price).toBeCloseTo(50.1, 3);
    expect(payload.meta.total_items).toBe(10);
    expect(payload.meta.total_pages).toBe(3);
    expect(payload.meta.page).toBe(2);
    expect(payload.meta.limit).toBe(12);
    expect(payload.meta.pending_count).toBe(1);
  });

  it('covers reorder/cancellation and export-job wrapper endpoints', () => {
    service.reorderOrder('o1').subscribe();
    service.requestOrderCancellation('o1', 'changed mind').subscribe((order) => {
      expect(order.total_amount).toBe(99.99);
      expect(order.items[0].subtotal).toBe(99.99);
    });
    service.startExportJob().subscribe();
    service.getLatestExportJob().subscribe();
    service.getExportJob('job-1').subscribe();
    service.downloadExportJob('job-1').subscribe();

    httpMock.expectOne('/api/v1/orders/o1/reorder').flush({ ok: true });

    const cancelReq = httpMock.expectOne('/api/v1/orders/o1/cancel-request');
    expect(cancelReq.request.method).toBe('POST');
    expect(cancelReq.request.body).toEqual({ reason: 'changed mind' });
    cancelReq.flush({
      id: 'o1',
      status: 'cancel_requested',
      total_amount: '99.99',
      currency: 'RON',
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
      items: [{ id: 'i1', product_id: 'p1', quantity: 1, unit_price: '99.99', subtotal: '99.99' }],
    });

    httpMock.expectOne('/api/v1/auth/me/export/jobs').flush({ id: 'job-1', status: 'pending', progress: 0, created_at: 'x', updated_at: 'x' });
    httpMock.expectOne('/api/v1/auth/me/export/jobs/latest').flush({ id: 'job-1', status: 'running', progress: 42, created_at: 'x', updated_at: 'x' });
    httpMock.expectOne('/api/v1/auth/me/export/jobs/job-1').flush({ id: 'job-1', status: 'succeeded', progress: 100, created_at: 'x', updated_at: 'x' });
    const downloadReq = httpMock.expectOne('/api/v1/auth/me/export/jobs/job-1/download');
    expect(downloadReq.request.responseType).toBe('blob');
    downloadReq.flush(new Blob(['export']));
  });
});
