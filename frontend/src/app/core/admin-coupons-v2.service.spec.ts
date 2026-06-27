import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import {
  AdminCouponsV2Service,
  CouponAnalyticsResponse,
  CouponAssignmentRead,
  CouponBulkJobRead,
  CouponBulkResult,
  CouponBulkSegmentPreview,
  CouponCodeGenerateResponse,
  CouponCreatePayload,
  CouponIssueToUserPayload,
  PromotionCreatePayload,
} from './admin-coupons-v2.service';
import { ApiService } from './api.service';
import type { CouponRead, PromotionRead } from './coupons.service';

describe('AdminCouponsV2Service', () => {
  let service: AdminCouponsV2Service;
  let api: jasmine.SpyObj<ApiService>;

  const promotion = { id: 'promo-1', name: 'Promo' } as PromotionRead;
  const coupon = { id: 'coupon-1', code: 'SAVE10' } as CouponRead;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post', 'patch']);
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, AdminCouponsV2Service],
    });
    service = TestBed.inject(AdminCouponsV2Service);
  });

  it('lists promotions', () => {
    const promotions = [promotion];
    api.get.and.returnValue(of(promotions));

    let result: PromotionRead[] | undefined;
    service.listPromotions().subscribe((res) => (result = res));

    expect(api.get).toHaveBeenCalledWith('/coupons/admin/promotions');
    expect(result).toBe(promotions);
  });

  it('creates a promotion', () => {
    const payload: PromotionCreatePayload = {
      name: 'New',
      discount_type: 'percent',
      percentage_off: '10',
      allow_on_sale_items: true,
      is_active: true,
    };
    api.post.and.returnValue(of(promotion));

    let result: PromotionRead | undefined;
    service.createPromotion(payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/promotions', payload);
    expect(result).toBe(promotion);
  });

  it('updates a promotion', () => {
    const payload = { name: 'Renamed' };
    api.patch.and.returnValue(of(promotion));

    let result: PromotionRead | undefined;
    service.updatePromotion('promo-1', payload).subscribe((res) => (result = res));

    expect(api.patch).toHaveBeenCalledWith('/coupons/admin/promotions/promo-1', payload);
    expect(result).toBe(promotion);
  });

  it('lists coupons with filter params', () => {
    const coupons = [coupon];
    const params = { promotion_id: 'promo-1', q: 'save' };
    api.get.and.returnValue(of(coupons));

    let result: CouponRead[] | undefined;
    service.listCoupons(params).subscribe((res) => (result = res));

    expect(api.get).toHaveBeenCalledWith('/coupons/admin/coupons', params as never);
    expect(result).toBe(coupons);
  });

  it('lists coupons without params', () => {
    api.get.and.returnValue(of([coupon]));

    service.listCoupons().subscribe();

    expect(api.get).toHaveBeenCalledWith('/coupons/admin/coupons', undefined as never);
  });

  it('creates a coupon', () => {
    const payload: CouponCreatePayload = {
      promotion_id: 'promo-1',
      code: 'SAVE10',
      visibility: 'public',
      is_active: true,
    };
    api.post.and.returnValue(of(coupon));

    let result: CouponRead | undefined;
    service.createCoupon(payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons', payload);
    expect(result).toBe(coupon);
  });

  it('generates a coupon code', () => {
    const payload = { prefix: 'SUM', length: 8 };
    const response: CouponCodeGenerateResponse = { code: 'SUM12345' };
    api.post.and.returnValue(of(response));

    let result: CouponCodeGenerateResponse | undefined;
    service.generateCouponCode(payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons/generate-code', payload);
    expect(result).toBe(response);
  });

  it('issues a coupon to a user', () => {
    const payload: CouponIssueToUserPayload = {
      user_id: 'user-1',
      promotion_id: 'promo-1',
    };
    api.post.and.returnValue(of(coupon));

    let result: CouponRead | undefined;
    service.issueCouponToUser(payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons/issue', payload);
    expect(result).toBe(coupon);
  });

  it('updates a coupon', () => {
    const payload = { is_active: false };
    api.patch.and.returnValue(of(coupon));

    let result: CouponRead | undefined;
    service.updateCoupon('coupon-1', payload).subscribe((res) => (result = res));

    expect(api.patch).toHaveBeenCalledWith('/coupons/admin/coupons/coupon-1', payload);
    expect(result).toBe(coupon);
  });

  it('lists assignments for a coupon', () => {
    const assignments: CouponAssignmentRead[] = [
      {
        id: 'assign-1',
        coupon_id: 'coupon-1',
        user_id: 'user-1',
        issued_at: '2026-01-01T00:00:00Z',
      },
    ];
    api.get.and.returnValue(of(assignments));

    let result: CouponAssignmentRead[] | undefined;
    service.listAssignments('coupon-1').subscribe((res) => (result = res));

    expect(api.get).toHaveBeenCalledWith('/coupons/admin/coupons/coupon-1/assignments');
    expect(result).toBe(assignments);
  });

  it('assigns a coupon', () => {
    const payload = { user_id: 'user-1', send_email: true };
    api.post.and.returnValue(of(undefined));

    service.assignCoupon('coupon-1', payload).subscribe();

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons/coupon-1/assign', payload);
  });

  it('revokes a coupon', () => {
    const payload = { email: 'user@example.com', reason: 'fraud' };
    api.post.and.returnValue(of(undefined));

    service.revokeCoupon('coupon-1', payload).subscribe();

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons/coupon-1/revoke', payload);
  });

  it('bulk assigns a coupon', () => {
    const payload = { emails: ['a@example.com', 'b@example.com'], send_email: true };
    const bulkResult = { requested: 2, created: 2 } as CouponBulkResult;
    api.post.and.returnValue(of(bulkResult));

    let result: CouponBulkResult | undefined;
    service.bulkAssignCoupon('coupon-1', payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons/coupon-1/assign/bulk', payload);
    expect(result).toBe(bulkResult);
  });

  it('bulk revokes a coupon', () => {
    const payload = { emails: ['a@example.com'], reason: 'cleanup', send_email: false };
    const bulkResult = { requested: 1, revoked: 1 } as CouponBulkResult;
    api.post.and.returnValue(of(bulkResult));

    let result: CouponBulkResult | undefined;
    service.bulkRevokeCoupon('coupon-1', payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons/coupon-1/revoke/bulk', payload);
    expect(result).toBe(bulkResult);
  });

  it('previews a segment assign', () => {
    const payload = { require_marketing_opt_in: true, bucket_total: 4, bucket_index: 1 };
    const preview = { total_candidates: 10 } as CouponBulkSegmentPreview;
    api.post.and.returnValue(of(preview));

    let result: CouponBulkSegmentPreview | undefined;
    service.previewSegmentAssign('coupon-1', payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith(
      '/coupons/admin/coupons/coupon-1/assign/segment/preview',
      payload,
    );
    expect(result).toBe(preview);
  });

  it('previews a segment revoke', () => {
    const payload = { require_email_verified: true, reason: 'cleanup', bucket_seed: 'seed' };
    const preview = { total_candidates: 5 } as CouponBulkSegmentPreview;
    api.post.and.returnValue(of(preview));

    let result: CouponBulkSegmentPreview | undefined;
    service.previewSegmentRevoke('coupon-1', payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith(
      '/coupons/admin/coupons/coupon-1/revoke/segment/preview',
      payload,
    );
    expect(result).toBe(preview);
  });

  it('starts a segment assign job', () => {
    const payload = { require_marketing_opt_in: false, send_email: true };
    const job = { id: 'job-1', action: 'assign', status: 'pending' } as CouponBulkJobRead;
    api.post.and.returnValue(of(job));

    let result: CouponBulkJobRead | undefined;
    service.startSegmentAssignJob('coupon-1', payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith(
      '/coupons/admin/coupons/coupon-1/assign/segment',
      payload,
    );
    expect(result).toBe(job);
  });

  it('starts a segment revoke job', () => {
    const payload = { reason: 'cleanup', bucket_total: 2, bucket_index: 0 };
    const job = { id: 'job-2', action: 'revoke', status: 'pending' } as CouponBulkJobRead;
    api.post.and.returnValue(of(job));

    let result: CouponBulkJobRead | undefined;
    service.startSegmentRevokeJob('coupon-1', payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith(
      '/coupons/admin/coupons/coupon-1/revoke/segment',
      payload,
    );
    expect(result).toBe(job);
  });

  it('gets a bulk job', () => {
    const job = { id: 'job-3', status: 'succeeded' } as CouponBulkJobRead;
    api.get.and.returnValue(of(job));

    let result: CouponBulkJobRead | undefined;
    service.getBulkJob('job-3').subscribe((res) => (result = res));

    expect(api.get).toHaveBeenCalledWith('/coupons/admin/coupons/bulk-jobs/job-3');
    expect(result).toBe(job);
  });

  it('gets analytics', () => {
    const params = { promotion_id: 'promo-1', coupon_id: 'coupon-1', days: 30, top_limit: 5 };
    const analytics = {
      summary: { redemptions: 3 },
      daily: [],
      top_products: [],
    } as unknown as CouponAnalyticsResponse;
    api.get.and.returnValue(of(analytics));

    let result: CouponAnalyticsResponse | undefined;
    service.getAnalytics(params).subscribe((res) => (result = res));

    expect(api.get).toHaveBeenCalledWith('/coupons/admin/analytics', params as never);
    expect(result).toBe(analytics);
  });

  it('lists bulk jobs for a coupon with params', () => {
    const jobs = [{ id: 'job-4' } as CouponBulkJobRead];
    const params = { limit: 10 };
    api.get.and.returnValue(of(jobs));

    let result: CouponBulkJobRead[] | undefined;
    service.listBulkJobs('coupon-1', params).subscribe((res) => (result = res));

    expect(api.get).toHaveBeenCalledWith(
      '/coupons/admin/coupons/coupon-1/bulk-jobs',
      params as never,
    );
    expect(result).toBe(jobs);
  });

  it('lists bulk jobs for a coupon without params', () => {
    api.get.and.returnValue(of([]));

    service.listBulkJobs('coupon-1').subscribe();

    expect(api.get).toHaveBeenCalledWith(
      '/coupons/admin/coupons/coupon-1/bulk-jobs',
      undefined as never,
    );
  });

  it('lists all bulk jobs with params', () => {
    const jobs = [{ id: 'job-5' } as CouponBulkJobRead];
    const params = { limit: 25 };
    api.get.and.returnValue(of(jobs));

    let result: CouponBulkJobRead[] | undefined;
    service.listAllBulkJobs(params).subscribe((res) => (result = res));

    expect(api.get).toHaveBeenCalledWith('/coupons/admin/coupons/bulk-jobs', params as never);
    expect(result).toBe(jobs);
  });

  it('lists all bulk jobs without params', () => {
    api.get.and.returnValue(of([]));

    service.listAllBulkJobs().subscribe();

    expect(api.get).toHaveBeenCalledWith('/coupons/admin/coupons/bulk-jobs', undefined as never);
  });

  it('cancels a bulk job', () => {
    const job = { id: 'job-6', status: 'cancelled' } as CouponBulkJobRead;
    api.post.and.returnValue(of(job));

    let result: CouponBulkJobRead | undefined;
    service.cancelBulkJob('job-6').subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons/bulk-jobs/job-6/cancel', {});
    expect(result).toBe(job);
  });

  it('retries a bulk job', () => {
    const job = { id: 'job-7', status: 'pending' } as CouponBulkJobRead;
    api.post.and.returnValue(of(job));

    let result: CouponBulkJobRead | undefined;
    service.retryBulkJob('job-7').subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons/bulk-jobs/job-7/retry', {});
    expect(result).toBe(job);
  });
});
