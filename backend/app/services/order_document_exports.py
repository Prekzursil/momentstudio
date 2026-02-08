from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from functools import partial
from uuid import UUID

import anyio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.order import Order
from app.models.order_document_export import OrderDocumentExport, OrderDocumentExportKind
from app.services import private_storage


def _compute_expires_at(now: datetime) -> datetime | None:
    days = int(getattr(settings, "order_export_retention_days", 0) or 0)
    if days <= 0:
        return None
    return now + timedelta(days=days)


async def create_pdf_export(
    session: AsyncSession,
    *,
    kind: OrderDocumentExportKind,
    filename: str,
    content: bytes,
    order_id: UUID | None = None,
    order_ids: list[UUID] | None = None,
    created_by_user_id: UUID | None = None,
) -> OrderDocumentExport:
    export_id = uuid.uuid4()
    rel_path = await anyio.to_thread.run_sync(
        partial(
            private_storage.save_private_bytes,
            content,
            subdir="exports/orders",
            filename=f"{export_id}.pdf",
        )
    )
    now = datetime.now(timezone.utc)
    export = OrderDocumentExport(
        id=export_id,
        kind=kind,
        order_id=order_id,
        created_by_user_id=created_by_user_id,
        order_ids=[str(o) for o in (order_ids or [])] or None,
        file_path=rel_path,
        filename=filename,
        mime_type="application/pdf",
        expires_at=_compute_expires_at(now),
    )
    session.add(export)
    await session.commit()
    await session.refresh(export)
    return export


async def create_existing_file_export(
    session: AsyncSession,
    *,
    kind: OrderDocumentExportKind,
    filename: str,
    rel_path: str,
    mime_type: str,
    order_id: UUID | None = None,
    created_by_user_id: UUID | None = None,
) -> OrderDocumentExport:
    now = datetime.now(timezone.utc)
    export = OrderDocumentExport(
        kind=kind,
        order_id=order_id,
        created_by_user_id=created_by_user_id,
        order_ids=None,
        file_path=rel_path,
        filename=filename,
        mime_type=mime_type,
        expires_at=_compute_expires_at(now),
    )
    session.add(export)
    await session.commit()
    await session.refresh(export)
    return export


async def list_exports(
    session: AsyncSession,
    *,
    page: int = 1,
    limit: int = 50,
) -> tuple[list[tuple[OrderDocumentExport, str | None]], int]:
    page_clean = max(1, int(page or 0))
    limit_clean = max(1, min(int(limit or 0), 200))
    offset = (page_clean - 1) * limit_clean

    total = await session.scalar(select(func.count()).select_from(OrderDocumentExport))
    stmt = (
        select(OrderDocumentExport, Order.reference_code)
        .outerjoin(Order, Order.id == OrderDocumentExport.order_id)
        .order_by(OrderDocumentExport.created_at.desc())
        .limit(limit_clean)
        .offset(offset)
    )
    rows = (await session.execute(stmt)).all()
    return [(row[0], row[1]) for row in rows], int(total or 0)


async def get_export(session: AsyncSession, export_id: UUID) -> tuple[OrderDocumentExport | None, str | None]:
    row = (
        (
            await session.execute(
                select(OrderDocumentExport, Order.reference_code)
                .outerjoin(Order, Order.id == OrderDocumentExport.order_id)
                .where(OrderDocumentExport.id == export_id)
                .limit(1)
            )
        )
        .all()
    )
    if not row:
        return None, None
    export, ref = row[0]
    return export, ref
