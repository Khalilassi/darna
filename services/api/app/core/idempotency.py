"""Idempotent POST support.

Clients send ``Idempotency-Key``. Flow:

1. **Reserve** the key (user, key) with the request hash and commit *before* running the action.
   The primary key makes reservation atomic: a concurrent request with the same key cannot run its
   action (it gets ``409 idempotency_in_progress``), whatever its body.
2. Run the action.
3. On success, store the response on the reservation. On failure, release the reservation so the
   client may retry.

A retry with the same key and body replays the stored response; the same key with a different
body is rejected. If the process dies between the action's commit and step 3, the reservation stays
"in progress" (status 0), so a retry cannot repeat the action; the worker removes such records after
the retention window.
"""
from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from fastapi.encoders import jsonable_encoder
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import Conflict
from app.core.security import sha256_hex
from app.models.entities import IdempotencyRecord, User

IN_PROGRESS = 0


def run_idempotent(db: Session, user: User, key: str | None, scope: str, body: Any, fn: Callable[[], Any]) -> Any:
    if not key:
        return fn()
    user_id = user.id
    req_hash = sha256_hex(json.dumps(jsonable_encoder(body), sort_keys=True))

    existing = db.get(IdempotencyRecord, (user_id, key))
    if existing is None:
        db.add(IdempotencyRecord(user_id=user_id, key=key, scope=scope, request_hash=req_hash,
                                 status_code=IN_PROGRESS, response={}))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            existing = db.get(IdempotencyRecord, (user_id, key))
            if existing is None:  # reserved and released in between; treat as busy, client retries
                raise Conflict("Request already in progress", code="idempotency_in_progress") from None
    if existing is not None:
        if existing.scope != scope or existing.request_hash != req_hash:
            raise Conflict("Idempotency key reused with a different request", code="idempotency_key_reused")
        if existing.status_code == IN_PROGRESS:
            raise Conflict("Request already in progress", code="idempotency_in_progress")
        return existing.response

    try:
        result = jsonable_encoder(fn())
    except BaseException:
        db.rollback()
        db.execute(delete(IdempotencyRecord).where(IdempotencyRecord.user_id == user_id, IdempotencyRecord.key == key))
        db.commit()
        raise
    record = db.get(IdempotencyRecord, (user_id, key))
    assert record is not None
    record.status_code = 200
    record.response = result
    db.commit()
    return result
