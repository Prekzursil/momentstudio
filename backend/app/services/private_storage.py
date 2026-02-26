import logging
import uuid
from io import BytesIO
from pathlib import Path

from PIL import Image
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings

logger = logging.getLogger(__name__)

_CHUNK_SIZE = 1024 * 1024
_DEFAULT_ADMIN_UPLOAD_CEILING = 512 * 1024 * 1024
_MIME_SUFFIX_RULES: dict[str, tuple[str, frozenset[str]]] = {
    "application/pdf": (".pdf", frozenset()),
    "image/png": (".png", frozenset({".png"})),
    "image/jpeg": (".jpg", frozenset({".jpg", ".jpeg"})),
    "image/webp": (".webp", frozenset({".webp"})),
}


def _effective_max_bytes(max_bytes: int | None) -> int:
    if max_bytes is not None:
        return int(max_bytes)
    admin_ceiling = int(getattr(settings, "admin_upload_max_bytes", 0) or 0)
    return admin_ceiling if admin_ceiling > 0 else _DEFAULT_ADMIN_UPLOAD_CEILING


def _cleanup_upload(path: Path) -> None:
    try:
        if path.exists():
            path.unlink()
    except Exception:  # pragma: no cover
        logger.warning("private_upload_cleanup_failed", extra={"path": str(path)})


def _stream_copy(file: UploadFile, dest: Path, *, max_bytes: int) -> int:
    written = 0
    with dest.open("wb") as out:
        while True:
            chunk = file.file.read(_CHUNK_SIZE)
            if not chunk:
                break
            written += len(chunk)
            if written > max_bytes:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large")
            out.write(chunk)
    return written


def _validate_content_type(content_type: str | None, allowed_content_types: tuple[str, ...]) -> None:
    if not content_type or content_type not in allowed_content_types:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type")


def _detect_allowed_mime(path: Path, allowed_content_types: tuple[str, ...]) -> str:
    sniff = _detect_mime_path(path)
    if not sniff or sniff not in allowed_content_types:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type")
    return sniff


def _resolve_private_subdir(private_root: Path, subdir: str) -> Path:
    dest_dir = (private_root / subdir).resolve()
    try:
        dest_dir.relative_to(private_root)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid upload destination")
    dest_dir.mkdir(parents=True, exist_ok=True)
    return dest_dir


def _private_upload_identity(file: UploadFile) -> tuple[str, str]:
    original_name = Path(file.filename or "").name or "shipping-label"
    original_suffix = Path(original_name).suffix.lower() or ".bin"
    return original_name, original_suffix


def _target_upload_path(destination: Path, suffix: str) -> Path:
    if not suffix or destination.suffix.lower() == suffix.lower():
        return destination
    return destination.with_name(f"{destination.stem}{suffix}")


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
    dest_dir = _resolve_private_subdir(private_root, subdir)

    effective_max_bytes = _effective_max_bytes(max_bytes)
    original_name, original_suffix = _private_upload_identity(file)
    temp_name = f"{uuid.uuid4().hex}{original_suffix}"
    destination = dest_dir / temp_name
    final_path = destination

    try:
        _stream_copy(file, destination, max_bytes=effective_max_bytes)

        _validate_content_type(file.content_type, allowed_content_types)
        sniff = _detect_allowed_mime(destination, allowed_content_types)
        suffix = _suffix_for_mime(sniff, original_name)
        final_path = _target_upload_path(destination, suffix)
        if final_path != destination:
            destination.rename(final_path)

        rel_path = final_path.relative_to(private_root).as_posix()
        return rel_path, original_name
    except HTTPException:
        _cleanup_upload(final_path)
        raise
    except Exception as exc:
        _cleanup_upload(final_path)
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
    dest_dir = _resolve_private_subdir(private_root, subdir)

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
    cleaned = str(rel_path or "").strip()
    if not cleaned or cleaned.startswith(("/", "\\")) or "\\" in cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file path")

    candidate = (private_root / cleaned).resolve()
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
    except (OSError, ValueError):
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
    except (OSError, ValueError):
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
    default_suffix, accepted_original_suffixes = _MIME_SUFFIX_RULES.get(
        mime,
        (original_suffix or ".bin", frozenset()),
    )
    if original_suffix in accepted_original_suffixes:
        return original_suffix
    return default_suffix
