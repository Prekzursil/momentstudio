import logging
import smtplib
from email.message import EmailMessage
from pathlib import Path
from typing import Sequence

try:
    from jinja2 import Environment, FileSystemLoader, select_autoescape
except ImportError:
    Environment = None  # type: ignore
    FileSystemLoader = None  # type: ignore
    select_autoescape = None  # type: ignore

from app.core.config import settings

logger = logging.getLogger(__name__)

TEMPLATE_PATH = Path(__file__).parent.parent / "templates" / "emails"
env = (
    Environment(loader=FileSystemLoader(TEMPLATE_PATH), autoescape=select_autoescape(["html", "xml"]))
    if Environment
    else None
)
_rate_global: list[float] = []
_rate_per_recipient: dict[str, list[float]] = {}


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
    now = __import__("time").time()
    _prune(now)
    if not _allow_send(now, to_email):
        logger.warning("Email rate limit reached for %s", to_email)
        return False
    msg = _build_message(to_email, subject, text_body, html_body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_username and settings.smtp_password:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(msg)
        _record_send(now, to_email)
        return True
    except Exception as exc:
        logger.warning("Email send failed: %s", exc)
        return False


def _lang_or_default(lang: str | None) -> str:
    return lang if lang in {"en", "ro"} else "en"


async def send_order_confirmation(to_email: str, order, items: Sequence | None = None, lang: str | None = None) -> bool:
    lng = _lang_or_default(lang)
    subject = (
        f"Order confirmation {order.reference_code or order.id}"
        if lng == "en"
        else f"Confirmare comandă {order.reference_code or order.id}"
    )
    lines = [
        f"Thank you for your order {order.reference_code or order.id}."
        if lng == "en"
        else f"Îți mulțumim pentru comanda {order.reference_code or order.id}."
    ]
    if items:
        lines.append("Items:" if lng == "en" else "Produse:")
        for item in items:
            lines.append(f"- {getattr(item, 'product_id', '')} x {item.quantity}")
    lines.append(f"Total: {order.total_amount} {getattr(order, 'currency', 'USD')}")
    text_body = "\n".join(lines)
    return await send_email(to_email, subject, text_body)


async def send_password_reset(to_email: str, token: str, lang: str | None = None) -> bool:
    lng = _lang_or_default(lang)
    subject = "Password reset" if lng == "en" else "Resetare parolă"
    text_body = (
        f"Use this token to reset your password: {token}"
        if lng == "en"
        else f"Folosește acest cod pentru a reseta parola: {token}"
    )
    return await send_email(to_email, subject, text_body)


async def send_verification_email(to_email: str, token: str, lang: str | None = None) -> bool:
    lng = _lang_or_default(lang)
    subject = "Verify your email" if lng == "en" else "Verifică-ți emailul"
    text_body = (
        f"Use this token to verify your email: {token}"
        if lng == "en"
        else f"Folosește acest cod pentru a verifica emailul: {token}"
    )
    return await send_email(to_email, subject, text_body)


async def send_shipping_update(to_email: str, order, tracking_number: str | None = None, lang: str | None = None) -> bool:
    lng = _lang_or_default(lang)
    subject = (
        f"Your order {order.reference_code or order.id} has shipped"
        if lng == "en"
        else f"Comanda {order.reference_code or order.id} a fost expediată"
    )
    text_body = (
        f"Order {order.reference_code or order.id} is on the way."
        if lng == "en"
        else f"Comanda {order.reference_code or order.id} este pe drum."
    )
    if tracking_number:
        text_body += f"\nTracking: {tracking_number}"
    return await send_email(to_email, subject, text_body)


async def send_delivery_confirmation(to_email: str, order, lang: str | None = None) -> bool:
    lng = _lang_or_default(lang)
    subject = (
        f"Delivery confirmation for order {order.reference_code or order.id}"
        if lng == "en"
        else f"Confirmare livrare pentru comanda {order.reference_code or order.id}"
    )
    text_body = (
        f"Order {order.reference_code or order.id} has been delivered."
        if lng == "en"
        else f"Comanda {order.reference_code or order.id} a fost livrată."
    )
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


async def send_blog_comment_admin_notification(
    to_email: str,
    *,
    post_title: str,
    post_url: str,
    commenter_name: str,
    comment_body: str,
    lang: str | None = None,
) -> bool:
    lng = _lang_or_default(lang)
    subject = "New blog comment" if lng == "en" else "Comentariu nou pe blog"
    text_body = (
        f"New comment on: {post_title}\nFrom: {commenter_name}\n\n{comment_body}\n\nView: {post_url}"
        if lng == "en"
        else f"Comentariu nou la: {post_title}\nDe la: {commenter_name}\n\n{comment_body}\n\nVezi: {post_url}"
    )
    return await send_email(to_email, subject, text_body)


async def send_blog_comment_reply_notification(
    to_email: str,
    *,
    post_title: str,
    post_url: str,
    replier_name: str,
    comment_body: str,
    lang: str | None = None,
) -> bool:
    lng = _lang_or_default(lang)
    subject = "New reply to your comment" if lng == "en" else "Răspuns nou la comentariul tău"
    text_body = (
        f"New reply on: {post_title}\nFrom: {replier_name}\n\n{comment_body}\n\nView: {post_url}"
        if lng == "en"
        else f"Răspuns nou la: {post_title}\nDe la: {replier_name}\n\n{comment_body}\n\nVezi: {post_url}"
    )
    return await send_email(to_email, subject, text_body)


def render_template(template_name: str, context: dict) -> tuple[str, str]:
    if env is None:
        body = str(context)
        return body, f"<p>{body}</p>"
    base_text = env.get_template("base.txt.j2")
    base_html = env.get_template("base.html.j2")
    body_text = env.get_template(template_name).render(**context)
    body_html = env.get_template(template_name.replace(".txt.j2", ".html.j2")).render(**context)
    return base_text.render(body=body_text), base_html.render(body=body_html)


async def preview_email(template_name: str, context: dict) -> dict[str, str]:
    text_body, html_body = render_template(template_name, context)
    return {"text": text_body, "html": html_body}


async def notify_critical_error(message: str) -> bool:
    if settings.error_alert_email:
        return await send_error_alert(settings.error_alert_email, message)
    logger.error("Critical error (no alert email configured): %s", message)
    return False


def _prune(now: float) -> None:
    window = 60.0
    _rate_global[:] = [ts for ts in _rate_global if now - ts < window]
    for key in list(_rate_per_recipient.keys()):
        _rate_per_recipient[key] = [ts for ts in _rate_per_recipient[key] if now - ts < window]
        if not _rate_per_recipient[key]:
            _rate_per_recipient.pop(key, None)


def _allow_send(now: float, recipient: str) -> bool:
    window = 60.0
    global_limit = settings.email_rate_limit_per_minute
    recipient_limit = settings.email_rate_limit_per_recipient_per_minute
    if global_limit and len([ts for ts in _rate_global if now - ts < window]) >= global_limit:
        return False
    rec_list = _rate_per_recipient.get(recipient, [])
    if recipient_limit and len([ts for ts in rec_list if now - ts < window]) >= recipient_limit:
        return False
    return True


def _record_send(now: float, recipient: str) -> None:
    _rate_global.append(now)
    _rate_per_recipient.setdefault(recipient, []).append(now)
