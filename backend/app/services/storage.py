import logging
import uuid
from io import BytesIO
from pathlib import Path
from typing import Tuple

from PIL import Image, UnidentifiedImageError
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings

logger = logging.getLogger(__name__)


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

    if allowed_content_types:
        if not file.content_type or file.content_type not in allowed_content_types:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type")
        sniff_mime = _detect_image_mime(content)
        if not sniff_mime or sniff_mime not in allowed_content_types:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type")

    original_suffix = Path(file.filename or "").suffix.lower()
    safe_name = Path(filename or "").name if filename else ""
    if not safe_name:
        safe_name = f"{uuid.uuid4().hex}{original_suffix or '.bin'}"
    destination = dest_root / safe_name
    destination.write_bytes(content)

    if generate_thumbnails and allowed_content_types:
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
