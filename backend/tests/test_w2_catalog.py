"""Worker-2 gap-fill coverage for ``app.services.catalog``.

Closes the residual DB-bound surface that the pure-helper w3 file and the
catalog API/service siblings do not drive: translation upsert/delete CRUD,
image-translation CRUD, slug-history + sku uniqueness, product create/update
edge branches (sort-order, sale sync, scheduled publish/unpublish, audit
changes), variant matrix updates, image add/restore/sort, soft-delete/restore,
bulk update, stock adjustments, featured collections, product feed (+CSV),
filtered listing + price bounds, duplicate, reviews + rating recompute,
relationships, recently-viewed, CSV import/export, and back-in-stock flows.

Everything runs on in-memory SQLite via the established factory; outbound email
and notification services are stubbed.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.catalog import (
    BackInStockRequest,
    Category,
    CategoryTranslation,
    FeaturedCollection,
    Product,
    ProductImage,
    ProductRelationshipType,
    ProductSlugHistory,
    ProductStatus,
    ProductVariant,
    StockAdjustmentReason,
)
from app.models.taxes import TaxGroup
from app.models.user import User, UserRole
from app.schemas.catalog import (
    BulkProductUpdateItem,
    CategoryCreate,
    CategoryReorderItem,
    CategoryTranslationUpsert,
    CategoryUpdate,
    FeaturedCollectionCreate,
    FeaturedCollectionUpdate,
    ProductBadgeUpsert,
    ProductCreate,
    ProductImageCreate,
    ProductImageTranslationUpsert,
    ProductOptionCreate,
    ProductRelationshipsUpdate,
    ProductReviewCreate,
    ProductTranslationUpsert,
    ProductUpdate,
    ProductVariantUpsert,
    ProductVariantMatrixUpdate,
    StockAdjustmentCreate,
)
from app.services import auth as auth_service
from app.services import catalog
from app.services import email as email_service
from app.services import notifications as notifications_service

UTC = timezone.utc
pytestmark = pytest.mark.anyio


def _make_engine_and_local() -> tuple[object, async_sessionmaker]:
    import app.models  # noqa: F401

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    local = async_sessionmaker(engine, expire_on_commit=False)
    return engine, local


async def _init(engine) -> None:
    from app.db.base import Base

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def _seed_category(session, *, slug="cat", name="Cat", **kw) -> Category:
    category = Category(slug=slug, name=name, sort_order=kw.pop("sort_order", 1), **kw)
    session.add(category)
    await session.flush()
    return category


async def _load_product(session, product_id) -> Product:
    """Fetch a product with the relationships ``update_product`` touches
    eagerly loaded, so sync attribute reads don't trigger aiosqlite lazy IO."""
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    result = await session.execute(
        select(Product)
        .options(
            selectinload(Product.tags),
            selectinload(Product.badges),
            selectinload(Product.options),
            selectinload(Product.images),
            selectinload(Product.variants),
            selectinload(Product.category),
        )
        .where(Product.id == product_id)
    )
    return result.scalar_one()


async def _seed_product(
    session, category, *, slug="prod", sku="SKU-1", tags=None, **kw
) -> Product:
    defaults = dict(
        category_id=category.id,
        slug=slug,
        sku=sku,
        name=kw.pop("name", "Prod"),
        base_price=Decimal("50.00"),
        currency="RON",
        stock_quantity=10,
        status=ProductStatus.published,
        is_active=True,
    )
    defaults.update(kw)
    product = Product(**defaults)
    if tags:
        # Assign tags on the transient instance BEFORE the first flush so the
        # relationship is not lazy-loaded (which fails under aiosqlite).
        product.tags = await catalog._get_or_create_tags(session, tags)
    session.add(product)
    await session.flush()
    return product


@pytest.fixture(autouse=True)
def _eager_defaults():
    """Re-fetch server-computed defaults during flush so onupdate columns and
    just-flushed rows behave like asyncpg/Postgres under aiosqlite (avoids
    MissingGreenlet on sync attribute reads). Mirrors the w0 harness."""
    from app.db.base import Base

    mappers = list(Base.registry.mappers)
    prev = {m: m.eager_defaults for m in mappers}
    for m in mappers:
        m.eager_defaults = True
    yield
    for m, value in prev.items():
        m.eager_defaults = value


@pytest.fixture(autouse=True)
def _stub_services(monkeypatch):
    sent: dict[str, list] = {"back_in_stock": [], "low_stock": [], "notifications": []}

    async def _back_in_stock(email, product_name):
        sent["back_in_stock"].append((email, product_name))
        return True

    async def _low_stock(email, name, qty):
        sent["low_stock"].append((email, name, qty))
        return True

    async def _create_notification(session, **kwargs):
        sent["notifications"].append(kwargs)
        return None

    async def _owner_email(session):
        return "owner@a.com"

    async def _owner_user(session):
        return None

    monkeypatch.setattr(email_service, "send_back_in_stock", _back_in_stock)
    monkeypatch.setattr(email_service, "send_low_stock_alert", _low_stock)
    monkeypatch.setattr(
        notifications_service, "create_notification", _create_notification
    )
    monkeypatch.setattr(auth_service, "get_owner_email", _owner_email)
    monkeypatch.setattr(auth_service, "get_owner_user", _owner_user)
    return sent


# --------------------------------------------------------------------------- #
# Category descendants + parent-assignment validation
# --------------------------------------------------------------------------- #


async def test_category_descendants_and_slug_lookup() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        root = await _seed_category(session, slug="root", name="Root")
        child = await _seed_category(
            session, slug="child", name="Child", parent_id=root.id
        )
        grand = await _seed_category(
            session, slug="grand", name="Grand", parent_id=child.id
        )
        await session.commit()
        ids = await catalog._get_category_and_descendant_ids_by_slug(session, "root")
        assert root.id in ids and child.id in ids and grand.id in ids
        # missing slug -> empty
        assert (
            await catalog._get_category_and_descendant_ids_by_slug(session, "nope")
            == []
        )
    await engine.dispose()


async def test_validate_category_parent_assignment_errors() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        a = await _seed_category(session, slug="a", name="A")
        b = await _seed_category(session, slug="b", name="B", parent_id=a.id)
        await session.commit()
        # self-parent
        with pytest.raises(HTTPException, match="own parent"):
            await catalog._validate_category_parent_assignment(
                session, category_id=a.id, parent_id=a.id
            )
        # parent not found
        with pytest.raises(HTTPException, match="Parent category not found"):
            await catalog._validate_category_parent_assignment(
                session, category_id=a.id, parent_id=uuid.uuid4()
            )
        # cycle: make a's parent = b (b is a's child) -> cycle
        with pytest.raises(HTTPException, match="cycle"):
            await catalog._validate_category_parent_assignment(
                session, category_id=a.id, parent_id=b.id
            )
        # None parent is a no-op
        await catalog._validate_category_parent_assignment(
            session, category_id=a.id, parent_id=None
        )
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Translation CRUD: category + product + image (upsert-existing + delete)
# --------------------------------------------------------------------------- #


async def test_category_translation_crud() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        await session.commit()
        created = await catalog.upsert_category_translation(
            session,
            category=cat,
            lang="ro",
            payload=CategoryTranslationUpsert(name="Ro", description="d"),
        )
        assert created.name == "Ro"
        # upsert existing -> update branch
        updated = await catalog.upsert_category_translation(
            session,
            category=cat,
            lang="ro",
            payload=CategoryTranslationUpsert(name="Ro2", description="d2"),
        )
        assert updated.name == "Ro2"
        rows = await catalog.list_category_translations(session, cat)
        assert len(rows) == 1
        # apply translation on a detached stub (avoids ORM lazy-load of the
        # collection under aiosqlite)
        from types import SimpleNamespace

        stub_cat = SimpleNamespace(
            name="orig", description=None, translations=list(rows)
        )
        catalog.apply_category_translation(stub_cat, "ro")
        assert stub_cat.name == "Ro2"
        # apply with no lang / no translations -> early return
        catalog.apply_category_translation(stub_cat, None)
        catalog.apply_category_translation(
            SimpleNamespace(name="x", description=None, translations=[]), "ro"
        )
        # delete
        await catalog.delete_category_translation(session, category=cat, lang="ro")
        with pytest.raises(HTTPException, match="not found"):
            await catalog.delete_category_translation(session, category=cat, lang="ro")
    await engine.dispose()


async def test_product_translation_crud_and_apply() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat)
        await session.commit()
        created = await catalog.upsert_product_translation(
            session,
            product=prod,
            lang="ro",
            payload=ProductTranslationUpsert(
                name="RoName",
                short_description="s",
                long_description="l",
                meta_title="mt",
                meta_description="md",
            ),
        )
        assert created.name == "RoName"
        # upsert existing -> update branch
        await catalog.upsert_product_translation(
            session,
            product=prod,
            lang="ro",
            payload=ProductTranslationUpsert(
                name="RoName2",
                short_description="s2",
                long_description="l2",
                meta_title=None,
                meta_description=None,
            ),
        )
        rows = await catalog.list_product_translations(session, prod)
        assert len(rows) == 1
        from types import SimpleNamespace

        stub = SimpleNamespace(
            name="orig",
            short_description=None,
            long_description=None,
            meta_title="mt",
            meta_description="md",
            translations=list(rows),
            category=None,
            images=None,
        )
        catalog.apply_product_translation(stub, "ro")
        assert stub.name == "RoName2"
        # no lang -> early return
        catalog.apply_product_translation(stub, None)
        await catalog.delete_product_translation(session, product=prod, lang="ro")
        with pytest.raises(HTTPException, match="not found"):
            await catalog.delete_product_translation(session, product=prod, lang="ro")
    await engine.dispose()


