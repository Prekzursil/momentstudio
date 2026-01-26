from pydantic import BaseModel, Field


class OrderTagCreate(BaseModel):
    tag: str = Field(min_length=1, max_length=50)


class OrderTagsResponse(BaseModel):
    items: list[str]

