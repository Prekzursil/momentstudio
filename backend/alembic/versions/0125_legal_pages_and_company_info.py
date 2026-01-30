"""Seed legal CMS pages and company info block.

Revision ID: 0125
Revises: 0124
Create Date: 2026-01-27
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0125"
down_revision: str | None = "0124"
branch_labels: str | Sequence[str] | None = None
depends_on: Sequence[str] | None = None


TERMS_INDEX_EN_TITLE = "Terms & Conditions"
TERMS_INDEX_RO_TITLE = "Termeni și condiții"
TERMS_INDEX_EN_BODY = """## Legal information

This section contains our store policies and consumer information.

- [Terms & Conditions](/pages/terms-and-conditions)
- [Privacy Policy](/pages/privacy-policy)
- [ANPC / Consumer information](/pages/anpc)

> Important: This content is a template and must be reviewed by a legal professional before going live.
"""
TERMS_INDEX_RO_BODY = """## Informații legale

Această secțiune conține politicile magazinului și informații pentru consumatori.

- [Termeni și condiții](/pages/terms-and-conditions)
- [Politica de confidențialitate](/pages/privacy-policy)
- [ANPC / Informații pentru consumatori](/pages/anpc)

> Important: Acest conținut este un șablon și trebuie revizuit de un specialist juridic înainte de publicare.
"""

TERMS_EN_TITLE = "Terms & Conditions (template)"
TERMS_RO_TITLE = "Termeni și condiții (șablon)"
TERMS_EN_BODY = """## Terms & Conditions (template)

> This page is a template. Replace it with legally reviewed Terms & Conditions before going live.

### Payment methods
We offer the following payment methods (availability may vary):
- Card payments (processed by our payment providers)
- PayPal
- Cash on delivery (RON)

### Delivery policy
See [Shipping & Returns](/pages/shipping) for delivery timelines, fees, and handling.

### Return / cancellation policy
See [Shipping & Returns](/pages/shipping) for return and cancellation terms, including the right of withdrawal.

### Company identification
Company identification details are displayed in the site footer and may be repeated here.

### Contact
For support, see [Contact](/contact).
"""
TERMS_RO_BODY = """## Termeni și condiții (șablon)

> Această pagină este un șablon. Înlocuiți cu Termenii și Condițiile revizuite juridic înainte de publicare.

### Modalități de plată
Oferim următoarele metode de plată (disponibilitatea poate varia):
- Plată cu cardul (procesată de procesatorii noștri de plăți)
- PayPal
- Ramburs (RON)

### Politica de livrare
Consultați [Livrare & retur](/pages/shipping) pentru termene, costuri și condiții.

### Politica de retur / anulare
Consultați [Livrare & retur](/pages/shipping) pentru retururi, anulări și dreptul de retragere.

### Date de identificare
Datele de identificare ale companiei sunt afișate în subsolul site-ului și pot fi repetate aici.

### Contact
Pentru suport, vedeți [Contact](/contact).
"""

PRIVACY_EN_TITLE = "Privacy Policy & GDPR (template)"
PRIVACY_RO_TITLE = "Politica de confidențialitate & GDPR (șablon)"
PRIVACY_EN_BODY = """## Privacy Policy & GDPR (template)

> This page is a template and is not legal advice. Have it reviewed by a GDPR/legal professional.

### Data controller
The data controller is **[Company name]**, **[registration no.]**, **[CUI/VAT]**, **[address]**.

### What data we collect
- Account details (e.g. email, name)
- Order and delivery information
- Payment status (we do not store full card details)

### Why we process data
We process data to fulfil orders, provide customer support, meet legal obligations, and prevent fraud.

### Your rights
You may have rights such as access, rectification, deletion, restriction, portability, and objection (depending on the legal basis).

### Contact
For privacy requests, contact us at **[privacy email]**.
"""
PRIVACY_RO_BODY = """## Politica de confidențialitate & GDPR (șablon)

