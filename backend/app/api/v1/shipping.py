from fastapi import APIRouter, HTTPException, Query, status

from app.schemas.shipping import LockerProvider, LockerRead
from app.services import lockers as lockers_service

router = APIRouter(prefix="/shipping", tags=["shipping"])


@router.get("/lockers", response_model=list[LockerRead])
async def list_lockers(
    provider: LockerProvider = Query(..., description="Locker network provider"),
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(default=10.0, ge=1.0, le=50.0),
    limit: int = Query(default=60, ge=1, le=200),
) -> list[LockerRead]:
    try:
        return await lockers_service.list_lockers(provider=provider, lat=lat, lng=lng, radius_km=radius_km, limit=limit)
    except lockers_service.LockersNotConfiguredError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to load lockers") from exc
