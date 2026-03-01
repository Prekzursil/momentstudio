import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Observable, of } from 'rxjs';

import { AdminOrdersService } from './admin-orders.service';
import { AdminService } from './admin.service';
import { AnalyticsService } from './analytics.service';
import { ApiService } from './api.service';
import { AuthResponse, AuthService } from './auth.service';

type ApiSpy = jasmine.SpyObj<Pick<ApiService, 'get' | 'post' | 'patch' | 'delete'>>;

type RouterSpy = jasmine.SpyObj<Pick<Router, 'navigateByUrl'>>;

type AuthInternals = {
  persist: (res: AuthResponse, remember: boolean) => void;
  setUser: (user: unknown) => void;
};

function configureHttpService<T>(token: new (...args: never[]) => T): { service: T; http: HttpTestingController } {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [HttpClientTestingModule], providers: [token] });
  return { service: TestBed.inject(token), http: TestBed.inject(HttpTestingController) };
}

function configureAuthService(): {
  service: AuthService;
  api: ApiSpy;
  router: RouterSpy;
  internals: AuthInternals;
} {
  const api = jasmine.createSpyObj<ApiSpy>('ApiService', ['get', 'post', 'patch', 'delete']);
  const router = jasmine.createSpyObj<RouterSpy>('Router', ['navigateByUrl']);
  router.navigateByUrl.and.returnValue(Promise.resolve(true));
  const proto = AuthService.prototype as unknown as { installRevalidationHooks: () => void };
  const originalInstallHooks = proto.installRevalidationHooks;
  proto.installRevalidationHooks = () => void 0;
  const service = new AuthService(api as unknown as ApiService, router as unknown as Router);
  proto.installRevalidationHooks = originalInstallHooks;
  return { service, api, router, internals: service as unknown as AuthInternals };
}

function readSync<T>(obs$: Observable<T>): T {
  let emitted = false;
  let value!: T;
  obs$.subscribe((next) => {
    emitted = true;
    value = next;
  });
  if (!emitted) throw new Error('Expected sync emission');
  return value;
}

function expectPath(http: HttpTestingController, path: string, method?: string) {
  return http.expectOne((req) => req.url === path && (!method || req.method === method));
}

