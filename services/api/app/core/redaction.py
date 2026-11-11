"""Redaction helpers so sensitive values never reach logs or audit metadata."""
from __future__ import annotations

import re
from typing import Any

SENSITIVE_KEYS = {
    "password", "password_hash", "token", "refresh_token", "access_token", "national_id", "passport",
    "phone", "email", "unit_code", "building_code", "storage_key", "authorization",
}
PHONE_RE = re.compile(r"(?<!\d)(?:\+?20|0)?1[0125]\d{8}(?!\d)")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: ("[REDACTED]" if k.lower() in SENSITIVE_KEYS else redact(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    if isinstance(value, str):
        return EMAIL_RE.sub("[email]", PHONE_RE.sub("[phone]", value))
    return value


def contains_contact_details(text: str) -> bool:
    return bool(PHONE_RE.search(text) or EMAIL_RE.search(text))
