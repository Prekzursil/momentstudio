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
    msg["From"] = settings.smtp_from_email or "no-reply@momentstudio.local"
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
    lines.append(f"Total: {order.total_amount} {getattr(order, 'currency', 'RON')}")
    text_body = "\n".join(lines)
    return await send_email(to_email, subject, text_body)


async def send_new_order_notification(
    to_email: str, order, customer_email: str | None = None, lang: str | None = None
) -> bool:
    lng = _lang_or_default(lang)
    subject = (
        f"New order received {order.reference_code or order.id}"
        if lng == "en"
        else f"Comandă nouă primită {order.reference_code or order.id}"
    )
    lines = [
        f"A new order was placed: {order.reference_code or order.id}"
        if lng == "en"
        else f"O comandă nouă a fost plasată: {order.reference_code or order.id}"
    ]
    if customer_email:
        lines.append(f"Customer: {customer_email}" if lng == "en" else f"Client: {customer_email}")
    lines.append(f"Total: {order.total_amount} {getattr(order, 'currency', 'RON')}")
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


async def send_refund_requested_notification(
    to_email: str,
    order,
    *,
    customer_email: str | None = None,
    requested_by_email: str | None = None,
    note: str | None = None,
    lang: str | None = None,
) -> bool:
    lng = _lang_or_default(lang)
    subject = (
        f"Refund requested for order {order.reference_code or order.id}"
        if lng == "en"
        else f"Solicitare rambursare pentru comanda {order.reference_code or order.id}"
    )
    lines = [
        f"A refund was requested for order: {order.reference_code or order.id}"
        if lng == "en"
        else f"A fost solicitată o rambursare pentru comanda: {order.reference_code or order.id}"
    ]
    if customer_email:
        lines.append(f"Customer: {customer_email}" if lng == "en" else f"Client: {customer_email}")
    if requested_by_email:
        lines.append(f"Requested by: {requested_by_email}" if lng == "en" else f"Cerut de: {requested_by_email}")
    if note:
        lines.append(f"Note: {note}" if lng == "en" else f"Notă: {note}")
    lines.append(f"Total: {order.total_amount} {getattr(order, 'currency', 'RON')}")
    return await send_email(to_email, subject, "\n".join(lines))


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


