"""Lean-gate coverage for branches in ``app.api.v1.catalog`` that the broader
``test_catalog_api.py`` happy-path suite does not reach.

This file is intentionally *disjoint* from ``test_catalog_api.py``: it targets
the audit (``source=storefront``) branches, the 404/permission/validation error
paths, and the small edge branches the main flow test skips. Harness helpers are
duplicated locally (not added to the shared ``conftest.py``) so the file is
self-contained and does not collide with other coverage workers rebasing onto
the same branch.
"""

from __future__ import annotations

import asyncio
import io
from typing import Dict

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import security
from app.db.base import Base
from app.db.session import get_session
from app.main import app
from app.models.passkeys import UserPasskey
from app.models.user import UserRole
from app.schemas.user import UserCreate
from app.services.auth import create_user


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
    try:
        yield {"client": client, "session_factory": SessionLocal}
    finally:
        client.close()
        app.dependency_overrides.clear()


def auth_headers(token: str) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    payload = security.decode_token(token)
    if payload and payload.get("sub"):
        headers["X-Admin-Step-Up"] = security.create_step_up_token(str(payload["sub"]))
    return headers


def create_admin_token(session_factory, email: str = "gapadmin@example.com") -> str:
    async def _make() -> str:
        async with session_factory() as session:
            user = await create_user(
                session, UserCreate(email=email, password="adminpass", name="GapAdmin")
            )
            user.role = UserRole.admin
            session.add(
                UserPasskey(
                    user_id=user.id,
                    name="Test Passkey",
                    credential_id=f"cred-{user.id}",
                    public_key=b"test",
                    sign_count=0,
                    backed_up=False,
                )
            )
            await session.commit()
            from app.services.auth import issue_tokens_for_user

            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"]

    return asyncio.run(_make())


def create_user_token(
    session_factory, email: str = "gapuser@example.com"
) -> tuple[str, str]:
    async def _make() -> tuple[str, str]:
        async with session_factory() as session:
            user = await create_user(
                session, UserCreate(email=email, password="password123", name="GapUser")
            )
            await session.commit()
            from app.services.auth import issue_tokens_for_user

            tokens = await issue_tokens_for_user(session, user)
            return tokens["access_token"], str(user.id)

    return asyncio.run(_make())


def _png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (2, 2), color=(0, 128, 255)).save(buf, format="PNG")
    return buf.getvalue()


def _create_category(client: TestClient, headers: dict, name: str) -> dict:
    res = client.post(
        "/api/v1/catalog/categories", json={"name": name}, headers=headers
    )
    assert res.status_code == 201, res.text
    return res.json()


