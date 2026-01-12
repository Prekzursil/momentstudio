import logging
import uuid
from io import BytesIO
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings

logger = logging.getLogger(__name__)


def ensure_private_root(root: str | Path | None = None) -> Path:
    path = Path(root or settings.private_media_root)
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_private_upload(
    file: UploadFile,
    *,
    subdir: str,
    root: str | Path | None = None,
    allowed_content_types: tuple[str, ...] = ("application/pdf", "image/png", "image/jpeg", "image/webp"),
    max_bytes: int = 10 * 1024 * 1024,
) -> tuple[str, str]:
    private_root = Path(root or settings.private_media_root).resolve()
    private_root.mkdir(parents=True, exist_ok=True)

    dest_dir = (private_root / subdir).resolve()
    try:
        dest_dir.relative_to(private_root)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid upload destination")
    dest_dir.mkdir(parents=True, exist_ok=True)

    content = file.file.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large")

    if not file.content_type or file.content_type not in allowed_content_types:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type")

    sniff = _detect_mime(content)
    if not sniff or sniff not in allowed_content_types:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type")

    original_name = Path(file.filename or "").name or "shipping-label"
    suffix = _suffix_for_mime(sniff, original_name)
    filename = f"{uuid.uuid4().hex}{suffix}"
    destination = dest_dir / filename
    destination.write_bytes(content)

    rel_path = destination.relative_to(private_root).as_posix()
    return rel_path, original_name


def resolve_private_path(rel_path: str, *, root: str | Path | None = None) -> Path:
    private_root = Path(root or settings.private_media_root).resolve()
    private_root.mkdir(parents=True, exist_ok=True)
    candidate = (private_root / rel_path).resolve()
    try:
        candidate.relative_to(private_root)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file path")
    return candidate


def delete_private_file(rel_path: str, *, root: str | Path | None = None) -> None:
    path = resolve_private_path(rel_path, root=root)
    if path.exists():
        try:
            path.unlink()
        except Exception as exc:  # pragma: no cover
            logger.warning("private_file_delete_failed", extra={"path": str(path), "error": str(exc)})


def _detect_mime(content: bytes) -> str | None:
    # PDF magic header
    if content.startswith(b"%PDF"):
        return "application/pdf"
    return _detect_image_mime(content)


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
    return None


def _suffix_for_mime(mime: str, original_name: str) -> str:
    original_suffix = Path(original_name).suffix.lower()
    if mime == "application/pdf":
        return ".pdf"
    if mime == "image/png":
        return original_suffix if original_suffix == ".png" else ".png"
    if mime == "image/jpeg":
        return original_suffix if original_suffix in {".jpg", ".jpeg"} else ".jpg"
    if mime == "image/webp":
        return original_suffix if original_suffix == ".webp" else ".webp"
    return original_suffix or ".bin"

