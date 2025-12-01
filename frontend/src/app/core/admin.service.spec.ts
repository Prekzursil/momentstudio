import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  let service: AdminService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AdminService]
    });
    service = TestBed.inject(AdminService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should fetch summary', () => {
    const mock = { products: 1, orders: 2, users: 3, low_stock: 0, sales_30d: 0, orders_30d: 0 };
    service.summary().subscribe((res) => {
      expect(res.products).toBe(1);
    });
    const req = httpMock.expectOne('/api/v1/admin/dashboard/summary');
    expect(req.request.method).toBe('GET');
    req.flush(mock);
  });

  it('should update order status', () => {
    const mock = { id: 'o1', status: 'paid' } as any;
    service.updateOrderStatus('o1', 'paid').subscribe((res) => {
      expect(res.status).toBe('paid');
    });
    const req = httpMock.expectOne('/api/v1/orders/admin/o1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'paid' });
    req.flush(mock);
  });

  it('should create and update coupon', () => {
    const create = { id: 'c1', code: 'SAVE10', active: true } as any;
    const update = { id: 'c1', code: 'SAVE11', active: false } as any;

    service.createCoupon({ code: 'SAVE10', active: true }).subscribe((res) => {
      expect(res.code).toBe('SAVE10');
    });
    const createReq = httpMock.expectOne('/api/v1/admin/dashboard/coupons');
    expect(createReq.request.method).toBe('POST');
    createReq.flush(create);

    service.updateCoupon('c1', { active: false, code: 'SAVE11' }).subscribe((res) => {
      expect(res.active).toBe(false);
    });
    const updateReq = httpMock.expectOne('/api/v1/admin/dashboard/coupons/c1');
    expect(updateReq.request.method).toBe('PATCH');
    expect(updateReq.request.body).toEqual({ active: false, code: 'SAVE11' });
    updateReq.flush(update);
  });

  it('should reorder categories', () => {
    const payload = [{ slug: 'art', sort_order: 2 }];
    service.reorderCategories(payload).subscribe((res) => {
      expect(res[0].sort_order).toBe(2);
    });
    const req = httpMock.expectOne('/api/v1/catalog/categories/reorder');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush([{ id: '1', slug: 'art', name: 'Art', sort_order: 2 }]);
  });

  it('should toggle maintenance', () => {
    service.setMaintenance(true).subscribe((res) => {
      expect(res.enabled).toBeTrue();
    });
    const req = httpMock.expectOne('/api/v1/admin/dashboard/maintenance');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ enabled: true });
    req.flush({ enabled: true });
  });
});