def _create_product(
    client: TestClient, headers: dict, category_id: str, slug: str, **extra
) -> dict:
    body = {
        "category_id": category_id,
        "slug": slug,
        "name": slug.replace("-", " ").title(),
        "base_price": 10.0,
        "currency": "RON",
        "stock_quantity": 5,
    }
    body.update(extra)
    res = client.post("/api/v1/catalog/products", json=body, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


# ---------------------------------------------------------------------------
# Category management: audit (source=storefront) branches + 404/error paths
# ---------------------------------------------------------------------------


def test_category_audit_and_error_paths(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]
    admin = auth_headers(create_admin_token(SessionLocal))

    # create with source=storefront -> audit branch
    res = client.post(
        "/api/v1/catalog/categories?source=storefront",
        json={"name": "Mugs"},
        headers=admin,
    )
    assert res.status_code == 201, res.text
    slug = res.json()["slug"]

    # update with source -> audit branch
    res = client.patch(
        f"/api/v1/catalog/categories/{slug}?source=storefront",
        json={"name": "Mugs Renamed"},
        headers=admin,
    )
    assert res.status_code == 200, res.text
    # update 404
    res = client.patch(
        "/api/v1/catalog/categories/nope?source=storefront",
        json={"name": "X"},
        headers=admin,
    )
    assert res.status_code == 404

    # translations: list, upsert (+audit), delete (+audit), and their 404s
    res = client.get(
        f"/api/v1/catalog/categories/{slug}/translations", headers=admin
    )
    assert res.status_code == 200
    res = client.get(
        "/api/v1/catalog/categories/nope/translations", headers=admin
    )
    assert res.status_code == 404

    res = client.put(
        f"/api/v1/catalog/categories/{slug}/translations/ro?source=storefront",
        json={"name": "Cani"},
        headers=admin,
    )
    assert res.status_code == 200, res.text
    res = client.put(
        "/api/v1/catalog/categories/nope/translations/ro?source=storefront",
        json={"name": "Cani"},
        headers=admin,
    )
    assert res.status_code == 404

    res = client.delete(
        f"/api/v1/catalog/categories/{slug}/translations/ro?source=storefront",
        headers=admin,
    )
    assert res.status_code == 204, res.text
    res = client.delete(
        "/api/v1/catalog/categories/nope/translations/ro?source=storefront",
        headers=admin,
    )
    assert res.status_code == 404

    # reorder with source -> audit branch
    res = client.post(
        "/api/v1/catalog/categories/reorder?source=storefront",
        json=[{"slug": slug, "sort_order": 3}],
        headers=admin,
    )
    assert res.status_code == 200, res.text

    # delete with source -> audit branch
    res = client.delete(
        f"/api/v1/catalog/categories/{slug}?source=storefront", headers=admin
    )
    assert res.status_code == 200, res.text
    # delete 404
    res = client.delete(
        "/api/v1/catalog/categories/nope?source=storefront", headers=admin
    )
    assert res.status_code == 404


def test_category_image_upload_and_previews(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]
    admin = auth_headers(create_admin_token(SessionLocal))

    parent = _create_category(client, admin, "Parent")
    child_res = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Child", "parent_id": parent["id"]},
        headers=admin,
    )
    assert child_res.status_code == 201, child_res.text

    # image upload (thumbnail) with source -> audit + storefront upload branch
    res = client.post(
        f"/api/v1/catalog/categories/{parent['slug']}/images/thumbnail?source=storefront",
        files={"file": ("t.png", _png_bytes(), "image/png")},
        headers=admin,
    )
    assert res.status_code == 200, res.text
    # banner upload, no source (skips audit branch); also re-upload replaces existing
    res = client.post(
        f"/api/v1/catalog/categories/{parent['slug']}/images/banner",
        files={"file": ("b.png", _png_bytes(), "image/png")},
        headers=admin,
    )
    assert res.status_code == 200, res.text
    # re-upload thumbnail to exercise the "previous /media/ delete" branch
    res = client.post(
        f"/api/v1/catalog/categories/{parent['slug']}/images/thumbnail",
        files={"file": ("t2.png", _png_bytes(), "image/png")},
        headers=admin,
    )
    assert res.status_code == 200, res.text
    # image upload 404
    res = client.post(
        "/api/v1/catalog/categories/nope/images/thumbnail",
        files={"file": ("t.png", _png_bytes(), "image/png")},
        headers=admin,
    )
    assert res.status_code == 404

    # delete preview: empty category -> can_delete True
    res = client.get(
        f"/api/v1/catalog/categories/{parent['slug']}/delete/preview", headers=admin
    )
    assert res.status_code == 200, res.text
    body = res.json()
    # parent has a child -> can_delete False
    assert body["can_delete"] is False
    assert body["child_count"] == 1
    # delete preview 404
    res = client.get(
        "/api/v1/catalog/categories/nope/delete/preview", headers=admin
    )
    assert res.status_code == 404


