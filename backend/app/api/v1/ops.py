from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_admin_section
from app.db.session import get_session
from app.models.ops import MaintenanceBanner
from app.models.user import User
from app.schemas.ops import (
    EmailEventRead,
    EmailFailureRead,
    FailureCount,
    MaintenanceBannerCreate,
    MaintenanceBannerPublic,
    MaintenanceBannerRead,
    MaintenanceBannerUpdate,
    OpsDiagnosticsRead,
    ShippingSimulationRequest,
    ShippingSimulationResult,
    WebhookBacklogCount,
    WebhookEventDetail,
    WebhookEventRead,
)
from app.services import ops as ops_service
from app.services import audit_chain as audit_chain_service

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


@router.get("/admin/diagnostics", response_model=OpsDiagnosticsRead)
async def admin_diagnostics(_: User = Depends(require_admin_section("ops"))) -> OpsDiagnosticsRead:
    return await ops_service.get_diagnostics()


@router.post("/admin/banners", response_model=MaintenanceBannerRead, status_code=status.HTTP_201_CREATED)
async def admin_create_banner(
    payload: MaintenanceBannerCreate,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("ops")),
) -> MaintenanceBannerRead:
    now = datetime.now(timezone.utc)
    if payload.ends_at and payload.ends_at <= payload.starts_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="End time must be after start time")
    if payload.starts_at < now.replace(year=now.year - 5):  # soft sanity check
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Start time is too far in the past")
    banner = MaintenanceBanner(**payload.model_dump())
    created = await ops_service.create_maintenance_banner(session, banner)
    await audit_chain_service.add_admin_audit_log(
        session,
        action="ops.banner.create",
        actor_user_id=admin.id,
        subject_user_id=None,
        data={
            "banner_id": str(created.id),
            "is_active": bool(created.is_active),
            "level": str(created.level),
            "starts_at": created.starts_at.isoformat() if created.starts_at else None,
            "ends_at": created.ends_at.isoformat() if created.ends_at else None,
        },
    )
    await session.commit()
    return MaintenanceBannerRead.model_validate(created)


@router.patch("/admin/banners/{banner_id}", response_model=MaintenanceBannerRead)
async def admin_update_banner(
    banner_id: UUID,
    payload: MaintenanceBannerUpdate,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("ops")),
) -> MaintenanceBannerRead:
    banner = await session.get(MaintenanceBanner, banner_id)
    if not banner:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Banner not found")
    data = payload.model_dump(exclude_unset=True)
    next_starts = data.get("starts_at", getattr(banner, "starts_at", None))
    next_ends = data.get("ends_at", getattr(banner, "ends_at", None))
    if next_ends and next_starts and next_ends <= next_starts:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="End time must be after start time")
    before = {
        key: (value.isoformat() if isinstance(value, datetime) else value)
        for key, value in ((field, getattr(banner, field)) for field in data)
    }
    for key, value in data.items():
        setattr(banner, key, value)
    updated = await ops_service.update_maintenance_banner(session, banner)
    await audit_chain_service.add_admin_audit_log(
        session,
        action="ops.banner.update",
        actor_user_id=admin.id,
        subject_user_id=None,
        data={
            "banner_id": str(updated.id),
            "changed_fields": sorted(list(data.keys())),
            "before": before,
            "after": {
                key: (value.isoformat() if isinstance(value, datetime) else value)
                for key, value in ((field, getattr(updated, field)) for field in data)
            },
        },
    )
    await session.commit()
    return MaintenanceBannerRead.model_validate(updated)


@router.delete("/admin/banners/{banner_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def admin_delete_banner(
    banner_id: UUID,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("ops")),
) -> None:
    banner = await session.get(MaintenanceBanner, banner_id)
    if not banner:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Banner not found")
    deleted_snapshot = {
        "banner_id": str(banner.id),
        "is_active": bool(banner.is_active),
        "level": str(banner.level),
        "starts_at": banner.starts_at.isoformat() if banner.starts_at else None,
        "ends_at": banner.ends_at.isoformat() if banner.ends_at else None,
    }
    await ops_service.delete_maintenance_banner(session, banner)
    await audit_chain_service.add_admin_audit_log(
        session,
        action="ops.banner.delete",
        actor_user_id=admin.id,
        subject_user_id=None,
        data=deleted_snapshot,
    )
    await session.commit()


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


