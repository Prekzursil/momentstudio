from pydantic import BaseModel


class PaymentMethodCapability(BaseModel):
    supported: bool = True
    configured: bool = True
    enabled: bool = True
    reason: str | None = None


class PaymentsCapabilitiesResponse(BaseModel):
    payments_provider: str
    stripe: PaymentMethodCapability
    paypal: PaymentMethodCapability
    netopia: PaymentMethodCapability
    cod: PaymentMethodCapability

