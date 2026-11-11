"""Sliding-window rate limiter.

``DARNA_RATE_LIMIT_BACKEND``:
- ``memory`` (default): per process. Correct for a single API instance. Memory is bounded: every
  ``SWEEP_EVERY`` calls, keys whose newest hit is older than their window are evicted.
- ``redis``: shared by all instances via ``DARNA_REDIS_URL``. Each check is one atomic Lua script over a
  sorted set, so concurrent requests cannot both slip under the limit. If Redis is unreachable the request
  is allowed and a warning logged (account lockout, which protects sign-in, is enforced in PostgreSQL).
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
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


log = logging.getLogger("darna.ratelimit")

# KEYS[1]=key ARGV: now_ms, window_ms, max_calls, member. Returns 1 when allowed, 0 when limited.
_LUA = """
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, tonumber(ARGV[1]) - tonumber(ARGV[2]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
"""


class RedisLimiter:
    def __init__(self, client):
        self.client = client
        self.script = client.register_script(_LUA)

    def hit(self, key: str, max_calls: int, per_seconds: int) -> bool:
        now_ms = int(time.time() * 1000)
        try:
            return bool(self.script(keys=[f"darna:rl:{key}"], args=[now_ms, per_seconds * 1000, max_calls, uuid.uuid4().hex]))
        except Exception:  # noqa: BLE001 - any Redis failure: fail open, logged
            log.warning("rate limiter backend unavailable; allowing request")
            return True


_redis_limiter: RedisLimiter | None = None


def _backend_hit(key: str, max_calls: int, per_seconds: int) -> bool:
    global _redis_limiter
    s = get_settings()
    if s.rate_limit_backend == "redis":
        if _redis_limiter is None:
            import redis

            _redis_limiter = RedisLimiter(redis.Redis.from_url(s.redis_url, socket_timeout=0.5, socket_connect_timeout=0.5))
        return _redis_limiter.hit(key, max_calls, per_seconds)
    return hit(key, max_calls, per_seconds)


def set_redis_limiter(limiter: RedisLimiter | None) -> None:
    global _redis_limiter
    _redis_limiter = limiter


def limit(scope: str, max_calls: int, per_seconds: int):
    def dependency(request: Request) -> None:
        if not get_settings().rate_limit_enabled:
            return
        ip = request.client.host if request.client else "unknown"
        if not _backend_hit(f"{scope}:{ip}", max_calls, per_seconds):
            raise RateLimited("Too many requests, try again later", details={"retry_after_seconds": per_seconds})

    return dependency
