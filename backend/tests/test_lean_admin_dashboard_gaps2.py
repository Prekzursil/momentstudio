"""Direct-call coverage for the admin_dashboard user-comms + inventory handlers.

Coverage worker [w2], batch 2. Completes ``app.api.v1.admin_dashboard``: email-
verification history/resend/override, password-reset resend, impersonation,
owner transfer, maintenance toggles, JSON/data export, low-stock and stock-
adjustment endpoints, and the inventory restock/reservation endpoints. Handlers
are invoked directly with an in-memory SQLite session and an admin/owner
``User``; delegated services are monkeypatched on the *admin_dashboard*
namespace.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from types import SimpleNamespace
from typing import Any, Callable
from uuid import uuid4

import pytest
from fastapi import HTTPException, status

from app.api.v1 import admin_dashboard as ad
from app.core import security
from app.core.config import settings
from app.db.base import Base
from app.models.catalog import Category, Product
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
    def __init__(
        self, *, ua: str = "pytest-agent", host: str | None = "127.0.0.1"
    ) -> None:
        self.headers = {"user-agent": ua}
        self.client = type("C", (), {"host": host})() if host is not None else None


class _BG:
    def __init__(self) -> None:
        self.tasks: list[Any] = []

    def add_task(self, fn: Any, *args: Any, **kwargs: Any) -> None:
        self.tasks.append((fn, args, kwargs))


async def _admin(session, *, role: UserRole = UserRole.admin) -> User:
    user = await create_user(
        session,
        UserCreate(
            email=f"{role.value}-{uuid4().hex[:6]}@x.com",
            password="password123",
            name="Admin",
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
            email=f"cust-{uuid4().hex[:6]}@x.com",
            password="password123",
            name="Cust",
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


# --------------------------------------------------------------------------- #
# email verification history / resend / override                             #
# --------------------------------------------------------------------------- #
def test_email_verification_history_not_found(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException):
            await ad.email_verification_history(
                user_id=uuid4(), session=session, _=admin
            )

    run(session_factory, _scenario)


def test_email_verification_history_empty(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        return await ad.email_verification_history(
            user_id=target.id, session=session, _=admin
        )

    out = run(session_factory, _scenario)
    assert out.tokens == []


def test_resend_email_verification_already_verified(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session, email_verified=True)
        with pytest.raises(HTTPException) as exc:
            await ad.resend_email_verification(
                user_id=target.id,
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                current_user=admin,
            )
        assert "already verified" in exc.value.detail

    run(session_factory, _scenario)


def test_resend_email_verification_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_audit(monkeypatch)
    monkeypatch.setattr(
        ad.email_service, "send_verification_email", lambda *a, **k: None
    )

    async def _create(s, u):
        return SimpleNamespace(
            id=uuid4(), token="tk", expires_at=datetime.now(timezone.utc)
        )

    monkeypatch.setattr(ad.auth_service, "create_email_verification", _create)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session, email_verified=False)
        bg = _BG()
        out = await ad.resend_email_verification(
            user_id=target.id,
            request=_Req(),
            background_tasks=bg,
            session=session,
            current_user=admin,
        )
        assert len(bg.tasks) == 1
        return out

    assert "sent" in run(session_factory, _scenario)["detail"]


def test_resend_email_verification_not_found(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException):
            await ad.resend_email_verification(
                user_id=uuid4(),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                current_user=admin,
            )

    run(session_factory, _scenario)


def test_override_email_verification_bad_password(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: False)

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


def test_override_email_verification_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: True)
    _no_audit(monkeypatch)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session, email_verified=False)
        out = await ad.override_email_verification(
            user_id=target.id,
            payload=SimpleNamespace(password="x"),
            request=_Req(),
            session=session,
            current_user=admin,
        )
        return out

    out = run(session_factory, _scenario)
    assert out.email_verified is True


def test_override_email_verification_already_verified_noop(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: True)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session, email_verified=True)
        return await ad.override_email_verification(
            user_id=target.id,
            payload=SimpleNamespace(password="x"),
            request=_Req(),
            session=session,
            current_user=admin,
        )

    assert run(session_factory, _scenario).email_verified is True


# --------------------------------------------------------------------------- #
# resend_password_reset                                                       #
# --------------------------------------------------------------------------- #
def test_resend_password_reset_primary(
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
        bg = _BG()
        out = await ad.resend_password_reset(
            user_id=target.id,
            payload=SimpleNamespace(email=None),
            request=_Req(),
            background_tasks=bg,
            session=session,
            current_user=admin,
            _=None,
        )
        assert len(bg.tasks) == 1
        return out

    assert "sent" in run(session_factory, _scenario)["detail"]


def test_resend_password_reset_invalid_secondary(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        with pytest.raises(HTTPException) as exc:
            await ad.resend_password_reset(
                user_id=target.id,
                payload=SimpleNamespace(email="unknown@x.com"),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                current_user=admin,
                _=None,
            )
        assert exc.value.detail == "Invalid email"

    run(session_factory, _scenario)


def test_resend_password_reset_user_not_found(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException):
            await ad.resend_password_reset(
                user_id=uuid4(),
                payload=SimpleNamespace(email=None),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                current_user=admin,
                _=None,
            )

    run(session_factory, _scenario)


def test_resend_password_reset_no_token(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _reset(s, email):
        return None

    monkeypatch.setattr(ad.auth_service, "create_reset_token", _reset)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        with pytest.raises(HTTPException) as exc:
            await ad.resend_password_reset(
                user_id=target.id,
                payload=SimpleNamespace(email=None),
                request=_Req(),
                background_tasks=_BG(),
                session=session,
                current_user=admin,
                _=None,
            )
        assert exc.value.status_code == status.HTTP_404_NOT_FOUND

    run(session_factory, _scenario)


# --------------------------------------------------------------------------- #
# impersonate                                                                  #
# --------------------------------------------------------------------------- #
def test_impersonate_not_customer(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        staff = await _customer(session)
        staff.role = UserRole.support
        await session.commit()
        with pytest.raises(HTTPException) as exc:
            await ad.impersonate_user(
                user_id=staff.id,
                request=_Req(),
                session=session,
                current_user=admin,
            )
        assert "customer accounts" in exc.value.detail

    run(session_factory, _scenario)


def test_impersonate_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_audit(monkeypatch)
    monkeypatch.setattr(
        security, "create_impersonation_access_token", lambda *a, **k: "imp-token"
    )

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        target = await _customer(session)
        return await ad.impersonate_user(
            user_id=target.id,
            request=_Req(),
            session=session,
            current_user=admin,
        )

    assert run(session_factory, _scenario).access_token == "imp-token"


def test_impersonate_not_found(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException):
            await ad.impersonate_user(
                user_id=uuid4(),
                request=_Req(),
                session=session,
                current_user=admin,
            )

    run(session_factory, _scenario)


# --------------------------------------------------------------------------- #
# transfer_owner                                                              #
# --------------------------------------------------------------------------- #
def test_transfer_owner_missing_identifier(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        owner = await _admin(session, role=UserRole.owner)
        with pytest.raises(HTTPException) as exc:
            await ad.transfer_owner(
                payload=SimpleNamespace(
                    identifier="  ", confirm="TRANSFER", password="x"
                ),
                session=session,
                current_owner=owner,
            )
        assert "Identifier" in exc.value.detail

    run(session_factory, _scenario)


def test_transfer_owner_bad_confirm(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        owner = await _admin(session, role=UserRole.owner)
        with pytest.raises(HTTPException) as exc:
            await ad.transfer_owner(
                payload=SimpleNamespace(
                    identifier="u@x.com", confirm="no", password="x"
                ),
                session=session,
                current_owner=owner,
            )
        assert "TRANSFER" in exc.value.detail

    run(session_factory, _scenario)


def test_transfer_owner_bad_password(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: False)

    async def _scenario(session) -> Any:
        owner = await _admin(session, role=UserRole.owner)
        with pytest.raises(HTTPException):
            await ad.transfer_owner(
                payload=SimpleNamespace(
                    identifier="u@x.com", confirm="TRANSFER", password="x"
                ),
                session=session,
                current_owner=owner,
            )

    run(session_factory, _scenario)


def test_transfer_owner_target_not_found(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: True)

    async def _by_email(s, ident):
        return None

    monkeypatch.setattr(ad.auth_service, "get_user_by_any_email", _by_email)

    async def _scenario(session) -> Any:
        owner = await _admin(session, role=UserRole.owner)
        with pytest.raises(HTTPException) as exc:
            await ad.transfer_owner(
                payload=SimpleNamespace(
                    identifier="missing@x.com", confirm="TRANSFER", password="x"
                ),
                session=session,
                current_owner=owner,
            )
        assert exc.value.status_code == status.HTTP_404_NOT_FOUND

    run(session_factory, _scenario)


def test_transfer_owner_to_self_noop(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: True)

    async def _scenario(session) -> Any:
        owner = await _admin(session, role=UserRole.owner)

        async def _by_username(s, ident):
            return owner

        monkeypatch.setattr(ad.auth_service, "get_user_by_username", _by_username)
        return await ad.transfer_owner(
            payload=SimpleNamespace(
                identifier="owner", confirm="TRANSFER", password="x"
            ),
            session=session,
            current_owner=owner,
        )

    out = run(session_factory, _scenario)
    assert out["old_owner_id"] == out["new_owner_id"]


def test_transfer_owner_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(security, "verify_password", lambda raw, h: True)
    _no_audit(monkeypatch)

    async def _scenario(session) -> Any:
        owner = await _admin(session, role=UserRole.owner)
        target = await _customer(session)

        async def _by_email(s, ident):
            return target

        monkeypatch.setattr(ad.auth_service, "get_user_by_any_email", _by_email)
        out = await ad.transfer_owner(
            payload=SimpleNamespace(
                identifier="t@x.com", confirm="transfer", password="x"
            ),
            session=session,
            current_owner=owner,
        )
        return out

    out = run(session_factory, _scenario)
    assert out["role"] == UserRole.owner


# --------------------------------------------------------------------------- #
# maintenance / export                                                        #
# --------------------------------------------------------------------------- #
def test_get_and_set_maintenance(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "maintenance_mode", False)
    assert asyncio.run(ad.get_maintenance(_="admin"))["enabled"] is False
    out = asyncio.run(ad.set_maintenance(payload={"enabled": True}, _="admin"))
    assert out["enabled"] is True


def test_export_data(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.step_up_service, "require_step_up", lambda req, u: None)

    async def _export(s):
        return {"data": "x"}

    monkeypatch.setattr(ad.exporter_service, "export_json", _export)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        return await ad.export_data(request=_Req(), session=session, admin=admin)

    assert run(session_factory, _scenario) == {"data": "x"}


# --------------------------------------------------------------------------- #
# low_stock + stock-adjustments                                              #
# --------------------------------------------------------------------------- #
async def _make_product(session, **kw: Any) -> Product:
    cat = Category(id=uuid4(), slug=f"c-{uuid4().hex[:6]}", name="Cat")
    session.add(cat)
    await session.commit()
    defaults = dict(
        id=uuid4(),
        category_id=cat.id,
        slug=f"p-{uuid4().hex[:6]}",
        name="Prod",
        stock_quantity=0,
        is_deleted=False,
        is_active=True,
    )
    defaults.update(kw)
    product = Product(**defaults)
    session.add(product)
    await session.commit()
    await session.refresh(product)
    return product


def test_low_stock_products(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        await _make_product(session, stock_quantity=0)
        return await ad.low_stock_products(session=session, _=admin)

    out = run(session_factory, _scenario)
    assert len(out) == 1
    assert out[0]["is_critical"] is True


def test_list_stock_adjustments(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _list(s, *, product_id, limit, offset):
        return []

    monkeypatch.setattr(ad.catalog_service, "list_stock_adjustments", _list)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        return await ad.list_stock_adjustments(
            product_id=uuid4(), limit=50, offset=0, session=session, _=admin
        )

    assert run(session_factory, _scenario) == []


def test_apply_stock_adjustment(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        ad.StockAdjustmentRead, "model_validate", classmethod(lambda cls, obj: obj)
    )

    async def _apply(s, *, payload, user_id):
        return SimpleNamespace(id=uuid4())

    monkeypatch.setattr(ad.catalog_service, "apply_stock_adjustment", _apply)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        return await ad.apply_stock_adjustment(
            payload=SimpleNamespace(), session=session, current_user=admin
        )

    assert run(session_factory, _scenario) is not None


def test_export_stock_adjustments_bad_date_range(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.step_up_service, "require_step_up", lambda req, u: None)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException) as exc:
            await ad.export_stock_adjustments(
                request=_Req(),
                product_id=uuid4(),
                reason=None,
                from_date=date(2024, 2, 1),
                to_date=date(2024, 1, 1),
                limit=5000,
                session=session,
                admin=admin,
            )
        assert "date range" in exc.value.detail

    run(session_factory, _scenario)


def test_export_stock_adjustments_product_not_found(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.step_up_service, "require_step_up", lambda req, u: None)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException) as exc:
            await ad.export_stock_adjustments(
                request=_Req(),
                product_id=uuid4(),
                reason=None,
                from_date=None,
                to_date=None,
                limit=5000,
                session=session,
                admin=admin,
            )
        assert exc.value.status_code == status.HTTP_404_NOT_FOUND

    run(session_factory, _scenario)


def test_export_stock_adjustments_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.step_up_service, "require_step_up", lambda req, u: None)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        product = await _make_product(session)
        resp = await ad.export_stock_adjustments(
            request=_Req(),
            product_id=product.id,
            reason=None,
            from_date=None,
            to_date=None,
            limit=5000,
            session=session,
            admin=admin,
        )
        return resp

    resp = run(session_factory, _scenario)
    assert resp.media_type == "text/csv"


# --------------------------------------------------------------------------- #
# inventory endpoints                                                         #
# --------------------------------------------------------------------------- #
def test_inventory_restock_list(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _paginate(s, **k):
        return SimpleNamespace(items=[], meta=None)

    monkeypatch.setattr(ad.inventory_service, "paginate_restock_list", _paginate)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        return await ad.inventory_restock_list(
            session=session,
            _=admin,
            page=1,
            limit=50,
            include_variants=True,
            default_threshold=5,
        )

    assert run(session_factory, _scenario).items == []


def test_inventory_reserved_carts_product_not_found(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException):
            await ad.inventory_reserved_carts(
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


def test_inventory_reserved_carts_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.pii_service, "mask_email", lambda e: "m***@x.com")

    async def _list(s, *, product_id, variant_id, limit, offset):
        return (
            datetime.now(timezone.utc),
            [
                {
                    "cart_id": uuid4(),
                    "updated_at": datetime.now(timezone.utc),
                    "customer_email": "buyer@x.com",
                    "quantity": 2,
                }
            ],
        )

    monkeypatch.setattr(ad.inventory_service, "list_cart_reservations", _list)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        product = await _make_product(session)
        return await ad.inventory_reserved_carts(
            request=_Req(),
            product_id=product.id,
            variant_id=None,
            include_pii=False,
            limit=50,
            offset=0,
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert out.items[0].customer_email == "m***@x.com"


def test_inventory_reserved_orders_success(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        ad.pii_service, "require_pii_reveal", lambda u, request=None: None
    )

    async def _list(s, *, product_id, variant_id, limit, offset):
        return [
            {
                "order_id": uuid4(),
                "reference_code": "REF",
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
        # include_pii True -> unmasked email
        return await ad.inventory_reserved_orders(
            request=_Req(),
            product_id=product.id,
            variant_id=None,
            include_pii=True,
            limit=50,
            offset=0,
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert out.items[0].customer_email == "buyer@x.com"


def test_upsert_inventory_restock_note(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _upsert(s, *, payload, user_id):
        return None

    monkeypatch.setattr(ad.inventory_service, "upsert_restock_note", _upsert)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        return await ad.upsert_inventory_restock_note(
            payload=SimpleNamespace(), session=session, current_user=admin
        )

    assert run(session_factory, _scenario) is None


def test_export_inventory_restock_list(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.step_up_service, "require_step_up", lambda req, u: None)

    async def _list(s, *, include_variants, default_threshold):
        return [
            SimpleNamespace(
                kind="product",
                sku="SKU1",
                product_slug="slug",
                product_name="Prod",
                variant_name=None,
                stock_quantity=1,
                reserved_in_carts=0,
                reserved_in_orders=0,
                available_quantity=1,
                threshold=5,
                supplier=None,
                desired_quantity=None,
                note=None,
                restock_at=None,
                note_updated_at=None,
                product_id=uuid4(),
                variant_id=None,
            )
        ]

    monkeypatch.setattr(ad.inventory_service, "list_restock_list", _list)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        return await ad.export_inventory_restock_list(
            request=_Req(),
            include_variants=True,
            default_threshold=5,
            session=session,
            admin=admin,
        )

    resp = run(session_factory, _scenario)
    assert resp.media_type == "text/csv"
