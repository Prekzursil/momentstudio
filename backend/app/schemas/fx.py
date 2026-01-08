from datetime import date, datetime

from pydantic import BaseModel, Field


class FxRatesRead(BaseModel):
    base: str = Field(min_length=3, max_length=3)
    eur_per_ron: float = Field(gt=0)
    usd_per_ron: float = Field(gt=0)
    as_of: date
    source: str
    fetched_at: datetime


class FxOverrideUpsert(BaseModel):
    eur_per_ron: float = Field(gt=0)
    usd_per_ron: float = Field(gt=0)
    as_of: date | None = None


class FxAdminStatus(BaseModel):
    effective: FxRatesRead
    override: FxRatesRead | None = None
    last_known: FxRatesRead | None = None
