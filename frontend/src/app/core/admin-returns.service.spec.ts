import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AdminReturnsService } from './admin-returns.service';

describe('AdminReturnsService', () => {
  let service: AdminReturnsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AdminReturnsService],
    });
    service = TestBed.inject(AdminReturnsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('searches returns and defaults include_pii to true when omitted', () => {
    service
      .search({ q: 'ref', status_filter: 'requested', order_id: 'o1', page: 2, limit: 10 })
      .subscribe((res) => {
        expect(res.meta.page).toBe(2);
        expect(res.items.length).toBe(1);
        expect(res.items[0].id).toBe('r1');
      });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/returns/admin');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('ref');
    expect(req.request.params.get('status_filter')).toBe('requested');
    expect(req.request.params.get('order_id')).toBe('o1');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('limit')).toBe('10');
    expect(req.request.params.get('include_pii')).toBe('true');
    req.flush({
      items: [
        {
          id: 'r1',
          order_id: 'o1',
          status: 'requested',
          created_at: '2000-01-01T00:00:00+00:00',
        },
      ],
      meta: { total_items: 1, total_pages: 1, page: 2, limit: 10 },
    });
  });

  it('searches returns honouring an explicit include_pii of false', () => {
    service.search({ include_pii: false }).subscribe((res) => {
      expect(res.items.length).toBe(0);
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/returns/admin');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('include_pii')).toBe('false');
    req.flush({ items: [], meta: { total_items: 0, total_pages: 0, page: 1, limit: 20 } });
  });

  it('fetches a single return with default include_pii', () => {
    service.get('r1').subscribe((res) => {
      expect(res.id).toBe('r1');
      expect(res.status).toBe('approved');
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/returns/admin/r1');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('include_pii')).toBe('true');
    req.flush({
      id: 'r1',
      order_id: 'o1',
      status: 'approved',
      reason: 'damaged',
      created_at: '2000-01-01T00:00:00+00:00',
      updated_at: '2000-01-01T00:00:00+00:00',
      items: [],
    });
  });

  it('fetches a single return honouring explicit include_pii false', () => {
    service.get('r1', { include_pii: false }).subscribe((res) => {
      expect(res.id).toBe('r1');
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/returns/admin/r1');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('include_pii')).toBe('false');
    req.flush({
      id: 'r1',
      order_id: 'o1',
      status: 'requested',
      reason: 'damaged',
      created_at: '2000-01-01T00:00:00+00:00',
      updated_at: '2000-01-01T00:00:00+00:00',
      items: [],
    });
  });

  it('updates a return', () => {
    service.update('r1', { status: 'refunded', admin_note: 'done' }).subscribe((res) => {
      expect(res.status).toBe('refunded');
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/returns/admin/r1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'refunded', admin_note: 'done' });
    req.flush({
      id: 'r1',
      order_id: 'o1',
      status: 'refunded',
      reason: 'damaged',
      created_at: '2000-01-01T00:00:00+00:00',
      updated_at: '2000-01-01T00:00:00+00:00',
      items: [],
    });
  });

  it('uploads a return label with default include_pii and FormData body', () => {
    const file = new File(['data'], 'label.pdf', { type: 'application/pdf' });
    service.uploadReturnLabel('r1', file).subscribe((res) => {
      expect(res.has_return_label).toBe(true);
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/returns/admin/r1/label');
    expect(req.request.method).toBe('POST');
    expect(req.request.params.get('include_pii')).toBe('true');
    expect(req.request.body instanceof FormData).toBe(true);
    expect((req.request.body as FormData).get('file')).toBe(file);
    req.flush({
      id: 'r1',
      order_id: 'o1',
      status: 'received',
      reason: 'damaged',
      has_return_label: true,
      created_at: '2000-01-01T00:00:00+00:00',
      updated_at: '2000-01-01T00:00:00+00:00',
      items: [],
    });
  });

  it('uploads a return label honouring explicit include_pii false', () => {
    const file = new File(['data'], 'label.pdf', { type: 'application/pdf' });
    service.uploadReturnLabel('r1', file, { include_pii: false }).subscribe((res) => {
      expect(res.id).toBe('r1');
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/returns/admin/r1/label');
    expect(req.request.method).toBe('POST');
    expect(req.request.params.get('include_pii')).toBe('false');
    req.flush({
      id: 'r1',
      order_id: 'o1',
      status: 'received',
      reason: 'damaged',
      created_at: '2000-01-01T00:00:00+00:00',
      updated_at: '2000-01-01T00:00:00+00:00',
      items: [],
    });
  });

  it('downloads a return label as a blob', () => {
    service.downloadReturnLabel('r1').subscribe((blob) => {
      expect(blob.size).toBe(4);
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/returns/admin/r1/label');
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['data']));
  });

  it('deletes a return label', () => {
    let completed = false;
    service.deleteReturnLabel('r1').subscribe(() => {
      completed = true;
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/returns/admin/r1/label');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    expect(completed).toBe(true);
  });

  it('lists returns by order with default include_pii', () => {
    service.listByOrder('o1').subscribe((res) => {
      expect(res.length).toBe(1);
      expect(res[0].id).toBe('r1');
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/returns/admin/by-order/o1');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('include_pii')).toBe('true');
    req.flush([
      {
        id: 'r1',
        order_id: 'o1',
        status: 'requested',
        reason: 'damaged',
        created_at: '2000-01-01T00:00:00+00:00',
        updated_at: '2000-01-01T00:00:00+00:00',
        items: [],
      },
    ]);
  });

  it('lists returns by order honouring explicit include_pii false', () => {
    service.listByOrder('o1', { include_pii: false }).subscribe((res) => {
      expect(res.length).toBe(0);
    });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/returns/admin/by-order/o1');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('include_pii')).toBe('false');
    req.flush([]);
  });

  it('creates a return request', () => {
    service
      .create({
        order_id: 'o1',
        reason: 'damaged',
        customer_message: 'broken on arrival',
        items: [{ order_item_id: 'i1', quantity: 2 }],
      })
      .subscribe((res) => {
        expect(res.id).toBe('r1');
      });

    const req = httpMock.expectOne((r) => r.url === '/api/v1/returns/admin');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      order_id: 'o1',
      reason: 'damaged',
      customer_message: 'broken on arrival',
      items: [{ order_item_id: 'i1', quantity: 2 }],
    });
    req.flush({
      id: 'r1',
      order_id: 'o1',
      status: 'requested',
      reason: 'damaged',
      created_at: '2000-01-01T00:00:00+00:00',
      updated_at: '2000-01-01T00:00:00+00:00',
      items: [],
    });
  });
});
