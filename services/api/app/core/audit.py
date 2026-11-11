from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.core.redaction import redact
from app.models.entities import AuditLog


def audit(
    db: Session,
    action: str,
    entity_type: str,
    entity_id: Any = None,
    actor_id: uuid.UUID | None = None,
    data: dict | None = None,
    ip: str | None = None,
) -> None:
    """Record an audit event in the caller's transaction (committed atomically with the change)."""
    db.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            data=redact(data or {}),
            ip=ip,
        )
    )
