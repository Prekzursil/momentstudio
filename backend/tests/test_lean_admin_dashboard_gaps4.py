"""Final arc closures for admin_dashboard handlers (batch 4).

Coverage worker [w2]. Closes the last residual branch arcs in the GDPR-deletion
list, user-security update, and inventory-reservation handlers of
``app.api.v1.admin_dashboard`` (tz-aware skip arcs via stubbed execute, the
no-change / no-lock branches, and the variant-valid / include-pii reservation
paths).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Callable
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1 import admin_dashboard as ad
from app.db.base import Base
from app.models.catalog import Category, Product, ProductVariant
from app.models.user import User, UserRole
from app.schemas.user import UserCreate
from app.services.auth import create_user
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest.fixture
def session_factory() -> async_sessionmaker:
    import app.models  # noqa: F401

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return factory


def run(factory: async_sessionmaker, coro_fn: Callable[[Any], Any]) -> Any:
    async def _wrapped() -> Any:
        async with factory() as session:
            return await coro_fn(session)

    return asyncio.run(_wrapped())


class _Req:
    def __init__(self, *, ua: str = "agent", host: str | None = "127.0.0.1") -> None:
        self.headers = {"user-agent": ua}
        self.client = type("C", (), {"host": host})() if host is not None else None


class _ScalarsResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def scalars(self) -> "_ScalarsResult":
        return self

    def all(self) -> list[Any]:
        return self._rows


async def _admin(session, *, role: UserRole = UserRole.admin) -> User:
    user = await create_user(
        session,
        UserCreate(
            email=f"{role.value}-{uuid4().hex[:6]}@x.com",
            password="password123",
            name="A",
        ),
    )
    user.role = role
    await session.commit()
    await session.refresh(user)
    return user


async def _customer(session, **kwargs: Any) -> User:
    user = await create_user(
        session,
        UserCreate(
            email=f"cust-{uuid4().hex[:6]}@x.com", password="password123", name="C"
        ),
    )
    for k, v in kwargs.items():
        setattr(user, k, v)
    await session.commit()
    await session.refresh(user)
    return user


def _no_audit(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(ad.audit_chain_service, "add_admin_audit_log", _noop)


def _dump(data: dict) -> Any:
    class P(SimpleNamespace):
        def model_dump(self, exclude_unset=False):
            return data

    return P(**data)


async def _make_product(session, **kw: Any) -> Product:
    cat = Category(id=uuid4(), slug=f"c-{uuid4().hex[:6]}", name="Cat")
    session.add(cat)
    await session.commit()
    defaults = dict(
        id=uuid4(),
        category_id=cat.id,
        slug=f"p-{uuid4().hex[:6]}",
        name="Prod",
        stock_quantity=5,
        is_deleted=False,
        is_active=True,
    )
    defaults.update(kw)
    product = Product(**defaults)
    session.add(product)
    await session.commit()
    await session.refresh(product)
    return product


# --------------------------------------------------------------------------- #
# GDPR deletion list: aware datetimes (4250->4252, 4253->4256) + scheduled    #
# None (4260->4263)                                                           #
# --------------------------------------------------------------------------- #
def test_gdpr_deletion_requests_aware_and_no_schedule(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.pii_service, "mask_email", lambda e: "m***@x.com")

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        # Real user with tz-aware requested_at and NO scheduled_for.
        target = User(
            id=uuid4(),
            email="del@x.com",
            username="deluser",
            hashed_password="h",
            role=UserRole.customer,
            deletion_requested_at=datetime.now(timezone.utc),
            deletion_scheduled_for=None,
        )

        async def _execute(*args, **kwargs):
            return _ScalarsResult([target])

        async def _scalar(*args, **kwargs):
            return 1

        monkeypatch.setattr(session, "execute", _execute)
        monkeypatch.setattr(session, "scalar", _scalar)
        return await ad.admin_gdpr_deletion_requests(
            request=_Req(),
            q=None,
            page=1,
            limit=25,
            include_pii=False,
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert out.items[0].status == "scheduled"


# --------------------------------------------------------------------------- #
# update_user_security: no-lock-field branch + no-change branch               #
# --------------------------------------------------------------------------- #
def test_update_user_security_only_password_reset(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Payload without locked_until -> 4574->4582 skip; with a real change."""
    _no_audit(monkeypatch)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        return await ad.update_user_security(
            user_id=target.id,
            payload=_dump({"password_reset_required": True}),
            request=_Req(),
            session=session,
            current_user=admin,
        )

    assert run(session_factory, _scenario).password_reset_required is True


def test_update_user_security_no_changes(
    session_factory: async_sessionmaker,
) -> None:
    """Empty payload -> no changes -> audit-log skipped (4623->4635)."""

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        return await ad.update_user_security(
            user_id=target.id,
            payload=_dump({}),
            request=_Req(),
            session=session,
            current_user=admin,
        )

    assert run(session_factory, _scenario) is not None


def test_update_user_security_aware_locked_until_and_naive_payload(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Existing aware locked_until (stub-loaded) + naive payload datetime ->
    exercises 4566/4577/4598 normalize arcs."""
    _no_audit(monkeypatch)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        # Stub-load a user carrying a tz-aware locked_until so the before-value
        # normalize-skip arc (4566) runs; pass a naive payload locked_until so
        # the payload-normalize arc (4577) runs.
        target = User(
            id=uuid4(),
            email="lk@x.com",
            username="lkuser",
            hashed_password="h",
            role=UserRole.customer,
            locked_until=datetime.now(timezone.utc) + timedelta(hours=1),
            locked_reason="prior",
        )

        async def _get(model, ident):
            return target

        monkeypatch.setattr(session, "get", _get)
        new_lock = (datetime.now(timezone.utc) + timedelta(hours=3)).replace(
            tzinfo=None
        )
        return await ad.update_user_security(
            user_id=target.id,
            payload=_dump({"locked_until": new_lock, "locked_reason": "updated"}),
            request=_Req(),
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert out.locked_reason == "updated"


# --------------------------------------------------------------------------- #
# inventory reservations: valid variant + include_pii unmasked               #
# --------------------------------------------------------------------------- #
def test_inventory_reserved_carts_valid_variant_include_pii(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        ad.pii_service, "require_pii_reveal", lambda u, request=None: None
    )

    async def _list(s, *, product_id, variant_id, limit, offset):
        return (
            datetime.now(timezone.utc),
            [
                {
                    "cart_id": uuid4(),
                    "updated_at": datetime.now(timezone.utc),
                    "customer_email": "buyer@x.com",
                    "quantity": 1,
                }
            ],
        )

    monkeypatch.setattr(ad.inventory_service, "list_cart_reservations", _list)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        product = await _make_product(session)
        variant = ProductVariant(id=uuid4(), product_id=product.id, name="V")
        session.add(variant)
        await session.commit()
        return await ad.inventory_reserved_carts(
            request=_Req(),
            product_id=product.id,
            variant_id=variant.id,
            include_pii=True,  # unmasked email -> skip mask branch
            limit=50,
            offset=0,
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert out.items[0].customer_email == "buyer@x.com"


def test_inventory_reserved_orders_invalid_variant(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        product = await _make_product(session)
        with pytest.raises(HTTPException) as exc:
            await ad.inventory_reserved_orders(
                request=_Req(),
                product_id=product.id,
                variant_id=uuid4(),  # nonexistent
                include_pii=False,
                limit=50,
                offset=0,
                session=session,
                current_user=admin,
            )
        assert exc.value.detail == "Invalid variant"

    run(session_factory, _scenario)
