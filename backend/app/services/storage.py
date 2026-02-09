import logging
import uuid
from io import BytesIO
from pathlib import Path
from typing import Tuple

from PIL import Image
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings

logger = logging.getLogger(__name__)

_SVG_MAX_BYTES = 1024 * 1024  # avoid expensive parsing for huge SVGs
_MEDIA_URL_PREFIX = "/media/"


def ensure_media_root(root: str | Path | None = None) -> Path:
    path = Path(root or settings.media_root)
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_upload(
    file: UploadFile,
    root: str | Path | None = None,
    filename: str | None = None,
    allowed_content_types: tuple[str, ...] | None = ("image/png", "image/jpeg", "image/webp", "image/gif"),
    max_bytes: int | None = 5 * 1024 * 1024,
    generate_thumbnails: bool = False,
) -> Tuple[str, str]:
    base_root = Path(settings.media_root).resolve()
    dest_root = Path(root or base_root).resolve()
    dest_root.mkdir(parents=True, exist_ok=True)
    try:
        dest_root.relative_to(base_root)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid upload destination")

    admin_ceiling = int(getattr(settings, "admin_upload_max_bytes", 0) or 0)
    if max_bytes is None:
        # Admin-only endpoints may pass max_bytes=None. We still enforce a ceiling to avoid
        # unbounded uploads that can exhaust disk/memory under abuse.
        effective_max_bytes = admin_ceiling if admin_ceiling > 0 else 512 * 1024 * 1024
    else:
        effective_max_bytes = int(max_bytes)

    safe_name = Path(filename or "").name if filename else ""
    original_suffix = Path(file.filename or "").suffix.lower()
    if safe_name:
        initial_stem = Path(safe_name).stem
        initial_suffix = Path(safe_name).suffix or original_suffix or ".bin"
    else:
        initial_stem = uuid.uuid4().hex
        initial_suffix = original_suffix or ".bin"

    destination = dest_root / f"{initial_stem}{initial_suffix}"

    def _cleanup(path: Path) -> None:
        try:
            if path.exists():
                path.unlink()
        except Exception:  # pragma: no cover
            logger.warning("upload_cleanup_failed", extra={"path": str(path)})

    def _stream_copy(dest: Path) -> int:
        chunk_size = 1024 * 1024
        written = 0
        with dest.open("wb") as out:
            while True:
                chunk = file.file.read(chunk_size)
                if not chunk:
                    break
                written += len(chunk)
                if written > effective_max_bytes:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large")
                out.write(chunk)
        return written

    try:
        written = _stream_copy(destination)

        sniff_mime: str | None = None
        if allowed_content_types:
            if not file.content_type or file.content_type not in allowed_content_types:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type")
            sniff_mime = _detect_image_mime_path(destination)
            if not sniff_mime or sniff_mime not in allowed_content_types:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type")

        is_svg = sniff_mime == "image/svg+xml"
        if is_svg:
            if written > _SVG_MAX_BYTES:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SVG file too large")
            raw = destination.read_bytes()
            sanitized = _sanitize_svg(raw)
            destination.write_bytes(sanitized)

        canonical_suffix = _suffix_for_mime(sniff_mime) if sniff_mime else None
        final_path = destination
        if canonical_suffix and destination.suffix.lower() != canonical_suffix:
            final_path = destination.with_name(f"{destination.stem}{canonical_suffix}")
            destination.rename(final_path)

        if generate_thumbnails and allowed_content_types and not is_svg:
            _generate_thumbnails(final_path)

        rel_path = final_path.relative_to(base_root).as_posix()
        return f"/media/{rel_path}", final_path.name
    except HTTPException:
        _cleanup(destination)
        raise
    except Exception as exc:
        _cleanup(destination)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload failed") from exc


