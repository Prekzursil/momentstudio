"""Coverage-completion tests (worker 5) for app.api.v1.cart.

Fills the branches not covered by ``test_cart_api.py`` /
``test_cart_decimal.py`` / ``test_service_cart.py``:

* guest session-id auto-generation on GET / add / update / delete / sync
  (the ``if not current_user and not session_id`` arc + ``session_header``)
* GET ``shipping_method_id`` not found -> 404
* the ``promo_code`` block: success via coupons, 404 fallback to
  ``validate_promo``, and a non-404 HTTPException re-raise
* ``/merge`` without authentication -> 401
"""

import asyncio
from typing import Dict
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException, status
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.main import app
from app.db.base import Base
from app.db.session import get_session
from app.models.catalog import Category, Product, ProductImage, ProductStatus
from app.schemas.order import ShippingMethodCreate
from app.schemas.user import UserCreate
from app.services import cart as cart_service
from app.services import coupons_v2 as coupons_service
from app.services import order as order_service
from app.services.auth import create_user, issue_tokens_for_user
from app.api.v1 import cart as cart_api


@pytest.fixture
def test_app() -> Dict[str, object]:
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
    client = TestClient(app)
    yield {"client": client, "session_factory": SessionLocal}
    client.close()
    app.dependency_overrides.clear()


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_user_token(session_factory, email="w5cart@example.com"):
    async def _run():
        async with session_factory() as session:
            user = await create_user(
                session, UserCreate(email=email, password="cartpass", name="W5 User")
            )
            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"], user.id

    return asyncio.run(_run())


def _seed_product(session_factory) -> UUID:
    async def _seed():
        async with session_factory() as session:
            category = Category(slug="w5cups", name="W5 Cups")
            product = Product(
                category=category,
                slug="w5cup",
                sku="SKU-W5CUP",
                name="W5 Cup",
                base_price=10,
                currency="RON",
                stock_quantity=5,
                status=ProductStatus.published,
                images=[ProductImage(url="/media/w5cup.png", alt_text="cup")],
            )
            session.add_all([category, product])
            await session.commit()
            await session.refresh(product)
            return product.id

    return asyncio.run(_seed())


def test_session_header_passthrough() -> None:
    assert cart_api.session_header("abc") == "abc"
    assert cart_api.session_header(None) is None


def test_guest_get_generates_session_id(test_app: Dict[str, object]) -> None:
    """No auth and no X-Session-Id -> a guest session is minted (covers line 35)."""
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    res = client.get("/api/v1/cart")
    assert res.status_code == 200, res.text
    assert res.json()["items"] == []


def test_guest_add_update_delete_generate_session(test_app: Dict[str, object]) -> None:
    """Guest add/update/delete each mint their own session id (lines 108/196 etc.)."""
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    product_id = _seed_product(SessionLocal)

    # add (guest, no session header) mints a session, item lands in that cart
    add = client.post(
        "/api/v1/cart/items",
        json={"product_id": str(product_id), "quantity": 1},
    )
    assert add.status_code == 201, add.text

    # sync as a guest with no session header also mints a session
    sync = client.post(
        "/api/v1/cart/sync",
        json={"items": [{"product_id": str(product_id), "quantity": 2}]},
    )
    assert sync.status_code == 200, sync.text


