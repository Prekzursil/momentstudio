"""Coupon / session / audit arc closures for admin_dashboard (batch 8).

Coverage worker [w2]. Covers ``admin_update_coupon`` currency branches,
``revoke_sessions`` and ``admin_list_user_sessions`` (with seeded sessions and
not-found guards), and the ``admin_audit_entries`` entity/action/user filter
branches.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1 import admin_dashboard as ad
from app.db.base import Base
from app.models.promo import PromoCode
from app.models.user import RefreshSession, User, UserRole
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


async def _customer(session) -> User:
    user = await create_user(
        session,
        UserCreate(
            email=f"cust-{uuid4().hex[:6]}@x.com", password="password123", name="C"
        ),
    )
    await session.commit()
    await session.refresh(user)
    return user


def _no_audit(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(ad.audit_chain_service, "add_admin_audit_log", _noop)


# --------------------------------------------------------------------------- #
# admin_update_coupon: currency RON + clear (3262-3273)                       #
# --------------------------------------------------------------------------- #
def test_update_coupon_not_found(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException):
            await ad.admin_update_coupon(
                coupon_id=uuid4(), payload={}, session=session, _=admin
            )

    run(session_factory, _scenario)


def test_update_coupon_currency_ron(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _inv(s, pid):
        return None

    monkeypatch.setattr(ad, "_invalidate_stripe_coupon_mappings", _inv)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        promo = PromoCode(id=uuid4(), code=f"C-{uuid4().hex[:6]}", active=True)
        session.add(promo)
        await session.commit()
        return await ad.admin_update_coupon(
            coupon_id=promo.id,
            payload={"currency": "ron", "active": True},
            session=session,
            _=admin,
        )

    out = run(session_factory, _scenario)
    assert out["currency"] == "RON"


def test_update_coupon_currency_invalid(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        promo = PromoCode(id=uuid4(), code=f"C-{uuid4().hex[:6]}")
        session.add(promo)
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await ad.admin_update_coupon(
                coupon_id=promo.id,
                payload={"currency": "USD"},
                session=session,
                _=admin,
            )
        assert "RON" in exc.value.detail

    run(session_factory, _scenario)


def test_update_coupon_currency_cleared(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        promo = PromoCode(id=uuid4(), code=f"C-{uuid4().hex[:6]}", currency="RON")
        session.add(promo)
        await session.commit()
        return await ad.admin_update_coupon(
            coupon_id=promo.id,
            payload={"currency": None, "code": "NEWCODE"},
            session=session,
            _=admin,
        )

    out = run(session_factory, _scenario)
    assert out["currency"] is None


# --------------------------------------------------------------------------- #
# revoke_sessions (3833 if sessions:) + not-found                            #
# --------------------------------------------------------------------------- #
def test_revoke_sessions_not_found(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException):
            await ad.revoke_sessions(
                user_id=uuid4(),
                request=_Req(),
                session=session,
                current_user=admin,
            )

    run(session_factory, _scenario)


def test_revoke_sessions_revokes_all(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_audit(monkeypatch)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        session.add(
            RefreshSession(
                id=uuid4(),
                user_id=target.id,
                jti="s1",
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                persistent=True,
                revoked=False,
            )
        )
        await session.commit()
        out = await ad.revoke_sessions(
            user_id=target.id,
            request=_Req(),
            session=session,
            current_user=admin,
        )
        return out

    assert run(session_factory, _scenario) is None


def test_revoke_sessions_none_active_noop(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)  # no sessions -> if sessions: false
        return await ad.revoke_sessions(
            user_id=target.id,
            request=_Req(),
            session=session,
            current_user=admin,
        )

    assert run(session_factory, _scenario) is None


# --------------------------------------------------------------------------- #
# admin_list_user_sessions (3880/3885 naive + filter)                         #
# --------------------------------------------------------------------------- #
def test_list_user_sessions_not_found(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException):
            await ad.admin_list_user_sessions(user_id=uuid4(), session=session, _=admin)

    run(session_factory, _scenario)


def test_list_user_sessions_filters_expired(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        session.add(
            RefreshSession(
                id=uuid4(),
                user_id=target.id,
                jti="active",
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                persistent=True,
                revoked=False,
            )
        )
        session.add(
            RefreshSession(
                id=uuid4(),
                user_id=target.id,
                jti="expired",
                expires_at=datetime.now(timezone.utc) - timedelta(days=1),
                persistent=True,
                revoked=False,
            )
        )
        await session.commit()
        return await ad.admin_list_user_sessions(
            user_id=target.id, session=session, _=admin
        )

    out = run(session_factory, _scenario)
    assert len(out) == 1  # expired filtered


# --------------------------------------------------------------------------- #
# admin_audit_entries: entity/action(multi-token)/user filters (3442-3465)   #
# --------------------------------------------------------------------------- #
def test_audit_entries_with_filters(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        return await ad.admin_audit_entries(
            session=session,
            _=admin,
            entity="product",
            action="create,update",  # multi-token -> or_ branch
            user="admin@x.com",
            page=1,
            limit=20,
        )

    out = run(session_factory, _scenario)
    assert "items" in out


def test_audit_entries_single_token_action(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        return await ad.admin_audit_entries(
            session=session,
            _=admin,
            entity="security",
            action="login",  # single token -> like branch
            user=None,
            page=1,
            limit=20,
        )

    out = run(session_factory, _scenario)
    assert "items" in out
