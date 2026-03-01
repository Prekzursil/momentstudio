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
  defineGlobalSearchSpec();
  defineReorderProductImageSpec();
  definePreviewTokenSpec();
  defineDeleteContentSpec();
});

function defineSummarySpec(): void {
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

function defineUpdateOrderStatusSpec(): void {
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

function defineCreateAndUpdateCouponSpec(): void {
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

function defineReorderCategoriesSpec(): void {
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

function defineMaintenanceToggleSpec(): void {
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

function defineLowStockSpec(): void {
  it('should fetch low stock items', () => {
    adminService.lowStock().subscribe((items) => {
      expect(items.length).toBe(1);
    });
    const req = adminServiceHttpMock.expectOne('/api/v1/admin/dashboard/low-stock');
    expect(req.request.method).toBe('GET');
    req.flush([{ id: '1', name: 'P', stock_quantity: 1, sku: 'SKU', slug: 'p' }]);
  });
};

function defineUpdateUserRoleSpec(): void {
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

function defineMaintenanceStateSpec(): void {
  it('should fetch maintenance state', () => {
    adminService.getMaintenance().subscribe((res) => {
      expect(res.enabled).toBeFalse();
    });
    const req = adminServiceHttpMock.expectOne('/api/v1/admin/dashboard/maintenance');
    expect(req.request.method).toBe('GET');
    req.flush({ enabled: false });
  });
};

function defineListCouponsSpec(): void {
  it('should list coupons', () => {
    adminService.coupons().subscribe((res) => {
      expect(res[0].code).toBe('SAVE10');
    });
    const req = adminServiceHttpMock.expectOne('/api/v1/admin/dashboard/coupons');
    expect(req.request.method).toBe('GET');
    req.flush([{ id: 'c1', code: 'SAVE10', active: true }]);
  });
};

function defineSocialThumbnailSpec(): void {
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

function defineGlobalSearchSpec(): void {
  it('should set include_pii by default and allow explicit false', () => {
    adminService.globalSearch('invoice-1').subscribe();
    const defaultReq = adminServiceHttpMock.expectOne((r) => r.url === '/api/v1/admin/dashboard/search');
    expect(defaultReq.request.method).toBe('GET');
    expect(defaultReq.request.params.get('q')).toBe('invoice-1');
    expect(defaultReq.request.params.get('include_pii')).toBe('true');
    defaultReq.flush({ results: [] });

    adminService.globalSearch('invoice-2', { include_pii: false }).subscribe();
    const hiddenReq = adminServiceHttpMock.expectOne((r) => r.url === '/api/v1/admin/dashboard/search');
    expect(hiddenReq.request.params.get('q')).toBe('invoice-2');
    expect(hiddenReq.request.params.get('include_pii')).toBe('false');
    hiddenReq.flush({ results: [] });
  });
};

function defineReorderProductImageSpec(): void {
  it('should send sort order and optional source when reordering product images', () => {
    adminService.reorderProductImage('slug-a', 'img-a', 4, { source: 'storefront' }).subscribe();
    const sourcedReq = adminServiceHttpMock.expectOne((r) => r.url.startsWith('/api/v1/catalog/products/slug-a/images/img-a/sort'));
    expect(sourcedReq.request.method).toBe('PATCH');
    expect(sourcedReq.request.body).toEqual({});
    expect(sourcedReq.request.params.get('sort_order')).toBe('4');
    expect(sourcedReq.request.params.get('source')).toBe('storefront');
    sourcedReq.flush({ id: 'p-1' });

    adminService.reorderProductImage('slug-b', 'img-b', 9).subscribe();
    const plainReq = adminServiceHttpMock.expectOne((r) => r.url.startsWith('/api/v1/catalog/products/slug-b/images/img-b/sort'));
    expect(plainReq.request.params.get('sort_order')).toBe('9');
    expect(plainReq.request.params.has('source')).toBeFalse();
    plainReq.flush({ id: 'p-2' });
  });
};

function definePreviewTokenSpec(): void {
  it('should build preview token URLs with encoded slug and optional query params', () => {
    adminService.createPagePreviewToken('home/main', { lang: 'ro', expires_minutes: 30 }).subscribe();
    const pageReq = adminServiceHttpMock.expectOne(
      '/api/v1/content/pages/home%2Fmain/preview-token?lang=ro&expires_minutes=30'
    );
    expect(pageReq.request.method).toBe('POST');
    expect(pageReq.request.body).toEqual({});
    pageReq.flush({ token: 'page' });

    adminService.createHomePreviewToken().subscribe();
    const homeReq = adminServiceHttpMock.expectOne('/api/v1/content/home/preview-token');
    expect(homeReq.request.method).toBe('POST');
    expect(homeReq.request.body).toEqual({});
    homeReq.flush({ token: 'home' });
  });
};

function defineDeleteContentSpec(): void {
  it('should URL-encode content keys when deleting content', () => {
    adminService.deleteContent('about/us').subscribe((res) => {
      expect(res).toBeNull();
    });
    const req = adminServiceHttpMock.expectOne('/api/v1/content/admin/about%2Fus');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
};