async def test_image_translation_crud() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat)
        image = ProductImage(product_id=prod.id, url="/m/a.jpg", sort_order=0)
        session.add(image)
        await session.commit()
        await session.refresh(image)
        created = await catalog.upsert_product_image_translation(
            session,
            image=image,
            lang="ro",
            payload=ProductImageTranslationUpsert(alt_text=" alt ", caption=" cap "),
            user_id=uuid.uuid4(),
            source="admin",
        )
        assert created.alt_text == "alt"
        # upsert existing -> update branch (no source -> else-arm of payload dict)
        await catalog.upsert_product_image_translation(
            session,
            image=image,
            lang="ro",
            payload=ProductImageTranslationUpsert(alt_text="alt2", caption=None),
        )
        rows = await catalog.list_product_image_translations(session, image=image)
        assert len(rows) == 1
        # apply via product on detached stubs (image alt/caption applied)
        from types import SimpleNamespace

        stub_image = SimpleNamespace(
            alt_text=None, caption=None, translations=list(rows)
        )
        stub_prod = SimpleNamespace(
            name="n",
            short_description=None,
            long_description=None,
            meta_title=None,
            meta_description=None,
            translations=None,
            category=None,
            images=[stub_image],
        )
        catalog.apply_product_translation(stub_prod, "ro")
        assert stub_image.alt_text == "alt2"
        # delete with source
        await catalog.delete_product_image_translation(
            session, image=image, lang="ro", user_id=uuid.uuid4(), source="admin"
        )
        with pytest.raises(HTTPException, match="not found"):
            await catalog.delete_product_image_translation(
                session, image=image, lang="ro"
            )
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Slug history follow + sku/slug uniqueness (exclude_id branches)
# --------------------------------------------------------------------------- #


async def test_get_product_by_slug_history_and_uniqueness() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat, slug="oldslug")
        session.add(ProductSlugHistory(product_id=prod.id, slug="historic"))
        await session.commit()
        # found by current slug with lang options
        found = await catalog.get_product_by_slug(session, "oldslug", lang="ro")
        assert found is not None
        # found via slug history
        via_hist = await catalog.get_product_by_slug(session, "historic")
        assert via_hist is not None and via_hist.id == prod.id
        # not found, follow_history False
        assert (
            await catalog.get_product_by_slug(session, "ghost", follow_history=False)
            is None
        )
        # slug uniqueness with exclude_id (no clash for same product)
        await catalog._ensure_slug_unique(session, "oldslug", exclude_id=prod.id)
        with pytest.raises(HTTPException, match="already exists"):
            await catalog._ensure_slug_unique(session, "oldslug")
        with pytest.raises(HTTPException, match="history"):
            await catalog._ensure_slug_unique(session, "historic")
        # sku uniqueness with exclude_id
        await catalog._ensure_sku_unique(session, prod.sku, exclude_id=prod.id)
        with pytest.raises(HTTPException, match="SKU already exists"):
            await catalog._ensure_sku_unique(session, prod.sku)
    await engine.dispose()


# --------------------------------------------------------------------------- #
# create_product: collision-driven slug/sku auto-increment + custom sort order
# + badges/options, then update_product audit-change tracking + sale sync.
# --------------------------------------------------------------------------- #


async def test_create_product_collisions_sort_badges_options() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        # an existing product with custom sort order forces new sort = max+1
        await _seed_product(session, cat, slug="p1", sku="SKU-A", sort_order=5)
        await session.commit()

        payload = ProductCreate(
            category_id=cat.id,
            slug="p1",  # collides -> auto -2
            name="New",
            base_price=Decimal("80.00"),
            currency="ron",
            stock_quantity=3,
            sale_type="percent",
            sale_value=Decimal("10"),
            badges=[ProductBadgeUpsert(badge="new")],
            options=[ProductOptionCreate(option_name="Size", option_value="M")],
            tags=["tagx"],
        )
        prod = await catalog.create_product(session, payload, user_id=uuid.uuid4())
        assert prod.slug == "p1-2"
        assert prod.currency == "RON"
        assert prod.sort_order == 6  # max(5)+1
        assert prod.sale_price is not None
        assert len(prod.badges) == 1 and len(prod.options) == 1
    await engine.dispose()


async def test_create_product_no_commit_and_first_in_category() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        await session.commit()
        payload = ProductCreate(
            category_id=cat.id,
            slug="solo",
            name="Solo",
            base_price=Decimal("10.00"),
            currency="RON",
            stock_quantity=1,
        )
        prod = await catalog.create_product(session, payload, commit=False)
        assert prod.sort_order == 0  # no custom-ordered siblings
    await engine.dispose()


async def test_update_product_full_change_tracking() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        cat2 = await _seed_category(session, slug="cat2", name="Cat2")
        prod = await _seed_product(
            session, cat, sku="SKU-U", stock_quantity=0, allow_backorder=False
        )
        await session.commit()
        prod = await _load_product(session, prod.id)

        payload = ProductUpdate(
            name="Renamed",
            sku="SKU-U2",
            base_price=Decimal("99.00"),
            currency="ron",
            category_id=cat2.id,
            stock_quantity=5,  # restock -> back-in-stock fulfilment
            sale_type="amount",
            sale_value=Decimal("5"),
            tags=["t1", "t2"],
            badges=[{"badge": "limited"}],
            options=[{"option_name": "Color", "option_value": "Red"}],
            publish_scheduled_for=datetime.now(UTC) + timedelta(days=1),
            unpublish_scheduled_for=datetime.now(UTC) + timedelta(days=2),
        )
        updated = await catalog.update_product(
            session, prod, payload, user_id=uuid.uuid4(), source="admin"
        )
        assert updated.name == "Renamed"
        assert updated.currency == "RON"
        assert updated.sku == "SKU-U2"
        assert updated.sale_price is not None
        assert sorted(t.slug for t in updated.tags) == ["t1", "t2"]
    await engine.dispose()


async def test_update_product_clear_collections_and_no_commit() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    from app.models.catalog import ProductOption

    async with local() as session:
        cat = await _seed_category(session)
        tags = await catalog._get_or_create_tags(session, ["a"])
        product = Product(
            category_id=cat.id,
            slug="clearme",
            sku="SKU-C",
            name="Clear",
            base_price=Decimal("50.00"),
            currency="RON",
            stock_quantity=10,
            status=ProductStatus.published,
            is_active=True,
        )
        product.tags = tags
        product.badges = catalog._build_product_badges([{"badge": "limited"}])
        product.options = [ProductOption(option_name="O", option_value="V")]
        session.add(product)
        await session.commit()
        prod = await _load_product(session, product.id)

        payload = ProductUpdate(tags=None, badges=None, options=None)
        updated = await catalog.update_product(session, prod, payload, commit=False)
        assert updated.tags == [] and updated.badges == [] and updated.options == []
    await engine.dispose()


async def test_update_product_schedule_order_validation() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat, sku="SKU-S")
        await session.commit()
        prod = await _load_product(session, prod.id)
        payload = ProductUpdate(
            publish_scheduled_for=datetime.now(UTC) + timedelta(days=2),
            unpublish_scheduled_for=datetime.now(UTC) + timedelta(days=1),
        )
        with pytest.raises(HTTPException, match="after publish schedule"):
            await catalog.update_product(session, prod, payload)
    await engine.dispose()


async def test_update_product_slug_change_rejected() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat, sku="SKU-SL")
        await session.commit()
        prod = await _load_product(session, prod.id)
        with pytest.raises(HTTPException, match="Slug cannot be changed"):
            await catalog.update_product(session, prod, ProductUpdate(slug="different"))
        # same slug -> popped, no error
        await catalog.update_product(session, prod, ProductUpdate(slug=prod.slug))
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Category create / update / reorder
# --------------------------------------------------------------------------- #


async def test_create_category_collisions_and_validations() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        await _seed_category(session, slug="decor", name="Decor")
        tax = TaxGroup(code="STD", name="Std")
        session.add(tax)
        await session.flush()
        parent = await _seed_category(session, slug="parent", name="Parent")
        await session.commit()

        # name "Decor" slugifies to "decor" which collides -> decor-2
        created = await catalog.create_category(
            session,
            CategoryCreate(name="Decor", parent_id=parent.id, tax_group_id=tax.id),
        )
        assert created.slug == "decor-2"

        with pytest.raises(HTTPException, match="Parent category not found"):
            await catalog.create_category(
                session, CategoryCreate(name="X", parent_id=uuid.uuid4())
            )
        with pytest.raises(HTTPException, match="Tax group not found"):
            await catalog.create_category(
                session, CategoryCreate(name="Y", tax_group_id=uuid.uuid4())
            )
    await engine.dispose()


