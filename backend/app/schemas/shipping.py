import enum
from datetime import datetime

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


class LockerMirrorSnapshotRead(BaseModel):
    provider: LockerProvider
    total_lockers: int = Field(default=0, ge=0)
    last_success_at: datetime | None = None
    last_error: str | None = None
    stale: bool = False
    stale_age_seconds: int | None = Field(default=None, ge=0)
    challenge_failure_streak: int = Field(default=0, ge=0)
    schema_drift_detected: bool = False
    last_schema_drift_at: datetime | None = None
    canary_alert_codes: list[str] = Field(default_factory=list)
    canary_alert_messages: list[str] = Field(default_factory=list)


class LockerCityRead(BaseModel):
    provider: LockerProvider
    city: str = Field(min_length=1, max_length=120)
    county: str | None = Field(default=None, max_length=120)
    display_name: str = Field(min_length=1, max_length=255)
    lat: float
    lng: float
    locker_count: int = Field(default=0, ge=0)


class LockerCitySearchResponse(BaseModel):
    items: list[LockerCityRead] = Field(default_factory=list)
    snapshot: LockerMirrorSnapshotRead | None = None
