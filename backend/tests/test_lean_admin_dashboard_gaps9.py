"""Final cheap-certain arc closures for admin_dashboard (batch 9).

Coverage worker [w2]. Closes the reliably-reachable residual arcs: global-search
text include_pii (no-mask), aliases include_pii, admin_list_user_sessions
tz-aware skip (via stubbed execute), password-reset empty-email guard, the
coupon currency/no-stripe arcs, and the audit entity="all" / no-action filter
arcs.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, Callable
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1 import admin_dashboard as ad
from app.db.base import Base
from app.models.order import Order
from app.models.promo import PromoCode
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
# global search: text include_pii=True (no mask) (2075->2077)                #
# --------------------------------------------------------------------------- #
def test_global_search_text_include_pii(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        ad.pii_service, "require_pii_reveal", lambda u, request=None: None
    )

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        session.add(
            Order(
                id=uuid4(),
                customer_email="pii-find@x.com",
                customer_name="F",
                total_amount=Decimal("5.00"),
                reference_code="PIIFIND",
            )
        )
        await session.commit()
        return await ad.admin_global_search(
            request=_Req(),
            q="pii-find",
            include_pii=True,
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert any(r.subtitle == "pii-find@x.com" for r in out.items)


# --------------------------------------------------------------------------- #
# admin_user_aliases include_pii (2848)                                       #
# --------------------------------------------------------------------------- #
def test_admin_user_aliases_include_pii(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    called = {"v": False}

    def _reveal(u, request=None):
        called["v"] = True

    monkeypatch.setattr(ad.pii_service, "require_pii_reveal", _reveal)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        out = await ad.admin_user_aliases(
            user_id=target.id,
            request=_Req(),
            include_pii=True,
            session=session,
            current_user=admin,
        )
        assert called["v"] is True
        return out

    assert run(session_factory, _scenario) is not None


def test_admin_user_aliases_not_found(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException):
            await ad.admin_user_aliases(
                user_id=uuid4(),
                request=_Req(),
                include_pii=False,
                session=session,
                current_user=admin,
            )

    run(session_factory, _scenario)


# --------------------------------------------------------------------------- #
# admin_list_user_sessions: tz-aware skip arcs (3880->3882, 3885->3887)      #
# --------------------------------------------------------------------------- #
def test_admin_list_user_sessions_aware(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        aware_row = SimpleNamespace(
            id=uuid4(),
            jti="aware",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            created_at=datetime.now(timezone.utc),
            persistent=True,
            user_agent="ua",
            ip_address="1.2.3.4",
            country_code="RO",
        )

        real_get = session.get

        async def _get(model, ident):
            if model is User:
                return target
            return await real_get(model, ident)

        async def _execute(*args, **kwargs):
            return _ScalarsResult([aware_row])

        monkeypatch.setattr(session, "get", _get)
        monkeypatch.setattr(session, "execute", _execute)
        return await ad.admin_list_user_sessions(
            user_id=target.id, session=session, _=admin
        )

    out = run(session_factory, _scenario)
    assert len(out) == 1


# --------------------------------------------------------------------------- #
# resend_password_reset: user.email whitespace -> target empty (4776)        #
# --------------------------------------------------------------------------- #
def test_resend_password_reset_email_missing(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        # Whitespace-only email passes NOT NULL but makes target_email empty.
        target.email = "   "
        session.add(target)
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await ad.resend_password_reset(
                user_id=target.id,
                payload=SimpleNamespace(email=None),
                request=_Req(),
                background_tasks=type("BG", (), {"add_task": lambda *a, **k: None})(),
                session=session,
                current_user=admin,
                _=None,
            )
        assert "email missing" in exc.value.detail.lower()

    run(session_factory, _scenario)


# --------------------------------------------------------------------------- #
# admin_update_coupon: currency present but no stripe-invalidating fields     #
# (3262 currency-only path, 3274->3276 invalidate False)                      #
# --------------------------------------------------------------------------- #
def test_update_coupon_code_only_no_stripe(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        promo = PromoCode(id=uuid4(), code=f"C-{uuid4().hex[:6]}")
        session.add(promo)
        await session.commit()
        # Only ``code`` changes -> invalidate_stripe stays False (3274->3276 skip).
        return await ad.admin_update_coupon(
            coupon_id=promo.id,
            payload={"code": "JUSTCODE", "max_uses": 5},
            session=session,
            _=admin,
        )

    out = run(session_factory, _scenario)
    assert out["code"] == "JUSTCODE"


# --------------------------------------------------------------------------- #
# admin_audit_entries: entity="all" (no entity filter) + no action/user      #
# (3442->3447, 3447->3463, 3463->end)                                        #
# --------------------------------------------------------------------------- #
def test_audit_entries_entity_all_no_filters(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        return await ad.admin_audit_entries(
            session=session,
            _=admin,
            entity="all",  # normalized == "all" -> skip append (3444 false)
            action=None,  # 3447 false
            user=None,  # 3463 false
            page=1,
            limit=20,
        )

    out = run(session_factory, _scenario)
    assert "items" in out


def test_audit_entries_blank_action_user(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        return await ad.admin_audit_entries(
            session=session,
            _=admin,
            entity="all",
            action="   ",  # strips to empty -> 3449 false
            user="   ",  # strips to empty -> 3465 false
            page=1,
            limit=20,
        )

    out = run(session_factory, _scenario)
    assert "items" in out
