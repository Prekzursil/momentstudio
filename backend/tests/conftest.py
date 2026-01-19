import pytest

from app.api.v1 import auth as auth_api


@pytest.fixture(scope="module")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(autouse=True)
def _clear_auth_rate_limits() -> None:
    # The in-memory rate-limit buckets are process-global and can leak across tests.
    for dep in (
        auth_api.login_rate_limit,
        auth_api.register_rate_limit,
        auth_api.refresh_rate_limit,
        auth_api.reset_request_rate_limit,
        auth_api.reset_confirm_rate_limit,
        auth_api.google_rate_limit,
    ):
        dep.buckets.clear()
    yield
    for dep in (
        auth_api.login_rate_limit,
        auth_api.register_rate_limit,
        auth_api.refresh_rate_limit,
        auth_api.reset_request_rate_limit,
        auth_api.reset_confirm_rate_limit,
        auth_api.google_rate_limit,
    ):
        dep.buckets.clear()
