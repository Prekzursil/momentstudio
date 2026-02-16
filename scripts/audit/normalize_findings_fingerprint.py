#!/usr/bin/env python3
"""Generate deterministic fingerprint IDs for audit findings."""

from __future__ import annotations

import argparse
import hashlib


def normalize_text(value: str | None) -> str:
    raw = (value or "").strip().lower()
    return " ".join(raw.split())


def fingerprint_for(*, route: str, rule_id: str, primary_file: str, surface: str) -> str:
    payload = "||".join(
        [
            normalize_text(route),
            normalize_text(rule_id),
            normalize_text(primary_file),
            normalize_text(surface),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--route", required=True)
    parser.add_argument("--rule-id", required=True)
    parser.add_argument("--primary-file", required=True)
    parser.add_argument("--surface", required=True)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    value = fingerprint_for(
        route=args.route,
        rule_id=args.rule_id,
        primary_file=args.primary_file,
        surface=args.surface,
    )
    print(value)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