def test_category_merge_paths(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]
    admin = auth_headers(create_admin_token(SessionLocal))

    a = _create_category(client, admin, "Alpha")
    b = _create_category(client, admin, "Beta")
    _create_product(client, admin, a["id"], "prod-a")

    # merge preview: source not found
    res = client.get(
        f"/api/v1/catalog/categories/nope/merge/preview?target_slug={b['slug']}",
        headers=admin,
    )
    assert res.status_code == 404
    # merge preview: target not found
    res = client.get(
        f"/api/v1/catalog/categories/{a['slug']}/merge/preview?target_slug=nope",
        headers=admin,
    )
    assert res.status_code == 404
    # merge preview: same category -> reason same_category
    res = client.get(
        f"/api/v1/catalog/categories/{a['slug']}/merge/preview?target_slug={a['slug']}",
        headers=admin,
    )
    assert res.status_code == 200
    assert res.json()["reason"] == "same_category"
    # merge preview: valid (different categories, same None parent) -> can_merge True
    res = client.get(
        f"/api/v1/catalog/categories/{a['slug']}/merge/preview?target_slug={b['slug']}",
        headers=admin,
    )
    assert res.status_code == 200, res.text
    assert res.json()["can_merge"] is True

    # merge preview: different parent -> reason different_parent
    child_res = client.post(
        "/api/v1/catalog/categories",
        json={"name": "BetaChild", "parent_id": b["id"]},
        headers=admin,
    )
    child = child_res.json()
    res = client.get(
        f"/api/v1/catalog/categories/{child['slug']}/merge/preview?target_slug={a['slug']}",
        headers=admin,
    )
    assert res.status_code == 200
    assert res.json()["reason"] == "different_parent"

    # merge preview: source has children -> reason source_has_children
    res = client.get(
        f"/api/v1/catalog/categories/{b['slug']}/merge/preview?target_slug={a['slug']}",
        headers=admin,
    )
    assert res.status_code == 200
    assert res.json()["reason"] == "source_has_children"

    # actual merge error paths
    res = client.post(
        "/api/v1/catalog/categories/nope/merge",
        json={"target_slug": b["slug"]},
        headers=admin,
    )
    assert res.status_code == 404
    res = client.post(
        f"/api/v1/catalog/categories/{a['slug']}/merge",
        json={"target_slug": "nope"},
        headers=admin,
    )
    assert res.status_code == 404
    res = client.post(
        f"/api/v1/catalog/categories/{a['slug']}/merge",
        json={"target_slug": a["slug"]},
        headers=admin,
    )
    assert res.status_code == 400
    res = client.post(
        f"/api/v1/catalog/categories/{child['slug']}/merge",
        json={"target_slug": a["slug"]},
        headers=admin,
    )
    assert res.status_code == 400  # different parent
    res = client.post(
        f"/api/v1/catalog/categories/{b['slug']}/merge",
        json={"target_slug": a["slug"]},
        headers=admin,
    )
    assert res.status_code == 400  # source has children

    # successful merge with audit source -> moves the product from Alpha into Beta
    res = client.post(
        f"/api/v1/catalog/categories/{a['slug']}/merge?source=storefront",
        json={"target_slug": b["slug"]},
        headers=admin,
    )
    assert res.status_code == 200, res.text
    assert res.json()["moved_products"] == 1


def test_category_csv_import_errors(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]
    admin = auth_headers(create_admin_token(SessionLocal))

    # non-csv filename -> 400
    res = client.post(
        "/api/v1/catalog/categories/import",
        files={"file": ("data.txt", b"name,slug\n", "text/plain")},
        headers=admin,
    )
    assert res.status_code == 400

    # invalid UTF-8 bytes in a .csv -> decode 400
    res = client.post(
        "/api/v1/catalog/categories/import",
        files={"file": ("data.csv", b"\xff\xfe\x00bad", "text/csv")},
        headers=admin,
    )
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# Public listing / lang / sale branches
# ---------------------------------------------------------------------------


def test_public_listing_lang_and_sale_branches(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]
    admin_token = create_admin_token(SessionLocal)
    admin = auth_headers(admin_token)

    cat = _create_category(client, admin, "Lighting")
    _create_product(
        client, admin, cat["id"], "lamp", status="published", base_price=20.0
    )

    # categories with lang + staff include_hidden -> translation + staff branch
    res = client.get(
        "/api/v1/catalog/categories?lang=ro&include_hidden=true", headers=admin
    )
    assert res.status_code == 200, res.text

    # products list with lang -> translation branch + price bounds
    res = client.get("/api/v1/catalog/products?lang=ro")
    assert res.status_code == 200, res.text

    # price-bounds with category_slug=sale alias branch
    res = client.get("/api/v1/catalog/products/price-bounds?category_slug=sale")
    assert res.status_code == 200, res.text

    # list products with category_slug=sale alias branch
    res = client.get("/api/v1/catalog/products?category_slug=sale")
    assert res.status_code == 200, res.text

    # product feed (json) + feed.csv with lang
    assert client.get("/api/v1/catalog/products/feed?lang=ro").status_code == 200
    assert client.get("/api/v1/catalog/products/feed.csv?lang=ro").status_code == 200

    # get single product with lang (translation loader branches)
    res = client.get("/api/v1/catalog/products/lamp?lang=ro")
    assert res.status_code == 200, res.text

    # recently-viewed with lang
    res = client.get("/api/v1/catalog/products/recently-viewed?lang=ro")
    assert res.status_code == 200, res.text

    # featured collections with lang
    res = client.get("/api/v1/catalog/collections/featured?lang=ro")
    assert res.status_code == 200, res.text


