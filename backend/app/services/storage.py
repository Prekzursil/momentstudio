from pathlib import Path
from typing import Tuple

from fastapi import UploadFile

from app.core.config import settings


def ensure_media_root(root: str | Path | None = None) -> Path:
    path = Path(root or settings.media_root)
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_upload(file: UploadFile, root: str | Path | None = None) -> Tuple[str, str]:
    media_root = ensure_media_root(root)
    destination = media_root / file.filename
    content = file.file.read()
    destination.write_bytes(content)
    return str(destination), destination.name


def delete_file(filepath: str) -> None:
    path = Path(filepath)
    if path.exists():
        path.unlink()
