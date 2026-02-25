import logging
import smtplib
import html as _html
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Sequence
from urllib.parse import urlencode

import anyio

try:
    import jinja2
except ImportError:  # pragma: no cover
    jinja2 = None  # type: ignore[assignment]

from app.core.config import settings
from app.core.security import create_receipt_token
from app.db.session import SessionLocal
from app.models.email_failure import EmailDeliveryFailure
from app.models.email_event import EmailDeliveryEvent
from app.services import receipts as receipt_service
from app.services import newsletter_tokens

logger = logging.getLogger(__name__)

TEMPLATE_PATH = Path(__file__).parent.parent / "templates" / "emails"
env = None
if jinja2 is not None:
    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(TEMPLATE_PATH),
        autoescape=jinja2.select_autoescape(["html", "xml"]),
    )
_rate_global: list[float] = []
_rate_per_recipient: dict[str, list[float]] = {}


EmailAttachment = dict[str, object]

RECEIPT_SHARE_DAYS = 365
TOTAL_LABEL = "Total: "


def _first_non_empty_str(*values: object, default: str = "") -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return default


def _apply_message_headers(msg: EmailMessage, headers: dict[str, str] | None) -> None:
    if not headers:
        return
    protected = {"subject", "from", "to"}
    for key, value in headers.items():
        k = str(key or "").strip()
        v = str(value or "").strip()
        if not k or not v:
            continue
        if k.lower() in protected:
            continue
        msg[k] = v


def _add_message_attachments(msg: EmailMessage, attachments: Sequence[EmailAttachment] | None) -> None:
    if not attachments:
        return
    for att in attachments:
        filename = str(att.get("filename") or "attachment")
        mime = str(att.get("mime") or "application/octet-stream")
        content = att.get("content")
        if not isinstance(content, (bytes, bytearray)):
            continue
        maintype, _, subtype = mime.partition("/")
        if not subtype:
            maintype, subtype = "application", "octet-stream"
        msg.add_attachment(bytes(content), maintype=maintype, subtype=subtype, filename=filename)


def _build_message(
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str | None = None,
    *,
    attachments: Sequence[EmailAttachment] | None = None,
    headers: dict[str, str] | None = None,
) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from_email or "no-reply@momentstudio.local"
    msg["To"] = to_email
    _apply_message_headers(msg, headers)
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")
    _add_message_attachments(msg, attachments)
    return msg


def _html_pre(text_body: str) -> str:
    return (
        "<pre style=\"white-space: pre-wrap; font-family: Arial, sans-serif; font-size: 14px; line-height: 1.5;\">"
        f"{_html.escape(text_body)}"
        "</pre>"
    )


def _money_str(value: object, currency: str) -> str:
    try:
        dec = value if isinstance(value, Decimal) else Decimal(str(value))
        return f"{dec.quantize(Decimal('0.01'))} {currency}"
    except Exception:
        cleaned = str(value)
        if len(cleaned) > 64:
            cleaned = cleaned[:61] + "..."
        cleaned = cleaned.strip() or "0"
        return f"{cleaned} {currency}"


async def send_email(
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str | None = None,
    *,
    attachments: Sequence[EmailAttachment] | None = None,
    headers: dict[str, str] | None = None,
) -> bool:
    if not settings.smtp_enabled:
        return False
    now = __import__("time").time()
    _prune(now)
    if not _allow_send(now, to_email):
        logger.warning("email_rate_limited")
        return False
    msg = _build_message(to_email, subject, text_body, html_body, attachments=attachments, headers=headers)
    try:
        def _send() -> None:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
                if settings.smtp_use_tls:
                    smtp.starttls()
                if settings.smtp_username and settings.smtp_password:
                    smtp.login(settings.smtp_username, settings.smtp_password)
                smtp.send_message(msg)

        await anyio.to_thread.run_sync(_send)
        _record_send(now, to_email)
        await _record_email_event(to_email=to_email, subject=subject, status="sent", error_message=None)
        return True
    except Exception as exc:
        logger.warning("Email send failed: %s", exc)
        await _record_email_event(to_email=to_email, subject=subject, status="failed", error_message=str(exc))
        await _record_email_failure(to_email=to_email, subject=subject, error_message=str(exc))
        return False


def _marketing_unsubscribe_context(*, to_email: str) -> tuple[str, dict[str, str]]:
    token = newsletter_tokens.create_newsletter_token(
        email=str(to_email or "").strip().lower(),
        purpose=newsletter_tokens.NEWSLETTER_PURPOSE_UNSUBSCRIBE,
    )
    unsubscribe_url = newsletter_tokens.build_frontend_unsubscribe_url(token=token)
    api_unsubscribe_url = newsletter_tokens.build_api_unsubscribe_url(token=token)
    list_unsubscribe_values: list[str] = [f"<{api_unsubscribe_url}>"]
    mailto = str(settings.list_unsubscribe_mailto or "").strip()
    if mailto:
        mailto_value = mailto if mailto.lower().startswith("mailto:") else f"mailto:{mailto}"
        list_unsubscribe_values.append(f"<{mailto_value}>")
    headers = {
        "List-Unsubscribe": ", ".join(list_unsubscribe_values),
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }
    return unsubscribe_url, headers


async def _record_email_event(*, to_email: str, subject: str, status: str, error_message: str | None) -> None:
    try:
        async with SessionLocal() as session:
            session.add(
                EmailDeliveryEvent(
                    to_email=(to_email or "")[:255],
                    subject=(subject or "")[:255],
                    status=(status or "")[:16] or "sent",
                    error_message=(error_message or "").strip()[:5000] or None,
                )
            )
            await session.commit()
    except Exception:
        logger.exception("Failed to persist email delivery event")


async def _record_email_failure(*, to_email: str, subject: str, error_message: str) -> None:
    try:
        async with SessionLocal() as session:
            session.add(
                EmailDeliveryFailure(
                    to_email=(to_email or "")[:255],
                    subject=(subject or "")[:255],
                    error_message=(error_message or "").strip()[:5000] or None,
                )
            )
            await session.commit()
    except Exception:
        logger.exception("Failed to persist email failure")


def _lang_or_default(lang: str | None) -> str:
    return lang if lang in {"en", "ro"} else "en"


def _localized_text(*, lang: str, ro: str, en: str) -> str:
    return ro if lang == "ro" else en


def _append_optional_labeled_line(
    lines: list[str],
    *,
    value: str | None,
    label_ro: str,
    label_en: str,
    lang: str,
) -> None:
    cleaned = (value or "").strip()
    if not cleaned:
        return
    lines.append(f"{_localized_text(lang=lang, ro=label_ro, en=label_en)}: {cleaned}")


def _contact_submission_notification_fallback_bodies(
    *,
    topic: str,
    from_name: str,
    from_email: str,
    message: str,
    order_reference: str | None,
    admin_url: str | None,
) -> tuple[str, str]:
    ro_lines = [
        "Mesaj nou de contact",
        f"Subiect: {topic}",
        f"De la: {from_name} <{from_email}>",
    ]
    en_lines = [
        "New contact submission",
        f"Topic: {topic}",
        f"From: {from_name} <{from_email}>",
    ]
    if order_reference:
        ro_lines.append(f"Comandă: {order_reference}")
        en_lines.append(f"Order: {order_reference}")
    ro_lines.extend(["", message])
    en_lines.extend(["", message])
    if admin_url:
        ro_lines.extend(["", f"Vezi în admin: {admin_url}"])
        en_lines.extend(["", f"View in admin: {admin_url}"])
    return "\n".join(ro_lines), "\n".join(en_lines)


def _refund_requested_lines(
    *,
    lang: str,
    reference: str,
    total_amount: object,
    currency: str,
    customer_email: str | None,
    requested_by_email: str | None,
    note: str | None,
) -> list[str]:
    lines = [
        _localized_text(
            lang=lang,
            ro=f"A fost solicitată o rambursare pentru comanda: {reference}",
            en=f"A refund was requested for order: {reference}",
        )
    ]
    detail_rows = [
        (customer_email, "Client", "Customer"),
        (requested_by_email, "Cerut de", "Requested by"),
        (note, "Notă", "Note"),
    ]
    for value, label_ro, label_en in detail_rows:
        _append_optional_labeled_line(
            lines,
            value=value,
            label_ro=label_ro,
            label_en=label_en,
            lang=lang,
        )
    lines.append(TOTAL_LABEL + _money_str(total_amount, currency))
    return lines


