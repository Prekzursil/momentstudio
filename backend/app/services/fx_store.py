from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.fx import FxRate
from app.schemas.fx import FxAdminStatus, FxOverrideUpsert, FxRatesRead
from app.services import fx_rates


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


async def _upsert_row(session: AsyncSession, *, is_override: bool, data: FxRatesRead) -> FxRate:
    existing = await _get_row(session, is_override=is_override)
    if existing:
        existing.base = data.base
        existing.eur_per_ron = data.eur_per_ron
        existing.usd_per_ron = data.usd_per_ron
        existing.as_of = data.as_of
        existing.source = data.source
        existing.fetched_at = data.fetched_at
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
    try:
        await session.commit()
    except IntegrityError:
        # A concurrent request inserted the row first; fall back to update.
        await session.rollback()
        existing = await _get_row(session, is_override=is_override)
        if not existing:
            raise
        existing.base = data.base
        existing.eur_per_ron = data.eur_per_ron
        existing.usd_per_ron = data.usd_per_ron
        existing.as_of = data.as_of
        existing.source = data.source
        existing.fetched_at = data.fetched_at
        session.add(existing)
        await session.commit()
        await session.refresh(existing)
        return existing
    await session.refresh(row)
    return row


async def get_effective_rates(session: AsyncSession) -> FxRatesRead:
    override = await _get_row(session, is_override=True)
    if override:
        return _row_to_read(override)

    try:
        live = await fx_rates.get_fx_rates()
        read = FxRatesRead(
            base=live.base,
            eur_per_ron=live.eur_per_ron,
            usd_per_ron=live.usd_per_ron,
            as_of=live.as_of,
            source=live.source,
            fetched_at=live.fetched_at,
        )
        await _upsert_row(session, is_override=False, data=read)
        return read
    except Exception:
        last_known = await _get_row(session, is_override=False)
        if last_known:
            return _row_to_read(last_known)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="FX rates unavailable")


async def set_override(session: AsyncSession, payload: FxOverrideUpsert) -> FxRatesRead:
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
    return read


async def clear_override(session: AsyncSession) -> None:
    existing = await _get_row(session, is_override=True)
    if not existing:
        return
    await session.delete(existing)
    await session.commit()


async def get_admin_status(session: AsyncSession) -> FxAdminStatus:
    override = await _get_row(session, is_override=True)
    last_known = await _get_row(session, is_override=False)
    effective = _row_to_read(override) if override else (await get_effective_rates(session))
    return FxAdminStatus(
        effective=effective,
        override=_row_to_read(override) if override else None,
        last_known=_row_to_read(last_known) if last_known else None,
    )