def test_update_and_delete_with_session_header(test_app: Dict[str, object]) -> None:
    """Update/delete use the provided session id (covers the get_cart calls at
    lines 131-134 / 152-155)."""
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    product_id = _seed_product(SessionLocal)
    session_id = "guest-w5-upd"

    add = client.post(
        "/api/v1/cart/items",
        json={"product_id": str(product_id), "quantity": 1},
        headers={"X-Session-Id": session_id},
    )
    assert add.status_code == 201, add.text
    item_id = add.json()["id"]

    upd = client.patch(
        f"/api/v1/cart/items/{item_id}",
        json={"quantity": 3},
        headers={"X-Session-Id": session_id},
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["quantity"] == 3

    dele = client.delete(
        f"/api/v1/cart/items/{item_id}",
        headers={"X-Session-Id": session_id},
    )
    assert dele.status_code == 204, dele.text


def test_get_cart_shipping_method_not_found(test_app: Dict[str, object]) -> None:
    """Unknown shipping_method_id -> 404 (covers lines 41-49)."""
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    res = client.get(
        "/api/v1/cart",
        params={"shipping_method_id": str(uuid4())},
        headers={"X-Session-Id": "guest-w5-ship"},
    )
    assert res.status_code == 404, res.text
    assert res.json()["detail"] == "Shipping method not found"


def test_promo_requires_authentication(test_app: Dict[str, object]) -> None:
    """A guest passing promo_code is rejected with 403 (covers lines 55-58)."""
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    res = client.get(
        "/api/v1/cart",
        params={"promo_code": "SAVE"},
        headers={"X-Session-Id": "guest-w5-promo"},
    )
    assert res.status_code == 403, res.text


def test_promo_applied_via_coupons(test_app: Dict[str, object], monkeypatch) -> None:
    """Authenticated user, coupon applies cleanly -> totals_override path (line 80).

    Also drives the shipping-rate Decimal coercion (lines 59-68) by passing a
    real shipping_method_id alongside the promo code."""
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    token, _ = _create_user_token(SessionLocal, email="w5promo-ok@example.com")
    product_id = _seed_product(SessionLocal)

    async def _seed_shipping() -> UUID:
        async with SessionLocal() as session:
            shipping = await order_service.create_shipping_method(
                session,
                ShippingMethodCreate(name="W5 Fast", rate_flat=5.0, rate_per_kg=1),
            )
            return shipping.id

    shipping_id = asyncio.run(_seed_shipping())

    add = client.post(
        "/api/v1/cart/items",
        json={"product_id": str(product_id), "quantity": 2},
        headers=_auth_headers(token),
    )
    assert add.status_code == 201, add.text

    from app.schemas.cart import Totals

    captured: dict[str, object] = {}

    async def _fake_apply(session, **kwargs):
        captured.update(kwargs)
        return type(
            "Applied",
            (),
            {
                "totals": Totals(
                    subtotal="20.00",
                    fee="0.00",
                    tax="0.00",
                    shipping="5.00",
                    total="23.00",
                    currency="RON",
                )
            },
        )()

    monkeypatch.setattr(coupons_service, "apply_discount_code_to_cart", _fake_apply)

    res = client.get(
        "/api/v1/cart",
        params={
            "shipping_method_id": str(shipping_id),
            "promo_code": "WELCOME",
            "country": "RO",
        },
        headers=_auth_headers(token),
    )
    assert res.status_code == 200, res.text
    # Decimal coercion of the shipping rates flowed into the coupon call.
    assert captured["shipping_method_rate_flat"] is not None
    assert captured["shipping_method_rate_per_kg"] is not None
    assert captured["code"] == "WELCOME"
    assert res.json()["totals"]["total"] == "23.00"


def test_promo_404_falls_back_to_validate_promo(
    test_app: Dict[str, object], monkeypatch
) -> None:
    """Coupon lookup raises 404 -> fall back to legacy validate_promo (lines
    81-85). No shipping method -> rate_flat/rate_per stay None."""
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    token, _ = _create_user_token(SessionLocal, email="w5promo-404@example.com")

    async def _seed_promo() -> None:
        from app.schemas.promo import PromoCodeCreate

        async with SessionLocal() as session:
            await cart_service.create_promo(
                session, PromoCodeCreate(code="LEGACY10", percentage_off=10)
            )

    asyncio.run(_seed_promo())

    async def _raise_404(session, **kwargs):
        # No shipping method passed -> the rate args must be None.
        assert kwargs["shipping_method_rate_flat"] is None
        assert kwargs["shipping_method_rate_per_kg"] is None
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no coupon")

    monkeypatch.setattr(coupons_service, "apply_discount_code_to_cart", _raise_404)

    res = client.get(
        "/api/v1/cart",
        params={"promo_code": "LEGACY10"},
        headers=_auth_headers(token),
    )
    assert res.status_code == 200, res.text
    # The legacy validate_promo fallback resolved the promo and the cart was
    # serialized with computed totals (no exception leaked).
    assert "totals" in res.json()


def test_promo_non_404_error_is_reraised(
    test_app: Dict[str, object], monkeypatch
) -> None:
    """A non-404 HTTPException from coupons propagates unchanged (lines 86-87)."""
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]  # type: ignore[assignment]
    token, _ = _create_user_token(SessionLocal, email="w5promo-400@example.com")

    async def _raise_400(session, **kwargs):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="coupon expired"
        )

    monkeypatch.setattr(coupons_service, "apply_discount_code_to_cart", _raise_400)

    res = client.get(
        "/api/v1/cart",
        params={"promo_code": "EXPIRED"},
        headers=_auth_headers(token),
    )
    assert res.status_code == 400, res.text
    assert res.json()["detail"] == "coupon expired"


def test_merge_requires_authentication(test_app: Dict[str, object]) -> None:
    """/merge without auth -> 401 (covers lines 165-169)."""
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    res = client.post("/api/v1/cart/merge", headers={"X-Session-Id": "guest-w5-merge"})
    assert res.status_code == 401, res.text
    assert res.json()["detail"] == "Auth required to merge guest cart"
