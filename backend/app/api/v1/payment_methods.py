from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import require_complete_profile
from app.db.session import get_session
from app.models.user import User
from app.schemas.payment import AttachPaymentMethodRequest, PaymentMethodRead, SetupIntentResponse
from app.services import payments

router = APIRouter(prefix="/payment-methods", tags=["payments"])


@router.get("", response_model=list[PaymentMethodRead])
async def list_payment_methods(
    session: AsyncSession = Depends(get_session), current_user: User = Depends(require_complete_profile)
) -> list[PaymentMethodRead]:
    return await payments.list_payment_methods(session, current_user)


@router.post("/setup-intent", response_model=SetupIntentResponse)
async def create_setup_intent(
    session: AsyncSession = Depends(get_session), current_user: User = Depends(require_complete_profile)
) -> SetupIntentResponse:
    data = await payments.create_setup_intent(session, current_user)
    return SetupIntentResponse(**data)


@router.post("/attach", response_model=PaymentMethodRead, status_code=status.HTTP_201_CREATED)
async def attach_payment_method(
    payload: AttachPaymentMethodRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_complete_profile),
) -> PaymentMethodRead:
    return await payments.attach_payment_method(session, current_user, payload.payment_method_id)


@router.delete("/{payment_method_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_payment_method(
    payment_method_id: str,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_complete_profile),
) -> None:
    await payments.remove_payment_method(session, current_user, payment_method_id)
    return None
