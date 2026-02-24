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

export interface CouponCodeGeneratePayload {
  prefix?: string | null;
  pattern?: string | null;
  length?: number | null;
}

export interface CouponCodeGenerateResponse {
  code: string;
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
  bucket_total?: number | null;
  bucket_index?: number | null;
  bucket_seed?: string | null;
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

export interface CouponAnalyticsSummary {
  redemptions: number;
  total_discount_ron: string;
  total_shipping_discount_ron: string;
  avg_order_total_with_coupon?: string | null;
  avg_order_total_without_coupon?: string | null;
  aov_lift?: string | null;
}

export interface CouponAnalyticsDaily {
  date: string;
  redemptions: number;
  discount_ron: string;
  shipping_discount_ron: string;
}

export interface CouponAnalyticsTopProduct {
  product_id: string;
  product_slug?: string | null;
  product_name: string;
  orders_count: number;
  quantity: number;
  gross_sales_ron: string;
  allocated_discount_ron: string;
}

export interface CouponAnalyticsResponse {
  summary: CouponAnalyticsSummary;
  daily: CouponAnalyticsDaily[];
  top_products: CouponAnalyticsTopProduct[];
}

@Injectable({ providedIn: 'root' })
export class AdminCouponsV2Service {
  constructor(private readonly api: ApiService) {}

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

  generateCouponCode(payload: CouponCodeGeneratePayload): Observable<CouponCodeGenerateResponse> {
    return this.api.post<CouponCodeGenerateResponse>('/coupons/admin/coupons/generate-code', payload);
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
    payload: {
      require_marketing_opt_in?: boolean;
      require_email_verified?: boolean;
      send_email?: boolean;
      bucket_total?: number | null;
      bucket_index?: number | null;
      bucket_seed?: string | null;
    }
  ): Observable<CouponBulkSegmentPreview> {
    return this.api.post<CouponBulkSegmentPreview>(`/coupons/admin/coupons/${couponId}/assign/segment/preview`, payload);
  }

  previewSegmentRevoke(
    couponId: string,
    payload: {
      require_marketing_opt_in?: boolean;
      require_email_verified?: boolean;
      reason?: string | null;
      send_email?: boolean;
      bucket_total?: number | null;
      bucket_index?: number | null;
      bucket_seed?: string | null;
    }
  ): Observable<CouponBulkSegmentPreview> {
    return this.api.post<CouponBulkSegmentPreview>(`/coupons/admin/coupons/${couponId}/revoke/segment/preview`, payload);
  }

  startSegmentAssignJob(
    couponId: string,
    payload: {
      require_marketing_opt_in?: boolean;
      require_email_verified?: boolean;
      send_email?: boolean;
      bucket_total?: number | null;
      bucket_index?: number | null;
      bucket_seed?: string | null;
    }
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
      bucket_total?: number | null;
      bucket_index?: number | null;
      bucket_seed?: string | null;
    }
  ): Observable<CouponBulkJobRead> {
    return this.api.post<CouponBulkJobRead>(`/coupons/admin/coupons/${couponId}/revoke/segment`, payload);
  }

  getBulkJob(jobId: string): Observable<CouponBulkJobRead> {
    return this.api.get<CouponBulkJobRead>(`/coupons/admin/coupons/bulk-jobs/${jobId}`);
  }

  getAnalytics(params: { promotion_id: string; coupon_id?: string | null; days?: number; top_limit?: number }): Observable<CouponAnalyticsResponse> {
    return this.api.get<CouponAnalyticsResponse>('/coupons/admin/analytics', params as any);
  }

  listBulkJobs(couponId: string, params?: { limit?: number }): Observable<CouponBulkJobRead[]> {
    return this.api.get<CouponBulkJobRead[]>(`/coupons/admin/coupons/${couponId}/bulk-jobs`, params as any);
  }

  listAllBulkJobs(params?: { limit?: number }): Observable<CouponBulkJobRead[]> {
    return this.api.get<CouponBulkJobRead[]>('/coupons/admin/coupons/bulk-jobs', params as any);
  }

  cancelBulkJob(jobId: string): Observable<CouponBulkJobRead> {
    return this.api.post<CouponBulkJobRead>(`/coupons/admin/coupons/bulk-jobs/${jobId}/cancel`, {});
  }

  retryBulkJob(jobId: string): Observable<CouponBulkJobRead> {
    return this.api.post<CouponBulkJobRead>(`/coupons/admin/coupons/bulk-jobs/${jobId}/retry`, {});
  }
}

