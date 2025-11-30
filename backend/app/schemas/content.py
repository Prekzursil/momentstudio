from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.content import ContentStatus


class ContentBlockBase(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body_markdown: str = Field(min_length=1)
    status: ContentStatus = ContentStatus.draft

    @field_validator("body_markdown")
    @classmethod
    def _validate_markdown(cls, body: str) -> str:
        if "<script" in body.lower():
            raise ValueError("Script tags are not allowed")
        return body


class ContentBlockCreate(ContentBlockBase):
    pass


class ContentBlockUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    body_markdown: str | None = Field(default=None)
    status: ContentStatus | None = None

    @field_validator("body_markdown")
    @classmethod
    def _validate_markdown(cls, body: str | None) -> str | None:
        if body and "<script" in body.lower():
            raise ValueError("Script tags are not allowed")
        return body


class ContentBlockRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    title: str
    body_markdown: str
    status: ContentStatus
    version: int
    published_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
