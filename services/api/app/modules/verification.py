"""Identity verification submissions (user side). Review happens in app.modules.admin."""
from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.db import get_db
from app.core.deps import client_ip, current_user
from app.core.errors import Conflict, ValidationFailed
from app.core.state_machine import StateMachine
from app.models.entities import User, VerificationRequest
from app.models.enums import DocumentKind, VerificationKind, VerificationStatus as VS
from app.modules.documents import get_owned_documents
from app.schemas.common import ORM

router = APIRouter(prefix="/verifications", tags=["verification"])

VERIFICATION_FSM = StateMachine(
    "verification",
    {
        VS.submitted: [VS.under_review, VS.approved, VS.rejected, VS.more_info_required, VS.withdrawn],
        VS.under_review: [VS.approved, VS.rejected, VS.more_info_required],
        VS.more_info_required: [VS.submitted, VS.withdrawn, VS.rejected],
    },
    terminal=[VS.approved, VS.rejected, VS.withdrawn],
)
OPEN = (VS.submitted, VS.under_review, VS.more_info_required)


class VerificationIn(BaseModel):
    document_ids: list[uuid.UUID] = Field(min_length=1, max_length=5)
    note: str | None = Field(default=None, max_length=1000)


class VerificationOut(ORM):
    id: uuid.UUID
    kind: VerificationKind
    status: VS
    claim_id: uuid.UUID | None
    listing_id: uuid.UUID | None
    note: str | None
    decision_note: str | None
    decided_at: datetime | None
    created_at: datetime


@router.post("/identity", response_model=VerificationOut, status_code=201)
def submit_identity(body: VerificationIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.identity_verified_at:
        raise Conflict("Identity already verified", code="already_verified")
    docs = get_owned_documents(db, user, body.document_ids)
    if not any(d.kind in (DocumentKind.national_id, DocumentKind.passport) for d in docs):
        raise ValidationFailed("A national ID or passport document is required", code="identity_document_required")
    pending = db.scalar(
        select(VerificationRequest).where(
            VerificationRequest.user_id == user.id,
            VerificationRequest.kind == VerificationKind.identity,
            VerificationRequest.status.in_(OPEN),
        ).with_for_update()
    )
    if pending and pending.status != VS.more_info_required:
        raise Conflict("An identity verification is already in review", code="verification_pending")
    if pending:
        VERIFICATION_FSM.assert_transition(pending.status, VS.submitted)
        pending.status = VS.submitted
        pending.document_ids = [str(d.id) for d in docs]
        pending.note = body.note
        vr = pending
    else:
        vr = VerificationRequest(user_id=user.id, kind=VerificationKind.identity, document_ids=[str(d.id) for d in docs], note=body.note)
        db.add(vr)
    db.flush()
    audit(db, "verification.submitted", "verification", vr.id, actor_id=user.id, data={"kind": "identity"}, ip=client_ip(request))
    db.commit()
    return vr


@router.get("", response_model=list[VerificationOut])
def my_verifications(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(
        select(VerificationRequest).where(VerificationRequest.user_id == user.id).order_by(VerificationRequest.created_at.desc())
    ).all()


class FinancialVerificationIn(VerificationIn):
    listing_id: uuid.UUID


@router.post("/financial", response_model=VerificationOut, status_code=201)
def submit_financial(body: FinancialVerificationIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Owner asks reviewers to check listed figures against developer statements / receipts."""
    from app.models.entities import Listing

    listing = db.get(Listing, body.listing_id)
    if listing is None or listing.owner_id != user.id:
        raise ValidationFailed("Unknown listing", code="invalid_listing")
    if not listing.sale_terms:
        raise ValidationFailed("Only sale listings carry verifiable financials", code="no_sale_terms")
    docs = get_owned_documents(db, user, body.document_ids)
    if not any(d.kind in (DocumentKind.developer_statement, DocumentKind.payment_receipt, DocumentKind.maintenance_receipt) for d in docs):
        raise ValidationFailed("A developer statement or receipt is required", code="financial_document_required")
    pending = db.scalar(select(VerificationRequest.id).where(
        VerificationRequest.listing_id == listing.id, VerificationRequest.kind == VerificationKind.financial,
        VerificationRequest.status.in_(OPEN)))
    if pending:
        raise Conflict("A financial verification is already in review", code="verification_pending")
    vr = VerificationRequest(user_id=user.id, kind=VerificationKind.financial, listing_id=listing.id,
                             document_ids=[str(d.id) for d in docs], note=body.note)
    db.add(vr)
    db.flush()
    audit(db, "verification.submitted", "verification", vr.id, actor_id=user.id, data={"kind": "financial"}, ip=client_ip(request))
    db.commit()
    return vr
