import csv
from datetime import datetime, timedelta, timezone
from io import StringIO

import sqlalchemy as sa
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import require_admin_section
from app.db.session import get_session
from app.models.user import User
from app.models.newsletter import NewsletterSubscriber
from app.schemas.newsletter import (
    NewsletterConfirmResponse,
    NewsletterSubscribeRequest,
    NewsletterSubscribeResponse,
    NewsletterTokenRequest,
    NewsletterUnsubscribeResponse,
)
from app.services import captcha as captcha_service
from app.services import email as email_service
from app.services import newsletter_tokens

router = APIRouter(prefix="/newsletter", tags=["newsletter"])

_CONFIRM_RESEND_COOLDOWN = timedelta(minutes=2)


@router.post("/subscribe", response_model=NewsletterSubscribeResponse)
async def subscribe_newsletter(
    payload: NewsletterSubscribeRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
) -> NewsletterSubscribeResponse:
    await captcha_service.verify(payload.captcha_token, remote_ip=request.client.host if request.client else None)

    email = str(payload.email or "").strip().lower()
    source = (payload.source or "").strip()[:64] or None

    existing = await session.scalar(sa.select(NewsletterSubscriber).where(NewsletterSubscriber.email == email))
    now = datetime.now(timezone.utc)
    if existing:
        # Subscribed (either confirmed or pending confirmation).
        if existing.unsubscribed_at is None:
            should_send = False
            if existing.confirmed_at is None and settings.smtp_enabled:
                should_send = True
                if existing.confirmation_sent_at and now - existing.confirmation_sent_at < _CONFIRM_RESEND_COOLDOWN:
                    should_send = False
                if should_send:
                    existing.confirmation_sent_at = now

            if source:
                existing.source = source
            if should_send or source:
                session.add(existing)
                await session.commit()

            if should_send:
                token = newsletter_tokens.create_newsletter_token(
                    email=email, purpose=newsletter_tokens.NEWSLETTER_PURPOSE_CONFIRM
                )
                confirm_url = newsletter_tokens.build_frontend_confirm_url(token=token)
                background_tasks.add_task(email_service.send_newsletter_confirmation, email, confirm_url=confirm_url)

            return NewsletterSubscribeResponse(subscribed=True, already_subscribed=True)

        # Previously unsubscribed; start a new pending subscription.
        existing.unsubscribed_at = None
        existing.subscribed_at = now
        existing.confirmed_at = None
        if source:
            existing.source = source
        should_send = settings.smtp_enabled
        existing.confirmation_sent_at = now if should_send else None
        session.add(existing)
        await session.commit()

        if should_send:
            token = newsletter_tokens.create_newsletter_token(
                email=email, purpose=newsletter_tokens.NEWSLETTER_PURPOSE_CONFIRM
            )
            confirm_url = newsletter_tokens.build_frontend_confirm_url(token=token)
            background_tasks.add_task(email_service.send_newsletter_confirmation, email, confirm_url=confirm_url)

        return NewsletterSubscribeResponse(subscribed=True, already_subscribed=False)

    subscriber = NewsletterSubscriber(
        email=email,
        source=source,
        subscribed_at=now,
        confirmed_at=None,
        confirmation_sent_at=now if settings.smtp_enabled else None,
    )
    session.add(subscriber)
    await session.commit()

    if settings.smtp_enabled:
        token = newsletter_tokens.create_newsletter_token(
            email=email, purpose=newsletter_tokens.NEWSLETTER_PURPOSE_CONFIRM
        )
        confirm_url = newsletter_tokens.build_frontend_confirm_url(token=token)
        background_tasks.add_task(email_service.send_newsletter_confirmation, email, confirm_url=confirm_url)

    return NewsletterSubscribeResponse(subscribed=True, already_subscribed=False)


@router.post("/confirm", response_model=NewsletterConfirmResponse)
async def confirm_newsletter(
    payload: NewsletterTokenRequest,
    session: AsyncSession = Depends(get_session),
) -> NewsletterConfirmResponse:
    email = newsletter_tokens.decode_newsletter_token(token=payload.token, purpose=newsletter_tokens.NEWSLETTER_PURPOSE_CONFIRM)
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid confirmation token.")

    subscriber = await session.scalar(sa.select(NewsletterSubscriber).where(NewsletterSubscriber.email == email))
    now = datetime.now(timezone.utc)
    if subscriber:
        subscriber.unsubscribed_at = None
        subscriber.confirmed_at = now
        session.add(subscriber)
    else:
        session.add(
            NewsletterSubscriber(
                email=email,
                source="confirm",
                subscribed_at=now,
                confirmed_at=now,
                unsubscribed_at=None,
            )
        )

    user = await session.scalar(sa.select(User).where(User.email == email))
    if user:
        user.notify_marketing = True
        session.add(user)

    await session.commit()
    return NewsletterConfirmResponse(confirmed=True)


