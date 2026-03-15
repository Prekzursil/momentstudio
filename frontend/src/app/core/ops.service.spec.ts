import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';

import { ApiService } from './api.service';
import { OpsService } from './ops.service';

describe('OpsService', () => {
  let service: OpsService;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post', 'patch', 'delete', 'getBlob']);

    TestBed.configureTestingModule({
      providers: [
        OpsService,
        { provide: ApiService, useValue: api },
      ],
    });

    service = TestBed.inject(OpsService);
    api.get.and.returnValue(of([] as any));
    api.post.and.returnValue(of({} as any));
    api.patch.and.returnValue(of({} as any));
    api.delete.and.returnValue(of(void 0));
    api.getBlob.and.returnValue(of(new Blob()));
  });

  it('maps active banner and falls back to null on errors', async () => {
    api.get.and.returnValue(of({ level: 'info', message_en: 'ok', message_ro: 'ok', starts_at: '2026-01-01' } as any));
    const active = await firstValueFrom(service.getActiveBanner());
    expect(active?.level).toBe('info');
    expect(api.get).toHaveBeenCalledWith('/ops/banner');

    api.get.calls.reset();
    api.get.and.returnValue(throwError(() => new Error('boom')));

    const fallback = await firstValueFrom(service.getActiveBanner());
    expect(fallback).toBeNull();
    expect(api.get).toHaveBeenCalledWith('/ops/banner');
  });

  it('covers banner and shipping simulation endpoints', async () => {
    await firstValueFrom(service.listBanners());
    await firstValueFrom(service.createBanner({
      is_active: true,
      level: 'warning',
      message_en: 'm',
      message_ro: 'm',
      starts_at: '2026-01-01',
    }));
    await firstValueFrom(service.updateBanner('b-1', { level: 'promo' }));
    await firstValueFrom(service.deleteBanner('b-1'));
    await firstValueFrom(service.listShippingMethods());
    await firstValueFrom(service.simulateShipping({ subtotal_ron: '100', discount_ron: '0', shipping_method_id: 'm1' }));

    expect(api.get).toHaveBeenCalledWith('/ops/admin/banners');
    expect(api.post).toHaveBeenCalledWith('/ops/admin/banners', jasmine.any(Object));
    expect(api.patch).toHaveBeenCalledWith('/ops/admin/banners/b-1', { level: 'promo' });
    expect(api.delete).toHaveBeenCalledWith('/ops/admin/banners/b-1');
    expect(api.get).toHaveBeenCalledWith('/orders/shipping-methods');
    expect(api.post).toHaveBeenCalledWith('/ops/admin/shipping-simulate', jasmine.any(Object));
  });

  it('covers webhook and email diagnostic endpoints', async () => {
    await firstValueFrom(service.listWebhooks(7));
    await firstValueFrom(service.getWebhookFailureStats({ since_hours: 24 }));
    await firstValueFrom(service.getWebhookBacklogStats({ since_hours: 12 }));
    await firstValueFrom(service.getWebhookDetail('stripe', 'evt/id'));
    await firstValueFrom(service.retryWebhook('paypal', 'evt-2'));
    await firstValueFrom(service.getEmailFailureStats({ since_hours: 48 }));
    await firstValueFrom(service.listEmailFailures({ limit: 5, since_hours: 12, to_email: 'a@example.com' }));
    await firstValueFrom(service.listEmailEvents({ limit: 3, status: 'failed', to_email: 'b@example.com' }));
    await firstValueFrom(service.getDiagnostics());

    expect(api.get).toHaveBeenCalledWith('/ops/admin/webhooks', { limit: 7 });
    expect(api.get).toHaveBeenCalledWith('/ops/admin/webhooks/stats', { since_hours: 24 } as any);
    expect(api.get).toHaveBeenCalledWith('/ops/admin/webhooks/backlog', { since_hours: 12 } as any);
    expect(api.get).toHaveBeenCalledWith('/ops/admin/webhooks/stripe/evt%2Fid');
    expect(api.post).toHaveBeenCalledWith('/ops/admin/webhooks/paypal/evt-2/retry', {});
    expect(api.get).toHaveBeenCalledWith('/ops/admin/email-failures/stats', { since_hours: 48 } as any);
    expect(api.get).toHaveBeenCalledWith('/ops/admin/email-failures', { limit: 5, since_hours: 12, to_email: 'a@example.com' } as any);
    expect(api.get).toHaveBeenCalledWith('/ops/admin/email-events', { limit: 3, status: 'failed', to_email: 'b@example.com' } as any);
    expect(api.get).toHaveBeenCalledWith('/ops/admin/diagnostics');
  });

  it('covers sameday sync and newsletter export endpoints', async () => {
    await firstValueFrom(service.getSamedaySyncStatus());
    await firstValueFrom(service.listSamedaySyncRuns({ page: 2, limit: 10 }));
    await firstValueFrom(service.runSamedaySyncNow());
    await firstValueFrom(service.downloadNewsletterConfirmedSubscribersExport());

    expect(api.get).toHaveBeenCalledWith('/admin/shipping/sameday-sync/status');
    expect(api.get).toHaveBeenCalledWith('/admin/shipping/sameday-sync/runs', { page: 2, limit: 10 } as any);
    expect(api.post).toHaveBeenCalledWith('/admin/shipping/sameday-sync/run', {});
    expect(api.getBlob).toHaveBeenCalledWith('/newsletter/admin/export');
  });
});
