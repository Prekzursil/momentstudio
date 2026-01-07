from datetime import date, datetime

from pydantic import BaseModel, Field


class FxRatesRead(BaseModel):
    base: str = Field(min_length=3, max_length=3)
    eur_per_ron: float = Field(gt=0)
    usd_per_ron: float = Field(gt=0)
    as_of: date
    source: str
    fetched_at: datetime
