"""Lean-gate coverage for the uncovered branches of ``app.api.v1.returns``.

Disjoint from ``test_returns_api.py``: targets the label upload/download/delete
endpoints, the by-order listing, PII reveal, sanitize helper, and 404 guards.
"""

from __future__ import annotations

import asyncio
import io
import uuid
from decimal import Decimal
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import returns as returns_api
from app.core import security
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.order import Order, OrderItem, OrderStatus
from app.models.passkeys import UserPasskey
from app.models.returns import ReturnRequest, ReturnRequestItem, ReturnRequestStatus
from app.models.user import User, UserRole


@pytest.fixture
def returns_app(tmp_path, monkeypatch) -> Dict[str, object]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

    async def init_models() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(init_models())

    async def override_get_session():
        async with SessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    monkeypatch.setattr(
        returns_api.private_storage.settings, "private_media_root", str(tmp_path)
    )

    async def _noop_audit(*a, **k):  # noqa: ANN002, ANN003
        return None

    monkeypatch.setattr(
        returns_api.returns_service.audit_chain_service,
        "add_admin_audit_log",
        _noop_audit,
    )

    client = TestClient(app)
    yield {"client": client, "session_factory": SessionLocal, "root": tmp_path}
    client.close()
    app.dependency_overrides.clear()


def _admin_token(client, session_factory) -> str:
    async def seed() -> None:
        async with session_factory() as session:
            admin = User(
                email="retadmin@example.com",
                username="retadmin",
                hashed_password=security.hash_password("Password123"),
                name="Ret Admin",
                role=UserRole.admin,
            )
            session.add(admin)
            await session.flush()
            session.add(
                UserPasskey(
                    user_id=admin.id,
                    name="pk",
                    credential_id=f"cred-{admin.id}",
                    public_key=b"k",
                    sign_count=0,
                    backed_up=False,
                )
            )
            await session.commit()

    asyncio.run(seed())
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "retadmin@example.com", "password": "Password123"},
    )
    assert login.status_code == 200, login.text
    return login.json()["tokens"]["access_token"]


async def _seed_return(session_factory):
    from app.models.catalog import Category, Product, ProductStatus

    async with session_factory() as session:
        cust = User(
            email="retcust@example.com",
            username="retcust",
            hashed_password=security.hash_password("Password123"),
            name="Customer",
        )
        session.add(cust)
        await session.flush()
        cat = Category(slug="c", name="C", sort_order=1)
        session.add(cat)
        await session.flush()
        prod = Product(
            slug="p",
            name="P",
            base_price=10,
            currency="RON",
            category_id=cat.id,
            stock_quantity=5,
            status=ProductStatus.published,
        )
        session.add(prod)
        await session.flush()
        order = Order(
            user_id=cust.id,
            status=OrderStatus.delivered,
            customer_email="retcust@example.com",
            customer_name="Customer",
            total_amount=Decimal("20.00"),
            reference_code="RET-1",
        )
        session.add(order)
        await session.flush()
        oitem = OrderItem(
            order_id=order.id,
            product_id=prod.id,
            quantity=2,
            unit_price=Decimal("10.00"),
            subtotal=Decimal("20.00"),
        )
        session.add(oitem)
        await session.flush()
        rr = ReturnRequest(
            order_id=order.id,
            user_id=cust.id,
            status=ReturnRequestStatus.requested,
            reason="broken",
            created_by=cust.id,
            updated_by=cust.id,
            items=[ReturnRequestItem(order_item_id=oitem.id, quantity=1)],
        )
        session.add(rr)
        await session.commit()
        await session.refresh(rr)
        return str(rr.id), str(order.id)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# --------------------------------------------------------------------------- #
# helpers                                                                      #
# --------------------------------------------------------------------------- #
def test_sanitize_filename() -> None:
    assert returns_api._sanitize_filename(None) == "return-label"
    assert returns_api._sanitize_filename("  ") == "return-label"
    assert returns_api._sanitize_filename("../../x.pdf") == "x.pdf"


