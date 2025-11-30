import logging
import smtplib
from email.message import EmailMessage
from pathlib import Path
from typing import Sequence

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.core.config import settings

logger = logging.getLogger(__name__)

TEMPLATE_PATH = Path(__file__).parent.parent / "templates" / "emails"
env = Environment(loader=FileSystemLoader(TEMPLATE_PATH), autoescape=select_autoescape(["html", "xml"]))


def _build_message(to_email: str, subject: str, text_body: str, html_body: str | None = None) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from_email or "no-reply@adrianaart.local"
    msg["To"] = to_email
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")
    return msg


async def send_email(to_email: str, subject: str, text_body: str, html_body: str | None = None) -> bool:
    if not settings.smtp_enabled:
        return False
    msg = _build_message(to_email, subject, text_body, html_body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_username and settings.smtp_password:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(msg)
        return True
    except Exception as exc:
        logger.warning("Email send failed: %s", exc)
        return False


async def send_order_confirmation(to_email: str, order, items: Sequence | None = None) -> bool:
    subject = f"Order confirmation {order.reference_code or order.id}"
    lines = [f"Thank you for your order {order.reference_code or order.id}."]
    if items:
        lines.append("Items:")
        for item in items:
            lines.append(f"- {getattr(item, 'product_id', '')} x {item.quantity}")
    lines.append(f"Total: {order.total_amount} {getattr(order, 'currency', 'USD')}")
    text_body = "\n".join(lines)
    return await send_email(to_email, subject, text_body)


async def send_password_reset(to_email: str, token: str) -> bool:
    subject = "Password reset"
    text_body = f"Use this token to reset your password: {token}"
    return await send_email(to_email, subject, text_body)


async def send_shipping_update(to_email: str, order, tracking_number: str | None = None) -> bool:
    subject = f"Your order {order.reference_code or order.id} has shipped"
    text_body = f"Order {order.reference_code or order.id} is on the way."
    if tracking_number:
        text_body += f"\nTracking: {tracking_number}"
    return await send_email(to_email, subject, text_body)


async def send_delivery_confirmation(to_email: str, order) -> bool:
    subject = f"Delivery confirmation for order {order.reference_code or order.id}"
    text_body = f"Order {order.reference_code or order.id} has been delivered."
    return await send_email(to_email, subject, text_body)


async def send_cart_abandonment(to_email: str) -> bool:
    subject = "Still thinking it over?"
    text_body, html_body = render_template("cart_abandonment.txt.j2", {})
    return await send_email(to_email, subject, text_body, html_body)


async def send_back_in_stock(to_email: str, product_name: str) -> bool:
    subject = f"{product_name} is back in stock"
    text_body, html_body = render_template("back_in_stock.txt.j2", {"product_name": product_name})
    return await send_email(to_email, subject, text_body, html_body)


async def send_low_stock_alert(to_email: str, product_name: str, stock: int) -> bool:
    subject = f"Low stock alert: {product_name}"
    text_body, html_body = render_template("low_stock_alert.txt.j2", {"product_name": product_name, "stock": stock})
    return await send_email(to_email, subject, text_body, html_body)


async def send_error_alert(to_email: str, message: str) -> bool:
    subject = "Critical error alert"
    text_body = message
    return await send_email(to_email, subject, text_body)


def render_template(template_name: str, context: dict) -> tuple[str, str]:
    base_text = env.get_template("base.txt.j2")
    base_html = env.get_template("base.html.j2")
    body_text = env.get_template(template_name).render(**context)
    body_html = env.get_template(template_name.replace(".txt.j2", ".html.j2")).render(**context)
    return base_text.render(body=body_text), base_html.render(body=body_html)


async def preview_email(template_name: str, context: dict) -> dict[str, str]:
    text_body, html_body = render_template(template_name, context)
    return {"text": text_body, "html": html_body}
