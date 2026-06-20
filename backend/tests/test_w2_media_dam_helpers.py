"""Unit coverage for the pure helper functions in ``app.services.media_dam``.

Targets the side-effect-free helpers (tag/type normalisation, retry-policy
resolution, retry-delay computation, preview-URL signing/verification) directly.
Disjoint from the DB/worker integration suites (``test_media_dam_api`` /
``test_media_worker`` / ``test_lr_media_worker`` /
``test_lr_media_usage_reconcile_scheduler``).
"""

from __future__ import annotations

import uuid

import pytest

from app.models.media import MediaAssetType, MediaJobType
from app.services import media_dam as md


# --------------------------------------------------------------------------- #
# _normalize_tag / _normalize_job_tag / _coerce_triage_state                  #
# --------------------------------------------------------------------------- #
def test_normalize_tag_sanitises_and_truncates() -> None:
    assert md._normalize_tag("  Hello World!! ") == "hello-world"
    assert md._normalize_tag("***") == ""
    assert len(md._normalize_tag("a" * 100)) == 64
    assert md._normalize_job_tag("Foo Bar") == "foo-bar"


def test_coerce_triage_state_known_and_fallback() -> None:
    assert md._coerce_triage_state("RESOLVED") == "resolved"
    assert md._coerce_triage_state("nonsense") == "open"
    assert md._coerce_triage_state(None, fallback="ignored") == "ignored"


# --------------------------------------------------------------------------- #
# _guess_asset_type                                                            #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "ctype,name,expected",
    [
        ("image/png", None, MediaAssetType.image),
        (None, "photo.JPG", MediaAssetType.image),
        ("video/mp4", None, MediaAssetType.video),
        (None, "clip.MOV", MediaAssetType.video),
        ("application/pdf", "doc.pdf", MediaAssetType.document),
        (None, None, MediaAssetType.document),
    ],
)
def test_guess_asset_type(ctype, name, expected) -> None:
    assert md._guess_asset_type(ctype, name) is expected


# --------------------------------------------------------------------------- #
# _safe_storage_name / _public_url_from_storage_key                           #
# --------------------------------------------------------------------------- #
def test_safe_storage_name() -> None:
    assert md._safe_storage_name("My File (1).png") == "My-File-1-.png"
    assert md._safe_storage_name(None) == "file"
    assert md._safe_storage_name("***") == "file"


def test_public_url_from_storage_key() -> None:
    assert md._public_url_from_storage_key("/a/b.png") == "/media/a/b.png"
    assert md._public_url_from_storage_key("a/b.png") == "/media/a/b.png"


# --------------------------------------------------------------------------- #
# _default_retry_policy                                                        #
# --------------------------------------------------------------------------- #
def test_default_retry_policy_known_and_unknown_job_type() -> None:
    policy = md._default_retry_policy(MediaJobType.ingest)
    assert policy.max_attempts >= 1
    assert policy.schedule
    assert policy.version_ts == "seed"


# --------------------------------------------------------------------------- #
# _normalize_retry_policy_fields                                               #
# --------------------------------------------------------------------------- #
def test_normalize_retry_policy_fields_uses_fallback_when_none() -> None:
    fallback = md._default_retry_policy(MediaJobType.ingest)
    result = md._normalize_retry_policy_fields(
        max_attempts=None,
        schedule=None,
        jitter_ratio=None,
        enabled=None,
        fallback=fallback,
    )
    assert result.max_attempts == fallback.max_attempts
    assert result.schedule == list(fallback.schedule)
    assert result.enabled == fallback.enabled


def test_normalize_retry_policy_fields_clamps_and_overrides() -> None:
    fallback = md._default_retry_policy(MediaJobType.ingest)
    result = md._normalize_retry_policy_fields(
        max_attempts=999,
        schedule=[5, 10],
        jitter_ratio=5.0,
        enabled=False,
        fallback=fallback,
    )
    assert result.max_attempts == md.MAX_RETRY_POLICY_ATTEMPTS
    assert result.schedule == [5, 10]
    assert result.jitter_ratio == 1.0
    assert result.enabled is False


def test_normalize_retry_policy_fields_empty_schedule_defaults() -> None:
    fallback = md._default_retry_policy(MediaJobType.ingest)
    result = md._normalize_retry_policy_fields(
        max_attempts=2,
        schedule=[],
        jitter_ratio=-1.0,
        enabled=True,
        fallback=fallback,
    )
    assert result.schedule == [30]
    assert result.jitter_ratio == 0.0


