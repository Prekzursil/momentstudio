from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.coupons_v2 import CouponVisibility, PromotionDiscountType


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
