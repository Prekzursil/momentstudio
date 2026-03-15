from typing import Any, Dict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.address import Address
from app.models.catalog import Category, Product
from app.models.order import Order
from app.models.user import User


def _serialize_user(user: User) -> dict[str, Any]:
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "avatar_url": user.avatar_url,
        "preferred_language": user.preferred_language,
        "email_verified": user.email_verified,
        "role": user.role.value,
        "created_at": user.created_at.isoformat(),
    }


def _serialize_category(category: Category) -> dict[str, Any]:
    return {
        "id": str(category.id),
        "slug": category.slug,
        "name": category.name,
        "description": category.description,
        "sort_order": category.sort_order,
        "created_at": category.created_at.isoformat(),
    }


def _serialize_product(product: Product) -> dict[str, Any]:
    images = [
        {"id": str(image.id), "url": image.url, "alt_text": image.alt_text, "sort_order": image.sort_order}
        for image in product.images
    ]
    options = [{"id": str(option.id), "name": option.option_name, "value": option.option_value} for option in product.options]
    variants = [
        {
            "id": str(variant.id),
            "name": variant.name,
            "price_delta": float(variant.additional_price_delta),
            "stock_quantity": variant.stock_quantity,
        }
        for variant in product.variants
    ]
    return {
        "id": str(product.id),
        "category_id": str(product.category_id),
        "sku": product.sku,
        "slug": product.slug,
        "name": product.name,
        "short_description": product.short_description,
        "long_description": product.long_description,
        "base_price": float(product.base_price),
        "currency": product.currency,
        "is_featured": product.is_featured,
        "stock_quantity": product.stock_quantity,
        "status": product.status.value,
        "publish_at": product.publish_at.isoformat() if product.publish_at else None,
        "meta_title": product.meta_title,
        "meta_description": product.meta_description,
        "tags": [tag.slug for tag in product.tags],
        "images": images,
        "options": options,
        "variants": variants,
    }


def _serialize_address(address: Address) -> dict[str, Any]:
    return {
        "id": str(address.id),
        "user_id": str(address.user_id) if address.user_id else None,
        "line1": address.line1,
        "line2": address.line2,
        "city": address.city,
        "region": address.region,
        "postal_code": address.postal_code,
        "country": address.country,
    }


def _serialize_order(order: Order) -> dict[str, Any]:
    items = [
        {
            "id": str(item.id),
            "product_id": str(item.product_id) if item.product_id else None,
            "quantity": item.quantity,
            "unit_price": float(item.unit_price),
            "subtotal": float(item.subtotal),
        }
        for item in order.items
    ]
    return {
        "id": str(order.id),
        "user_id": str(order.user_id) if order.user_id else None,
        "status": order.status.value,
        "total_amount": float(order.total_amount),
        "currency": order.currency,
        "reference_code": order.reference_code,
        "shipping_address_id": str(order.shipping_address_id) if order.shipping_address_id else None,
        "billing_address_id": str(order.billing_address_id) if order.billing_address_id else None,
        "items": items,
    }


async def export_json(session: AsyncSession) -> Dict[str, Any]:
    users = (await session.execute(select(User))).scalars().all()
    categories = (await session.execute(select(Category))).scalars().all()
    products = (await session.execute(select(Product))).scalars().all()
    addresses = (await session.execute(select(Address))).scalars().all()
    orders = (await session.execute(select(Order))).scalars().all()

    return {
        "users": [_serialize_user(user) for user in users],
        "categories": [_serialize_category(category) for category in categories],
        "products": [_serialize_product(product) for product in products],
        "addresses": [_serialize_address(address) for address in addresses],
        "orders": [_serialize_order(order) for order in orders],
    }
