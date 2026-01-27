from datetime import datetime, timezone

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.newsletter import NewsletterSubscriber
from app.schemas.newsletter import NewsletterSubscribeRequest, NewsletterSubscribeResponse
from app.services import captcha as captcha_service

router = APIRouter(prefix="/newsletter", tags=["newsletter"])


@router.post("/subscribe", response_model=NewsletterSubscribeResponse)
async def subscribe_newsletter(
    payload: NewsletterSubscribeRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> NewsletterSubscribeResponse:
    await captcha_service.verify(payload.captcha_token, remote_ip=request.client.host if request.client else None)

    email = str(payload.email or "").strip().lower()
    source = (payload.source or "").strip()[:64] or None

    existing = await session.scalar(sa.select(NewsletterSubscriber).where(NewsletterSubscriber.email == email))
    now = datetime.now(timezone.utc)
    if existing:
        if existing.unsubscribed_at is None:
            return NewsletterSubscribeResponse(subscribed=True, already_subscribed=True)
        existing.unsubscribed_at = None
        existing.subscribed_at = now
        if source:
            existing.source = source
        session.add(existing)
        await session.commit()
        return NewsletterSubscribeResponse(subscribed=True, already_subscribed=False)

    session.add(NewsletterSubscriber(email=email, source=source, subscribed_at=now))
    await session.commit()
    return NewsletterSubscribeResponse(subscribed=True, already_subscribed=False)

