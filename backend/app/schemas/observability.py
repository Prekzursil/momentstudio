from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class AdminClientErrorIn(BaseModel):
    kind: Literal["window_error", "unhandled_rejection"] = "window_error"
    message: str = Field(min_length=1, max_length=4000)
    stack: str | None = Field(default=None, max_length=20000)
    url: str | None = Field(default=None, max_length=2048)
    route: str | None = Field(default=None, max_length=1024)
    user_agent: str | None = Field(default=None, max_length=1024)
    context: dict[str, Any] | None = None
    occurred_at: datetime | None = None

