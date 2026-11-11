"""Notifications: persisted in-app notifications plus optional push delivery.

``notify()`` writes a Notification row in the caller's transaction and queues a push. Pushes are
dispatched only AFTER the transaction commits (a rolled-back action never notifies anyone), on a
background thread so requests are not slowed by the push provider.

Push content is deliberately generic (no names, amounts or addresses): lock screens are not private.

Providers (``DARNA_PUSH_PROVIDER``):
- ``log`` (default): logs the notification type only. No external calls.
- ``expo``: Expo Push API (https://exp.host). Optional ``DARNA_EXPO_ACCESS_TOKEN``.
"""
from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Protocol

import httpx
from sqlalchemy import delete, event, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import DeviceToken, Notification, User

log = logging.getLogger("darna.notify")

CATEGORIES = ("messages", "offers", "deals", "viewings", "verification", "listings", "alerts", "support")


def category_of(type_: str) -> str:
    if type_.startswith("new_message"):
        return "messages"
    if type_.startswith("offer_"):
        return "offers"
    if type_.startswith(("deal_", "milestone_", "checklist_", "listing_under_offer")):
        return "deals"
    if type_.startswith("viewing_"):
        return "viewings"
    if type_.startswith(("verification_", "ownership_", "account_")):
        return "verification"
    if type_.startswith("listing_"):
        return "listings"
    if type_.startswith("saved_search_"):
        return "alerts"
    return "support"


def default_prefs() -> dict:
    return {"push": {c: True for c in CATEGORIES}}


def push_enabled(user: User, type_: str) -> bool:
    prefs = (user.notification_prefs or {}).get("push", {})
    return bool(prefs.get(category_of(type_), True))


# Generic, privacy-safe copy per category.
COPY = {
    "en": {
        "messages": ("New message", "You have a new message about a home."),
        "offers": ("Offer update", "There is an update on an offer."),
        "deals": ("Deal update", "Your transaction workspace has a new update."),
        "viewings": ("Viewing update", "A viewing request was updated."),
        "verification": ("Verification update", "There is an update on your verification."),
        "listings": ("Listing update", "There is an update on your listing."),
        "alerts": ("New homes for you", "New listings match one of your saved searches."),
        "support": ("Darna", "You have a new update."),
    },
    "ar": {
        "messages": ("رسالة جديدة", "لديك رسالة جديدة بخصوص عقار."),
        "offers": ("تحديث على عرض", "يوجد تحديث على أحد العروض."),
        "deals": ("تحديث على الصفقة", "يوجد تحديث جديد في مساحة الصفقة."),
        "viewings": ("تحديث على المعاينة", "تم تحديث طلب معاينة."),
        "verification": ("تحديث التوثيق", "يوجد تحديث على طلب التوثيق."),
        "listings": ("تحديث على الإعلان", "يوجد تحديث على إعلانك."),
        "alerts": ("منازل جديدة لك", "إعلانات جديدة تطابق أحد عمليات البحث المحفوظة."),
        "support": ("دارنا", "لديك تحديث جديد."),
    },
}


@dataclass(frozen=True)
class PushMessage:
    token: str
    title: str
    body: str
    data: dict


class PushSender(Protocol):
    def send(self, messages: list[PushMessage]) -> list[str]:
        """Send messages; return tokens the provider reports as no longer registered."""
        ...


class LogPushSender:
    def send(self, messages: list[PushMessage]) -> list[str]:
        for m in messages:
            log.info("push(log-only) type=%s", m.data.get("type"))
        return []


class ExpoPushSender:
    URL = "https://exp.host/--/api/v2/push/send"

    def __init__(self, access_token: str | None = None, client: httpx.Client | None = None):
        self.access_token = access_token
        self.client = client or httpx.Client(timeout=10)

    def send(self, messages: list[PushMessage]) -> list[str]:
        dead: list[str] = []
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"
        for i in range(0, len(messages), 100):  # Expo accepts up to 100 messages per request
            batch = messages[i : i + 100]
            payload = [{"to": m.token, "title": m.title, "body": m.body, "data": m.data, "sound": "default"} for m in batch]
            resp = self.client.post(self.URL, json=payload, headers=headers)
            resp.raise_for_status()
            for m, ticket in zip(batch, resp.json().get("data", []), strict=False):
                if ticket.get("status") == "error" and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                    dead.append(m.token)
        return dead


def _make_sender() -> PushSender:
    s = get_settings()
    if s.push_provider == "expo":
        return ExpoPushSender(s.expo_access_token)
    return LogPushSender()


_sender: PushSender | None = None
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="push")
# Tests replace this with an inline runner.
run_async: Callable[[Callable[[], None]], None] = lambda fn: _executor.submit(fn)  # noqa: E731


def sender() -> PushSender:
    global _sender
    if _sender is None:
        _sender = _make_sender()
    return _sender


def set_sender(s: PushSender | None) -> None:
    global _sender
    _sender = s


def deliver(items: list[tuple[uuid.UUID, str, dict]]) -> None:
    """Build and send pushes in a fresh session (called after the originating commit)."""
    from app.core.db import session_factory

    db = session_factory()()
    try:
        messages: list[PushMessage] = []
        for user_id, type_, data in items:
            user = db.get(User, user_id)
            if user is None or not user.is_active or not push_enabled(user, type_):
                continue
            title, body = COPY.get(user.locale, COPY["en"])[category_of(type_)]
            # Only opaque ids travel in data, for deep links inside the authenticated app.
            safe = {k: v for k, v in data.items() if k.endswith("_id")}
            for t in db.scalars(select(DeviceToken.token).where(DeviceToken.user_id == user_id)):
                messages.append(PushMessage(token=t, title=title, body=body, data={"type": type_, **safe}))
        if not messages:
            return
        dead = sender().send(messages)
        if dead:
            db.execute(delete(DeviceToken).where(DeviceToken.token.in_(dead)))
            db.commit()
    except Exception:
        log.exception("push delivery failed")
    finally:
        db.close()


def notify(db: Session, user_id: uuid.UUID, type_: str, **data) -> None:
    payload = {k: str(v) for k, v in data.items()}
    db.add(Notification(user_id=user_id, type=type_, data=payload))
    db.info.setdefault("pending_push", []).append((user_id, type_, payload))


@event.listens_for(Session, "after_commit")
def _after_commit(session: Session) -> None:
    items = session.info.pop("pending_push", None)
    if items:
        run_async(lambda: deliver(items))


@event.listens_for(Session, "after_rollback")
def _after_rollback(session: Session) -> None:
    session.info.pop("pending_push", None)
