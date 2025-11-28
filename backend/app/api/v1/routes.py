from fastapi import APIRouter

from app.api.v1 import auth
from app.api.v1 import catalog
from app.api.v1 import cart
from app.api.v1 import addresses
from app.api.v1 import orders

api_router = APIRouter()

api_router.include_router(auth.router)
api_router.include_router(catalog.router)
api_router.include_router(cart.router)
api_router.include_router(addresses.router)
api_router.include_router(orders.router)


@api_router.get("/health", tags=["health"])
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@api_router.get("/health/ready", tags=["health"])
def readiness() -> dict[str, str]:
    return {"status": "ready"}
