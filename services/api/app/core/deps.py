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
    "services.manage": {Role.admin, Role.support},
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
    user.session_mfa = payload.get("mfa") is True
    return user


def current_user(user: User | None = Depends(current_user_optional)) -> User:
    if user is None:
        raise Unauthorized("Authentication required")
    return user


def staff_mfa_satisfied(user: User) -> bool:
    """With the staff-MFA policy on, the account must have MFA enabled AND this session must have used it:
    a session opened with only a password before enrolment does not gain staff access afterwards."""
    if not get_settings().require_staff_mfa:
        return True
    return user.mfa_enabled_at is not None and user.session_mfa


def has_permission(user: User, permission: str) -> bool:
    """Role grants the permission AND the staff-MFA policy is met. Use this for any role-based check
    outside ``require()`` so the MFA requirement cannot be bypassed."""
    return user.role in PERMISSIONS[permission] and staff_mfa_satisfied(user)


def require(permission: str) -> Callable[..., User]:
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in PERMISSIONS[permission]:
            raise Forbidden(f"Missing permission {permission}", code="missing_permission")
        if not staff_mfa_satisfied(user):
            if user.mfa_enabled_at is None:
                raise Forbidden("Set up two-factor authentication to use staff tools", code="mfa_enrollment_required")
            raise Forbidden("Sign in again with your two-factor code to use staff tools", code="mfa_session_required")
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
