from typing import Literal

from pydantic import BaseModel


class AdminDashboardSearchResult(BaseModel):
    type: Literal["order", "product", "user"]
    id: str
    label: str
    subtitle: str | None = None
    slug: str | None = None
    email: str | None = None


class AdminDashboardSearchResponse(BaseModel):
    items: list[AdminDashboardSearchResult]

