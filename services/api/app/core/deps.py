from __future__ import annotations

import uuid
from collections.abc import Callable

from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import Forbidden, Unauthorized
from app.core.security import decode_access_token
from app.models.entities import User
from app.models.enums import Role

bearer = HTTPBearer(auto_error=False)

STAFF_ROLES = {Role.admin, Role.reviewer, Role.support}

# Permission matrix for staff roles.
PERMISSIONS: dict[str, set[Role]] = {
    "verification.review": {Role.admin, Role.reviewer},
    "listing.moderate": {Role.admin, Role.reviewer},
    "dispute.resolve": {Role.admin},
    "user.manage": {Role.admin},
    "support.handle": {Role.admin, Role.support},
    "audit.read": {Role.admin},
    "analytics.read": {Role.admin, Role.reviewer, Role.support},
    "deal.monitor": {Role.admin, Role.support},
    "document.review": {Role.admin, Role.reviewer},
}


def current_user_optional(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)
) -> User | None:
    if creds is None:
        return None
    payload = decode_access_token(creds.credentials)
    user = db.get(User, uuid.UUID(payload["sub"]))
    if user is None or not user.is_active:
        raise Unauthorized("Account unavailable", code="account_unavailable")
    return user


def current_user(user: User | None = Depends(current_user_optional)) -> User:
    if user is None:
        raise Unauthorized("Authentication required")
    return user


def require(permission: str) -> Callable[..., User]:
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in PERMISSIONS[permission]:
            raise Forbidden(f"Missing permission {permission}", code="missing_permission")
        if get_settings().require_staff_mfa and user.mfa_enabled_at is None:
            raise Forbidden("Set up two-factor authentication to use staff tools", code="mfa_enrollment_required")
        return user

    return dep


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def idempotency_key(idempotency_key: str | None = Header(default=None, max_length=80)) -> str | None:
    return idempotency_key


def request_lang(request: Request) -> str:
    """'ar' when the client prefers Arabic (Accept-Language), else 'en'."""
    header = (request.headers.get("accept-language") or "").strip().lower()
    return "ar" if header.startswith("ar") else "en"
