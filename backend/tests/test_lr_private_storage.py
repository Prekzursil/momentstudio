"""Lean-gate unit coverage for ``app.services.private_storage``."""

from __future__ import annotations

import io

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image

from app.services import private_storage as ps


@pytest.fixture(autouse=True)
def _root(tmp_path, monkeypatch):
    monkeypatch.setattr(ps.settings, "private_media_root", str(tmp_path))
    return tmp_path


def _png_bytes(fmt: str = "PNG") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (10, 20, 30)).save(buf, format=fmt)
    return buf.getvalue()


def _upload(content: bytes, *, filename: str, content_type: str) -> UploadFile:
    return UploadFile(
        file=io.BytesIO(content),
        filename=filename,
        headers={"content-type": content_type},
    )


# --------------------------------------------------------------------------- #
# _effective_max_bytes                                                         #
# --------------------------------------------------------------------------- #
def test_effective_max_bytes_explicit() -> None:
    assert ps._effective_max_bytes(123) == 123


def test_effective_max_bytes_admin_ceiling(monkeypatch) -> None:
    monkeypatch.setattr(ps.settings, "admin_upload_max_bytes", 999, raising=False)
    assert ps._effective_max_bytes(None) == 999


def test_effective_max_bytes_default(monkeypatch) -> None:
    monkeypatch.setattr(ps.settings, "admin_upload_max_bytes", 0, raising=False)
    assert ps._effective_max_bytes(None) == ps._DEFAULT_ADMIN_UPLOAD_CEILING


# --------------------------------------------------------------------------- #
# ensure_private_root / save_private_bytes                                     #
# --------------------------------------------------------------------------- #
def test_ensure_private_root_creates(tmp_path) -> None:
    target = tmp_path / "nested" / "root"
    out = ps.ensure_private_root(target)
    assert out.exists()


def test_save_private_bytes_round_trip(_root) -> None:
    rel = ps.save_private_bytes(b"hello", subdir="exports", filename="f.bin")
    assert (_root / rel).read_bytes() == b"hello"


def test_save_private_bytes_sanitizes_filename(_root) -> None:
    rel = ps.save_private_bytes(
        b"x", subdir="exports", filename="../../escape.bin"
    )
    # Path(...).name strips traversal -> file lands inside the subdir.
    assert rel.endswith("escape.bin")
    assert "exports/" in rel


def test_save_private_bytes_rejects_subdir_traversal(_root) -> None:
    with pytest.raises(HTTPException) as exc:
        ps.save_private_bytes(b"x", subdir="../outside", filename="f.bin")
    assert exc.value.status_code == 400


# --------------------------------------------------------------------------- #
# save_private_upload                                                          #
# --------------------------------------------------------------------------- #
def test_save_private_upload_pdf(_root) -> None:
    up = _upload(b"%PDF-1.4 data", filename="doc.pdf", content_type="application/pdf")
    rel, original = ps.save_private_upload(up, subdir="labels")
    assert original == "doc.pdf"
    assert rel.endswith(".pdf")
    assert (_root / rel).exists()


def test_save_private_upload_renames_image_suffix(_root) -> None:
    # A PNG body uploaded with a misleading .bin name should be renamed to .png.
    up = _upload(_png_bytes("PNG"), filename="image.bin", content_type="image/png")
    rel, _original = ps.save_private_upload(up, subdir="labels")
    assert rel.endswith(".png")


def test_save_private_upload_invalid_destination(_root) -> None:
    up = _upload(b"%PDF-1.4", filename="d.pdf", content_type="application/pdf")
    with pytest.raises(HTTPException) as exc:
        ps.save_private_upload(up, subdir="../escape")
    assert exc.value.status_code == 400


def test_save_private_upload_rejects_bad_content_type(_root) -> None:
    up = _upload(b"%PDF-1.4", filename="d.pdf", content_type="text/plain")
    with pytest.raises(HTTPException):
        ps.save_private_upload(up, subdir="labels")


def test_save_private_upload_rejects_mismatched_body(_root) -> None:
    # Declared as PDF but the body is not a real PDF/image -> sniff rejects it.
    up = _upload(b"not a pdf", filename="d.pdf", content_type="application/pdf")
    with pytest.raises(HTTPException):
        ps.save_private_upload(up, subdir="labels")


def test_save_private_upload_too_large(_root) -> None:
    up = _upload(b"%PDF" + b"x" * 100, filename="d.pdf", content_type="application/pdf")
    with pytest.raises(HTTPException) as exc:
        ps.save_private_upload(up, subdir="labels", max_bytes=10)
    assert exc.value.status_code == 400


def test_save_private_upload_unexpected_error(_root, monkeypatch) -> None:
    up = _upload(b"%PDF-1.4", filename="d.pdf", content_type="application/pdf")

    def boom(*a, **k):  # noqa: ANN001, ANN002
        raise RuntimeError("disk error")

    monkeypatch.setattr(ps, "_stream_copy", boom)
    with pytest.raises(HTTPException) as exc:
        ps.save_private_upload(up, subdir="labels")
    assert exc.value.detail == "Upload failed"


