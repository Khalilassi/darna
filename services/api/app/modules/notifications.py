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
def list_notifications(limit: int = Query(default=50, le=100), user: User = Depends(current_user), db: Session = Depends(get_db)):
    items = db.scalars(select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(limit)).all()
    unread = db.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))) or 0
    return NotificationList(items=[NotificationOut.model_validate(i) for i in items], unread=unread)


@router.post("/read-all", response_model=Ok)
def read_all(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None)).values(read_at=utcnow()))
    db.commit()
    return Ok()
