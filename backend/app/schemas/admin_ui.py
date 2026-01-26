from typing import Any, Literal

from pydantic import BaseModel, Field


class AdminFavoriteItem(BaseModel):
    key: str = Field(min_length=1, max_length=128)
    type: Literal["page", "content", "order", "product", "user", "filter"]
    label: str = Field(min_length=1, max_length=180)
    subtitle: str = Field(default="", max_length=240)
    url: str = Field(min_length=1, max_length=500)
    state: dict[str, Any] | None = None


class AdminFavoritesResponse(BaseModel):
    items: list[AdminFavoriteItem]


class AdminFavoritesUpdateRequest(BaseModel):
    items: list[AdminFavoriteItem] = Field(default_factory=list, max_length=50)

