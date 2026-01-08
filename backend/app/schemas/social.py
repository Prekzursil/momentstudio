from pydantic import BaseModel, Field


class SocialThumbnailRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2000)


class SocialThumbnailResponse(BaseModel):
    thumbnail_url: str | None = None

