from pydantic import BaseModel, Field

from app.schemas.address import AddressUpdate


class AdminOrderAddressesUpdate(BaseModel):
    shipping_address: AddressUpdate | None = None
    billing_address: AddressUpdate | None = None
    rerate_shipping: bool = Field(default=True)
    note: str | None = Field(default=None, max_length=255)