def test_csv_import_too_large(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]
    admin = auth_headers(create_admin_token(SessionLocal))

    # Exceed the CSV import size guard (_read_upload_csv_bytes -> 400 too large).
    from app.api.v1 import catalog as catalog_api

    oversized = b"a" * (catalog_api._CSV_IMPORT_MAX_BYTES + 10)
    res = client.post(
        "/api/v1/catalog/products/import",
        files={"file": ("big.csv", oversized, "text/csv")},
        headers=admin,
    )
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# Product endpoints: 404 (product-not-found) paths across the admin surface
# ---------------------------------------------------------------------------


def test_product_not_found_paths(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]
    admin = auth_headers(create_admin_token(SessionLocal))
    user_token, _ = create_user_token(SessionLocal)
    user = {"Authorization": f"Bearer {user_token}"}
    missing = "no-such-product"
    image_id = "00000000-0000-0000-0000-000000000001"

    # admin (require_admin_section) product-not-found endpoints
    assert client.patch(
        f"/api/v1/catalog/products/{missing}", json={"name": "x"}, headers=admin
    ).status_code == 404
    assert client.get(
        f"/api/v1/catalog/products/{missing}/translations", headers=admin
    ).status_code == 404
    assert client.put(
        f"/api/v1/catalog/products/{missing}/translations/ro",
        json={"name": "x"},
        headers=admin,
    ).status_code == 404
    assert client.delete(
        f"/api/v1/catalog/products/{missing}/translations/ro", headers=admin
    ).status_code == 404
    assert client.get(
        f"/api/v1/catalog/products/{missing}/relationships", headers=admin
    ).status_code == 404
    assert client.put(
        f"/api/v1/catalog/products/{missing}/relationships",
        json={"related_product_ids": [], "upsell_product_ids": []},
        headers=admin,
    ).status_code == 404
    assert client.get(
        f"/api/v1/catalog/products/{missing}/audit", headers=admin
    ).status_code == 404
    assert client.delete(
        f"/api/v1/catalog/products/{missing}", headers=admin
    ).status_code == 404
    assert client.post(
        f"/api/v1/catalog/products/{missing}/images",
        files={"file": ("t.png", _png_bytes(), "image/png")},
        headers=admin,
    ).status_code == 404
    assert client.put(
        f"/api/v1/catalog/products/{missing}/variants",
        json={"variants": [], "delete_variant_ids": []},
        headers=admin,
    ).status_code == 404
    assert client.post(
        f"/api/v1/catalog/products/{missing}/duplicate", headers=admin
    ).status_code == 404
    assert client.delete(
        f"/api/v1/catalog/products/{missing}/images/{image_id}", headers=admin
    ).status_code == 404
    assert client.patch(
        f"/api/v1/catalog/products/{missing}/images/{image_id}/sort?sort_order=1",
        headers=admin,
    ).status_code == 404
    assert client.get(
        f"/api/v1/catalog/products/{missing}/images/deleted", headers=admin
    ).status_code == 404
    assert client.post(
        f"/api/v1/catalog/products/{missing}/images/{image_id}/restore", headers=admin
    ).status_code == 404
    assert client.get(
        f"/api/v1/catalog/products/{missing}/images/{image_id}/translations",
        headers=admin,
    ).status_code == 404
    assert client.put(
        f"/api/v1/catalog/products/{missing}/images/{image_id}/translations/ro",
        json={"alt_text": "x"},
        headers=admin,
    ).status_code == 404
    assert client.delete(
        f"/api/v1/catalog/products/{missing}/images/{image_id}/translations/ro",
        headers=admin,
    ).status_code == 404
    assert client.get(
        f"/api/v1/catalog/products/{missing}/images/{image_id}/stats", headers=admin
    ).status_code == 404
    assert client.post(
        f"/api/v1/catalog/products/{missing}/images/{image_id}/reprocess",
        headers=admin,
    ).status_code == 404
    assert client.post(
        f"/api/v1/catalog/products/{missing}/reviews/{image_id}/approve",
        headers=admin,
    ).status_code == 404

    # optional-auth / profile-gated product-not-found endpoints
    assert client.get(f"/api/v1/catalog/products/{missing}").status_code == 404
    assert client.get(
        f"/api/v1/catalog/products/{missing}/back-in-stock", headers=user
    ).status_code == 404
    assert client.post(
        f"/api/v1/catalog/products/{missing}/back-in-stock", headers=user
    ).status_code == 404
    assert client.delete(
        f"/api/v1/catalog/products/{missing}/back-in-stock", headers=user
    ).status_code == 404
    assert client.post(
        f"/api/v1/catalog/products/{missing}/reviews",
        json={"author_name": "A", "rating": 5},
    ).status_code == 404
    assert client.get(
        f"/api/v1/catalog/products/{missing}/related"
    ).status_code == 404
    assert client.get(
        f"/api/v1/catalog/products/{missing}/upsells"
    ).status_code == 404


