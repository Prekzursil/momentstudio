import logging
import smtplib
import html as _html
from datetime import datetime, timedelta, timezone
from decimal import Decimal
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
from app.core.security import create_receipt_token
from app.services import receipts as receipt_service

logger = logging.getLogger(__name__)

TEMPLATE_PATH = Path(__file__).parent.parent / "templates" / "emails"
env = (
    Environment(loader=FileSystemLoader(TEMPLATE_PATH), autoescape=select_autoescape(["html", "xml"]))
    if Environment
    else None
)
_rate_global: list[float] = []
_rate_per_recipient: dict[str, list[float]] = {}


EmailAttachment = dict[str, object]

RECEIPT_SHARE_DAYS = 365


def _build_message(
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str | None = None,
    *,
    attachments: Sequence[EmailAttachment] | None = None,
) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from_email or "no-reply@momentstudio.local"
    msg["To"] = to_email
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")
    if attachments:
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
        try:
            return f"{float(str(value)):.2f} {currency}"
        except Exception:
            return f"{value} {currency}"


async def send_email(
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str | None = None,
    *,
    attachments: Sequence[EmailAttachment] | None = None,
) -> bool:
    if not settings.smtp_enabled:
        return False
    now = __import__("time").time()
    _prune(now)
    if not _allow_send(now, to_email):
        logger.warning("Email rate limit reached for %s", to_email)
        return False
    msg = _build_message(to_email, subject, text_body, html_body, attachments=attachments)
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
        body = str(context)
        return body, f"<p>{body}</p>"

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
    return base_text.render(body=text_body), base_html.render(body=html_body or "")


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


def _delivery_lines(order, *, lang: str) -> list[str]:
    courier = _courier_label(getattr(order, "courier", None), lang=lang)
    delivery = _delivery_type_label(getattr(order, "delivery_type", None), lang=lang)
    lines: list[str] = []
    if courier or delivery:
        label = "Delivery" if lang == "en" else "Livrare"
        detail = " · ".join([x for x in [courier, delivery] if x])
        lines.append(f"{label}: {detail}")
    if (getattr(order, "delivery_type", None) or "").strip().lower() == "locker":
        locker_name = (getattr(order, "locker_name", None) or "").strip()
        locker_address = (getattr(order, "locker_address", None) or "").strip()
        if locker_name or locker_address:
            label = "Locker" if lang == "en" else "Locker"
            detail = " — ".join([x for x in [locker_name, locker_address] if x])
            lines.append(f"{label}: {detail}")
    return lines


