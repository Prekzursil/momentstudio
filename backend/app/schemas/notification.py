from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    type: str
    title: str
    body: str | None = None
    url: str | None = None
    created_at: datetime
    read_at: datetime | None = None
    dismissed_at: datetime | None = None


class NotificationListResponse(BaseModel):
    items: list[NotificationRead]


class NotificationUnreadCountResponse(BaseModel):
    count: int = Field(ge=0)

