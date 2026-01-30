from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content import ContentBlock, ContentStatus
from app.models.legal import LegalConsent, LegalConsentContext


REQUIRED_DOC_KEYS = ("page.terms-and-conditions", "page.privacy-policy")


async def required_doc_versions(session: AsyncSession, *, keys: tuple[str, ...] = REQUIRED_DOC_KEYS) -> dict[str, int]:
    now = datetime.now(timezone.utc)
    rows = (
        await session.execute(
            select(ContentBlock.key, ContentBlock.version).where(
                ContentBlock.key.in_(keys),
                ContentBlock.status == ContentStatus.published,
                or_(ContentBlock.published_at.is_(None), ContentBlock.published_at <= now),
                or_(ContentBlock.published_until.is_(None), ContentBlock.published_until > now),
            )
        )
    ).all()
    versions = {str(key): int(version) for key, version in rows if key and version is not None}
    missing = [key for key in keys if key not in versions]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Legal documents are not configured (missing published content: {', '.join(missing)})",
        )
    return versions


async def latest_accepted_versions(
    session: AsyncSession, *, user_id: UUID, keys: tuple[str, ...] = REQUIRED_DOC_KEYS
) -> dict[str, int]:
    rows = (
        await session.execute(
            select(LegalConsent.doc_key, func.max(LegalConsent.doc_version))
            .where(LegalConsent.user_id == user_id, LegalConsent.doc_key.in_(keys))
            .group_by(LegalConsent.doc_key)
        )
    ).all()
    return {str(key): int(version) for key, version in rows if key and version is not None}


def is_satisfied(required_versions: dict[str, int], accepted_versions: dict[str, int]) -> bool:
    for key, version in required_versions.items():
        if int(accepted_versions.get(key, 0) or 0) < int(version):
            return False
    return True


def add_consent_records(
    session: AsyncSession,
    *,
    context: LegalConsentContext,
    required_versions: dict[str, int],
    accepted_at: datetime | None = None,
    user_id: UUID | None = None,
    order_id: UUID | None = None,
) -> None:
    ts = accepted_at or datetime.now(timezone.utc)
    for key, version in required_versions.items():
        session.add(
            LegalConsent(
                doc_key=key,
                doc_version=int(version),
                context=context,
                user_id=user_id,
                order_id=order_id,
                accepted_at=ts,
            )
        )

