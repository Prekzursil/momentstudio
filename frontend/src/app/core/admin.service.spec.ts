import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AdminService } from './admin.service';

let adminService: AdminService;
let adminServiceHttpMock: HttpTestingController;

describe('AdminService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AdminService]
    });
    adminService = TestBed.inject(AdminService);
    adminServiceHttpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    adminServiceHttpMock.verify();
  });

  defineSummarySpec();
  defineUpdateOrderStatusSpec();
  defineCreateAndUpdateCouponSpec();
  defineReorderCategoriesSpec();
  defineMaintenanceToggleSpec();
  defineLowStockSpec();
  defineUpdateUserRoleSpec();
  defineMaintenanceStateSpec();
  defineListCouponsSpec();
  defineSocialThumbnailSpec();
});

const defineSummarySpec = (): void => {
  it('should fetch summary', () => {
    const mock = { products: 1, orders: 2, users: 3, low_stock: 0, sales_30d: 0, orders_30d: 0 };
    adminService.summary().subscribe((res) => {
      expect(res.products).toBe(1);
    });
    const req = adminServiceHttpMock.expectOne('/api/v1/admin/dashboard/summary');
    expect(req.request.method).toBe('GET');
    req.flush(mock);
  });
};

const defineUpdateOrderStatusSpec = (): void => {
  it('should update order status', () => {
    const mock = { id: 'o1', status: 'paid' } as any;
    adminService.updateOrderStatus('o1', 'paid').subscribe((res) => {
      expect(res.status).toBe('paid');
    });
    const req = adminServiceHttpMock.expectOne('/api/v1/orders/admin/o1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'paid' });
    req.flush(mock);
  });
};

const defineCreateAndUpdateCouponSpec = (): void => {
  it('should create and update coupon', () => {
    const create = { id: 'c1', code: 'SAVE10', active: true } as any;
    const update = { id: 'c1', code: 'SAVE11', active: false } as any;

    adminService.createCoupon({ code: 'SAVE10', active: true }).subscribe((res) => {
      expect(res.code).toBe('SAVE10');
    });
    const createReq = adminServiceHttpMock.expectOne('/api/v1/admin/dashboard/coupons');
    expect(createReq.request.method).toBe('POST');
    createReq.flush(create);

    adminService.updateCoupon('c1', { active: false, code: 'SAVE11' }).subscribe((res) => {
      expect(res.active).toBe(false);
    });
    const updateReq = adminServiceHttpMock.expectOne('/api/v1/admin/dashboard/coupons/c1');
    expect(updateReq.request.method).toBe('PATCH');
    expect(updateReq.request.body).toEqual({ active: false, code: 'SAVE11' });
    updateReq.flush(update);

    adminService.invalidateCouponStripeMappings('c1').subscribe((res) => {
      expect(res.deleted_mappings).toBe(2);
    });
    const invalidateReq = adminServiceHttpMock.expectOne('/api/v1/admin/dashboard/coupons/c1/stripe/invalidate');
    expect(invalidateReq.request.method).toBe('POST');
    expect(invalidateReq.request.body).toEqual({});
    invalidateReq.flush({ deleted_mappings: 2 });
  });
};

const defineReorderCategoriesSpec = (): void => {
  it('should reorder categories', () => {
    const payload = [{ slug: 'art', sort_order: 2 }];
    adminService.reorderCategories(payload).subscribe((res) => {
      expect(res[0].sort_order).toBe(2);
    });
    const req = adminServiceHttpMock.expectOne('/api/v1/catalog/categories/reorder');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(payload);
    req.flush([{ id: '1', slug: 'art', name: 'Art', sort_order: 2 }]);
  });
};

const defineMaintenanceToggleSpec = (): void => {
  it('should toggle maintenance', () => {
    adminService.setMaintenance(true).subscribe((res) => {
      expect(res.enabled).toBeTrue();
    });
    const req = adminServiceHttpMock.expectOne('/api/v1/admin/dashboard/maintenance');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ enabled: true });
    req.flush({ enabled: true });
  });
};

const defineLowStockSpec = (): void => {
  it('should fetch low stock items', () => {
    adminService.lowStock().subscribe((items) => {
      expect(items.length).toBe(1);
    });
    const req = adminServiceHttpMock.expectOne('/api/v1/admin/dashboard/low-stock');
    expect(req.request.method).toBe('GET');
    req.flush([{ id: '1', name: 'P', stock_quantity: 1, sku: 'SKU', slug: 'p' }]);
  });
};

const defineUpdateUserRoleSpec = (): void => {
  it('should update user role and revoke sessions', () => {
    adminService.updateUserRole('u1', 'admin', 'pw').subscribe((res) => {
      expect(res.role).toBe('admin');
    });
    const roleReq = adminServiceHttpMock.expectOne('/api/v1/admin/dashboard/users/u1/role');
    expect(roleReq.request.method).toBe('PATCH');
    expect(roleReq.request.body).toEqual({ role: 'admin', password: 'pw' });
    roleReq.flush({ id: 'u1', role: 'admin' });

    adminService.revokeSessions('u1').subscribe((res) => {
      expect(res).toBeNull();
    });
    const revokeReq = adminServiceHttpMock.expectOne('/api/v1/admin/dashboard/sessions/u1/revoke');
    expect(revokeReq.request.method).toBe('POST');
    revokeReq.flush(null);
  });
};

const defineMaintenanceStateSpec = (): void => {
  it('should fetch maintenance state', () => {
    adminService.getMaintenance().subscribe((res) => {
      expect(res.enabled).toBeFalse();
    });
    const req = adminServiceHttpMock.expectOne('/api/v1/admin/dashboard/maintenance');
    expect(req.request.method).toBe('GET');
    req.flush({ enabled: false });
  });
};

const defineListCouponsSpec = (): void => {
  it('should list coupons', () => {
    adminService.coupons().subscribe((res) => {
      expect(res[0].code).toBe('SAVE10');
    });
    const req = adminServiceHttpMock.expectOne('/api/v1/admin/dashboard/coupons');
    expect(req.request.method).toBe('GET');
    req.flush([{ id: 'c1', code: 'SAVE10', active: true }]);
  });
};

const defineSocialThumbnailSpec = (): void => {
  it('should fetch social thumbnail', () => {
    adminService.fetchSocialThumbnail('https://www.instagram.com/example/').subscribe((res) => {
      expect(res.thumbnail_url).toBe('https://cdn.example/thumb.png');
    });

    const req = adminServiceHttpMock.expectOne('/api/v1/content/admin/social/thumbnail');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ url: 'https://www.instagram.com/example/' });
    req.flush({ thumbnail_url: 'https://cdn.example/thumb.png' });
  });
};
