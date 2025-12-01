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
});
