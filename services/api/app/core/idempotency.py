"""Idempotent POST support.

Clients send ``Idempotency-Key``. The first successful response is stored per (user, key) and
replayed for retries with the same request body; reusing a key with a different body is rejected.
"""
from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from fastapi.encoders import jsonable_encoder
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import Conflict
from app.core.security import sha256_hex
from app.models.entities import IdempotencyRecord, User


def run_idempotent(db: Session, user: User, key: str | None, scope: str, body: Any, fn: Callable[[], Any]) -> Any:
    if not key:
        return fn()
    req_hash = sha256_hex(json.dumps(jsonable_encoder(body), sort_keys=True))
    existing = db.get(IdempotencyRecord, (user.id, key))
    if existing:
        if existing.scope != scope or existing.request_hash != req_hash:
            raise Conflict("Idempotency key reused with a different request", code="idempotency_key_reused")
        return existing.response
    result = jsonable_encoder(fn())
    db.add(IdempotencyRecord(user_id=user.id, key=key, scope=scope, request_hash=req_hash, status_code=200, response=result))
    try:
        db.commit()
    except IntegrityError as exc:  # concurrent retry with same key won the race
        db.rollback()
        raise Conflict("Request already in progress", code="idempotency_in_progress") from exc
    return result
