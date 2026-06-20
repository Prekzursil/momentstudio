"""Lean-gate unit coverage for ``app.services.returns`` (service layer).

Disjoint from ``test_returns_api.py`` (which drives the HTTP surface); this
file exercises the service functions directly, including the defensive guards
and admin/user create + transition paths.
"""

from __future__ import annotations

import asyncio
import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import security
from app.models.order import Order, OrderItem, OrderStatus
from app.models.returns import ReturnRequest, ReturnRequestItem, ReturnRequestStatus
from app.models.user import User
from app.schemas.returns import (
    ReturnRequestCreate,
    ReturnRequestItemCreate,
    ReturnRequestUpdate,
)
from app.services import returns as svc


def _memory_session_factory() -> async_sessionmaker:
    import app.models  # noqa: F401
    from app.db.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return factory


@pytest.fixture
def session_factory():
    return _memory_session_factory()


@pytest.fixture(autouse=True)
def _stub_audit(monkeypatch):
    async def _noop(*a, **k):  # noqa: ANN002, ANN003
        return None

    monkeypatch.setattr(svc.audit_chain_service, "add_admin_audit_log", _noop)


async def _seed_order(session, *, status=OrderStatus.delivered):  # noqa: ANN001
    from app.models.catalog import Category, Product, ProductStatus

    user = User(
        email="ret@example.com",
        username="ret",
        hashed_password=security.hash_password("Password123"),
    )
    session.add(user)
    await session.flush()
    category = Category(slug="c", name="C", sort_order=1)
    session.add(category)
    await session.flush()
    product = Product(
        slug="p",
        name="P",
        base_price=10,
        currency="RON",
        category_id=category.id,
        stock_quantity=5,
        status=ProductStatus.published,
    )
    session.add(product)
    await session.flush()
    order = Order(
        user_id=user.id,
        status=status,
        customer_email="ret@example.com",
        customer_name="Ret",
        total_amount=Decimal("20.00"),
        reference_code="RREF-1",
    )
    session.add(order)
    await session.flush()
    item = OrderItem(
        order_id=order.id,
        product_id=product.id,
        quantity=2,
        unit_price=Decimal("10.00"),
        subtotal=Decimal("20.00"),
    )
    session.add(item)
    await session.commit()
    await session.refresh(order)
    await session.refresh(user)
    await session.refresh(item)
    return user, order, item


# --------------------------------------------------------------------------- #
# create_return_request (admin)                                               #
# --------------------------------------------------------------------------- #
@pytest.mark.anyio
async def test_create_admin_order_not_found(session_factory, monkeypatch) -> None:
    async def fake_get(session, order_id):  # noqa: ANN001
        return None

    monkeypatch.setattr(svc.order_service, "get_order_by_id_admin", fake_get)
    async with session_factory() as session:
        user, _order, _item = await _seed_order(session)
        payload = ReturnRequestCreate(
            order_id=uuid.uuid4(),
            reason="broken",
            items=[ReturnRequestItemCreate(order_item_id=uuid.uuid4(), quantity=1)],
        )
        with pytest.raises(HTTPException) as exc:
            await svc.create_return_request(session, payload=payload, actor=user)
        assert exc.value.status_code == 404


@pytest.mark.anyio
async def test_create_admin_success(session_factory, monkeypatch) -> None:
    async with session_factory() as session:
        user, order, item = await _seed_order(session)

        async def fake_get(session, order_id):  # noqa: ANN001
            return order

        monkeypatch.setattr(svc.order_service, "get_order_by_id_admin", fake_get)
        payload = ReturnRequestCreate(
            order_id=order.id,
            reason="broken",
            customer_message="please",
            items=[ReturnRequestItemCreate(order_item_id=item.id, quantity=2)],
        )
        record = await svc.create_return_request(session, payload=payload, actor=user)
        assert record.status == ReturnRequestStatus.requested
        assert len(record.items) == 1


@pytest.mark.anyio
async def test_create_admin_defensive_zero_quantity(
    session_factory, monkeypatch
) -> None:
    async with session_factory() as session:
        user, order, item = await _seed_order(session)
        monkeypatch.setattr(
            svc.order_service, "get_order_by_id_admin", lambda s, o: _async(order)
        )
        # Bypass schema validation to hit the defensive quantity<=0 guard.
        bad_item = ReturnRequestItemCreate.model_construct(
            order_item_id=item.id, quantity=0
        )
        payload = ReturnRequestCreate.model_construct(
            order_id=order.id, reason="x", customer_message=None, items=[bad_item]
        )
        with pytest.raises(HTTPException) as exc:
            await svc.create_return_request(session, payload=payload, actor=user)
        assert exc.value.detail == "Invalid quantity"


