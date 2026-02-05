from fastapi import APIRouter

from app.api.v1 import auth
from app.api.v1 import catalog
from app.api.v1 import cart
from app.api.v1 import addresses
from app.api.v1 import orders
from app.api.v1 import payments
from app.api.v1 import content
from app.api.v1 import email_preview
from app.api.v1 import admin_dashboard
from app.api.v1 import admin_ui
from app.api.v1 import wishlist
from app.api.v1 import blog
from app.api.v1 import fx
from app.api.v1 import notifications
from app.api.v1 import support
from app.api.v1 import returns
from app.api.v1 import shipping
from app.api.v1 import legal
from app.api.v1 import coupons_v2
from app.api.v1 import taxes
from app.api.v1 import ops
from app.api.v1 import observability
from app.api.v1 import newsletter
from app.api.v1 import analytics
from app.models.catalog import Product, ProductStatus
from fastapi import Response, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_session
from app.core.config import settings
from app.core.metrics import snapshot as metrics_snapshot
from app.services import sitemap as sitemap_service
from app.core.dependencies import require_admin_section
from app.models.user import User

api_router = APIRouter()

api_router.include_router(auth.router)
api_router.include_router(catalog.router)
api_router.include_router(cart.router)
api_router.include_router(addresses.router)
api_router.include_router(orders.router)
api_router.include_router(payments.router)
api_router.include_router(content.router)
api_router.include_router(email_preview.router)
api_router.include_router(admin_dashboard.router)
api_router.include_router(admin_ui.router)
api_router.include_router(wishlist.router)
api_router.include_router(blog.router)
api_router.include_router(fx.router)
api_router.include_router(notifications.router)
api_router.include_router(support.router)
api_router.include_router(returns.router)
api_router.include_router(shipping.router)
api_router.include_router(legal.router)
api_router.include_router(coupons_v2.router)
api_router.include_router(taxes.router)
api_router.include_router(ops.router)
api_router.include_router(observability.router)
api_router.include_router(newsletter.router)
api_router.include_router(analytics.router)


@api_router.get("/health", tags=["health"])
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@api_router.get("/health/ready", tags=["health"])
async def readiness(session: AsyncSession = Depends(get_session)) -> dict[str, str]:
    try:
        await session.execute(select(1))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database not ready",
        ) from exc
    return {"status": "ready"}


@api_router.get("/metrics", tags=["metrics"])
def metrics(_: User = Depends(require_admin_section("ops"))) -> dict:
    return metrics_snapshot()


@api_router.get("/sitemap.xml", tags=["sitemap"])
async def sitemap(session: AsyncSession = Depends(get_session)) -> Response:
    by_lang = await sitemap_service.build_sitemap_urls(session)
    urls: list[str] = []
    for lang in ["en", "ro"]:
        for url in by_lang.get(lang, []):
            urls.append(f"<url><loc>{url}</loc></url>")
    body = (
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">"
        + "".join(urls)
        + "</urlset>"
    )
    return Response(content=body, media_type="application/xml")


@api_router.get("/robots.txt", tags=["sitemap"])
def robots() -> Response:
    lines = [
        "User-agent: *",
        "Allow: /",
        f"Sitemap: {settings.frontend_origin.rstrip('/')}/sitemap.xml",
    ]
    return Response(content="\n".join(lines), media_type="text/plain")


@api_router.get("/feeds/products.json", tags=["sitemap"])
async def product_feed(session: AsyncSession = Depends(get_session)) -> list[dict]:
    result = await session.execute(
        select(Product.slug, Product.name, Product.base_price, Product.currency, Product.updated_at).where(
            Product.status == ProductStatus.published,
            Product.is_active.is_(True),
            Product.is_deleted.is_(False),
        )
    )
    rows = result.all()
    base = settings.frontend_origin.rstrip("/")
    return [
        {
            "slug": slug,
            "name": name,
            "price": float(price),
            "currency": currency,
            "url": f"{base}/products/{slug}",
            "updated_at": updated_at.isoformat() if updated_at else None,
        }
        for slug, name, price, currency, updated_at in rows
    ]
