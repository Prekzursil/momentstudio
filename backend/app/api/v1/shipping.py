from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.shipping import LockerCitySearchResponse, LockerProvider, LockerRead
from app.services import lockers as lockers_service
from app.services import sameday_easybox_mirror

router = APIRouter(prefix="/shipping", tags=["shipping"])


@router.get("/lockers", response_model=list[LockerRead])
async def list_lockers(
    provider: LockerProvider = Query(..., description="Locker network provider"),
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(default=10.0, ge=1.0, le=50.0),
    limit: int = Query(default=60, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
) -> list[LockerRead]:
    try:
        return await lockers_service.list_lockers(
            provider=provider,
            lat=lat,
            lng=lng,
            radius_km=radius_km,
            limit=limit,
            session=session,
        )
    except lockers_service.LockersNotConfiguredError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to load lockers") from exc


@router.get("/lockers/cities", response_model=LockerCitySearchResponse)
async def list_locker_cities(
    provider: LockerProvider = Query(..., description="Locker network provider"),
    q: str = Query(default="", max_length=120),
    limit: int = Query(default=8, ge=1, le=50),
    session: AsyncSession = Depends(get_session),
) -> LockerCitySearchResponse:
    if provider != LockerProvider.sameday:
        return LockerCitySearchResponse(items=[], snapshot=None)

    try:
        items = await sameday_easybox_mirror.list_city_suggestions(session, q=q, limit=limit)
        snapshot = await sameday_easybox_mirror.get_snapshot_status(session)
        return LockerCitySearchResponse(items=items, snapshot=snapshot)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to load locker city suggestions") from exc