def test_save_private_upload_default_filename(_root) -> None:
    up = _upload(b"%PDF-1.4", filename="", content_type="application/pdf")
    rel, original = ps.save_private_upload(up, subdir="labels")
    assert original == "shipping-label"


# --------------------------------------------------------------------------- #
# resolve_private_path / delete_private_file                                   #
# --------------------------------------------------------------------------- #
def test_resolve_private_path_ok(_root) -> None:
    path = ps.resolve_private_path("exports/f.bin")
    assert str(path).startswith(str(_root.resolve()))


@pytest.mark.parametrize("bad", ["", "/abs/path", "..\\win", "a\\b"])
def test_resolve_private_path_rejects_bad(_root, bad) -> None:
    with pytest.raises(HTTPException):
        ps.resolve_private_path(bad)


def test_resolve_private_path_rejects_escape(_root) -> None:
    with pytest.raises(HTTPException):
        ps.resolve_private_path("../../etc/passwd")


def test_delete_private_file_removes(_root) -> None:
    rel = ps.save_private_bytes(b"x", subdir="exports", filename="del.bin")
    ps.delete_private_file(rel)
    assert not (_root / rel).exists()


def test_delete_private_file_missing_noop(_root) -> None:
    ps.delete_private_file("exports/never-existed.bin")  # no error


# --------------------------------------------------------------------------- #
# mime detection helpers                                                       #
# --------------------------------------------------------------------------- #
def test_detect_mime_pdf() -> None:
    assert ps._detect_mime(b"%PDF-1.4") == "application/pdf"


def test_detect_mime_image() -> None:
    assert ps._detect_mime(_png_bytes("PNG")) == "image/png"


def test_detect_mime_path_missing(tmp_path) -> None:
    assert ps._detect_mime_path(tmp_path / "nope.bin") is None


def test_detect_mime_path_pdf(tmp_path) -> None:
    p = tmp_path / "a.pdf"
    p.write_bytes(b"%PDF-1.4")
    assert ps._detect_mime_path(p) == "application/pdf"


@pytest.mark.parametrize(
    "fmt,expected",
    [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")],
)
def test_detect_mime_path_images(tmp_path, fmt, expected) -> None:
    p = tmp_path / f"img.{fmt.lower()}"
    p.write_bytes(_png_bytes(fmt))
    assert ps._detect_mime_path(p) == expected


def test_detect_mime_path_invalid_image(tmp_path) -> None:
    p = tmp_path / "bad.png"
    p.write_bytes(b"garbage-not-image")
    assert ps._detect_mime_path(p) is None


def test_detect_mime_path_unsupported_format(tmp_path) -> None:
    # A valid image in an unsupported format (BMP) -> None (final fallthrough).
    p = tmp_path / "img.bmp"
    p.write_bytes(_png_bytes("BMP"))
    assert ps._detect_mime_path(p) is None


@pytest.mark.parametrize(
    "fmt,expected",
    [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")],
)
def test_detect_image_mime(fmt, expected) -> None:
    assert ps._detect_image_mime(_png_bytes(fmt)) == expected


def test_detect_image_mime_invalid() -> None:
    assert ps._detect_image_mime(b"nope") is None


def test_detect_image_mime_unsupported_format() -> None:
    # Valid BMP image -> unsupported format -> final None fallthrough.
    assert ps._detect_image_mime(_png_bytes("BMP")) is None


class _FormatlessImage:
    """A context-managed stand-in whose ``format`` is None (defensive branch)."""

    format = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):  # noqa: ANN002
        return False

    def verify(self):
        return None


def test_detect_image_mime_none_format(monkeypatch) -> None:
    monkeypatch.setattr(ps.Image, "open", lambda *a, **k: _FormatlessImage())
    assert ps._detect_image_mime(b"%PNGfake") is None


def test_detect_mime_path_none_format(tmp_path, monkeypatch) -> None:
    p = tmp_path / "img.png"
    # Header is not a PDF so it falls through to the PIL branch.
    p.write_bytes(b"\x89PNGdummy")
    monkeypatch.setattr(ps.Image, "open", lambda *a, **k: _FormatlessImage())
    assert ps._detect_mime_path(p) is None


# --------------------------------------------------------------------------- #
# _suffix_for_mime                                                             #
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "mime,name,expected",
    [
        ("application/pdf", "x.txt", ".pdf"),
        ("image/png", "x.png", ".png"),
        ("image/png", "x.txt", ".png"),
        ("image/jpeg", "x.jpg", ".jpg"),
        ("image/jpeg", "x.jpeg", ".jpeg"),
        ("image/jpeg", "x.txt", ".jpg"),
        ("image/webp", "x.webp", ".webp"),
        ("image/webp", "x.txt", ".webp"),
        ("application/octet-stream", "x.dat", ".dat"),
        ("application/octet-stream", "noext", ".bin"),
    ],
)
def test_suffix_for_mime(mime, name, expected) -> None:
    assert ps._suffix_for_mime(mime, name) == expected