async def send_stripe_dispute_notification(
    to_email: str,
    *,
    event_type: str,
    dispute_id: str | None = None,
    charge_id: str | None = None,
    amount: int | None = None,
    currency: str | None = None,
    reason: str | None = None,
    dispute_status: str | None = None,
    lang: str | None = None,
) -> bool:
    lng = _lang_or_default(lang)
    subject = (
        f"Stripe dispute: {event_type}"
        if lng == "en"
        else f"Dispută Stripe: {event_type}"
    )
    lines = [
        ("A Stripe dispute event was received." if lng == "en" else "A fost primit un eveniment de dispută Stripe."),
        f"Event: {event_type}",
    ]
    if dispute_id:
        lines.append(f"Dispute: {dispute_id}")
    if charge_id:
        lines.append(f"Charge: {charge_id}")
    if amount is not None and currency:
        lines.append(f"Amount: {amount / 100:.2f} {currency.upper()}")
    if reason:
        lines.append(f"Reason: {reason}" if lng == "en" else f"Motiv: {reason}")
    if dispute_status:
        lines.append(f"Status: {dispute_status}" if lng == "en" else f"Stare: {dispute_status}")
    return await send_email(to_email, subject, "\n".join(lines))


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
    if env is None:
        text_body = (
            f"New comment on: {post_title}\nFrom: {commenter_name}\n\n{comment_body}\n\nView: {post_url}"
            if lng == "en"
            else f"Comentariu nou la: {post_title}\nDe la: {commenter_name}\n\n{comment_body}\n\nVezi: {post_url}"
        )
        return await send_email(to_email, subject, text_body)
    text_body, html_body = render_template(
        "blog_comment_admin.txt.j2",
        {
            "lang": lng,
            "post_title": post_title,
            "post_url": post_url,
            "commenter_name": commenter_name,
            "comment_body": comment_body,
        },
    )
    return await send_email(to_email, subject, text_body, html_body)


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
    if env is None:
        text_body = (
            f"New reply to your comment on: {post_title}\nFrom: {replier_name}\n\n{comment_body}\n\nView: {post_url}"
            if lng == "en"
            else f"Răspuns nou la comentariul tău pe: {post_title}\nDe la: {replier_name}\n\n{comment_body}\n\nVezi: {post_url}"
        )
        return await send_email(to_email, subject, text_body)
    text_body, html_body = render_template(
        "blog_comment_reply.txt.j2",
        {
            "lang": lng,
            "post_title": post_title,
            "post_url": post_url,
            "replier_name": replier_name,
            "comment_body": comment_body,
        },
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_contact_submission_notification(
    to_email: str,
    *,
    topic: str,
    from_name: str,
    from_email: str,
    message: str,
    order_reference: str | None = None,
    admin_url: str | None = None,
    lang: str | None = None,
) -> bool:
    lng = _lang_or_default(lang)
    subject = "New contact submission" if lng == "en" else "Mesaj nou de contact"
    if env is None:
        lines = [
            ("New contact submission" if lng == "en" else "Mesaj nou de contact"),
            f"Topic: {topic}",
            f"From: {from_name} <{from_email}>",
        ]
        if order_reference:
            lines.append(f"Order: {order_reference}")
        lines.append("")
        lines.append(message)
        if admin_url:
            lines.extend(["", f"View in admin: {admin_url}"])
        return await send_email(to_email, subject, "\n".join(lines))
    text_body, html_body = render_template(
        "contact_submission_admin.txt.j2",
        {
            "lang": lng,
            "topic": topic,
            "from_name": from_name,
            "from_email": from_email,
            "message": message,
            "order_reference": order_reference,
            "admin_url": admin_url,
        },
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_return_request_created(to_email: str, return_request, *, lang: str | None = None) -> bool:
    lng = _lang_or_default(lang)
    subject = "Return request created" if lng == "en" else "Cerere de retur creată"
    order_ref = getattr(getattr(return_request, "order", None), "reference_code", None) or str(
        getattr(return_request, "order_id", "")
    )
    customer_name = getattr(getattr(return_request, "order", None), "customer_name", None) or ""
    items = []
    for it in getattr(return_request, "items", []) or []:
        order_item = getattr(it, "order_item", None)
        product = getattr(order_item, "product", None) if order_item else None
        items.append({"name": getattr(product, "name", None) or str(getattr(it, "order_item_id", "")), "quantity": it.quantity})

    if env is None:
        lines = [
            ("Return request created" if lng == "en" else "Cerere de retur creată"),
            f"Order: {order_ref}",
        ]
        if customer_name:
            lines.append(f"Customer: {customer_name}")
        lines.append("")
        for row in items:
            lines.append(f"- {row['name']} x{row['quantity']}")
        lines.append("")
        lines.append(getattr(return_request, "reason", "") or "")
        return await send_email(to_email, subject, "\n".join(lines))

    text_body, html_body = render_template(
        "return_request_created.txt.j2",
        {
            "lang": lng,
            "order_reference": order_ref,
            "customer_name": customer_name,
            "reason": getattr(return_request, "reason", None),
            "customer_message": getattr(return_request, "customer_message", None),
            "status": getattr(getattr(return_request, "status", None), "value", None) or str(getattr(return_request, "status", "")),
            "items": items,
            "account_url": f"{settings.frontend_origin.rstrip('/')}/account",
        },
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_return_request_status_update(
    to_email: str,
    return_request,
    *,
    previous_status,
    lang: str | None = None,
) -> bool:
    lng = _lang_or_default(lang)
    subject = "Return request update" if lng == "en" else "Actualizare cerere de retur"
    order_ref = getattr(getattr(return_request, "order", None), "reference_code", None) or str(
        getattr(return_request, "order_id", "")
    )
    customer_name = getattr(getattr(return_request, "order", None), "customer_name", None) or ""

    if env is None:
        lines = [
            ("Return request update" if lng == "en" else "Actualizare cerere de retur"),
            f"Order: {order_ref}",
            f"Status: {getattr(previous_status, 'value', previous_status)} -> {getattr(getattr(return_request, 'status', None), 'value', getattr(return_request, 'status', ''))}",
        ]
        if customer_name:
            lines.append(f"Customer: {customer_name}")
        note = getattr(return_request, "admin_note", None)
        if note:
            lines.extend(["", note])
        return await send_email(to_email, subject, "\n".join(lines))

    text_body, html_body = render_template(
        "return_request_status_update.txt.j2",
        {
            "lang": lng,
            "order_reference": order_ref,
            "customer_name": customer_name,
            "previous_status": getattr(previous_status, "value", previous_status),
            "status": getattr(getattr(return_request, "status", None), "value", None) or str(getattr(return_request, "status", "")),
            "admin_note": getattr(return_request, "admin_note", None),
            "account_url": f"{settings.frontend_origin.rstrip('/')}/account",
        },
    )
    return await send_email(to_email, subject, text_body, html_body)


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
