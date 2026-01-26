from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_admin_section
from app.db.session import get_session
from app.models.ops import MaintenanceBanner
from app.models.user import User
from app.schemas.ops import (
    MaintenanceBannerCreate,
    MaintenanceBannerPublic,
    MaintenanceBannerRead,
    MaintenanceBannerUpdate,
    ShippingSimulationRequest,
    ShippingSimulationResult,
)
from app.services import ops as ops_service

router = APIRouter(prefix="/ops", tags=["ops"])


@router.get("/banner", response_model=MaintenanceBannerPublic, responses={204: {"description": "No banner"}})
async def get_active_banner(session: AsyncSession = Depends(get_session)) -> MaintenanceBannerPublic | Response:
    banner = await ops_service.get_active_maintenance_banner(session)
    if not banner:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return MaintenanceBannerPublic.model_validate(banner)


@router.get("/admin/banners", response_model=list[MaintenanceBannerRead])
async def admin_list_banners(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("ops")),
) -> list[MaintenanceBannerRead]:
    rows = await ops_service.list_maintenance_banners(session)
    return [MaintenanceBannerRead.model_validate(r) for r in rows]


@router.post("/admin/banners", response_model=MaintenanceBannerRead, status_code=status.HTTP_201_CREATED)
async def admin_create_banner(
    payload: MaintenanceBannerCreate,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("ops")),
) -> MaintenanceBannerRead:
    now = datetime.now(timezone.utc)
    if payload.ends_at and payload.ends_at <= payload.starts_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="End time must be after start time")
    if payload.starts_at < now.replace(year=now.year - 5):  # soft sanity check
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Start time is too far in the past")
    banner = MaintenanceBanner(**payload.model_dump())
    created = await ops_service.create_maintenance_banner(session, banner)
    return MaintenanceBannerRead.model_validate(created)


@router.patch("/admin/banners/{banner_id}", response_model=MaintenanceBannerRead)
async def admin_update_banner(
    banner_id: UUID,
    payload: MaintenanceBannerUpdate,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("ops")),
) -> MaintenanceBannerRead:
    banner = await session.get(MaintenanceBanner, banner_id)
    if not banner:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Banner not found")
    data = payload.model_dump(exclude_unset=True)
    next_starts = data.get("starts_at", getattr(banner, "starts_at", None))
    next_ends = data.get("ends_at", getattr(banner, "ends_at", None))
    if next_ends and next_starts and next_ends <= next_starts:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="End time must be after start time")
    for key, value in data.items():
        setattr(banner, key, value)
    updated = await ops_service.update_maintenance_banner(session, banner)
    return MaintenanceBannerRead.model_validate(updated)


@router.delete("/admin/banners/{banner_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def admin_delete_banner(
    banner_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("ops")),
) -> None:
    banner = await session.get(MaintenanceBanner, banner_id)
    if not banner:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Banner not found")
    await ops_service.delete_maintenance_banner(session, banner)


@router.post("/admin/shipping-simulate", response_model=ShippingSimulationResult)
async def admin_shipping_simulate(
    payload: ShippingSimulationRequest,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("ops")),
) -> ShippingSimulationResult:
    return await ops_service.simulate_shipping_rates(
        session,
        subtotal_ron=payload.subtotal_ron,
        discount_ron=payload.discount_ron,
        shipping_method_id=payload.shipping_method_id,
        country=payload.country,
        postal_code=payload.postal_code,
    )
