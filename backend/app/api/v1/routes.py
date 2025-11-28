from fastapi import APIRouter

from app.api.v1 import auth
from app.api.v1 import catalog

api_router = APIRouter()

api_router.include_router(auth.router)
api_router.include_router(catalog.router)


@api_router.get("/health", tags=["health"])
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}
