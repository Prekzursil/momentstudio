import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ThemeStatus(str, enum.Enum):
    """Lifecycle states for a storefront theme document.

    Mirrors the ``ContentStatus`` pattern (``models/content.py``). P1a only
    needs ``draft``/``published``; the ``review`` gate that ``ContentStatus``
    carries is not part of the theme flow.
    """

    draft = "draft"
    published = "published"


class Theme(Base):
    """Singleton-per-store storefront theme document.

    Holds the live token blob plus its version/lifecycle metadata, mirroring
    ``ContentBlock``. ``tokens`` is ``sa.JSON()`` (NOT JSONB) so the in-memory
    SQLite test suite — which builds schema via ``Base.metadata.create_all`` —
    stays at parity with Postgres; a ~10-token theme blob never needs
    server-side JSON querying in P1a (see plan §0 finding #4).

    Referential-integrity note (forward-looking): ``theme_versions`` is shaped
    so a future retention gate can prove a version is unreferenced before
    compacting (published pointer -> theme-version id). No orphan-delete path
    ships in P1a; the schema simply must not preclude a P2 reference index.
    """

    __tablename__ = "themes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    tokens: Mapped[dict] = mapped_column(JSON, nullable=False)
    status: Mapped[ThemeStatus] = mapped_column(
        Enum(ThemeStatus), nullable=False, default=ThemeStatus.draft
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    versions: Mapped[list["ThemeVersion"]] = relationship(
        "ThemeVersion",
        back_populates="theme",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="ThemeVersion.version",
    )


class ThemeVersion(Base):
    """Immutable snapshot of a theme document at a given version.

    Snapshot mirror of ``content_block_versions``. Carries
    ``created_by_user_id`` (mirroring the ``content_block_versions`` author
    column) for attribution/audit of who saved each snapshot, and
    ``schema_version`` so every snapshot is stamped from the first write.
    """

    __tablename__ = "theme_versions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    theme_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("themes.id"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    tokens: Mapped[dict] = mapped_column(JSON, nullable=False)
    status: Mapped[ThemeStatus] = mapped_column(Enum(ThemeStatus), nullable=False)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    theme: Mapped[Theme] = relationship("Theme", back_populates="versions")
    audits: Mapped[list["ThemeAuditLog"]] = relationship(
        "ThemeAuditLog",
        back_populates="theme_version",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="ThemeAuditLog.created_at",
    )


class ThemeAuditLog(Base):
    """Append-only, hash-chained audit trail for theme mutations.

    A NEW ``theme_audit_log`` table (NOT a reuse of ``content_audit_log``,
    which is hardwired to ``content_block_id`` + entity ``'content'``). Mirrors
    ``ContentAuditLog``'s columns and reuses the SAME ``AuditChainState``-locked
    hash-chain mechanism via ``audit_chain.add_theme_audit_log`` — the mechanism
    is reused, the table is new. Keyed on ``theme_version_id`` so each entry
    pins the exact snapshot it describes (entity ``'theme'``).
    """

    __tablename__ = "theme_audit_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    theme_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("theme_versions.id"), nullable=False
    )
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    chain_prev_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    chain_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    theme_version: Mapped[ThemeVersion] = relationship(
        "ThemeVersion", back_populates="audits"
    )
