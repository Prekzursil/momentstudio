"""Worker-0 coverage closure for ``app.services.storage``.

Targets the destination-guard branch in ``save_upload`` (lines 43-44): when a
caller passes an upload ``root`` that is creatable on disk yet resolves OUTSIDE
the configured media base, the function must reject it with a 400 rather than
write the file. The repo's existing destination test uses a non-creatable
absolute path (``/totally/outside/root``) which only reaches this branch when
mkdir succeeds (e.g. running as root in CI); this test uses a real sibling
directory so the relative_to guard is exercised deterministically on any host.
"""

from __future__ import annotations

import io

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image

from app.core.config import settings
from app.services import storage


def _png_bytes(size=(16, 16)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (10, 20, 30)).save(buf, format="PNG")
    return buf.getvalue()


def _upload(content: bytes, *, filename: str, content_type: str) -> UploadFile:
    return UploadFile(
        file=io.BytesIO(content),
        filename=filename,
        headers={"content-type": content_type},
    )


def test_save_upload_creatable_root_outside_media_base_rejected(
    monkeypatch, tmp_path
) -> None:
    # media base and the (creatable) destination are siblings: mkdir succeeds,
    # but ``dest_root.relative_to(base_root)`` raises -> 400 (storage.py 43-44).
    base = tmp_path / "media-base"
    base.mkdir()
    outside = tmp_path / "outside-root"  # creatable, NOT under base

    monkeypatch.setattr(settings, "media_root", str(base), raising=False)

    up = _upload(_png_bytes(), filename="pic.png", content_type="image/png")
    with pytest.raises(HTTPException) as exc:
        storage.save_upload(up, root=str(outside))

    assert exc.value.status_code == 400
    assert exc.value.detail == "Invalid upload destination"
    # The rejected destination must not have leaked a file.
    assert not any(outside.glob("*")) if outside.exists() else True
