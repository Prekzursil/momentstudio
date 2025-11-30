import logging
import smtplib
from email.message import EmailMessage
from typing import Sequence

from app.core.config import settings

logger = logging.getLogger(__name__)


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
