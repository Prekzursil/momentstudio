from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.dependencies import require_admin
from app.db.session import get_session
from app.models.fx import FxOverrideAuditLog
from app.models.user import User
from app.schemas.fx import FxAdminStatus, FxOverrideAuditEntry, FxOverrideUpsert, FxRatesRead
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
    current_user: User = Depends(require_admin),
) -> FxRatesRead:
    return await fx_store.set_override(session, payload, user_id=current_user.id)


@router.delete("/admin/override", status_code=status.HTTP_204_NO_CONTENT)
async def clear_fx_override(
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin),
) -> None:
    await fx_store.clear_override(session, user_id=current_user.id)


@router.get("/admin/override/audit", response_model=list[FxOverrideAuditEntry])
async def list_fx_override_audit(
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[FxOverrideAuditEntry]:
    rows = (
        await session.execute(
            select(FxOverrideAuditLog, User.email)
            .join(User, FxOverrideAuditLog.user_id == User.id, isouter=True)
            .order_by(FxOverrideAuditLog.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [
        FxOverrideAuditEntry(
            id=str(log.id),
            action=str(log.action),
            created_at=log.created_at,
            user_id=str(log.user_id) if log.user_id else None,
            user_email=email,
            eur_per_ron=float(log.eur_per_ron) if log.eur_per_ron is not None else None,
            usd_per_ron=float(log.usd_per_ron) if log.usd_per_ron is not None else None,
            as_of=log.as_of,
        )
        for log, email in rows
    ]


@router.post("/admin/override/audit/{audit_id}/revert", response_model=FxAdminStatus)
async def revert_fx_override(
    audit_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_admin),
) -> FxAdminStatus:
    entry = await session.get(FxOverrideAuditLog, audit_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit entry not found")
    if entry.eur_per_ron is None or entry.usd_per_ron is None or entry.as_of is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Audit entry cannot be restored")
    await fx_store.set_override(
        session,
        FxOverrideUpsert(eur_per_ron=float(entry.eur_per_ron), usd_per_ron=float(entry.usd_per_ron), as_of=entry.as_of),
        user_id=current_user.id,
        audit_action="restore",
    )
    return await fx_store.get_admin_status(session)
