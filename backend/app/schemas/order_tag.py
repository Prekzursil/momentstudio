from pydantic import BaseModel, Field


class OrderTagCreate(BaseModel):
    tag: str = Field(min_length=1, max_length=50)


class OrderTagsResponse(BaseModel):
    items: list[str]


class OrderTagStatRead(BaseModel):
    tag: str
    count: int


class OrderTagStatsResponse(BaseModel):
    items: list[OrderTagStatRead]


class OrderTagRenameRequest(BaseModel):
    from_tag: str = Field(min_length=1, max_length=50)
    to_tag: str = Field(min_length=1, max_length=50)


class OrderTagRenameResponse(BaseModel):
    from_tag: str
    to_tag: str
    updated: int = 0
    merged: int = 0
    total: int = 0