describe('Service coverage wave - AdminService wrappers', () => {
  it('covers dashboard metric and list endpoints', () => {
    const { service, http } = configureHttpService(AdminService);

    service.paymentsHealth({ since_hours: 48 }).subscribe();
    service.refundsBreakdown({ window_days: 30 }).subscribe();
    service.shippingPerformance({ window_days: 7 }).subscribe();
    service.stockoutImpact({ window_days: 30, limit: 10 }).subscribe();
    service.channelAttribution({ range_days: 14, limit: 3 }).subscribe();
    service.funnel({ range_days: 14 }).subscribe();
    service.channelBreakdown({ range_days: 14 }).subscribe();
    service.scheduledTasks().subscribe();

    expect(expectPath(http, '/api/v1/admin/dashboard/payments-health').request.params.get('since_hours')).toBe('48');
    expectPath(http, '/api/v1/admin/dashboard/refunds-breakdown').flush({});
    expectPath(http, '/api/v1/admin/dashboard/shipping-performance').flush({});
    expectPath(http, '/api/v1/admin/dashboard/stockout-impact').flush({});
    expectPath(http, '/api/v1/admin/dashboard/channel-attribution').flush({});
    expectPath(http, '/api/v1/admin/dashboard/funnel').flush({});
    expectPath(http, '/api/v1/admin/dashboard/channel-breakdown').flush({});
    expectPath(http, '/api/v1/admin/dashboard/scheduled-tasks').flush({});
    http.verify();
  });

  it('covers source-aware category/product wrappers and multipart uploads', () => {
    const { service, http } = configureHttpService(AdminService);
    const file = new File(['x'], 'cover.png', { type: 'image/png' });

    service.bulkUpdateProducts([{ product_id: 'p1', sort_order: 0 }], { source: 'storefront' }).subscribe();
    service.createCategory({ slug: 'chairs', name: 'Chairs' }, { source: 'storefront' }).subscribe();
    service.updateCategory('chairs', { name: 'Scaune' }, { source: 'storefront' }).subscribe();
    service.uploadCategoryImage('chairs', 'thumbnail', file, { source: 'storefront' }).subscribe();
    service.importCategoriesCsv(file, false).subscribe();
    service.importProductsCsv(file, false).subscribe();

    expect(expectPath(http, '/api/v1/catalog/products/bulk-update').request.params.get('source')).toBe('storefront');
    expect(expectPath(http, '/api/v1/catalog/categories').request.params.get('source')).toBe('storefront');
    expect(expectPath(http, '/api/v1/catalog/categories/chairs').request.params.get('source')).toBe('storefront');

    const uploadReq = expectPath(http, '/api/v1/catalog/categories/chairs/images/thumbnail');
    expect(uploadReq.request.body instanceof FormData).toBeTrue();
    uploadReq.flush({});

    const importCategoryReq = expectPath(http, '/api/v1/catalog/categories/import');
    expect(importCategoryReq.request.body instanceof FormData).toBeTrue();
    expect(importCategoryReq.request.params.get('dry_run')).toBe('false');
    importCategoryReq.flush({});

    const importProductReq = expectPath(http, '/api/v1/catalog/products/import');
    expect(importProductReq.request.body instanceof FormData).toBeTrue();
    expect(importProductReq.request.params.get('dry_run')).toBe('false');
    importProductReq.flush({});
    http.verify();
  });

  it('covers audit/session/inventory and relationship wrappers', () => {
    const { service, http } = configureHttpService(AdminService);

    service.audit().subscribe();
    service.auditEntries({ entity: 'product', limit: 5 }).subscribe();
    service.auditRetention().subscribe();
    service.purgeAuditRetention({ confirm: 'YES', dry_run: true }).subscribe();
    service.listUserSessions('u1').subscribe();
    service.revokeSession('u1', 's1').subscribe();
    service.restockList({ page: 1, limit: 10, include_variants: true, default_threshold: 2 }).subscribe();
    service.reservedCarts({ product_id: 'p1', include_pii: false }).subscribe();
    service.reservedOrders({ product_id: 'p1', include_pii: false }).subscribe();
    service.upsertRestockNote({ product_id: 'p1', note: 'restock soon' } as any).subscribe();
    service.getProductAudit('slug-1', 20).subscribe();
    service.getProductRelationships('slug-1').subscribe();
    service.updateProductRelationships('slug-1', { up_sells: [], cross_sells: [] } as any).subscribe();

    expectPath(http, '/api/v1/admin/dashboard/audit').flush({});
    expect(expectPath(http, '/api/v1/admin/dashboard/audit/entries').request.params.get('entity')).toBe('product');
    expectPath(http, '/api/v1/admin/dashboard/audit/retention').flush({});
    expectPath(http, '/api/v1/admin/dashboard/audit/retention/purge').flush({});
    expectPath(http, '/api/v1/admin/dashboard/sessions/u1').flush([]);
    expectPath(http, '/api/v1/admin/dashboard/sessions/u1/s1/revoke').flush({});
    expectPath(http, '/api/v1/admin/dashboard/inventory/restock-list').flush({ items: [], meta: {} });
    expectPath(http, '/api/v1/admin/dashboard/inventory/reservations/carts').flush({ items: [] });
    expectPath(http, '/api/v1/admin/dashboard/inventory/reservations/orders').flush({ items: [] });
    expectPath(http, '/api/v1/admin/dashboard/inventory/restock-notes').flush({});
    expectPath(http, '/api/v1/catalog/products/slug-1/audit').flush([]);
    http.expectOne((req) => req.url === '/api/v1/catalog/products/slug-1/relationships' && req.method === 'GET').flush({});
    http.expectOne((req) => req.url === '/api/v1/catalog/products/slug-1/relationships' && req.method === 'PUT').flush({});
    http.verify();
  });
});

