from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _normalize_country_code(value: object) -> str:
    code = str(value or "").strip().upper()
    if len(code) != 2 or not code.isalpha():
        raise ValueError("Country code must be a 2-letter code")
    return code


class TaxRateUpsert(BaseModel):
    country_code: str = Field(min_length=2, max_length=2)
    vat_rate_percent: Decimal = Field(ge=0, le=100)

    @field_validator("country_code")
    @classmethod
    def validate_country_code(cls, v: str) -> str:
        return _normalize_country_code(v)


class TaxRateRead(TaxRateUpsert):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime


class TaxGroupCreate(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    is_default: bool = False

    @field_validator("code")
    @classmethod
    def normalize_code(cls, v: str) -> str:
        cleaned = str(v or "").strip().lower().replace(" ", "-")
        if not cleaned:
            raise ValueError("Code is required")
        return cleaned


class TaxGroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    is_default: bool | None = None


class TaxGroupRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name: str
    description: str | None = None
    is_default: bool
    created_at: datetime
    updated_at: datetime
    rates: list[TaxRateRead] = Field(default_factory=list)

