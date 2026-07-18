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

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', ['get', 'post', 'patch']);
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: api }, AdminCouponsV2Service],
    });
    service = TestBed.inject(AdminCouponsV2Service);
  });

  it('lists promotions', () => {
    const promotions = [{ id: 'p1' } as PromotionRead];
    api.get.and.returnValue(of(promotions));

    let result: PromotionRead[] | undefined;
    service.listPromotions().subscribe((res) => (result = res));

    expect(api.get).toHaveBeenCalledWith('/coupons/admin/promotions');
    expect(result).toBe(promotions);
  });

  it('creates a promotion', () => {
    const payload: PromotionCreatePayload = {
      name: 'Spring',
      discount_type: 'percent',
      allow_on_sale_items: true,
      is_active: true,
    } as PromotionCreatePayload;
    const promotion = { id: 'p1' } as PromotionRead;
    api.post.and.returnValue(of(promotion));

    let result: PromotionRead | undefined;
    service.createPromotion(payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/promotions', payload);
    expect(result).toBe(promotion);
  });

  it('updates a promotion', () => {
    const payload = { name: 'Renamed' };
    const promotion = { id: 'p1' } as PromotionRead;
    api.patch.and.returnValue(of(promotion));

    let result: PromotionRead | undefined;
    service.updatePromotion('p1', payload).subscribe((res) => (result = res));

    expect(api.patch).toHaveBeenCalledWith('/coupons/admin/promotions/p1', payload);
    expect(result).toBe(promotion);
  });

  it('lists coupons without params', () => {
    const coupons = [{ id: 'c1' } as CouponRead];
    api.get.and.returnValue(of(coupons));

    let result: CouponRead[] | undefined;
    service.listCoupons().subscribe((res) => (result = res));

    expect(api.get).toHaveBeenCalledWith('/coupons/admin/coupons', undefined);
    expect(result).toBe(coupons);
  });

  it('lists coupons with filter params', () => {
    api.get.and.returnValue(of([]));

    service.listCoupons({ promotion_id: 'p1', q: 'spr' }).subscribe();

    expect(api.get).toHaveBeenCalledWith('/coupons/admin/coupons', {
      promotion_id: 'p1',
      q: 'spr',
    });
  });

  it('creates a coupon', () => {
    const payload: CouponCreatePayload = {
      promotion_id: 'p1',
      code: 'SAVE10',
      visibility: 'public',
      is_active: true,
    } as CouponCreatePayload;
    const coupon = { id: 'c1' } as CouponRead;
    api.post.and.returnValue(of(coupon));

    let result: CouponRead | undefined;
    service.createCoupon(payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons', payload);
    expect(result).toBe(coupon);
  });

  it('generates a coupon code', () => {
    const payload = { prefix: 'WIN', length: 8 };
    const response: CouponCodeGenerateResponse = { code: 'WIN12345' };
    api.post.and.returnValue(of(response));

    let result: CouponCodeGenerateResponse | undefined;
    service.generateCouponCode(payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons/generate-code', payload);
    expect(result).toBe(response);
  });

  it('issues a coupon to a user', () => {
    const payload: CouponIssueToUserPayload = { user_id: 'u1', promotion_id: 'p1' };
    const coupon = { id: 'c1' } as CouponRead;
    api.post.and.returnValue(of(coupon));

    let result: CouponRead | undefined;
    service.issueCouponToUser(payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons/issue', payload);
    expect(result).toBe(coupon);
  });

  it('updates a coupon', () => {
    const payload = { is_active: false };
    const coupon = { id: 'c1' } as CouponRead;
    api.patch.and.returnValue(of(coupon));

    let result: CouponRead | undefined;
    service.updateCoupon('c1', payload).subscribe((res) => (result = res));

    expect(api.patch).toHaveBeenCalledWith('/coupons/admin/coupons/c1', payload);
    expect(result).toBe(coupon);
  });

  it('lists assignments for a coupon', () => {
    const assignments = [{ id: 'a1' } as CouponAssignmentRead];
    api.get.and.returnValue(of(assignments));

    let result: CouponAssignmentRead[] | undefined;
    service.listAssignments('c1').subscribe((res) => (result = res));

    expect(api.get).toHaveBeenCalledWith('/coupons/admin/coupons/c1/assignments');
    expect(result).toBe(assignments);
  });

  it('assigns a coupon', () => {
    const payload = { email: 'a@b.com', send_email: true };
    api.post.and.returnValue(of(undefined));

    let called = false;
    service.assignCoupon('c1', payload).subscribe(() => (called = true));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons/c1/assign', payload);
    expect(called).toBeTrue();
  });

  it('revokes a coupon', () => {
    const payload = { email: 'a@b.com', reason: 'fraud' };
    api.post.and.returnValue(of(undefined));

    let called = false;
    service.revokeCoupon('c1', payload).subscribe(() => (called = true));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons/c1/revoke', payload);
    expect(called).toBeTrue();
  });

  it('bulk-assigns a coupon', () => {
    const payload = { emails: ['a@b.com', 'c@d.com'], send_email: true };
    const bulk = { requested: 2 } as CouponBulkResult;
    api.post.and.returnValue(of(bulk));

    let result: CouponBulkResult | undefined;
    service.bulkAssignCoupon('c1', payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons/c1/assign/bulk', payload);
    expect(result).toBe(bulk);
  });

  it('bulk-revokes a coupon', () => {
    const payload = { emails: ['a@b.com'], reason: 'cleanup' };
    const bulk = { requested: 1 } as CouponBulkResult;
    api.post.and.returnValue(of(bulk));

    let result: CouponBulkResult | undefined;
    service.bulkRevokeCoupon('c1', payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons/c1/revoke/bulk', payload);
    expect(result).toBe(bulk);
  });

  it('previews a segment assign', () => {
    const payload = { require_marketing_opt_in: true, bucket_total: 4, bucket_index: 0 };
    const preview = { total_candidates: 10 } as CouponBulkSegmentPreview;
    api.post.and.returnValue(of(preview));

    let result: CouponBulkSegmentPreview | undefined;
    service.previewSegmentAssign('c1', payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith(
      '/coupons/admin/coupons/c1/assign/segment/preview',
      payload,
    );
    expect(result).toBe(preview);
  });

  it('previews a segment revoke', () => {
    const payload = { require_email_verified: true, reason: 'expired' };
    const preview = { total_candidates: 5 } as CouponBulkSegmentPreview;
    api.post.and.returnValue(of(preview));

    let result: CouponBulkSegmentPreview | undefined;
    service.previewSegmentRevoke('c1', payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith(
      '/coupons/admin/coupons/c1/revoke/segment/preview',
      payload,
    );
    expect(result).toBe(preview);
  });

  it('starts a segment assign job', () => {
    const payload = { send_email: true, bucket_seed: 'seed' };
    const job = { id: 'j1' } as CouponBulkJobRead;
    api.post.and.returnValue(of(job));

    let result: CouponBulkJobRead | undefined;
    service.startSegmentAssignJob('c1', payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons/c1/assign/segment', payload);
    expect(result).toBe(job);
  });

  it('starts a segment revoke job', () => {
    const payload = { reason: 'reset', send_email: false };
    const job = { id: 'j2' } as CouponBulkJobRead;
    api.post.and.returnValue(of(job));

    let result: CouponBulkJobRead | undefined;
    service.startSegmentRevokeJob('c1', payload).subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons/c1/revoke/segment', payload);
    expect(result).toBe(job);
  });

  it('gets a bulk job by id', () => {
    const job = { id: 'j1' } as CouponBulkJobRead;
    api.get.and.returnValue(of(job));

    let result: CouponBulkJobRead | undefined;
    service.getBulkJob('j1').subscribe((res) => (result = res));

    expect(api.get).toHaveBeenCalledWith('/coupons/admin/coupons/bulk-jobs/j1');
    expect(result).toBe(job);
  });

  it('gets analytics', () => {
    const params = { promotion_id: 'p1', coupon_id: 'c1', days: 30, top_limit: 5 };
    const analytics = { summary: { redemptions: 3 } } as CouponAnalyticsResponse;
    api.get.and.returnValue(of(analytics));

    let result: CouponAnalyticsResponse | undefined;
    service.getAnalytics(params).subscribe((res) => (result = res));

    expect(api.get).toHaveBeenCalledWith('/coupons/admin/analytics', params);
    expect(result).toBe(analytics);
  });

  it('lists bulk jobs for a coupon without params', () => {
    const jobs = [{ id: 'j1' } as CouponBulkJobRead];
    api.get.and.returnValue(of(jobs));

    let result: CouponBulkJobRead[] | undefined;
    service.listBulkJobs('c1').subscribe((res) => (result = res));

    expect(api.get).toHaveBeenCalledWith('/coupons/admin/coupons/c1/bulk-jobs', undefined);
    expect(result).toBe(jobs);
  });

  it('lists bulk jobs for a coupon with a limit', () => {
    api.get.and.returnValue(of([]));

    service.listBulkJobs('c1', { limit: 10 }).subscribe();

    expect(api.get).toHaveBeenCalledWith('/coupons/admin/coupons/c1/bulk-jobs', { limit: 10 });
  });

  it('lists all bulk jobs without params', () => {
    const jobs = [{ id: 'j1' } as CouponBulkJobRead];
    api.get.and.returnValue(of(jobs));

    let result: CouponBulkJobRead[] | undefined;
    service.listAllBulkJobs().subscribe((res) => (result = res));

    expect(api.get).toHaveBeenCalledWith('/coupons/admin/coupons/bulk-jobs', undefined);
    expect(result).toBe(jobs);
  });

  it('lists all bulk jobs with a limit', () => {
    api.get.and.returnValue(of([]));

    service.listAllBulkJobs({ limit: 25 }).subscribe();

    expect(api.get).toHaveBeenCalledWith('/coupons/admin/coupons/bulk-jobs', { limit: 25 });
  });

  it('cancels a bulk job', () => {
    const job = { id: 'j1', status: 'cancelled' } as CouponBulkJobRead;
    api.post.and.returnValue(of(job));

    let result: CouponBulkJobRead | undefined;
    service.cancelBulkJob('j1').subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons/bulk-jobs/j1/cancel', {});
    expect(result).toBe(job);
  });

  it('retries a bulk job', () => {
    const job = { id: 'j1', status: 'pending' } as CouponBulkJobRead;
    api.post.and.returnValue(of(job));

    let result: CouponBulkJobRead | undefined;
    service.retryBulkJob('j1').subscribe((res) => (result = res));

    expect(api.post).toHaveBeenCalledWith('/coupons/admin/coupons/bulk-jobs/j1/retry', {});
    expect(result).toBe(job);
  });
});
