import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import type { CouponRead, CouponVisibility, PromotionDiscountType, PromotionRead } from './coupons.service';

export interface PromotionCreatePayload {
  key?: string | null;
  name: string;
  description?: string | null;
  discount_type: PromotionDiscountType;
  percentage_off?: string | number | null;
  amount_off?: string | number | null;
  max_discount_amount?: string | number | null;
  min_subtotal?: string | number | null;
  included_product_ids?: string[];
  excluded_product_ids?: string[];
  included_category_ids?: string[];
  excluded_category_ids?: string[];
  allow_on_sale_items: boolean;
  first_order_only?: boolean;
  is_active: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  is_automatic?: boolean;
}

export type PromotionUpdatePayload = Partial<PromotionCreatePayload>;

export interface CouponCreatePayload {
  promotion_id: string;
  code: string;
  visibility: CouponVisibility;
  is_active: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  global_max_redemptions?: number | null;
  per_customer_max_redemptions?: number | null;
}

export type CouponUpdatePayload = Partial<Omit<CouponCreatePayload, 'promotion_id' | 'code' | 'visibility'>>;

export interface CouponAssignmentRead {
  id: string;
  coupon_id: string;
  user_id: string;
  issued_at: string;
  revoked_at?: string | null;
  revoked_reason?: string | null;
  user_email?: string | null;
  user_username?: string | null;
}

export interface CouponAssignPayload {
  user_id?: string | null;
  email?: string | null;
  send_email?: boolean;
}

export interface CouponIssueToUserPayload {
  user_id: string;
  promotion_id: string;
  prefix?: string | null;
  validity_days?: number | null;
  ends_at?: string | null;
  per_customer_max_redemptions?: number;
  send_email?: boolean;
}

export interface CouponRevokePayload extends CouponAssignPayload {
  reason?: string | null;
}

export interface CouponBulkResult {
  requested: number;
  unique: number;
  invalid_emails: string[];
  not_found_emails: string[];
  created: number;
  restored: number;
  already_active: number;
  revoked: number;
  already_revoked: number;
  not_assigned: number;
}

export interface CouponBulkSegmentPreview {
  total_candidates: number;
  sample_emails: string[];
  created: number;
  restored: number;
  already_active: number;
  revoked: number;
  already_revoked: number;
  not_assigned: number;
}

