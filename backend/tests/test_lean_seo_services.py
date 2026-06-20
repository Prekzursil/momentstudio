"""Lean-gate unit coverage for ``sitemap`` and ``structured_data`` services.

Both build SEO artifacts from published catalog/content rows. Tests seed an
in-memory database with rows that exercise every URL/issue branch (localized
languages, visibility/auth/hidden filters, currency/price/description/image
validation, and absolute-URL guards via a bad frontend origin).
"""

from __future__ import annotations

import asyncio
from decimal import Decimal

import pytest

from app.core.config import settings
from app.models.catalog import (
    Category,
    Product,
    ProductImage,
    ProductStatus,
)
from app.models.content import ContentBlock, ContentStatus
from app.services import sitemap, structured_data

from tests.conftest import make_memory_session_factory


def _product(**kw) -> Product:
    defaults = dict(
        slug="prod",
        name="Product",
        currency="RON",
        base_price=Decimal("10.00"),
        status=ProductStatus.published,
        is_active=True,
        is_deleted=False,
    )
    defaults.update(kw)
    return Product(**defaults)


def _page(key: str, **kw) -> ContentBlock:
    defaults = dict(
        title="Title",
        body_markdown="content",
        status=ContentStatus.published,
    )
    defaults.update(kw)
    return ContentBlock(key=key, **defaults)


# --------------------------------------------------------------------------- #
# sitemap                                                                      #
# --------------------------------------------------------------------------- #
def test_localized_url_helper() -> None:
    assert sitemap._localized_url("https://x", "/a", "en") == "https://x/a"
    assert sitemap._localized_url("https://x", "a", "ro") == "https://x/a?lang=ro"


def test_build_sitemap_urls_full() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        async with factory() as session:
            cat = Category(slug="shoes", name="Shoes", is_visible=True)
            cat_hidden = Category(slug="hidden", name="Hidden", is_visible=False)
            session.add_all([cat, cat_hidden])
            await session.flush()
            session.add(_product(slug="sneaker", category_id=cat.id))
            session.add_all(
                [
                    _page("blog.first", title="First Post"),
                    _page("page.about"),
                    _page("page.contact"),
                    _page("page.terms"),
                    _page("page.secret", meta={"requires_auth": True}),
                    _page("page.invisible", meta={"hidden": True}),
                    _page("page."),  # empty slug -> skipped
                ]
            )
            await session.commit()

            urls = await sitemap.build_sitemap_urls(session)
            assert set(urls.keys()) == {"en", "ro"}
            en = urls["en"]
            assert any(u.endswith("/shop/shoes") for u in en)
            assert not any("/shop/hidden" in u for u in en)
            assert any(u.endswith("/products/sneaker") for u in en)
            assert any(u.endswith("/blog/first") for u in en)
            assert any(u.endswith("/about") for u in en)
            assert any(u.endswith("/contact") for u in en)
            assert any(u.endswith("/pages/terms") for u in en)
            assert not any("requires_auth" in u or "secret" in u for u in en)
            assert not any("invisible" in u for u in en)
            # Romanian URLs carry the lang query param.
            assert all("?lang=ro" in u for u in urls["ro"] if u.count("/") > 2 or True)

    asyncio.run(flow())


def test_build_sitemap_urls_custom_langs() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        async with factory() as session:
            await session.commit()
            urls = await sitemap.build_sitemap_urls(session, langs=["en"])
            assert list(urls.keys()) == ["en"]

    asyncio.run(flow())


# --------------------------------------------------------------------------- #
# structured_data — pure helpers                                               #
# --------------------------------------------------------------------------- #
def test_is_valid_currency() -> None:
    assert structured_data._is_valid_currency("RON") is True
    assert structured_data._is_valid_currency("ron") is False
    assert structured_data._is_valid_currency("RO") is False
    assert structured_data._is_valid_currency("R0N") is False


def test_is_absolute_url() -> None:
    assert structured_data._is_absolute_url("https://x") is True
    assert structured_data._is_absolute_url(" HTTP://x ") is True
    assert structured_data._is_absolute_url("/relative") is False