async def test_update_category_paths() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session, slug="upd", name="Upd")
        tax = TaxGroup(code="STD", name="Std")
        session.add(tax)
        await session.flush()
        await session.commit()

        # slug unchanged (same value) -> popped silently
        updated = await catalog.update_category(
            session, cat, CategoryUpdate(slug="upd", name="Upd2", tax_group_id=tax.id)
        )
        assert updated.name == "Upd2"
        # slug change attempt -> rejected
        with pytest.raises(HTTPException, match="slug cannot be changed"):
            await catalog.update_category(session, cat, CategoryUpdate(slug="other"))
        # invalid tax group
        with pytest.raises(HTTPException, match="Tax group not found"):
            await catalog.update_category(
                session, cat, CategoryUpdate(tax_group_id=uuid.uuid4())
            )
    await engine.dispose()


async def test_reorder_categories() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        await _seed_category(session, slug="r1", name="R1", sort_order=1)
        await _seed_category(session, slug="r2", name="R2", sort_order=2)
        await session.commit()
        # empty -> []
        assert await catalog.reorder_categories(session, []) == []
        out = await catalog.reorder_categories(
            session,
            [
                CategoryReorderItem(slug="r2", sort_order=10),
                CategoryReorderItem(slug="missing", sort_order=5),
            ],
        )
        assert len(out) == 1 and out[0].slug == "r2"
        # nothing updates -> []
        assert (
            await catalog.reorder_categories(
                session, [CategoryReorderItem(slug="ghost", sort_order=9)]
            )
            == []
        )
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Variant matrix update
# --------------------------------------------------------------------------- #


async def test_update_product_variants_full() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat, sku="SKU-V")
        existing = ProductVariant(
            product_id=prod.id,
            name="Old",
            additional_price_delta=Decimal("0"),
            stock_quantity=5,
        )
        to_delete = ProductVariant(
            product_id=prod.id,
            name="Dead",
            additional_price_delta=Decimal("0"),
            stock_quantity=3,
        )
        session.add_all([existing, to_delete])
        await session.commit()
        prod = await _load_product(session, prod.id)
        existing_id = next(v.id for v in prod.variants if v.name == "Old")
        delete_id = next(v.id for v in prod.variants if v.name == "Dead")

        payload = ProductVariantMatrixUpdate(
            variants=[
                ProductVariantUpsert(id=existing_id, name="Updated", stock_quantity=8),
                ProductVariantUpsert(name="Brand New", stock_quantity=4),
            ],
            delete_variant_ids=[delete_id],
        )
        out = await catalog.update_product_variants(
            session, product=prod, payload=payload, user_id=uuid.uuid4()
        )
        names = sorted(v.name for v in out)
        assert "Updated" in names and "Brand New" in names and "Dead" not in names
    await engine.dispose()


async def test_update_product_variants_validation_errors() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat, sku="SKU-VE")
        await session.commit()
        prod = await _load_product(session, prod.id)

        with pytest.raises(HTTPException, match="required"):
            await catalog.update_product_variants(
                session,
                product=prod,
                payload=ProductVariantMatrixUpdate.model_construct(
                    variants=[ProductVariantUpsert.model_construct(id=None, name="  ")],
                    delete_variant_ids=[],
                ),
            )
        # duplicate names (case-insensitive)
        with pytest.raises(HTTPException, match="must be unique"):
            await catalog.update_product_variants(
                session,
                product=prod,
                payload=ProductVariantMatrixUpdate(
                    variants=[
                        ProductVariantUpsert(name="Dup"),
                        ProductVariantUpsert(name="dup"),
                    ]
                ),
            )
        # update + delete same id
        vid = uuid.uuid4()
        with pytest.raises(HTTPException, match="also being updated"):
            await catalog.update_product_variants(
                session,
                product=prod,
                payload=ProductVariantMatrixUpdate(
                    variants=[ProductVariantUpsert(id=vid, name="A")],
                    delete_variant_ids=[vid],
                ),
            )
        # update non-existent id
        with pytest.raises(HTTPException, match="Variant not found"):
            await catalog.update_product_variants(
                session,
                product=prod,
                payload=ProductVariantMatrixUpdate(
                    variants=[ProductVariantUpsert(id=uuid.uuid4(), name="Ghost")]
                ),
            )
        # delete non-existent id
        with pytest.raises(HTTPException, match="Variant not found"):
            await catalog.update_product_variants(
                session,
                product=prod,
                payload=ProductVariantMatrixUpdate(delete_variant_ids=[uuid.uuid4()]),
            )
    await engine.dispose()


async def test_update_variants_delete_blocked_by_cart_and_order() -> None:
    from app.models.cart import Cart, CartItem
    from app.models.order import Order, OrderItem, OrderStatus

    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat, sku="SKU-VD")
        v_cart = ProductVariant(
            product_id=prod.id,
            name="InCart",
            stock_quantity=1,
            additional_price_delta=Decimal("0"),
        )
        v_order = ProductVariant(
            product_id=prod.id,
            name="InOrder",
            stock_quantity=1,
            additional_price_delta=Decimal("0"),
        )
        session.add_all([v_cart, v_order])
        await session.flush()
        cart = Cart()
        session.add(cart)
        await session.flush()
        session.add(
            CartItem(
                cart_id=cart.id,
                product_id=prod.id,
                variant_id=v_cart.id,
                quantity=1,
                unit_price_at_add=Decimal("10.00"),
            )
        )
        order = Order(
            status=OrderStatus.pending_payment,
            customer_email="o@a.com",
            customer_name="O",
            total_amount=Decimal("10.00"),
            payment_method="cod",
            currency="RON",
        )
        session.add(order)
        await session.flush()
        session.add(
            OrderItem(
                order_id=order.id,
                product_id=prod.id,
                variant_id=v_order.id,
                quantity=1,
                unit_price=Decimal("10.00"),
                subtotal=Decimal("10.00"),
            )
        )
        await session.commit()
        prod = await _load_product(session, prod.id)
        cart_vid = next(v.id for v in prod.variants if v.name == "InCart")
        order_vid = next(v.id for v in prod.variants if v.name == "InOrder")

        with pytest.raises(HTTPException, match="used in a cart"):
            await catalog.update_product_variants(
                session,
                product=prod,
                payload=ProductVariantMatrixUpdate(delete_variant_ids=[cart_vid]),
            )
        prod = await _load_product(session, prod.id)
        with pytest.raises(HTTPException, match="used in an order"):
            await catalog.update_product_variants(
                session,
                product=prod,
                payload=ProductVariantMatrixUpdate(delete_variant_ids=[order_vid]),
            )
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Image add / delete / restore / sort
# --------------------------------------------------------------------------- #


async def test_product_image_lifecycle() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat, sku="SKU-IMG")
        await session.commit()
        prod = await _load_product(session, prod.id)

        img = await catalog.add_product_image(
            session, prod, ProductImageCreate(url="/m/x.jpg", sort_order=1)
        )
        img2 = await catalog.add_product_image_from_path(
            session, prod, "/m/y.jpg", "alt", 2
        )
        prod = await _load_product(session, prod.id)
        # sort update
        await catalog.update_product_image_sort(
            session, prod, str(img.id), 9, user_id=uuid.uuid4(), source="admin"
        )
        prod = await _load_product(session, prod.id)
        await catalog.update_product_image_sort(session, prod, str(img2.id), 3)
        with pytest.raises(HTTPException, match="Image not found"):
            await catalog.update_product_image_sort(session, prod, str(uuid.uuid4()), 1)

        # delete (soft) + list deleted + restore
        prod = await _load_product(session, prod.id)
        await catalog.delete_product_image(
            session, prod, str(img.id), user_id=uuid.uuid4()
        )
        with pytest.raises(HTTPException, match="Image not found"):
            await catalog.delete_product_image(session, prod, str(uuid.uuid4()))
        deleted = await catalog.list_deleted_product_images(session, prod.id)
        assert len(deleted) == 1

        await catalog.restore_product_image(
            session, prod, str(img.id), user_id=uuid.uuid4()
        )
        # restore non-deleted -> error
        with pytest.raises(HTTPException, match="not deleted"):
            await catalog.restore_product_image(session, prod, str(img.id))
        # restore invalid uuid
        with pytest.raises(HTTPException, match="Invalid image id"):
            await catalog.restore_product_image(session, prod, "not-a-uuid")
        # restore unknown uuid
        with pytest.raises(HTTPException, match="Image not found"):
            await catalog.restore_product_image(session, prod, str(uuid.uuid4()))
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Soft delete + restore product
# --------------------------------------------------------------------------- #


async def test_soft_delete_and_restore_product() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat, slug="todelete", sku="SKU-DEL")
        await session.commit()
        prod = await _load_product(session, prod.id)

        await catalog.soft_delete_product(session, prod, user_id=uuid.uuid4())
        assert prod.is_deleted is True
        assert prod.slug.startswith("deleted-")

        # restore a not-deleted product is a no-op
        prod2 = await _seed_product(session, cat, slug="live", sku="SKU-LIVE")
        await session.commit()
        prod2 = await _load_product(session, prod2.id)
        assert await catalog.restore_soft_deleted_product(session, prod2) is prod2

        # restore the deleted one -> slug derived from deleted_slug
        prod = await _load_product(session, prod.id)
        restored = await catalog.restore_soft_deleted_product(
            session, prod, user_id=uuid.uuid4()
        )
        assert restored.is_deleted is False
        assert restored.slug == "todelete"
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Scheduled publish/unpublish + auto-publish due sales
# --------------------------------------------------------------------------- #


