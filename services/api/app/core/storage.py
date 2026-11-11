"""Storage adapters.

- Private documents: encrypted at rest with Fernet (AES-128-CBC + HMAC) before touching disk.
  ``LocalEncryptedStorage`` is the development implementation; production should use an
  object store with server-side encryption *in addition* (adapter interface: ``PrivateStorage``).
- Public listing photos: re-encoded with Pillow (drops EXIF/GPS metadata) and served under /media.
"""
from __future__ import annotations

import io
import secrets
from pathlib import Path
from typing import Protocol

from cryptography.fernet import Fernet
from PIL import Image, UnidentifiedImageError

from app.core.config import get_settings
from app.core.errors import ValidationFailed

ALLOWED_DOC_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
MAGIC = {
    b"%PDF": "application/pdf",
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG": "image/png",
    b"RIFF": "image/webp",
}


def sniff_type(data: bytes) -> str | None:
    for magic, ctype in MAGIC.items():
        if data.startswith(magic):
            return ctype
    return None


class PrivateStorage(Protocol):
    def put(self, data: bytes) -> str: ...
    def get(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...


class LocalEncryptedStorage:
    def __init__(self, root: Path, key: str):
        self.root = root / "private"
        self.root.mkdir(parents=True, exist_ok=True)
        self.fernet = Fernet(key.encode())

    def _path(self, key: str) -> Path:
        if not key.isalnum():
            raise ValueError("invalid storage key")
        return self.root / key

    def put(self, data: bytes) -> str:
        key = secrets.token_hex(24)
        self._path(key).write_bytes(self.fernet.encrypt(data))
        return key

    def get(self, key: str) -> bytes:
        return self.fernet.decrypt(self._path(key).read_bytes())

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class PublicMediaStorage:
    def __init__(self, root: Path):
        self.root = root / "public"
        self.root.mkdir(parents=True, exist_ok=True)

    def put_image(self, data: bytes, max_side: int = 2048) -> tuple[str, int, int]:
        try:
            img = Image.open(io.BytesIO(data))
            img.verify()
            img = Image.open(io.BytesIO(data))
        except (UnidentifiedImageError, OSError) as exc:
            raise ValidationFailed("Unsupported or corrupt image", code="invalid_image") from exc
        if img.format not in {"JPEG", "PNG", "WEBP"}:
            raise ValidationFailed("Only JPEG, PNG or WEBP images are accepted", code="invalid_image")
        img = img.convert("RGB")
        img.thumbnail((max_side, max_side))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=85, optimize=True)  # fresh encode -> no EXIF/GPS
        key = f"{secrets.token_hex(16)}.jpg"
        (self.root / key).write_bytes(out.getvalue())
        return key, img.width, img.height

    def delete(self, key: str) -> None:
        (self.root / Path(key).name).unlink(missing_ok=True)

    def url(self, key: str) -> str:
        return f"{get_settings().public_base_url}/media/{key}"


_private: LocalEncryptedStorage | None = None
_public: PublicMediaStorage | None = None


def private_storage() -> LocalEncryptedStorage:
    global _private
    if _private is None:
        s = get_settings()
        _private = LocalEncryptedStorage(s.storage_dir, s.document_encryption_key)
    return _private


def public_storage() -> PublicMediaStorage:
    global _public
    if _public is None:
        _public = PublicMediaStorage(get_settings().storage_dir)
    return _public
