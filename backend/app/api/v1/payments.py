from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_current_user_optional
from app.db.session import get_session
from app.models.cart import Cart
from app.services import payments
from app.api.v1 import cart as cart_api

router = APIRouter(prefix="/payments", tags=["payments"])


@router.post("/intent", status_code=status.HTTP_200_OK)
async def create_payment_intent(
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
    session_id: str | None = Depends(cart_api.session_header),
):
    user_id = getattr(current_user, "id", None) if current_user else None
    query = select(Cart).options(selectinload(Cart.items))
    if user_id:
        query = query.where(Cart.user_id == user_id)
    elif session_id:
        query = query.where(Cart.session_id == session_id)
    cart = (await session.execute(query)).scalar_one_or_none()
    if not cart:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cart not found")
    data = await payments.create_payment_intent(session, cart)
    return data


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> dict:
    payload = await request.body()
    event = await payments.handle_webhook_event(session, payload, stripe_signature)
    # Order status updates would occur here based on event["type"]
    return {"received": True, "type": event.get("type")}