describe('Service coverage wave - AdminOrdersService branches', () => {
  it('covers detail-mapping branches for fraud/addresses/shipment/refund/note/tag', () => {
    const { service, http } = configureHttpService(AdminOrdersService);
    const mapped = {
      total_amount: '10.5',
      tax_amount: '1.2',
      fee_amount: '0.9',
      shipping_amount: '2.1',
      refunds: [{ amount: '1.1' }],
      admin_notes: null,
      fraud_signals: null,
      shipments: null,
      tags: 'bad',
      items: [{ unit_price: '3.0', subtotal: '6.0' }]
    };

    service.reviewFraud('o1', { decision: 'approve' }, { include_pii: false }).subscribe((res: any) => {
      expect(res.total_amount).toBe(10.5);
      expect(res.items[0].subtotal).toBe(6);
    });
    service.updateAddresses('o1', { note: 'x' }, { include_pii: false }).subscribe();
    service.createShipment('o1', { tracking_number: 'trk' }, { include_pii: false }).subscribe();
    service.updateShipment('o1', 's1', { tracking_number: 'trk2' }, { include_pii: false }).subscribe();
    service.deleteShipment('o1', 's1', { include_pii: false }).subscribe();
    service.fulfillItem('o1', 'it1', 2, { include_pii: false }).subscribe();
    service.createPartialRefund('o1', { amount: '5.00', note: 'partial' }).subscribe();
    service.addAdminNote('o1', 'note', { include_pii: false }).subscribe();
    service.addOrderTag('o1', 'urgent', { include_pii: false }).subscribe();
    service.removeOrderTag('o1', 'vip tag', { include_pii: false }).subscribe();

    expectPath(http, '/api/v1/orders/admin/o1/fraud-review', 'POST').flush(mapped);
    expectPath(http, '/api/v1/orders/admin/o1/addresses', 'PATCH').flush(mapped);
    expectPath(http, '/api/v1/orders/admin/o1/shipments', 'POST').flush(mapped);
    http.expectOne((req) => req.url === '/api/v1/orders/admin/o1/shipments/s1' && req.method === 'PATCH').flush(mapped);
    http.expectOne((req) => req.url === '/api/v1/orders/admin/o1/shipments/s1' && req.method === 'DELETE').flush(mapped);
    expectPath(http, '/api/v1/orders/admin/o1/items/it1/fulfill', 'POST').flush(mapped);
    expectPath(http, '/api/v1/orders/admin/o1/refunds', 'POST').flush(mapped);
    expectPath(http, '/api/v1/orders/admin/o1/notes', 'POST').flush(mapped);
    expectPath(http, '/api/v1/orders/admin/o1/tags', 'POST').flush(mapped);
    expectPath(http, '/api/v1/orders/admin/o1/tags/vip%20tag', 'DELETE').flush(mapped);
    http.verify();
  });

  it('covers shipping label and payment action wrappers', () => {
    const { service, http } = configureHttpService(AdminOrdersService);
    const file = new File(['pdf'], 'label.pdf', { type: 'application/pdf' });

    service.uploadShippingLabel('o1', file, { include_pii: false }).subscribe();
    service.downloadShippingLabel('o1').subscribe();
    service.deleteShippingLabel('o1').subscribe();
    service.retryPayment('o1').subscribe();
    service.capturePayment('o1').subscribe();
    service.voidPayment('o1').subscribe();
    service.requestRefund('o1', { note: 'manual' }).subscribe();

    const uploadReq = http.expectOne((req) => req.url === '/api/v1/orders/admin/o1/shipping-label' && req.method === 'POST');
    expect(uploadReq.request.body instanceof FormData).toBeTrue();
    expect(uploadReq.request.params.get('include_pii')).toBe('false');
    uploadReq.flush({});

    http.expectOne((req) => req.url === '/api/v1/orders/admin/o1/shipping-label' && req.method === 'GET').flush(new Blob(['x']));
    http.expectOne((req) => req.url === '/api/v1/orders/admin/o1/shipping-label' && req.method === 'DELETE').flush({});
    expectPath(http, '/api/v1/orders/admin/o1/retry-payment', 'POST').flush({});
    expectPath(http, '/api/v1/orders/admin/o1/capture-payment', 'POST').flush({});
    expectPath(http, '/api/v1/orders/admin/o1/void-payment', 'POST').flush({});
    expectPath(http, '/api/v1/orders/admin/o1/refund', 'POST').flush({});
    http.verify();
  });

  it('covers tag/report helpers and batch document exports', () => {
    const { service, http } = configureHttpService(AdminOrdersService);

    service.listOrderTags().subscribe((items) => expect(items).toEqual(['vip']));
    service.listOrderTagStats().subscribe((rows) => expect(rows[0].count).toBe(3));
    service.renameOrderTag({ from_tag: 'A', to_tag: 'B' }).subscribe((res) => expect(res.total).toBe(4));
    service.downloadBatchPackingSlips(['o1']).subscribe();
    service.downloadPickListCsv(['o1']).subscribe();
    service.downloadPickListPdf(['o1']).subscribe();
    service.downloadBatchShippingLabelsZip(['o1']).subscribe();
    service.downloadReceiptPdf('o1').subscribe();
    service.listDocumentExports({ page: 1, limit: 10 }).subscribe();
    service.downloadDocumentExport('exp1').subscribe();
    service.sendDeliveryEmail('o1').subscribe();
    service.resendOrderConfirmationEmail('o1', 'note').subscribe();
    service.resendDeliveryEmail('o1', 'note').subscribe();
    service.shareReceipt('o1').subscribe();
    service.revokeReceiptShare('o1').subscribe();

    expectPath(http, '/api/v1/orders/admin/tags', 'GET').flush({ items: ['vip', ''] });
    expectPath(http, '/api/v1/orders/admin/tags/stats', 'GET').flush({ items: [{ tag: 'vip', count: '3' }, { tag: '', count: 1 }] });
    expectPath(http, '/api/v1/orders/admin/tags/rename', 'POST').flush({ from_tag: 'A', to_tag: 'B', updated: '2', merged: '1', total: '4' });
    expectPath(http, '/api/v1/orders/admin/batch/packing-slips', 'POST').flush(new Blob(['x']));
    expectPath(http, '/api/v1/orders/admin/batch/pick-list.csv', 'POST').flush(new Blob(['x']));
    expectPath(http, '/api/v1/orders/admin/batch/pick-list.pdf', 'POST').flush(new Blob(['x']));
    expectPath(http, '/api/v1/orders/admin/batch/shipping-labels.zip', 'POST').flush(new Blob(['x']));
    expectPath(http, '/api/v1/orders/admin/o1/receipt', 'GET').flush(new Blob(['x']));
    expectPath(http, '/api/v1/orders/admin/exports', 'GET').flush({ items: [], meta: { total_items: 0, total_pages: 1, page: 1, limit: 10 } });
    expectPath(http, '/api/v1/orders/admin/exports/exp1/download', 'GET').flush(new Blob(['x']));
    http.expectOne((req) => req.url === '/api/v1/orders/admin/o1/delivery-email' && req.body?.note == null).flush({});
    expectPath(http, '/api/v1/orders/admin/o1/confirmation-email', 'POST').flush({});
    http.expectOne((req) => req.url === '/api/v1/orders/admin/o1/delivery-email' && req.body?.note === 'note').flush({});
    expectPath(http, '/api/v1/orders/o1/receipt/share', 'POST').flush({});
    expectPath(http, '/api/v1/orders/o1/receipt/revoke', 'POST').flush({});
    http.verify();
  });
});

