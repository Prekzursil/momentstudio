from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user_optional
from app.db.session import get_session
from app.models.user import User
from app.schemas.legal import LegalConsentDocStatus, LegalConsentStatusResponse
from app.services import legal_consents as legal_consents_service

router = APIRouter(prefix="/legal", tags=["legal"])


def _slug_from_key(key: str) -> str:
    raw = (key or "").strip()
    return raw[5:] if raw.startswith("page.") else raw


@router.get("/consents/status", response_model=LegalConsentStatusResponse)
async def consent_status(
    session: AsyncSession = Depends(get_session),
    current_user: User | None = Depends(get_current_user_optional),
) -> LegalConsentStatusResponse:
    required_versions = await legal_consents_service.required_doc_versions(session)
    accepted_versions: dict[str, int] = {}
    if current_user and current_user.id:
        accepted_versions = await legal_consents_service.latest_accepted_versions(session, user_id=current_user.id)

    docs: list[LegalConsentDocStatus] = []
    for key in legal_consents_service.REQUIRED_DOC_KEYS:
        required_version = int(required_versions.get(key, 0) or 0)
        accepted_version = int(accepted_versions.get(key, 0) or 0)
        docs.append(
            LegalConsentDocStatus(
                doc_key=key,
                slug=_slug_from_key(key),
                required_version=required_version,
                accepted_version=accepted_version,
                accepted=accepted_version >= required_version and required_version > 0,
            )
        )
    return LegalConsentStatusResponse(docs=docs, satisfied=legal_consents_service.is_satisfied(required_versions, accepted_versions))

