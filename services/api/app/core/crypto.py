"""Application-level encryption keys (documents, TOTP secrets).

``DARNA_DOCUMENT_ENCRYPTION_KEY`` holds one or more comma-separated Fernet keys. The FIRST key encrypts
new data; every key can decrypt. Rotation procedure (docs/architecture/security.md):

1. Generate a new key and put it first: ``NEW,OLD``. Deploy. New writes use NEW; old data still reads.
2. Run ``python -m app.rotate_keys`` to re-encrypt stored documents and TOTP secrets with NEW.
3. Remove OLD from the list and deploy.
"""
from __future__ import annotations

from functools import lru_cache

from cryptography.fernet import Fernet, MultiFernet


def parse_keys(value: str) -> list[str]:
    keys = [k.strip() for k in value.split(",") if k.strip()]
    if not keys:
        raise ValueError("at least one encryption key is required")
    for k in keys:
        Fernet(k.encode())  # validates format; raises ValueError on a malformed key
    if len(set(keys)) != len(keys):
        raise ValueError("duplicate encryption keys")
    return keys


@lru_cache(maxsize=8)
def multi_fernet(value: str) -> MultiFernet:
    return MultiFernet([Fernet(k.encode()) for k in parse_keys(value)])