async def test_apply_due_schedules_and_auto_publish() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    past = datetime.now(UTC) - timedelta(hours=1)
    async with local() as session:
        cat = await _seed_category(session)
        # draft with due publish schedule
        await _seed_product(
            session,
            cat,
            slug="due-pub",
            sku="SKU-DP",
            status=ProductStatus.draft,
            publish_scheduled_for=past,
        )
        # published with due unpublish schedule
        await _seed_product(
            session,
            cat,
            slug="due-unpub",
            sku="SKU-DU",
            status=ProductStatus.published,
            unpublish_scheduled_for=past,
        )
        # draft with auto-publish sale due
        await _seed_product(
            session,
            cat,
            slug="due-sale",
            sku="SKU-DS",
            status=ProductStatus.draft,
            sale_price=Decimal("40.00"),
            sale_auto_publish=True,
            sale_start_at=past,
        )
        await session.commit()

        applied = await catalog.apply_due_product_schedules(session)
        assert applied >= 2
        published = await catalog.auto_publish_due_sales(session)
        assert published >= 1
        # second call: nothing due -> 0
        assert await catalog.apply_due_product_schedules(session) == 0
        assert await catalog.auto_publish_due_sales(session) == 0
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Bulk update products
# --------------------------------------------------------------------------- #


async def test_bulk_update_products() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        cat2 = await _seed_category(session, slug="cat2", name="C2")
        # cat2 has a custom-ordered product so moved products get max+1
        await _seed_product(session, cat2, slug="anchor", sku="SKU-AN", sort_order=7)
        p1 = await _seed_product(
            session,
            cat,
            slug="b1",
            sku="SKU-B1",
            stock_quantity=0,
            allow_backorder=False,
        )
        p2 = await _seed_product(session, cat, slug="b2", sku="SKU-B2")
        await session.commit()

        updates = [
            BulkProductUpdateItem(
                product_id=p1.id,
                base_price=Decimal("70.00"),
                sale_type="percent",
                sale_value=Decimal("20"),
                stock_quantity=5,  # restock
                is_featured=True,
                category_id=cat2.id,  # move -> sort max+1
            ),
            BulkProductUpdateItem(
                product_id=p2.id,
                sale_auto_publish=None,  # None -> False branch
                publish_scheduled_for=datetime.now(UTC) + timedelta(days=1),
                unpublish_scheduled_for=datetime.now(UTC) + timedelta(days=2),
            ),
        ]
        out = await catalog.bulk_update_products(
            session, updates, user_id=uuid.uuid4(), source="admin"
        )
        assert len(out) == 2
        moved = next(p for p in out if p.id == p1.id)
        assert moved.category_id == cat2.id
        assert moved.sort_order == 8  # anchor max(7)+1
    await engine.dispose()


async def test_bulk_update_validation_errors() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat, sku="SKU-BV")
        await session.commit()

        # category not found
        with pytest.raises(HTTPException, match="categories not found"):
            await catalog.bulk_update_products(
                session,
                [BulkProductUpdateItem(product_id=prod.id, category_id=uuid.uuid4())],
            )
        # product not found
        with pytest.raises(HTTPException, match="not found"):
            await catalog.bulk_update_products(
                session, [BulkProductUpdateItem(product_id=uuid.uuid4())]
            )
        # null category_id explicitly
        with pytest.raises(HTTPException, match="cannot be null"):
            await catalog.bulk_update_products(
                session,
                [
                    BulkProductUpdateItem.model_construct(
                        product_id=prod.id, category_id=None
                    ).model_copy(update={"category_id": None})
                ],
            )
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Stock adjustments
# --------------------------------------------------------------------------- #


async def test_apply_stock_adjustment_paths() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(
            session, cat, sku="SKU-ADJ", stock_quantity=0, allow_backorder=False
        )
        variant = ProductVariant(
            product_id=prod.id,
            name="V",
            stock_quantity=2,
            additional_price_delta=Decimal("0"),
        )
        session.add(variant)
        await session.commit()
        variant_id = variant.id

        # zero delta -> error
        with pytest.raises(HTTPException, match="cannot be zero"):
            await catalog.apply_stock_adjustment(
                session,
                payload=StockAdjustmentCreate(
                    product_id=prod.id,
                    delta=0,
                    reason=StockAdjustmentReason.manual_correction,
                ),
            )
        # product not found
        with pytest.raises(HTTPException, match="Product not found"):
            await catalog.apply_stock_adjustment(
                session,
                payload=StockAdjustmentCreate(
                    product_id=uuid.uuid4(),
                    delta=1,
                    reason=StockAdjustmentReason.manual_correction,
                ),
            )
        # product-level restock -> fulfils back-in-stock + low-stock alert
        adj = await catalog.apply_stock_adjustment(
            session,
            payload=StockAdjustmentCreate(
                product_id=prod.id,
                delta=1,
                note=" n ",
                reason=StockAdjustmentReason.manual_correction,
            ),
            user_id=uuid.uuid4(),
        )
        assert adj.after_quantity == 1
        # negative result -> error
        with pytest.raises(HTTPException, match="cannot be negative"):
            await catalog.apply_stock_adjustment(
                session,
                payload=StockAdjustmentCreate(
                    product_id=prod.id,
                    delta=-100,
                    reason=StockAdjustmentReason.manual_correction,
                ),
            )
        # variant-level adjustment
        vadj = await catalog.apply_stock_adjustment(
            session,
            payload=StockAdjustmentCreate(
                product_id=prod.id,
                variant_id=variant_id,
                delta=3,
                reason=StockAdjustmentReason.manual_correction,
            ),
        )
        assert vadj.after_quantity == 5
        # variant negative
        with pytest.raises(HTTPException, match="cannot be negative"):
            await catalog.apply_stock_adjustment(
                session,
                payload=StockAdjustmentCreate(
                    product_id=prod.id,
                    variant_id=variant_id,
                    delta=-100,
                    reason=StockAdjustmentReason.manual_correction,
                ),
            )
        # invalid variant
        with pytest.raises(HTTPException, match="Invalid variant"):
            await catalog.apply_stock_adjustment(
                session,
                payload=StockAdjustmentCreate(
                    product_id=prod.id,
                    variant_id=uuid.uuid4(),
                    delta=1,
                    reason=StockAdjustmentReason.manual_correction,
                ),
            )
        # list adjustments
        rows = await catalog.list_stock_adjustments(session, product_id=prod.id)
        assert len(rows) >= 2
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Featured collections
# --------------------------------------------------------------------------- #


async def test_featured_collections_crud() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        p1 = await _seed_product(session, cat, slug="fc1", sku="SKU-FC1")
        p2 = await _seed_product(session, cat, slug="fc2", sku="SKU-FC2")
        # pre-existing collection named "Top" forces slug collision
        existing = FeaturedCollection(slug="top", name="Top")
        session.add(existing)
        await session.commit()

        created = await catalog.create_featured_collection(
            session,
            FeaturedCollectionCreate(name="Top", product_ids=[p1.id]),
        )
        assert created.slug == "top-2"

        # missing product -> 404
        with pytest.raises(HTTPException, match="products not found"):
            await catalog.create_featured_collection(
                session,
                FeaturedCollectionCreate(name="Bad", product_ids=[uuid.uuid4()]),
            )

        updated = await catalog.update_featured_collection(
            session,
            created,
            FeaturedCollectionUpdate(name="Top!", product_ids=[p1.id, p2.id]),
        )
        assert updated.name == "Top!"

        fetched = await catalog.get_featured_collection_by_slug(session, "top-2")
        assert fetched is not None
        listed = await catalog.list_featured_collections(session, lang="ro")
        assert listed
        # _load_products_by_ids empty -> []
        assert await catalog._load_products_by_ids(session, []) == []
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Product feed (+ CSV)
# --------------------------------------------------------------------------- #


async def test_product_feed_and_csv() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session, slug="feedcat", name="FeedCat")
        await _seed_product(
            session,
            cat,
            slug="feedprod",
            sku="SKU-FEED",
            short_description="short",
            sale_price=Decimal("40.00"),
            sale_type="amount",
            sale_value=Decimal("10"),
            tags=["t"],
        )
        await session.commit()

        feed = await catalog.get_product_feed(session, lang="ro")
        assert any(item.slug == "feedprod" for item in feed)
        feed_plain = await catalog.get_product_feed(session)
        assert feed_plain
        csv_out = await catalog.get_product_feed_csv(session)
        assert "feedprod" in csv_out
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Filtered listing + price bounds (parametrized matrix)
# --------------------------------------------------------------------------- #


async def _seed_filter_fixture(session):
    cat = await _seed_category(session, slug="fcat", name="FCat", is_visible=True)
    sub = await _seed_category(
        session, slug="fsub", name="FSub", parent_id=cat.id, is_visible=True
    )
    now = datetime.now(UTC)
    on_sale = await _seed_product(
        session,
        sub,
        slug="cheap",
        sku="SKU-CHEAP",
        name="Alpha",
        base_price=Decimal("100.00"),
        sale_price=Decimal("20.00"),
        sale_type="amount",
        sale_value=Decimal("80"),
        sale_start_at=now - timedelta(days=1),
        is_featured=True,
        short_description="hand crafted",
        tags=["sale"],
    )
    full = await _seed_product(
        session,
        cat,
        slug="pricey",
        sku="SKU-PRICEY",
        name="Beta",
        base_price=Decimal("200.00"),
        is_featured=False,
    )
    await session.commit()
    return cat, on_sale, full


