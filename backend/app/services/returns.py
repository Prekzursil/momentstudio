from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.order import Order, OrderItem, OrderStatus
from app.models.returns import ReturnRequest, ReturnRequestItem, ReturnRequestStatus
from app.models.user import User
from app.schemas.returns import ReturnRequestCreate, ReturnRequestUpdate
from app.services import order as order_service
from app.services import audit_chain as audit_chain_service


ALLOWED_TRANSITIONS: dict[ReturnRequestStatus, set[ReturnRequestStatus]] = {
    ReturnRequestStatus.requested: {ReturnRequestStatus.approved, ReturnRequestStatus.rejected, ReturnRequestStatus.closed},
    ReturnRequestStatus.approved: {ReturnRequestStatus.received, ReturnRequestStatus.closed},
    ReturnRequestStatus.rejected: {ReturnRequestStatus.closed},
    ReturnRequestStatus.received: {ReturnRequestStatus.refunded, ReturnRequestStatus.closed},
    ReturnRequestStatus.refunded: {ReturnRequestStatus.closed},
    ReturnRequestStatus.closed: set(),
}


def _aggregate_requested_quantities(payload: ReturnRequestCreate) -> dict[UUID, int]:
    requested_quantities: dict[UUID, int] = {}
    for item_payload in payload.items:
        quantity = int(item_payload.quantity)
        if quantity <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid quantity")
        requested_quantities[item_payload.order_item_id] = requested_quantities.get(item_payload.order_item_id, 0) + quantity
    return requested_quantities


def _build_return_items(order: Order, payload: ReturnRequestCreate) -> list[ReturnRequestItem]:
    order_items_by_id = {item.id: item for item in order.items}
    items: list[ReturnRequestItem] = []
    for order_item_id, quantity in _aggregate_requested_quantities(payload).items():
        order_item = order_items_by_id.get(order_item_id)
        if not order_item:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid order item")
        if quantity > int(order_item.quantity):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid quantity")
        items.append(ReturnRequestItem(order_item_id=order_item.id, quantity=quantity))
    return items


def _normalized_optional_text(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.strip()
    return normalized or None


def _new_return_request(
    *,
    order: Order,
    user_id: UUID | None,
    actor_id: UUID,
    payload: ReturnRequestCreate,
    items: list[ReturnRequestItem],
) -> ReturnRequest:
    now = datetime.now(timezone.utc)
    return ReturnRequest(
        order_id=order.id,
        user_id=user_id,
        status=ReturnRequestStatus.requested,
        reason=payload.reason.strip(),
        customer_message=_normalized_optional_text(payload.customer_message),
        created_by=actor_id,
        updated_by=actor_id,
        created_at=now,
        updated_at=now,
        items=items,
    )


def _coerce_transition_status(raw_status: object) -> ReturnRequestStatus | None:
    if raw_status is None:
        return None
    return ReturnRequestStatus(raw_status)


def _apply_status_transition(record: ReturnRequest, *, data: dict[str, object], previous_status: ReturnRequestStatus) -> None:
    next_status = _coerce_transition_status(data.get("status"))
    if next_status is None:
        return
    if next_status == previous_status:
        data.pop("status", None)
        return
    allowed = ALLOWED_TRANSITIONS.get(previous_status, set())
    if next_status not in allowed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status transition")
    record.status = next_status
    if next_status == ReturnRequestStatus.closed:
        record.closed_at = datetime.now(timezone.utc)
    data.pop("status", None)


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
    record = _new_return_request(
        order=order,
        user_id=order.user_id,
        actor_id=actor.id,
        payload=payload,
        items=_build_return_items(order, payload),
    )
    session.add(record)
    await session.flush()
    await audit_chain_service.add_admin_audit_log(
        session,
        action="return_request_create",
        actor_user_id=actor.id,
        subject_user_id=order.user_id,
        data={"return_request_id": str(record.id), "order_id": str(order.id)},
    )
    await session.commit()
    return await get_return_request(session, record.id) or record


async def create_return_request_for_user(
    session: AsyncSession,
    *,
    payload: ReturnRequestCreate,
    user: User,
) -> ReturnRequest:
    order = await order_service.get_order(session, user.id, payload.order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if OrderStatus(order.status) != OrderStatus.delivered:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Return request not eligible")

    existing = int(
        (
            await session.execute(
                select(func.count())
                .select_from(ReturnRequest)
                .where(
                    ReturnRequest.order_id == order.id,
                    ReturnRequest.user_id == user.id,
                    ReturnRequest.status != ReturnRequestStatus.closed,
                )
            )
        ).scalar_one()
        or 0
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Return request already exists")
    record = _new_return_request(
        order=order,
        user_id=user.id,
        actor_id=user.id,
        payload=payload,
        items=_build_return_items(order, payload),
    )
    session.add(record)
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
    _apply_status_transition(record, data=data, previous_status=previous_status)

    if "admin_note" in data:
        record.admin_note = _normalized_optional_text(data["admin_note"] if isinstance(data["admin_note"], str) else None)

    record.updated_by = actor.id
    record.updated_at = datetime.now(timezone.utc)
    session.add(record)
    await audit_chain_service.add_admin_audit_log(
        session,
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
    await session.commit()
    return await get_return_request(session, record.id) or record
