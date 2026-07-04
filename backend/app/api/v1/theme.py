"""Theme resolve/read API (WU4a).

The server-authoritative read surface for the storefront theme: the published
document (public/SSR consumer) plus the admin-only draft and version history.
Mirrors ``content.py`` conventions (``APIRouter`` + ``Depends(get_session)`` +
``require_admin_section``). The mutate surface (draft-save / publish / rollback)
lands in WU4b.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_session, require_admin_section
from app.models.user import User
from app.schemas.theme import (
    ThemeTokensRead,
    ThemeVersionListItem,
    ThemeVersionListResponse,
)
from app.services import theme_service

router = APIRouter(prefix="/theme", tags=["theme"])


def _to_read(resolved: theme_service.ResolvedTheme) -> ThemeTokensRead:
    return ThemeTokensRead(
        tokens=resolved.tokens,
        version=resolved.version,
        schema_version=resolved.schema_version,
        status=resolved.status,
        published_at=resolved.published_at,
        updated_at=resolved.updated_at,
    )


@router.get("", response_model=ThemeTokensRead)
async def get_published_theme(
    session: AsyncSession = Depends(get_session),
) -> ThemeTokensRead:
    """Current published tokens — public/SSR consumer (no auth)."""
    resolved = await theme_service.resolve_published_tokens(session)
    if resolved is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Theme not found"
        )
    return _to_read(resolved)


@router.get("/draft", response_model=ThemeTokensRead)
async def get_theme_draft(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("theme")),
) -> ThemeTokensRead:
    """Current editable draft (admin only)."""
    resolved = await theme_service.get_draft(session)
    if resolved is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Theme not found"
        )
    return _to_read(resolved)


@router.get("/versions", response_model=ThemeVersionListResponse)
async def list_theme_versions(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("theme")),
) -> ThemeVersionListResponse:
    """Browsable version history, newest first (admin only)."""
    versions = await theme_service.list_versions(session)
    return ThemeVersionListResponse(
        items=[ThemeVersionListItem.model_validate(v) for v in versions]
    )
