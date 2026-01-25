from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.coupons_v2 import CouponBulkJobAction, CouponBulkJobStatus, CouponVisibility, PromotionDiscountType


class PromotionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    key: str | None = None
    name: str
    description: str | None = None
    discount_type: PromotionDiscountType
    percentage_off: Decimal | None = None
    amount_off: Decimal | None = None
    max_discount_amount: Decimal | None = None
    min_subtotal: Decimal | None = None
    included_product_ids: list[UUID] = Field(default_factory=list)
    excluded_product_ids: list[UUID] = Field(default_factory=list)
    included_category_ids: list[UUID] = Field(default_factory=list)
    excluded_category_ids: list[UUID] = Field(default_factory=list)
    allow_on_sale_items: bool
    first_order_only: bool = False
    is_active: bool
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    is_automatic: bool
    created_at: datetime
    updated_at: datetime


class PromotionCreate(BaseModel):
    key: str | None = Field(default=None, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    discount_type: PromotionDiscountType = PromotionDiscountType.percent
    percentage_off: Decimal | None = Field(default=None, ge=0)
    amount_off: Decimal | None = Field(default=None, ge=0)
    max_discount_amount: Decimal | None = Field(default=None, ge=0)
    min_subtotal: Decimal | None = Field(default=None, ge=0)
    included_product_ids: list[UUID] = Field(default_factory=list)
    excluded_product_ids: list[UUID] = Field(default_factory=list)
    included_category_ids: list[UUID] = Field(default_factory=list)
    excluded_category_ids: list[UUID] = Field(default_factory=list)
    allow_on_sale_items: bool = True
    first_order_only: bool = False
    is_active: bool = True
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    is_automatic: bool = False


class PromotionUpdate(BaseModel):
    key: str | None = Field(default=None, max_length=80)
    name: str | None = Field(default=None, max_length=120)
    description: str | None = None
    discount_type: PromotionDiscountType | None = None
    percentage_off: Decimal | None = Field(default=None, ge=0)
    amount_off: Decimal | None = Field(default=None, ge=0)
    max_discount_amount: Decimal | None = Field(default=None, ge=0)
    min_subtotal: Decimal | None = Field(default=None, ge=0)
    included_product_ids: list[UUID] | None = None
    excluded_product_ids: list[UUID] | None = None
    included_category_ids: list[UUID] | None = None
    excluded_category_ids: list[UUID] | None = None
    allow_on_sale_items: bool | None = None
    first_order_only: bool | None = None
    is_active: bool | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    is_automatic: bool | None = None


class CouponRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    promotion_id: UUID
    code: str
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    visibility: CouponVisibility
    is_active: bool
    global_max_redemptions: int | None = None
    per_customer_max_redemptions: int | None = None
    created_at: datetime
    promotion: PromotionRead | None = None


class CouponCreate(BaseModel):
    promotion_id: UUID
    code: str = Field(min_length=3, max_length=40)
    visibility: CouponVisibility = CouponVisibility.public
    is_active: bool = True
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    global_max_redemptions: int | None = Field(default=None, ge=1)
    per_customer_max_redemptions: int | None = Field(default=None, ge=1)


class CouponIssueToUserRequest(BaseModel):
    user_id: UUID
    promotion_id: UUID
    prefix: str | None = Field(default=None, max_length=20)
    validity_days: int | None = Field(default=None, ge=1, le=3650)
    ends_at: datetime | None = None
    per_customer_max_redemptions: int = Field(default=1, ge=1)
    send_email: bool = True


class CouponUpdate(BaseModel):
    is_active: bool | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    global_max_redemptions: int | None = Field(default=None, ge=1)
    per_customer_max_redemptions: int | None = Field(default=None, ge=1)


class CouponAssignmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    coupon_id: UUID
    user_id: UUID
    issued_at: datetime
    revoked_at: datetime | None = None
    revoked_reason: str | None = None
    user_email: str | None = None
    user_username: str | None = None


class CouponOffer(BaseModel):
    coupon: CouponRead
    estimated_discount_ron: Decimal = Decimal("0.00")
    estimated_shipping_discount_ron: Decimal = Decimal("0.00")
    eligible: bool
    reasons: list[str] = Field(default_factory=list)
    global_remaining: int | None = None
    customer_remaining: int | None = None


class CouponEligibilityResponse(BaseModel):
    eligible: list[CouponOffer] = Field(default_factory=list)
    ineligible: list[CouponOffer] = Field(default_factory=list)


class CouponValidateRequest(BaseModel):
    code: str = Field(min_length=1, max_length=40)


class CouponAssignRequest(BaseModel):
    user_id: UUID | None = None
    email: str | None = None
    send_email: bool = True


class CouponRevokeRequest(BaseModel):
    user_id: UUID | None = None
    email: str | None = None
    reason: str | None = Field(default=None, max_length=255)
    send_email: bool = True


class CouponBulkAssignRequest(BaseModel):
    emails: list[str] = Field(default_factory=list)
    send_email: bool = True


class CouponBulkRevokeRequest(BaseModel):
    emails: list[str] = Field(default_factory=list)
    reason: str | None = Field(default=None, max_length=255)
    send_email: bool = True


class CouponBulkResult(BaseModel):
    requested: int
    unique: int
    invalid_emails: list[str] = Field(default_factory=list)
    not_found_emails: list[str] = Field(default_factory=list)
    created: int = 0
    restored: int = 0
    already_active: int = 0
    revoked: int = 0
    already_revoked: int = 0
    not_assigned: int = 0


class CouponBulkSegmentFilters(BaseModel):
    require_marketing_opt_in: bool = False
    require_email_verified: bool = False


class CouponBulkSegmentAssignRequest(CouponBulkSegmentFilters):
    send_email: bool = True


class CouponBulkSegmentRevokeRequest(CouponBulkSegmentFilters):
    reason: str | None = Field(default=None, max_length=255)
    send_email: bool = True


class CouponBulkSegmentPreview(BaseModel):
    total_candidates: int = 0
    sample_emails: list[str] = Field(default_factory=list)
    created: int = 0
    restored: int = 0
    already_active: int = 0
    revoked: int = 0
    already_revoked: int = 0
    not_assigned: int = 0


class CouponBulkJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    coupon_id: UUID
    created_by_user_id: UUID | None = None
    action: CouponBulkJobAction
    status: CouponBulkJobStatus
    require_marketing_opt_in: bool
    require_email_verified: bool
    send_email: bool
    revoke_reason: str | None = None
    total_candidates: int
    processed: int
    created: int
    restored: int
    already_active: int
    revoked: int
    already_revoked: int
    not_assigned: int
    error_message: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class CouponAnalyticsSummary(BaseModel):
    redemptions: int = 0
    total_discount_ron: Decimal = Decimal("0.00")
    total_shipping_discount_ron: Decimal = Decimal("0.00")
    avg_order_total_with_coupon: Decimal | None = None
    avg_order_total_without_coupon: Decimal | None = None
    aov_lift: Decimal | None = None


class CouponAnalyticsDaily(BaseModel):
    date: str
    redemptions: int = 0
    discount_ron: Decimal = Decimal("0.00")
    shipping_discount_ron: Decimal = Decimal("0.00")


class CouponAnalyticsTopProduct(BaseModel):
    product_id: UUID
    product_slug: str | None = None
    product_name: str
    orders_count: int = 0
    quantity: int = 0
    gross_sales_ron: Decimal = Decimal("0.00")
    allocated_discount_ron: Decimal = Decimal("0.00")


class CouponAnalyticsResponse(BaseModel):
    summary: CouponAnalyticsSummary
    daily: list[CouponAnalyticsDaily] = Field(default_factory=list)
    top_products: list[CouponAnalyticsTopProduct] = Field(default_factory=list)