@pytest.mark.anyio
async def test_create_admin_invalid_order_item(session_factory, monkeypatch) -> None:
    async with session_factory() as session:
        user, order, item = await _seed_order(session)
        monkeypatch.setattr(
            svc.order_service, "get_order_by_id_admin", lambda s, o: _async(order)
        )
        payload = ReturnRequestCreate(
            order_id=order.id,
            reason="x",
            items=[ReturnRequestItemCreate(order_item_id=uuid.uuid4(), quantity=1)],
        )
        with pytest.raises(HTTPException) as exc:
            await svc.create_return_request(session, payload=payload, actor=user)
        assert exc.value.detail == "Invalid order item"


@pytest.mark.anyio
async def test_create_admin_quantity_exceeds(session_factory, monkeypatch) -> None:
    async with session_factory() as session:
        user, order, item = await _seed_order(session)
        monkeypatch.setattr(
            svc.order_service, "get_order_by_id_admin", lambda s, o: _async(order)
        )
        payload = ReturnRequestCreate(
            order_id=order.id,
            reason="x",
            items=[ReturnRequestItemCreate(order_item_id=item.id, quantity=99)],
        )
        with pytest.raises(HTTPException) as exc:
            await svc.create_return_request(session, payload=payload, actor=user)
        assert exc.value.detail == "Invalid quantity"


# --------------------------------------------------------------------------- #
# create_return_request_for_user                                              #
# --------------------------------------------------------------------------- #
@pytest.mark.anyio
async def test_create_user_order_not_found(session_factory, monkeypatch) -> None:
    monkeypatch.setattr(svc.order_service, "get_order", lambda s, u, o: _async(None))
    async with session_factory() as session:
        user, _order, _item = await _seed_order(session)
        payload = ReturnRequestCreate(
            order_id=uuid.uuid4(),
            reason="x",
            items=[ReturnRequestItemCreate(order_item_id=uuid.uuid4(), quantity=1)],
        )
        with pytest.raises(HTTPException) as exc:
            await svc.create_return_request_for_user(
                session, payload=payload, user=user
            )
        assert exc.value.status_code == 404


@pytest.mark.anyio
async def test_create_user_not_delivered(session_factory, monkeypatch) -> None:
    async with session_factory() as session:
        user, order, item = await _seed_order(session, status=OrderStatus.paid)
        monkeypatch.setattr(
            svc.order_service, "get_order", lambda s, u, o: _async(order)
        )
        payload = ReturnRequestCreate(
            order_id=order.id,
            reason="x",
            items=[ReturnRequestItemCreate(order_item_id=item.id, quantity=1)],
        )
        with pytest.raises(HTTPException) as exc:
            await svc.create_return_request_for_user(
                session, payload=payload, user=user
            )
        assert exc.value.detail == "Return request not eligible"


@pytest.mark.anyio
async def test_create_user_success(session_factory, monkeypatch) -> None:
    async with session_factory() as session:
        user, order, item = await _seed_order(session)
        monkeypatch.setattr(
            svc.order_service, "get_order", lambda s, u, o: _async(order)
        )
        payload = ReturnRequestCreate(
            order_id=order.id,
            reason="x",
            items=[ReturnRequestItemCreate(order_item_id=item.id, quantity=1)],
        )
        record = await svc.create_return_request_for_user(
            session, payload=payload, user=user
        )
        assert record.status == ReturnRequestStatus.requested


@pytest.mark.anyio
async def test_create_user_duplicate_conflict(session_factory, monkeypatch) -> None:
    async with session_factory() as session:
        user, order, item = await _seed_order(session)
        monkeypatch.setattr(
            svc.order_service, "get_order", lambda s, u, o: _async(order)
        )
        payload = ReturnRequestCreate(
            order_id=order.id,
            reason="x",
            items=[ReturnRequestItemCreate(order_item_id=item.id, quantity=1)],
        )
        await svc.create_return_request_for_user(session, payload=payload, user=user)
        with pytest.raises(HTTPException) as exc:
            await svc.create_return_request_for_user(
                session, payload=payload, user=user
            )
        assert exc.value.status_code == 409


@pytest.mark.anyio
async def test_create_user_defensive_and_invalid_item(
    session_factory, monkeypatch
) -> None:
    async with session_factory() as session:
        user, order, item = await _seed_order(session)
        monkeypatch.setattr(
            svc.order_service, "get_order", lambda s, u, o: _async(order)
        )
        bad = ReturnRequestCreate.model_construct(
            order_id=order.id,
            reason="x",
            customer_message=None,
            items=[
                ReturnRequestItemCreate.model_construct(
                    order_item_id=item.id, quantity=0
                )
            ],
        )
        with pytest.raises(HTTPException) as exc:
            await svc.create_return_request_for_user(session, payload=bad, user=user)
        assert exc.value.detail == "Invalid quantity"

        unknown = ReturnRequestCreate(
            order_id=order.id,
            reason="x",
            items=[ReturnRequestItemCreate(order_item_id=uuid.uuid4(), quantity=1)],
        )
        with pytest.raises(HTTPException) as exc2:
            await svc.create_return_request_for_user(
                session, payload=unknown, user=user
            )
        assert exc2.value.detail == "Invalid order item"

        over = ReturnRequestCreate(
            order_id=order.id,
            reason="x",
            items=[ReturnRequestItemCreate(order_item_id=item.id, quantity=99)],
        )
        with pytest.raises(HTTPException) as exc3:
            await svc.create_return_request_for_user(session, payload=over, user=user)
        assert exc3.value.detail == "Invalid quantity"