> Această pagină este un șablon și nu reprezintă consultanță juridică. Recomandăm revizuire de către un specialist GDPR/juridic.

### Operator de date
Operatorul de date este **[Denumire companie]**, **[nr. înregistrare]**, **[CUI]**, **[adresă]**.

### Ce date colectăm
- Date de cont (ex: email, nume)
- Informații despre comandă și livrare
- Status plată (nu stocăm detalii complete de card)

### De ce prelucrăm date
Prelucrăm datele pentru a onora comenzile, a oferi suport, a respecta obligații legale și a preveni frauda.

### Drepturile tale
Poți avea drepturi precum acces, rectificare, ștergere, restricționare, portabilitate și opoziție (în funcție de temeiul legal).

### Contact
Pentru solicitări privind confidențialitatea, contactează-ne la **[email GDPR]**.
"""

ANPC_EN_TITLE = "ANPC / Consumer information"
ANPC_RO_TITLE = "ANPC / Informații pentru consumatori"
ANPC_EN_BODY = """## ANPC / Consumer information

If you have a complaint, please contact us first via [Contact](/contact) so we can try to resolve it quickly.

If we cannot resolve your complaint, you may be able to use Alternative Dispute Resolution (ADR) procedures.

Alternative dispute resolution (ADR) information:
- https://legislatie.just.ro/Public/DetaliiDocument/257649?fs=e&s=cl
- https://anpc.ro/noi-reglementari-de-la-anpc-in-ceea-ce-priveste-procedurile-de-solutionaare-alternativa-a-litigiilor-si-insolventa-a-persoanelor-fizice/

> Note: This page is informational and does not replace legal advice.
"""
ANPC_RO_BODY = """## ANPC / Informații pentru consumatori

Dacă ai o reclamație, te rugăm să ne contactezi mai întâi prin [Contact](/contact), pentru a încerca să o soluționăm rapid.

Dacă nu reușim să soluționăm reclamația, poți avea la dispoziție proceduri de soluționare alternativă a litigiilor (SAL/ADR).

Informații privind soluționarea alternativă a litigiilor (SAL/ADR):
- https://legislatie.just.ro/Public/DetaliiDocument/257649?fs=e&s=cl
- https://anpc.ro/noi-reglementari-de-la-anpc-in-ceea-ce-priveste-procedurile-de-solutionaare-alternativa-a-litigiilor-si-insolventa-a-persoanelor-fizice/

