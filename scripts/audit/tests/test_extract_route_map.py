from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_module():
    module_path = Path(__file__).resolve().parents[1] / "extract_route_map.py"
    spec = importlib.util.spec_from_file_location("extract_route_map", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_extract_route_map_handles_mixed_quotes_and_multiline_fields() -> None:
    module = _load_module()
    fixture = Path(__file__).resolve().parent / "fixtures" / "mixed_quotes_routes.ts"

    route_map = module.extract_route_map(fixture)
    routes = route_map["routes"]
    by_path = {row["full_path"]: row for row in routes}

    assert by_path["/"]["title_key"] == "routes.home.title"
    assert by_path["/"]["robots_hint"] == "index,follow"

    assert by_path["/account/orders"]["title_key"] == "routes.account.orders"
    assert by_path["/account/orders"]["robots_hint"] == "noindex,nofollow"

    assert by_path["/account/settings"]["title_key"] is None
    assert by_path["/account/settings"]["robots_hint"] is None

    assert by_path["/admin/content/pages"]["title_key"] == "routes.admin.content.pages"
    assert by_path["/admin/content/pages"]["robots_hint"] == "ROBOTS_NOINDEX"


def test_extract_route_map_sorting_semantics() -> None:
    module = _load_module()
    fixture = Path(__file__).resolve().parent / "fixtures" / "mixed_quotes_routes.ts"

    route_map = module.extract_route_map(fixture)
    routes = route_map["routes"]

    assert routes == sorted(routes, key=lambda item: (item["surface"], item["full_path"]))