export type CouponBulkJobAction = 'assign' | 'revoke';
export type CouponBulkJobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface CouponBulkJobRead {
  id: string;
  coupon_id: string;
  created_by_user_id?: string | null;
  action: CouponBulkJobAction;
  status: CouponBulkJobStatus;
  require_marketing_opt_in: boolean;
  require_email_verified: boolean;
  send_email: boolean;
  revoke_reason?: string | null;
  total_candidates: number;
  processed: number;
  created: number;
  restored: number;
  already_active: number;
  revoked: number;
  already_revoked: number;
  not_assigned: number;
  error_message?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AdminCouponsV2Service {
  constructor(private api: ApiService) {}

  listPromotions(): Observable<PromotionRead[]> {
    return this.api.get<PromotionRead[]>('/coupons/admin/promotions');
  }

  createPromotion(payload: PromotionCreatePayload): Observable<PromotionRead> {
    return this.api.post<PromotionRead>('/coupons/admin/promotions', payload);
  }

  updatePromotion(promotionId: string, payload: PromotionUpdatePayload): Observable<PromotionRead> {
    return this.api.patch<PromotionRead>(`/coupons/admin/promotions/${promotionId}`, payload);
  }

  listCoupons(params?: { promotion_id?: string; q?: string }): Observable<CouponRead[]> {
    return this.api.get<CouponRead[]>('/coupons/admin/coupons', params as any);
  }

  createCoupon(payload: CouponCreatePayload): Observable<CouponRead> {
    return this.api.post<CouponRead>('/coupons/admin/coupons', payload);
  }

  issueCouponToUser(payload: CouponIssueToUserPayload): Observable<CouponRead> {
    return this.api.post<CouponRead>('/coupons/admin/coupons/issue', payload);
  }

  updateCoupon(couponId: string, payload: CouponUpdatePayload): Observable<CouponRead> {
    return this.api.patch<CouponRead>(`/coupons/admin/coupons/${couponId}`, payload);
  }

  listAssignments(couponId: string): Observable<CouponAssignmentRead[]> {
    return this.api.get<CouponAssignmentRead[]>(`/coupons/admin/coupons/${couponId}/assignments`);
  }

  assignCoupon(couponId: string, payload: CouponAssignPayload): Observable<void> {
    return this.api.post<void>(`/coupons/admin/coupons/${couponId}/assign`, payload);
  }

  revokeCoupon(couponId: string, payload: CouponRevokePayload): Observable<void> {
    return this.api.post<void>(`/coupons/admin/coupons/${couponId}/revoke`, payload);
  }

  bulkAssignCoupon(couponId: string, payload: { emails: string[]; send_email?: boolean }): Observable<CouponBulkResult> {
    return this.api.post<CouponBulkResult>(`/coupons/admin/coupons/${couponId}/assign/bulk`, payload);
  }

  bulkRevokeCoupon(
    couponId: string,
    payload: { emails: string[]; reason?: string | null; send_email?: boolean }
  ): Observable<CouponBulkResult> {
    return this.api.post<CouponBulkResult>(`/coupons/admin/coupons/${couponId}/revoke/bulk`, payload);
  }

  previewSegmentAssign(
    couponId: string,
    payload: { require_marketing_opt_in?: boolean; require_email_verified?: boolean; send_email?: boolean }
  ): Observable<CouponBulkSegmentPreview> {
    return this.api.post<CouponBulkSegmentPreview>(`/coupons/admin/coupons/${couponId}/assign/segment/preview`, payload);
  }

  previewSegmentRevoke(
    couponId: string,
    payload: { require_marketing_opt_in?: boolean; require_email_verified?: boolean; reason?: string | null; send_email?: boolean }
  ): Observable<CouponBulkSegmentPreview> {
    return this.api.post<CouponBulkSegmentPreview>(`/coupons/admin/coupons/${couponId}/revoke/segment/preview`, payload);
  }

  startSegmentAssignJob(
    couponId: string,
    payload: { require_marketing_opt_in?: boolean; require_email_verified?: boolean; send_email?: boolean }
  ): Observable<CouponBulkJobRead> {
    return this.api.post<CouponBulkJobRead>(`/coupons/admin/coupons/${couponId}/assign/segment`, payload);
  }

  startSegmentRevokeJob(
    couponId: string,
    payload: {
      require_marketing_opt_in?: boolean;
      require_email_verified?: boolean;
      reason?: string | null;
      send_email?: boolean;
    }
  ): Observable<CouponBulkJobRead> {
    return this.api.post<CouponBulkJobRead>(`/coupons/admin/coupons/${couponId}/revoke/segment`, payload);
  }

  getBulkJob(jobId: string): Observable<CouponBulkJobRead> {
    return this.api.get<CouponBulkJobRead>(`/coupons/admin/coupons/bulk-jobs/${jobId}`);
  }

  listBulkJobs(couponId: string, params?: { limit?: number }): Observable<CouponBulkJobRead[]> {
    return this.api.get<CouponBulkJobRead[]>(`/coupons/admin/coupons/${couponId}/bulk-jobs`, params as any);
  }

  cancelBulkJob(jobId: string): Observable<CouponBulkJobRead> {
    return this.api.post<CouponBulkJobRead>(`/coupons/admin/coupons/bulk-jobs/${jobId}/cancel`, {});
  }

  retryBulkJob(jobId: string): Observable<CouponBulkJobRead> {
    return this.api.post<CouponBulkJobRead>(`/coupons/admin/coupons/bulk-jobs/${jobId}/retry`, {});
  }
}
