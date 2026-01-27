from pydantic import BaseModel


class LegalConsentDocStatus(BaseModel):
    doc_key: str
    slug: str
    required_version: int
    accepted_version: int
    accepted: bool


class LegalConsentStatusResponse(BaseModel):
    docs: list[LegalConsentDocStatus]
    satisfied: bool