def test_display_price() -> None:
    assert structured_data._display_price(Decimal("10"), None) == Decimal("10")
    assert structured_data._display_price(Decimal("10"), Decimal("8")) == Decimal("8")
    assert structured_data._display_price(Decimal("10"), Decimal("12")) == Decimal("10")

    class _BadSale:
        def __lt__(self, other):  # noqa: ANN001
            raise TypeError("incomparable")

    assert structured_data._display_price(Decimal("10"), _BadSale()) == Decimal("10")  # type: ignore[arg-type]


# --------------------------------------------------------------------------- #
# structured_data — full validation                                           #
# --------------------------------------------------------------------------- #
def test_validate_structured_data_collects_all_issue_types() -> None:
    factory = make_memory_session_factory()

    async def flow() -> None:
        async with factory() as session:
            cat = Category(slug="c", name="C", is_visible=True)
            session.add(cat)
            await session.flush()

            # Healthy product with absolute image -> no issues.
            good = _product(
                slug="good",
                category_id=cat.id,
                short_description="nice",
            )
            session.add(good)
            await session.flush()
            session.add(ProductImage(product_id=good.id, url="https://cdn/x.png"))

            # Product with no slug -> "Missing slug" + continue.
            session.add(_product(slug="", category_id=cat.id))
            # Bad currency, zero price, no description, no images.
            session.add(
                _product(
                    slug="bad",
                    name="",
                    category_id=cat.id,
                    currency="zz",
                    base_price=Decimal("0"),
                )
            )
            # Product with a relative image url -> image warning.
            relimg = _product(slug="relimg", category_id=cat.id, short_description="d")
            session.add(relimg)
            await session.flush()
            session.add(ProductImage(product_id=relimg.id, url="/local.png"))

            # Pages: valid, bad key, hidden, missing title, empty content.
            session.add_all(
                [
                    _page("page.about"),
                    _page("page."),  # empty slug after split -> invalid page key
                    _page("page.hidden", meta={"hidden": True}),
                    _page("page.notitle", title=""),
                    _page("page.empty", body_markdown="", meta={}),
                    _page("page.withblocks", body_markdown="", meta={"blocks": [1]}),
                ]
            )
            await session.commit()

            report = await structured_data.validate_structured_data(session)
            assert report["checked_products"] == 4
            assert report["errors"] >= 1
            assert report["warnings"] >= 1
            messages = {i["message"] for i in report["issues"]}  # type: ignore[index]
            assert "Missing slug" in messages
            assert any("Invalid currency" in m for m in messages)
            assert any("Offer price is 0" in m for m in messages)
            assert any("Missing product description" in m for m in messages)
            assert any("Missing product images" in m for m in messages)
            assert any("Image URL should be absolute" in m for m in messages)
            assert any("Invalid page key" in m for m in messages)
            assert "Missing page title" in messages
            assert any("Empty page content" in m for m in messages)

    asyncio.run(flow())


def test_validate_structured_data_invalid_origin_flags_url_errors() -> None:
    factory = make_memory_session_factory()
    prev = settings.frontend_origin
    settings.frontend_origin = "not-a-url"
    try:

        async def flow() -> None:
            async with factory() as session:
                cat = Category(slug="c", name="C", is_visible=True)
                session.add(cat)
                await session.flush()
                p = _product(
                    slug="p",
                    category_id=cat.id,
                    short_description="d",
                )
                session.add(p)
                await session.flush()
                session.add(ProductImage(product_id=p.id, url="https://cdn/x.png"))
                session.add(_page("page.about"))
                await session.commit()

                report = await structured_data.validate_structured_data(session)
                messages = {i["message"] for i in report["issues"]}  # type: ignore[index]
                assert any("cannot build absolute product URLs" in m for m in messages)
                assert any("cannot build absolute page URLs" in m for m in messages)

        asyncio.run(flow())
    finally:
        settings.frontend_origin = prev
