from __future__ import annotations

import hashlib
import hmac
import secrets
import time
import uuid
from datetime import timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import get_settings
from app.core.db import utcnow
from app.core.errors import Unauthorized

_ph = PasswordHasher()


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, password)
    except (VerificationError, InvalidHashError):
        return False


# A valid hash used to equalize timing when the account does not exist.
DUMMY_HASH = _ph.hash("timing-equalizer-not-a-real-password")


def create_access_token(user_id: uuid.UUID, role: str, mfa: bool = False) -> str:
    s = get_settings()
    now = utcnow()
    payload = {
        "sub": str(user_id),
        "role": role,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=s.access_token_minutes)).timestamp()),
        "jti": uuid.uuid4().hex,
        # Whether this session was established with a second factor (staff tools require it).
        "mfa": mfa,
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    s = get_settings()
    try:
        payload = jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm], options={"require": ["exp", "sub"]})
    except jwt.PyJWTError as exc:
        raise Unauthorized("Invalid or expired token", code="invalid_token") from exc
    if payload.get("type") != "access":
        raise Unauthorized("Invalid token type", code="invalid_token")
    return payload


def new_refresh_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(48)
    return raw, sha256_hex(raw)


def sha256_hex(value: str | bytes) -> str:
    if isinstance(value, str):
        value = value.encode()
    return hashlib.sha256(value).hexdigest()


# ---- signed, short-lived document access tokens (bound to user + document)
def sign_document_access(document_id: uuid.UUID, user_id: uuid.UUID, mfa: bool = False) -> tuple[str, int]:
    """Short-lived URL token bound to document, user, expiry and whether the issuing session used MFA
    (re-checked at read time, where there is no access token to tell)."""
    s = get_settings()
    exp = int(time.time()) + s.document_url_ttl_seconds
    m = 1 if mfa else 0
    msg = f"{document_id}.{user_id}.{exp}.{m}"
    sig = hmac.new(s.jwt_secret.encode(), msg.encode(), hashlib.sha256).hexdigest()
    return f"{user_id}.{exp}.{m}.{sig}", exp


def verify_document_access(document_id: uuid.UUID, token: str) -> tuple[uuid.UUID, bool]:
    s = get_settings()
    try:
        user_id, exp_s, m, sig = token.split(".")
        exp = int(exp_s)
        uid = uuid.UUID(user_id)
        if m not in ("0", "1"):
            raise ValueError(m)
    except ValueError as exc:
        raise Unauthorized("Malformed document token", code="invalid_document_token") from exc
    expected = hmac.new(s.jwt_secret.encode(), f"{document_id}.{uid}.{exp}.{m}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig) or exp < int(time.time()):
        raise Unauthorized("Invalid or expired document token", code="invalid_document_token")
    return uid, m == "1"
