"""One-time codes that let a staff member enrol two-factor authentication.

With the staff-MFA policy on, knowing a staff account's password is not enough to bind an
authenticator: an admin (in an MFA session) or an operator with server access (CLI) issues a code
and gives it to the person out of band. Only a hash is stored; the code works until it expires or
MFA is confirmed.
"""
from __future__ import annotations

import hmac
import secrets
from datetime import datetime, timedelta

from app.core.db import utcnow
from app.core.security import sha256_hex
from app.models.entities import User

CODE_TTL = timedelta(hours=24)
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I


def issue(user: User, now: datetime | None = None) -> tuple[str, datetime]:
    raw = "".join(secrets.choice(_ALPHABET) for _ in range(12))
    code = "-".join(raw[i:i + 4] for i in range(0, 12, 4))
    user.mfa_enrollment_code_hash = sha256_hex(_normalize(code))
    user.mfa_enrollment_expires_at = (now or utcnow()) + CODE_TTL
    return code, user.mfa_enrollment_expires_at


def check(user: User, code: str | None, now: datetime | None = None) -> bool:
    if not code or not user.mfa_enrollment_code_hash or not user.mfa_enrollment_expires_at:
        return False
    if user.mfa_enrollment_expires_at < (now or utcnow()):
        return False
    return hmac.compare_digest(sha256_hex(_normalize(code)), user.mfa_enrollment_code_hash)


def clear(user: User) -> None:
    user.mfa_enrollment_code_hash = None
    user.mfa_enrollment_expires_at = None


def _normalize(code: str) -> str:
    return code.replace("-", "").replace(" ", "").upper()
