from __future__ import annotations

import logging
import re
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_user_optional
from app.db.session import get_session
from app.core.rate_limit import per_identifier_limiter
from app.services import analytics_tokens
from app.models.analytics_event import AnalyticsEvent
from app.models.user import User
from app.schemas.analytics import (
    AnalyticsEventCreate,
    AnalyticsEventIngestResponse,
    AnalyticsTokenRequest,
    AnalyticsTokenResponse,
)


router = APIRouter(prefix="/analytics", tags=["analytics"])
logger = logging.getLogger(__name__)

analytics_rate_limit = per_identifier_limiter(
    lambda r: r.client.host if r.client else "anon",
    settings.analytics_rate_limit_events,
    60,
    key="analytics:events",
)

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


def _normalize_payload_key(key: object) -> str | None:
    if not isinstance(key, str):
        return None
    normalized = key.strip()
    return normalized or None


def _sanitize_payload_value(value: object) -> object:
    if isinstance(value, str) and len(value) > 500:
        return value[:500]
    return value


def _sanitize_payload(value: dict | None) -> dict | None:
    if not isinstance(value, dict):
        return None
    # Keep payload small and predictable.
    trimmed: dict = {}
    for idx, (key, val) in enumerate(value.items()):
        if idx >= 50:
            break
        normalized_key = _normalize_payload_key(key)
        if normalized_key is None:
            continue
        trimmed[normalized_key] = _sanitize_payload_value(val)
    return trimmed or None


def _require_supported_event(raw_event: str) -> str:
    event = _normalize_event(raw_event)
    if _EVENT_RE.match(event) and event in _ALLOWED_EVENTS:
        return event
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported analytics event")


def _require_session_id(raw_session_id: str) -> str:
    session_id = _normalize_session_id(raw_session_id)
    if session_id:
        return session_id
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing session_id")


def _is_token_valid(raw_token: str, session_id: str) -> bool:
    return analytics_tokens.validate_analytics_token(token=raw_token, session_id=session_id)


def _enforce_token_policy(raw_token: str, session_id: str) -> None:
    if bool(getattr(settings, "analytics_require_token", False)):
        if not raw_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Analytics token required",
                headers={"X-Error-Code": "analytics_token_required"},
            )
        if not _is_token_valid(raw_token, session_id):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid analytics token",
                headers={"X-Error-Code": "analytics_token_invalid"},
            )
        return

    if raw_token and not _is_token_valid(raw_token, session_id):
        return


def _extract_order_id(payload: AnalyticsEventCreate) -> UUID | None:
    if payload.order_id is not None:
        return payload.order_id

    payload_data = payload.payload
    if not isinstance(payload_data, dict):
        return None

    raw_order_id = payload_data.get("order_id")
    if not isinstance(raw_order_id, str):
        return None

    try:
        return UUID(raw_order_id)
    except ValueError:
        return None


async def _read_request_body_best_effort(request: Request, log_message: str) -> None:
    # Best-effort: browsers may disconnect early.
    try:
        await request.body()
    except Exception as exc:
        logger.debug(log_message, exc_info=exc)


@router.post("/token")
async def mint_analytics_token(
    payload: AnalyticsTokenRequest,
    request: Request,
    _: Annotated[None, Depends(analytics_rate_limit)],
) -> AnalyticsTokenResponse:
    session_id = _normalize_session_id(payload.session_id)
    if not session_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing session_id")
    ttl_seconds = int(getattr(settings, "analytics_token_ttl_seconds", 60 * 60 * 24) or 60 * 60 * 24)
    token = analytics_tokens.create_analytics_token(session_id=session_id)

    await _read_request_body_best_effort(request, "analytics_token_request_body_read_failed")

    return AnalyticsTokenResponse(token=token, expires_in=max(ttl_seconds, 60))


@router.post("/events")
async def ingest_analytics_event(
    payload: AnalyticsEventCreate,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User | None, Depends(get_current_user_optional)],
    _: Annotated[None, Depends(analytics_rate_limit)],
) -> AnalyticsEventIngestResponse:
    event = _require_supported_event(payload.event)
    session_id = _require_session_id(payload.session_id)
    raw_token = (request.headers.get("x-analytics-token") or "").strip()
    _enforce_token_policy(raw_token, session_id)
    order_id = _extract_order_id(payload)

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
    await _read_request_body_best_effort(request, "analytics_event_request_body_read_failed")

    return AnalyticsEventIngestResponse(received=True)
