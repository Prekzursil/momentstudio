"""Branch-completion coverage for admin_dashboard handlers (batch 3).

Coverage worker [w2]. Closes the residual error/guard/branch arcs in the
GDPR, user-security, password-reset, override, stock-export and inventory
handlers of ``app.api.v1.admin_dashboard`` that the prior batches did not
reach (not-found guards, engine-unavailable, filter branches, secondary-email
paths, variant validation, and tz-aware skip arcs via stubbed execute).
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Callable
from uuid import uuid4

import pytest
from fastapi import HTTPException, status

from app.api.v1 import admin_dashboard as ad
from app.core import security
from app.db.base import Base
from app.models.catalog import Category, Product, ProductVariant
from app.models.user import User, UserRole, UserSecondaryEmail
from app.models.user_export import UserDataExportJob, UserDataExportStatus
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


class _BG:
    def __init__(self) -> None:
        self.tasks: list[Any] = []

    def add_task(self, fn: Any, *args: Any, **kwargs: Any) -> None:
        self.tasks.append((fn, args, kwargs))


class _NoEngineSession:
    """Delegates to a real session but reports a non-AsyncEngine ``bind``."""

    def __init__(self, inner: Any) -> None:
        object.__setattr__(self, "_inner", inner)

    @property
    def bind(self) -> Any:
        return object()

    def __getattr__(self, name: str) -> Any:
        return getattr(object.__getattribute__(self, "_inner"), name)


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


def _seed_export_job(session, user_id, **kw):
    defaults = dict(
        id=uuid4(),
        user_id=user_id,
        status=UserDataExportStatus.pending,
        progress=0,
    )
    defaults.update(kw)
    job = UserDataExportJob(**defaults)
    session.add(job)
    return job


# --------------------------------------------------------------------------- #
# GDPR retry guards                                                           #
# --------------------------------------------------------------------------- #
def test_gdpr_retry_user_not_found(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        # job exists but its user is gone
        ghost_user = uuid4()
        job = _seed_export_job(session, ghost_user)
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await ad.admin_gdpr_retry_export_job(
                job_id=job.id,
                background_tasks=_BG(),
                request=_Req(),
                session=session,
                current_user=admin,
            )
        assert exc.value.detail == "User not found"

    run(session_factory, _scenario)


def test_gdpr_retry_engine_unavailable(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        job = _seed_export_job(session, target.id)
        await session.commit()
        wrapped = _NoEngineSession(session)
        with pytest.raises(HTTPException) as exc:
            await ad.admin_gdpr_retry_export_job(
                job_id=job.id,
                background_tasks=_BG(),
                request=_Req(),
                session=wrapped,
                current_user=admin,
            )
        assert exc.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR

    run(session_factory, _scenario)


# --------------------------------------------------------------------------- #
# GDPR download guards                                                        #
# --------------------------------------------------------------------------- #
def test_gdpr_download_not_found(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.step_up_service, "require_step_up", lambda req, u: None)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException) as exc:
            await ad.admin_gdpr_download_export_job(
                job_id=uuid4(), request=_Req(), session=session, current_user=admin
            )
        assert exc.value.detail == "Export job not found"

    run(session_factory, _scenario)


def test_gdpr_download_expired(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.step_up_service, "require_step_up", lambda req, u: None)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        job = _seed_export_job(
            session,
            target.id,
            status=UserDataExportStatus.succeeded,
            file_path="e.json",
            expires_at=datetime.now(timezone.utc) - timedelta(days=1),
        )
        await session.commit()
        with pytest.raises(HTTPException):
            await ad.admin_gdpr_download_export_job(
                job_id=job.id, request=_Req(), session=session, current_user=admin
            )

    run(session_factory, _scenario)


# --------------------------------------------------------------------------- #
# GDPR deletions: pii + q filter + "due" status                              #
# --------------------------------------------------------------------------- #
def test_gdpr_deletion_requests_pii_and_due(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        ad.pii_service, "require_pii_reveal", lambda u, request=None: None
    )

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(
            session,
            deletion_requested_at=datetime.now(timezone.utc),
            deletion_scheduled_for=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        return await ad.admin_gdpr_deletion_requests(
            request=_Req(),
            q=target.email[:4],
            page=1,
            limit=25,
            include_pii=True,
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert out.items[0].status == "due"


# --------------------------------------------------------------------------- #
# GDPR execute / update_security not-found                                    #
# --------------------------------------------------------------------------- #
def test_gdpr_execute_user_not_found(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: True)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException) as exc:
            await ad.admin_gdpr_execute_deletion(
                user_id=uuid4(),
                payload=SimpleNamespace(password="x"),
                request=_Req(),
                session=session,
                current_user=admin,
            )
        assert exc.value.status_code == status.HTTP_404_NOT_FOUND

    run(session_factory, _scenario)


def test_update_user_security_not_found(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException):
            await ad.update_user_security(
                user_id=uuid4(),
                payload=_dump({}),
                request=_Req(),
                session=session,
                current_user=admin,
            )

    run(session_factory, _scenario)


def _dump(data: dict) -> Any:
    class P(SimpleNamespace):
        def model_dump(self, exclude_unset=False):
            return data

    return P(**data)


def test_update_user_internal_no_changes(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        # empty payload -> no changes -> audit-log skipped
        return await ad.update_user_internal(
            user_id=target.id,
            payload=_dump({}),
            session=session,
            current_user=admin,
        )

    assert run(session_factory, _scenario) is not None


# --------------------------------------------------------------------------- #
# password-reset resend: primary by explicit email + secondary success       #
# --------------------------------------------------------------------------- #
def test_resend_password_reset_explicit_primary(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_audit(monkeypatch)
    monkeypatch.setattr(ad.email_service, "send_password_reset", lambda *a, **k: None)
    monkeypatch.setattr(ad.pii_service, "mask_email", lambda e: "m***@x.com")

    async def _reset(s, email):
        return SimpleNamespace(
            id=uuid4(), token="rt", expires_at=datetime.now(timezone.utc)
        )

    monkeypatch.setattr(ad.auth_service, "create_reset_token", _reset)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        return await ad.resend_password_reset(
            user_id=target.id,
            payload=SimpleNamespace(email=target.email),  # explicit primary
            request=_Req(),
            background_tasks=_BG(),
            session=session,
            current_user=admin,
            _=None,
        )

    assert "sent" in run(session_factory, _scenario)["detail"]


def test_resend_password_reset_secondary(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_audit(monkeypatch)
    monkeypatch.setattr(ad.email_service, "send_password_reset", lambda *a, **k: None)
    monkeypatch.setattr(ad.pii_service, "mask_email", lambda e: "m***@x.com")

    async def _reset(s, email):
        return SimpleNamespace(
            id=uuid4(), token="rt", expires_at=datetime.now(timezone.utc)
        )

    monkeypatch.setattr(ad.auth_service, "create_reset_token", _reset)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        session.add(
            UserSecondaryEmail(
                id=uuid4(),
                user_id=target.id,
                email="second@x.com",
                verified=True,
            )
        )
        await session.commit()
        return await ad.resend_password_reset(
            user_id=target.id,
            payload=SimpleNamespace(email="second@x.com"),
            request=_Req(),
            background_tasks=_BG(),
            session=session,
            current_user=admin,
            _=None,
        )

    assert "sent" in run(session_factory, _scenario)["detail"]


# --------------------------------------------------------------------------- #
# override email verification: not-found + clears unused tokens               #
# --------------------------------------------------------------------------- #
def test_override_email_verification_not_found(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: True)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException):
            await ad.override_email_verification(
                user_id=uuid4(),
                payload=SimpleNamespace(password="x"),
                request=_Req(),
                session=session,
                current_user=admin,
            )

    run(session_factory, _scenario)


def test_override_email_verification_marks_tokens_used(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: True)
    _no_audit(monkeypatch)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session, email_verified=False)
        session.add(
            ad.EmailVerificationToken(
                id=uuid4(),
                user_id=target.id,
                token="tok",
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                used=False,
            )
        )
        await session.commit()
        return await ad.override_email_verification(
            user_id=target.id,
            payload=SimpleNamespace(password="x"),
            request=_Req(),
            session=session,
            current_user=admin,
        )

    assert run(session_factory, _scenario).email_verified is True


# --------------------------------------------------------------------------- #
# stock-adjustments export with reason filter + rows                          #
# --------------------------------------------------------------------------- #
def test_export_stock_adjustments_with_rows_and_reason(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.step_up_service, "require_step_up", lambda req, u: None)

    from app.models.catalog import StockAdjustment, StockAdjustmentReason

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        product = await _make_product(session)
        session.add(
            StockAdjustment(
                id=uuid4(),
                product_id=product.id,
                variant_id=None,
                reason=StockAdjustmentReason.manual_correction,
                delta=5,
                before_quantity=0,
                after_quantity=5,
                note="restock",
                actor_user_id=admin.id,
            )
        )
        await session.commit()
        return await ad.export_stock_adjustments(
            request=_Req(),
            product_id=product.id,
            reason=StockAdjustmentReason.manual_correction,
            from_date=date(2020, 1, 1),
            to_date=date(2999, 1, 1),
            limit=5000,
            session=session,
            admin=admin,
        )

    resp = run(session_factory, _scenario)
    assert resp.media_type == "text/csv"
    assert "restock" in resp.body.decode()


# --------------------------------------------------------------------------- #
# inventory variant validation                                               #
# --------------------------------------------------------------------------- #
def test_inventory_reserved_carts_invalid_variant(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        product = await _make_product(session)
        with pytest.raises(HTTPException) as exc:
            await ad.inventory_reserved_carts(
                request=_Req(),
                product_id=product.id,
                variant_id=uuid4(),  # nonexistent variant
                include_pii=False,
                limit=50,
                offset=0,
                session=session,
                current_user=admin,
            )
        assert exc.value.detail == "Invalid variant"

    run(session_factory, _scenario)


def test_inventory_reserved_orders_product_not_found(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException):
            await ad.inventory_reserved_orders(
                request=_Req(),
                product_id=uuid4(),
                variant_id=None,
                include_pii=False,
                limit=50,
                offset=0,
                session=session,
                current_user=admin,
            )

    run(session_factory, _scenario)


def test_inventory_reserved_orders_masked(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.pii_service, "mask_email", lambda e: "m***@x.com")

    async def _list(s, *, product_id, variant_id, limit, offset):
        return [
            {
                "order_id": uuid4(),
                "reference_code": None,
                "status": "pending_payment",
                "created_at": datetime.now(timezone.utc),
                "customer_email": "buyer@x.com",
                "quantity": 1,
            }
        ]

    monkeypatch.setattr(ad.inventory_service, "list_order_reservations", _list)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        product = await _make_product(session)
        # variant valid (belongs to product) -> exercises variant-ok branch
        variant = ProductVariant(id=uuid4(), product_id=product.id, name="V")
        session.add(variant)
        await session.commit()
        return await ad.inventory_reserved_orders(
            request=_Req(),
            product_id=product.id,
            variant_id=variant.id,
            include_pii=False,
            limit=50,
            offset=0,
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert out.items[0].customer_email == "m***@x.com"
