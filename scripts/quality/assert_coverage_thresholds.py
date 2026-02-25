#!/usr/bin/env python3
"""Enforce absolute backend/frontend/project line coverage thresholds."""

from __future__ import annotations

import argparse
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def _load_backend_coverage(path: Path) -> tuple[float, int, int]:
    if not path.exists():
        raise FileNotFoundError(f"Backend coverage XML not found: {path}")

    root = ET.parse(path).getroot()
    lines_valid = int(root.attrib.get("lines-valid", "0"))
    lines_covered = int(root.attrib.get("lines-covered", "0"))
    if lines_valid <= 0:
        raise ValueError(f"Backend coverage XML has invalid lines-valid={lines_valid} ({path})")
    pct = (lines_covered / lines_valid) * 100.0
    return pct, lines_covered, lines_valid


def _load_frontend_coverage(path: Path) -> tuple[float, int, int]:
    if not path.exists():
        raise FileNotFoundError(f"Frontend lcov not found: {path}")

    lines_found = 0
    lines_hit = 0
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if line.startswith("LF:"):
            lines_found += int(line[3:] or 0)
        elif line.startswith("LH:"):
            lines_hit += int(line[3:] or 0)

    if lines_found <= 0:
        raise ValueError(f"Frontend lcov has no LF entries ({path})")
    pct = (lines_hit / lines_found) * 100.0
    return pct, lines_hit, lines_found


def main() -> int:
    parser = argparse.ArgumentParser(description="Assert absolute coverage thresholds.")
    parser.add_argument("--backend", default="backend/coverage.xml", help="Path to backend coverage XML")
    parser.add_argument("--frontend", default="frontend/coverage/lcov.info", help="Path to frontend lcov file")
    parser.add_argument("--threshold", type=float, default=90.0, help="Coverage percentage threshold")
    args = parser.parse_args()

    backend_pct, backend_hit, backend_total = _load_backend_coverage(Path(args.backend))
    frontend_pct, frontend_hit, frontend_total = _load_frontend_coverage(Path(args.frontend))

    project_hit = backend_hit + frontend_hit
    project_total = backend_total + frontend_total
    project_pct = (project_hit / project_total) * 100.0 if project_total else 0.0

    print(f"Backend coverage:  {backend_pct:.2f}% ({backend_hit}/{backend_total})")
    print(f"Frontend coverage: {frontend_pct:.2f}% ({frontend_hit}/{frontend_total})")
    print(f"Project coverage:  {project_pct:.2f}% ({project_hit}/{project_total})")
    print(f"Threshold:         {args.threshold:.2f}%")

    failures: list[str] = []
    if backend_pct < args.threshold:
        failures.append(f"backend={backend_pct:.2f}%")
    if frontend_pct < args.threshold:
        failures.append(f"frontend={frontend_pct:.2f}%")
    if project_pct < args.threshold:
        failures.append(f"project={project_pct:.2f}%")

    if failures:
        print("Coverage threshold failure:", ", ".join(failures))
        return 1

    print("Coverage thresholds satisfied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
