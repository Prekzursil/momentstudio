import logging
import uuid
from io import BytesIO
from pathlib import Path
from typing import Tuple

from PIL import Image, UnidentifiedImageError
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings

logger = logging.getLogger(__name__)

_SVG_MAX_BYTES = 1024 * 1024  # avoid expensive parsing for huge SVGs


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

    read_len = max_bytes + 1 if max_bytes is not None else -1
    content = file.file.read(read_len)
    if max_bytes is not None and len(content) > max_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large")

    sniff_mime: str | None = None
    if allowed_content_types:
        if not file.content_type or file.content_type not in allowed_content_types:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type")
        sniff_mime = _detect_image_mime(content)
        if not sniff_mime or sniff_mime not in allowed_content_types:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type")

    is_svg = sniff_mime == "image/svg+xml"
    if is_svg:
        content = _sanitize_svg(content)

    original_suffix = Path(file.filename or "").suffix.lower()
    safe_name = Path(filename or "").name if filename else ""
    if not safe_name:
        safe_name = f"{uuid.uuid4().hex}{original_suffix or '.bin'}"
    destination = dest_root / safe_name
    destination.write_bytes(content)

    if generate_thumbnails and allowed_content_types and not is_svg:
        _generate_thumbnails(destination)

    rel_path = destination.relative_to(base_root).as_posix()
    return f"/media/{rel_path}", destination.name


def delete_file(filepath: str) -> None:
    if filepath.startswith("/media/"):
        rel = filepath.removeprefix("/media/")
        path = Path(settings.media_root) / rel
    else:
        path = Path(filepath)
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
    if not url.startswith("/media/"):
        raise ValueError("Invalid media URL")

    base_root = Path(settings.media_root).resolve()
    rel = url.removeprefix("/media/")
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
            image_format = img.format
            img.verify()
    except (UnidentifiedImageError, OSError, ValueError):
        return None

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


def _detect_svg_mime(content: bytes) -> str | None:
    head = (content or b"")[:2048].lstrip().lower()
    if not head:
        return None
    # Common SVGs start with "<svg" or with an xml declaration before the <svg> element.
    if head.startswith(b"<svg") or b"<svg" in head:
        return "image/svg+xml"
    return None


def _sanitize_svg(content: bytes) -> bytes:
    raw = content or b""
    if len(raw) > _SVG_MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SVG file too large")

    lowered = raw.lower()
    if b"<!doctype" in lowered or b"<!entity" in lowered:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported SVG content")

    try:
        import xml.etree.ElementTree as ET

        root = ET.fromstring(raw.decode("utf-8", errors="replace"))
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
        sanitized = ET.tostring(root, encoding="utf-8", method="xml")
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid SVG") from exc
    return sanitized