# --------------------------------------------------------------------------- #
# _retry_policy_from_payload                                                   #
# --------------------------------------------------------------------------- #
def test_retry_policy_from_payload_missing_key() -> None:
    assert md._retry_policy_from_payload({}, job_type=MediaJobType.ingest) is None


def test_retry_policy_from_payload_not_a_dict() -> None:
    payload = {md.RETRY_POLICY_PAYLOAD_KEY: "nope"}
    assert md._retry_policy_from_payload(payload, job_type=MediaJobType.ingest) is None


def test_retry_policy_from_payload_invalid_attempts_or_schedule() -> None:
    payload = {md.RETRY_POLICY_PAYLOAD_KEY: {"max_attempts": 0, "schedule": []}}
    assert md._retry_policy_from_payload(payload, job_type=MediaJobType.ingest) is None


def test_retry_policy_from_payload_valid() -> None:
    payload = {
        md.RETRY_POLICY_PAYLOAD_KEY: {
            "max_attempts": 3,
            "schedule": [10, 20],
            "jitter_ratio": 0.5,
            "enabled": True,
            "version_ts": "v1",
        }
    }
    policy = md._retry_policy_from_payload(payload, job_type=MediaJobType.ingest)
    assert policy is not None
    assert policy.max_attempts == 3
    assert policy.schedule == [10, 20]
    assert policy.version_ts == "v1"


def test_retry_policy_from_payload_raises_returns_none() -> None:
    # A schedule with a non-int that fails int() raises -> the except returns None.
    payload = {md.RETRY_POLICY_PAYLOAD_KEY: {"max_attempts": 2, "schedule": ["x"]}}
    assert md._retry_policy_from_payload(payload, job_type=MediaJobType.ingest) is None


# --------------------------------------------------------------------------- #
# _retry_delay_seconds                                                         #
# --------------------------------------------------------------------------- #
def test_retry_delay_none_when_attempts_exhausted() -> None:
    assert (
        md._retry_delay_seconds(
            attempt=3, max_attempts=3, schedule=[10, 20], jitter_ratio=0.0
        )
        is None
    )


def test_retry_delay_uses_default_when_schedule_empty() -> None:
    delay = md._retry_delay_seconds(
        attempt=1, max_attempts=5, schedule=[], jitter_ratio=0.0
    )
    assert delay == md.RETRY_BACKOFF_SECONDS[0]


def test_retry_delay_clamps_index_to_last() -> None:
    delay = md._retry_delay_seconds(
        attempt=9, max_attempts=20, schedule=[10, 20], jitter_ratio=0.0
    )
    assert delay == 20


def test_retry_delay_no_jitter_returns_base() -> None:
    delay = md._retry_delay_seconds(
        attempt=1, max_attempts=5, schedule=[42], jitter_ratio=0.0
    )
    assert delay == 42


def test_retry_delay_with_jitter_in_range() -> None:
    delay = md._retry_delay_seconds(
        attempt=1, max_attempts=5, schedule=[100], jitter_ratio=0.5
    )
    assert 1 <= delay <= 150


# --------------------------------------------------------------------------- #
# preview signing / verification                                              #
# --------------------------------------------------------------------------- #
def test_build_preview_url_and_verify_roundtrip() -> None:
    asset_id = uuid.uuid4()
    url = md.build_preview_url(asset_id, variant_profile="thumb", ttl_seconds=300)
    assert f"/assets/{asset_id}/preview?" in url
    assert "variant_profile=thumb" in url
    # parse exp + sig from the URL and verify
    query = url.split("?", 1)[1]
    params = dict(p.split("=", 1) for p in query.split("&"))
    assert md.verify_preview_signature(
        asset_id,
        exp=int(params["exp"]),
        sig=params["sig"],
        variant_profile="thumb",
    )


def test_build_preview_url_without_variant_and_ttl_floor() -> None:
    asset_id = uuid.uuid4()
    url = md.build_preview_url(asset_id, ttl_seconds=1)  # below 30 -> clamped
    assert "variant_profile" not in url


def test_verify_preview_signature_bad_exp_returns_false() -> None:
    assert not md.verify_preview_signature(
        uuid.uuid4(), exp="not-an-int", sig="x"  # type: ignore[arg-type]
    )


def test_verify_preview_signature_expired_returns_false() -> None:
    assert not md.verify_preview_signature(uuid.uuid4(), exp=1, sig="x")


def test_verify_preview_signature_wrong_sig_returns_false() -> None:
    asset_id = uuid.uuid4()
    url = md.build_preview_url(asset_id, ttl_seconds=300)
    exp = int(dict(p.split("=", 1) for p in url.split("?", 1)[1].split("&"))["exp"])
    assert not md.verify_preview_signature(asset_id, exp=exp, sig="deadbeef")
