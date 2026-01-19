import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export type PromotionDiscountType = 'percent' | 'amount' | 'free_shipping';
export type CouponVisibility = 'public' | 'assigned';

export interface PromotionRead {
  id: string;
  key?: string | null;
  name: string;
  description?: string | null;
  discount_type: PromotionDiscountType;
  percentage_off?: string | null;
  amount_off?: string | null;
  max_discount_amount?: string | null;
  allow_on_sale_items: boolean;
  min_subtotal?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  is_active: boolean;
  is_automatic: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CouponRead {
  id: string;
  promotion_id: string;
  code: string;
  visibility: CouponVisibility;
  is_active: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  global_max_redemptions?: number | null;
  per_customer_max_redemptions?: number | null;
  promotion?: PromotionRead | null;
  created_at?: string;
  updated_at?: string;
}

export interface CouponOffer {
  coupon: CouponRead;
  estimated_discount_ron: string;
  estimated_shipping_discount_ron: string;
  eligible: boolean;
  reasons: string[];
  global_remaining?: number | null;
  customer_remaining?: number | null;
}

export interface CouponEligibilityResponse {
  eligible: CouponOffer[];
  ineligible: CouponOffer[];
}

@Injectable({ providedIn: 'root' })
export class CouponsService {
  constructor(private api: ApiService) {}

  eligibility(shippingMethodId?: string | null): Observable<CouponEligibilityResponse> {
    const params = shippingMethodId ? { shipping_method_id: shippingMethodId } : undefined;
    return this.api.get<CouponEligibilityResponse>('/coupons/eligibility', params);
  }

  validate(code: string, shippingMethodId?: string | null): Observable<CouponOffer> {
    const params = shippingMethodId ? { shipping_method_id: shippingMethodId } : undefined;
    return this.api.post<CouponOffer>('/coupons/validate', { code }, undefined, params);
  }

  myCoupons(): Observable<CouponRead[]> {
    return this.api.get<CouponRead[]>('/coupons/me');
  }
}