def _lang_order(preferred_language: str | None) -> tuple[str, str]:
    preferred = _lang_or_default(preferred_language)
    return ("ro", "en") if preferred == "ro" else ("en", "ro")


def _bilingual_subject(subject_ro: str, subject_en: str, *, preferred_language: str | None) -> str:
    first, second = _lang_order(preferred_language)
    by_lang = {"ro": subject_ro, "en": subject_en}
    return f"{by_lang[first]} / {by_lang[second]}"


def _bilingual_sections(
    *,
    text_ro: str,
    text_en: str,
    html_ro: str | None = None,
    html_en: str | None = None,
    preferred_language: str | None,
) -> tuple[str, str | None]:
    first, second = _lang_order(preferred_language)
    text_by_lang = {"ro": text_ro.strip(), "en": text_en.strip()}
    html_by_lang = {"ro": (html_ro or "").strip(), "en": (html_en or "").strip()}
    label_by_lang = {"ro": "Română", "en": "English"}

    text_parts: list[str] = []
    html_parts: list[str] = []
    for lng in (first, second):
        body = text_by_lang.get(lng, "")
        if body:
            text_parts.append(f"[{label_by_lang[lng]}]\n{body}")
        html_body = html_by_lang.get(lng, "")
        if html_body:
            html_parts.append(
                "<div style=\"margin: 0 0 16px 0;\">"
                f"<p style=\"margin: 0 0 8px 0; font-size: 12px; font-weight: 700; letter-spacing: 0.14em; "
                f"text-transform: uppercase; color: #6b7280;\">{label_by_lang[lng]}</p>"
                f"{html_body}"
                "</div>"
            )

    combined_text = ("\n\n---\n\n".join(text_parts)).strip()
    combined_html = (
        "<hr style=\"border:none;border-top:1px solid #e5e7eb;margin:16px 0;\" />".join(html_parts)
    ).strip()
    return combined_text, (combined_html or None)


def render_bilingual_template(template_name: str, context: dict, *, preferred_language: str | None = None) -> tuple[str, str]:
    if env is None:
        body = f"Email template engine is not available (template={template_name})."
        return body, _html_pre(body)

    body_ro_text = env.get_template(template_name).render(**{**context, "lang": "ro"})
    body_ro_html = env.get_template(template_name.replace(".txt.j2", ".html.j2")).render(**{**context, "lang": "ro"})
    body_en_text = env.get_template(template_name).render(**{**context, "lang": "en"})
    body_en_html = env.get_template(template_name.replace(".txt.j2", ".html.j2")).render(**{**context, "lang": "en"})

    text_body, html_body = _bilingual_sections(
        text_ro=body_ro_text,
        text_en=body_en_text,
        html_ro=body_ro_html,
        html_en=body_en_html,
        preferred_language=preferred_language,
    )

    base_text = env.get_template("base.txt.j2")
    base_html = env.get_template("base.html.j2")
    unsubscribe_url = context.get("unsubscribe_url")
    if not isinstance(unsubscribe_url, str) or not unsubscribe_url.strip():
        unsubscribe_url = None
    return (
        base_text.render(body=text_body, unsubscribe_url=unsubscribe_url),
        base_html.render(body=html_body or "", unsubscribe_url=unsubscribe_url),
    )


def _courier_label(courier: str | None, *, lang: str) -> str | None:
    value = (courier or "").strip().lower()
    if not value:
        return None
    if value == "sameday":
        return "Sameday"
    if value in {"fan", "fan_courier", "fan courier"}:
        return "Fan Courier"
    return courier


def _delivery_type_label(delivery_type: str | None, *, lang: str) -> str | None:
    value = (delivery_type or "").strip().lower()
    if not value:
        return None
    if value == "home":
        return "Home delivery" if lang == "en" else "Livrare la adresă"
    if value == "locker":
        return "Locker pickup" if lang == "en" else "Ridicare din locker"
    return delivery_type


def _payment_method_label(payment_method: str | None, *, lang: str) -> str | None:
    value = (payment_method or "").strip().lower()
    if not value:
        return None
    if value == "stripe":
        return "Stripe"
    if value == "cod":
        return "Cash" if lang == "en" else "Numerar"
    if value == "paypal":
        return "PayPal"
    if value == "netopia":
        return "Netopia"
    return payment_method


def _delivery_summary_line(order, *, lang: str) -> str | None:
    courier = _courier_label(getattr(order, "courier", None), lang=lang)
    delivery = _delivery_type_label(getattr(order, "delivery_type", None), lang=lang)
    parts = [x for x in (courier, delivery) if x]
    if not parts:
        return None
    label = "Delivery" if lang == "en" else "Livrare"
    return f"{label}: {' · '.join(parts)}"


def _locker_line(order, *, lang: str) -> str | None:
    delivery_type = _first_non_empty_str(getattr(order, "delivery_type", None)).lower()
    if delivery_type != "locker":
        return None
    locker_name = _first_non_empty_str(getattr(order, "locker_name", None))
    locker_address = _first_non_empty_str(getattr(order, "locker_address", None))
    if not locker_name and not locker_address:
        return None
    label = "Locker" if lang == "en" else "Locker"
    if locker_name and locker_address:
        detail = f"{locker_name} — {locker_address}"
    else:
        detail = locker_name or locker_address
    return f"{label}: {detail}"


def _delivery_lines(order, *, lang: str) -> list[str]:
    lines: list[str] = []
    delivery_line = _delivery_summary_line(order, lang=lang)
    if delivery_line:
        lines.append(delivery_line)
    locker_line = _locker_line(order, lang=lang)
    if locker_line:
        lines.append(locker_line)
    return lines


def _order_item_line(item, *, currency: str) -> str:
    product = getattr(item, "product", None)
    name = (getattr(product, "name", None) or str(getattr(item, "product_id", ""))).strip()
    slug = (getattr(product, "slug", None) or "").strip()
    product_url = f"{settings.frontend_origin.rstrip('/')}/products/{slug}" if slug else None
    qty = int(getattr(item, "quantity", 0) or 0)
    unit_price = getattr(item, "unit_price", None)
    tail = f" — {product_url}" if product_url else ""
    if unit_price is None:
        return f"- {name} ×{qty}{tail}"
    return f"- {name} ×{qty} — {_money_str(unit_price, currency)}{tail}"


def _append_order_item_lines(lines: list[str], *, items: Sequence | None, currency: str, lang: str) -> None:
    if not items:
        return
    lines.append("Produse:" if lang == "ro" else "Items:")
    for item in items:
        lines.append(_order_item_line(item, currency=currency))


def _is_non_zero_amount(amount: object) -> bool:
    try:
        dec = amount if isinstance(amount, Decimal) else Decimal(str(amount))
    except Exception:
        dec = Decimal("0.00")
    return dec != 0


def _append_order_charge_lines(lines: list[str], *, order, currency: str, lang: str) -> None:
    shipping_amount = getattr(order, "shipping_amount", None)
    fee_amount = getattr(order, "fee_amount", None)
    tax_amount = getattr(order, "tax_amount", None)
    if shipping_amount is not None:
        lines.append(("Livrare: " if lang == "ro" else "Shipping: ") + _money_str(shipping_amount, currency))
    if fee_amount is not None and _is_non_zero_amount(fee_amount):
        lines.append(("Cost suplimentar: " if lang == "ro" else "Additional cost: ") + _money_str(fee_amount, currency))
    if tax_amount is not None:
        lines.append(("TVA: " if lang == "ro" else "VAT: ") + _money_str(tax_amount, currency))


def _append_order_account_links(
    lines: list[str],
    *,
    lang: str,
    receipt_url: str,
    receipt_pdf_url: str,
) -> None:
    account_url = f"{settings.frontend_origin.rstrip('/')}/account"
    lines.append("")
    lines.append(f"Chitanță (HTML): {receipt_url}" if lang == "ro" else f"Receipt (HTML): {receipt_url}")
    lines.append(f"Chitanță (PDF): {receipt_pdf_url}" if lang == "ro" else f"Receipt (PDF): {receipt_pdf_url}")
    lines.append(f"Detalii în cont: {account_url}" if lang == "ro" else f"View in your account: {account_url}")


