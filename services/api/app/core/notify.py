"""Notifications: persisted in-app notifications plus a push adapter.

``PushSender`` is an interface. The development implementation only logs metadata (no content);
a real Expo/FCM/APNs sender requires credentials and is documented as an external dependency.
"""
from __future__ import annotations

import logging
import uuid
from typing import Protocol

from sqlalchemy.orm import Session

from app.models.entities import Notification

log = logging.getLogger("darna.notify")


class PushSender(Protocol):
    def send(self, user_id: uuid.UUID, type_: str) -> None: ...


class DevLogPushSender:
    def send(self, user_id: uuid.UUID, type_: str) -> None:
        log.info("push(dev-noop) type=%s", type_)


push_sender: PushSender = DevLogPushSender()


def notify(db: Session, user_id: uuid.UUID, type_: str, **data) -> None:
    db.add(Notification(user_id=user_id, type=type_, data={k: str(v) for k, v in data.items()}))
    push_sender.send(user_id, type_)
