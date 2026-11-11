"""In-process sliding-window rate limiter.

Adequate for a single API instance. For multiple instances replace ``_store`` with Redis
(see docs/architecture/security.md) — the dependency interface stays the same.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from app.core.config import get_settings
from app.core.errors import RateLimited

_store: dict[str, deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def reset() -> None:
    with _lock:
        _store.clear()


def limit(scope: str, max_calls: int, per_seconds: int):
    def dependency(request: Request) -> None:
        if not get_settings().rate_limit_enabled:
            return
        ip = request.client.host if request.client else "unknown"
        key = f"{scope}:{ip}"
        now = time.monotonic()
        with _lock:
            q = _store[key]
            while q and q[0] <= now - per_seconds:
                q.popleft()
            if len(q) >= max_calls:
                raise RateLimited("Too many requests, try again later", details={"retry_after_seconds": per_seconds})
            q.append(now)

    return dependency
