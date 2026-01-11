from pydantic import BaseModel


class AdminPaginationMeta(BaseModel):
    total_items: int
    total_pages: int
    page: int
    limit: int