@pytest.mark.parametrize(
    "sort",
    ["recommended", "price_asc", "price_desc", "name_asc", "name_desc", None],
)
async def test_list_products_with_filters_sorts(sort) -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        await _seed_filter_fixture(session)
        items, total = await catalog.list_products_with_filters(
            session,
            category_slug="fcat",
            on_sale=None,
            is_featured=None,
            search=None,
            min_price=None,
            max_price=None,
            tags=None,
            sort=sort,
            limit=10,
            offset=0,
            lang="ro",
        )
        assert total == 2 and len(items) == 2
    await engine.dispose()


async def test_list_products_with_filters_all_filters() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        await _seed_filter_fixture(session)
        items, total = await catalog.list_products_with_filters(
            session,
            category_slug="fcat",
            on_sale=True,
            is_featured=True,
            search="hand",
            min_price=1.0,
            max_price=50.0,
            tags=["sale"],
            sort="price_asc",
            limit=10,
            offset=0,
        )
        assert total == 1 and items[0].slug == "cheap"

        # not on sale filter
        items2, _ = await catalog.list_products_with_filters(
            session,
            category_slug=None,
            on_sale=False,
            is_featured=False,
            search=None,
            min_price=None,
            max_price=None,
            tags=None,
            sort=None,
            limit=10,
            offset=0,
        )
        assert all(p.slug != "cheap" for p in items2)

        # unknown category -> no rows
        items3, total3 = await catalog.list_products_with_filters(
            session,
            category_slug="ghostcat",
            on_sale=None,
            is_featured=None,
            search=None,
            min_price=None,
            max_price=None,
            tags=None,
            sort=None,
            limit=10,
            offset=0,
        )
        assert total3 == 0
    await engine.dispose()


async def test_get_product_price_bounds_matrix() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        await _seed_filter_fixture(session)
        lo, hi, cur = (
            await catalog.get_product_price_bounds("fcat", None, None, None, None)
            if False
            else await catalog.get_product_price_bounds(
                session, "fcat", None, None, None, None
            )
        )
        assert lo >= 0 and hi >= lo and cur == "RON"
        # with all filters
        lo2, hi2, _ = await catalog.get_product_price_bounds(
            session, "fcat", True, True, "hand", ["sale"]
        )
        assert hi2 >= lo2
        # unknown category -> zeros
        lo3, hi3, cur3 = await catalog.get_product_price_bounds(
            session, "ghost", None, None, None, None
        )
        assert lo3 == 0.0 and hi3 == 0.0 and cur3 is None
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Duplicate product
# --------------------------------------------------------------------------- #


async def test_duplicate_product() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        from app.models.catalog import ProductOption

        cat = await _seed_category(session)
        # custom-ordered sibling so the clone gets max+1
        await _seed_product(session, cat, slug="sib", sku="SKU-SIB", sort_order=4)
        tags = await catalog._get_or_create_tags(session, ["dup"])
        product = Product(
            category_id=cat.id,
            slug="orig",
            sku="SKU-ORIG",
            name="Prod",
            base_price=Decimal("50.00"),
            currency="RON",
            stock_quantity=10,
            status=ProductStatus.published,
            is_active=True,
        )
        product.images = [ProductImage(url="/m/i.jpg", sort_order=0)]
        product.variants = [
            ProductVariant(
                name="V", stock_quantity=1, additional_price_delta=Decimal("0")
            )
        ]
        product.options = [ProductOption(option_name="O", option_value="V")]
        product.tags = tags
        product.badges = catalog._build_product_badges([{"badge": "new"}])
        session.add(product)
        await session.commit()
        prod = await _load_product(session, product.id)

        clone = await catalog.duplicate_product(
            session, prod, user_id=uuid.uuid4(), source="admin"
        )
        assert clone.slug == "orig-copy"
        assert clone.sort_order == 5
        assert "(Copy)" in clone.name

        # duplicate again -> slug collision increment
        prod = await _load_product(session, prod.id)
        clone2 = await catalog.duplicate_product(session, prod)
        assert clone2.slug == "orig-copy-2"
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Reviews + rating recompute
# --------------------------------------------------------------------------- #


async def test_reviews_and_rating() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat, sku="SKU-REV")
        await session.commit()
        prod = await _load_product(session, prod.id)

        review = await catalog.add_review(
            session,
            prod,
            ProductReviewCreate(author_name="A", rating=4, title="t", body="b"),
            user_id=uuid.uuid4(),
        )
        assert review.is_approved is False
        approved = await catalog.approve_review(session, review)
        assert approved.is_approved is True

        # recompute with no product -> early return (defensive)
        await catalog.recompute_product_rating(session, uuid.uuid4())

        related = await catalog.get_related_products(session, prod)
        assert isinstance(related, list)
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Relationships
# --------------------------------------------------------------------------- #


async def test_product_relationships() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat, slug="rel-main", sku="SKU-RM")
        r1 = await _seed_product(session, cat, slug="rel-1", sku="SKU-R1")
        u1 = await _seed_product(session, cat, slug="ups-1", sku="SKU-U1")
        await session.commit()
        prod = await _load_product(session, prod.id)

        # self-reference rejected
        with pytest.raises(HTTPException, match="cannot reference itself"):
            await catalog.update_product_relationships(
                session,
                product=prod,
                payload=ProductRelationshipsUpdate(related_product_ids=[prod.id]),
            )
        # unknown product rejected
        with pytest.raises(HTTPException, match="not found"):
            await catalog.update_product_relationships(
                session,
                product=prod,
                payload=ProductRelationshipsUpdate(related_product_ids=[uuid.uuid4()]),
            )
        # set related + upsell (overlap removed from upsell)
        out = await catalog.update_product_relationships(
            session,
            product=prod,
            payload=ProductRelationshipsUpdate(
                related_product_ids=[r1.id],
                upsell_product_ids=[r1.id, u1.id],
            ),
            user_id=uuid.uuid4(),
        )
        assert out.related_product_ids == [r1.id]
        assert out.upsell_product_ids == [u1.id]

        read = await catalog.get_product_relationships(session, prod.id)
        assert read.related_product_ids == [r1.id]
        curated = await catalog.get_curated_relationship_products(
            session,
            product_id=prod.id,
            relationship_type=ProductRelationshipType.related,
            limit=4,
            include_inactive=True,
        )
        assert curated and curated[0].id == r1.id
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Recently viewed
# --------------------------------------------------------------------------- #


async def test_recently_viewed() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat, sku="SKU-RV")
        await session.commit()
        prod = await _load_product(session, prod.id)
        uid = uuid.uuid4()

        # no user/session -> no-op
        await catalog.record_recently_viewed(session, prod, None, None)
        assert await catalog.get_recently_viewed(session, None, None) == []

        # record by user, then again (update branch), with cap enforcement
        await catalog.record_recently_viewed(session, prod, uid, None, limit=1)
        await catalog.record_recently_viewed(session, prod, uid, None, limit=1)
        # record by session id
        await catalog.record_recently_viewed(session, prod, None, "sess-1")

        got_user = await catalog.get_recently_viewed(session, uid, None)
        assert got_user and got_user[0].id == prod.id
        got_sess = await catalog.get_recently_viewed(session, None, "sess-1")
        assert got_sess and got_sess[0].id == prod.id
    await engine.dispose()


# --------------------------------------------------------------------------- #
# CSV export / import
# --------------------------------------------------------------------------- #


async def test_export_csv() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        parent = await _seed_category(session, slug="pcat", name="PCat")
        child = await _seed_category(
            session, slug="ccat", name="CCat", parent_id=parent.id
        )
        session.add(
            CategoryTranslation(
                category_id=child.id, lang="ro", name="CRo", description="d"
            )
        )
        await _seed_product(session, child, sku="SKU-EXP", tags=["x"])
        await session.commit()

        products_csv = await catalog.export_products_csv(session)
        assert "prod" in products_csv
        cats_csv = await catalog.export_categories_csv(session)
        assert "ccat" in cats_csv
        # template returns just the header
        template = await catalog.export_categories_csv(session, template=True)
        assert "slug" in template and "ccat" not in template
    await engine.dispose()


async def test_import_products_csv() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    header = (
        "slug,name,category_slug,base_price,currency,stock_quantity,status,"
        "is_featured,is_active,short_description,long_description,tags\n"
    )
    async with local() as session:
        await _seed_category(session, slug="impcat", name="ImpCat")
        await _seed_product(
            session,
            (await catalog.get_category_by_slug(session, "impcat")),
            slug="existing",
            sku="SKU-EX",
        )
        await session.commit()

        good = header + (
            "new-prod,New Prod,impcat,12.50,RON,3,published,true,true,s,l,t1\n"
            "existing,Existing Updated,impcat,9.00,RON,2,draft,false,true,,,\n"
        )
        # dry run
        res = await catalog.import_products_csv(session, good, dry_run=True)
        assert res["created"] == 1 and res["updated"] == 1 and not res["errors"]
        # real import
        res2 = await catalog.import_products_csv(session, good, dry_run=False)
        assert res2["created"] == 1 and res2["updated"] == 1

        # error rows: missing fields, bad price, bad currency, bad status,
        # and unknown category in dry-run
        bad = header + (
            ",NoSlug,impcat,1,RON,1,published,,,,,\n"
            "p2,Name,impcat,notnum,RON,1,published,,,,,\n"
            "p3,Name,impcat,1,EUR,1,published,,,,,\n"
            "p4,Name,impcat,1,RON,1,bogus,,,,,\n"
            "p5,Name,ghostcat,1,RON,1,published,,,,,\n"
        )
        res3 = await catalog.import_products_csv(session, bad, dry_run=True)
        assert len(res3["errors"]) == 5
        # real import with errors -> rollback
        res4 = await catalog.import_products_csv(session, bad, dry_run=False)
        assert res4["errors"]

        # non-dry-run auto-creates a missing category
        auto = header + "auto-prod,Auto,autocat,5,RON,1,published,,,,,\n"
        res5 = await catalog.import_products_csv(session, auto, dry_run=False)
        assert res5["created"] == 1
    await engine.dispose()


