from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic import field_validator


class PromoCodeCreate(BaseModel):
    code: str = Field(min_length=3, max_length=40)
    percentage_off: float | None = Field(default=None, ge=0, le=100)
    amount_off: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    expires_at: datetime | None = None
    max_uses: int | None = Field(default=None, ge=1)

    @field_validator("currency")
    @classmethod
    def validate_currency(cls, value: str | None):
        if value is None:
            return value
        cleaned = (value or "").strip().upper()
        if cleaned != "RON":
            raise ValueError("Only RON currency is supported")
        return cleaned


class PromoCodeRead(PromoCodeCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    times_used: int
    active: bool
    created_at: datetime
