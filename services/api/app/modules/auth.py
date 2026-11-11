from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core import rate_limit, totp
from app.core.audit import audit
from app.core.config import get_settings
from app.core.db import get_db, utcnow
from app.core.deps import client_ip, current_user
from app.core.errors import Conflict, Forbidden, RateLimited, Unauthorized, ValidationFailed
from app.core.notify import notify
from app.core.security import (
    DUMMY_HASH,
    create_access_token,
    hash_password,
    new_refresh_token,
    sha256_hex,
    verify_password,
)
from app.models.entities import LoginThrottle, OwnershipClaim, RefreshToken, User, VerificationRequest
from app.models.enums import ClaimStatus, Role, VerificationKind, VerificationStatus
from app.schemas.common import ORM, Ok

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    full_name: str = Field(min_length=2, max_length=120)
    phone: str | None = Field(default=None, pattern=r"^\+?[0-9]{8,15}$")
    locale: str = Field(default="en", pattern="^(en|ar)$")
    attest_not_broker: bool

    @field_validator("password")
    @classmethod
    def strong(cls, v: str) -> str:
        if v.isalpha() or v.isdigit():
            raise ValueError("password must mix letters and numbers or symbols")
        return v


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)
    totp_code: str | None = Field(default=None, max_length=10)


class RefreshIn(BaseModel):
    refresh_token: str = Field(max_length=200)


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class VerificationSummary(BaseModel):
    information_submitted: bool
    identity: str  # none | submitted | under_review | more_info_required | approved | rejected
    approved_ownership_claims: int
    pending_ownership_claims: int


class MeOut(ORM):
    id: uuid.UUID
    email: str
    full_name: str
    phone: str | None
    locale: str
    role: Role
    identity_verified_at: datetime | None
    phone_verified_at: datetime | None
    mfa_enabled_at: datetime | None
    created_at: datetime


class MeDetailOut(MeOut):
    verification: VerificationSummary


class MeUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    phone: str | None = Field(default=None, pattern=r"^\+?[0-9]{8,15}$")
    locale: str | None = Field(default=None, pattern="^(en|ar)$")


def _issue_tokens(db: Session, user: User) -> TokenOut:
    s = get_settings()
    raw, digest = new_refresh_token()
    db.add(RefreshToken(user_id=user.id, token_hash=digest, expires_at=utcnow() + timedelta(days=s.refresh_token_days)))
    return TokenOut(
        access_token=create_access_token(user.id, user.role.value),
        refresh_token=raw,
        expires_in=s.access_token_minutes * 60,
    )


@router.post("/register", response_model=TokenOut, status_code=201, dependencies=[Depends(rate_limit.limit("register", 10, 3600))])
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)) -> TokenOut:
    if not body.attest_not_broker:
        raise ValidationFailed("Brokers and agencies cannot use this platform", code="broker_not_allowed")
    email = body.email.lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise Conflict("Email already registered", code="email_taken")
    user = User(
        email=email, password_hash=hash_password(body.password), full_name=body.full_name.strip(),
        phone=body.phone, locale=body.locale, role=Role.member, not_broker_attested_at=utcnow(),
    )
    db.add(user)
    db.flush()
    audit(db, "user.registered", "user", user.id, actor_id=user.id, ip=client_ip(request))
    out = _issue_tokens(db, user)
    db.commit()
    return out


# Account lockout: after LOCK_AFTER failed attempts within LOCK_WINDOW, sign-in for that email is refused
# for LOCK_DURATION, whatever the password. Counted per email hash for unknown emails too, so the
# behaviour never reveals whether an account exists. The per-IP limiter above still applies.
LOCK_AFTER = 8
LOCK_WINDOW = timedelta(minutes=15)
LOCK_DURATION = timedelta(minutes=15)


def _throttle(db: Session, email: str) -> LoginThrottle:
    key = sha256_hex(email)
    db.execute(pg_insert(LoginThrottle).values(email_hash=key, failures=0, window_started_at=utcnow()).on_conflict_do_nothing())
    row = db.scalar(select(LoginThrottle).where(LoginThrottle.email_hash == key).with_for_update())
    assert row is not None
    return row


