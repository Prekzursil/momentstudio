from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_admin_section
from app.db.session import get_session
from app.models.shipping_locker import ShippingLockerProvider, ShippingLockerSyncRun
from app.models.user import User
from app.schemas.shipping_admin import (
    SamedaySyncRunListResponse,
    SamedaySyncRunRead,
    SamedaySyncStatusRead,
)
from app.services import sameday_easybox_mirror

router = APIRouter(prefix="/admin/shipping", tags=["admin shipping"])


def _run_to_read(run: ShippingLockerSyncRun) -> SamedaySyncRunRead:
    return SamedaySyncRunRead(
        id=run.id,
        provider=run.provider.value,  # type: ignore[arg-type]
        status=run.status.value,  # type: ignore[arg-type]
        started_at=run.started_at,
        finished_at=run.finished_at,
        fetched_count=int(run.fetched_count or 0),
        upserted_count=int(run.upserted_count or 0),
        deactivated_count=int(run.deactivated_count or 0),
        candidate_count=int(run.candidate_count or 0),
        normalized_count=int(run.normalized_count or 0),
        normalization_ratio=float(run.normalization_ratio) if run.normalization_ratio is not None else None,
        schema_signature=run.schema_signature,
        schema_drift_detected=bool(run.schema_drift_detected),
        failure_kind=run.failure_kind,
        challenge_failure=bool(run.challenge_failure),
        error_message=run.error_message,
        source_url_used=run.source_url_used,
        payload_hash=run.payload_hash,
    )


@router.get("/sameday-sync/status", response_model=SamedaySyncStatusRead)
async def get_sameday_sync_status(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("ops")),
) -> SamedaySyncStatusRead:
    snapshot = await sameday_easybox_mirror.get_snapshot_status(session)
    latest_run = await sameday_easybox_mirror.get_latest_run(session)
    return SamedaySyncStatusRead(
        provider=ShippingLockerProvider.sameday.value,  # type: ignore[arg-type]
        total_lockers=int(snapshot.total_lockers),
        last_success_at=snapshot.last_success_at,
        last_error=snapshot.last_error,
        stale=bool(snapshot.stale),
        stale_age_seconds=snapshot.stale_age_seconds,
        challenge_failure_streak=int(snapshot.challenge_failure_streak or 0),
        schema_drift_detected=bool(snapshot.schema_drift_detected),
        last_schema_drift_at=snapshot.last_schema_drift_at,
        canary_alert_codes=list(snapshot.canary_alert_codes or []),
        canary_alert_messages=list(snapshot.canary_alert_messages or []),
        latest_run=_run_to_read(latest_run) if latest_run else None,
    )


@router.get("/sameday-sync/runs", response_model=SamedaySyncRunListResponse)
async def list_sameday_sync_runs(
    page: int = Query(default=1, ge=1, le=10000),
    limit: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("ops")),
) -> SamedaySyncRunListResponse:
    rows, total = await sameday_easybox_mirror.list_sync_runs(session, page=page, limit=limit)
    return SamedaySyncRunListResponse(
        items=[_run_to_read(row) for row in rows],
        meta={"page": int(page), "limit": int(limit), "total": int(total)},
    )


@router.post("/sameday-sync/run", response_model=SamedaySyncRunRead)
async def run_sameday_sync_now(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("ops")),
) -> SamedaySyncRunRead:
    run = await sameday_easybox_mirror.sync_now(session, trigger="manual")
    return _run_to_read(run)
