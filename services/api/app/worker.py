"""Scheduled maintenance jobs.

Run once (e.g. from cron / a platform scheduler):   python -m app.worker --once
Run as a long-lived process:                         python -m app.worker --interval 300

Every job is idempotent and safe to run concurrently with the API: rows are claimed with
``FOR UPDATE SKIP LOCKED`` where they are modified.
"""
from __future__ import annotations

import argparse
import logging
import time
from dataclasses import asdict, dataclass
from datetime import date, timedelta

from sqlalchemy import cast, delete, exists, select, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.db import session_factory, utcnow
from app.core.storage import private_storage
from app.models.entities import Document, IdempotencyRecord, Listing, RefreshToken, VerificationRequest
from app.modules.deals import expire_all_offers

log = logging.getLogger("darna.worker")

IDEMPOTENCY_TTL = timedelta(days=2)
REFRESH_TOKEN_GRACE = timedelta(days=7)


@dataclass
class JobReport:
    offers_expired: int = 0
    documents_purged: int = 0
    featured_cleared: int = 0
    refresh_tokens_deleted: int = 0
    idempotency_records_deleted: int = 0


def _in_open_verification(db: Session, doc: Document) -> bool:
    """Documents referenced by an undecided verification request are still needed."""
    return bool(db.scalar(select(exists().where(
        VerificationRequest.decided_at.is_(None),
        cast(VerificationRequest.document_ids, JSONB).contains([str(doc.id)]),
    ))))


def purge_documents(db: Session, today: date | None = None) -> int:
    """Delete stored bytes of documents past their retention date.

    Documents still referenced by an undecided verification request are skipped. The DB row stays
    (soft delete) so audit history remains resolvable; only the encrypted file is removed.
    """
    today = today or date.today()
    n = 0
    rows = db.scalars(
        select(Document).where(Document.retain_until < today, Document.deleted_at.is_(None)).with_for_update(skip_locked=True)
    ).all()
    for doc in rows:
        if _in_open_verification(db, doc):
            continue
        private_storage().delete(doc.storage_key)
        doc.deleted_at = utcnow()
        audit(db, "document.retention_purged", "document", doc.id)
        n += 1
    return n


def clear_expired_featuring(db: Session) -> int:
    res = db.execute(update(Listing).where(Listing.featured_until < utcnow()).values(featured_until=None))
    return res.rowcount or 0


def cleanup_tokens(db: Session) -> tuple[int, int]:
    now = utcnow()
    r1 = db.execute(delete(RefreshToken).where(RefreshToken.expires_at < now - REFRESH_TOKEN_GRACE))
    r2 = db.execute(delete(IdempotencyRecord).where(IdempotencyRecord.created_at < now - IDEMPOTENCY_TTL))
    return r1.rowcount or 0, r2.rowcount or 0


def run_once(db: Session | None = None) -> JobReport:
    own = db is None
    db = db or session_factory()()
    report = JobReport()
    try:
        # Each job commits on its own so one failure does not roll back the others.
        for name, job in (
            ("offers", lambda: setattr(report, "offers_expired", expire_all_offers(db))),
            ("documents", lambda: setattr(report, "documents_purged", purge_documents(db))),
            ("featured", lambda: setattr(report, "featured_cleared", clear_expired_featuring(db))),
            ("tokens", lambda: _tokens(db, report)),
        ):
            try:
                job()
                db.commit()
            except Exception:
                db.rollback()
                log.exception("worker job failed: %s", name)
        log.info("worker run %s", asdict(report))
        return report
    finally:
        if own:
            db.close()


def _tokens(db: Session, report: JobReport) -> None:
    report.refresh_tokens_deleted, report.idempotency_records_deleted = cleanup_tokens(db)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    p = argparse.ArgumentParser(description="Darna maintenance worker")
    p.add_argument("--once", action="store_true")
    p.add_argument("--interval", type=int, default=300, help="seconds between runs")
    args = p.parse_args()
    if args.once:
        run_once()
        return
    while True:
        run_once()
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
