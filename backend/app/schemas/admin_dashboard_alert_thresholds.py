from datetime import datetime

from pydantic import BaseModel, Field


class AdminDashboardAlertThresholdsResponse(BaseModel):
    failed_payments_min_count: int = Field(ge=1, le=100_000)
    failed_payments_min_delta_pct: float | None = Field(default=None, ge=0, le=100_000)
    refund_requests_min_count: int = Field(ge=1, le=100_000)
    refund_requests_min_rate_pct: float | None = Field(default=None, ge=0, le=100)
    stockouts_min_count: int = Field(ge=1, le=100_000)
    updated_at: datetime | None = None


class AdminDashboardAlertThresholdsUpdateRequest(BaseModel):
    failed_payments_min_count: int = Field(ge=1, le=100_000)
    failed_payments_min_delta_pct: float | None = Field(default=None, ge=0, le=100_000)
    refund_requests_min_count: int = Field(ge=1, le=100_000)
    refund_requests_min_rate_pct: float | None = Field(default=None, ge=0, le=100)
    stockouts_min_count: int = Field(ge=1, le=100_000)