async def send_order_confirmation(
    to_email: str,
    order,
    items: Sequence | None = None,
    lang: str | None = None,
    *,
    receipt_share_days: int | None = None,
) -> bool:
    ref = getattr(order, "reference_code", None) or str(getattr(order, "id", ""))
    currency = getattr(order, "currency", "RON") or "RON"
    ttl_days = int(receipt_share_days) if receipt_share_days and int(receipt_share_days) > 0 else RECEIPT_SHARE_DAYS
    receipt_expires_at = datetime.now(timezone.utc) + timedelta(days=ttl_days)
    token_version = int(getattr(order, "receipt_token_version", 0) or 0)
    receipt_token = create_receipt_token(
        order_id=str(getattr(order, "id", "")),
        expires_at=receipt_expires_at,
        token_version=token_version,
    )
    receipt_url = f"{settings.frontend_origin.rstrip('/')}/receipt/{receipt_token}"
    receipt_pdf_url = f"{settings.frontend_origin.rstrip('/')}/api/v1/orders/receipt/{receipt_token}/pdf"
    receipt_filename = f"receipt-{ref}.pdf"

    def _lines(lng: str) -> list[str]:
        lines = [
            f"Îți mulțumim pentru comanda {ref}."
            if lng == "ro"
            else f"Thank you for your order {ref}."
        ]
        payment = _payment_method_label(getattr(order, "payment_method", None), lang=lng)
        if payment:
            lines.append(("Plată: " if lng == "ro" else "Payment: ") + payment)
        lines.extend(_delivery_lines(order, lang=lng))

        if items:
            lines.append("Produse:" if lng == "ro" else "Items:")
            for item in items:
                product = getattr(item, "product", None)
                name = (getattr(product, "name", None) or str(getattr(item, "product_id", ""))).strip()
                slug = (getattr(product, "slug", None) or "").strip()
                product_url = f"{settings.frontend_origin.rstrip('/')}/products/{slug}" if slug else None
                qty = int(getattr(item, "quantity", 0) or 0)
                unit_price = getattr(item, "unit_price", None)
                if unit_price is not None:
                    price_str = _money_str(unit_price, currency)
                    tail = f" — {product_url}" if product_url else ""
                    lines.append(f"- {name} ×{qty} — {price_str}{tail}")
                else:
                    tail = f" — {product_url}" if product_url else ""
                    lines.append(f"- {name} ×{qty}{tail}")

        shipping_amount = getattr(order, "shipping_amount", None)
        fee_amount = getattr(order, "fee_amount", None)
        tax_amount = getattr(order, "tax_amount", None)
        if shipping_amount is not None:
            lines.append(("Livrare: " if lng == "ro" else "Shipping: ") + _money_str(shipping_amount, currency))
        if fee_amount is not None:
            try:
                fee_dec = fee_amount if isinstance(fee_amount, Decimal) else Decimal(str(fee_amount))
            except Exception:
                fee_dec = Decimal("0.00")
            if fee_dec != 0:
                lines.append(
                    ("Cost suplimentar: " if lng == "ro" else "Additional cost: ")
                    + _money_str(fee_amount, currency)
                )
        if tax_amount is not None:
            lines.append(("TVA: " if lng == "ro" else "VAT: ") + _money_str(tax_amount, currency))

        lines.append(("Total: " if lng == "ro" else "Total: ") + _money_str(getattr(order, "total_amount", 0), currency))

        account_url = f"{settings.frontend_origin.rstrip('/')}/account"
        lines.append("")
        lines.append(
            f"Chitanță (HTML): {receipt_url}" if lng == "ro" else f"Receipt (HTML): {receipt_url}"
        )
        lines.append(
            f"Chitanță (PDF): {receipt_pdf_url}" if lng == "ro" else f"Receipt (PDF): {receipt_pdf_url}"
        )
        lines.append(
            f"Detalii în cont: {account_url}" if lng == "ro" else f"View in your account: {account_url}"
        )
        return lines

    subject_ro = f"Confirmare comandă {ref}"
    subject_en = f"Order confirmation {ref}"
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
    pdf = receipt_service.render_order_receipt_pdf(order, items or [])
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


