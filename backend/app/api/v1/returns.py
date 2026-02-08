from __future__ import annotations

import mimetypes
from datetime import datetime, timezone
from functools import partial
from pathlib import Path
from uuid import UUID

import anyio
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_admin_section, require_verified_email
from app.db.session import get_session
from app.models.returns import ReturnRequestStatus
from app.models.user import User
from app.schemas.admin_common import AdminPaginationMeta
from app.schemas.returns import (
    ReturnRequestCreate,
    ReturnRequestListItem,
    ReturnRequestListResponse,
    ReturnRequestRead,
    ReturnRequestUpdate,
)
from app.services import email as email_service
from app.services import private_storage
from app.services import returns as returns_service
from app.services import pii as pii_service
from app.services import step_up as step_up_service

router = APIRouter(prefix="/returns", tags=["returns"])


def _serialize_return_request(record: object, *, include_pii: bool) -> ReturnRequestRead:
    payload = ReturnRequestRead.model_validate(record).model_dump()
    payload["order_reference"] = getattr(getattr(record, "order", None), "reference_code", None)
    customer_email = getattr(getattr(record, "order", None), "customer_email", None)
    customer_name = getattr(getattr(record, "order", None), "customer_name", None)
    if not include_pii:
        customer_email = pii_service.mask_email(customer_email)
        customer_name = pii_service.mask_text(customer_name, keep=1)
    payload["customer_email"] = customer_email
    payload["customer_name"] = customer_name
    payload["return_label_filename"] = getattr(record, "return_label_filename", None)
    payload["return_label_uploaded_at"] = getattr(record, "return_label_uploaded_at", None)
    payload["has_return_label"] = bool(getattr(record, "return_label_path", None))
    payload["items"] = [
        {
            "id": item.id,
            "order_item_id": item.order_item_id,
            "quantity": item.quantity,
            "product_id": getattr(getattr(item.order_item, "product", None), "id", None) if getattr(item, "order_item", None) else None,
            "product_name": getattr(getattr(item.order_item, "product", None), "name", None) if getattr(item, "order_item", None) else None,
        }
        for item in getattr(record, "items", []) or []
    ]
    return ReturnRequestRead(**payload)


def _sanitize_filename(value: str | None) -> str:
    name = Path(value or "").name.strip()
    if not name:
        return "return-label"
    return name[:255]


@router.post("", response_model=ReturnRequestRead, status_code=status.HTTP_201_CREATED)
async def create_my_return_request(
    payload: ReturnRequestCreate,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_verified_email),
) -> ReturnRequestRead:
    created = await returns_service.create_return_request_for_user(session, payload=payload, user=current_user)

    to_email = getattr(created.order, "customer_email", None)
    if to_email:
        lang = created.user.preferred_language if getattr(created, "user", None) else None
        background_tasks.add_task(email_service.send_return_request_created, to_email, created, lang=lang)

    return _serialize_return_request(created, include_pii=True)


@router.get("/admin", response_model=ReturnRequestListResponse)
async def admin_list_returns(
    request: Request,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("returns")),
    q: str | None = Query(default=None),
    status_filter: ReturnRequestStatus | None = Query(default=None),
    order_id: UUID | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=25, ge=1, le=100),
    include_pii: bool = Query(default=False),
) -> ReturnRequestListResponse:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
    rows, total_items = await returns_service.list_return_requests(
        session,
        q=q,
        status_filter=status_filter,
        order_id=order_id,
        page=page,
        limit=limit,
    )
    total_pages = max(1, (total_items + limit - 1) // limit) if total_items else 1
    return ReturnRequestListResponse(
        items=[
            ReturnRequestListItem(
                id=r.id,
                order_id=r.order_id,
                order_reference=getattr(r.order, "reference_code", None),
                customer_email=(
                    getattr(r.order, "customer_email", None)
                    if include_pii
                    else pii_service.mask_email(getattr(r.order, "customer_email", None))
                ),
                customer_name=(
                    getattr(r.order, "customer_name", None)
                    if include_pii
                    else pii_service.mask_text(getattr(r.order, "customer_name", None), keep=1)
                ),
                status=r.status,
                created_at=r.created_at,
            )
            for r in rows
        ],
        meta=AdminPaginationMeta(total_items=total_items, total_pages=total_pages, page=page, limit=limit),
    )


@router.get("/admin/{return_id}", response_model=ReturnRequestRead)
async def admin_get_return(
    return_id: UUID,
    request: Request,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("returns")),
) -> ReturnRequestRead:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
    record = await returns_service.get_return_request(session, return_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Return request not found")
    return _serialize_return_request(record, include_pii=include_pii)


@router.get("/admin/by-order/{order_id}", response_model=list[ReturnRequestRead])
async def admin_list_returns_for_order(
    order_id: UUID,
    request: Request,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("returns")),
) -> list[ReturnRequestRead]:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
    rows, _ = await returns_service.list_return_requests(session, order_id=order_id, page=1, limit=100)
    out: list[ReturnRequestRead] = []
    for r in rows:
        detail = await returns_service.get_return_request(session, r.id)
        if not detail:
            continue
        out.append(_serialize_return_request(detail, include_pii=include_pii))
    return out