@router.get("/admin/webhooks", response_model=list[WebhookEventRead])
async def admin_list_webhooks(
    limit: int = 50,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("ops")),
) -> list[WebhookEventRead]:
    return await ops_service.list_recent_webhooks(session, limit=limit)


@router.get("/admin/webhooks/stats", response_model=FailureCount)
async def admin_webhook_failure_stats(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("ops")),
    since_hours: int = Query(default=24, ge=1, le=168),
) -> FailureCount:
    failed = await ops_service.count_failed_webhooks(session, since_hours=since_hours)
    return FailureCount(failed=failed, since_hours=int(since_hours))


@router.get("/admin/webhooks/backlog", response_model=WebhookBacklogCount)
async def admin_webhook_backlog_stats(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("ops")),
    since_hours: int = Query(default=24, ge=1, le=168),
) -> WebhookBacklogCount:
    pending = await ops_service.count_webhook_backlog(session, since_hours=since_hours)
    pending_recent = await ops_service.count_recent_webhook_backlog(session, since_hours=since_hours)
    return WebhookBacklogCount(pending=pending, pending_recent=pending_recent, since_hours=int(since_hours))


@router.get("/admin/webhooks/{provider}/{event_id}", response_model=WebhookEventDetail)
async def admin_webhook_detail(
    provider: str,
    event_id: str,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("ops")),
) -> WebhookEventDetail:
    return await ops_service.get_webhook_detail(session, provider=provider, event_id=event_id)


@router.post("/admin/webhooks/{provider}/{event_id}/retry", response_model=WebhookEventRead)
async def admin_retry_webhook(
    provider: str,
    event_id: str,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("ops")),
) -> WebhookEventRead:
    retried = await ops_service.retry_webhook(session, background_tasks, provider=provider, event_id=event_id)
    await audit_chain_service.add_admin_audit_log(
        session,
        action="ops.webhook.retry",
        actor_user_id=admin.id,
        subject_user_id=None,
        data={
            "provider": provider,
            "event_id": event_id,
            "status": retried.status,
            "attempts": retried.attempts,
        },
    )
    await session.commit()
    return retried


@router.get("/admin/email-failures/stats", response_model=FailureCount)
async def admin_email_failure_stats(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("ops")),
    since_hours: int = Query(default=24, ge=1, le=168),
) -> FailureCount:
    failed = await ops_service.count_email_failures(session, since_hours=since_hours)
    return FailureCount(failed=failed, since_hours=int(since_hours))


@router.get("/admin/email-failures", response_model=list[EmailFailureRead])
async def admin_list_email_failures(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("ops")),
    limit: int = Query(default=50, ge=1, le=200),
    since_hours: int = Query(default=24, ge=1, le=168),
    to_email: str | None = Query(default=None, max_length=255),
) -> list[EmailFailureRead]:
    rows = await ops_service.list_email_failures(session, limit=limit, since_hours=since_hours, to_email=to_email)
    return [EmailFailureRead.model_validate(row) for row in rows]


@router.get("/admin/email-events", response_model=list[EmailEventRead])
async def admin_list_email_events(
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("ops")),
    limit: int = Query(default=50, ge=1, le=200),
    since_hours: int = Query(default=24, ge=1, le=168),
    to_email: str | None = Query(default=None, max_length=255),
    status_filter: str | None = Query(default=None, alias="status", max_length=16),
) -> list[EmailEventRead]:
    rows = await ops_service.list_email_events(
        session,
        limit=limit,
        since_hours=since_hours,
        to_email=to_email,
        status=status_filter,
    )
    return [EmailEventRead.model_validate(row) for row in rows]