# ---------------------------------------------------------------------------
# Product image endpoints: image-not-found 404 paths on a real product
# ---------------------------------------------------------------------------


def test_product_image_not_found_paths(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]
    admin = auth_headers(create_admin_token(SessionLocal))
    cat = _create_category(client, admin, "ImgCat")
    _create_product(client, admin, cat["id"], "img-prod", status="published")
    bad_image = "00000000-0000-0000-0000-0000000000aa"

    assert client.get(
        f"/api/v1/catalog/products/img-prod/images/{bad_image}/translations",
        headers=admin,
    ).status_code == 404
    assert client.put(
        f"/api/v1/catalog/products/img-prod/images/{bad_image}/translations/ro",
        json={"alt_text": "x"},
        headers=admin,
    ).status_code == 404
    assert client.delete(
        f"/api/v1/catalog/products/img-prod/images/{bad_image}/translations/ro",
        headers=admin,
    ).status_code == 404
    assert client.get(
        f"/api/v1/catalog/products/img-prod/images/{bad_image}/stats", headers=admin
    ).status_code == 404
    assert client.post(
        f"/api/v1/catalog/products/img-prod/images/{bad_image}/reprocess",
        headers=admin,
    ).status_code == 404


# ---------------------------------------------------------------------------
# Audit endpoint: valid JSON payload, invalid JSON payload, and joined email
# ---------------------------------------------------------------------------


def test_product_audit_listing_payload_variants(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]
    admin_token = create_admin_token(SessionLocal)
    admin = auth_headers(admin_token)
    cat = _create_category(client, admin, "AuditCat")
    product = _create_product(client, admin, cat["id"], "audit-prod")

    async def _seed_audit() -> None:
        from uuid import UUID

        from app.models.catalog import ProductAuditLog

        product_uuid = UUID(product["id"])
        async with SessionLocal() as session:
            session.add(
                ProductAuditLog(
                    product_id=product_uuid,
                    user_id=None,
                    action="catalog.product.update",
                    payload='{"changed": ["name"]}',
                )
            )
            session.add(
                ProductAuditLog(
                    product_id=product_uuid,
                    user_id=None,
                    action="catalog.product.note",
                    payload="not-json{",  # triggers JSONDecodeError -> raw fallback
                )
            )
            await session.commit()

    asyncio.run(_seed_audit())

    res = client.get("/api/v1/catalog/products/audit-prod/audit", headers=admin)
    assert res.status_code == 200, res.text
    entries = res.json()
    actions = {e["action"] for e in entries}
    assert "catalog.product.update" in actions
    raw_entry = next(e for e in entries if e["action"] == "catalog.product.note")
    assert raw_entry["payload"] == {"raw": "not-json{"}


