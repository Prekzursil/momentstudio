from datetime import date
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field


class GuestEmailVerificationRequest(BaseModel):
    email: EmailStr


class GuestEmailVerificationConfirmRequest(BaseModel):
    email: EmailStr
    token: str = Field(min_length=1, max_length=64)


class GuestEmailVerificationStatus(BaseModel):
    email: EmailStr | None = None
    verified: bool


class GuestCheckoutRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    password: str | None = Field(default=None, min_length=6, max_length=128)
    create_account: bool = False
    username: str | None = Field(
        default=None,
        min_length=3,
        max_length=30,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$",
    )
    first_name: str | None = Field(default=None, max_length=100)
    middle_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    date_of_birth: date | None = None
    phone: str | None = Field(default=None, max_length=32, pattern=r"^\+[1-9]\d{1,14}$")
    preferred_language: str | None = Field(default=None, pattern="^(en|ro)$")
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
