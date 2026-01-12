from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.order import Order, OrderItem
from app.models.returns import ReturnRequest, ReturnRequestItem, ReturnRequestStatus
from app.models.user import AdminAuditLog, User
from app.schemas.returns import ReturnRequestCreate, ReturnRequestUpdate
from app.services import order as order_service


ALLOWED_TRANSITIONS: dict[ReturnRequestStatus, set[ReturnRequestStatus]] = {
    ReturnRequestStatus.requested: {ReturnRequestStatus.approved, ReturnRequestStatus.rejected, ReturnRequestStatus.closed},
    ReturnRequestStatus.approved: {ReturnRequestStatus.received, ReturnRequestStatus.closed},
    ReturnRequestStatus.rejected: {ReturnRequestStatus.closed},
    ReturnRequestStatus.received: {ReturnRequestStatus.refunded, ReturnRequestStatus.closed},
    ReturnRequestStatus.refunded: {ReturnRequestStatus.closed},
    ReturnRequestStatus.closed: set(),
}


async def list_return_requests(
    session: AsyncSession,
    *,
    q: str | None = None,
    status_filter: ReturnRequestStatus | None = None,
    order_id: UUID | None = None,
    page: int = 1,
    limit: int = 25,
) -> tuple[list[ReturnRequest], int]:
    query = select(ReturnRequest).join(Order, ReturnRequest.order_id == Order.id)

    filters = []
    if status_filter:
        filters.append(ReturnRequest.status == status_filter)
    if order_id:
        filters.append(ReturnRequest.order_id == order_id)
    if q and q.strip():
        needle = f"%{q.strip()}%"
        filters.append(
            or_(
                cast(ReturnRequest.id, String()).ilike(needle),
                Order.reference_code.ilike(needle),
                Order.customer_email.ilike(needle),
                Order.customer_name.ilike(needle),
            )
        )

    if filters:
        query = query.where(*filters)

    count_stmt = select(func.count()).select_from(ReturnRequest).join(Order, ReturnRequest.order_id == Order.id)
    if filters:
        count_stmt = count_stmt.where(*filters)
    total_items = int((await session.execute(count_stmt)).scalar_one() or 0)

    offset = (page - 1) * limit
    query = query.order_by(ReturnRequest.created_at.desc()).offset(offset).limit(limit)
    rows = (await session.execute(query)).scalars().unique().all()
    return list(rows), total_items


async def get_return_request(session: AsyncSession, return_id: UUID) -> ReturnRequest | None:
    result = await session.execute(
        select(ReturnRequest)
        .options(
            selectinload(ReturnRequest.items)
            .selectinload(ReturnRequestItem.order_item)
            .selectinload(OrderItem.product),
            selectinload(ReturnRequest.order).selectinload(Order.items),
            selectinload(ReturnRequest.user),
        )
        .where(ReturnRequest.id == return_id)
    )
    return result.scalar_one_or_none()


async def create_return_request(
    session: AsyncSession,
    *,
    payload: ReturnRequestCreate,
    actor: User,
) -> ReturnRequest:
    order = await order_service.get_order_by_id_admin(session, payload.order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    order_items_by_id = {item.id: item for item in order.items}
    items: list[ReturnRequestItem] = []
    for item_payload in payload.items:
        order_item = order_items_by_id.get(item_payload.order_item_id)
        if not order_item:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid order item")
        if item_payload.quantity <= 0 or item_payload.quantity > int(order_item.quantity):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid quantity")
        items.append(
            ReturnRequestItem(
                order_item_id=order_item.id,
                quantity=item_payload.quantity,
            )
        )

    now = datetime.now(timezone.utc)
    record = ReturnRequest(
        order_id=order.id,
        user_id=order.user_id,
        status=ReturnRequestStatus.requested,
        reason=payload.reason.strip(),
        customer_message=(payload.customer_message.strip() if payload.customer_message else None),
        created_by=actor.id,
        updated_by=actor.id,
        created_at=now,
        updated_at=now,
        items=items,
    )
    session.add(record)
    await session.flush()
    session.add(
        AdminAuditLog(
            action="return_request_create",
            actor_user_id=actor.id,
            subject_user_id=order.user_id,
            data={"return_request_id": str(record.id), "order_id": str(order.id)},
        )
    )
    await session.commit()
    return await get_return_request(session, record.id) or record


async def update_return_request(
    session: AsyncSession,
    *,
    record: ReturnRequest,
    payload: ReturnRequestUpdate,
    actor: User,
) -> ReturnRequest:
    data = payload.model_dump(exclude_unset=True)

    previous_status = ReturnRequestStatus(record.status)

    if "status" in data and data["status"] is not None:
        next_status = ReturnRequestStatus(data["status"])
        if next_status == previous_status:
            data.pop("status")
        else:
            allowed = ALLOWED_TRANSITIONS.get(previous_status, set())
            if next_status not in allowed:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status transition")
            record.status = next_status
            if next_status == ReturnRequestStatus.closed:
                record.closed_at = datetime.now(timezone.utc)
            data.pop("status")

    if "admin_note" in data:
        record.admin_note = data["admin_note"].strip() if data["admin_note"] else None

    record.updated_by = actor.id
    record.updated_at = datetime.now(timezone.utc)
    session.add(record)
    session.add(
        AdminAuditLog(
            action="return_request_update",
            actor_user_id=actor.id,
            subject_user_id=record.user_id,
            data={
                "return_request_id": str(record.id),
                "order_id": str(record.order_id),
                "from_status": previous_status.value,
                "to_status": ReturnRequestStatus(record.status).value,
            },
        )
    )
    await session.commit()
    return await get_return_request(session, record.id) or record
