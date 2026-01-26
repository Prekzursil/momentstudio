from pydantic import BaseModel, Field


class AdminOrderFraudSignal(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    severity: str = Field(pattern="^(info|low|medium|high)$")
    data: dict | None = None

