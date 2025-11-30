from pathlib import Path
from typing import Tuple

from fastapi import HTTPException, UploadFile, status

from app.core.config import settings


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
) -> Tuple[str, str]:
    if allowed_content_types and (not file.content_type or file.content_type not in allowed_content_types):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type")

    media_root = ensure_media_root(root)
    dest_name = filename or file.filename or "upload"
    destination = media_root / dest_name
    content = file.file.read()
    if max_bytes and len(content) > max_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large")
    destination.write_bytes(content)
    return str(destination), destination.name


def delete_file(filepath: str) -> None:
    path = Path(filepath)
    if path.exists():
        path.unlink()
