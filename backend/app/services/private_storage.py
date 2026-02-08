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
    max_bytes: int | None = 10 * 1024 * 1024,
) -> tuple[str, str]:
    private_root = Path(root or settings.private_media_root).resolve()
    private_root.mkdir(parents=True, exist_ok=True)

    dest_dir = (private_root / subdir).resolve()
    try:
        dest_dir.relative_to(private_root)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid upload destination")
    dest_dir.mkdir(parents=True, exist_ok=True)

    original_name = Path(file.filename or "").name or "shipping-label"
    original_suffix = Path(original_name).suffix.lower() or ".bin"
    temp_name = f"{uuid.uuid4().hex}{original_suffix}"
    destination = dest_dir / temp_name

    def _cleanup(path: Path) -> None:
        try:
            if path.exists():
                path.unlink()
        except Exception:  # pragma: no cover
            logger.warning("private_upload_cleanup_failed", extra={"path": str(path)})

    def _stream_copy(dest: Path) -> int:
        chunk_size = 1024 * 1024
        written = 0
        with dest.open("wb") as out:
            while True:
                chunk = file.file.read(chunk_size)
                if not chunk:
                    break
                written += len(chunk)
                if max_bytes is not None and written > max_bytes:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large")
                out.write(chunk)
        return written

    try:
        _stream_copy(destination)

        if not file.content_type or file.content_type not in allowed_content_types:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type")

        sniff = _detect_mime_path(destination)
        if not sniff or sniff not in allowed_content_types:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type")

        suffix = _suffix_for_mime(sniff, original_name)
        final_path = destination
        if suffix and destination.suffix.lower() != suffix.lower():
            final_path = destination.with_name(f"{destination.stem}{suffix}")
            destination.rename(final_path)

        rel_path = final_path.relative_to(private_root).as_posix()
        return rel_path, original_name
    except HTTPException:
        _cleanup(destination)
        raise
    except Exception as exc:
        _cleanup(destination)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload failed") from exc


def save_private_bytes(
    content: bytes,
    *,
    subdir: str,
    filename: str,
    root: str | Path | None = None,
) -> str:
    private_root = Path(root or settings.private_media_root).resolve()
    private_root.mkdir(parents=True, exist_ok=True)

    dest_dir = (private_root / subdir).resolve()
    try:
        dest_dir.relative_to(private_root)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid upload destination")
    dest_dir.mkdir(parents=True, exist_ok=True)

    safe_name = Path(filename).name
    destination = (dest_dir / safe_name).resolve()
    try:
        destination.relative_to(dest_dir)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid upload destination")
    destination.write_bytes(content)
    return destination.relative_to(private_root).as_posix()


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


def _detect_mime_path(path: Path) -> str | None:
    try:
        with path.open("rb") as fp:
            head = fp.read(2048)
    except OSError:
        return None
    if head.startswith(b"%PDF"):
        return "application/pdf"

    try:
        with Image.open(path) as img:
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
