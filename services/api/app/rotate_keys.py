"""Re-encrypt stored documents and staff TOTP secrets with the primary (first) encryption key.

Usage: ``python -m app.rotate_keys``. Idempotent and safe to re-run; run it after putting a new key first
in DARNA_DOCUMENT_ENCRYPTION_KEY and before removing the old key. See app/core/crypto.py.
"""
from __future__ import annotations

import logging
from dataclasses import asdict, dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import totp
from app.core.audit import audit
from app.core.db import session_factory
from app.core.storage import private_storage
from app.models.entities import Document, User

log = logging.getLogger("darna.rotate")


@dataclass
class RotationReport:
    documents_rotated: int = 0
    documents_failed: int = 0
    totp_secrets_rotated: int = 0


def rotate_all(db: Session) -> RotationReport:
    report = RotationReport()
    store = private_storage()
    for doc_id, key in db.execute(select(Document.id, Document.storage_key).where(Document.deleted_at.is_(None))).all():
        try:
            store.rotate(key)
            report.documents_rotated += 1
        except Exception:
            # Missing file or a key no longer configured: report it, keep going, never lose data.
            log.exception("rotation failed for document %s", doc_id)
            report.documents_failed += 1
    for user in db.scalars(select(User).where(User.totp_secret_encrypted.is_not(None)).with_for_update()):
        user.totp_secret_encrypted = totp.rotate_secret(user.totp_secret_encrypted)
        report.totp_secrets_rotated += 1
    audit(db, "security.keys_rotated", "system", None, data=asdict(report))
    db.commit()
    return report


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    db = session_factory()()
    try:
        report = rotate_all(db)
    finally:
        db.close()
    log.info("key rotation finished %s", asdict(report))
    if report.documents_failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
