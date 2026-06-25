"""User/product search + segment arc closures for admin_dashboard (batch 7).

Coverage worker [w2]. Covers the ``search_users`` q/role/include_pii filter
branches, ``search_products`` translation-language branch, ``products_by_ids``
result mapping, and the high-AOV segment include_pii reveal.
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable
from uuid import uuid4

import pytest

from app.api.v1 import admin_dashboard as ad
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
# search_users: include_pii + q + role filters (2585/2590/2598)              #
# --------------------------------------------------------------------------- #
def test_search_users_pii_q_role(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        ad.pii_service, "require_pii_reveal", lambda u, request=None: None
    )

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        return await ad.search_users(
            request=_Req(),
            q="admin",
            role=UserRole.admin,
            page=1,
            limit=25,
            include_pii=True,
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert out.meta.total_items >= 1


def test_search_users_masked_no_filters(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.pii_service, "mask_email", lambda e: "m***@x.com")

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        return await ad.search_users(
            request=_Req(),
            q=None,
            role=None,
            page=1,
            limit=25,
            include_pii=False,
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert out.meta.total_items >= 1


# --------------------------------------------------------------------------- #
# search_products: translation-language branch (2244)                        #
# --------------------------------------------------------------------------- #
def test_search_products_with_match(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.models.catalog import ProductTranslation

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        product = await _make_product(session, name="Widget", slug="widget")
        session.add(
            ProductTranslation(
                id=uuid4(),
                product_id=product.id,
                lang="en",
                name="Widget",
            )
        )
        await session.commit()
        return await ad.search_products(
            session=session,
            _=admin,
            q="widget",
            status=None,
            category_slug=None,
            missing_translations=False,
            missing_translation_lang=None,
            deleted=False,
            page=1,
            limit=25,
        )

    out = run(session_factory, _scenario)
    assert out.meta.total_items >= 1


# --------------------------------------------------------------------------- #
# products_by_ids                                                            #
# --------------------------------------------------------------------------- #
def test_products_by_ids_empty(session_factory: async_sessionmaker) -> None:
    from types import SimpleNamespace

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        return await ad.products_by_ids(
            payload=SimpleNamespace(ids=[]), session=session, _=admin
        )

    assert run(session_factory, _scenario) == []


def test_products_by_ids_returns_items(session_factory: async_sessionmaker) -> None:
    from types import SimpleNamespace

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        product = await _make_product(session)
        return await ad.products_by_ids(
            payload=SimpleNamespace(ids=[product.id]), session=session, _=admin
        )

    out = run(session_factory, _scenario)
    assert len(out) == 1


def test_products_by_ids_too_many(session_factory: async_sessionmaker) -> None:
    from types import SimpleNamespace

    from fastapi import HTTPException

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        with pytest.raises(HTTPException):
            await ad.products_by_ids(
                payload=SimpleNamespace(ids=[uuid4() for _ in range(201)]),
                session=session,
                _=admin,
            )

    run(session_factory, _scenario)


# --------------------------------------------------------------------------- #
# segment high-aov masked path (2759 false branch)                          #
# --------------------------------------------------------------------------- #
def test_segment_high_aov_masked(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.pii_service, "mask_email", lambda e: "m***@x.com")

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        return await ad.admin_user_segment_high_aov(
            request=_Req(),
            q=None,
            min_orders=1,
            min_aov=0,
            page=1,
            limit=25,
            include_pii=False,
            session=session,
            current_user=admin,
        )

    assert run(session_factory, _scenario).meta.total_items == 0
