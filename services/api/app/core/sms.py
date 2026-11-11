"""SMS delivery adapter.

``DARNA_SMS_PROVIDER``:
- ``log`` (default): development only. Logs the message so a developer can complete the flow locally;
  outside development, sending is refused (``sms_unavailable``) rather than silently dropped.
- A real provider (e.g. an Egyptian SMS gateway or Twilio) needs credentials and a contract; implement
  ``SmsSender`` and select it here. Not implemented in this repository.
"""
from __future__ import annotations

import logging
from typing import Protocol

from app.core.config import get_settings
from app.core.errors import AppError

log = logging.getLogger("darna.sms")


class SmsUnavailable(AppError):
    status_code = 503
    code = "sms_unavailable"


class SmsSender(Protocol):
    def send(self, phone: str, text: str) -> None: ...


class DevLogSmsSender:
    def send(self, phone: str, text: str) -> None:
        # Development only: the code is logged so the flow can be completed without a provider.
        log.info("sms(dev-log) to=***%s text=%s", phone[-3:], text)


_override: SmsSender | None = None


def set_sender(sender: SmsSender | None) -> None:
    global _override
    _override = sender


def sms_sender() -> SmsSender:
    if _override is not None:
        return _override
    s = get_settings()
    if s.sms_provider == "log":
        if s.env not in ("development", "test"):
            raise SmsUnavailable("Phone verification is not available yet")
        return DevLogSmsSender()
    raise SmsUnavailable(f"Unknown SMS provider '{s.sms_provider}'")
