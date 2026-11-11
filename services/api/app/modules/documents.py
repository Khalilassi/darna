"""Private documents: upload, signed short-lived access, audited reads, retention-aware deletion."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.core import rate_limit
from app.core.audit import audit
from app.core.config import get_settings
from app.core.db import get_db, utcnow
from app.core.deps import PERMISSIONS, client_ip, current_user
from app.core.errors import Forbidden, NotFound, ValidationFailed
from app.core.security import sha256_hex, sign_document_access, verify_document_access
from app.core.storage import ALLOWED_DOC_TYPES, private_storage, sniff_type
from app.models.entities import ChecklistItem, Deal, Document, User
from app.models.enums import DocumentKind
from app.schemas.common import ORM, Ok

router = APIRouter(prefix="/documents", tags=["documents"])


class DocumentOut(ORM):
    id: uuid.UUID
    kind: DocumentKind
    original_name: str
    content_type: str
    size_bytes: int
    created_at: datetime


class SignedUrlOut(ORM):
    url: str
    expires_at: int


def can_access_document(db: Session, user: User, doc: Document) -> bool:
    if doc.deleted_at is not None:
        return False
    if doc.owner_id == user.id:
        return True
    if user.role in PERMISSIONS["document.review"]:
        return True
    # Counterparty in a deal where this document was attached to the checklist.
    return bool(
        db.scalar(
            select(
                exists().where(
                    ChecklistItem.document_id == doc.id,
                    ChecklistItem.deal_id == Deal.id,
                    (Deal.buyer_id == user.id) | (Deal.owner_id == user.id),
                )
            )
        )
    )


def get_owned_documents(db: Session, user: User, ids: list[uuid.UUID]) -> list[Document]:
    docs = db.scalars(select(Document).where(Document.id.in_(ids), Document.deleted_at.is_(None))).all() if ids else []
    if len(docs) != len(set(ids)) or any(d.owner_id != user.id for d in docs):
        raise ValidationFailed("Unknown document reference", code="invalid_document_reference")
    return list(docs)


@router.post("", response_model=DocumentOut, status_code=201, dependencies=[Depends(rate_limit.limit("upload", 60, 3600))])
async def upload(
    request: Request,
    kind: DocumentKind = Form(...),
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> Document:
    s = get_settings()
    data = await file.read(s.max_upload_bytes + 1)
    if len(data) > s.max_upload_bytes:
        raise ValidationFailed("File too large", code="file_too_large")
    if not data:
        raise ValidationFailed("Empty file", code="empty_file")
    ctype = sniff_type(data)  # trust content, not the client-declared type
    if ctype not in ALLOWED_DOC_TYPES:
        raise ValidationFailed("Only PDF, JPEG, PNG or WEBP files are accepted", code="unsupported_file_type")
    key = private_storage().put(data)
    doc = Document(
        owner_id=user.id, kind=kind, storage_key=key, original_name=(file.filename or "document")[:200],
        content_type=ctype, size_bytes=len(data), sha256=sha256_hex(data),
        retain_until=date.today() + timedelta(days=s.document_retention_days),
    )
    db.add(doc)
    db.flush()
    audit(db, "document.uploaded", "document", doc.id, actor_id=user.id, data={"kind": kind.value}, ip=client_ip(request))
    db.commit()
    return doc


@router.get("", response_model=list[DocumentOut])
def my_documents(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(
        select(Document).where(Document.owner_id == user.id, Document.deleted_at.is_(None)).order_by(Document.created_at.desc())
    ).all()


@router.post("/{document_id}/signed-url", response_model=SignedUrlOut)
def signed_url(document_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc = db.get(Document, document_id)
    if doc is None or not can_access_document(db, user, doc):
        raise NotFound("Document not found")
    token, exp = sign_document_access(doc.id, user.id)
    return {"url": f"{get_settings().public_base_url}/documents/{doc.id}/content?token={token}", "expires_at": exp}


@router.get("/{document_id}/content")
def content(document_id: uuid.UUID, request: Request, token: str = Query(max_length=300), db: Session = Depends(get_db)):
    uid = verify_document_access(document_id, token)
    user = db.get(User, uid)
    doc = db.get(Document, document_id)
    # Re-check authorization at read time: access may have been revoked since the URL was issued.
    if user is None or not user.is_active or doc is None or not can_access_document(db, user, doc):
        raise NotFound("Document not found")
    data = private_storage().get(doc.storage_key)
    audit(db, "document.read", "document", doc.id, actor_id=user.id, ip=client_ip(request))
    db.commit()
    return Response(
        content=data,
        media_type=doc.content_type,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/{document_id}", response_model=Ok)
def delete_document(document_id: uuid.UUID, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    doc = db.get(Document, document_id)
    if doc is None or doc.owner_id != user.id or doc.deleted_at:
        raise NotFound("Document not found")
    in_use = db.scalar(select(exists().where(ChecklistItem.document_id == doc.id)))
    if in_use:
        raise Forbidden("Document is attached to a transaction record and is retained", code="document_retained")
    doc.deleted_at = utcnow()
    private_storage().delete(doc.storage_key)
    audit(db, "document.deleted", "document", doc.id, actor_id=user.id, ip=client_ip(request))
    db.commit()
    return Ok()