> Notă: Această pagină are rol informativ și nu înlocuiește consultanța juridică.
"""


def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.now(timezone.utc)
    is_postgres = conn.dialect.name == "postgresql"

    content_status = postgresql.ENUM("draft", "review", "published", name="contentstatus", create_type=False)
    published_status = sa.text("'published'::contentstatus") if is_postgres else "published"

    content_blocks = sa.table(
        "content_blocks",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("key", sa.String()),
        sa.column("title", sa.String()),
        sa.column("body_markdown", sa.Text()),
        sa.column("status", content_status),
        sa.column("version", sa.Integer()),
        sa.column("meta", sa.JSON()),
        sa.column("sort_order", sa.Integer()),
        sa.column("lang", sa.String()),
        sa.column("needs_translation_en", sa.Boolean()),
        sa.column("needs_translation_ro", sa.Boolean()),
        sa.column("published_at", sa.DateTime(timezone=True)),
        sa.column("published_until", sa.DateTime(timezone=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    translations = sa.table(
        "content_block_translations",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("content_block_id", sa.UUID(as_uuid=True)),
        sa.column("lang", sa.String()),
        sa.column("title", sa.String()),
        sa.column("body_markdown", sa.Text()),
    )
    versions = sa.table(
        "content_block_versions",
        sa.column("id", sa.UUID(as_uuid=True)),
        sa.column("content_block_id", sa.UUID(as_uuid=True)),
        sa.column("version", sa.Integer()),
        sa.column("title", sa.String()),
        sa.column("body_markdown", sa.Text()),
        sa.column("status", content_status),
        sa.column("meta", sa.JSON()),
        sa.column("lang", sa.String()),
        sa.column("published_at", sa.DateTime(timezone=True)),
        sa.column("published_until", sa.DateTime(timezone=True)),
        sa.column("translations", sa.JSON()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )

    def seed_page(*, key: str, en_title: str, en_body: str, ro_title: str, ro_body: str) -> None:
        exists = conn.execute(sa.select(content_blocks.c.id).where(content_blocks.c.key == key)).first()
        if exists:
            return

        block_id = uuid.uuid4()
        conn.execute(
            sa.insert(content_blocks).values(
                id=block_id,
                key=key,
                title=en_title,
                body_markdown=en_body,
                status=published_status,
                version=1,
                meta=None,
                sort_order=0,
                lang="en",
                needs_translation_en=False,
                needs_translation_ro=False,
                published_at=now,
                published_until=None,
                created_at=now,
                updated_at=now,
            )
        )
        conn.execute(
            sa.insert(translations).values(
                id=uuid.uuid4(),
                content_block_id=block_id,
                lang="ro",
                title=ro_title,
                body_markdown=ro_body,
            )
        )
        translations_snapshot = [{"lang": "ro", "title": ro_title, "body_markdown": ro_body}]
        conn.execute(
            sa.insert(versions).values(
                id=uuid.uuid4(),
                content_block_id=block_id,
                version=1,
                title=en_title,
                body_markdown=en_body,
                status=published_status,
                meta=None,
                lang="en",
                published_at=now,
                published_until=None,
                translations=translations_snapshot,
                created_at=now,
            )
        )

    def seed_site_company() -> None:
        exists = conn.execute(sa.select(content_blocks.c.id).where(content_blocks.c.key == "site.company")).first()
        if exists:
            return
        block_id = uuid.uuid4()
        meta = {
            "version": 1,
            "company": {
                "name": "",
                "registration_number": "",
                "cui": "",
                "address": "",
                "phone": "",
                "email": "",
            },
        }
        conn.execute(
            sa.insert(content_blocks).values(
                id=block_id,
                key="site.company",
                title="Company information",
                body_markdown="Company identification details (used in footer).",
                status=published_status,
                version=1,
                meta=meta,
                sort_order=0,
                lang=None,
                needs_translation_en=False,
                needs_translation_ro=False,
                published_at=now,
                published_until=None,
                created_at=now,
                updated_at=now,
            )
        )
        conn.execute(
            sa.insert(versions).values(
                id=uuid.uuid4(),
                content_block_id=block_id,
                version=1,
                title="Company information",
                body_markdown="Company identification details (used in footer).",
                status=published_status,
                meta=meta,
                lang=None,
                published_at=now,
                published_until=None,
                translations=[],
                created_at=now,
            )
        )

    seed_page(
        key="page.terms",
        en_title=TERMS_INDEX_EN_TITLE,
        en_body=TERMS_INDEX_EN_BODY,
        ro_title=TERMS_INDEX_RO_TITLE,
        ro_body=TERMS_INDEX_RO_BODY,
    )
    seed_page(
        key="page.terms-and-conditions",
        en_title=TERMS_EN_TITLE,
        en_body=TERMS_EN_BODY,
        ro_title=TERMS_RO_TITLE,
        ro_body=TERMS_RO_BODY,
    )
    seed_page(
        key="page.privacy-policy",
        en_title=PRIVACY_EN_TITLE,
        en_body=PRIVACY_EN_BODY,
        ro_title=PRIVACY_RO_TITLE,
        ro_body=PRIVACY_RO_BODY,
    )
    seed_page(
        key="page.anpc",
        en_title=ANPC_EN_TITLE,
        en_body=ANPC_EN_BODY,
        ro_title=ANPC_RO_TITLE,
        ro_body=ANPC_RO_BODY,
    )
    seed_site_company()


def downgrade() -> None:
    # Intentionally no-op: removing seeded CMS content can delete user edits.
    return