def _detect_image_mime_path(path: Path) -> str | None:
    try:
        with path.open("rb") as fp:
            head = fp.read(2048)
    except OSError:
        return None

    svg = _detect_svg_mime(head)
    if svg:
        return svg

    try:
        with Image.open(path) as img:
            return _detect_raster_mime(img)
    except HTTPException:
        raise
    except Image.DecompressionBombError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image too large")
    except (OSError, ValueError):
        return None


def delete_file(media_url: str) -> None:
    if not isinstance(media_url, str) or not media_url.startswith(_MEDIA_URL_PREFIX):
        return
    try:
        path = _media_url_to_path(media_url)
    except Exception:
        return
    if path.exists():
        path.unlink()
        for suffix in ("-sm", "-md", "-lg"):
            sibling = path.with_name(f"{path.stem}{suffix}{path.suffix}")
            if sibling.exists():
                sibling.unlink()


def get_media_image_stats(url: str) -> dict[str, int | None]:
    path = _media_url_to_path(url)
    stats: dict[str, int | None] = {
        "original_bytes": None,
        "thumb_sm_bytes": None,
        "thumb_md_bytes": None,
        "thumb_lg_bytes": None,
        "width": None,
        "height": None,
    }

    if path.exists():
        stats["original_bytes"] = path.stat().st_size
        try:
            with Image.open(path) as img:
                width, height = img.size
                stats["width"] = int(width)
                stats["height"] = int(height)
        except Exception:  # pragma: no cover
            pass

    for suffix in ("sm", "md", "lg"):
        thumb_path = path.with_name(f"{path.stem}-{suffix}{path.suffix}")
        stats[f"thumb_{suffix}_bytes"] = thumb_path.stat().st_size if thumb_path.exists() else None

    return stats


def regenerate_media_thumbnails(url: str) -> dict[str, int | None]:
    path = _media_url_to_path(url)
    if not path.exists():
        raise FileNotFoundError(f"Media file not found: {url}")
    _generate_thumbnails(path)
    return get_media_image_stats(url)


def media_url_to_path(url: str) -> Path:
    return _media_url_to_path(url)


def generate_thumbnails(path: str | Path) -> None:
    _generate_thumbnails(Path(path))


def _media_url_to_path(url: str) -> Path:
    if not url.startswith(_MEDIA_URL_PREFIX):
        raise ValueError("Invalid media URL")

    base_root = Path(settings.media_root).resolve()
    rel = url.removeprefix(_MEDIA_URL_PREFIX)
    path = (base_root / rel).resolve()
    try:
        path.relative_to(base_root)
    except ValueError:
        raise ValueError("Invalid media URL")
    return path


def _generate_thumbnails(path: Path) -> None:
    try:
        with Image.open(path) as img:
            sizes = {"sm": (320, 320), "md": (640, 640), "lg": (1024, 1024)}
            for suffix, size in sizes.items():
                thumb = img.copy()
                thumb.thumbnail(size)
                thumb_path = path.with_name(f"{path.stem}-{suffix}{path.suffix}")
                thumb.save(thumb_path, optimize=True)
    except Exception as exc:  # pragma: no cover
        logger.warning("thumbnail_generation_failed", extra={"path": str(path), "error": str(exc)})


def _detect_image_mime(content: bytes) -> str | None:
    svg = _detect_svg_mime(content)
    if svg:
        return svg
    try:
        with Image.open(BytesIO(content)) as img:
            return _detect_raster_mime(img)
    except HTTPException:
        raise
    except Image.DecompressionBombError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image too large")
    except (OSError, ValueError):
        return None


def _mime_for_image_format(image_format: str | None) -> str | None:
    if not image_format:
        return None

    normalized = image_format.upper()
    if normalized == "JPEG":
        return "image/jpeg"
    if normalized == "PNG":
        return "image/png"
    if normalized == "WEBP":
        return "image/webp"
    if normalized == "GIF":
        return "image/gif"
    return None


def _detect_raster_mime(img: Image.Image) -> str | None:
    width, height = img.size
    _validate_raster_dimensions(width=int(width), height=int(height))
    image_format = img.format
    img.verify()
    return _mime_for_image_format(image_format)


