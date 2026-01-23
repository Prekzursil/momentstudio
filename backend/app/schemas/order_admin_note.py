from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class OrderAdminNoteActorRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    username: str | None = None


class OrderAdminNoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    note: str
    created_at: datetime
    actor: OrderAdminNoteActorRead | None = None


class OrderAdminNoteCreate(BaseModel):
    note: str = Field(min_length=1, max_length=5000)