def _order_confirmation_lines(
    *,
    lang: str,
    order,
    ref: str,
    items: Sequence | None,
    currency: str,
    receipt_url: str,
    receipt_pdf_url: str,
) -> list[str]:
    lines = [f"Îți mulțumim pentru comanda {ref}." if lang == "ro" else f"Thank you for your order {ref}."]
    payment = _payment_method_label(getattr(order, "payment_method", None), lang=lang)
    if payment:
        lines.append(("Plată: " if lang == "ro" else "Payment: ") + payment)
    lines.extend(_delivery_lines(order, lang=lang))
    _append_order_item_lines(lines, items=items, currency=currency, lang=lang)
    _append_order_charge_lines(lines, order=order, currency=currency, lang=lang)
    lines.append(TOTAL_LABEL + _money_str(getattr(order, "total_amount", 0), currency))
    _append_order_account_links(lines, lang=lang, receipt_url=receipt_url, receipt_pdf_url=receipt_pdf_url)
    return lines


def _order_confirmation_receipt_context(order, *, ref: str, receipt_share_days: int | None) -> tuple[str, str, str, str]:
    currency = _first_non_empty_str(getattr(order, "currency", None), default="RON")
    ttl_days = int(receipt_share_days) if receipt_share_days and int(receipt_share_days) > 0 else RECEIPT_SHARE_DAYS
    receipt_expires_at = datetime.now(timezone.utc) + timedelta(days=ttl_days)
    token_version = int(getattr(order, "receipt_token_version", 0) or 0)
    receipt_token = create_receipt_token(
        order_id=str(getattr(order, "id", "")),
        expires_at=receipt_expires_at,
        token_version=token_version,
    )
    base = settings.frontend_origin.rstrip("/")
    receipt_url = f"{base}/receipt/{receipt_token}"
    receipt_pdf_url = f"{base}/api/v1/orders/receipt/{receipt_token}/pdf"
    receipt_filename = f"receipt-{ref}.pdf"
    return currency, receipt_url, receipt_pdf_url, receipt_filename


def _order_confirmation_text(
    *,
    order,
    ref: str,
    items: Sequence | None,
    currency: str,
    receipt_url: str,
    receipt_pdf_url: str,
) -> tuple[str, str]:
    common = {
        "order": order,
        "ref": ref,
        "items": items,
        "currency": currency,
        "receipt_url": receipt_url,
        "receipt_pdf_url": receipt_pdf_url,
    }
    text_ro = "\n".join(_order_confirmation_lines(lang="ro", **common))
    text_en = "\n".join(_order_confirmation_lines(lang="en", **common))
    return text_ro, text_en


async def send_order_confirmation(
    to_email: str,
    order,
    items: Sequence | None = None,
    lang: str | None = None,
    *,
    receipt_share_days: int | None = None,
) -> bool:
    ref = getattr(order, "reference_code", None) or str(getattr(order, "id", ""))
    currency, receipt_url, receipt_pdf_url, receipt_filename = _order_confirmation_receipt_context(
        order,
        ref=ref,
        receipt_share_days=receipt_share_days,
    )

    subject_ro = f"Confirmare comandă {ref}"
    subject_en = f"Order confirmation {ref}"
    subject = _bilingual_subject(subject_ro, subject_en, preferred_language=lang)
    text_ro, text_en = _order_confirmation_text(
        order=order,
        ref=ref,
        items=items,
        currency=currency,
        receipt_url=receipt_url,
        receipt_pdf_url=receipt_pdf_url,
    )
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    pdf = await anyio.to_thread.run_sync(receipt_service.render_order_receipt_pdf, order, items or [])
    return await send_email(
        to_email,
        subject,
        text_body,
        html_body,
        attachments=[{"filename": receipt_filename, "mime": "application/pdf", "content": pdf}],
    )


async def send_order_processing_update(to_email: str, order, *, lang: str | None = None) -> bool:
    ref = getattr(order, "reference_code", None) or str(getattr(order, "id", ""))
    account_url = f"{settings.frontend_origin.rstrip('/')}/account"

    def _lines(lng: str) -> list[str]:
        lines = [
            f"Comanda {ref} este în procesare." if lng == "ro" else f"Your order {ref} is being processed."
        ]
        lines.append(
            "Pregătim coletul și revenim cu detalii de livrare."
            if lng == "ro"
            else "We’re preparing your package and will follow up with shipping details."
        )
        payment = _payment_method_label(getattr(order, "payment_method", None), lang=lng)
        if payment:
            lines.append(("Plată: " if lng == "ro" else "Payment: ") + payment)
        lines.extend(_delivery_lines(order, lang=lng))
        lines.append("")
        lines.append(
            f"Detalii în cont: {account_url}" if lng == "ro" else f"View in your account: {account_url}"
        )
        return lines

    subject = _bilingual_subject(
        f"Comanda {ref} este în procesare",
        f"Order {ref} is being processed",
        preferred_language=lang,
    )
    text_ro = "\n".join(_lines("ro"))
    text_en = "\n".join(_lines("en"))
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


def _localized_prefixed_line(*, lang: str, ro_prefix: str, en_prefix: str, value: str | None) -> str | None:
    if not value:
        return None
    return (ro_prefix if lang == "ro" else en_prefix) + value


def _refund_card_note(*, lang: str, payment_method: str) -> str | None:
    if payment_method not in {"stripe", "paypal"}:
        return None
    return (
        "Dacă ai plătit cu cardul, suma va fi rambursată în contul tău cât mai curând."
        if lang == "ro"
        else "If you paid by card, the amount will be refunded back to your account as soon as possible."
    )


def _order_cancelled_lines(
    *,
    lang: str,
    order,
    ref: str,
    cancel_reason: str | None,
    contact_url: str,
) -> list[str]:
    lines = [f"Comanda {ref} a fost anulată." if lang == "ro" else f"Your order {ref} was cancelled."]
    reason_line = _localized_prefixed_line(lang=lang, ro_prefix="Motiv: ", en_prefix="Reason: ", value=cancel_reason)
    if reason_line:
        lines.append(reason_line)
    lines.append(
        "Dacă ai întrebări sau crezi că este o eroare, te rugăm să ne contactezi."
        if lang == "ro"
        else "If you have questions or believe this is a mistake, please contact us."
    )
    raw_payment_method = (getattr(order, "payment_method", None) or "").strip().lower()
    payment = _payment_method_label(raw_payment_method, lang=lang)
    payment_line = _localized_prefixed_line(lang=lang, ro_prefix="Plată: ", en_prefix="Payment: ", value=payment)
    if payment_line:
        lines.append(payment_line)
    refund_line = _refund_card_note(lang=lang, payment_method=raw_payment_method)
    if refund_line:
        lines.append(refund_line)
    lines.extend(_delivery_lines(order, lang=lang))
    lines.append("")
    lines.append(f"Contact: {contact_url}")
    return lines


async def send_order_cancelled_update(to_email: str, order, *, lang: str | None = None) -> bool:
    ref = getattr(order, "reference_code", None) or str(getattr(order, "id", ""))
    contact_url = f"{settings.frontend_origin.rstrip('/')}/contact"
    cancel_reason = (getattr(order, "cancel_reason", None) or "").strip() or None

    subject = _bilingual_subject(
        f"Comanda {ref} a fost anulată",
        f"Order {ref} was cancelled",
        preferred_language=lang,
    )
    text_ro = "\n".join(
        _order_cancelled_lines(
            lang="ro",
            order=order,
            ref=ref,
            cancel_reason=cancel_reason,
            contact_url=contact_url,
        )
    )
    text_en = "\n".join(
        _order_cancelled_lines(
            lang="en",
            order=order,
            ref=ref,
            cancel_reason=cancel_reason,
            contact_url=contact_url,
        )
    )
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


def _cancel_request_lines(
    *,
    lang: str,
    order,
    ref: str,
    requested_by: str | None,
    reason: str | None,
    status_value: str | None,
    admin_url: str,
) -> list[str]:
    lines = [
        f"Cerere de anulare pentru comanda {ref}."
        if lang == "ro"
        else f"Cancellation request for order {ref}."
    ]
    requested_by_line = _localized_prefixed_line(
        lang=lang,
        ro_prefix="Solicitat de: ",
        en_prefix="Requested by: ",
        value=requested_by,
    )
    if requested_by_line:
        lines.append(requested_by_line)
    reason_line = _localized_prefixed_line(lang=lang, ro_prefix="Motiv: ", en_prefix="Reason: ", value=reason)
    if reason_line:
        lines.append(reason_line)
    payment = _payment_method_label(getattr(order, "payment_method", None), lang=lang)
    payment_line = _localized_prefixed_line(lang=lang, ro_prefix="Plată: ", en_prefix="Payment: ", value=payment)
    if payment_line:
        lines.append(payment_line)
    status_line = _localized_prefixed_line(lang=lang, ro_prefix="Status: ", en_prefix="Status: ", value=status_value)
    if status_line:
        lines.append(status_line)
    lines.append("")
    lines.append(f"Admin: {admin_url}")
    return lines


