from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ScheduledPublishItem(BaseModel):
    id: str
    slug: str
    name: str
    scheduled_for: datetime
    sale_end_at: datetime | None = None


class ScheduledPromoItem(BaseModel):
    id: str
    name: str
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    next_event_at: datetime
    next_event_type: str


class AdminDashboardScheduledTasksResponse(BaseModel):
    publish_schedules: list[ScheduledPublishItem]
    promo_schedules: list[ScheduledPromoItem]

