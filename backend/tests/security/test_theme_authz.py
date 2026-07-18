"""WU13 security lane — the AUTHZ / staleness / rate-limit / rollback net.

The access-control half of the regression net (task item 5): every MUTATING route
rejects an unauthenticated caller (401) and a non-admin caller (403); the two
admin-only READ routes do the same while the public read stays open; the publish
staleness guard 409s; the mutate rate limit trips; and rollback is
published-only (a draft / forged version is 404 — the saga's rollback-bypass
fix). Black-box over the live ``/api/v1/theme`` endpoints; nothing is mocked.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.api.v1 import theme as theme_api
from app.services.theme_derive import PRIMARY_DEFAULTS

# (method, path, json-body) for every mutating theme route. A valid body is sent
# where the route declares one, so the 401/403 is decided by the auth dependency
# (not a 422 body-validation error).
_MUTATING_ROUTES: tuple[tuple[str, str, dict[str, Any] | None], ...] = (
    ("put", "/api/v1/theme/draft", {"tokens": dict(PRIMARY_DEFAULTS)}),
    ("post", "/api/v1/theme/publish", {}),
    ("post", "/api/v1/theme/rollback/1", None),
    ("post", "/api/v1/theme/reset-to-default", None),
)

_ADMIN_READ_ROUTES: tuple[tuple[str, str], ...] = (
    ("get", "/api/v1/theme/draft"),
    ("get", "/api/v1/theme/versions"),
)


def _send(client: Any, method: str, path: str, body: Any, headers: Any = None):
    kwargs: dict[str, Any] = {}
    if body is not None:
        kwargs["json"] = body
    if headers is not None:
        kwargs["headers"] = headers
    return getattr(client, method)(path, **kwargs)


def _primaries() -> dict[str, str]:
    return dict(PRIMARY_DEFAULTS)


# --------------------------------------------------------------------------- #
# Item 5 — every mutating route rejects unauth (401) and non-admin (403)
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "method,path,body",
    _MUTATING_ROUTES,
    ids=[f"{m.upper()} {p}" for m, p, _ in _MUTATING_ROUTES],
)
def test_mutating_route_rejects_unauthenticated(
    seeded_app: Any, method: str, path: str, body: Any
) -> None:
    resp = _send(seeded_app["client"], method, path, body)
    assert resp.status_code == 401, resp.text


@pytest.mark.parametrize(
    "method,path,body",
    _MUTATING_ROUTES,
    ids=[f"{m.upper()} {p}" for m, p, _ in _MUTATING_ROUTES],
)
def test_mutating_route_rejects_non_admin(
    seeded_app: Any, customer_headers: Any, method: str, path: str, body: Any
) -> None:
    headers = customer_headers(seeded_app["factory"])
    resp = _send(seeded_app["client"], method, path, body, headers)
    assert resp.status_code == 403, resp.text


@pytest.mark.parametrize(
    "method,path",
    _ADMIN_READ_ROUTES,
    ids=[f"{m.upper()} {p}" for m, p in _ADMIN_READ_ROUTES],
)
def test_admin_read_route_rejects_unauthenticated(
    seeded_app: Any, method: str, path: str
) -> None:
    resp = _send(seeded_app["client"], method, path, None)
    assert resp.status_code == 401, resp.text


@pytest.mark.parametrize(
    "method,path",
    _ADMIN_READ_ROUTES,
    ids=[f"{m.upper()} {p}" for m, p in _ADMIN_READ_ROUTES],
)
def test_admin_read_route_rejects_non_admin(
    seeded_app: Any, customer_headers: Any, method: str, path: str
) -> None:
    headers = customer_headers(seeded_app["factory"])
    resp = _send(seeded_app["client"], method, path, None, headers)
    assert resp.status_code == 403, resp.text


def test_public_read_allowed_without_auth(seeded_app: Any) -> None:
    resp = seeded_app["client"].get("/api/v1/theme")
    assert resp.status_code == 200, resp.text


# --------------------------------------------------------------------------- #
# Item 5 — staleness 409
# --------------------------------------------------------------------------- #
def test_publish_stale_expected_version_conflicts(
    seeded_app: Any, admin_headers: Any
) -> None:
    client = seeded_app["client"]
    headers = admin_headers(seeded_app["factory"])
    client.put("/api/v1/theme/draft", json={"tokens": _primaries()}, headers=headers)
    resp = client.post(
        "/api/v1/theme/publish", json={"expected_version": 999}, headers=headers
    )
    assert resp.status_code == 409, resp.text


# --------------------------------------------------------------------------- #
# Item 5 — rollback is published-only (the saga's rollback-bypass fix)
# --------------------------------------------------------------------------- #
def test_rollback_to_unpublished_draft_is_rejected(
    seeded_app: Any, admin_headers: Any
) -> None:
    client = seeded_app["client"]
    headers = admin_headers(seeded_app["factory"])
    # Create a draft (v2) but never publish it — rolling "back" to it must 404,
    # so an ungated draft can never be promoted by way of rollback.
    client.put("/api/v1/theme/draft", json={"tokens": _primaries()}, headers=headers)
    resp = client.post("/api/v1/theme/rollback/2", headers=headers)
    assert resp.status_code == 404, resp.text


def test_rollback_forged_version_is_rejected(
    seeded_app: Any, admin_headers: Any
) -> None:
    headers = admin_headers(seeded_app["factory"])
    resp = seeded_app["client"].post("/api/v1/theme/rollback/999", headers=headers)
    assert resp.status_code == 404, resp.text


# --------------------------------------------------------------------------- #
# Item 5 — the mutate rate limit trips
# --------------------------------------------------------------------------- #
def test_mutation_rate_limit_trips(seeded_app: Any, admin_headers: Any) -> None:
    client = seeded_app["client"]
    headers = admin_headers(seeded_app["factory"])
    limit = theme_api.THEME_MUTATION_RATE_LIMIT
    saw_429 = False
    for _ in range(limit + 5):
        resp = client.put(
            "/api/v1/theme/draft", json={"tokens": _primaries()}, headers=headers
        )
        if resp.status_code == 429:
            saw_429 = True
            break
    assert saw_429, "expected the mutate rate limit to trip"
