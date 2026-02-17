from scripts.audit import percy_auto_approve


def _build(build_id: str, *, state: str, review_state: str, created_at: str) -> dict:
    return {
        "type": "builds",
        "id": build_id,
        "attributes": {
            "state": state,
            "review-state": review_state,
            "created-at": created_at,
        },
    }


def test_selects_latest_approvable_build() -> None:
    builds = [
        _build("11", state="finished", review_state="approved", created_at="2026-02-17T12:00:00Z"),
        _build("12", state="pending", review_state="unreviewed", created_at="2026-02-17T12:05:00Z"),
        _build("13", state="finished", review_state="unreviewed", created_at="2026-02-17T12:10:00Z"),
        _build("14", state="finished", review_state="unreviewed", created_at="2026-02-17T12:11:00Z"),
    ]

    selected = percy_auto_approve.select_build_for_approval(builds)

    assert selected is not None
    assert selected["id"] == "14"


def test_returns_none_when_everything_already_approved() -> None:
    builds = [
        _build("21", state="finished", review_state="approved", created_at="2026-02-17T12:00:00Z"),
        _build("22", state="failed", review_state="unreviewed", created_at="2026-02-17T12:10:00Z"),
    ]

    assert percy_auto_approve.select_build_for_approval(builds) is None


def test_extract_builds_payload_supports_standard_shape() -> None:
    payload = {
        "data": [
            _build("31", state="finished", review_state="unreviewed", created_at="2026-02-17T12:00:00Z"),
        ]
    }

    builds = percy_auto_approve.extract_builds(payload)

    assert len(builds) == 1
    assert builds[0]["id"] == "31"


def test_extract_builds_payload_handles_missing_data() -> None:
    assert percy_auto_approve.extract_builds({}) == []
    assert percy_auto_approve.extract_builds({"data": None}) == []
    assert percy_auto_approve.extract_builds({"data": ["nope"]}) == []


def test_build_query_keeps_branch_optional() -> None:
    query = percy_auto_approve.build_query_params(sha="abc123", branch=None, limit=10)
    assert query == {
        "filter[sha]": "abc123",
        "filter[state]": "finished",
        "page[limit]": "10",
    }

    query_with_branch = percy_auto_approve.build_query_params(sha="abc123", branch="feature/x", limit=5)
    assert query_with_branch == {
        "filter[sha]": "abc123",
        "filter[state]": "finished",
        "filter[branch]": "feature/x",
        "page[limit]": "5",
    }
