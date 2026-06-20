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
