import enum

from pydantic import BaseModel, Field


class LockerProvider(str, enum.Enum):
    sameday = "sameday"
    fan_courier = "fan_courier"


class LockerRead(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    provider: LockerProvider
    name: str = Field(min_length=1, max_length=255)
    address: str | None = Field(default=None, max_length=255)
    lat: float
    lng: float
    distance_km: float | None = Field(default=None, ge=0)