@router.api_route("/unsubscribe", methods=["GET"], response_model=NewsletterUnsubscribeResponse)
async def unsubscribe_newsletter_get(
    request: Request,
    token: str = Query(default="", max_length=5000),
    session: AsyncSession = Depends(get_session),
) -> NewsletterUnsubscribeResponse | HTMLResponse:
    result = await _unsubscribe_newsletter(token=token, session=session)
    accept = (request.headers.get("accept") or "").lower()
    if "text/html" in accept:
        frontend_origin = settings.frontend_origin.rstrip("/")
        html = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Unsubscribed</title>
  </head>
  <body>
    <h1>Unsubscribed</h1>
    <p>You will no longer receive marketing emails from us.</p>
    <p><a href="{frontend_origin}/">Return to the website</a></p>
  </body>
</html>
"""
        return HTMLResponse(content=html, status_code=200)
    return result


@router.post("/unsubscribe", response_model=NewsletterUnsubscribeResponse)
async def unsubscribe_newsletter_post(
    request: Request,
    token: str = Query(default="", max_length=5000),
    session: AsyncSession = Depends(get_session),
) -> NewsletterUnsubscribeResponse:
    resolved = token
    if not resolved:
        # RFC 8058 clients can POST form bodies (e.g. List-Unsubscribe=One-Click). We don't require any body.
        # Allow JSON bodies too for backward compatibility with our frontend.
        try:
            data = await request.json()
        except Exception:
            data = None
        if isinstance(data, dict):
            candidate = data.get("token")
            if isinstance(candidate, str):
                resolved = candidate
    return await _unsubscribe_newsletter(token=resolved, session=session)


async def _unsubscribe_newsletter(*, token: str, session: AsyncSession) -> NewsletterUnsubscribeResponse:
    email = newsletter_tokens.decode_newsletter_token(token=token, purpose=newsletter_tokens.NEWSLETTER_PURPOSE_UNSUBSCRIBE)
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid unsubscribe token.")

    subscriber = await session.scalar(sa.select(NewsletterSubscriber).where(NewsletterSubscriber.email == email))
    now = datetime.now(timezone.utc)
    if subscriber:
        subscriber.unsubscribed_at = now
        session.add(subscriber)
    else:
        session.add(
            NewsletterSubscriber(
                email=email,
                source="unsubscribe",
                subscribed_at=now,
                confirmed_at=None,
                unsubscribed_at=now,
            )
        )

    user = await session.scalar(sa.select(User).where(User.email == email))
    if user:
        user.notify_marketing = False
        session.add(user)

    await session.commit()
    return NewsletterUnsubscribeResponse(unsubscribed=True)


@router.get("/admin/export", response_class=StreamingResponse)
async def export_confirmed_subscribers_csv(
    session: AsyncSession = Depends(get_session),
    _: object = Depends(require_admin_section("ops")),
) -> StreamingResponse:
    result = await session.execute(
        sa.select(
            NewsletterSubscriber.email,
            NewsletterSubscriber.confirmed_at,
            NewsletterSubscriber.source,
        )
        .where(NewsletterSubscriber.confirmed_at.is_not(None))
        .where(NewsletterSubscriber.unsubscribed_at.is_(None))
        .order_by(NewsletterSubscriber.confirmed_at.desc())
    )

    buf = StringIO()
    writer = csv.writer(buf)
    writer.writerow(["email", "confirmed_at", "source"])
    for email, confirmed_at, source in result.all():
        confirmed_value = confirmed_at.isoformat() if confirmed_at else ""
        writer.writerow([email or "", confirmed_value, source or ""])

    content = buf.getvalue()
    headers = {"Content-Disposition": 'attachment; filename="newsletter_confirmed_subscribers.csv"'}
    return StreamingResponse(iter([content]), media_type="text/csv", headers=headers)
