from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.fx import FxOverrideAuditLog, FxRate
from app.schemas.fx import FxAdminStatus, FxOverrideUpsert, FxRatesRead
from app.services import fx_rates

logger = logging.getLogger(__name__)


def _row_to_read(row: FxRate) -> FxRatesRead:
    return FxRatesRead(
        base=str(row.base),
        eur_per_ron=float(row.eur_per_ron),
        usd_per_ron=float(row.usd_per_ron),
        as_of=row.as_of,
        source=str(row.source),
        fetched_at=row.fetched_at,
    )


async def _get_row(session: AsyncSession, *, is_override: bool) -> FxRate | None:
    result = await session.execute(select(FxRate).where(FxRate.is_override == is_override))
    return result.scalar_one_or_none()


def _apply_fx_row_data(row: FxRate, data: FxRatesRead) -> None:
    row.base = data.base
    row.eur_per_ron = data.eur_per_ron
    row.usd_per_ron = data.usd_per_ron
    row.as_of = data.as_of
    row.source = data.source
    row.fetched_at = data.fetched_at


async def _upsert_row_via_conflict_stmt(session: AsyncSession, *, is_override: bool, data: FxRatesRead, insert_fn):
    stmt = insert_fn(FxRate).values(
        base=data.base,
        eur_per_ron=data.eur_per_ron,
        usd_per_ron=data.usd_per_ron,
        as_of=data.as_of,
        source=data.source,
        fetched_at=data.fetched_at,
        is_override=is_override,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[FxRate.is_override],
        set_={
            "base": data.base,
            "eur_per_ron": data.eur_per_ron,
            "usd_per_ron": data.usd_per_ron,
            "as_of": data.as_of,
            "source": data.source,
            "fetched_at": data.fetched_at,
            "updated_at": func.now(),
        },
    )
    await session.execute(stmt)
    await session.commit()
    row = await _get_row(session, is_override=is_override)
    if not row:
        raise RuntimeError("fx_rate_upsert_failed")
    await session.refresh(row)
    return row


async def _upsert_row_fallback(session: AsyncSession, *, is_override: bool, data: FxRatesRead) -> FxRate:
    existing = await _get_row(session, is_override=is_override)
    if existing:
        _apply_fx_row_data(existing, data)
        session.add(existing)
        await session.commit()
        await session.refresh(existing)
        return existing
    row = FxRate(
        base=data.base,
        eur_per_ron=data.eur_per_ron,
        usd_per_ron=data.usd_per_ron,
        as_of=data.as_of,
        source=data.source,
        fetched_at=data.fetched_at,
        is_override=is_override,
    )
    session.add(row)
    return row


async def _upsert_row_after_integrity_error(session: AsyncSession, *, is_override: bool, data: FxRatesRead) -> FxRate:
    await session.rollback()
    existing = await _get_row(session, is_override=is_override)
    if not existing:
        raise
    _apply_fx_row_data(existing, data)
    session.add(existing)
    await session.commit()
    await session.refresh(existing)
    return existing


async def _upsert_row(session: AsyncSession, *, is_override: bool, data: FxRatesRead) -> FxRate:
    bind = session.get_bind()
    dialect = getattr(getattr(bind, "dialect", None), "name", "")
    insert_fn = pg_insert if dialect == "postgresql" else (sqlite_insert if dialect == "sqlite" else None)
    if insert_fn is not None:
        return await _upsert_row_via_conflict_stmt(
            session,
            is_override=is_override,
            data=data,
            insert_fn=insert_fn,
        )
    row = await _upsert_row_fallback(session, is_override=is_override, data=data)
    try:
        await session.commit()
    except IntegrityError:
        return await _upsert_row_after_integrity_error(session, is_override=is_override, data=data)
    await session.refresh(row)
    return row


async def _log_override_audit(
    session: AsyncSession,
    *,
    action: str,
    user_id: uuid.UUID | None,
    data: FxRatesRead | None,
) -> None:
    entry = FxOverrideAuditLog(
        action=action,
        user_id=user_id,
        eur_per_ron=data.eur_per_ron if data else None,
        usd_per_ron=data.usd_per_ron if data else None,
        as_of=data.as_of if data else None,
        created_at=datetime.now(timezone.utc),
    )
    session.add(entry)
    await session.commit()


async def get_effective_rates(session: AsyncSession) -> FxRatesRead:
    override = await _get_row(session, is_override=True)
    if override:
        return _row_to_read(override)

    last_known = await _get_row(session, is_override=False)
    if last_known:
        return _row_to_read(last_known)

    try:
        live = await fx_rates.get_fx_rates()
    except Exception as exc:
        logger.warning("fx_rates_fetch_failed", extra={"error": str(exc)})
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="FX rates unavailable")

    read = FxRatesRead(
        base=live.base,
        eur_per_ron=live.eur_per_ron,
        usd_per_ron=live.usd_per_ron,
        as_of=live.as_of,
        source=live.source,
        fetched_at=live.fetched_at,
    )
    try:
        await _upsert_row(session, is_override=False, data=read)
    except SQLAlchemyError as exc:
        logger.warning("fx_rates_persist_failed", extra={"error": str(exc)})
        await session.rollback()
    return read


async def set_override(
    session: AsyncSession,
    payload: FxOverrideUpsert,
    *,
    user_id: uuid.UUID | None = None,
    audit_action: str = "set",
) -> FxRatesRead:
    now = datetime.now(timezone.utc)
    as_of = payload.as_of or date.today()
    read = FxRatesRead(
        base="RON",
        eur_per_ron=payload.eur_per_ron,
        usd_per_ron=payload.usd_per_ron,
        as_of=as_of,
        source="admin",
        fetched_at=now,
    )
    await _upsert_row(session, is_override=True, data=read)
    await _log_override_audit(session, action=audit_action, user_id=user_id, data=read)
    return read


async def clear_override(
    session: AsyncSession,
    *,
    user_id: uuid.UUID | None = None,
    audit_action: str = "clear",
) -> None:
    existing = await _get_row(session, is_override=True)
    if not existing:
        return
    cleared = _row_to_read(existing)
    await session.delete(existing)
    await session.commit()
    await _log_override_audit(session, action=audit_action, user_id=user_id, data=cleared)


async def get_admin_status(session: AsyncSession) -> FxAdminStatus:
    override = await _get_row(session, is_override=True)
    last_known = await _get_row(session, is_override=False)
    effective = _row_to_read(override) if override else (await get_effective_rates(session))
    return FxAdminStatus(
        effective=effective,
        override=_row_to_read(override) if override else None,
        last_known=_row_to_read(last_known) if last_known else None,
    )


async def refresh_last_known(session: AsyncSession) -> FxRatesRead:
    live = await fx_rates.get_fx_rates(force_refresh=True)
    read = FxRatesRead(
        base=live.base,
        eur_per_ron=live.eur_per_ron,
        usd_per_ron=live.usd_per_ron,
        as_of=live.as_of,
        source=live.source,
        fetched_at=live.fetched_at,
    )
    try:
        await _upsert_row(session, is_override=False, data=read)
    except SQLAlchemyError as exc:
        logger.warning("fx_rates_persist_failed", extra={"error": str(exc)})
        await session.rollback()
    return read
