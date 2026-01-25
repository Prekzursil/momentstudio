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
from app.api.v1 import wishlist
from app.api.v1 import blog
from app.api.v1 import fx
from app.api.v1 import notifications
from app.api.v1 import support
from app.api.v1 import returns
from app.api.v1 import shipping
from app.api.v1 import coupons_v2
from app.api.v1 import taxes
from app.models.catalog import Product, Category
from app.models.content import ContentBlock, ContentStatus
from datetime import datetime, timezone
from fastapi import Response, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import or_, select
from app.db.session import get_session
from app.core.config import settings
from app.core.metrics import snapshot as metrics_snapshot

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
api_router.include_router(wishlist.router)
api_router.include_router(blog.router)
api_router.include_router(fx.router)
api_router.include_router(notifications.router)
api_router.include_router(support.router)
api_router.include_router(returns.router)
api_router.include_router(shipping.router)
api_router.include_router(coupons_v2.router)
api_router.include_router(taxes.router)


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
def metrics() -> dict:
    return metrics_snapshot()


@api_router.get("/sitemap.xml", tags=["sitemap"])
async def sitemap(session: AsyncSession = Depends(get_session)) -> Response:
    now = datetime.now(timezone.utc)
    products = (await session.execute(select(Product.slug))).scalars().all()
    categories = (await session.execute(select(Category.slug))).scalars().all()
    blog_keys = (
        await session.execute(
            select(ContentBlock.key).where(
                ContentBlock.key.like("blog.%"),
                ContentBlock.status == ContentStatus.published,
                or_(ContentBlock.published_at.is_(None), ContentBlock.published_at <= now),
                or_(ContentBlock.published_until.is_(None), ContentBlock.published_until > now),
            )
        )
    ).scalars().all()
    urls = []
    base = settings.frontend_origin.rstrip("/")
    langs = ["en", "ro"]
    for lang in langs:
        urls.append(f"<url><loc>{base}/?lang={lang}</loc></url>")
        urls.append(f"<url><loc>{base}/blog?lang={lang}</loc></url>")
    for slug in categories:
        for lang in langs:
            urls.append(f"<url><loc>{base}/shop?category={slug}&lang={lang}</loc></url>")
    for slug in products:
        for lang in langs:
            urls.append(f"<url><loc>{base}/products/{slug}?lang={lang}</loc></url>")
    for key in blog_keys:
        slug = key.split(".", 1)[1] if key.startswith("blog.") else key
        for lang in langs:
            urls.append(f"<url><loc>{base}/blog/{slug}?lang={lang}</loc></url>")
    body = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">" + "".join(urls) + "</urlset>"
    return Response(content=body, media_type="application/xml")


@api_router.get("/robots.txt", tags=["sitemap"])
def robots() -> Response:
    lines = [
        "User-agent: *",
        "Allow: /",
        f"Sitemap: {settings.frontend_origin.rstrip('/')}/api/v1/sitemap.xml",
    ]
    return Response(content="\n".join(lines), media_type="text/plain")


@api_router.get("/feeds/products.json", tags=["sitemap"])
async def product_feed(session: AsyncSession = Depends(get_session)) -> list[dict]:
    result = await session.execute(select(Product.slug, Product.name, Product.base_price, Product.currency, Product.updated_at))
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