def _detect_svg_mime(content: bytes) -> str | None:
    head = (content or b"")[:2048].lstrip().lower()
    if not head:
        return None
    # Common SVGs start with "<svg" or with an xml declaration before the <svg> element.
    if head.startswith(b"<svg") or b"<svg" in head:
        return "image/svg+xml"
    return None


def _validate_raster_dimensions(*, width: int, height: int) -> None:
    max_width = int(getattr(settings, "upload_image_max_width", 0) or 0)
    max_height = int(getattr(settings, "upload_image_max_height", 0) or 0)
    max_pixels = int(getattr(settings, "upload_image_max_pixels", 0) or 0)

    if max_width and width > max_width:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image too large")
    if max_height and height > max_height:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image too large")
    if max_pixels and (width * height) > max_pixels:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image too large")


def _suffix_for_mime(mime: str | None) -> str | None:
    if not mime:
        return None
    if mime == "image/jpeg":
        return ".jpg"
    if mime == "image/png":
        return ".png"
    if mime == "image/webp":
        return ".webp"
    if mime == "image/gif":
        return ".gif"
    if mime == "image/svg+xml":
        return ".svg"
    return None


def _sanitize_svg(content: bytes) -> bytes:
    raw = content or b""
    if len(raw) > _SVG_MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SVG file too large")

    lowered = raw.lower()
    if b"<!doctype" in lowered or b"<!entity" in lowered:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported SVG content")

    try:
        from defusedxml import ElementTree

        root = ElementTree.fromstring(raw.decode("utf-8", errors="replace"))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid SVG") from exc

    def _local(tag: str) -> str:
        if not isinstance(tag, str):
            return ""
        return tag.rsplit("}", 1)[-1].lower()

    if _local(getattr(root, "tag", "")) != "svg":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid SVG")

    disallowed_tags = {
        "script",
        "foreignobject",
        "iframe",
        "object",
        "embed",
        "audio",
        "video",
        "link",
        "meta",
    }
    href_keys = {"href", "{http://www.w3.org/1999/xlink}href", "xlink:href", "src"}

    def _sanitize_style(value: str) -> str:
        # Drop obvious external fetches and javascript-like URLs.
        lowered_style = value.lower()
        if "url(" not in lowered_style and "@import" not in lowered_style:
            return value
        cleaned = []
        for part in value.split(";"):
            p = part.strip()
            if not p:
                continue
            low = p.lower()
            if "@import" in low:
                continue
            if "url(" in low and ("javascript:" in low or "data:" in low or "http://" in low or "https://" in low):
                continue
            cleaned.append(p)
        return "; ".join(cleaned)

    # Remove disallowed descendants and dangerous attributes.
    for parent in root.iter():
        for child in list(parent):
            if _local(getattr(child, "tag", "")) in disallowed_tags:
                parent.remove(child)

        attrib = getattr(parent, "attrib", None)
        if not isinstance(attrib, dict):
            continue
        for key in list(attrib.keys()):
            key_str = str(key)
            low_key = key_str.lower()
            if low_key.startswith("on"):
                attrib.pop(key, None)
                continue
            if key_str in href_keys or low_key in href_keys:
                val = str(attrib.get(key, "") or "").strip()
                low_val = val.lower()
                if not val:
                    continue
                # Allow only same-document references.
                if low_val.startswith("#"):
                    continue
                attrib.pop(key, None)
                continue
            if low_key == "style":
                attrib[key] = _sanitize_style(str(attrib.get(key, "") or ""))

    # Sanitize <style> nodes.
    for el in root.iter():
        if _local(getattr(el, "tag", "")) != "style":
            continue
        text_value = str(getattr(el, "text", "") or "")
        cleaned = _sanitize_style(text_value)
        el.text = cleaned

    try:
        sanitized = ElementTree.tostring(root, encoding="utf-8", method="xml")
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid SVG") from exc
    return sanitized
