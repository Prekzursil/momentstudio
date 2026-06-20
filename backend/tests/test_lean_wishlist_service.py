"""Lean-gate unit coverage for ``app.services.wishlist``.

Drives the service helpers end-to-end against an in-memory SQLite engine so
every branch runs: listing (incl. soft-deleted filtering), add (404 on missing
/ deleted / unpublished, idempotent re-add, fresh add) and remove (existing and
missing item).
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.catalog import Category, Product, ProductStatus
from app.services import wishlist

from tests.conftest import make_memory_session_factory


def _published(**kw) -> Product:
    defaults = dict(
        slug=f"p-{uuid4().hex[:8]}",
        sku=f"SKU-{uuid4().hex[:8]}",
        name="Product",
        base_price=10,
        currency="RON",
        stock_quantity=5,
        status=ProductStatus.published,
        is_deleted=False,
    )
    defaults.update(kw)
    return Product(**defaults)


def test_wishlist_full_lifecycle() -> None:
    factory = make_memory_session_factory()
    user_id = uuid4()

    async def run() -> None:
        async with factory() as session:
            cat = Category(slug="c", name="Cat")
            published = _published(category=cat)
            deleted = _published(is_deleted=True, category=cat)
            session.add_all([cat, published, deleted])
            await session.commit()
            await session.refresh(published)
            await session.refresh(deleted)

            # Empty wishlist initially.
            assert await wishlist.list_wishlist(session, user_id) == []

            # 404 on a non-existent product.
            with pytest.raises(HTTPException) as exc:
                await wishlist.add_to_wishlist(session, user_id, uuid4())
            assert exc.value.status_code == 404

            # 404 on a soft-deleted product.
            with pytest.raises(HTTPException):
                await wishlist.add_to_wishlist(session, user_id, deleted.id)

            # Fresh add.
            added = await wishlist.add_to_wishlist(session, user_id, published.id)
            assert added.id == published.id

            # Idempotent re-add returns the existing product without duplicating.
            again = await wishlist.add_to_wishlist(session, user_id, published.id)
            assert again.id == published.id

            listed = await wishlist.list_wishlist(session, user_id)
            assert [p.id for p in listed] == [published.id]

            # Remove an item that is not present is a no-op.
            await wishlist.remove_from_wishlist(session, user_id, uuid4())

            # Remove the real item.
            await wishlist.remove_from_wishlist(session, user_id, published.id)
            assert await wishlist.list_wishlist(session, user_id) == []

    asyncio.run(run())


def test_wishlist_unpublished_product_rejected() -> None:
    factory = make_memory_session_factory()
    user_id = uuid4()

    async def run() -> None:
        async with factory() as session:
            cat = Category(slug="c2", name="Cat2")
            draft = _published(status=ProductStatus.draft, category=cat)
            session.add_all([cat, draft])
            await session.commit()
            await session.refresh(draft)

            with pytest.raises(HTTPException) as exc:
                await wishlist.add_to_wishlist(session, user_id, draft.id)
            assert exc.value.status_code == 404

    asyncio.run(run())


def test_wishlist_excludes_soft_deleted_product_from_list() -> None:
    factory = make_memory_session_factory()
    user_id = uuid4()

    async def run() -> None:
        async with factory() as session:
            from app.models.wishlist import WishlistItem

            cat = Category(slug="c3", name="Cat3")
            published = _published(category=cat)
            session.add_all([cat, published])
            await session.commit()
            await session.refresh(published)

            session.add(WishlistItem(user_id=user_id, product_id=published.id))
            await session.commit()

            # Soft-delete the product after it was added: list must drop it.
            published.is_deleted = True
            await session.commit()

            assert await wishlist.list_wishlist(session, user_id) == []

    asyncio.run(run())
