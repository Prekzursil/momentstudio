from typing import Any, Dict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.address import Address
from app.models.catalog import Category, Product
from app.models.order import Order
from app.models.user import User


async def export_json(session: AsyncSession) -> Dict[str, Any]:
    data: Dict[str, Any] = {}
    users = (await session.execute(select(User))).scalars().all()
    data["users"] = [
        {
            "id": str(u.id),
            "email": u.email,
            "name": u.name,
            "avatar_url": u.avatar_url,
            "preferred_language": u.preferred_language,
            "email_verified": u.email_verified,
            "role": u.role.value,
            "created_at": u.created_at.isoformat(),
        }
        for u in users
    ]
    categories = (await session.execute(select(Category))).scalars().all()
    data["categories"] = [
        {
            "id": str(c.id),
            "slug": c.slug,
            "name": c.name,
            "description": c.description,
            "sort_order": c.sort_order,
            "created_at": c.created_at.isoformat(),
        }
        for c in categories
    ]
    products = (await session.execute(select(Product))).scalars().all()
    data["products"] = []
    for p in products:
        data["products"].append(
            {
                "id": str(p.id),
                "category_id": str(p.category_id),
                "sku": p.sku,
                "slug": p.slug,
                "name": p.name,
                "short_description": p.short_description,
                "long_description": p.long_description,
                "base_price": float(p.base_price),
                "currency": p.currency,
                "is_featured": p.is_featured,
                "stock_quantity": p.stock_quantity,
                "status": p.status.value,
                "publish_at": p.publish_at.isoformat() if p.publish_at else None,
                "meta_title": p.meta_title,
                "meta_description": p.meta_description,
                "tags": [t.slug for t in p.tags],
                "images": [
                    {"id": str(img.id), "url": img.url, "alt_text": img.alt_text, "sort_order": img.sort_order}
                    for img in p.images
                ],
                "options": [
                    {"id": str(opt.id), "name": opt.name, "values": opt.values}
                    for opt in p.options
                ],
                "variants": [
                    {
                        "id": str(v.id),
                        "sku": v.sku,
                        "price": float(v.price),
                        "stock_quantity": v.stock_quantity,
                        "options": v.options,
                    }
                    for v in p.variants
                ],
            }
        )
    addresses = (await session.execute(select(Address))).scalars().all()
    data["addresses"] = [
        {
            "id": str(a.id),
            "user_id": str(a.user_id) if a.user_id else None,
            "line1": a.line1,
            "line2": a.line2,
            "city": a.city,
            "state": a.state,
            "postal_code": a.postal_code,
            "country": a.country,
        }
        for a in addresses
    ]
    orders = (await session.execute(select(Order))).scalars().all()
    data["orders"] = []
    for o in orders:
        data["orders"].append(
            {
                "id": str(o.id),
                "user_id": str(o.user_id) if o.user_id else None,
                "status": o.status.value,
                "total_amount": float(o.total_amount),
                "currency": o.currency,
                "reference_code": o.reference_code,
                "shipping_address_id": str(o.shipping_address_id) if o.shipping_address_id else None,
                "billing_address_id": str(o.billing_address_id) if o.billing_address_id else None,
                "items": [
                    {
                        "id": str(oi.id),
                        "product_id": str(oi.product_id) if oi.product_id else None,
                        "quantity": oi.quantity,
                        "unit_price": float(oi.unit_price),
                        "subtotal": float(oi.subtotal),
                    }
                    for oi in o.items
                ],
            }
        )
    return data
