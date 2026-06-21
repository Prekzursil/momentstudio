"""Tail arc closures for admin_dashboard (batch 10).

Coverage worker [w2]. Closes the audit-filter entity-None arc, the duplicate-
check sku-exclude arc, the user-security after-lock naive-normalize arc, and the
search-products translation-language branch.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Callable
from uuid import uuid4

import pytest

from app.api.v1 import admin_dashboard as ad
from app.db.base import Base
from app.models.catalog import Category, Product, ProductTranslation
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
        sku=f"SKU-{uuid4().hex[:6]}",
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
# _audit_filters: entity None / blank -> skip entity filter (3442->3447)      #
# --------------------------------------------------------------------------- #
def test_audit_entries_entity_none(session_factory: async_sessionmaker) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        # entity=None exercises the ``if entity:`` false arc (3442->3447).
        return await ad.admin_audit_entries(
            session=session,
            _=admin,
            entity=None,
            action="login",
            user="someone",
            page=1,
            limit=20,
        )

    out = run(session_factory, _scenario)
    assert "items" in out


# --------------------------------------------------------------------------- #
# duplicate_check_products: sku exclude_slug branch (2422)                    #
# --------------------------------------------------------------------------- #
def test_duplicate_check_sku_with_exclude(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ad.catalog_service, "slugify", lambda v: "")

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        await _make_product(session, slug="excluded-slug", sku="DUP-SKU", name="X")
        # name empty -> slug_base falsy (skips slug block); sku given with
        # exclude_slug -> exercises the sku exclude branch (2422).
        return await ad.duplicate_check_products(
            session=session,
            _=admin,
            name=None,
            sku="DUP-SKU",
            exclude_slug="excluded-slug",
        )

    out = run(session_factory, _scenario)
    # the only sku match is excluded -> empty
    assert out.sku_matches == []


# --------------------------------------------------------------------------- #
# update_user_security: existing naive locked_until, payload leaves it (4598) #
# --------------------------------------------------------------------------- #
def test_update_user_security_existing_naive_lock_untouched(
    session_factory: async_sessionmaker, monkeypatch: pytest.MonkeyPatch
) -> None:
    _no_audit(monkeypatch)

    async def _scenario(session) -> Any:
        admin = await _admin(session)
        # Seed a real future lock; aiosqlite returns it naive on reload, so the
        # after-lock value stays naive and exercises 4597->4598. The payload
        # does NOT include locked_until (4574 skipped) so it is preserved.
        target = await _customer(
            session,
            locked_until=datetime.now(timezone.utc) + timedelta(hours=2),
            locked_reason="prior",
        )
        return await ad.update_user_security(
            user_id=target.id,
            payload=_dump({"password_reset_required": True}),
            request=_Req(),
            session=session,
            current_user=admin,
        )

    out = run(session_factory, _scenario)
    assert out.password_reset_required is True
    assert out.locked_until is not None


# --------------------------------------------------------------------------- #
# search_products: product with translations -> 2244 translation branch       #
# --------------------------------------------------------------------------- #
def test_search_products_translation_branch(
    session_factory: async_sessionmaker,
) -> None:
    async def _scenario(session) -> Any:
        admin = await _admin(session)
        product = await _make_product(session, name="Translated", slug="translated")
        session.add(
            ProductTranslation(
                id=uuid4(), product_id=product.id, lang="ro", name="Tradus"
            )
        )
        await session.commit()
        return await ad.search_products(
            session=session,
            _=admin,
            q=None,
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
