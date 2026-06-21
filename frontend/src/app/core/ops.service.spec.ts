import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ApiService } from './api.service';
import { OpsService } from './ops.service';

describe('OpsService', () => {
  let service: OpsService;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', [
      'get',
      'post',
      'patch',
      'delete',
      'getBlob',
    ]);
    api.get.and.returnValue(of({}));
    api.post.and.returnValue(of({}));
    api.patch.and.returnValue(of({}));
    api.delete.and.returnValue(of(undefined));
    api.getBlob.and.returnValue(of(new Blob()));

    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, OpsService],
    });
    service = TestBed.inject(OpsService);
  });

  it('getActiveBanner returns the banner when present', () => {
    api.get.and.returnValue(of({ level: 'info' }));
    let result: unknown;
    service.getActiveBanner().subscribe((b) => (result = b));
    expect(api.get).toHaveBeenCalledWith('/ops/banner');
    expect(result).toEqual({ level: 'info' });
  });

  it('getActiveBanner maps an empty response to null', () => {
    api.get.and.returnValue(of(null));
    let result: unknown = 'x';
    service.getActiveBanner().subscribe((b) => (result = b));
    expect(result).toBeNull();
  });

  it('getActiveBanner swallows errors and returns null', () => {
    api.get.and.returnValue(throwError(() => new Error('down')));
    let result: unknown = 'x';
    service.getActiveBanner().subscribe((b) => (result = b));
    expect(result).toBeNull();
  });

  it('CRUD banner endpoints map to the API service', () => {
    service.listBanners().subscribe();
    expect(api.get).toHaveBeenCalledWith('/ops/admin/banners');

    const create = { is_active: true } as never;
    service.createBanner(create).subscribe();
    expect(api.post).toHaveBeenCalledWith('/ops/admin/banners', create);

    const update = { is_active: false } as never;
    service.updateBanner('b1', update).subscribe();
    expect(api.patch).toHaveBeenCalledWith('/ops/admin/banners/b1', update);

    service.deleteBanner('b1').subscribe();
    expect(api.delete).toHaveBeenCalledWith('/ops/admin/banners/b1');
  });

  it('shipping endpoints map to the API service', () => {
    service.listShippingMethods().subscribe();
    expect(api.get).toHaveBeenCalledWith('/orders/shipping-methods');

    const payload = { subtotal_ron: '10' };
    service.simulateShipping(payload).subscribe();
    expect(api.post).toHaveBeenCalledWith('/ops/admin/shipping-simulate', payload as never);
  });

  it('webhook endpoints map to the API service with defaults', () => {
    service.listWebhooks().subscribe();
    expect(api.get).toHaveBeenCalledWith('/ops/admin/webhooks', { limit: 50 });

    service.listWebhooks(10).subscribe();
    expect(api.get).toHaveBeenCalledWith('/ops/admin/webhooks', { limit: 10 });

    service.getWebhookFailureStats({ since_hours: 1 }).subscribe();
    expect(api.get).toHaveBeenCalledWith('/ops/admin/webhooks/stats', { since_hours: 1 } as never);

    service.getWebhookBacklogStats().subscribe();
    expect(api.get).toHaveBeenCalledWith('/ops/admin/webhooks/backlog', undefined as never);

    service.getWebhookDetail('stripe', 'ev 1').subscribe();
    expect(api.get).toHaveBeenCalledWith('/ops/admin/webhooks/stripe/ev%201');

    service.retryWebhook('paypal', 'ev 2').subscribe();
    expect(api.post).toHaveBeenCalledWith('/ops/admin/webhooks/paypal/ev%202/retry', {});
  });

  it('email endpoints map to the API service', () => {
    service.getEmailFailureStats().subscribe();
    expect(api.get).toHaveBeenCalledWith('/ops/admin/email-failures/stats', undefined as never);

    service.listEmailFailures({ limit: 5 }).subscribe();
    expect(api.get).toHaveBeenCalledWith('/ops/admin/email-failures', { limit: 5 } as never);

    service.listEmailEvents({ status: 'failed' }).subscribe();
    expect(api.get).toHaveBeenCalledWith('/ops/admin/email-events', { status: 'failed' } as never);
  });

  it('diagnostics and sameday endpoints map to the API service', () => {
    service.getDiagnostics().subscribe();
    expect(api.get).toHaveBeenCalledWith('/ops/admin/diagnostics');

    service.getSamedaySyncStatus().subscribe();
    expect(api.get).toHaveBeenCalledWith('/admin/shipping/sameday-sync/status');

    service.listSamedaySyncRuns({ page: 2 }).subscribe();
    expect(api.get).toHaveBeenCalledWith('/admin/shipping/sameday-sync/runs', {
      page: 2,
    } as never);

    service.runSamedaySyncNow().subscribe();
    expect(api.post).toHaveBeenCalledWith('/admin/shipping/sameday-sync/run', {});
  });

  it('downloads the newsletter subscriber export as a blob', () => {
    service.downloadNewsletterConfirmedSubscribersExport().subscribe();
    expect(api.getBlob).toHaveBeenCalledWith('/newsletter/admin/export');
  });
});