# ---------------------------------------------------------------------------
# Public visibility 404s: an unpublished product is hidden from anonymous users
# ---------------------------------------------------------------------------


def test_unpublished_product_hidden_from_public(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]
    admin = auth_headers(create_admin_token(SessionLocal))
    user_token, _ = create_user_token(SessionLocal)
    user = {"Authorization": f"Bearer {user_token}"}
    cat = _create_category(client, admin, "DraftCat")
    _create_product(client, admin, cat["id"], "draft-prod", status="draft")

    # Anonymous / customer cannot see a draft product -> 404 (visibility branch).
    assert client.get("/api/v1/catalog/products/draft-prod").status_code == 404
    assert client.get(
        "/api/v1/catalog/products/draft-prod/back-in-stock", headers=user
    ).status_code == 404
    assert client.post(
        "/api/v1/catalog/products/draft-prod/back-in-stock", headers=user
    ).status_code == 404
    assert client.delete(
        "/api/v1/catalog/products/draft-prod/back-in-stock", headers=user
    ).status_code == 404
    assert client.post(
        "/api/v1/catalog/products/draft-prod/reviews",
        json={"author_name": "A", "rating": 5},
    ).status_code == 404
    assert client.get(
        "/api/v1/catalog/products/draft-prod/related"
    ).status_code == 404
    assert client.get(
        "/api/v1/catalog/products/draft-prod/upsells"
    ).status_code == 404

    # Admin CAN see the draft product (is_admin branch true).
    assert client.get(
        "/api/v1/catalog/products/draft-prod", headers=admin
    ).status_code == 200


# ---------------------------------------------------------------------------
# Related / upsell listings with real data (sale-inactive + lang branches)
# ---------------------------------------------------------------------------


def test_related_and_upsell_with_data(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]
    admin = auth_headers(create_admin_token(SessionLocal))
    cat = _create_category(client, admin, "RelCat")
    base = _create_product(client, admin, cat["id"], "rel-base", status="published")
    sibling = _create_product(
        client, admin, cat["id"], "rel-sibling", status="published"
    )
    upsell = _create_product(
        client, admin, cat["id"], "rel-upsell", status="published"
    )

    # Configure distinct related + upsell relationships (overlapping ids are
    # de-duplicated server-side in favour of "related", so use separate products).
    res = client.put(
        "/api/v1/catalog/products/rel-base/relationships",
        json={
            "related_product_ids": [sibling["id"]],
            "upsell_product_ids": [upsell["id"]],
        },
        headers=admin,
    )
    assert res.status_code == 200, res.text

    # related: curated relationship products + lang + sale-inactive branch.
    res = client.get("/api/v1/catalog/products/rel-base/related?lang=ro")
    assert res.status_code == 200, res.text
    assert any(p["slug"] == "rel-sibling" for p in res.json())

    # upsell: curated upsell products + lang + sale-inactive branch.
    res = client.get("/api/v1/catalog/products/rel-base/upsells?lang=ro")
    assert res.status_code == 200, res.text
    assert any(p["slug"] == "rel-upsell" for p in res.json())

    # related fallback (no curated relationships) -> category-based siblings.
    res = client.get("/api/v1/catalog/products/rel-sibling/related")
    assert res.status_code == 200, res.text


# ---------------------------------------------------------------------------
# Featured collections with a product + collection-not-found
# ---------------------------------------------------------------------------


