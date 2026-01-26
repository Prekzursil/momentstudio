from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


BannerLevel = Literal["info", "warning", "promo"]


class MaintenanceBannerCreate(BaseModel):
    is_active: bool = True
    level: BannerLevel = "info"
    message_en: str = Field(min_length=1, max_length=2000)
    message_ro: str = Field(min_length=1, max_length=2000)
    link_url: str | None = Field(default=None, max_length=500)
    link_label_en: str | None = Field(default=None, max_length=120)
    link_label_ro: str | None = Field(default=None, max_length=120)
    starts_at: datetime
    ends_at: datetime | None = None


class MaintenanceBannerUpdate(BaseModel):
    is_active: bool | None = None
    level: BannerLevel | None = None
    message_en: str | None = Field(default=None, max_length=2000)
    message_ro: str | None = Field(default=None, max_length=2000)
    link_url: str | None = Field(default=None, max_length=500)
    link_label_en: str | None = Field(default=None, max_length=120)
    link_label_ro: str | None = Field(default=None, max_length=120)
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class MaintenanceBannerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    is_active: bool
    level: str
    message_en: str
    message_ro: str
    link_url: str | None = None
    link_label_en: str | None = None
    link_label_ro: str | None = None
    starts_at: datetime
    ends_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class MaintenanceBannerPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    level: str
    message_en: str
    message_ro: str
    link_url: str | None = None
    link_label_en: str | None = None
    link_label_ro: str | None = None
    starts_at: datetime
    ends_at: datetime | None = None


class ShippingSimulationRequest(BaseModel):
    subtotal_ron: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    discount_ron: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=10, decimal_places=2)
    shipping_method_id: UUID | None = None
    country: str | None = Field(default=None, max_length=80)
    postal_code: str | None = Field(default=None, max_length=20)


class ShippingSimulationMethod(BaseModel):
    id: UUID
    name: str
    rate_flat: Decimal | None = None
    rate_per_kg: Decimal | None = None
    computed_shipping_ron: Decimal


class ShippingSimulationResult(BaseModel):
    subtotal_ron: Decimal
    discount_ron: Decimal
    taxable_subtotal_ron: Decimal
    shipping_ron: Decimal
    fee_ron: Decimal
    vat_ron: Decimal
    total_ron: Decimal
    shipping_fee_ron: Decimal | None = None
    free_shipping_threshold_ron: Decimal | None = None
    selected_shipping_method_id: UUID | None = None
    methods: list[ShippingSimulationMethod] = Field(default_factory=list)


WebhookProvider = Literal["stripe", "paypal"]
WebhookStatus = Literal["received", "processed", "failed"]


class WebhookEventRead(BaseModel):
    provider: WebhookProvider
    event_id: str
    event_type: str | None = None
    created_at: datetime
    attempts: int
    last_attempt_at: datetime
    processed_at: datetime | None = None
    last_error: str | None = None
    status: WebhookStatus


class WebhookEventDetail(WebhookEventRead):
    payload: dict | None = None


class EmailFailureRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    to_email: str
    subject: str
    error_message: str | None = None
    created_at: datetime


class FailureCount(BaseModel):
    failed: int = 0
    since_hours: int