describe('Service coverage wave - AnalyticsService branches', () => {
  const globalScope = globalThis as typeof globalThis & { dataLayer?: unknown[] };

  beforeEach(() => {
    globalThis.localStorage.clear();
    globalThis.sessionStorage.clear();
    globalScope.dataLayer = [];
  });

  it('starts a session once and sends attribution payload when query has UTM params', () => {
    globalThis.history.replaceState({}, document.title, '/shop?utm_source=ig&utm_medium=social&utm_campaign=launch');

    const api = jasmine.createSpyObj<ApiService>('ApiService', ['post']);
    api.post.and.callFake(((path: string) => {
      if (path === '/analytics/token') return of({ token: 'token-1', expires_in: 3600 });
      return of({ received: true });
    }) as any);

    const service = new AnalyticsService(api);
    service.setEnabled(true);
    service.startSession();
    service.startSession();

    const eventCalls = (api.post.calls.allArgs() as unknown as Array<readonly unknown[]>).filter(
      (args) => args[0] === '/analytics/events'
    );
    expect(eventCalls.length).toBeGreaterThan(0);
    const sessionStartCall = eventCalls.find((args) => (args[1] as any)?.event === 'session_start');
    const payload = ((sessionStartCall?.[1] as any)?.payload ?? {}) as Record<string, unknown>;
    expect(payload['utm_source']).toBe('ig');
    expect(payload['utm_medium']).toBe('social');
  });

  it('clears stale token and posts events with silent headers', () => {
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['post']);
    api.post.and.callFake(((path: string) => {
      if (path === '/analytics/token') return of({ token: 'next-token', expires_in: 3600 });
      return of({ received: true });
    }) as any);

    globalThis.sessionStorage.setItem('analytics.token.v1', 'stale');
    globalThis.sessionStorage.setItem('analytics.token_expires_at.v1', String(Date.now() - 1000));

    const service = new AnalyticsService(api);
    service.setEnabled(true);
    service.track('checkout_start', { plan: 'pro' });

    const eventCall = api.post.calls.allArgs().find((args) => args[0] === '/analytics/events');
    expect(eventCall?.[2]).toEqual(jasmine.objectContaining({ 'X-Silent': '1', 'X-Analytics-Token': 'next-token' }));
  });
});

