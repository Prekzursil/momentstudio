from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException
from PIL import Image

from app.core.config import settings
from app.services.storage import save_upload


class DummyUpload:
    def __init__(self, content: bytes, *, filename: str, content_type: str | None):
        self.file = BytesIO(content)
        self.filename = filename
        self.content_type = content_type


def _png_bytes(size: tuple[int, int] = (1, 1)) -> bytes:
    buf = BytesIO()
    Image.new("RGB", size, color=(255, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


def test_save_upload_accepts_valid_image(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "media_root", str(tmp_path))
    upload = DummyUpload(_png_bytes(), filename="test.png", content_type="image/png")

    url_path, saved_name = save_upload(upload, root=tmp_path)

    assert url_path.startswith("/media/")
    assert saved_name.endswith(".png")
    assert (tmp_path / saved_name).exists()


def test_save_upload_normalizes_extension_to_detected_mime(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "media_root", str(tmp_path))
    upload = DummyUpload(_png_bytes(), filename="test.jpg", content_type="image/png")

    _url_path, saved_name = save_upload(upload, root=tmp_path)

    assert saved_name.endswith(".png")


def test_save_upload_rejects_image_over_pixel_limit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "media_root", str(tmp_path))
    monkeypatch.setattr(settings, "upload_image_max_pixels", 1)
    upload = DummyUpload(_png_bytes((2, 1)), filename="test.png", content_type="image/png")

    with pytest.raises(HTTPException) as exc:
        save_upload(upload, root=tmp_path)

    assert exc.value.status_code == 400
    assert exc.value.detail == "Image too large"


def test_save_upload_rejects_non_image_bytes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "media_root", str(tmp_path))
    upload = DummyUpload(b"definitely-not-an-image", filename="bad.png", content_type="image/png")

    with pytest.raises(HTTPException) as exc:
        save_upload(upload, root=tmp_path)

    assert exc.value.status_code == 400
    assert exc.value.detail == "Invalid file type"


def test_save_upload_rejects_disallowed_actual_mime(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "media_root", str(tmp_path))
    upload = DummyUpload(_png_bytes(), filename="test.png", content_type="image/jpeg")

    with pytest.raises(HTTPException) as exc:
        save_upload(upload, root=tmp_path, allowed_content_types=("image/jpeg",))

    assert exc.value.status_code == 400