# --------------------------------------------------------------------------- #
# admin list / get / by-order                                                  #
# --------------------------------------------------------------------------- #
def test_admin_list_returns_masked(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    asyncio.run(_seed_return(SessionLocal))
    res = client.get("/api/v1/returns/admin", headers=_auth(token))
    assert res.status_code == 200, res.text
    item = res.json()["items"][0]
    # Masked email (no PII reveal).
    assert "*" in item["customer_email"]


def test_admin_get_return_not_found(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    res = client.get(f"/api/v1/returns/admin/{uuid.uuid4()}", headers=_auth(token))
    assert res.status_code == 404


def test_admin_get_return_ok(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    return_id, _order_id = asyncio.run(_seed_return(SessionLocal))
    res = client.get(f"/api/v1/returns/admin/{return_id}", headers=_auth(token))
    assert res.status_code == 200, res.text
    assert res.json()["has_return_label"] is False


def test_admin_list_returns_for_order(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    _return_id, order_id = asyncio.run(_seed_return(SessionLocal))
    res = client.get(f"/api/v1/returns/admin/by-order/{order_id}", headers=_auth(token))
    assert res.status_code == 200, res.text
    assert len(res.json()) == 1


def test_admin_update_return_not_found(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    res = client.patch(
        f"/api/v1/returns/admin/{uuid.uuid4()}",
        headers=_auth(token),
        json={"admin_note": "x"},
    )
    assert res.status_code == 404


def test_admin_update_return_status_change(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    return_id, _order_id = asyncio.run(_seed_return(SessionLocal))
    res = client.patch(
        f"/api/v1/returns/admin/{return_id}",
        headers=_auth(token),
        json={"status": "approved"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "approved"


def test_admin_endpoints_with_pii_reveal(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    return_id, order_id = asyncio.run(_seed_return(SessionLocal))
    h = _auth(token)
    # admin (PII_REVEAL role) + step_up no-op -> include_pii path allowed.
    lst = client.get("/api/v1/returns/admin?include_pii=true", headers=h)
    assert lst.status_code == 200, lst.text
    assert lst.json()["items"][0]["customer_email"] == "retcust@example.com"

    got = client.get(f"/api/v1/returns/admin/{return_id}?include_pii=true", headers=h)
    assert got.status_code == 200, got.text
    assert got.json()["customer_email"] == "retcust@example.com"

    by_order = client.get(
        f"/api/v1/returns/admin/by-order/{order_id}?include_pii=true", headers=h
    )
    assert by_order.status_code == 200


def test_admin_create_return(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)

    order_item = {"v": None, "order": None}

    async def seed_order() -> None:
        from app.models.catalog import Category, Product, ProductStatus

        async with SessionLocal() as session:
            cust = User(
                email="acreate@example.com",
                username="acreate",
                hashed_password=security.hash_password("Password123"),
                name="AC",
            )
            session.add(cust)
            await session.flush()
            cat = Category(slug="ac", name="AC", sort_order=1)
            session.add(cat)
            await session.flush()
            prod = Product(
                slug="ac-p",
                name="AC P",
                base_price=10,
                currency="RON",
                category_id=cat.id,
                stock_quantity=5,
                status=ProductStatus.published,
            )
            session.add(prod)
            await session.flush()
            order = Order(
                user_id=cust.id,
                status=OrderStatus.delivered,
                customer_email="acreate@example.com",
                customer_name="AC",
                total_amount=Decimal("20.00"),
                reference_code="AC-1",
            )
            session.add(order)
            await session.flush()
            oitem = OrderItem(
                order_id=order.id,
                product_id=prod.id,
                quantity=2,
                unit_price=Decimal("10.00"),
                subtotal=Decimal("20.00"),
            )
            session.add(oitem)
            await session.commit()
            order_item["v"] = str(oitem.id)
            order_item["order"] = str(order.id)

    asyncio.run(seed_order())
    res = client.post(
        "/api/v1/returns/admin?include_pii=true",
        headers=_auth(token),
        json={
            "order_id": order_item["order"],
            "reason": "damaged",
            "items": [{"order_item_id": order_item["v"], "quantity": 1}],
        },
    )
    assert res.status_code == 201, res.text


def test_customer_create_return(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]

    holder = {"order": None, "item": None}

    async def seed() -> None:
        from app.models.catalog import Category, Product, ProductStatus

        async with SessionLocal() as session:
            cust = User(
                email="selfcust@example.com",
                username="selfcust",
                hashed_password=security.hash_password("Password123"),
                name="Self",
                email_verified=True,
            )
            session.add(cust)
            await session.flush()
            cat = Category(slug="sc", name="SC", sort_order=1)
            session.add(cat)
            await session.flush()
            prod = Product(
                slug="sc-p",
                name="SC P",
                base_price=10,
                currency="RON",
                category_id=cat.id,
                stock_quantity=5,
                status=ProductStatus.published,
            )
            session.add(prod)
            await session.flush()
            order = Order(
                user_id=cust.id,
                status=OrderStatus.delivered,
                customer_email="selfcust@example.com",
                customer_name="Self",
                total_amount=Decimal("20.00"),
                reference_code="SC-1",
            )
            session.add(order)
            await session.flush()
            oitem = OrderItem(
                order_id=order.id,
                product_id=prod.id,
                quantity=2,
                unit_price=Decimal("10.00"),
                subtotal=Decimal("20.00"),
            )
            session.add(oitem)
            await session.commit()
            holder["order"] = str(order.id)
            holder["item"] = str(oitem.id)

    asyncio.run(seed())
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "selfcust@example.com", "password": "Password123"},
    )
    assert login.status_code == 200, login.text
    token = login.json()["tokens"]["access_token"]
    res = client.post(
        "/api/v1/returns",
        headers=_auth(token),
        json={
            "order_id": holder["order"],
            "reason": "broke",
            "items": [{"order_item_id": holder["item"], "quantity": 1}],
        },
    )
    assert res.status_code == 201, res.text


def test_admin_update_same_status_no_email(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    return_id, _order_id = asyncio.run(_seed_return(SessionLocal))
    # admin_note only -> status unchanged -> no status-update email (265->275).
    res = client.patch(
        f"/api/v1/returns/admin/{return_id}",
        headers=_auth(token),
        json={"admin_note": "internal"},
    )
    assert res.status_code == 200, res.text


# --------------------------------------------------------------------------- #
# label upload / download / delete                                            #
# --------------------------------------------------------------------------- #
def test_label_upload_download_delete_flow(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    return_id, _order_id = asyncio.run(_seed_return(SessionLocal))

    # Upload a PDF label.
    res = client.post(
        f"/api/v1/returns/admin/{return_id}/label",
        headers=_auth(token),
        files={"file": ("label.pdf", io.BytesIO(b"%PDF-1.4 data"), "application/pdf")},
    )
    assert res.status_code == 200, res.text
    assert res.json()["has_return_label"] is True

    # Re-upload (covers the old-label cleanup branch).
    res2 = client.post(
        f"/api/v1/returns/admin/{return_id}/label",
        headers=_auth(token),
        files={"file": ("label2.pdf", io.BytesIO(b"%PDF-1.4 v2"), "application/pdf")},
    )
    assert res2.status_code == 200, res2.text

    # Download it.
    dl = client.get(f"/api/v1/returns/admin/{return_id}/label", headers=_auth(token))
    assert dl.status_code == 200, dl.text
    assert dl.headers["Cache-Control"] == "no-store"

    # Delete it.
    delete = client.delete(
        f"/api/v1/returns/admin/{return_id}/label", headers=_auth(token)
    )
    assert delete.status_code == 204


def test_admin_update_with_pii_reveal(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    return_id, _order_id = asyncio.run(_seed_return(SessionLocal))
    res = client.patch(
        f"/api/v1/returns/admin/{return_id}?include_pii=true",
        headers=_auth(token),
        json={"status": "approved"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["customer_email"] == "retcust@example.com"


def test_label_upload_with_pii_reveal(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    return_id, _order_id = asyncio.run(_seed_return(SessionLocal))
    res = client.post(
        f"/api/v1/returns/admin/{return_id}/label?include_pii=true",
        headers=_auth(token),
        files={"file": ("l.pdf", io.BytesIO(b"%PDF-1.4 x"), "application/pdf")},
    )
    assert res.status_code == 200, res.text
    assert res.json()["customer_email"] == "retcust@example.com"


def test_admin_create_without_pii(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)

    holder = {"order": None, "item": None}

    async def seed() -> None:
        from app.models.catalog import Category, Product, ProductStatus

        async with SessionLocal() as session:
            cust = User(
                email="nopii@example.com",
                username="nopii",
                hashed_password=security.hash_password("Password123"),
                name="NoPII",
            )
            session.add(cust)
            await session.flush()
            cat = Category(slug="np", name="NP", sort_order=1)
            session.add(cat)
            await session.flush()
            prod = Product(
                slug="np-p",
                name="NP P",
                base_price=10,
                currency="RON",
                category_id=cat.id,
                stock_quantity=5,
                status=ProductStatus.published,
            )
            session.add(prod)
            await session.flush()
            order = Order(
                user_id=cust.id,
                status=OrderStatus.delivered,
                customer_email="nopii@example.com",
                customer_name="NoPII",
                total_amount=Decimal("20.00"),
                reference_code="NP-1",
            )
            session.add(order)
            await session.flush()
            oitem = OrderItem(
                order_id=order.id,
                product_id=prod.id,
                quantity=2,
                unit_price=Decimal("10.00"),
                subtotal=Decimal("20.00"),
            )
            session.add(oitem)
            await session.commit()
            holder["order"] = str(order.id)
            holder["item"] = str(oitem.id)

    asyncio.run(seed())
    res = client.post(
        "/api/v1/returns/admin",
        headers=_auth(token),
        json={
            "order_id": holder["order"],
            "reason": "damaged",
            "items": [{"order_item_id": holder["item"], "quantity": 1}],
        },
    )
    assert res.status_code == 201, res.text
    # No PII reveal -> masked email in the response.
    assert "*" in res.json()["customer_email"]


def test_label_upload_not_found(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    res = client.post(
        f"/api/v1/returns/admin/{uuid.uuid4()}/label",
        headers=_auth(token),
        files={"file": ("x.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    )
    assert res.status_code == 404


def test_label_download_not_found_record(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    res = client.get(
        f"/api/v1/returns/admin/{uuid.uuid4()}/label", headers=_auth(token)
    )
    assert res.status_code == 404


def test_label_download_no_label(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    return_id, _order_id = asyncio.run(_seed_return(SessionLocal))
    res = client.get(f"/api/v1/returns/admin/{return_id}/label", headers=_auth(token))
    assert res.status_code == 404  # no label uploaded yet


def test_label_delete_not_found_record(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    res = client.delete(
        f"/api/v1/returns/admin/{uuid.uuid4()}/label", headers=_auth(token)
    )
    assert res.status_code == 404


def test_label_delete_no_label(returns_app) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    return_id, _order_id = asyncio.run(_seed_return(SessionLocal))
    res = client.delete(
        f"/api/v1/returns/admin/{return_id}/label", headers=_auth(token)
    )
    assert res.status_code == 404


# --------------------------------------------------------------------------- #
# defensive guards (driven via mocks since they are unreachable with valid    #
# HTTP input: NOT-NULL customer_email, mid-request deletion races)            #
# --------------------------------------------------------------------------- #
def test_by_order_skips_missing_detail(returns_app, monkeypatch) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    _return_id, order_id = asyncio.run(_seed_return(SessionLocal))

    async def fake_detail(session, rid):  # noqa: ANN001
        return None  # detail vanished between list and fetch -> continue (202)

    monkeypatch.setattr(returns_api.returns_service, "get_return_request", fake_detail)
    res = client.get(f"/api/v1/returns/admin/by-order/{order_id}", headers=_auth(token))
    assert res.status_code == 200
    assert res.json() == []


def test_customer_create_skips_email_when_missing(returns_app, monkeypatch) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]

    # A verified customer is still required to pass the dependency.
    async def seed() -> str:
        async with SessionLocal() as session:
            cust = User(
                email="noemail@example.com",
                username="noemail",
                hashed_password=security.hash_password("Password123"),
                name="NE",
                email_verified=True,
            )
            session.add(cust)
            await session.commit()
        login = client.post(
            "/api/v1/auth/login",
            json={"email": "noemail@example.com", "password": "Password123"},
        )
        return login.json()["tokens"]["access_token"]

    token = asyncio.run(seed())

    from types import SimpleNamespace

    created = SimpleNamespace(
        id=uuid.uuid4(),
        order=SimpleNamespace(
            customer_email=None, reference_code="X", customer_name="N"
        ),
        user=None,
        items=[],
        status=ReturnRequestStatus.requested,
        order_id=uuid.uuid4(),
        created_at=__import__("datetime").datetime.now(),
        updated_at=__import__("datetime").datetime.now(),
        reason="r",
        customer_message=None,
        admin_note=None,
        return_label_path=None,
        return_label_filename=None,
        return_label_uploaded_at=None,
    )

    async def fake_create(session, *, payload, user):  # noqa: ANN001
        return created

    monkeypatch.setattr(
        returns_api.returns_service, "create_return_request_for_user", fake_create
    )
    res = client.post(
        "/api/v1/returns",
        headers=_auth(token),
        json={
            "order_id": str(uuid.uuid4()),
            "reason": "r",
            "items": [{"order_item_id": str(uuid.uuid4()), "quantity": 1}],
        },
    )
    # to_email is None -> the email task is skipped (104->110) and we still 201.
    assert res.status_code == 201, res.text


def test_admin_create_skips_email_when_missing(returns_app, monkeypatch) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    return_id, _order_id = asyncio.run(_seed_return(SessionLocal))

    from types import SimpleNamespace

    created = SimpleNamespace(
        id=uuid.UUID(return_id),
        order=SimpleNamespace(customer_email=None),
        user=None,
    )

    async def fake_create(session, *, payload, actor):  # noqa: ANN001
        return created  # order.customer_email is None -> email skipped (225->231)

    monkeypatch.setattr(
        returns_api.returns_service, "create_return_request", fake_create
    )
    res = client.post(
        "/api/v1/returns/admin",
        headers=_auth(token),
        json={
            "order_id": str(uuid.uuid4()),
            "reason": "r",
            "items": [{"order_item_id": str(uuid.uuid4()), "quantity": 1}],
        },
    )
    # No email sent; the endpoint re-fetches the real seeded record via admin_get.
    assert res.status_code == 201, res.text


def test_label_upload_refreshed_missing(returns_app, monkeypatch) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    return_id, _order_id = asyncio.run(_seed_return(SessionLocal))

    real_get = returns_api.returns_service.get_return_request
    calls = {"n": 0}

    async def flaky_get(session, rid):  # noqa: ANN001
        calls["n"] += 1
        if calls["n"] == 1:
            return await real_get(session, rid)  # pre-check finds the record
        return None  # refresh after save -> defensive 404 (328)

    monkeypatch.setattr(returns_api.returns_service, "get_return_request", flaky_get)
    res = client.post(
        f"/api/v1/returns/admin/{return_id}/label",
        headers=_auth(token),
        files={"file": ("l.pdf", io.BytesIO(b"%PDF-1.4 x"), "application/pdf")},
    )
    assert res.status_code == 404


def test_label_download_path_missing(returns_app, monkeypatch) -> None:
    SessionLocal = returns_app["session_factory"]  # type: ignore[assignment]
    client: TestClient = returns_app["client"]  # type: ignore[assignment]
    token = _admin_token(client, SessionLocal)
    return_id, _order_id = asyncio.run(_seed_return(SessionLocal))

    # Upload then delete the file on disk so resolve_private_path().exists() is False.
    client.post(
        f"/api/v1/returns/admin/{return_id}/label",
        headers=_auth(token),
        files={"file": ("l.pdf", io.BytesIO(b"%PDF-1.4 x"), "application/pdf")},
    )

    real_resolve = returns_api.private_storage.resolve_private_path

    def fake_resolve(rel, *, root=None):  # noqa: ANN001
        p = real_resolve(rel, root=root)
        # Point at a path that does not exist to hit the missing-file 404 (354).
        return p.with_name("gone-" + p.name)

    monkeypatch.setattr(
        returns_api.private_storage, "resolve_private_path", fake_resolve
    )
    res = client.get(f"/api/v1/returns/admin/{return_id}/label", headers=_auth(token))
    assert res.status_code == 404
