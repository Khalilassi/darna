from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.db import get_db, utcnow
from app.core.deps import current_user
from app.models.entities import Notification, User
from app.schemas.common import ORM, Ok

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationOut(ORM):
    id: uuid.UUID
    type: str
    data: dict
    read_at: datetime | None
    created_at: datetime


class NotificationList(BaseModel):
    items: list[NotificationOut]
    unread: int


@router.get("", response_model=NotificationList)
def list_notifications(limit: int = Query(default=50, ge=1, le=100), user: User = Depends(current_user), db: Session = Depends(get_db)):
    items = db.scalars(select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(limit)).all()
    unread = db.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))) or 0
    return NotificationList(items=[NotificationOut.model_validate(i) for i in items], unread=unread)


@router.post("/read-all", response_model=Ok)
def read_all(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None)).values(read_at=utcnow()))
    db.commit()
    return Ok()


# --------------------------------------------------------------------------- push devices & preferences
from typing import Literal  # noqa: E402

from pydantic import Field  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402

from app.core.notify import CATEGORIES, default_prefs  # noqa: E402
from app.models.entities import DeviceToken  # noqa: E402


class DeviceIn(BaseModel):
    # Expo push tokens look like ExponentPushToken[xxxxxxxx]
    token: str = Field(min_length=10, max_length=200, pattern=r"^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_\-]+\]$")
    platform: Literal["ios", "android"]


class PrefsOut(BaseModel):
    push: dict[str, bool]


class PrefsIn(BaseModel):
    push: dict[str, bool]


@router.post("/devices", response_model=Ok)
def register_device(body: DeviceIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Idempotent. A token moves to the latest user who registers it (shared/reinstalled devices)."""
    existing = db.scalar(select(DeviceToken).where(DeviceToken.token == body.token).with_for_update())
    if existing:
        existing.user_id = user.id
        existing.platform = body.platform
        existing.last_seen_at = utcnow()
    else:
        db.add(DeviceToken(user_id=user.id, token=body.token, platform=body.platform))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
    return Ok()


@router.delete("/devices", response_model=Ok)
def unregister_device(token: str = Query(max_length=200), user: User = Depends(current_user), db: Session = Depends(get_db)):
    dev = db.scalar(select(DeviceToken).where(DeviceToken.token == token, DeviceToken.user_id == user.id))
    if dev:
        db.delete(dev)
        db.commit()
    return Ok()


def _merged(user: User) -> dict:
    prefs = default_prefs()
    prefs["push"].update({k: v for k, v in (user.notification_prefs or {}).get("push", {}).items() if k in CATEGORIES})
    return prefs


@router.get("/preferences", response_model=PrefsOut)
def get_prefs(user: User = Depends(current_user)):
    return _merged(user)


@router.put("/preferences", response_model=PrefsOut)
def set_prefs(body: PrefsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    unknown = set(body.push) - set(CATEGORIES)
    if unknown:
        from app.core.errors import ValidationFailed

        raise ValidationFailed(f"Unknown categories: {sorted(unknown)}", code="unknown_notification_category")
    merged = _merged(user)
    merged["push"].update(body.push)
    user.notification_prefs = merged
    db.commit()
    return merged