def test_featured_collection_with_product_and_404(
    test_app: Dict[str, object]
) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]
    admin = auth_headers(create_admin_token(SessionLocal))
    cat = _create_category(client, admin, "CollCat")
    product = _create_product(
        client, admin, cat["id"], "coll-prod", status="published"
    )

    res = client.post(
        "/api/v1/catalog/collections/featured",
        json={"name": "Highlights", "product_ids": [product["id"]]},
        headers=admin,
    )
    assert res.status_code == 201, res.text
    slug = res.json()["slug"]

    # list with lang -> exercises the per-product translation + sale branch.
    res = client.get("/api/v1/catalog/collections/featured?lang=ro")
    assert res.status_code == 200, res.text
    assert any(c["slug"] == slug for c in res.json())

    # update existing collection (success) + update missing (404).
    res = client.patch(
        f"/api/v1/catalog/collections/featured/{slug}",
        json={"name": "Highlights 2"},
        headers=admin,
    )
    assert res.status_code == 200, res.text
    res = client.patch(
        "/api/v1/catalog/collections/featured/nope",
        json={"name": "X"},
        headers=admin,
    )
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Recently-viewed with a recorded view (sale-inactive branch on a real item)
# ---------------------------------------------------------------------------


def test_recently_viewed_with_recorded_view(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]
    admin = auth_headers(create_admin_token(SessionLocal))
    cat = _create_category(client, admin, "RvCat")
    _create_product(client, admin, cat["id"], "rv-prod", status="published")

    sid = "guest-session-xyz"
    # Viewing a published product records it for the session.
    assert (
        client.get(f"/api/v1/catalog/products/rv-prod?session_id={sid}").status_code
        == 200
    )
    # Recently-viewed now returns it -> exercises the loop + sale-inactive branch.
    res = client.get(
        f"/api/v1/catalog/products/recently-viewed?session_id={sid}&lang=ro"
    )
    assert res.status_code == 200, res.text
    assert any(p["slug"] == "rv-prod" for p in res.json())


# ---------------------------------------------------------------------------
# Product image lifecycle success bodies (delete / sort / restore / translations)
# ---------------------------------------------------------------------------


def test_product_image_lifecycle_success(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]
    admin = auth_headers(create_admin_token(SessionLocal))
    cat = _create_category(client, admin, "ImgLifeCat")
    _create_product(client, admin, cat["id"], "imglife", status="published")

    # Upload a real image so we have an image_id to operate on.
    res = client.post(
        "/api/v1/catalog/products/imglife/images",
        files={"file": ("p.png", _png_bytes(), "image/png")},
        headers=admin,
    )
    assert res.status_code == 200, res.text
    images = res.json()["images"]
    assert images, res.text
    image_id = images[0]["id"]

    # sort (success body + audit source branch)
    res = client.patch(
        f"/api/v1/catalog/products/imglife/images/{image_id}/sort?sort_order=2&source=storefront",
        headers=admin,
    )
    assert res.status_code == 200, res.text

    # image translation upsert (success) + list + stats + reprocess
    res = client.put(
        f"/api/v1/catalog/products/imglife/images/{image_id}/translations/ro?source=storefront",
        json={"alt_text": "Imagine", "caption": "Subtitlu"},
        headers=admin,
    )
    assert res.status_code == 200, res.text
    assert (
        client.get(
            f"/api/v1/catalog/products/imglife/images/{image_id}/translations",
            headers=admin,
        ).status_code
        == 200
    )
    assert (
        client.get(
            f"/api/v1/catalog/products/imglife/images/{image_id}/stats", headers=admin
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/v1/catalog/products/imglife/images/{image_id}/reprocess",
            headers=admin,
        ).status_code
        == 200
    )
    # delete image translation (success)
    res = client.delete(
        f"/api/v1/catalog/products/imglife/images/{image_id}/translations/ro?source=storefront",
        headers=admin,
    )
    assert res.status_code == 204, res.text

    # delete the image (success body) then restore it (success body)
    res = client.delete(
        f"/api/v1/catalog/products/imglife/images/{image_id}", headers=admin
    )
    assert res.status_code == 200, res.text
    res = client.get(
        "/api/v1/catalog/products/imglife/images/deleted", headers=admin
    )
    assert res.status_code == 200, res.text
    res = client.post(
        f"/api/v1/catalog/products/imglife/images/{image_id}/restore", headers=admin
    )
    assert res.status_code == 200, res.text


# ---------------------------------------------------------------------------
# Review approval success body
# ---------------------------------------------------------------------------


