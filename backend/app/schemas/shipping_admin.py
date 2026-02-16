from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


ShippingLockerProviderLiteral = Literal["sameday"]
ShippingLockerSyncStatusLiteral = Literal["running", "success", "failed"]


class SamedaySyncRunRead(BaseModel):
    id: UUID
    provider: ShippingLockerProviderLiteral
    status: ShippingLockerSyncStatusLiteral
    started_at: datetime
    finished_at: datetime | None = None
    fetched_count: int = Field(default=0, ge=0)
    upserted_count: int = Field(default=0, ge=0)
    deactivated_count: int = Field(default=0, ge=0)
    error_message: str | None = None
    source_url_used: str | None = None
    payload_hash: str | None = None


class SamedaySyncRunListResponse(BaseModel):
    items: list[SamedaySyncRunRead] = Field(default_factory=list)
    meta: dict[str, int] = Field(default_factory=dict)


class SamedaySyncStatusRead(BaseModel):
    provider: ShippingLockerProviderLiteral
    total_lockers: int = Field(default=0, ge=0)
    last_success_at: datetime | None = None
    last_error: str | None = None
    stale: bool = False
    stale_age_seconds: int | None = Field(default=None, ge=0)
    latest_run: SamedaySyncRunRead | None = None
