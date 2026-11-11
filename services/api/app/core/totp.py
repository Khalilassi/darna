"""RFC 6238 TOTP (SHA-1, 30 s, 6 digits) — compatible with common authenticator apps."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

from cryptography.fernet import Fernet

from app.core.config import get_settings

STEP = 30
DIGITS = 6


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _key(secret: str) -> bytes:
    return base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)


def code_at(secret: str, counter: int) -> str:
    digest = hmac.new(_key(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10**DIGITS).zfill(DIGITS)


def verify(secret: str, code: str, last_counter: int | None, now: float | None = None, window: int = 1) -> int | None:
    """Return the matched counter, or None. Rejects reuse of a counter at or before ``last_counter``."""
    if not code.isdigit() or len(code) != DIGITS:
        return None
    current = int((now if now is not None else time.time()) // STEP)
    for c in range(current - window, current + window + 1):
        if last_counter is not None and c <= last_counter:
            continue
        if hmac.compare_digest(code_at(secret, c), code):
            return c
    return None


def provisioning_uri(secret: str, account: str) -> str:
    issuer = get_settings().app_name
    return f"otpauth://totp/{quote(issuer)}:{quote(account)}?secret={secret}&issuer={quote(issuer)}&digits={DIGITS}&period={STEP}"


def _fernet() -> Fernet:
    return Fernet(get_settings().document_encryption_key.encode())


def encrypt_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def decrypt_secret(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()
