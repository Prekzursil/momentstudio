import hashlib
import json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.audit import AuditChainState
from app.models.catalog import ProductAuditLog
from app.models.content import ContentAuditLog
from app.models.user import AdminAuditLog


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def _hash_bytes(prev_hash: str, material: str) -> str:
    secret = (settings.audit_hash_chain_secret or settings.secret_key or "").encode("utf-8")
    hasher = hashlib.sha256()
    hasher.update(secret)
    hasher.update(b"\n")
    hasher.update((prev_hash or "").encode("utf-8"))
    hasher.update(b"\n")
    hasher.update(material.encode("utf-8"))
    return hasher.hexdigest()


async def _locked_chain_state(session: AsyncSession, entity: str) -> AuditChainState:
    state = (
        await session.execute(
            select(AuditChainState)
            .where(AuditChainState.entity == entity)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if state is not None:
        return state
    state = AuditChainState(entity=entity, tail_hash=None)
    session.add(state)
    await session.flush()
    return state


async def _apply_hash_chain(session: AsyncSession, entity: str, payload: dict[str, Any]) -> tuple[str | None, str]:
    state = await _locked_chain_state(session, entity)
    prev = state.tail_hash
    digest = _hash_bytes(prev or "", _canonical_json(payload))
    state.tail_hash = digest
    session.add(state)
    return prev, digest


def hash_chain_enabled() -> bool:
    return bool(getattr(settings, "audit_hash_chain_enabled", False))


async def add_product_audit_log(
    session: AsyncSession,
    *,
    product_id: UUID,
    action: str,
    user_id: UUID | None,
    payload: str | None,
) -> ProductAuditLog:
    audit = ProductAuditLog(product_id=product_id, action=action, user_id=user_id, payload=payload)
    if hash_chain_enabled():
        audit.created_at = datetime.now(timezone.utc)
        prev, digest = await _apply_hash_chain(
            session,
            "product",
            {
                "id": str(audit.id),
                "created_at": audit.created_at.isoformat(),
                "action": audit.action,
                "user_id": str(audit.user_id) if audit.user_id else None,
                "product_id": str(audit.product_id),
                "payload": audit.payload,
            },
        )
        audit.chain_prev_hash = prev
        audit.chain_hash = digest
    session.add(audit)
    return audit


async def add_content_audit_log(
    session: AsyncSession,
    *,
    content_block_id: UUID,
    action: str,
    version: int,
    user_id: UUID | None,
) -> ContentAuditLog:
    audit = ContentAuditLog(content_block_id=content_block_id, action=action, version=version, user_id=user_id)
    if hash_chain_enabled():
        audit.created_at = datetime.now(timezone.utc)
        prev, digest = await _apply_hash_chain(
            session,
            "content",
            {
                "id": str(audit.id),
                "created_at": audit.created_at.isoformat(),
                "action": audit.action,
                "user_id": str(audit.user_id) if audit.user_id else None,
                "content_block_id": str(audit.content_block_id),
                "version": audit.version,
            },
        )
        audit.chain_prev_hash = prev
        audit.chain_hash = digest
    session.add(audit)
    return audit


async def add_admin_audit_log(
    session: AsyncSession,
    *,
    action: str,
    actor_user_id: UUID | None,
    subject_user_id: UUID | None,
    data: dict[str, Any] | None,
) -> AdminAuditLog:
    audit = AdminAuditLog(
        action=action,
        actor_user_id=actor_user_id,
        subject_user_id=subject_user_id,
        data=data,
    )
    if hash_chain_enabled():
        audit.created_at = datetime.now(timezone.utc)
        prev, digest = await _apply_hash_chain(
            session,
            "security",
            {
                "id": str(audit.id),
                "created_at": audit.created_at.isoformat(),
                "action": audit.action,
                "actor_user_id": str(audit.actor_user_id) if audit.actor_user_id else None,
                "subject_user_id": str(audit.subject_user_id) if audit.subject_user_id else None,
                "data": audit.data,
            },
        )
        audit.chain_prev_hash = prev
        audit.chain_hash = digest
    session.add(audit)
    return audit