@router.post("/admin", response_model=ReturnRequestRead, status_code=status.HTTP_201_CREATED)
async def admin_create_return(
    payload: ReturnRequestCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("returns")),
) -> ReturnRequestRead:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
    created = await returns_service.create_return_request(session, payload=payload, actor=admin)

    to_email = getattr(created.order, "customer_email", None)
    if to_email:
        lang = created.user.preferred_language if getattr(created, "user", None) else None
        background_tasks.add_task(email_service.send_return_request_created, to_email, created, lang=lang)

    return await admin_get_return(created.id, request=request, session=session, admin=admin, include_pii=include_pii)


@router.patch("/admin/{return_id}", response_model=ReturnRequestRead)
async def admin_update_return(
    return_id: UUID,
    payload: ReturnRequestUpdate,
    background_tasks: BackgroundTasks,
    request: Request,
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("returns")),
) -> ReturnRequestRead:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
    record = await returns_service.get_return_request(session, return_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Return request not found")

    prev_status = ReturnRequestStatus(record.status)
    updated = await returns_service.update_return_request(session, record=record, payload=payload, actor=admin)

    next_status = ReturnRequestStatus(updated.status)
    to_email = getattr(updated.order, "customer_email", None)
    if to_email and next_status != prev_status:
        lang = updated.user.preferred_language if getattr(updated, "user", None) else None
        background_tasks.add_task(
            email_service.send_return_request_status_update,
            to_email,
            updated,
            previous_status=prev_status,
            lang=lang,
        )

    return await admin_get_return(updated.id, request=request, session=session, admin=admin, include_pii=include_pii)


@router.post("/admin/{return_id}/label", response_model=ReturnRequestRead)
async def admin_upload_return_label(
    return_id: UUID,
    request: Request,
    file: UploadFile = File(...),
    include_pii: bool = Query(default=False),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("returns")),
) -> ReturnRequestRead:
    if include_pii:
        pii_service.require_pii_reveal(admin, request=request)
    record = await returns_service.get_return_request(session, return_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Return request not found")

    old_path = getattr(record, "return_label_path", None)
    rel_path, original_name = await anyio.to_thread.run_sync(
        partial(
            private_storage.save_private_upload,
            file,
            subdir=f"return-labels/{return_id}",
            allowed_content_types=("application/pdf", "image/png", "image/jpeg", "image/webp"),
            max_bytes=None,
        )
    )
    now = datetime.now(timezone.utc)
    record.return_label_path = rel_path
    record.return_label_filename = _sanitize_filename(original_name)
    record.return_label_uploaded_at = now
    session.add(record)
    await session.commit()

    if old_path and old_path != rel_path:
        private_storage.delete_private_file(old_path)

    refreshed = await returns_service.get_return_request(session, return_id)
    if not refreshed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Return request not found")
    return _serialize_return_request(refreshed, include_pii=include_pii)


@router.get("/admin/{return_id}/label")
async def admin_download_return_label(
    return_id: UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin_section("returns")),
) -> FileResponse:
    step_up_service.require_step_up(request, admin)
    record = await returns_service.get_return_request(session, return_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Return request not found")
    rel = getattr(record, "return_label_path", None)
    if not rel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Return label not found")
    path = private_storage.resolve_private_path(rel)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Return label not found")

    filename = _sanitize_filename(getattr(record, "return_label_filename", None) or path.name)
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    headers = {"Cache-Control": "no-store"}
    return FileResponse(path, media_type=media_type, filename=filename, headers=headers)


@router.delete("/admin/{return_id}/label", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def admin_delete_return_label(
    return_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(require_admin_section("returns")),
) -> None:
    record = await returns_service.get_return_request(session, return_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Return request not found")
    rel = getattr(record, "return_label_path", None)
    if not rel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Return label not found")
    record.return_label_path = None
    record.return_label_filename = None
    record.return_label_uploaded_at = None
    session.add(record)
    await session.commit()
    private_storage.delete_private_file(rel)