def test_review_create_and_approve(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]
    admin = auth_headers(create_admin_token(SessionLocal))
    cat = _create_category(client, admin, "RevCat")
    _create_product(client, admin, cat["id"], "rev-prod", status="published")

    res = client.post(
        "/api/v1/catalog/products/rev-prod/reviews",
        json={"author_name": "Reviewer", "rating": 4, "title": "Nice", "body": "Good"},
    )
    assert res.status_code == 201, res.text
    review_id = res.json()["id"]

    # approve the existing review (success) + a missing review id (404)
    res = client.post(
        f"/api/v1/catalog/products/rev-prod/reviews/{review_id}/approve", headers=admin
    )
    assert res.status_code == 200, res.text
    assert res.json()["is_approved"] is True
    res = client.post(
        "/api/v1/catalog/products/rev-prod/reviews/00000000-0000-0000-0000-0000000000ff/approve",
        headers=admin,
    )
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Audit-source-omitted branches (category endpoints called WITHOUT ?source=)
# ---------------------------------------------------------------------------


def test_category_endpoints_without_audit_source(
    test_app: Dict[str, object]
) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]
    admin = auth_headers(create_admin_token(SessionLocal))

    res = client.post(
        "/api/v1/catalog/categories", json={"name": "Plain"}, headers=admin
    )
    assert res.status_code == 201, res.text
    slug = res.json()["slug"]

    # update / translation upsert / translation delete / reorder / delete, no source
    assert (
        client.patch(
            f"/api/v1/catalog/categories/{slug}",
            json={"name": "Plain2"},
            headers=admin,
        ).status_code
        == 200
    )
    assert (
        client.put(
            f"/api/v1/catalog/categories/{slug}/translations/ro",
            json={"name": "Simplu"},
            headers=admin,
        ).status_code
        == 200
    )
    assert (
        client.delete(
            f"/api/v1/catalog/categories/{slug}/translations/ro", headers=admin
        ).status_code
        == 204
    )
    assert (
        client.post(
            "/api/v1/catalog/categories/reorder",
            json=[{"slug": slug, "sort_order": 1}],
            headers=admin,
        ).status_code
        == 200
    )
    assert (
        client.delete(f"/api/v1/catalog/categories/{slug}", headers=admin).status_code
        == 200
    )


# ---------------------------------------------------------------------------
# Product CSV import: csv-required + decode-error branches
# ---------------------------------------------------------------------------


def test_product_csv_import_errors(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]
    admin = auth_headers(create_admin_token(SessionLocal))

    res = client.post(
        "/api/v1/catalog/products/import",
        files={"file": ("data.txt", b"x", "text/plain")},
        headers=admin,
    )
    assert res.status_code == 400
    res = client.post(
        "/api/v1/catalog/products/import",
        files={"file": ("data.csv", b"\xff\xfe\x00bad", "text/csv")},
        headers=admin,
    )
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# Categories list: anonymous (hidden filter) branch + a hidden category w/ lang
# ---------------------------------------------------------------------------


def test_categories_list_visibility_and_lang(test_app: Dict[str, object]) -> None:
    client: TestClient = test_app["client"]  # type: ignore[assignment]
    SessionLocal = test_app["session_factory"]
    admin = auth_headers(create_admin_token(SessionLocal))

    visible = _create_category(client, admin, "VisibleCat")
    # A hidden category (is_visible=False) created via admin update.
    hidden = _create_category(client, admin, "HiddenCat")
    res = client.patch(
        f"/api/v1/catalog/categories/{hidden['slug']}",
        json={"is_visible": False},
        headers=admin,
    )
    assert res.status_code == 200, res.text

    # Anonymous list with lang -> only visible categories, translation applied.
    res = client.get("/api/v1/catalog/categories?lang=ro")
    assert res.status_code == 200, res.text
    slugs = {c["slug"] for c in res.json()}
    assert visible["slug"] in slugs
    assert hidden["slug"] not in slugs

    # Staff list including hidden + lang -> hidden category appears, translated.
    res = client.get(
        "/api/v1/catalog/categories?lang=ro&include_hidden=true", headers=admin
    )
    assert res.status_code == 200, res.text
    staff_slugs = {c["slug"] for c in res.json()}
    assert hidden["slug"] in staff_slugs
