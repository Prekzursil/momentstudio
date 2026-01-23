from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class OrderShipmentBase(BaseModel):
    courier: str | None = Field(default=None, max_length=30)
    tracking_number: str = Field(min_length=1, max_length=50)
    tracking_url: str | None = Field(default=None, max_length=255)


class OrderShipmentCreate(OrderShipmentBase):
    pass


class OrderShipmentUpdate(BaseModel):
    courier: str | None = Field(default=None, max_length=30)
    tracking_number: str | None = Field(default=None, max_length=50)
    tracking_url: str | None = Field(default=None, max_length=255)


class OrderShipmentRead(OrderShipmentBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    order_id: UUID
    created_at: datetime

