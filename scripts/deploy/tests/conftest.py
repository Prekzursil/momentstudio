"""Path setup for the deploy-gate tests.

Puts the repo root on ``sys.path`` so ``import scripts.deploy...`` resolves when
pytest is run from the ``scripts/deploy`` gate context, and the backend dir so the
gate modules' lazy ``import app...`` calls resolve (mirrors ``backend/pytest.ini``
``pythonpath = backend``).
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_DIR = REPO_ROOT / "backend"

for path in (str(REPO_ROOT), str(BACKEND_DIR)):
    if path not in sys.path:
        sys.path.insert(0, path)
