"""Phone number verification by SMS code."""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.core.audit import audit
from app.core.config import get_settings
from app.core.db import get_db, utcnow
from app.core.deps import client_ip, current_user
from app.core.errors import Conflict, RateLimited, ValidationFailed
from app.core.sms import sms_sender
from app.models.entities import PhoneVerification, User
from app.schemas.common import Ok

router = APIRouter(prefix="/auth/phone", tags=["me"])

CODE_TTL = timedelta(minutes=10)
RESEND_COOLDOWN = timedelta(seconds=60)
MAX_PER_HOUR = 5
MAX_ATTEMPTS = 5
EG_MOBILE = re.compile(r"^\+201[0125]\d{8}$")


def normalize_phone(raw: str) -> str:
    """Egyptian mobile numbers to E.164: 01012345678 / 201012345678 / +20 101 234 5678 -> +201012345678."""
    digits = re.sub(r"[\s\-()]", "", raw)
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    if digits.startswith("0") and len(digits) == 11:
        digits = "+2" + digits
    elif digits.startswith("20") and not digits.startswith("+"):
        digits = "+" + digits
    if not EG_MOBILE.match(digits):
        raise ValueError("enter an Egyptian mobile number, e.g. 010 1234 5678")
    return digits


def _hash(user_id, phone: str, code: str) -> str:
    msg = f"{user_id}:{phone}:{code}".encode()
    return hmac.new(get_settings().jwt_secret.encode(), msg, hashlib.sha256).hexdigest()


class StartIn(BaseModel):
    phone: str = Field(max_length=32)

    @field_validator("phone")
    @classmethod
    def _norm(cls, v: str) -> str:
        return normalize_phone(v)


class StartOut(BaseModel):
    phone: str
    expires_at: datetime
    resend_after_seconds: int


class VerifyIn(BaseModel):
    code: str = Field(pattern=r"^[0-9]{6}$")


@router.post("/start", response_model=StartOut, dependencies=[Depends(rate_limit.limit("phone_start", 10, 3600))])
def start(body: StartIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.phone == body.phone and user.phone_verified_at:
        raise Conflict("This number is already verified on your account", code="phone_already_verified")
    taken = db.scalar(select(User.id).where(User.phone == body.phone, User.phone_verified_at.is_not(None), User.id != user.id))
    if taken:
        raise Conflict("This number is verified on another account", code="phone_in_use")
    now = utcnow()
    recent = db.scalars(select(PhoneVerification).where(PhoneVerification.user_id == user.id,
                                                        PhoneVerification.created_at > now - timedelta(hours=1))
                        .order_by(PhoneVerification.created_at.desc())).all()
    if recent and recent[0].created_at > now - RESEND_COOLDOWN:
        wait = int((recent[0].created_at + RESEND_COOLDOWN - now).total_seconds()) + 1
        raise RateLimited("Please wait before requesting another code", code="sms_cooldown", details={"retry_after_seconds": wait})
    if len(recent) >= MAX_PER_HOUR:
        raise RateLimited("Too many codes requested. Try again later.", code="sms_hourly_limit", details={"retry_after_seconds": 3600})
    sender = sms_sender()  # raises sms_unavailable before anything is stored if no provider is configured
    code = f"{secrets.randbelow(10**6):06d}"
    pv = PhoneVerification(user_id=user.id, phone=body.phone, code_hash=_hash(user.id, body.phone, code), expires_at=now + CODE_TTL)
    db.add(pv)
    audit(db, "phone.code_sent", "user", user.id, actor_id=user.id, ip=client_ip(request))
    db.commit()
    sender.send(body.phone, f"Darna code: {code}. It expires in 10 minutes. Never share it. / رمز دارنا: {code}")
    return StartOut(phone=body.phone, expires_at=pv.expires_at, resend_after_seconds=int(RESEND_COOLDOWN.total_seconds()))


@router.post("/verify", response_model=Ok, dependencies=[Depends(rate_limit.limit("phone_verify", 30, 3600))])
def verify(body: VerifyIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    pv = db.scalar(select(PhoneVerification).where(PhoneVerification.user_id == user.id, PhoneVerification.verified_at.is_(None))
                   .order_by(PhoneVerification.created_at.desc()).limit(1).with_for_update())
    if pv is None or pv.expires_at < utcnow():
        raise ValidationFailed("The code has expired. Request a new one.", code="code_expired")
    if pv.attempts >= MAX_ATTEMPTS:
        raise ValidationFailed("Too many wrong codes. Request a new one.", code="code_attempts_exceeded")
    pv.attempts += 1
    if not hmac.compare_digest(pv.code_hash, _hash(user.id, pv.phone, body.code)):
        db.commit()
        raise ValidationFailed("That code is not correct", code="code_invalid",
                               details={"attempts_left": MAX_ATTEMPTS - pv.attempts})
    pv.verified_at = utcnow()
    user.phone = pv.phone
    user.phone_verified_at = utcnow()
    audit(db, "phone.verified", "user", user.id, actor_id=user.id, ip=client_ip(request))
    try:
        db.commit()
    except IntegrityError as exc:  # verified on another account in the meantime
        db.rollback()
        raise Conflict("This number is verified on another account", code="phone_in_use") from exc
    return Ok()