def _register_failure(db: Session, row: LoginThrottle, user: User | None, ip: str | None) -> None:
    now = utcnow()
    if now - row.window_started_at > LOCK_WINDOW:
        row.failures, row.window_started_at = 0, now
    row.failures += 1
    if row.failures >= LOCK_AFTER:
        row.locked_until = now + LOCK_DURATION
        row.failures, row.window_started_at = 0, now
        if user is not None:
            audit(db, "user.locked_out", "user", user.id, ip=ip)
            notify(db, user.id, "account_locked")


@router.post("/login", response_model=TokenOut, dependencies=[Depends(rate_limit.limit("login", 20, 300))])
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)) -> TokenOut:
    email = body.email.lower()
    ip = client_ip(request)
    throttle = _throttle(db, email)
    if throttle.locked_until and throttle.locked_until > utcnow():
        db.commit()
        raise RateLimited("Too many failed sign-in attempts. Try again later.", code="too_many_failed_logins",
                          details={"retry_after_seconds": int((throttle.locked_until - utcnow()).total_seconds())})
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        verify_password(body.password, DUMMY_HASH)  # equalize timing
        _register_failure(db, throttle, None, ip)
        db.commit()
        raise Unauthorized("Invalid email or password", code="invalid_credentials")
    if not verify_password(body.password, user.password_hash):
        audit(db, "user.login_failed", "user", user.id, ip=ip)
        _register_failure(db, throttle, user, ip)
        db.commit()
        raise Unauthorized("Invalid email or password", code="invalid_credentials")
    if not user.is_active:
        raise Unauthorized("Account suspended", code="account_suspended")
    if user.mfa_enabled_at is not None:
        if not body.totp_code:
            raise Unauthorized("Two-factor code required", code="mfa_required")
        counter = totp.verify(totp.decrypt_secret(user.totp_secret_encrypted or ""), body.totp_code, user.totp_last_counter)
        if counter is None:
            audit(db, "user.mfa_failed", "user", user.id, ip=ip)
            _register_failure(db, throttle, user, ip)
            db.commit()
            raise Unauthorized("Invalid two-factor code", code="mfa_invalid")
        user.totp_last_counter = counter
    db.delete(throttle)  # successful sign-in resets the counter
    out = _issue_tokens(db, user)
    db.commit()
    return out


@router.post("/refresh", response_model=TokenOut, dependencies=[Depends(rate_limit.limit("refresh", 60, 300))])
def refresh(body: RefreshIn, db: Session = Depends(get_db)) -> TokenOut:
    rt = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == sha256_hex(body.refresh_token)).with_for_update())
    if rt is None or rt.expires_at < utcnow():
        raise Unauthorized("Invalid refresh token", code="invalid_token")
    if rt.revoked_at is not None:
        # Reuse of a rotated token: revoke the whole family for safety.
        for t in db.scalars(select(RefreshToken).where(RefreshToken.user_id == rt.user_id, RefreshToken.revoked_at.is_(None))):
            t.revoked_at = utcnow()
        db.commit()
        raise Unauthorized("Refresh token reuse detected", code="token_reuse")
    user = db.get(User, rt.user_id)
    if user is None or not user.is_active:
        raise Unauthorized("Account unavailable", code="account_unavailable")
    rt.revoked_at = utcnow()
    out = _issue_tokens(db, user)
    db.commit()
    return out


@router.post("/logout", response_model=Ok)
def logout(body: RefreshIn, db: Session = Depends(get_db)) -> Ok:
    rt = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == sha256_hex(body.refresh_token)))
    if rt and rt.revoked_at is None:
        rt.revoked_at = utcnow()
        db.commit()
    return Ok()