async def send_order_cancel_request_notification(
    to_email: str,
    order,
    *,
    requested_by_email: str | None = None,
    reason: str | None = None,
    lang: str | None = None,
) -> bool:
    ref = getattr(order, "reference_code", None) or str(getattr(order, "id", ""))
    admin_url = f"{settings.frontend_origin.rstrip('/')}/admin/orders/{getattr(order, 'id', '')}"
    status_value = getattr(getattr(order, "status", None), "value", None) or str(getattr(order, "status", "") or "")

    reason_clean = (reason or "").strip() or None
    requested_by = (requested_by_email or "").strip() or None

    subject = _bilingual_subject(
        f"Cerere de anulare: {ref}",
        f"Cancellation request: {ref}",
        preferred_language=lang,
    )
    text_ro = "\n".join(
        _cancel_request_lines(
            lang="ro",
            order=order,
            ref=ref,
            requested_by=requested_by,
            reason=reason_clean,
            status_value=status_value,
            admin_url=admin_url,
        )
    )
    text_en = "\n".join(
        _cancel_request_lines(
            lang="en",
            order=order,
            ref=ref,
            requested_by=requested_by,
            reason=reason_clean,
            status_value=status_value,
            admin_url=admin_url,
        )
    )
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_order_refunded_update(to_email: str, order, *, lang: str | None = None) -> bool:
    ref = getattr(order, "reference_code", None) or str(getattr(order, "id", ""))
    account_url = f"{settings.frontend_origin.rstrip('/')}/account"
    currency = getattr(order, "currency", "RON") or "RON"

    def _lines(lng: str) -> list[str]:
        lines = [
            f"Comanda {ref} a fost rambursată." if lng == "ro" else f"Your order {ref} was refunded."
        ]
        lines.append(TOTAL_LABEL + _money_str(getattr(order, "total_amount", 0), currency))
        payment = _payment_method_label(getattr(order, "payment_method", None), lang=lng)
        if payment:
            lines.append(("Plată: " if lng == "ro" else "Payment: ") + payment)
        lines.append("")
        lines.append(
            f"Detalii în cont: {account_url}" if lng == "ro" else f"View in your account: {account_url}"
        )
        return lines

    subject = _bilingual_subject(
        f"Rambursare pentru comanda {ref}",
        f"Refund for order {ref}",
        preferred_language=lang,
    )
    text_ro = "\n".join(_lines("ro"))
    text_en = "\n".join(_lines("en"))
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_order_partial_refund_update(
    to_email: str,
    order,
    refund,
    *,
    lang: str | None = None,
) -> bool:
    ref = getattr(order, "reference_code", None) or str(getattr(order, "id", ""))
    account_url = f"{settings.frontend_origin.rstrip('/')}/account/orders"
    currency = getattr(order, "currency", "RON") or "RON"

    amount = _money_str(getattr(refund, "amount", 0), currency)
    note = (getattr(refund, "note", None) or "").strip() or None
    provider = (getattr(refund, "provider", None) or "").strip() or None

    def _lines(lng: str) -> list[str]:
        lines = [
            (
                f"A fost emisă o rambursare parțială pentru comanda {ref}."
                if lng == "ro"
                else f"A partial refund was issued for your order {ref}."
            )
        ]
        lines.append(("Sumă: " if lng == "ro" else "Amount: ") + amount)
        if provider:
            lines.append(("Procesator: " if lng == "ro" else "Provider: ") + provider)
        if note:
            lines.append(("Notă: " if lng == "ro" else "Note: ") + note)
        lines.append("")
        lines.append(
            f"Detalii în cont: {account_url}" if lng == "ro" else f"View in your account: {account_url}"
        )
        return lines

    subject = _bilingual_subject(
        f"Rambursare parțială pentru comanda {ref}",
        f"Partial refund for order {ref}",
        preferred_language=lang,
    )
    text_ro = "\n".join(_lines("ro"))
    text_en = "\n".join(_lines("en"))
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_new_order_notification(
    to_email: str, order, customer_email: str | None = None, lang: str | None = None
) -> bool:
    ref = getattr(order, "reference_code", None) or str(getattr(order, "id", ""))
    currency = getattr(order, "currency", "RON") or "RON"

    def _lines(lng: str) -> list[str]:
        lines = [
            f"O comandă nouă a fost plasată: {ref}"
            if lng == "ro"
            else f"A new order was placed: {ref}"
        ]
        if customer_email:
            lines.append(f"Client: {customer_email}" if lng == "ro" else f"Customer: {customer_email}")
        payment = _payment_method_label(getattr(order, "payment_method", None), lang=lng)
        if payment:
            lines.append(("Plată: " if lng == "ro" else "Payment: ") + payment)
        lines.extend(_delivery_lines(order, lang=lng))
        lines.append(TOTAL_LABEL + _money_str(getattr(order, "total_amount", 0), currency))
        admin_url = f"{settings.frontend_origin.rstrip('/')}/admin/orders"
        lines.append("")
        lines.append(f"Vezi în admin: {admin_url}" if lng == "ro" else f"View in admin: {admin_url}")
        return lines

    subject_ro = f"Comandă nouă primită {ref}"
    subject_en = f"New order received {ref}"
    subject = _bilingual_subject(subject_ro, subject_en, preferred_language=lang)
    text_ro = "\n".join(_lines("ro"))
    text_en = "\n".join(_lines("en"))
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_password_reset(to_email: str, token: str, lang: str | None = None) -> bool:
    subject = _bilingual_subject("Resetare parolă", "Password reset", preferred_language=lang)
    reset_url = f"{settings.frontend_origin.rstrip('/')}/password-reset/confirm?token={token}"
    text_ro = (
        f"Resetează parola aici: {reset_url}\n\n"
        f"Sau folosește acest cod: {token}\n\n"
        "Dacă nu ai cerut resetarea, poți ignora acest email."
    )
    text_en = (
        f"Reset your password here: {reset_url}\n\n"
        f"Or use this token: {token}\n\n"
        "If you didn’t request this, you can ignore this email."
    )
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


def _sanitize_next_path(next_path: str | None) -> str | None:
    raw = str(next_path or "").strip()
    if not raw:
        return None
    if not raw.startswith("/") or raw.startswith("//") or "://" in raw:
        return None
    return raw


async def send_verification_email(
    to_email: str, token: str, lang: str | None = None, kind: str = "primary", next_path: str | None = None
) -> bool:
    subject = _bilingual_subject("Verifică-ți emailul", "Verify your email", preferred_language=lang)
    kind_norm = (kind or "primary").strip().lower()
    params: dict[str, str] = {"token": token}
    if kind_norm and kind_norm != "primary":
        params["kind"] = kind_norm
    next_norm = _sanitize_next_path(next_path)
    if kind_norm == "guest":
        params["email"] = to_email
        params["next"] = next_norm or "/checkout"
    elif next_norm:
        params["next"] = next_norm
    verify_url = f"{settings.frontend_origin.rstrip('/')}/verify-email?{urlencode(params)}"

    text_ro = (
        f"Apasă pe acest link pentru a verifica emailul: {verify_url}\n\n"
        f"Sau folosește acest cod: {token}"
    )
    text_en = (
        f"Click this link to verify your email: {verify_url}\n\n"
        f"Or use this token: {token}"
    )
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_welcome_email(
    to_email: str,
    *,
    first_name: str | None = None,
    lang: str | None = None,
) -> bool:
    name = (first_name or "").strip()
    account_url = f"{settings.frontend_origin.rstrip('/')}/account"

    subject = _bilingual_subject("Bine ai venit la momentstudio", "Welcome to momentstudio", preferred_language=lang)
    greet_ro = f"Bună, {name}!" if name else "Bună!"
    greet_en = f"Hi {name}!" if name else "Hi!"

    text_ro = (
        f"{greet_ro}\n\n"
        "Contul tău a fost creat cu succes.\n\n"
        f"Poți vedea profilul și comenzile aici: {account_url}\n\n"
        "Mulțumim,\n"
        "momentstudio"
    )
    text_en = (
        f"{greet_en}\n\n"
        "Your account has been created successfully.\n\n"
        f"You can view your profile and orders here: {account_url}\n\n"
        "Thanks,\n"
        "momentstudio"
    )
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_password_changed(to_email: str, *, lang: str | None = None) -> bool:
    subject = _bilingual_subject("Parola a fost schimbată", "Password changed", preferred_language=lang)
    account_url = f"{settings.frontend_origin.rstrip('/')}/account"

    text_ro = (
        "Parola contului tău a fost schimbată.\n\n"
        "Dacă nu ai făcut tu această schimbare, te rugăm să ne contactezi imediat.\n\n"
        f"Cont: {account_url}"
    )
    text_en = (
        "Your account password was changed.\n\n"
        "If you did not make this change, please contact us immediately.\n\n"
        f"Account: {account_url}"
    )
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_email_changed(
    to_email: str,
    *,
    old_email: str,
    new_email: str,
    lang: str | None = None,
) -> bool:
    subject = _bilingual_subject("Email schimbat", "Email changed", preferred_language=lang)
    account_url = f"{settings.frontend_origin.rstrip('/')}/account"

    text_ro = (
        "Emailul contului tău a fost schimbat.\n\n"
        f"Vechi: {old_email}\n"
        f"Nou: {new_email}\n\n"
        "Dacă nu ai făcut tu această schimbare, te rugăm să ne contactezi imediat.\n\n"
        f"Cont: {account_url}"
    )
    text_en = (
        "Your account email was changed.\n\n"
        f"Old: {old_email}\n"
        f"New: {new_email}\n\n"
        "If you did not make this change, please contact us immediately.\n\n"
        f"Account: {account_url}"
    )
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


