import smtplib
from email.message import EmailMessage
from typing import Sequence

from app.core.config import settings


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
    except Exception:
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
