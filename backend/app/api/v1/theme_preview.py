"""Theme draft-PREVIEW API (WU12).

An admin (``require_admin_section("theme")``) can preview the storefront rendered
with the DRAFT theme — or a chosen historical version — WITHOUT publishing it,
gated by a short-lived, signed preview token. This mirrors ``content.py``'s
preview-token pattern (a JWT minted behind the admin gate, then a token-gated
read route where the token itself is the authorization).

Flow:

* ``POST /theme/preview-token`` (section-gated, rate-limited) mints a token bound
  to the requesting admin's ``user_id`` and a *selector* — ``"draft"`` (the
  working draft) or a version number (a historical snapshot). It 404s when the
  requested target does not exist, mirroring ``create_page_preview_token``.
* ``GET /theme/preview`` (token-gated — NO session auth) resolves the selector
  and returns the RE-DERIVED tokens for the SSR sink to inject. The draft is
  never exposed to an unauthenticated storefront visitor: a missing / garbage /
  wrong-type / expired token is a hard 403, and the response carries
  ``Cache-Control: no-store`` + ``X-Robots-Tag: noindex`` so a draft render is
  never cached or indexed.

This is a NEW module — it does NOT modify ``theme.py`` or ``theme_service.py``.
It reuses the read-only resolvers on ``theme_service`` (``get_draft`` /
``ResolvedTheme``) and the shared ``theme_derive`` so a previewed document is
re-derived (never trusts the stored shade / on-colour set), and it never mutates
a row — a preview cannot publish.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_session, require_admin_section
from app.core.rate_limit import limiter, per_identifier_limiter
from app.core.security import decode_token
from app.models.theme import ThemeVersion
from app.models.user import User
from app.schemas.theme import ThemeTokensRead
from app.services import theme_service
from app.services.theme_derive import derive_tokens
from app.services.theme_service import ResolvedTheme

router = APIRouter(prefix="/theme", tags=["theme"])

# The signed-token type + the sentinel selector for the working draft.
_TOKEN_TYPE = "theme_preview"
_DRAFT_SELECTOR = "draft"

# Rate limits (reusing the in-repo limiter, not a hand-rolled one). Minting is an
# admin action; the token render is bounded PER TOKEN so a leaked token cannot be
# turned into a render-amplification / enumeration lever against the SSR path.
PREVIEW_TOKEN_RATE_LIMIT = 30
PREVIEW_RENDER_RATE_LIMIT = 60
preview_token_rate_limit = limiter("theme:preview-token", PREVIEW_TOKEN_RATE_LIMIT, 60)
preview_render_rate_limit = per_identifier_limiter(
    lambda request: request.query_params.get("token") or "anon",
    PREVIEW_RENDER_RATE_LIMIT,
    60,
    key="theme:preview-render",
)


def create_theme_preview_token(
    *, user_id: str, selector: str, expires_at: datetime
) -> str:
    """Mint a signed, expiring preview token bound to ``user_id`` + ``selector``."""
    to_encode = {
        "type": _TOKEN_TYPE,
        "uid": str(user_id),
        "sel": str(selector),
        "exp": expires_at,
    }
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.jwt_algorithm)


@dataclass(frozen=True)
class ThemePreviewClaims:
    """The verified claims carried by a theme-preview token."""

    user_id: str
    selector: str


def decode_theme_preview_token(token: str) -> ThemePreviewClaims | None:
    """Verify a preview token, or ``None`` if invalid / expired / wrong type.

    A forged signature, an expired token, a wrong-type token (e.g. a content
    preview token), or a token missing its bound ``uid`` / ``selector`` all
    return ``None`` so the render route hard-rejects them (403).
    """
    payload = decode_token(token)
    if not payload or payload.get("type") != _TOKEN_TYPE:
        return None
    uid = payload.get("uid")
    sel = payload.get("sel")
    if not isinstance(uid, str) or not uid:
        return None
    if not isinstance(sel, str) or not sel:
        return None
    return ThemePreviewClaims(user_id=uid, selector=sel)


class ThemePreviewTokenResponse(BaseModel):
    """Response of the mint route: the token + its bound target + the preview URL."""

    token: str
    selector: str
    version: int
    expires_at: datetime
    url: str


def _to_read(resolved: ResolvedTheme) -> ThemeTokensRead:
    return ThemeTokensRead(
        tokens=resolved.tokens,
        version=resolved.version,
        schema_version=resolved.schema_version,
        status=resolved.status,
        published_at=resolved.published_at,
        updated_at=resolved.updated_at,
    )


async def _find_version(session: AsyncSession, version: int) -> ThemeVersion | None:
    return (
        await session.execute(
            select(ThemeVersion).where(ThemeVersion.version == version).limit(1)
        )
    ).scalar_one_or_none()


def _resolved_from_snapshot(snapshot: ThemeVersion) -> ResolvedTheme:
    """Re-derive a snapshot's editable primaries into the full effective set.

    Mirrors ``theme_service``'s own snapshot projection: the stored document is
    the source-of-truth editable primaries; the derived shade / state tokens are
    recomputed here so a preview never trusts a stored (or tampered) derived set.
    """
    return ResolvedTheme(
        tokens=derive_tokens(dict(snapshot.tokens)),
        version=snapshot.version,
        schema_version=snapshot.schema_version,
        status=snapshot.status,
        published_at=snapshot.published_at,
        updated_at=snapshot.created_at,
    )


async def _resolve_selector(
    session: AsyncSession, selector: str
) -> ResolvedTheme | None:
    """Resolve a token selector to a re-derived theme, or ``None`` if it cannot."""
    if selector == _DRAFT_SELECTOR:
        return await theme_service.get_draft(session)
    try:
        version = int(selector)
    except ValueError:
        return None
    snapshot = await _find_version(session, version)
    if snapshot is None:
        return None
    return _resolved_from_snapshot(snapshot)


@router.post("/preview-token", response_model=ThemePreviewTokenResponse)
async def mint_theme_preview_token(
    session: AsyncSession = Depends(get_session),
    version: int | None = Query(default=None, ge=1),
    expires_minutes: int = Query(default=30, ge=5, le=24 * 60),
    user: User = Depends(require_admin_section("theme")),
    _rate: None = Depends(preview_token_rate_limit),
) -> ThemePreviewTokenResponse:
    """Mint a preview token for the DRAFT (default) or a chosen version (admin).

    404s when the requested target does not exist, so a token is never minted for
    a non-existent draft/version (mirrors ``create_page_preview_token``).
    """
    if version is None:
        draft = await theme_service.get_draft(session)
        if draft is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Theme not found"
            )
        selector = _DRAFT_SELECTOR
        target_version = draft.version
    else:
        snapshot = await _find_version(session, version)
        if snapshot is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Theme version not found"
            )
        selector = str(version)
        target_version = version

    expires_at = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    token = create_theme_preview_token(
        user_id=str(user.id), selector=selector, expires_at=expires_at
    )
    url = f"{settings.frontend_origin.rstrip('/')}/?theme_preview={token}"
    return ThemePreviewTokenResponse(
        token=token,
        selector=selector,
        version=target_version,
        expires_at=expires_at,
        url=url,
    )


@router.get("/preview", response_model=ThemeTokensRead)
async def render_theme_preview(
    response: Response,
    token: str | None = Query(default=None, description="Preview token"),
    session: AsyncSession = Depends(get_session),
    _rate: None = Depends(preview_render_rate_limit),
) -> ThemeTokensRead:
    """Return the previewed theme's RE-DERIVED tokens for the SSR sink (token-gated).

    The signed token IS the authorization (no session): a missing / garbage /
    wrong-type / expired token hard-rejects (403). The response is marked
    ``no-store`` + ``noindex`` so a draft render never leaks into a cache or a
    search index. This route only READS — a preview never publishes.
    """
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex"
    claims = decode_theme_preview_token(token) if token else None
    if claims is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Invalid preview token"
        )
    resolved = await _resolve_selector(session, claims.selector)
    if resolved is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Theme not found"
        )
    return _to_read(resolved)
