"""Pydantic response schema for the theme usage/metrics API (WU14)."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ThemeUsageResponse(BaseModel):
    """Theme-change activity for the admin metrics view.

    Field names mirror :class:`~app.services.theme_usage.ThemeUsageMetrics`, so a
    resolved metrics dataclass validates straight through (``from_attributes``).
    """

    model_config = ConfigDict(from_attributes=True)

    publishes: int
    rollbacks: int
    resets: int
    draft_saves: int
    total_publish_events: int
    current_published_version: int | None = None
    last_changed_by: UUID | None = None
    last_changed_at: datetime | None = None
    last_change_action: str | None = None