async def test_import_categories_csv() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    header = (
        "slug,name,parent_slug,sort_order,is_visible,description,"
        "name_ro,description_ro,name_en,description_en\n"
    )
    async with local() as session:
        await _seed_category(session, slug="root-cat", name="Root")
        await session.commit()

        good = header + (
            "root-cat,Root Updated,,1,true,desc,Ro,RoD,En,EnD\n"
            "kid,Kid,root-cat,2,false,,Kro,,Ken,\n"
        )
        res = await catalog.import_categories_csv(session, good, dry_run=True)
        assert res["updated"] == 1 and res["created"] == 1 and not res["errors"]
        res2 = await catalog.import_categories_csv(session, good, dry_run=False)
        assert res2["created"] == 1

        # validation errors: missing, bad slug, dup, parent==slug, bad sort,
        # desc-without-name, parent missing, cycle
        bad = header + (
            ",NoSlug,,,,,,,,\n"
            "Bad Slug,Name,,,,,,,,\n"
            "dupe,A,,,,,,,,\n"
            "dupe,B,,,,,,,,\n"
            "self,Self,self,,,,,,,\n"
            "badsort,BadSort,,notnum,,,,,,\n"
            "nodesc,NoDesc,,,,,,RoDescOnly,,\n"
            "orphan,Orphan,missingparent,,,,,,,\n"
        )
        res3 = await catalog.import_categories_csv(session, bad, dry_run=True)
        assert res3["errors"]
        # real import with errors -> rollback path
        res4 = await catalog.import_categories_csv(session, bad, dry_run=False)
        assert res4["errors"]
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Back-in-stock + low-stock threshold + notify
# --------------------------------------------------------------------------- #


async def test_back_in_stock_flow(_stub_services) -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        oos = await _seed_product(
            session,
            cat,
            slug="oos",
            sku="SKU-OOS",
            stock_quantity=0,
            allow_backorder=False,
        )
        user = User(
            email="bis@a.com",
            username="bis",
            hashed_password="x",
            role=UserRole.customer,
        )
        session.add(user)
        await session.commit()
        oos = await _load_product(session, oos.id)
        uid = user.id

        # in-stock product -> cannot request
        in_stock = await _seed_product(session, cat, slug="ins", sku="SKU-INS")
        await session.commit()
        with pytest.raises(HTTPException, match="in stock"):
            await catalog.create_back_in_stock_request(
                session, user_id=uid, product=await _load_product(session, in_stock.id)
            )

        req = await catalog.create_back_in_stock_request(
            session, user_id=uid, product=oos
        )
        # duplicate request returns the existing one
        req2 = await catalog.create_back_in_stock_request(
            session, user_id=uid, product=oos
        )
        assert req2.id == req.id

        active = await catalog.get_active_back_in_stock_request(
            session, user_id=uid, product_id=oos.id
        )
        assert active is not None

        # fulfilment sends email
        sent = await catalog.fulfill_back_in_stock_requests(session, product=oos)
        assert sent == 1
        # no pending -> 0
        assert await catalog.fulfill_back_in_stock_requests(session, product=oos) == 0

        # cancel: re-create then cancel
        await catalog.create_back_in_stock_request(session, user_id=uid, product=oos)
        canceled = await catalog.cancel_back_in_stock_request(
            session, user_id=uid, product_id=oos.id
        )
        assert canceled is not None and canceled.canceled_at is not None
        # cancel when none active -> None
        assert (
            await catalog.cancel_back_in_stock_request(
                session, user_id=uid, product_id=oos.id
            )
            is None
        )

        # notify_back_in_stock helper
        assert await catalog.notify_back_in_stock(["a@a.com", "b@a.com"], "P") == 2
    await engine.dispose()


async def test_low_stock_threshold_resolution() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session, low_stock_threshold=5)
        # product-level override
        p_override = await _seed_product(
            session, cat, slug="lo1", sku="SKU-LO1", low_stock_threshold=3
        )
        # falls back to category override
        p_cat = await _seed_product(
            session, cat, slug="lo2", sku="SKU-LO2", stock_quantity=1
        )
        await session.commit()
        p_override = await _load_product(session, p_override.id)
        p_cat = await _load_product(session, p_cat.id)

        assert (
            await catalog._effective_low_stock_threshold(
                session, product=p_override, default_threshold=2
            )
            == 3
        )
        assert (
            await catalog._effective_low_stock_threshold(
                session, product=p_cat, default_threshold=2
            )
            == 5
        )
        # alert fires when at/under threshold
        await catalog._maybe_alert_low_stock(session, p_cat)
        # above threshold -> no alert
        p_cat.stock_quantity = 100
        await catalog._maybe_alert_low_stock(session, p_cat)
    await engine.dispose()


# --------------------------------------------------------------------------- #
# Final gap closers
# --------------------------------------------------------------------------- #


async def test_validate_parent_assignment_invalid_hierarchy() -> None:
    """A pre-existing cycle in the stored hierarchy trips the seen-guard
    'Invalid category hierarchy' branch (line 152)."""
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        x = await _seed_category(session, slug="x", name="X")
        y = await _seed_category(session, slug="y", name="Y", parent_id=x.id)
        await session.commit()
        # Manufacture a stored cycle x->y->x (bypassing validation).
        x.parent_id = y.id
        session.add(x)
        await session.commit()
        z = await _seed_category(session, slug="z", name="Z")
        await session.commit()
        with pytest.raises(HTTPException, match="Invalid category hierarchy"):
            await catalog._validate_category_parent_assignment(
                session, category_id=z.id, parent_id=x.id
            )
    await engine.dispose()


async def test_category_descendants_diamond() -> None:
    """A diamond (two parents pointing to the same child) exercises the
    already-seen ``continue`` (101) and child-in-seen guard (110->109)."""
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        root = await _seed_category(session, slug="d-root", name="R")
        a = await _seed_category(session, slug="d-a", name="A", parent_id=root.id)
        b = await _seed_category(session, slug="d-b", name="B", parent_id=root.id)
        await session.commit()
        # make b a child of a too (a has children {b}; root has children {a,b})
        b.parent_id = a.id
        session.add(b)
        await session.commit()
        ids = await catalog._get_category_descendant_ids(session, root.id)
        # b reachable via both root and a; appears once
        assert ids.count(b.id) == 1
    await engine.dispose()


def test_compute_sale_price_none_when_not_below_base() -> None:
    # discount that makes price >= base -> None (line 785 path)
    assert (
        catalog._compute_sale_price(
            base_price=Decimal("50.00"), sale_type="amount", sale_value=Decimal("0.0")
        )
        is None
    )
    # unknown sale_type -> None
    assert (
        catalog._compute_sale_price(
            base_price=Decimal("50.00"), sale_type="bogus", sale_value=Decimal("5")
        )
        is None
    )
    # percent >= 100 -> price 0.00
    assert catalog._compute_sale_price(
        base_price=Decimal("50.00"), sale_type="percent", sale_value=Decimal("150")
    ) == Decimal("0.00")
    # base <= 0 -> None
    assert (
        catalog._compute_sale_price(
            base_price=Decimal("0"), sale_type="amount", sale_value=Decimal("5")
        )
        is None
    )
    # percent discount that rounds to 0 -> price == base -> None (line 785)
    assert (
        catalog._compute_sale_price(
            base_price=Decimal("0.01"), sale_type="percent", sale_value=Decimal("1")
        )
        is None
    )


async def test_update_category_clear_tax_group() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session, slug="tg", name="Tg")
        await session.commit()
        # tax_group_id None -> skip lookup
        updated = await catalog.update_category(
            session, cat, CategoryUpdate(tax_group_id=None)
        )
        assert updated is cat
    await engine.dispose()


async def test_reorder_with_none_sort_order() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        await _seed_category(session, slug="ro1", name="RO1", sort_order=1)
        await session.commit()
        out = await catalog.reorder_categories(
            session,
            [CategoryReorderItem.model_construct(slug="ro1", sort_order=None)],
        )
        assert out == []
    await engine.dispose()


async def test_slug_history_with_lang_options() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat, slug="cur", sku="SKU-LH")
        session.add(ProductSlugHistory(product_id=prod.id, slug="past"))
        await session.commit()
        via = await catalog.get_product_by_slug(session, "past", lang="ro")
        assert via is not None and via.id == prod.id
    await engine.dispose()


async def test_record_slug_history_direct() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat, sku="SKU-RSH")
        await session.commit()
        await catalog._record_slug_history(session, prod, "former-slug")
        await session.commit()
        rows = list(
            await session.scalars(
                __import__("sqlalchemy")
                .select(ProductSlugHistory)
                .where(ProductSlugHistory.product_id == prod.id)
            )
        )
        assert any(r.slug == "former-slug" for r in rows)
    await engine.dispose()


async def test_recompute_rating_no_product() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        await catalog.recompute_product_rating(session, uuid.uuid4())
    await engine.dispose()