def verification_summary(db: Session, user: User) -> VerificationSummary:
    latest = db.scalar(
        select(VerificationRequest)
        .where(VerificationRequest.user_id == user.id, VerificationRequest.kind == VerificationKind.identity)
        .order_by(VerificationRequest.created_at.desc())
    )
    claims = db.scalars(select(OwnershipClaim.status).where(OwnershipClaim.claimant_id == user.id)).all()
    return VerificationSummary(
        information_submitted=latest is not None,
        identity="approved" if user.identity_verified_at else (latest.status.value if latest else "none"),
        approved_ownership_claims=sum(1 for c in claims if c == ClaimStatus.approved),
        pending_ownership_claims=sum(1 for c in claims if c in (ClaimStatus.submitted, ClaimStatus.under_review, ClaimStatus.disputed)),
    )


@router.get("/me", response_model=MeDetailOut, tags=["me"])
def me(user: User = Depends(current_user), db: Session = Depends(get_db)) -> MeDetailOut:
    return MeDetailOut(**MeOut.model_validate(user).model_dump(), verification=verification_summary(db, user))


@router.patch("/me", response_model=MeOut, tags=["me"])
def update_me(body: MeUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> User:
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            if k == "phone" and v != user.phone:
                user.phone_verified_at = None  # a changed number must be verified again
            setattr(user, k, v)
    db.commit()
    return user


_ = VerificationStatus  # re-exported for typing clarity


# --------------------------------------------------------------------------- two-factor authentication
class MfaSetupOut(BaseModel):
    secret: str
    otpauth_uri: str


class MfaCodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^[0-9]{6}$")


class MfaDisableIn(MfaCodeIn):
    password: str = Field(max_length=128)


@router.post("/mfa/setup", response_model=MfaSetupOut, tags=["me"], dependencies=[Depends(rate_limit.limit("mfa", 20, 600))])
def mfa_setup(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Start enrollment. The secret is shown once; MFA turns on only after /mfa/confirm."""
    if user.mfa_enabled_at:
        raise Conflict("Two-factor authentication is already enabled", code="mfa_already_enabled")
    secret = totp.new_secret()
    user.totp_secret_encrypted = totp.encrypt_secret(secret)
    user.totp_last_counter = None
    audit(db, "user.mfa_setup_started", "user", user.id, actor_id=user.id, ip=client_ip(request))
    db.commit()
    return MfaSetupOut(secret=secret, otpauth_uri=totp.provisioning_uri(secret, user.email))


@router.post("/mfa/confirm", response_model=Ok, tags=["me"], dependencies=[Depends(rate_limit.limit("mfa", 20, 600))])
def mfa_confirm(body: MfaCodeIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.mfa_enabled_at or not user.totp_secret_encrypted:
        raise Conflict("Start setup first", code="mfa_not_pending")
    counter = totp.verify(totp.decrypt_secret(user.totp_secret_encrypted), body.code, user.totp_last_counter)
    if counter is None:
        raise ValidationFailed("Invalid code", code="mfa_invalid")
    user.totp_last_counter = counter
    user.mfa_enabled_at = utcnow()
    audit(db, "user.mfa_enabled", "user", user.id, actor_id=user.id, ip=client_ip(request))
    db.commit()
    return Ok()


@router.post("/mfa/disable", response_model=Ok, tags=["me"], dependencies=[Depends(rate_limit.limit("mfa", 20, 600))])
def mfa_disable(body: MfaDisableIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not user.mfa_enabled_at:
        raise Conflict("Two-factor authentication is not enabled", code="mfa_not_enabled")
    if get_settings().require_staff_mfa and user.role != Role.member:
        raise Forbidden("Staff accounts must keep two-factor authentication on", code="mfa_required_for_staff")
    if not verify_password(body.password, user.password_hash):
        raise Unauthorized("Invalid password", code="invalid_credentials")
    counter = totp.verify(totp.decrypt_secret(user.totp_secret_encrypted or ""), body.code, user.totp_last_counter)
    if counter is None:
        raise ValidationFailed("Invalid code", code="mfa_invalid")
    user.mfa_enabled_at = None
    user.totp_secret_encrypted = None
    user.totp_last_counter = None
    audit(db, "user.mfa_disabled", "user", user.id, actor_id=user.id, ip=client_ip(request))
    db.commit()
    return Ok()
