from __future__ import annotations

import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user_optional
from app.db.session import get_session
from app.models.analytics_event import AnalyticsEvent
from app.models.user import User
from app.schemas.analytics import AnalyticsEventCreate, AnalyticsEventIngestResponse


router = APIRouter(prefix="/analytics", tags=["analytics"])

_EVENT_RE = re.compile(r"^[a-z0-9_]{1,80}$")
_ALLOWED_EVENTS = {
    "session_start",
    "view_cart",
    "checkout_start",
    "checkout_abandon",
    "checkout_success",
}


def _normalize_event(value: str) -> str:
    return (value or "").strip().lower()


def _normalize_session_id(value: str) -> str:
    return (value or "").strip()[:100]


def _sanitize_payload(value: dict | None) -> dict | None:
    if not isinstance(value, dict):
        return None
    # Keep payload small and predictable.
    trimmed: dict = {}
    for idx, (key, val) in enumerate(value.items()):
        if idx >= 50:
            break
        if not isinstance(key, str):
            continue
        k = key.strip()
        if not k:
            continue
        if isinstance(val, str) and len(val) > 500:
            trimmed[k] = val[:500]
        else:
            trimmed[k] = val
    return trimmed or None


@router.post("/events", response_model=AnalyticsEventIngestResponse)
async def ingest_analytics_event(
    payload: AnalyticsEventCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User | None = Depends(get_current_user_optional),
) -> AnalyticsEventIngestResponse:
    event = _normalize_event(payload.event)
    if not _EVENT_RE.match(event) or event not in _ALLOWED_EVENTS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported analytics event")

    session_id = _normalize_session_id(payload.session_id)
    if not session_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing session_id")

    order_id: UUID | None = payload.order_id
    if not order_id and isinstance(payload.payload, dict):
        raw_order_id = payload.payload.get("order_id")
        if isinstance(raw_order_id, str):
            try:
                order_id = UUID(raw_order_id)
            except Exception:
                order_id = None

    record = AnalyticsEvent(
        session_id=session_id,
        event=event,
        path=(payload.path or "").strip()[:500] or None,
        payload=_sanitize_payload(payload.payload),
        user_id=getattr(user, "id", None),
        order_id=order_id,
    )
    session.add(record)
    await session.commit()

    # Best-effort: browsers may disconnect early.
    try:
        await request.body()
    except Exception:
        pass

    return AnalyticsEventIngestResponse(received=True)

