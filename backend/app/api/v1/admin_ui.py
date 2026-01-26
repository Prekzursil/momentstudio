from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_admin_section
from app.db.session import get_session
from app.models.user import User
from app.schemas.admin_ui import AdminFavoriteItem, AdminFavoritesResponse, AdminFavoritesUpdateRequest

router = APIRouter(prefix="/admin/ui", tags=["admin"])


def _parse_favorites(raw: object) -> list[AdminFavoriteItem]:
    if not isinstance(raw, list):
        return []
    parsed: list[AdminFavoriteItem] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        try:
            parsed.append(AdminFavoriteItem.model_validate(entry))
        except Exception:
            continue

    seen: set[str] = set()
    unique: list[AdminFavoriteItem] = []
    for item in parsed:
        if item.key in seen:
            continue
        seen.add(item.key)
        unique.append(item)
    return unique[:50]


@router.get("/favorites", response_model=AdminFavoritesResponse)
async def get_admin_favorites(
    admin: User = Depends(require_admin_section("dashboard")),
) -> AdminFavoritesResponse:
    return AdminFavoritesResponse(items=_parse_favorites(getattr(admin, "admin_favorites", None)))


@router.put("/favorites", response_model=AdminFavoritesResponse)
async def update_admin_favorites(
    payload: AdminFavoritesUpdateRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("dashboard")),
) -> AdminFavoritesResponse:
    seen: set[str] = set()
    items: list[AdminFavoriteItem] = []
    for item in payload.items:
        if item.key in seen:
            continue
        seen.add(item.key)
        items.append(item)
        if len(items) >= 50:
            break

    admin.admin_favorites = [item.model_dump(mode="json") for item in items]
    session.add(admin)
    await session.commit()
    return AdminFavoritesResponse(items=items)

