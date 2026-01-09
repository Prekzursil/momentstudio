from uuid import UUID
from pydantic import BaseModel, EmailStr, Field


class GuestCheckoutRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    password: str | None = Field(default=None, min_length=6, max_length=128)
    create_account: bool = False
    line1: str = Field(min_length=1, max_length=200)
    line2: str | None = Field(default=None, max_length=200)
    city: str = Field(min_length=1, max_length=100)
    region: str | None = Field(default=None, max_length=100)
    postal_code: str = Field(min_length=1, max_length=20)
    country: str = Field(min_length=2, max_length=2)
    shipping_method_id: UUID | None = None
    promo_code: str | None = None
    save_address: bool = True


class GuestCheckoutResponse(BaseModel):
    order_id: UUID
    reference_code: str | None = None
    client_secret: str


class CheckoutRequest(BaseModel):
    line1: str = Field(min_length=1, max_length=200)
    line2: str | None = Field(default=None, max_length=200)
    city: str = Field(min_length=1, max_length=100)
    region: str | None = Field(default=None, max_length=100)
    postal_code: str = Field(min_length=1, max_length=20)
    country: str = Field(min_length=2, max_length=2)
    shipping_method_id: UUID | None = None
    promo_code: str | None = None
    save_address: bool = True
