from fastapi import APIRouter, Depends, status

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_admin
from app.db.session import get_session
from app.schemas.fx import FxAdminStatus, FxOverrideUpsert, FxRatesRead
from app.services import fx_store

router = APIRouter(prefix="/fx", tags=["fx"])


@router.get("/rates", response_model=FxRatesRead)
async def read_fx_rates(session: AsyncSession = Depends(get_session)) -> FxRatesRead:
    return await fx_store.get_effective_rates(session)


@router.get("/admin/status", response_model=FxAdminStatus)
async def fx_admin_status(
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin),
) -> FxAdminStatus:
    return await fx_store.get_admin_status(session)


@router.put("/admin/override", response_model=FxRatesRead)
async def set_fx_override(
    payload: FxOverrideUpsert,
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin),
) -> FxRatesRead:
    return await fx_store.set_override(session, payload)


@router.delete("/admin/override", status_code=status.HTTP_204_NO_CONTENT)
async def clear_fx_override(
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin),
) -> None:
    await fx_store.clear_override(session)
