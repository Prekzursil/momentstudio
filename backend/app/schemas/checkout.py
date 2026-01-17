from datetime import date
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field

from app.models.order import OrderStatus


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
    billing_line1: str | None = Field(default=None, min_length=1, max_length=200)
    billing_line2: str | None = Field(default=None, max_length=200)
    billing_city: str | None = Field(default=None, min_length=1, max_length=100)
    billing_region: str | None = Field(default=None, max_length=100)
    billing_postal_code: str | None = Field(default=None, min_length=1, max_length=20)
    billing_country: str | None = Field(default=None, min_length=2, max_length=2)
    payment_method: str = Field(default="stripe", pattern="^(stripe|cod|paypal|netopia)$")
    courier: str = Field(default="sameday", pattern="^(sameday|fan_courier)$")
    delivery_type: str = Field(default="home", pattern="^(home|locker)$")
    locker_id: str | None = Field(default=None, max_length=80)
    locker_name: str | None = Field(default=None, max_length=255)
    locker_address: str | None = Field(default=None, max_length=255)
    locker_lat: float | None = None
    locker_lng: float | None = None
    shipping_method_id: UUID | None = None
    promo_code: str | None = None
    save_address: bool = True


class GuestCheckoutResponse(BaseModel):
    order_id: UUID
    reference_code: str | None = None
    paypal_order_id: str | None = None
    paypal_approval_url: str | None = None
    stripe_session_id: str | None = None
    stripe_checkout_url: str | None = None
    payment_method: str = "stripe"


class PayPalCaptureRequest(BaseModel):
    paypal_order_id: str = Field(min_length=1, max_length=255)


class PayPalCaptureResponse(BaseModel):
    order_id: UUID
    reference_code: str | None = None
    status: OrderStatus
    paypal_capture_id: str | None = None


class StripeConfirmRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=255)


class StripeConfirmResponse(BaseModel):
    order_id: UUID
    reference_code: str | None = None
    status: OrderStatus


class CheckoutRequest(BaseModel):
    line1: str = Field(min_length=1, max_length=200)
    line2: str | None = Field(default=None, max_length=200)
    city: str = Field(min_length=1, max_length=100)
    region: str | None = Field(default=None, max_length=100)
    postal_code: str = Field(min_length=1, max_length=20)
    country: str = Field(min_length=2, max_length=2)
    billing_line1: str | None = Field(default=None, min_length=1, max_length=200)
    billing_line2: str | None = Field(default=None, max_length=200)
    billing_city: str | None = Field(default=None, min_length=1, max_length=100)
    billing_region: str | None = Field(default=None, max_length=100)
    billing_postal_code: str | None = Field(default=None, min_length=1, max_length=20)
    billing_country: str | None = Field(default=None, min_length=2, max_length=2)
    payment_method: str = Field(default="stripe", pattern="^(stripe|cod|paypal|netopia)$")
    courier: str = Field(default="sameday", pattern="^(sameday|fan_courier)$")
    delivery_type: str = Field(default="home", pattern="^(home|locker)$")
    locker_id: str | None = Field(default=None, max_length=80)
    locker_name: str | None = Field(default=None, max_length=255)
    locker_address: str | None = Field(default=None, max_length=255)
    locker_lat: float | None = None
    locker_lng: float | None = None
    shipping_method_id: UUID | None = None
    promo_code: str | None = None
    save_address: bool = True
