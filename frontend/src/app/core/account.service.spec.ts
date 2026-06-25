import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ApiService } from './api.service';
import { AccountService } from './account.service';

describe('AccountService', () => {
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

  it('downloadExport fetches a JSON blob', () => {
    service.downloadExport().subscribe((blob) => {
      expect(blob).toBeTruthy();
    });

    const req = httpMock.expectOne('/api/v1/auth/me/export');
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['{}'], { type: 'application/json' }));
  });

  it('requestAccountDeletion posts confirm text', () => {
    service.requestAccountDeletion('DELETE', 'supersecret').subscribe((resp) => {
      expect(resp.cooldown_hours).toBe(24);
    });

    const req = httpMock.expectOne('/api/v1/auth/me/delete');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ confirm: 'DELETE', password: 'supersecret' });
    req.flush({
      requested_at: null,
      scheduled_for: '2030-01-01T00:00:00+00:00',
      deleted_at: null,
      cooldown_hours: 24,
    });
  });

  it('getDeletionStatus fetches current deletion status', () => {
    service.getDeletionStatus().subscribe((resp) => {
      expect(resp.cooldown_hours).toBe(24);
      expect(resp.scheduled_for).toBeNull();
    });

    const req = httpMock.expectOne('/api/v1/auth/me/delete/status');
    expect(req.request.method).toBe('GET');
    req.flush({ requested_at: null, scheduled_for: null, deleted_at: null, cooldown_hours: 24 });
  });

  it('cancelAccountDeletion posts to cancel endpoint', () => {
    service.cancelAccountDeletion().subscribe((resp) => {
      expect(resp.scheduled_for).toBeNull();
    });

    const req = httpMock.expectOne('/api/v1/auth/me/delete/cancel');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ requested_at: null, scheduled_for: null, deleted_at: null, cooldown_hours: 24 });
  });

  it('getProfile fetches the current user', () => {
    service.getProfile().subscribe((u) => expect((u as { id: string }).id).toBe('u1'));
    httpMock.expectOne('/api/v1/auth/me').flush({ id: 'u1' });
  });

  it('getAddresses fetches the address list', () => {
    service.getAddresses().subscribe((a) => expect(a.length).toBe(1));
    const req = httpMock.expectOne('/api/v1/me/addresses');
    expect(req.request.method).toBe('GET');
    req.flush([{ id: 'a1' }]);
  });

  it('getOrders normalizes money fields and tolerates missing items', () => {
    service.getOrders().subscribe((orders) => {
      expect(orders[0].total_amount).toBe(10.5);
      expect(orders[0].items[0].unit_price).toBe(5);
      expect(orders[1].items).toEqual([]);
    });
    httpMock.expectOne('/api/v1/orders').flush([
      { id: 'o1', total_amount: '10.50', items: [{ id: 'i1', unit_price: '5.00', subtotal: '5' }] },
      { id: 'o2', total_amount: '1' },
    ]);
  });

  it('getOrders tolerates a null response', () => {
    service.getOrders().subscribe((orders) => expect(orders).toEqual([]));
    httpMock.expectOne('/api/v1/orders').flush(null);
  });

  it('getOrdersPage normalizes a full meta payload', () => {
    service.getOrdersPage({ q: 'ref', page: 2, limit: 5 }).subscribe((resp) => {
      expect(resp.meta).toEqual({
        total_items: 3,
        total_pages: 1,
        page: 2,
        limit: 5,
        pending_count: 1,
      });
      expect(resp.items[0].total_amount).toBe(2);
    });
    const req = httpMock.expectOne((r) => r.url === '/api/v1/orders/me');
    req.flush({
      items: [{ id: 'o1', total_amount: '2' }],
      meta: { total_items: 3, total_pages: 1, page: 2, limit: 5, pending_count: 1 },
    });
  });

  it('getOrdersPage falls back to defaults for a missing meta', () => {
    service.getOrdersPage({ limit: 7 }).subscribe((resp) => {
      expect(resp.meta).toEqual({
        total_items: 0,
        total_pages: 1,
        page: 1,
        limit: 7,
        pending_count: 0,
      });
      expect(resp.items).toEqual([]);
    });
    httpMock.expectOne((r) => r.url === '/api/v1/orders/me').flush({});
  });

  it('getOrdersPage defaults the limit to 10 when none is provided', () => {
    service.getOrdersPage({}).subscribe((resp) => expect(resp.meta.limit).toBe(10));
    httpMock.expectOne((r) => r.url === '/api/v1/orders/me').flush({ items: [] });
  });

  it('getOrdersPage coerces a zero param limit to 10', () => {
    service.getOrdersPage({ limit: 0 }).subscribe((resp) => expect(resp.meta.limit).toBe(10));
    httpMock
      .expectOne((r) => r.url === '/api/v1/orders/me')
      .flush({ items: [], meta: { limit: 'nope' } });
  });

  it('createReturnRequest posts the payload', () => {
    const payload = {
      order_id: 'o1',
      reason: 'damaged',
      items: [{ order_item_id: 'i1', quantity: 1 }],
    };
    service.createReturnRequest(payload).subscribe();
    const req = httpMock.expectOne('/api/v1/returns');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush({ id: 'r1' });
  });

  it('export job endpoints work', () => {
    service.startExportJob().subscribe();
    httpMock.expectOne('/api/v1/auth/me/export/jobs').flush({ id: 'j1' });

    service.getLatestExportJob().subscribe();
    httpMock.expectOne('/api/v1/auth/me/export/jobs/latest').flush({ id: 'j1' });

    service.getExportJob('a b').subscribe();
    httpMock.expectOne('/api/v1/auth/me/export/jobs/a%20b').flush({ id: 'j1' });

    service.downloadExportJob('a b').subscribe((blob) => expect(blob).toBeTruthy());
    const dl = httpMock.expectOne('/api/v1/auth/me/export/jobs/a%20b/download');
    expect(dl.request.responseType).toBe('blob');
    dl.flush(new Blob(['x']));
  });

  it('order actions hit the right endpoints', () => {
    service.reorderOrder('o1').subscribe();
    const reorder = httpMock.expectOne('/api/v1/orders/o1/reorder');
    expect(reorder.request.method).toBe('POST');
    reorder.flush({});

    service
      .requestOrderCancellation('o1', 'changed mind')
      .subscribe((o) => expect(o.total_amount).toBe(3));
    const cancel = httpMock.expectOne('/api/v1/orders/o1/cancel-request');
    expect(cancel.request.body).toEqual({ reason: 'changed mind' });
    cancel.flush({ id: 'o1', total_amount: '3' });

    service.downloadReceipt('o1').subscribe();
    httpMock.expectOne('/api/v1/orders/o1/receipt').flush(new Blob(['x']));

    service.shareReceipt('o1').subscribe();
    httpMock.expectOne('/api/v1/orders/o1/receipt/share').flush({ token: 't' });

    service.revokeReceiptShare('o1').subscribe();
    httpMock.expectOne('/api/v1/orders/o1/receipt/revoke').flush({ token: 't' });
  });

  it('address CRUD hits the right endpoints', () => {
    service.createAddress({ line1: 'a', city: 'b', postal_code: 'c', country: 'RO' }).subscribe();
    const create = httpMock.expectOne('/api/v1/me/addresses');
    expect(create.request.method).toBe('POST');
    create.flush({ id: 'a1' });

    service.updateAddress('a1', { city: 'x' }).subscribe();
    const patch = httpMock.expectOne('/api/v1/me/addresses/a1');
    expect(patch.request.method).toBe('PATCH');
    patch.flush({ id: 'a1' });

    service.deleteAddress('a1').subscribe();
    const del = httpMock.expectOne('/api/v1/me/addresses/a1');
    expect(del.request.method).toBe('DELETE');
    del.flush(null);
  });
});
