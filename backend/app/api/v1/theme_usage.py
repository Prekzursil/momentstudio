"""Theme usage/metrics API (WU14).

A single admin-gated READ endpoint exposing theme-change activity — how many
times the live theme was published / rolled back / reset, the current published
version, and who last changed it and when — so an admin can see theme-change
activity at a glance.

This is a NEW module: it does NOT modify ``theme.py`` (the editor's read/mutate
surface) or ``theme_service.py``. The metrics are DERIVED from the existing
append-only ``ThemeAuditLog`` history by ``theme_usage.get_usage_metrics`` (no
counter table, no migration, no extra write-path hook), and the route is
section-gated the same way the rest of the theme admin surface is
(``require_admin_section("theme")``).
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_session, require_admin_section
from app.models.user import User
from app.schemas.theme_usage import ThemeUsageResponse
from app.services import theme_usage

router = APIRouter(prefix="/theme", tags=["theme"])


@router.get("/usage", response_model=ThemeUsageResponse)
async def get_theme_usage(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("theme")),
) -> ThemeUsageResponse:
    """Aggregated theme-change activity (admin only)."""
    metrics = await theme_usage.get_usage_metrics(session)
    return ThemeUsageResponse.model_validate(metrics)