def _admin_login_alert_context(
    *,
    admin_username: str,
    admin_display_name: str | None,
    admin_role: str | None,
    ip_address: str | None,
    country_code: str | None,
    user_agent: str | None,
    occurred_at: datetime | None,
) -> dict[str, str]:
    admin_name = _first_non_empty_str(admin_display_name, admin_username)
    role_value = _first_non_empty_str(admin_role, default="admin")
    when = (occurred_at or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat(timespec="seconds")
    ip = _first_non_empty_str(ip_address, default="unknown")
    cc = _first_non_empty_str(country_code)
    ua = _first_non_empty_str(user_agent, default="unknown")
    location = f"{ip} ({cc})" if cc else ip
    dashboard_url = f"{settings.frontend_origin.rstrip('/')}/admin"
    return {
        "admin_name": admin_name,
        "admin_username": admin_username,
        "role_value": role_value,
        "when": when,
        "location": location,
        "user_agent": ua,
        "dashboard_url": dashboard_url,
    }


def _admin_login_alert_bodies(context: dict[str, str]) -> tuple[str, str]:
    text_ro = (
        "A fost detectată o autentificare nouă pentru un cont de administrator.\n\n"
        f"Admin: {context['admin_name']} ({context['admin_username']})\n"
        f"Rol: {context['role_value']}\n"
        f"Când: {context['when']}\n"
        f"IP: {context['location']}\n"
        f"User-Agent: {context['user_agent']}\n\n"
        "Dacă nu recunoști această autentificare, recomandăm să schimbi parola și să revoci sesiunile active.\n\n"
        f"Admin: {context['dashboard_url']}"
    )
    text_en = (
        "A new login was detected for an admin account.\n\n"
        f"Admin: {context['admin_name']} ({context['admin_username']})\n"
        f"Role: {context['role_value']}\n"
        f"When: {context['when']}\n"
        f"IP: {context['location']}\n"
        f"User-Agent: {context['user_agent']}\n\n"
        "If you don’t recognize this login, we recommend changing the password and revoking active sessions.\n\n"
        f"Admin: {context['dashboard_url']}"
    )
    return text_ro, text_en


async def send_admin_login_alert(
    to_email: str,
    *,
    admin_username: str,
    admin_display_name: str | None = None,
    admin_role: str | None = None,
    ip_address: str | None = None,
    country_code: str | None = None,
    user_agent: str | None = None,
    occurred_at: datetime | None = None,
    lang: str | None = None,
) -> bool:
    subject = _bilingual_subject("Alertă: autentificare admin nouă", "Alert: new admin login", preferred_language=lang)
    context = _admin_login_alert_context(
        admin_username=admin_username,
        admin_display_name=admin_display_name,
        admin_role=admin_role,
        ip_address=ip_address,
        country_code=country_code,
        user_agent=user_agent,
        occurred_at=occurred_at,
    )
    text_ro, text_en = _admin_login_alert_bodies(context)
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_shipping_update(to_email: str, order, tracking_number: str | None = None, lang: str | None = None) -> bool:
    ref = getattr(order, "reference_code", None) or str(getattr(order, "id", ""))
    tracking_url = (getattr(order, "tracking_url", None) or "").strip() or None

    def _lines(lng: str) -> list[str]:
        lines = [
            f"Comanda {ref} a fost expediată." if lng == "ro" else f"Your order {ref} has shipped."
        ]
        lines.append(
            f"Comanda {ref} este pe drum." if lng == "ro" else f"Order {ref} is on the way."
        )
        if tracking_number:
            lines.append(f"AWB: {tracking_number}" if lng == "ro" else f"Tracking: {tracking_number}")
        if tracking_url:
            lines.append(f"Urmărire: {tracking_url}" if lng == "ro" else f"Tracking link: {tracking_url}")
        lines.extend(_delivery_lines(order, lang=lng))
        return lines

    subject_ro = f"Comanda {ref} a fost expediată"
    subject_en = f"Your order {ref} has shipped"
    subject = _bilingual_subject(subject_ro, subject_en, preferred_language=lang)
    text_ro = "\n".join(_lines("ro"))
    text_en = "\n".join(_lines("en"))
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_delivery_confirmation(to_email: str, order, lang: str | None = None) -> bool:
    ref = getattr(order, "reference_code", None) or str(getattr(order, "id", ""))

    text_ro = "\n".join([f"Comanda {ref} a fost livrată și este finalizată."] + _delivery_lines(order, lang="ro"))
    text_en = "\n".join([f"Order {ref} has been delivered and is now complete."] + _delivery_lines(order, lang="en"))
    subject = _bilingual_subject(
        f"Comanda {ref} este finalizată",
        f"Order {ref} is complete",
        preferred_language=lang,
    )
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_refund_requested_notification(
    to_email: str,
    order,
    *,
    customer_email: str | None = None,
    requested_by_email: str | None = None,
    note: str | None = None,
    lang: str | None = None,
) -> bool:
    ref = getattr(order, "reference_code", None) or str(getattr(order, "id", ""))
    currency = getattr(order, "currency", "RON") or "RON"
    total_amount = getattr(order, "total_amount", 0)

    subject = _bilingual_subject(
        f"Solicitare rambursare pentru comanda {ref}",
        f"Refund requested for order {ref}",
        preferred_language=lang,
    )
    text_ro = "\n".join(
        _refund_requested_lines(
            lang="ro",
            reference=ref,
            total_amount=total_amount,
            currency=currency,
            customer_email=customer_email,
            requested_by_email=requested_by_email,
            note=note,
        )
    )
    text_en = "\n".join(
        _refund_requested_lines(
            lang="en",
            reference=ref,
            total_amount=total_amount,
            currency=currency,
            customer_email=customer_email,
            requested_by_email=requested_by_email,
            note=note,
        )
    )
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_cart_abandonment(to_email: str, *, lang: str | None = None) -> bool:
    subject = _bilingual_subject("Te mai gândești?", "Still thinking it over?", preferred_language=lang)
    unsubscribe_url, headers = _marketing_unsubscribe_context(to_email=to_email)
    text_body, html_body = render_bilingual_template(
        "cart_abandonment.txt.j2",
        {"cart_url": f"{settings.frontend_origin.rstrip('/')}/cart", "unsubscribe_url": unsubscribe_url},
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body, headers=headers)


async def send_back_in_stock(to_email: str, product_name: str, *, lang: str | None = None) -> bool:
    subject = _bilingual_subject(
        f"{product_name} este din nou în stoc",
        f"{product_name} is back in stock",
        preferred_language=lang,
    )
    text_body, html_body = render_bilingual_template(
        "back_in_stock.txt.j2", {"product_name": product_name}, preferred_language=lang
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_low_stock_alert(to_email: str, product_name: str, stock: int, *, lang: str | None = None) -> bool:
    subject = _bilingual_subject(
        f"Alertă stoc redus: {product_name}",
        f"Low stock alert: {product_name}",
        preferred_language=lang,
    )
    text_body, html_body = render_bilingual_template(
        "low_stock_alert.txt.j2", {"product_name": product_name, "stock": stock}, preferred_language=lang
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_coupon_assigned(
    to_email: str,
    *,
    coupon_code: str,
    promotion_name: str,
    promotion_description: str | None = None,
    ends_at: datetime | None = None,
    lang: str | None = None,
) -> bool:
    subject = _bilingual_subject("Cupon nou", "New coupon", preferred_language=lang)
    ends_str = ends_at.strftime("%Y-%m-%d") if ends_at else None
    account_url = f"{settings.frontend_origin.rstrip('/')}/account/coupons"
    unsubscribe_url, headers = _marketing_unsubscribe_context(to_email=to_email)
    text_body, html_body = render_bilingual_template(
        "coupon_assigned.txt.j2",
        {
            "coupon_code": str(coupon_code or "").strip().upper(),
            "promotion_name": promotion_name,
            "promotion_description": promotion_description,
            "ends_at": ends_str,
            "account_url": account_url,
            "unsubscribe_url": unsubscribe_url,
        },
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body, headers=headers)


async def send_coupon_revoked(
    to_email: str,
    *,
    coupon_code: str,
    promotion_name: str,
    reason: str | None = None,
    lang: str | None = None,
) -> bool:
    subject = _bilingual_subject("Cupon revocat", "Coupon revoked", preferred_language=lang)
    unsubscribe_url, headers = _marketing_unsubscribe_context(to_email=to_email)
    text_body, html_body = render_bilingual_template(
        "coupon_revoked.txt.j2",
        {
            "coupon_code": str(coupon_code or "").strip().upper(),
            "promotion_name": promotion_name,
            "reason": (reason or "").strip() or None,
            "unsubscribe_url": unsubscribe_url,
        },
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body, headers=headers)


async def send_newsletter_confirmation(
    to_email: str,
    *,
    confirm_url: str,
) -> bool:
    subject = _bilingual_subject("Confirmă newsletter-ul", "Confirm your newsletter subscription", preferred_language=None)
    text_ro = (
        "Îți mulțumim! Confirmă abonarea la newsletter folosind acest link:\n\n"
        f"{confirm_url}\n\n"
        "Dacă nu ai cerut această abonare, poți ignora acest email."
    )
    text_en = (
        "Thanks! Please confirm your newsletter subscription using this link:\n\n"
        f"{confirm_url}\n\n"
        "If you didn’t request this subscription, you can ignore this email."
    )
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=None,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_error_alert(to_email: str, message: str) -> bool:
    subject = _bilingual_subject("Alertă critică", "Critical error alert", preferred_language=None)
    text_ro = f"A apărut o eroare critică:\n\n{message}"
    text_en = f"A critical error occurred:\n\n{message}"
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=None,
    )
    return await send_email(to_email, subject, text_body, html_body)


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
    def _detail_lines(lng: str) -> list[str]:
        amount_detail = f"{amount / 100:.2f} {currency.upper()}" if amount is not None and currency else None
        detail_rows: list[tuple[str | None, str, str]] = [
            (dispute_id, "Dispută", "Dispute"),
            (charge_id, "Plată", "Charge"),
            (amount_detail, "Sumă", "Amount"),
            (reason, "Motiv", "Reason"),
            (dispute_status, "Stare", "Status"),
        ]
        lines: list[str] = []
        for value, label_ro, label_en in detail_rows:
            if value:
                label = label_ro if lng == "ro" else label_en
                lines.append(f"{label}: {value}")
        return lines

    def _lines(lng: str) -> list[str]:
        lines = [
            "A fost primit un eveniment de dispută Stripe."
            if lng == "ro"
            else "A Stripe dispute event was received.",
            f"Event: {event_type}",
        ]
        lines.extend(_detail_lines(lng))
        return lines

    subject = _bilingual_subject(f"Dispută Stripe: {event_type}", f"Stripe dispute: {event_type}", preferred_language=lang)
    text_ro = "\n".join(_lines("ro"))
    text_en = "\n".join(_lines("en"))
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_blog_comment_admin_notification(
    to_email: str,
    *,
    post_title: str,
    post_url: str,
    commenter_name: str,
    comment_body: str,
    lang: str | None = None,
) -> bool:
    subject = _bilingual_subject("Comentariu nou pe blog", "New blog comment", preferred_language=lang)
    if env is None:
        text_ro = f"Comentariu nou la: {post_title}\nDe la: {commenter_name}\n\n{comment_body}\n\nVezi: {post_url}"
        text_en = f"New comment on: {post_title}\nFrom: {commenter_name}\n\n{comment_body}\n\nView: {post_url}"
        text_body, html_body = _bilingual_sections(
            text_ro=text_ro,
            text_en=text_en,
            html_ro=_html_pre(text_ro),
            html_en=_html_pre(text_en),
            preferred_language=lang,
        )
        return await send_email(to_email, subject, text_body, html_body)

    text_body, html_body = render_bilingual_template(
        "blog_comment_admin.txt.j2",
        {"post_title": post_title, "post_url": post_url, "commenter_name": commenter_name, "comment_body": comment_body},
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_blog_comment_subscriber_notification(
    to_email: str,
    *,
    post_title: str,
    post_url: str,
    commenter_name: str,
    comment_body: str,
    lang: str | None = None,
) -> bool:
    subject = _bilingual_subject(
        "Comentariu nou la un articol urmărit",
        "New comment on a post you follow",
        preferred_language=lang,
    )
    if env is None:
        text_ro = f"Comentariu nou la: {post_title}\nDe la: {commenter_name}\n\n{comment_body}\n\nVezi: {post_url}"
        text_en = f"New comment on: {post_title}\nFrom: {commenter_name}\n\n{comment_body}\n\nView: {post_url}"
        text_body, html_body = _bilingual_sections(
            text_ro=text_ro,
            text_en=text_en,
            html_ro=_html_pre(text_ro),
            html_en=_html_pre(text_en),
            preferred_language=lang,
        )
        return await send_email(to_email, subject, text_body, html_body)

    text_body, html_body = render_bilingual_template(
        "blog_comment_subscriber.txt.j2",
        {"post_title": post_title, "post_url": post_url, "commenter_name": commenter_name, "comment_body": comment_body},
        preferred_language=lang,
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
    subject = _bilingual_subject("Răspuns nou la comentariul tău", "New reply to your comment", preferred_language=lang)
    if env is None:
        text_ro = f"Răspuns nou la comentariul tău pe: {post_title}\nDe la: {replier_name}\n\n{comment_body}\n\nVezi: {post_url}"
        text_en = f"New reply to your comment on: {post_title}\nFrom: {replier_name}\n\n{comment_body}\n\nView: {post_url}"
        text_body, html_body = _bilingual_sections(
            text_ro=text_ro,
            text_en=text_en,
            html_ro=_html_pre(text_ro),
            html_en=_html_pre(text_en),
            preferred_language=lang,
        )
        return await send_email(to_email, subject, text_body, html_body)

    text_body, html_body = render_bilingual_template(
        "blog_comment_reply.txt.j2",
        {"post_title": post_title, "post_url": post_url, "replier_name": replier_name, "comment_body": comment_body},
        preferred_language=lang,
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
    subject = _bilingual_subject("Mesaj nou de contact", "New contact submission", preferred_language=lang)
    if env is None:
        text_ro, text_en = _contact_submission_notification_fallback_bodies(
            topic=topic,
            from_name=from_name,
            from_email=from_email,
            message=message,
            order_reference=order_reference,
            admin_url=admin_url,
        )
        text_body, html_body = _bilingual_sections(
            text_ro=text_ro,
            text_en=text_en,
            html_ro=_html_pre(text_ro),
            html_en=_html_pre(text_en),
            preferred_language=lang,
        )
        return await send_email(to_email, subject, text_body, html_body)

    text_body, html_body = render_bilingual_template(
        "contact_submission_admin.txt.j2",
        {
            "topic": topic,
            "from_name": from_name,
            "from_email": from_email,
            "message": message,
            "order_reference": order_reference,
            "admin_url": admin_url,
        },
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


def _contact_submission_reply_fallback_bodies(
    *,
    safe_name: str,
    reply_message: str,
    topic: str | None,
    order_reference: str | None,
    reference: str | None,
    contact_url: str | None,
) -> tuple[str, str]:
    ro_lines = ["Răspuns la mesajul tău", f"Salut {safe_name},", ""]
    en_lines = ["Reply to your message", f"Hi {safe_name},", ""]
    if topic:
        ro_lines.append(f"Tip: {topic}")
        en_lines.append(f"Topic: {topic}")
    if order_reference:
        ro_lines.append(f"Comandă: {order_reference}")
        en_lines.append(f"Order: {order_reference}")
    if reference:
        ro_lines.append(f"Referință: {reference}")
        en_lines.append(f"Reference: {reference}")
    ro_lines.extend(["", reply_message])
    en_lines.extend(["", reply_message])
    if contact_url:
        ro_lines.extend(["", f"Ajutor: {contact_url}"])
        en_lines.extend(["", f"Help: {contact_url}"])
    return "\n".join(ro_lines), "\n".join(en_lines)


async def send_contact_submission_reply(
    to_email: str,
    *,
    customer_name: str,
    reply_message: str,
    topic: str | None = None,
    order_reference: str | None = None,
    reference: str | None = None,
    contact_url: str | None = None,
    lang: str | None = None,
) -> bool:
    subject = _bilingual_subject("Răspuns la solicitarea ta", "Reply to your request", preferred_language=lang)
    safe_name = (customer_name or "").strip() or "Customer"
    if env is None:
        text_ro, text_en = _contact_submission_reply_fallback_bodies(
            safe_name=safe_name,
            reply_message=reply_message,
            topic=topic,
            order_reference=order_reference,
            reference=reference,
            contact_url=contact_url,
        )
        text_body, html_body = _bilingual_sections(
            text_ro=text_ro,
            text_en=text_en,
            html_ro=_html_pre(text_ro),
            html_en=_html_pre(text_en),
            preferred_language=lang,
        )
        return await send_email(to_email, subject, text_body, html_body)

    text_body, html_body = render_bilingual_template(
        "contact_submission_reply.txt.j2",
        {
            "customer_name": safe_name,
            "reply_message": reply_message,
            "topic": topic,
            "order_reference": order_reference,
            "reference": reference,
            "contact_url": contact_url,
        },
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


def _return_request_item_rows(return_request) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for item in getattr(return_request, "items", []) or []:
        order_item = getattr(item, "order_item", None)
        product = getattr(order_item, "product", None) if order_item else None
        items.append({"name": getattr(product, "name", None) or str(getattr(item, "order_item_id", "")), "quantity": item.quantity})
    return items


def _return_request_created_fallback_bodies(
    *,
    order_ref: str,
    customer_name: str,
    items: list[dict[str, Any]],
    reason: str,
) -> tuple[str, str]:
    ro_lines = ["Cerere de retur creată", f"Comandă: {order_ref}"]
    en_lines = ["Return request created", f"Order: {order_ref}"]
    if customer_name:
        ro_lines.append(f"Client: {customer_name}")
        en_lines.append(f"Customer: {customer_name}")
    ro_lines.append("")
    en_lines.append("")
    for row in items:
        ro_lines.append(f"- {row['name']} ×{row['quantity']}")
        en_lines.append(f"- {row['name']} ×{row['quantity']}")
    ro_lines.extend(["", reason])
    en_lines.extend(["", reason])
    return "\n".join(ro_lines), "\n".join(en_lines)


async def send_return_request_created(to_email: str, return_request, *, lang: str | None = None) -> bool:
    subject = _bilingual_subject("Cerere de retur creată", "Return request created", preferred_language=lang)
    order_ref = getattr(getattr(return_request, "order", None), "reference_code", None) or str(
        getattr(return_request, "order_id", "")
    )
    customer_name = getattr(getattr(return_request, "order", None), "customer_name", None) or ""
    items = _return_request_item_rows(return_request)
    reason = getattr(return_request, "reason", "") or ""

    if env is None:
        text_ro, text_en = _return_request_created_fallback_bodies(
            order_ref=order_ref,
            customer_name=customer_name,
            items=items,
            reason=reason,
        )
        text_body, html_body = _bilingual_sections(
            text_ro=text_ro,
            text_en=text_en,
            html_ro=_html_pre(text_ro),
            html_en=_html_pre(text_en),
            preferred_language=lang,
        )
        return await send_email(to_email, subject, text_body, html_body)

    text_body, html_body = render_bilingual_template(
        "return_request_created.txt.j2",
        {
            "order_reference": order_ref,
            "customer_name": customer_name,
            "reason": getattr(return_request, "reason", None),
            "customer_message": getattr(return_request, "customer_message", None),
            "status": getattr(getattr(return_request, "status", None), "value", None) or str(getattr(return_request, "status", "")),
            "items": items,
            "account_url": f"{settings.frontend_origin.rstrip('/')}/account",
        },
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


def _return_request_status_fallback_bodies(
    *,
    order_ref: str,
    customer_name: str,
    previous_status: Any,
    next_status: Any,
    admin_note: str | None,
) -> tuple[str, str]:
    ro_lines = [
        "Actualizare cerere de retur",
        f"Comandă: {order_ref}",
        f"Stare: {previous_status} → {next_status}",
    ]
    en_lines = [
        "Return request update",
        f"Order: {order_ref}",
        f"Status: {previous_status} → {next_status}",
    ]
    if customer_name:
        ro_lines.append(f"Client: {customer_name}")
        en_lines.append(f"Customer: {customer_name}")
    if admin_note:
        ro_lines.extend(["", admin_note])
        en_lines.extend(["", admin_note])
    return "\n".join(ro_lines), "\n".join(en_lines)


async def send_return_request_status_update(
    to_email: str,
    return_request,
    *,
    previous_status,
    lang: str | None = None,
) -> bool:
    subject = _bilingual_subject("Actualizare cerere de retur", "Return request update", preferred_language=lang)
    order_ref = getattr(getattr(return_request, "order", None), "reference_code", None) or str(
        getattr(return_request, "order_id", "")
    )
    customer_name = getattr(getattr(return_request, "order", None), "customer_name", None) or ""
    prev_label = getattr(previous_status, "value", previous_status)
    next_label = getattr(getattr(return_request, "status", None), "value", getattr(return_request, "status", ""))
    note = getattr(return_request, "admin_note", None)

    if env is None:
        text_ro, text_en = _return_request_status_fallback_bodies(
            order_ref=order_ref,
            customer_name=customer_name,
            previous_status=prev_label,
            next_status=next_label,
            admin_note=note,
        )
        text_body, html_body = _bilingual_sections(
            text_ro=text_ro,
            text_en=text_en,
            html_ro=_html_pre(text_ro),
            html_en=_html_pre(text_en),
            preferred_language=lang,
        )
        return await send_email(to_email, subject, text_body, html_body)

    text_body, html_body = render_bilingual_template(
        "return_request_status_update.txt.j2",
        {
            "order_reference": order_ref,
            "customer_name": customer_name,
            "previous_status": prev_label,
            "status": next_label,
            "admin_note": note,
            "account_url": f"{settings.frontend_origin.rstrip('/')}/account",
        },
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


def render_template(template_name: str, context: dict) -> tuple[str, str]:
    if env is None:
        body = f"Email template engine is not available (template={template_name})."
        return body, _html_pre(body)
    base_text = env.get_template("base.txt.j2")
    base_html = env.get_template("base.html.j2")
    body_text = env.get_template(template_name).render(**context)
    body_html = env.get_template(template_name.replace(".txt.j2", ".html.j2")).render(**context)
    return base_text.render(body=body_text), base_html.render(body=body_html)


async def preview_email(template_name: str, context: dict) -> dict[str, str]:
    text_body, html_body = render_template(template_name, context)
    return {"text": text_body, "html": html_body}


def _admin_summary_header_lines(
    *,
    is_ro: bool,
    kind_label_ro: str,
    kind_label_en: str,
    start_label: str,
    end_label: str,
    gross: object,
    net: object,
    refunds: object,
    currency: str,
) -> list[str]:
    return [
        (
            f"Raport {kind_label_ro.lower()} — {start_label} → {end_label} (UTC)"
            if is_ro
            else f"{kind_label_en} report — {start_label} → {end_label} (UTC)"
        ),
        "",
        ("Vânzări brute: " if is_ro else "Gross sales: ") + _money_str(gross, currency),
        ("Vânzări nete: " if is_ro else "Net sales: ") + _money_str(net, currency),
        ("Rambursări: " if is_ro else "Refunds: ") + _money_str(refunds, currency),
    ]


def _admin_summary_order_lines(*, is_ro: bool, orders_success: int, orders_total: int, orders_refunded: int) -> list[str]:
    return [
        (
            f"Comenzi: {orders_success} plătite/expediate/livrate · {orders_total} total"
            if is_ro
            else f"Orders: {orders_success} paid/shipped/delivered · {orders_total} total"
        ),
        (
            f"Comenzi rambursate: {orders_refunded}"
            if is_ro
            else f"Refunded orders: {orders_refunded}"
        ),
        "",
    ]


def _summary_row_name(row: dict) -> str:
    return (str(row.get("name") or "")).strip() or str(row.get("slug") or "").strip() or "—"


def _summary_row_label(name: str, slug: str) -> str:
    if slug and slug not in name:
        return f"{name} ({slug})"
    return name


def _summary_qty_sales_suffix(*, qty: int, sales: object, is_ro: bool, currency: str) -> str:
    if is_ro:
        return f"{qty} buc · {_money_str(sales, currency)}"
    return f"{qty} pcs · {_money_str(sales, currency)}"


def _admin_summary_top_products_lines(*, products: list[dict] | None, is_ro: bool, currency: str) -> list[str]:
    rows = products or []
    if not rows:
        return ["Top produse: —" if is_ro else "Top products: —", ""]
    lines = ["Top produse:" if is_ro else "Top products:"]
    for row in rows:
        name = _summary_row_name(row)
        slug = (str(row.get("slug") or "")).strip()
        qty = int(row.get("quantity", 0) or 0)
        sales = row.get("gross_sales", 0)
        label = _summary_row_label(name, slug)
        suffix = _summary_qty_sales_suffix(qty=qty, sales=sales, is_ro=is_ro, currency=currency)
        lines.append(f"- {label}: {suffix}")
    lines.append("")
    return lines


def _low_stock_status_label(*, is_ro: bool, critical: bool) -> str:
    if critical:
        return "CRITIC" if is_ro else "CRITICAL"
    return "scăzut" if is_ro else "low"


def _admin_summary_low_stock_lines(*, low_stock: list[dict] | None, is_ro: bool) -> list[str]:
    rows = low_stock or []
    if not rows:
        return ["Stoc redus: —" if is_ro else "Low stock: —", ""]
    lines = ["Stoc redus:" if is_ro else "Low stock:"]
    for row in rows:
        name = _summary_row_name(row)
        stock = int(row.get("stock_quantity", 0) or 0)
        threshold = int(row.get("threshold", 0) or 0)
        critical = bool(row.get("is_critical", False))
        status = _low_stock_status_label(is_ro=is_ro, critical=critical)
        lines.append(f"- {name}: {stock}/{threshold} ({status})")
    lines.append("")
    return lines


def _admin_report_lines_for_lang(
    *,
    lang: str,
    kind_label_ro: str,
    kind_label_en: str,
    start_label: str,
    end_label: str,
    gross: object,
    net: object,
    refunds: object,
    missing: object,
    currency: str,
    orders_success: int,
    orders_total: int,
    orders_refunded: int,
    top_products: list[dict] | None,
    low_stock: list[dict] | None,
) -> list[str]:
    is_ro = lang == "ro"
    lines = _admin_summary_header_lines(
        is_ro=is_ro,
        kind_label_ro=kind_label_ro,
        kind_label_en=kind_label_en,
        start_label=start_label,
        end_label=end_label,
        gross=gross,
        net=net,
        refunds=refunds,
        currency=currency,
    )
    if Decimal(str(missing or 0)) > 0:
        lines.append(
            ("Rambursări lipsă (fallback): " if is_ro else "Missing refunds (fallback): ")
            + _money_str(missing, currency)
        )
    lines.extend(
        _admin_summary_order_lines(
            is_ro=is_ro,
            orders_success=orders_success,
            orders_total=orders_total,
            orders_refunded=orders_refunded,
        )
    )
    lines.extend(_admin_summary_top_products_lines(products=top_products, is_ro=is_ro, currency=currency))
    lines.extend(_admin_summary_low_stock_lines(low_stock=low_stock, is_ro=is_ro))
    admin_url = f"{settings.frontend_origin.rstrip('/')}/admin/dashboard"
    lines.append(("Admin: " if is_ro else "Admin: ") + admin_url)
    return lines


def _admin_report_text(
    *,
    kind_label_ro: str,
    kind_label_en: str,
    start_label: str,
    end_label: str,
    gross: object,
    net: object,
    refunds: object,
    missing: object,
    currency: str,
    orders_success: int,
    orders_total: int,
    orders_refunded: int,
    top_products: list[dict] | None,
    low_stock: list[dict] | None,
) -> tuple[str, str]:
    common = {
        "kind_label_ro": kind_label_ro,
        "kind_label_en": kind_label_en,
        "start_label": start_label,
        "end_label": end_label,
        "gross": gross,
        "net": net,
        "refunds": refunds,
        "missing": missing,
        "currency": currency,
        "orders_success": orders_success,
        "orders_total": orders_total,
        "orders_refunded": orders_refunded,
        "top_products": top_products,
        "low_stock": low_stock,
    }
    text_ro = "\n".join(_admin_report_lines_for_lang(lang="ro", **common))
    text_en = "\n".join(_admin_report_lines_for_lang(lang="en", **common))
    return text_ro, text_en


def _admin_report_context(*, kind: str, period_start: datetime, period_end: datetime, summary: dict) -> dict[str, object]:
    kind_clean = (kind or "").strip().lower()
    return {
        "kind_label_en": "Weekly" if kind_clean == "weekly" else "Monthly",
        "kind_label_ro": "Săptămânal" if kind_clean == "weekly" else "Lunar",
        "start_label": period_start.astimezone(timezone.utc).date().isoformat(),
        "end_label": period_end.astimezone(timezone.utc).date().isoformat(),
        "gross": summary.get("gross_sales", 0),
        "net": summary.get("net_sales", 0),
        "refunds": summary.get("refunds", 0),
        "missing": summary.get("missing_refunds", 0),
        "orders_total": int(summary.get("orders_total", 0) or 0),
        "orders_success": int(summary.get("orders_success", 0) or 0),
        "orders_refunded": int(summary.get("orders_refunded", 0) or 0),
    }


async def send_admin_report_summary(
    to_email: str,
    *,
    kind: str,
    period_start: datetime,
    period_end: datetime,
    currency: str = "RON",
    summary: dict,
    top_products: list[dict] | None = None,
    low_stock: list[dict] | None = None,
    lang: str | None = None,
) -> bool:
    context = _admin_report_context(kind=kind, period_start=period_start, period_end=period_end, summary=summary)
    kind_label_en = str(context["kind_label_en"])
    kind_label_ro = str(context["kind_label_ro"])
    start_label = str(context["start_label"])
    end_label = str(context["end_label"])

    subject = _bilingual_subject(
        f"Raport {kind_label_ro.lower()} — {start_label} → {end_label}",
        f"{kind_label_en} report — {start_label} → {end_label}",
        preferred_language=lang,
    )
    text_ro, text_en = _admin_report_text(
        kind_label_ro=kind_label_ro,
        kind_label_en=kind_label_en,
        start_label=start_label,
        end_label=end_label,
        gross=context["gross"],
        net=context["net"],
        refunds=context["refunds"],
        missing=context["missing"],
        currency=currency,
        orders_success=int(context["orders_success"]),
        orders_total=int(context["orders_total"]),
        orders_refunded=int(context["orders_refunded"]),
        top_products=top_products,
        low_stock=low_stock,
    )
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


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


def _is_rate_limited(timestamps: list[float], *, now: float, window: float, limit: int | None) -> bool:
    if not limit:
        return False
    return len([ts for ts in timestamps if now - ts < window]) >= limit


def _allow_send(now: float, recipient: str) -> bool:
    window = 60.0
    if _is_rate_limited(_rate_global, now=now, window=window, limit=settings.email_rate_limit_per_minute):
        return False
    recipient_timestamps = _rate_per_recipient.get(recipient, [])
    if _is_rate_limited(
        recipient_timestamps,
        now=now,
        window=window,
        limit=settings.email_rate_limit_per_recipient_per_minute,
    ):
        return False
    return True


def _record_send(now: float, recipient: str) -> None:
    _rate_global.append(now)
    _rate_per_recipient.setdefault(recipient, []).append(now)
