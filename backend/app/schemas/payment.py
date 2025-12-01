from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict


class PaymentMethodRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    stripe_payment_method_id: str
    brand: str | None = None
    last4: str | None = None
    exp_month: int | None = None
    exp_year: int | None = None
    created_at: datetime


class SetupIntentResponse(BaseModel):
    client_secret: str
    customer_id: str


class AttachPaymentMethodRequest(BaseModel):
    payment_method_id: str
