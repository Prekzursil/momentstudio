from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# NOTE: `User` is intentionally NOT imported here (not even under TYPE_CHECKING)
# to avoid a module-level import cycle with app.models.user that CodeQL flags as
# py/unsafe-cyclic-import. SQLAlchemy resolves the relationship target via the
# registry using the string "User"; the `Mapped["User"]` annotation is a forward
# reference suppressed with `# type: ignore[name-defined]` on the field below.


class UserPasskey(Base):
    __tablename__ = "user_passkeys"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    credential_id: Mapped[str] = mapped_column(
        String(255), nullable=False, unique=True, index=True
    )
    public_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    sign_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    aaguid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    credential_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    device_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    backed_up: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user: Mapped["User"] = relationship("User", back_populates="passkeys")  # type: ignore[name-defined]  # noqa: F821  # forward ref resolved by SQLAlchemy registry; import omitted to break a cyclic import (CodeQL py/unsafe-cyclic-import)
