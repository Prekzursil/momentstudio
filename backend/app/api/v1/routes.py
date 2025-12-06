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
from app.api.v1 import payment_methods
from app.api.v1 import wishlist
from app.models.catalog import Product, Category
from fastapi import Response, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
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
api_router.include_router(payment_methods.router)
api_router.include_router(content.router)
api_router.include_router(email_preview.router)
api_router.include_router(admin_dashboard.router)
api_router.include_router(wishlist.router)


@api_router.get("/health", tags=["health"])
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@api_router.get("/health/ready", tags=["health"])
def readiness() -> dict[str, str]:
    return {"status": "ready"}


@api_router.get("/metrics", tags=["metrics"])
def metrics() -> dict:
    return metrics_snapshot()


@api_router.get("/sitemap.xml", tags=["sitemap"])
async def sitemap(session: AsyncSession = Depends(get_session)) -> Response:
    products = (await session.execute(select(Product.slug))).scalars().all()
    categories = (await session.execute(select(Category.slug))).scalars().all()
    urls = []
    base = settings.frontend_origin.rstrip("/")
    langs = ["en", "ro"]
    for lang in langs:
        urls.append(f"<url><loc>{base}/?lang={lang}</loc></url>")
    for slug in categories:
        for lang in langs:
            urls.append(f"<url><loc>{base}/shop?category={slug}&lang={lang}</loc></url>")
    for slug in products:
        for lang in langs:
            urls.append(f"<url><loc>{base}/products/{slug}?lang={lang}</loc></url>")
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
