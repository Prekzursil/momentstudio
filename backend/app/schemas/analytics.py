from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class AnalyticsEventCreate(BaseModel):
    event: str = Field(min_length=1, max_length=80)
    session_id: str = Field(min_length=1, max_length=100)
    path: str | None = Field(default=None, max_length=500)
    order_id: UUID | None = None
    payload: dict[str, Any] | None = None


class AnalyticsEventIngestResponse(BaseModel):
    received: bool = True


class AdminFunnelCounts(BaseModel):
    sessions: int = 0
    carts: int = 0
    checkouts: int = 0
    orders: int = 0


class AdminFunnelConversions(BaseModel):
    to_cart: float | None = None
    to_checkout: float | None = None
    to_order: float | None = None


class AdminFunnelMetricsResponse(BaseModel):
    range_days: int
    range_from: date
    range_to: date
    opt_in_only: bool = True
    counts: AdminFunnelCounts = Field(default_factory=AdminFunnelCounts)
    conversions: AdminFunnelConversions = Field(default_factory=AdminFunnelConversions)