async def send_order_cancelled_update(to_email: str, order, *, lang: str | None = None) -> bool:
    ref = getattr(order, "reference_code", None) or str(getattr(order, "id", ""))
    contact_url = f"{settings.frontend_origin.rstrip('/')}/contact"
    cancel_reason = (getattr(order, "cancel_reason", None) or "").strip() or None

    def _lines(lng: str) -> list[str]:
        lines = [
            f"Comanda {ref} a fost anulată." if lng == "ro" else f"Your order {ref} was cancelled."
        ]
        if cancel_reason:
            lines.append(("Motiv: " if lng == "ro" else "Reason: ") + cancel_reason)
        lines.append(
            "Dacă ai întrebări sau crezi că este o eroare, te rugăm să ne contactezi."
            if lng == "ro"
            else "If you have questions or believe this is a mistake, please contact us."
        )
        raw_payment_method = (getattr(order, "payment_method", None) or "").strip().lower()
        payment = _payment_method_label(raw_payment_method, lang=lng)
        if payment:
            lines.append(("Plată: " if lng == "ro" else "Payment: ") + payment)
        if raw_payment_method in {"stripe", "paypal"}:
            lines.append(
                "Dacă ai plătit cu cardul, suma va fi rambursată în contul tău cât mai curând."
                if lng == "ro"
                else "If you paid by card, the amount will be refunded back to your account as soon as possible."
            )
        lines.extend(_delivery_lines(order, lang=lng))
        lines.append("")
        lines.append(
            f"Contact: {contact_url}" if lng == "ro" else f"Contact: {contact_url}"
        )
        return lines

    subject = _bilingual_subject(
        f"Comanda {ref} a fost anulată",
        f"Order {ref} was cancelled",
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

    def _lines(lng: str) -> list[str]:
        lines = [
            (
                f"Cerere de anulare pentru comanda {ref}."
                if lng == "ro"
                else f"Cancellation request for order {ref}."
            )
        ]
        if requested_by:
            lines.append(("Solicitat de: " if lng == "ro" else "Requested by: ") + requested_by)
        if reason_clean:
            lines.append(("Motiv: " if lng == "ro" else "Reason: ") + reason_clean)
        payment = _payment_method_label(getattr(order, "payment_method", None), lang=lng)
        if payment:
            lines.append(("Plată: " if lng == "ro" else "Payment: ") + payment)
        if status_value:
            lines.append(("Status: " if lng == "ro" else "Status: ") + status_value)
        lines.append("")
        lines.append(
            f"Admin: {admin_url}" if lng == "ro" else f"Admin: {admin_url}"
        )
        return lines

    subject = _bilingual_subject(
        f"Cerere de anulare: {ref}",
        f"Cancellation request: {ref}",
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


async def send_order_refunded_update(to_email: str, order, *, lang: str | None = None) -> bool:
    ref = getattr(order, "reference_code", None) or str(getattr(order, "id", ""))
    account_url = f"{settings.frontend_origin.rstrip('/')}/account"
    currency = getattr(order, "currency", "RON") or "RON"

    def _lines(lng: str) -> list[str]:
        lines = [
            f"Comanda {ref} a fost rambursată." if lng == "ro" else f"Your order {ref} was refunded."
        ]
        lines.append(("Total: " if lng == "ro" else "Total: ") + _money_str(getattr(order, "total_amount", 0), currency))
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
        lines.append(("Total: " if lng == "ro" else "Total: ") + _money_str(getattr(order, "total_amount", 0), currency))
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
    text_ro = f"Folosește acest cod pentru a reseta parola: {token}\n\nDacă nu ai cerut resetarea, poți ignora acest email."
    text_en = f"Use this token to reset your password: {token}\n\nIf you didn’t request this, you can ignore this email."
    text_body, html_body = _bilingual_sections(
        text_ro=text_ro,
        text_en=text_en,
        html_ro=_html_pre(text_ro),
        html_en=_html_pre(text_en),
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_verification_email(to_email: str, token: str, lang: str | None = None) -> bool:
    subject = _bilingual_subject("Verifică-ți emailul", "Verify your email", preferred_language=lang)
    text_ro = f"Folosește acest cod pentru a verifica emailul: {token}"
    text_en = f"Use this token to verify your email: {token}"
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

    def _lines(lng: str) -> list[str]:
        lines = [
            f"A fost solicitată o rambursare pentru comanda: {ref}"
            if lng == "ro"
            else f"A refund was requested for order: {ref}"
        ]
        if customer_email:
            lines.append(f"Client: {customer_email}" if lng == "ro" else f"Customer: {customer_email}")
        if requested_by_email:
            lines.append(f"Cerut de: {requested_by_email}" if lng == "ro" else f"Requested by: {requested_by_email}")
        if note:
            lines.append(f"Notă: {note}" if lng == "ro" else f"Note: {note}")
        lines.append(("Total: " if lng == "ro" else "Total: ") + _money_str(getattr(order, "total_amount", 0), currency))
        return lines

    subject = _bilingual_subject(
        f"Solicitare rambursare pentru comanda {ref}",
        f"Refund requested for order {ref}",
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


async def send_cart_abandonment(to_email: str, *, lang: str | None = None) -> bool:
    subject = _bilingual_subject("Te mai gândești?", "Still thinking it over?", preferred_language=lang)
    text_body, html_body = render_bilingual_template(
        "cart_abandonment.txt.j2",
        {"cart_url": f"{settings.frontend_origin.rstrip('/')}/cart"},
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


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
    text_body, html_body = render_bilingual_template(
        "coupon_assigned.txt.j2",
        {
            "coupon_code": str(coupon_code or "").strip().upper(),
            "promotion_name": promotion_name,
            "promotion_description": promotion_description,
            "ends_at": ends_str,
            "account_url": account_url,
        },
        preferred_language=lang,
    )
    return await send_email(to_email, subject, text_body, html_body)


async def send_coupon_revoked(
    to_email: str,
    *,
    coupon_code: str,
    promotion_name: str,
    reason: str | None = None,
    lang: str | None = None,
) -> bool:
    subject = _bilingual_subject("Cupon revocat", "Coupon revoked", preferred_language=lang)
    text_body, html_body = render_bilingual_template(
        "coupon_revoked.txt.j2",
        {
            "coupon_code": str(coupon_code or "").strip().upper(),
            "promotion_name": promotion_name,
            "reason": (reason or "").strip() or None,
        },
        preferred_language=lang,
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
    def _lines(lng: str) -> list[str]:
        lines = [
            "A fost primit un eveniment de dispută Stripe."
            if lng == "ro"
            else "A Stripe dispute event was received.",
            f"Event: {event_type}",
        ]
        if dispute_id:
            lines.append(f"Dispută: {dispute_id}" if lng == "ro" else f"Dispute: {dispute_id}")
        if charge_id:
            lines.append(f"Plată: {charge_id}" if lng == "ro" else f"Charge: {charge_id}")
        if amount is not None and currency:
            lines.append(f"Sumă: {amount / 100:.2f} {currency.upper()}" if lng == "ro" else f"Amount: {amount / 100:.2f} {currency.upper()}")
        if reason:
            lines.append(f"Motiv: {reason}" if lng == "ro" else f"Reason: {reason}")
        if dispute_status:
            lines.append(f"Stare: {dispute_status}" if lng == "ro" else f"Status: {dispute_status}")
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
        text_ro = "\n".join(ro_lines)
        text_en = "\n".join(en_lines)
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


async def send_return_request_created(to_email: str, return_request, *, lang: str | None = None) -> bool:
    subject = _bilingual_subject("Cerere de retur creată", "Return request created", preferred_language=lang)
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
        ro_lines.append("")
        en_lines.append("")
        ro_lines.append(getattr(return_request, "reason", "") or "")
        en_lines.append(getattr(return_request, "reason", "") or "")
        text_ro = "\n".join(ro_lines)
        text_en = "\n".join(en_lines)
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

    if env is None:
        prev_label = getattr(previous_status, "value", previous_status)
        next_label = getattr(getattr(return_request, "status", None), "value", getattr(return_request, "status", ""))
        ro_lines = [
            "Actualizare cerere de retur",
            f"Comandă: {order_ref}",
            f"Stare: {prev_label} → {next_label}",
        ]
        en_lines = [
            "Return request update",
            f"Order: {order_ref}",
            f"Status: {prev_label} → {next_label}",
        ]
        if customer_name:
            ro_lines.append(f"Client: {customer_name}")
            en_lines.append(f"Customer: {customer_name}")
        note = getattr(return_request, "admin_note", None)
        if note:
            ro_lines.extend(["", note])
            en_lines.extend(["", note])
        text_ro = "\n".join(ro_lines)
        text_en = "\n".join(en_lines)
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
            "previous_status": getattr(previous_status, "value", previous_status),
            "status": getattr(getattr(return_request, "status", None), "value", None) or str(getattr(return_request, "status", "")),
            "admin_note": getattr(return_request, "admin_note", None),
            "account_url": f"{settings.frontend_origin.rstrip('/')}/account",
        },
        preferred_language=lang,
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