def test_dedupe_uuid_list() -> None:
    a = uuid.uuid4()
    b = uuid.uuid4()
    assert catalog._dedupe_uuid_list([a, b, a]) == [a, b]


async def test_notify_back_in_stock_partial_failure(monkeypatch) -> None:
    calls = {"n": 0}

    async def _maybe(email, name):
        calls["n"] += 1
        return calls["n"] != 1  # first send "fails"

    monkeypatch.setattr(email_service, "send_back_in_stock", _maybe)
    sent = await catalog.notify_back_in_stock(["a@a.com", "b@a.com"], "P")
    assert sent == 1


async def test_relationships_clear_all() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat, slug="rc", sku="SKU-RC")
        await session.commit()
        prod = await _load_product(session, prod.id)
        # empty payload -> candidate_ids empty (2550 skip) and no rows (2588 skip)
        out = await catalog.update_product_relationships(
            session,
            product=prod,
            payload=ProductRelationshipsUpdate(),
        )
        assert out.related_product_ids == [] and out.upsell_product_ids == []
    await engine.dispose()


async def test_variant_create_with_stock_and_delete_with_stock() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat, sku="SKU-VS")
        keep = ProductVariant(
            product_id=prod.id,
            name="Keep",
            stock_quantity=4,
            additional_price_delta=Decimal("0"),
        )
        session.add(keep)
        await session.commit()
        prod = await _load_product(session, prod.id)
        keep_id = next(v.id for v in prod.variants if v.name == "Keep")

        # create a new variant WITH stock (1308) and delete one WITH stock (1335)
        out = await catalog.update_product_variants(
            session,
            product=prod,
            payload=ProductVariantMatrixUpdate(
                variants=[ProductVariantUpsert(name="FreshStock", stock_quantity=6)],
                delete_variant_ids=[keep_id],
            ),
        )
        assert any(v.name == "FreshStock" for v in out)
    await engine.dispose()


async def test_restore_soft_deleted_slug_collision() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        deleted = await _seed_product(session, cat, slug="taken", sku="SKU-T1")
        await session.commit()
        deleted = await _load_product(session, deleted.id)
        await catalog.soft_delete_product(session, deleted)
        # another product now occupies the original slug
        await _seed_product(session, cat, slug="taken", sku="SKU-T2")
        await session.commit()
        deleted = await _load_product(session, deleted.id)
        restored = await catalog.restore_soft_deleted_product(session, deleted)
        assert restored.slug == "taken-2"
    await engine.dispose()


async def test_price_bounds_and_filters_include_unpublished() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session, slug="iu", name="IU")
        await _seed_product(
            session,
            cat,
            slug="draftp",
            sku="SKU-DR",
            status=ProductStatus.draft,
            is_active=False,
        )
        await session.commit()
        lo, hi, _ = await catalog.get_product_price_bounds(
            session, "iu", None, None, None, None, include_unpublished=True
        )
        assert hi >= lo
        items, total = await catalog.list_products_with_filters(
            session,
            category_slug="iu",
            on_sale=None,
            is_featured=None,
            search=None,
            min_price=None,
            max_price=None,
            tags=None,
            sort=None,
            limit=10,
            offset=0,
            include_unpublished=True,
        )
        assert total == 1
    await engine.dispose()


async def test_get_or_create_tags_reuse_existing() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        first = await catalog._get_or_create_tags(session, ["reuse"])
        await session.commit()
        again = await catalog._get_or_create_tags(session, ["reuse", "fresh"])
        assert again[0].id == first[0].id
    await engine.dispose()


async def test_recently_viewed_cap_cleanup() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        products = [
            await _seed_product(session, cat, slug=f"rvc{i}", sku=f"SKU-RVC{i}")
            for i in range(3)
        ]
        await session.commit()
        products = [await _load_product(session, p.id) for p in products]
        uid = uuid.uuid4()
        # record 3 with cap 2 -> the oldest is cleaned up (2651/2653)
        for p in products:
            await catalog.record_recently_viewed(session, p, uid, None, limit=2)
        got = await catalog.get_recently_viewed(session, uid, None, limit=10)
        assert len(got) == 2
    await engine.dispose()


async def test_back_in_stock_owner_notification(monkeypatch) -> None:
    """A real owner triggers the owner-notification arm (3232-3242)."""
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        oos = await _seed_product(
            session,
            cat,
            slug="oon",
            sku="SKU-OON",
            stock_quantity=0,
            allow_backorder=False,
        )
        owner = User(
            email="owner@a.com",
            username="owner",
            hashed_password="x",
            role=UserRole.admin,
        )
        user = User(
            email="cust@a.com",
            username="cust",
            hashed_password="x",
            role=UserRole.customer,
        )
        session.add_all([owner, user])
        await session.commit()
        oos = await _load_product(session, oos.id)

        async def _owner_user(_session):
            return owner

        notes = []

        async def _create_notification(_session, **kwargs):
            notes.append(kwargs)
            return None

        monkeypatch.setattr(auth_service, "get_owner_user", _owner_user)
        monkeypatch.setattr(
            notifications_service, "create_notification", _create_notification
        )
        await catalog.create_back_in_stock_request(
            session, user_id=user.id, product=oos
        )
        assert notes  # owner was notified
    await engine.dispose()


async def test_back_in_stock_owner_notification_failure(monkeypatch) -> None:
    """The owner-notification failure is swallowed (3243-3253 best-effort)."""
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        oos = await _seed_product(
            session,
            cat,
            slug="oof",
            sku="SKU-OOF",
            stock_quantity=0,
            allow_backorder=False,
        )
        owner = User(
            email="o2@a.com", username="o2", hashed_password="x", role=UserRole.admin
        )
        user = User(
            email="c2@a.com",
            username="c2",
            hashed_password="x",
            role=UserRole.customer,
        )
        session.add_all([owner, user])
        await session.commit()
        oos = await _load_product(session, oos.id)

        async def _owner_user(_session):
            return owner

        async def _boom(*a, **k):
            raise RuntimeError("notify down")

        monkeypatch.setattr(auth_service, "get_owner_user", _owner_user)
        monkeypatch.setattr(notifications_service, "create_notification", _boom)
        # should not raise despite the failing notification
        rec = await catalog.create_back_in_stock_request(
            session, user_id=user.id, product=oos
        )
        assert rec is not None
    await engine.dispose()


def test_queue_stock_adjustment_noop() -> None:
    # equal before/after -> early return (line 1226), no exception
    from sqlalchemy.ext.asyncio import AsyncSession

    catalog._queue_stock_adjustment(
        AsyncSession.__new__(AsyncSession),
        product_id=uuid.uuid4(),
        variant_id=None,
        before_quantity=5,
        after_quantity=5,
        reason=StockAdjustmentReason.manual_correction,
        note=None,
        user_id=None,
    )


def test_set_publish_timestamp_no_status() -> None:
    from types import SimpleNamespace

    prod = SimpleNamespace(publish_at=None)
    catalog._set_publish_timestamp(prod, None)
    assert prod.publish_at is None


async def test_effective_threshold_category_not_loaded() -> None:
    """A product stub whose ``.category`` is None falls through to the DB scalar
    lookup keyed by ``category_id`` (3150->3152 false side)."""
    from types import SimpleNamespace

    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(
            session, slug="thr", name="Thr", low_stock_threshold=4
        )
        await session.commit()
        stub = SimpleNamespace(
            low_stock_threshold=None, category=None, category_id=cat.id
        )
        threshold = await catalog._effective_low_stock_threshold(
            session, product=stub, default_threshold=2
        )
        assert threshold == 4
        # no category override anywhere -> default
        cat2 = await _seed_category(session, slug="thr2", name="Thr2")
        await session.commit()
        stub2 = SimpleNamespace(
            low_stock_threshold=None, category=None, category_id=cat2.id
        )
        assert (
            await catalog._effective_low_stock_threshold(
                session, product=stub2, default_threshold=7
            )
            == 7
        )
    await engine.dispose()


async def test_update_product_sale_change_drafts_published() -> None:
    """Changing the sale on a published product moves it back to draft
    (1160 true side) and a no-op update yields no changes (1198 false)."""
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(
            session,
            cat,
            sku="SKU-SC",
            status=ProductStatus.published,
            sale_type="percent",
            sale_value=Decimal("10"),
            sale_price=Decimal("45.00"),
        )
        await session.commit()
        prod = await _load_product(session, prod.id)
        updated = await catalog.update_product(
            session, prod, ProductUpdate(sale_value=Decimal("25"))
        )
        assert updated.status == ProductStatus.draft

        # no-op update -> changes dict empty (1198 false side)
        prod2 = await _load_product(session, updated.id)
        await catalog.update_product(session, prod2, ProductUpdate())
    await engine.dispose()


async def test_update_product_sale_change_on_draft_stays_draft() -> None:
    """Changing the sale on an already-draft product: sale_changed is True but
    status is not published, so the status-flip ``and`` takes its false side
    (1164 / 1160->1162 partial)."""
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(
            session,
            cat,
            sku="SKU-SCD",
            status=ProductStatus.draft,
            sale_type="percent",
            sale_value=Decimal("10"),
            sale_price=Decimal("45.00"),
        )
        await session.commit()
        prod = await _load_product(session, prod.id)
        updated = await catalog.update_product(
            session, prod, ProductUpdate(sale_value=Decimal("30"))
        )
        assert updated.status == ProductStatus.draft
    await engine.dispose()


