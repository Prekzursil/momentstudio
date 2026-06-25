"""Lean-gate unit coverage for ``app.services.order_document_exports``."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.order import Order
from app.models.order_document_export import OrderDocumentExportKind
from app.services import order_document_exports as svc


def _memory_session_factory() -> async_sessionmaker:
    import app.models  # noqa: F401
    from app.db.base import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return factory


@pytest.fixture
def session_factory():
    return _memory_session_factory()


@pytest.fixture(autouse=True)
def _private_root(tmp_path, monkeypatch):
    monkeypatch.setattr(svc.settings, "private_media_root", str(tmp_path))
    monkeypatch.setattr(
        svc.private_storage.settings, "private_media_root", str(tmp_path)
    )
    return tmp_path


# --------------------------------------------------------------------------- #
# _compute_expires_at                                                          #
# --------------------------------------------------------------------------- #
def test_compute_expires_at_with_retention(monkeypatch) -> None:
    monkeypatch.setattr(svc.settings, "order_export_retention_days", 7, raising=False)
    now = datetime(2024, 1, 1, tzinfo=timezone.utc)
    out = svc._compute_expires_at(now)
    assert out is not None
    assert (out - now).days == 7


def test_compute_expires_at_zero_retention(monkeypatch) -> None:
    monkeypatch.setattr(svc.settings, "order_export_retention_days", 0, raising=False)
    assert svc._compute_expires_at(datetime.now(timezone.utc)) is None


# --------------------------------------------------------------------------- #
# create_pdf_export                                                            #
# --------------------------------------------------------------------------- #
@pytest.mark.anyio
async def test_create_pdf_export_writes_file_and_row(
    session_factory, _private_root, monkeypatch
) -> None:
    monkeypatch.setattr(svc.settings, "order_export_retention_days", 30, raising=False)
    async with session_factory() as session:
        export = await svc.create_pdf_export(
            session,
            kind=OrderDocumentExportKind.receipt,
            filename="receipt.pdf",
            content=b"%PDF-1.4 fake",
            order_ids=[],
            created_by_user_id=None,
        )
        assert export.mime_type == "application/pdf"
        assert export.filename == "receipt.pdf"
        assert export.order_ids is None  # empty list collapses to None
        assert export.expires_at is not None
        written = (_private_root / export.file_path).read_bytes()
        assert written == b"%PDF-1.4 fake"


@pytest.mark.anyio
async def test_create_existing_file_export(session_factory) -> None:
    async with session_factory() as session:
        export = await svc.create_existing_file_export(
            session,
            kind=OrderDocumentExportKind.shipping_label,
            filename="label.pdf",
            rel_path="exports/orders/existing.pdf",
            mime_type="application/pdf",
        )
        assert export.file_path == "exports/orders/existing.pdf"
        assert export.order_ids is None


# --------------------------------------------------------------------------- #
# list_exports / get_export                                                    #
# --------------------------------------------------------------------------- #
@pytest.mark.anyio
async def test_list_and_get_exports_with_order_reference(session_factory) -> None:
    async with session_factory() as session:
        order = Order(
            customer_email="c@example.com",
            customer_name="C",
            total_amount=5,
            reference_code="REF-1",
        )
        session.add(order)
        await session.commit()
        await session.refresh(order)

        linked = await svc.create_existing_file_export(
            session,
            kind=OrderDocumentExportKind.packing_slip,
            filename="slip.pdf",
            rel_path="exports/orders/a.pdf",
            mime_type="application/pdf",
            order_id=order.id,
        )
        await svc.create_existing_file_export(
            session,
            kind=OrderDocumentExportKind.receipt,
            filename="r.pdf",
            rel_path="exports/orders/b.pdf",
            mime_type="application/pdf",
        )

        # page/limit clamping: limit=0 clamps up to a minimum of 1 row/page.
        rows, total = await svc.list_exports(session, page=0, limit=0)
        assert total == 2
        assert len(rows) == 1

        # large limit gets capped at 200 (returns everything here).
        rows2, total2 = await svc.list_exports(session, page=1, limit=9999)
        assert total2 == 2
        assert len(rows2) == 2
        ref_map = {exp.id: ref for exp, ref in rows2}
        assert ref_map[linked.id] == "REF-1"

        found, ref = await svc.get_export(session, linked.id)
        assert found is not None
        assert ref == "REF-1"


@pytest.mark.anyio
async def test_get_export_missing_returns_none(session_factory) -> None:
    import uuid

    async with session_factory() as session:
        export, ref = await svc.get_export(session, uuid.uuid4())
        assert export is None
        assert ref is None
