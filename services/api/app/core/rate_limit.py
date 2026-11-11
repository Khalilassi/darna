"""In-process sliding-window rate limiter.

Adequate for a single API instance. For multiple instances replace ``_store`` with Redis
(see docs/architecture/security.md) — the dependency interface stays the same.

Memory is bounded by the set of keys active within the longest window: every ``SWEEP_EVERY``
calls, keys whose newest hit is older than their window are evicted.
"""
from __future__ import annotations

import threading
import time
from collections import deque

from fastapi import Request

from app.core.config import get_settings
from app.core.errors import RateLimited

SWEEP_EVERY = 1000

_store: dict[str, deque[float]] = {}
_windows: dict[str, int] = {}
_lock = threading.Lock()
_calls = 0


def reset() -> None:
    global _calls
    with _lock:
        _store.clear()
        _windows.clear()
        _calls = 0


def size() -> int:
    with _lock:
        return len(_store)


def _sweep(now: float) -> None:
    for key in [k for k, q in _store.items() if not q or q[-1] <= now - _windows.get(k, 0)]:
        _store.pop(key, None)
        _windows.pop(key, None)


def hit(key: str, max_calls: int, per_seconds: int, now: float | None = None) -> bool:
    """Record a call; return False when the limit is exceeded."""
    global _calls
    now = time.monotonic() if now is None else now
    with _lock:
        _calls += 1
        if _calls % SWEEP_EVERY == 0:
            _sweep(now)
        q = _store.setdefault(key, deque())
        _windows[key] = per_seconds
        while q and q[0] <= now - per_seconds:
            q.popleft()
        if len(q) >= max_calls:
            return False
        q.append(now)
        return True


def limit(scope: str, max_calls: int, per_seconds: int):
    def dependency(request: Request) -> None:
        if not get_settings().rate_limit_enabled:
            return
        ip = request.client.host if request.client else "unknown"
        if not hit(f"{scope}:{ip}", max_calls, per_seconds):
            raise RateLimited("Too many requests, try again later", details={"retry_after_seconds": per_seconds})

    return dependency
