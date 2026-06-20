"""Lean-gate unit coverage for ``app.services.storage``.

Exercises the media-storage surface with real Pillow-generated images and SVGs
against a temp ``media_root``: ``save_upload`` (success + thumbnails + SVG
sanitize, size/type/destination guards), ``save_image_bytes`` (all guards +
canonical-extension cleanup), mime detection (raster/svg/bad), URL<->path
mapping guards, delete/stats/regenerate, dimension validation and the SVG
sanitizer (disallowed tags/attrs/styles + doctype/entity rejection).
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image

from app.core.config import settings
from app.services import storage


def _png_bytes(size=(64, 48), color=(255, 0, 0)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def _jpeg_bytes(size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (0, 128, 255)).save(buf, format="JPEG")
    return buf.getvalue()


def _upload(content: bytes, *, filename: str, content_type: str) -> UploadFile:
    return UploadFile(
        file=io.BytesIO(content),
        filename=filename,
        headers={"content-type": content_type},
    )


@pytest.fixture(autouse=True)
def _media_root(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "media_root", str(tmp_path), raising=False)
    # Generous dimension limits so valid fixtures pass.
    monkeypatch.setattr(settings, "upload_image_max_width", 4000, raising=False)
    monkeypatch.setattr(settings, "upload_image_max_height", 4000, raising=False)
    monkeypatch.setattr(settings, "upload_image_max_pixels", 16_000_000, raising=False)
    return tmp_path


# --------------------------------------------------------------------------- #
# pure helpers                                                                 #
# --------------------------------------------------------------------------- #
def test_suffix_and_mime_helpers() -> None:
    assert storage._suffix_for_mime("image/jpeg") == ".jpg"
    assert storage._suffix_for_mime("image/png") == ".png"
    assert storage._suffix_for_mime("image/webp") == ".webp"
    assert storage._suffix_for_mime("image/gif") == ".gif"
    assert storage._suffix_for_mime("image/svg+xml") == ".svg"
    assert storage._suffix_for_mime("application/zip") is None
    assert storage._suffix_for_mime(None) is None

    assert storage._mime_for_image_format("JPEG") == "image/jpeg"
    assert storage._mime_for_image_format("PNG") == "image/png"
    assert storage._mime_for_image_format("WEBP") == "image/webp"
    assert storage._mime_for_image_format("GIF") == "image/gif"
    assert storage._mime_for_image_format("TIFF") is None
    assert storage._mime_for_image_format(None) is None


def test_detect_image_mime_variants() -> None:
    assert storage._detect_image_mime(_png_bytes()) == "image/png"
    assert storage._detect_image_mime(_jpeg_bytes()) == "image/jpeg"
    assert storage._detect_image_mime(b"<svg xmlns='x'></svg>") == "image/svg+xml"
    assert storage._detect_image_mime(b"not an image") is None
    assert storage._detect_svg_mime(b"") is None
    assert storage._detect_svg_mime(b"plain text") is None


def test_detect_image_mime_dimension_bomb(monkeypatch) -> None:
    monkeypatch.setattr(settings, "upload_image_max_pixels", 10, raising=False)
    with pytest.raises(HTTPException):
        storage._detect_image_mime(_png_bytes(size=(100, 100)))


def test_validate_raster_dimensions_guards(monkeypatch) -> None:
    monkeypatch.setattr(settings, "upload_image_max_width", 10, raising=False)
    with pytest.raises(HTTPException):
        storage._validate_raster_dimensions(width=20, height=5)
    monkeypatch.setattr(settings, "upload_image_max_width", 0, raising=False)
    monkeypatch.setattr(settings, "upload_image_max_height", 10, raising=False)
    with pytest.raises(HTTPException):
        storage._validate_raster_dimensions(width=5, height=20)
    monkeypatch.setattr(settings, "upload_image_max_height", 0, raising=False)
    monkeypatch.setattr(settings, "upload_image_max_pixels", 10, raising=False)
    with pytest.raises(HTTPException):
        storage._validate_raster_dimensions(width=5, height=5)


# --------------------------------------------------------------------------- #
# ensure_media_root / url<->path                                               #
# --------------------------------------------------------------------------- #
def test_ensure_media_root(_media_root) -> None:
    root = storage.ensure_media_root()
    assert root.is_dir()


def test_media_url_to_path_guards() -> None:
    with pytest.raises(ValueError):
        storage._media_url_to_path("https://x/y")
    with pytest.raises(ValueError):
        storage._media_url_to_path("/media/")
    with pytest.raises(ValueError):
        storage._media_url_to_path("/media//abs")
    with pytest.raises(ValueError):
        storage._media_url_to_path("/media/..\\evil")
    with pytest.raises(ValueError):
        storage._media_url_to_path("/media/../escape.png")
    good = storage.media_url_to_path("/media/sub/file.png")
    assert good.name == "file.png"


# --------------------------------------------------------------------------- #
# save_image_bytes                                                             #
# --------------------------------------------------------------------------- #
def test_save_image_bytes_success_and_cleanup(_media_root) -> None:
    # Pre-create a stale .png so the canonical-extension cleanup loop unlinks it.
    stale = Path(_media_root) / "social" / "img.png"
    stale.parent.mkdir(parents=True, exist_ok=True)
    stale.write_bytes(b"stale")

    url = storage.save_image_bytes(_jpeg_bytes(), relative_path="social/img")
    assert url == "/media/social/img.jpg"
    assert (Path(_media_root) / "social" / "img.jpg").exists()
    assert not stale.exists()  # the old .png was cleaned up


def test_save_image_bytes_guards(_media_root) -> None:
    with pytest.raises(ValueError):
        storage.save_image_bytes("notbytes", relative_path="a")  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        storage.save_image_bytes(b"", relative_path="a")
    with pytest.raises(ValueError):
        storage.save_image_bytes(_png_bytes(), relative_path="a", max_bytes=1)
    with pytest.raises(ValueError):
        storage.save_image_bytes(b"not-an-image-payload", relative_path="a")
    with pytest.raises(ValueError):
        storage.save_image_bytes(_png_bytes(), relative_path="")  # empty path
    with pytest.raises(ValueError):
        storage.save_image_bytes(_png_bytes(), relative_path="../escape")


# --------------------------------------------------------------------------- #
# save_upload                                                                  #
# --------------------------------------------------------------------------- #
def test_save_upload_png_with_thumbnails(_media_root) -> None:
    up = _upload(_png_bytes(), filename="pic.png", content_type="image/png")
    url, name = storage.save_upload(up, generate_thumbnails=True)
    assert url.startswith("/media/")
    final = Path(_media_root) / url.removeprefix("/media/")
    assert final.exists()
    # Thumbnails written next to the final file.
    for suffix in ("sm", "md", "lg"):
        assert final.with_name(f"{final.stem}-{suffix}{final.suffix}").exists()


def test_save_upload_renames_to_canonical_suffix(_media_root) -> None:
    # JPEG content uploaded with a .bin name -> canonical .jpg suffix applied.
    up = _upload(_jpeg_bytes(), filename="weird.bin", content_type="image/jpeg")
    url, name = storage.save_upload(up)
    assert url.endswith(".jpg")


def test_save_upload_svg_sanitized(_media_root) -> None:
    svg = b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
    up = _upload(svg, filename="logo.svg", content_type="image/svg+xml")
    url, name = storage.save_upload(up, allowed_content_types=("image/svg+xml",))
    final = Path(_media_root) / url.removeprefix("/media/")
    assert b"script" not in final.read_bytes().lower()


def test_save_upload_too_large(_media_root) -> None:
    up = _upload(
        _png_bytes(size=(200, 200)), filename="big.png", content_type="image/png"
    )
    with pytest.raises(HTTPException):
        storage.save_upload(up, max_bytes=10)


def test_save_upload_invalid_content_type(_media_root) -> None:
    up = _upload(_png_bytes(), filename="pic.png", content_type="application/zip")
    with pytest.raises(HTTPException):
        storage.save_upload(up)


def test_save_upload_mismatched_sniff(_media_root) -> None:
    # Declares png but body is jpeg -> sniff mime not in allowed -> rejected.
    up = _upload(_jpeg_bytes(), filename="pic.png", content_type="image/png")
    with pytest.raises(HTTPException):
        storage.save_upload(up, allowed_content_types=("image/png",))


def test_save_upload_bad_destination(_media_root) -> None:
    up = _upload(_png_bytes(), filename="pic.png", content_type="image/png")
    with pytest.raises(HTTPException):
        # A root outside the media base is rejected.
        storage.save_upload(up, root="/totally/outside/root")


def test_save_upload_with_explicit_filename(_media_root) -> None:
    up = _upload(_png_bytes(), filename="orig.png", content_type="image/png")
    url, name = storage.save_upload(up, filename="chosen.png")
    assert "chosen" in name


def test_save_upload_no_allowed_content_types(_media_root) -> None:
    # allowed_content_types=None skips the mime sniff entirely.
    up = _upload(_png_bytes(), filename="any.png", content_type="image/png")
    url, name = storage.save_upload(up, allowed_content_types=None)
    assert url.startswith("/media/")


def test_save_upload_svg_too_large(_media_root) -> None:
    big_svg = (
        b"<svg xmlns='http://www.w3.org/2000/svg'>"
        + b" " * (storage._SVG_MAX_BYTES + 10)
        + b"</svg>"
    )
    up = _upload(big_svg, filename="big.svg", content_type="image/svg+xml")
    with pytest.raises(HTTPException):
        storage.save_upload(up, allowed_content_types=("image/svg+xml",))


def test_save_upload_admin_no_max_bytes(_media_root, monkeypatch) -> None:
    monkeypatch.setattr(settings, "admin_upload_max_bytes", 0, raising=False)
    up = _upload(_png_bytes(), filename="a.png", content_type="image/png")
    url, _ = storage.save_upload(up, max_bytes=None)
    assert url.startswith("/media/")


# --------------------------------------------------------------------------- #
# delete / stats / regenerate                                                  #
# --------------------------------------------------------------------------- #
def test_delete_and_stats_and_regenerate(_media_root) -> None:
    up = _upload(_png_bytes(), filename="z.png", content_type="image/png")
    url, _ = storage.save_upload(up, generate_thumbnails=True)

    stats = storage.get_media_image_stats(url)
    assert stats["original_bytes"] is not None
    assert stats["width"] == 64

    regen = storage.regenerate_media_thumbnails(url)
    assert regen["original_bytes"] is not None

    # Non-media URL or missing file: delete is a safe no-op.
    storage.delete_file("https://x/not-media")
    storage.delete_file("/media/does/not/exist.png")

    storage.delete_file(url)
    assert not (Path(_media_root) / url.removeprefix("/media/")).exists()

    # Stats on a now-missing file -> all None except thumbs.
    gone = storage.get_media_image_stats(url)
    assert gone["original_bytes"] is None


def test_delete_file_without_siblings(_media_root) -> None:
    # A saved file with NO generated thumbnails: the sibling-removal loop runs
    # but every existence check is False (241->239 arc).
    up = _upload(_png_bytes(), filename="nosib.png", content_type="image/png")
    url, _ = storage.save_upload(up)  # generate_thumbnails defaults to False
    storage.delete_file(url)
    assert not (Path(_media_root) / url.removeprefix("/media/")).exists()


def test_regenerate_missing_raises(_media_root) -> None:
    with pytest.raises(FileNotFoundError):
        storage.regenerate_media_thumbnails("/media/missing.png")


def test_generate_thumbnails_public_wrapper(_media_root) -> None:
    up = _upload(_png_bytes(), filename="w.png", content_type="image/png")
    url, _ = storage.save_upload(up)
    path = Path(_media_root) / url.removeprefix("/media/")
    storage.generate_thumbnails(path)
    assert path.with_name(f"{path.stem}-sm{path.suffix}").exists()


# --------------------------------------------------------------------------- #
# SVG sanitizer                                                                #
# --------------------------------------------------------------------------- #
def test_save_upload_generic_failure(_media_root, monkeypatch) -> None:
    # A non-HTTPException raised during processing -> 400 "Upload failed".
    monkeypatch.setattr(
        storage,
        "_detect_image_mime_path",
        lambda path: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    up = _upload(_png_bytes(), filename="x.png", content_type="image/png")
    with pytest.raises(HTTPException):
        storage.save_upload(up)


def test_detect_image_mime_path_oserror(_media_root, tmp_path) -> None:
    # Opening a directory as an image -> OSError on read -> None.
    d = Path(tmp_path) / "adir"
    d.mkdir()
    assert storage._detect_image_mime_path(d) is None


def test_detect_image_mime_path_svg_and_bad(_media_root, tmp_path) -> None:
    svg = Path(tmp_path) / "a.svg"
    svg.write_bytes(b"<svg xmlns='x'></svg>")
    assert storage._detect_image_mime_path(svg) == "image/svg+xml"

    notimg = Path(tmp_path) / "a.txt"
    notimg.write_bytes(b"not an image at all")
    assert storage._detect_image_mime_path(notimg) is None


def test_detect_image_mime_path_dimension_bomb(
    _media_root, tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "upload_image_max_pixels", 10, raising=False)
    big = Path(tmp_path) / "big.png"
    big.write_bytes(_png_bytes(size=(100, 100)))
    with pytest.raises(HTTPException):
        storage._detect_image_mime_path(big)


def test_detect_mime_decompression_bomb(_media_root, tmp_path, monkeypatch) -> None:
    # Force Pillow to treat a normal image as a decompression bomb.
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1, raising=False)

    # Path variant.
    big = Path(tmp_path) / "bomb.png"
    big.write_bytes(_png_bytes(size=(80, 80)))
    with pytest.raises(HTTPException):
        storage._detect_image_mime_path(big)

    # Bytes variant.
    with pytest.raises(HTTPException):
        storage._detect_image_mime(_png_bytes(size=(80, 80)))


def test_delete_file_invalid_path_is_noop() -> None:
    # Passes the /media/ prefix check but _media_url_to_path raises -> swallowed.
    storage.delete_file("/media/../escape.png")


def test_sanitize_svg_plain_and_style_passthrough() -> None:
    # A style without url()/@import is returned unchanged; an attribute that is
    # not dict-typed is skipped; empty href is left as-is.
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg'>"
        "<rect style='fill:red;;'/>"
        "<a href=''>x</a>"
        "<style>.x{fill:green}</style>"
        "</svg>"
    ).encode()
    out = storage._sanitize_svg(svg).lower()
    assert b"fill:red" in out


def test_sanitize_svg_strips_dangerous_content() -> None:
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg' onload='x()'>"
        "<script>bad()</script>"
        "<a href='http://evil.com'>x</a>"
        "<a href='#local'>ok</a>"
        "<rect style='fill:red; background:url(http://evil.com)'/>"
        "<style>@import url(http://evil.com); .a{fill:blue}</style>"
        "</svg>"
    ).encode()
    out = storage._sanitize_svg(svg).lower()
    assert b"script" not in out
    assert b"onload" not in out
    assert b"evil.com" not in out


def test_sanitize_svg_style_with_empty_parts_and_safe_url() -> None:
    # A style containing url() forces the cleaning loop; empty ";;" parts hit the
    # empty-part continue, and a safe (local) url is retained.
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg'>"
        "<rect style='fill:red;; background:url(#grad);'/>"
        "<g><circle r='1'/></g>"
        "<style>.safe{fill:url(#grad)}</style>"
        "</svg>"
    ).encode()
    out = storage._sanitize_svg(svg)
    assert b"fill:red" in out.lower()


def test_sanitize_svg_with_comment_nonstr_tag() -> None:
    # An XML comment yields an element whose .tag is not a str, exercising the
    # non-str guard in the local-tag helper.
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg'><!-- a comment --><rect/></svg>"
    ).encode()
    out = storage._sanitize_svg(svg)
    assert b"rect" in out.lower()


def test_sanitize_svg_rejects_doctype_and_entity() -> None:
    with pytest.raises(HTTPException):
        storage._sanitize_svg(b"<!DOCTYPE svg><svg></svg>")
    with pytest.raises(HTTPException):
        storage._sanitize_svg(b"<!ENTITY x 'y'><svg></svg>")


def test_sanitize_svg_too_large() -> None:
    with pytest.raises(HTTPException):
        storage._sanitize_svg(b"<svg/>" + b"x" * (storage._SVG_MAX_BYTES + 1))


def test_sanitize_svg_invalid_and_wrong_root() -> None:
    with pytest.raises(HTTPException):
        storage._sanitize_svg(b"<svg <broken")
    with pytest.raises(HTTPException):
        storage._sanitize_svg(b"<notsvg></notsvg>")