# --------------------------------------------------------------------------- #
# list / get                                                                   #
# --------------------------------------------------------------------------- #
@pytest.mark.anyio
async def test_list_and_get(session_factory, monkeypatch) -> None:
    async with session_factory() as session:
        user, order, item = await _seed_order(session)
        monkeypatch.setattr(
            svc.order_service, "get_order_by_id_admin", lambda s, o: _async(order)
        )
        payload = ReturnRequestCreate(
            order_id=order.id,
            reason="x",
            items=[ReturnRequestItemCreate(order_item_id=item.id, quantity=1)],
        )
        rec = await svc.create_return_request(session, payload=payload, actor=user)

        rows, total = await svc.list_return_requests(session)
        assert total == 1 and len(rows) == 1

        rows_f, total_f = await svc.list_return_requests(
            session,
            q="RREF",
            status_filter=ReturnRequestStatus.requested,
            order_id=order.id,
        )
        assert total_f == 1

        rows_none, total_none = await svc.list_return_requests(
            session, q="   ", status_filter=None
        )
        assert total_none == 1

        got = await svc.get_return_request(session, rec.id)
        assert got is not None
        assert await svc.get_return_request(session, uuid.uuid4()) is None


# --------------------------------------------------------------------------- #
# update_return_request                                                        #
# --------------------------------------------------------------------------- #
async def _make_record(session, user, order, item):  # noqa: ANN001
    record = ReturnRequest(
        order_id=order.id,
        user_id=user.id,
        status=ReturnRequestStatus.requested,
        reason="x",
        created_by=user.id,
        updated_by=user.id,
        items=[ReturnRequestItem(order_item_id=item.id, quantity=1)],
    )
    session.add(record)
    await session.commit()
    await session.refresh(record)
    return record


@pytest.mark.anyio
async def test_update_valid_transition_to_closed(session_factory) -> None:
    async with session_factory() as session:
        user, order, item = await _seed_order(session)
        record = await _make_record(session, user, order, item)
        updated = await svc.update_return_request(
            session,
            record=record,
            payload=ReturnRequestUpdate(status=ReturnRequestStatus.closed),
            actor=user,
        )
        assert updated.status == ReturnRequestStatus.closed
        assert updated.closed_at is not None


@pytest.mark.anyio
async def test_update_valid_transition_non_closed(session_factory) -> None:
    # requested -> approved is valid and NOT closed (268->270 false branch).
    async with session_factory() as session:
        user, order, item = await _seed_order(session)
        record = await _make_record(session, user, order, item)
        updated = await svc.update_return_request(
            session,
            record=record,
            payload=ReturnRequestUpdate(status=ReturnRequestStatus.approved),
            actor=user,
        )
        assert updated.status == ReturnRequestStatus.approved
        assert updated.closed_at is None


@pytest.mark.anyio
async def test_update_same_status_noop(session_factory) -> None:
    async with session_factory() as session:
        user, order, item = await _seed_order(session)
        record = await _make_record(session, user, order, item)
        updated = await svc.update_return_request(
            session,
            record=record,
            payload=ReturnRequestUpdate(status=ReturnRequestStatus.requested),
            actor=user,
        )
        assert updated.status == ReturnRequestStatus.requested


@pytest.mark.anyio
async def test_update_invalid_transition(session_factory) -> None:
    async with session_factory() as session:
        user, order, item = await _seed_order(session)
        record = await _make_record(session, user, order, item)
        with pytest.raises(HTTPException) as exc:
            await svc.update_return_request(
                session,
                record=record,
                payload=ReturnRequestUpdate(status=ReturnRequestStatus.refunded),
                actor=user,
            )
        assert exc.value.detail == "Invalid status transition"


@pytest.mark.anyio
async def test_update_admin_note_only(session_factory) -> None:
    async with session_factory() as session:
        user, order, item = await _seed_order(session)
        record = await _make_record(session, user, order, item)
        updated = await svc.update_return_request(
            session,
            record=record,
            payload=ReturnRequestUpdate(admin_note="  note  "),
            actor=user,
        )
        assert updated.admin_note == "note"


@pytest.mark.anyio
async def test_update_admin_note_cleared(session_factory) -> None:
    async with session_factory() as session:
        user, order, item = await _seed_order(session)
        record = await _make_record(session, user, order, item)
        updated = await svc.update_return_request(
            session,
            record=record,
            payload=ReturnRequestUpdate(admin_note=""),
            actor=user,
        )
        assert updated.admin_note is None


def _async(value):
    async def _coro():
        return value

    return _coro()