describe('Service coverage wave - AuthService branches', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    globalThis.sessionStorage.clear();
  });

  it('covers register/change-password/google start/two-factor completion', () => {
    const { service, api, internals } = configureAuthService();
    const persistSpy = spyOn(internals, 'persist').and.callThrough();

    const authRes: AuthResponse = {
      user: { id: 'u1', email: 'ana@example.com', username: 'ana', role: 'customer' },
      tokens: { access_token: 'x', refresh_token: 'y', token_type: 'bearer' }
    };

    api.post.and.returnValues(of(authRes), of({ detail: 'ok' }), of(authRes));
    api.get.and.returnValue(of({ auth_url: 'https://accounts.example/start' }));

    readSync(service.register({
      name: 'Ana',
      username: 'ana',
      email: 'ana@example.com',
      password: 'Pass1234!',
      first_name: 'Ana',
      last_name: 'Pop',
      date_of_birth: '1990-01-01',
      phone: '+40123456789',
      accept_terms: true,
      accept_privacy: true
    }));

    readSync(service.changePassword('old', 'new'));
    readSync(service.startGoogleLogin());
    readSync(service.completeTwoFactorLogin('tfa-token', '123456', true));

    expect(persistSpy).toHaveBeenCalledTimes(2);
    expect(api.post).toHaveBeenCalledWith('/auth/password/change', { current_password: 'old', new_password: 'new' });
    expect(api.get).toHaveBeenCalledWith('/auth/google/start');
  });

  it('covers authenticated preference/profile updates and session helpers', () => {
    const { service, api, internals } = configureAuthService();
    const user = { id: 'u1', email: 'ana@example.com', username: 'ana', role: 'customer' };

    internals.setUser(user as any);
    api.patch.and.returnValues(
      of({ ...user, notify_marketing: true }),
      of({ ...user, training_mode: true }),
      of({ ...user, name: 'Ana Pop' })
    );
    api.post.and.returnValues(of({ revoked: 2 }), of({ setup_token: 'x' }), of({ enabled: true }));
    api.get.and.returnValues(of([]), of([]), of({ enabled: false }));

    readSync(service.updateNotificationPreferences({ notify_marketing: true }));
    readSync(service.updateTrainingMode(true));
    readSync(service.updateProfile({ name: 'Ana Pop' }));
    readSync(service.listSessions());
    readSync(service.revokeOtherSessions('secret'));
    readSync(service.listSecurityEvents(10));
    readSync(service.getTwoFactorStatus());
    readSync(service.startTwoFactorSetup('secret'));
    readSync(service.enableTwoFactor('123456'));

    expect(api.patch).toHaveBeenCalledWith('/auth/me/notifications', { notify_marketing: true });
    expect(api.patch).toHaveBeenCalledWith('/auth/me/training-mode', { enabled: true });
    expect(api.patch).toHaveBeenCalledWith('/auth/me', { name: 'Ana Pop' });
    expect(api.post).toHaveBeenCalledWith('/auth/me/sessions/revoke-others', { password: 'secret' });
    expect(api.get).toHaveBeenCalledWith('/auth/me/security-events', { limit: 10 });
  });
});