async def test_bulk_update_field_branches() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        p = await _seed_product(session, cat, slug="bf", sku="SKU-BF", stock_quantity=5)
        await session.commit()
        # sale_auto_publish True (bool branch 1664), sort_order set (1686),
        # stock unchanged (1740 false), is_featured set
        updates = [
            BulkProductUpdateItem(
                product_id=p.id,
                base_price=Decimal("60.00"),
                sale_type="amount",
                sale_value=Decimal("5"),
                sale_start_at=datetime.now(UTC),
                sale_auto_publish=True,
                sort_order=3,
                stock_quantity=5,  # unchanged
                is_featured=True,
            )
        ]
        out = await catalog.bulk_update_products(session, updates)
        assert out[0].sort_order == 3
    await engine.dispose()


async def test_bulk_update_field_explicit_none() -> None:
    """A generic field present in the patch but explicitly None takes the
    ``data[field] is not None`` false side (1686->1643)."""
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        p = await _seed_product(session, cat, slug="bn", sku="SKU-BN", is_featured=True)
        await session.commit()
        # force is_featured into the patch as None via model_construct
        item = BulkProductUpdateItem.model_construct(product_id=p.id, is_featured=None)
        out = await catalog.bulk_update_products(session, [item])
        # untouched because the value was None
        assert out[0].is_featured is True
    await engine.dispose()


async def test_bulk_update_schedule_validation() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        p = await _seed_product(session, cat, sku="SKU-BSC")
        await session.commit()
        with pytest.raises(HTTPException, match="after publish schedule"):
            await catalog.bulk_update_products(
                session,
                [
                    BulkProductUpdateItem(
                        product_id=p.id,
                        publish_scheduled_for=datetime.now(UTC) + timedelta(days=2),
                        unpublish_scheduled_for=datetime.now(UTC) + timedelta(days=1),
                    )
                ],
            )
    await engine.dispose()


async def test_variant_create_zero_stock_and_delete_zero_stock() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat, sku="SKU-VZ")
        zero = ProductVariant(
            product_id=prod.id,
            name="Zero",
            stock_quantity=0,
            additional_price_delta=Decimal("0"),
        )
        session.add(zero)
        await session.commit()
        prod = await _load_product(session, prod.id)
        zero_id = next(v.id for v in prod.variants if v.name == "Zero")
        out = await catalog.update_product_variants(
            session,
            product=prod,
            payload=ProductVariantMatrixUpdate(
                variants=[ProductVariantUpsert(name="NewZero", stock_quantity=0)],
                delete_variant_ids=[zero_id],
            ),
        )
        assert any(v.name == "NewZero" for v in out)
    await engine.dispose()


async def test_descendants_with_stored_cycle() -> None:
    """A stored cycle root -> a -> root makes a's child (root) already-seen, so
    the ``child_id not in seen`` guard takes its false side (110->109) without
    infinite-looping."""
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        root = await _seed_category(session, slug="cy-root", name="R")
        a = await _seed_category(session, slug="cy-a", name="A", parent_id=root.id)
        await session.commit()
        # close the cycle: root's parent becomes a (so a's descendant query yields
        # root, which is already seen)
        root.parent_id = a.id
        session.add(root)
        await session.commit()
        ids = await catalog._get_category_descendant_ids(session, root.id)
        assert root.id in ids and a.id in ids
        # each appears once despite the cycle
        assert ids.count(root.id) == 1 and ids.count(a.id) == 1
    await engine.dispose()


async def test_get_product_by_slug_history_orphan() -> None:
    """A slug-history row whose product row was removed (raw delete, leaving the
    history orphaned under SQLite's default FK-off) -> the history branch's
    ``if product`` guard is False (527 false side)."""
    from sqlalchemy import delete as _delete, text

    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        prod = await _seed_product(session, cat, slug="live2", sku="SKU-ORPH")
        session.add(ProductSlugHistory(product_id=prod.id, slug="orphan-slug"))
        await session.commit()
        pid = prod.id
        # Remove the product row directly, leaving the history row orphaned.
        await session.execute(text("PRAGMA foreign_keys=OFF"))
        await session.execute(_delete(Product).where(Product.id == pid))
        await session.commit()
        session.expunge_all()
        result = await catalog.get_product_by_slug(session, "orphan-slug")
        assert result is None
    await engine.dispose()


async def test_import_categories_real_translation_update_and_invalid_hierarchy() -> (
    None
):
    engine, local = _make_engine_and_local()
    await _init(engine)
    header = (
        "slug,name,parent_slug,sort_order,is_visible,description,"
        "name_ro,description_ro,name_en,description_en\n"
    )
    async with local() as session:
        cat = await _seed_category(session, slug="trcat", name="TrCat")
        session.add(
            CategoryTranslation(
                category_id=cat.id, lang="ro", name="OldRo", description="old"
            )
        )
        await session.commit()
        # real import updates the existing ro translation (3105-3107). The new
        # "onlyro" row has name_ro but no name_en, so the "en" lang iteration
        # hits the ``if not raw_name: continue`` skip (3087).
        csv_in = header + (
            "trcat,TrCat,,1,true,,NewRo,NewDesc,NewEn,\n"
            "onlyro,OnlyRo,,2,true,,JustRo,,,\n"
        )
        res = await catalog.import_categories_csv(session, csv_in, dry_run=False)
        assert not res["errors"]
        tr = await catalog.list_category_translations(session, cat)
        assert any(t.lang == "ro" and t.name == "NewRo" for t in tr)
        only = await catalog.get_category_by_slug(session, "onlyro")
        only_tr = await catalog.list_category_translations(session, only)
        assert [t.lang for t in only_tr] == ["ro"]
    await engine.dispose()


async def test_import_categories_error_and_upsert_branches() -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    header = (
        "slug,name,parent_slug,sort_order,is_visible,description,"
        "name_ro,description_ro,name_en,description_en\n"
    )
    async with local() as session:
        # description_en without name_en (2937-2938) in dry-run
        bad_en = header + "deen,DeEn,,,,,,,,EnDescOnly\n"
        res = await catalog.import_categories_csv(session, bad_en, dry_run=True)
        assert any("description_en" in e for e in res["errors"])

        # dry-run cycle across proposed rows: a->b, b->a (3006-3009)
        cyc = header + ("ca,CA,cb,,,,,,,\ncb,CB,ca,,,,,,,\n")
        res2 = await catalog.import_categories_csv(session, cyc, dry_run=True)
        assert any("cycle" in e for e in res2["errors"])

        # dry-run invalid hierarchy: a->b, b->c, c->b. Walking `a` revisits b
        # without ever equalling a -> "Invalid category hierarchy" (3011-3014).
        invalid = header + ("ha,HA,hb,,,,,,,\nhb,HB,hc,,,,,,,\nhc,HC,hb,,,,,,,\n")
        res_inv = await catalog.import_categories_csv(session, invalid, dry_run=True)
        assert any("Invalid category hierarchy" in e for e in res_inv["errors"])

        # clean real import with is_visible set (3040) on update of existing row
        await _seed_category(session, slug="vis", name="Vis")
        await session.commit()
        upd = header + "vis,Vis Updated,,3,false,,,,,\n"
        res3 = await catalog.import_categories_csv(session, upd, dry_run=False)
        assert res3["updated"] == 1 and not res3["errors"]
        refreshed = await catalog.get_category_by_slug(session, "vis")
        assert refreshed.is_visible is False
    await engine.dispose()


async def test_import_categories_parent_cycle_real_rollback() -> None:
    """A stored cycle makes _validate_category_parent_assignment raise during the
    real (non-dry-run) parent-assignment phase -> rollback (3072-3080)."""
    engine, local = _make_engine_and_local()
    await _init(engine)
    header = (
        "slug,name,parent_slug,sort_order,is_visible,description,"
        "name_ro,description_ro,name_en,description_en\n"
    )
    async with local() as session:
        # Pre-create a stored cycle p1<->p2 so assigning p1's parent trips it.
        p1 = await _seed_category(session, slug="pc1", name="PC1")
        p2 = await _seed_category(session, slug="pc2", name="PC2", parent_id=p1.id)
        await session.commit()
        p1.parent_id = p2.id
        session.add(p1)
        await session.commit()
        # Real import that re-parents pc1 under pc2 (already cyclic) -> error path.
        csv_in = header + "pc1,PC1,pc2,,,,,,,\n"
        res = await catalog.import_categories_csv(session, csv_in, dry_run=False)
        assert res["errors"]
    await engine.dispose()


async def test_fulfill_skips_request_without_email(monkeypatch) -> None:
    engine, local = _make_engine_and_local()
    await _init(engine)
    async with local() as session:
        cat = await _seed_category(session)
        oos = await _seed_product(
            session,
            cat,
            slug="noemail",
            sku="SKU-NE",
            stock_quantity=0,
            allow_backorder=False,
        )
        # a user whose email is empty string -> fulfilment skips sending
        user = User(
            email="",
            username="noemail",
            hashed_password="x",
            role=UserRole.customer,
        )
        session.add(user)
        await session.flush()
        session.add(BackInStockRequest(user_id=user.id, product_id=oos.id))
        await session.commit()
        oos = await _load_product(session, oos.id)
        sent = await catalog.fulfill_back_in_stock_requests(session, product=oos)
        assert sent == 0
    await engine.dispose()
