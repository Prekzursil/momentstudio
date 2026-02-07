from uuid import UUID
from pydantic import BaseModel, Field


class CartSyncItem(BaseModel):
    product_id: UUID
    variant_id: UUID | None = None
    quantity: int = Field(gt=0)
    max_quantity: int | None = Field(default=None, gt=0)


class CartSyncRequest(BaseModel):
    items: list[CartSyncItem]
