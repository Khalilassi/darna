"""Administration API (staff only). Every mutating action is audited."""
from __future__ import annotations

import copy
import uuid
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.core.audit import audit
from app.core.db import get_db, utcnow
from app.core.deps import client_ip, require
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.notify import notify
from app.models.entities import (
    AuditLog,
    Deal,
    Document,
    Listing,
    Offer,
    OwnershipClaim,
    Property,
    PropertyDispute,
    SupportCase,
    User,
    VerificationRequest,
)
from app.models.enums import (
    ClaimStatus,
    DealStatus,
    DisputeStatus,
    ListingStatus,
    Provenance,
    Role,
    SupportStatus,
    VerificationKind,
)
from app.models.enums import (
    VerificationStatus as VS,
)
from app.modules import listings as L
from app.modules import properties as P
from app.modules.deals import expire_all_offers
from app.modules.verification import VERIFICATION_FSM, sale_terms_hash
from app.schemas.common import ORM, Ok, Page

router = APIRouter(prefix="/admin", tags=["admin"])


# --------------------------------------------------------------------------- users
class AdminUserOut(ORM):
    id: uuid.UUID
    email: str
    full_name: str
    phone: str | None
    role: Role
    is_active: bool
    identity_verified_at: datetime | None
    suspended_reason: str | None
    created_at: datetime


class UserUpdate(BaseModel):
    role: Role | None = None
    is_active: bool | None = None
    suspended_reason: str | None = Field(default=None, max_length=500)


@router.get("/users", response_model=Page[AdminUserOut])
def users(q: str | None = Query(default=None, max_length=80), page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
          _: User = Depends(require("user.manage")), db: Session = Depends(get_db)):
    stmt = select(User)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(User.email.ilike(like), User.full_name.ilike(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(stmt.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return Page(items=[AdminUserOut.model_validate(u) for u in items], total=total, page=page, page_size=page_size)


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def update_user(user_id: uuid.UUID, body: UserUpdate, request: Request, admin: User = Depends(require("user.manage")),
                db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise NotFound("User not found")
    if u.id == admin.id and (body.is_active is False or (body.role and body.role != Role.admin)):
        raise Conflict("You cannot demote or suspend yourself", code="self_modification")
    if body.role:
        u.role = body.role
    if body.is_active is not None:
        if body.is_active is False and not body.suspended_reason:
            raise ValidationFailed("A suspension reason is required", code="reason_required")
        u.is_active = body.is_active
        u.suspended_reason = body.suspended_reason if not body.is_active else None
        if not body.is_active:
            # Everything public (including homes under offer) leaves the marketplace; pending listings are
            # held because approval requires an active owner.
            suspendable = [ListingStatus.active, ListingStatus.paused, ListingStatus.under_offer]
            for listing in db.scalars(select(Listing).where(Listing.owner_id == u.id, Listing.status.in_(suspendable))):
                L.transition(db, listing, ListingStatus.suspended, admin, client_ip(request), note="Owner account suspended")
    audit(db, "user.updated", "user", u.id, actor_id=admin.id, data=body.model_dump(exclude_none=True, mode="json"), ip=client_ip(request))
    db.commit()
    return u


# --------------------------------------------------------------------------- verification queue
class DocRef(ORM):
    id: uuid.UUID
    kind: str
    original_name: str
    content_type: str


class QueueClaim(BaseModel):
    status: ClaimStatus
    capacity: str
    principal_name: str | None
    authority_scope: list[str]
    property_id: uuid.UUID
    identity_key: str
    property_type: str
    area_sqm: str


class QueueItem(BaseModel):
    id: uuid.UUID
    kind: VerificationKind
    status: VS
    user_id: uuid.UUID
    user_name: str
    claim_id: uuid.UUID | None
    listing_id: uuid.UUID | None
    note: str | None
    documents: list[DocRef]
    claim: QueueClaim | None
    created_at: datetime


class DecisionIn(BaseModel):
    decision: Literal["approve", "reject", "request_info", "start_review"]
    note: str | None = Field(default=None, max_length=2000)
    supersede_existing: bool = False


@router.get("/verifications", response_model=Page[QueueItem])
def verification_queue(status: list[VS] = Query(default=[VS.submitted, VS.under_review]), kind: VerificationKind | None = None,
                       page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
                       _: User = Depends(require("verification.review")), db: Session = Depends(get_db)):
    """Oldest first (FIFO), paginated; documents and claims are loaded in two batched queries."""
    stmt = select(VerificationRequest).where(VerificationRequest.status.in_(status))
    if kind:
        stmt = stmt.where(VerificationRequest.kind == kind)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.options(joinedload(VerificationRequest.user))
                      .order_by(VerificationRequest.created_at, VerificationRequest.id)
                      .offset((page - 1) * page_size).limit(page_size)).all()
    doc_ids = {uuid.UUID(d) for vr in rows for d in vr.document_ids}
    docs = {d.id: d for d in db.scalars(select(Document).where(Document.id.in_(doc_ids)))} if doc_ids else {}
    claim_ids = {vr.claim_id for vr in rows if vr.claim_id}
    claims = ({c.id: c for c in db.scalars(select(OwnershipClaim).options(joinedload(OwnershipClaim.property))
                                            .where(OwnershipClaim.id.in_(claim_ids)))} if claim_ids else {})
    out = []
    for vr in rows:
        claim = None
        c = claims.get(vr.claim_id) if vr.claim_id else None
        if c:
            p = c.property
            claim = QueueClaim(status=c.status, capacity=c.capacity.value, principal_name=c.principal_name,
                               authority_scope=c.authority_scope, property_id=p.id, identity_key=p.identity_key,
                               property_type=p.property_type.value, area_sqm=str(p.area_sqm))
        vr_docs = [docs[uuid.UUID(d)] for d in vr.document_ids if uuid.UUID(d) in docs]
        out.append(QueueItem(id=vr.id, kind=vr.kind, status=vr.status, user_id=vr.user_id, user_name=vr.user.full_name,
                             claim_id=vr.claim_id, listing_id=vr.listing_id, note=vr.note,
                             documents=[DocRef.model_validate(d) for d in vr_docs], claim=claim, created_at=vr.created_at))
    return Page(items=out, total=total, page=page, page_size=page_size)


@router.post("/verifications/{vr_id}/decision", response_model=Ok)
def decide(vr_id: uuid.UUID, body: DecisionIn, request: Request, reviewer: User = Depends(require("verification.review")),
           db: Session = Depends(get_db)):
    vr = db.get(VerificationRequest, vr_id, with_for_update=True)
    if vr is None:
        raise NotFound("Verification not found")
    if vr.user_id == reviewer.id:
        raise Conflict("You cannot review your own submission", code="self_review")
    ip = client_ip(request)
    if body.decision in ("reject", "request_info") and not body.note:
        raise ValidationFailed("A note is required", code="note_required")
    if body.decision == "start_review":
        VERIFICATION_FSM.assert_transition(vr.status, VS.under_review)
        vr.status = VS.under_review
        if vr.claim_id:
            claim = db.get(OwnershipClaim, vr.claim_id)
            if claim and claim.status == ClaimStatus.submitted:
                claim.status = ClaimStatus.under_review
    elif body.decision == "request_info":
        VERIFICATION_FSM.assert_transition(vr.status, VS.more_info_required)
        vr.status = VS.more_info_required
        vr.decision_note = body.note
        notify(db, vr.user_id, "verification_more_info", verification_id=vr.id)
    elif vr.kind == VerificationKind.ownership:
        claim = db.get(OwnershipClaim, vr.claim_id, with_for_update=True)
        assert claim is not None
        if body.decision == "approve":
            P.approve_claim(db, reviewer, claim, body.note, body.supersede_existing, ip)
        else:
            P.reject_claim(db, reviewer, claim, body.note or "", ip)
    else:
        target = VS.approved if body.decision == "approve" else VS.rejected
        VERIFICATION_FSM.assert_transition(vr.status, target)
        if vr.kind == VerificationKind.financial and target == VS.approved and vr.listing_id:
            listing = db.get(Listing, vr.listing_id, with_for_update=True)
            # Requests created before terms_hash existed (NULL) keep the previous behaviour.
            if listing is None or (vr.terms_hash is not None and sale_terms_hash(listing.sale_terms) != vr.terms_hash):
                raise Conflict("The owner changed the figures after submitting them; ask them to submit again",
                               code="terms_changed_since_submission")
        vr.status = target
        vr.reviewer_id = reviewer.id
        vr.decision_note = body.note
        vr.decided_at = utcnow()
        if vr.kind == VerificationKind.identity and target == VS.approved:
            db.get(User, vr.user_id).identity_verified_at = utcnow()
        if vr.kind == VerificationKind.financial and target == VS.approved and vr.listing_id:
            _mark_financials_verified(db, vr.listing_id)
        notify(db, vr.user_id, f"verification_{target.value}", verification_id=vr.id, kind=vr.kind.value)
    audit(db, f"verification.{body.decision}", "verification", vr.id, actor_id=reviewer.id, data={"kind": vr.kind.value}, ip=ip)
    db.commit()
    return Ok()


def _mark_financials_verified(db: Session, listing_id: uuid.UUID) -> None:
    """Reviewer confirmed seller figures against the submitted statements: upgrade their provenance."""
    listing = db.get(Listing, listing_id, with_for_update=True)
    if listing is None or not listing.sale_terms:
        return

    def upgrade(o):
        if isinstance(o, dict):
            if o.get("provenance") == Provenance.seller_provided.value:
                o["provenance"] = Provenance.verified.value
            for v in o.values():
                upgrade(v)
        elif isinstance(o, list):
            for v in o:
                upgrade(v)

    terms = copy.deepcopy(listing.sale_terms)
    upgrade(terms)
    listing.sale_terms = terms
    listing.financials_verified_at = utcnow()


# --------------------------------------------------------------------------- listings moderation
class AdminListingOut(BaseModel):
    id: uuid.UUID
    title: str
    status: ListingStatus
    purpose: str
    owner_id: uuid.UUID
    owner_name: str
    identity_key: str
    sale_cash_price: str | None
    monthly_rent: str | None
    photos: int
    moderation_note: str | None
    featured_until: datetime | None
    financials_verified: bool
    created_at: datetime


class ModerateIn(BaseModel):
    action: Literal["approve", "reject", "suspend", "reinstate", "feature", "unfeature"]
    note: str | None = Field(default=None, max_length=2000)
    feature_days: int | None = Field(default=None, ge=1, le=90)


@router.get("/listings", response_model=Page[AdminListingOut])
def admin_listings(status: list[ListingStatus] = Query(default=[]), page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
                   _: User = Depends(require("listing.moderate")), db: Session = Depends(get_db)):
    stmt = select(Listing).options(joinedload(Listing.owner), joinedload(Listing.property), joinedload(Listing.photos))
    if status:
        stmt = stmt.where(Listing.status.in_(status))
    total = db.scalar(select(func.count()).select_from(select(Listing.id).where(Listing.status.in_(status)).subquery()
                                                       if status else select(Listing.id).subquery())) or 0
    rows = db.scalars(stmt.order_by(Listing.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).unique().all()
    return Page(items=[AdminListingOut(
        id=r.id, title=r.title, status=r.status, purpose=r.purpose.value, owner_id=r.owner_id, owner_name=r.owner.full_name,
        identity_key=r.property.identity_key, sale_cash_price=str(r.sale_cash_price) if r.sale_cash_price else None,
        monthly_rent=str(r.monthly_rent) if r.monthly_rent else None, photos=len(r.photos), moderation_note=r.moderation_note,
        featured_until=r.featured_until, financials_verified=r.financials_verified_at is not None, created_at=r.created_at,
    ) for r in rows], total=total, page=page, page_size=page_size)


@router.post("/listings/{listing_id}/moderate", response_model=Ok)
def moderate(listing_id: uuid.UUID, body: ModerateIn, request: Request, staff: User = Depends(require("listing.moderate")),
             db: Session = Depends(get_db)):
    listing = db.get(Listing, listing_id, with_for_update=True)
    if listing is None:
        raise NotFound("Listing not found")
    ip = client_ip(request)
    if body.action in ("reject", "suspend") and not body.note:
        raise ValidationFailed("A note is required", code="note_required")
    if body.action == "approve":
        owner = db.get(User, listing.owner_id)
        claim = db.get(OwnershipClaim, listing.claim_id)
        if owner is None or not owner.is_active:
            raise Conflict("The owner's account is suspended", code="owner_suspended")
        if owner.identity_verified_at is None or claim is None or claim.status != ClaimStatus.approved:
            raise Conflict("Owner identity and ownership must be verified first", code="owner_not_verified")
        L.transition(db, listing, ListingStatus.active, staff, ip, note=body.note)
        listing.approved_version = listing.version
        notify(db, listing.owner_id, "listing_approved", listing_id=listing.id)
    elif body.action == "reject":
        L.transition(db, listing, ListingStatus.rejected, staff, ip, note=body.note)
        notify(db, listing.owner_id, "listing_rejected", listing_id=listing.id)
    elif body.action == "suspend":
        L.transition(db, listing, ListingStatus.suspended, staff, ip, note=body.note)
        notify(db, listing.owner_id, "listing_suspended", listing_id=listing.id)
    elif body.action == "reinstate":
        L.transition(db, listing, ListingStatus.active, staff, ip, note=body.note)
    elif body.action == "feature":
        if listing.status != ListingStatus.active:
            raise Conflict("Only active listings can be featured", code="listing_not_active")
        listing.featured_until = utcnow() + timedelta(days=body.feature_days or 7)
        audit(db, "listing.featured", "listing", listing.id, actor_id=staff.id, ip=ip)
    elif body.action == "unfeature":
        listing.featured_until = None
        audit(db, "listing.unfeatured", "listing", listing.id, actor_id=staff.id, ip=ip)
    db.commit()
    return Ok()


# --------------------------------------------------------------------------- disputes & duplicates
class ClaimBrief(BaseModel):
    claim_id: uuid.UUID
    user_id: uuid.UUID
    name: str
    status: ClaimStatus
    capacity: str


class DisputeOut(BaseModel):
    id: uuid.UUID
    property_id: uuid.UUID
    identity_key: str
    status: DisputeStatus
    reason: str
    challenger: ClaimBrief
    existing: ClaimBrief | None
    resolution_note: str | None
    created_at: datetime


class ResolveIn(BaseModel):
    outcome: Literal["resolved_for_existing", "resolved_for_challenger", "dismissed"]
    note: str = Field(min_length=3, max_length=2000)


def _claim_brief(db: Session, claim_id: uuid.UUID | None) -> ClaimBrief | None:
    c = db.get(OwnershipClaim, claim_id) if claim_id else None
    if c is None:
        return None
    u = db.get(User, c.claimant_id)
    return ClaimBrief(claim_id=c.id, user_id=c.claimant_id, name=u.full_name if u else "", status=c.status,
                      capacity=c.capacity.value)


@router.get("/disputes", response_model=list[DisputeOut])
def disputes(status: DisputeStatus | Literal["all"] = DisputeStatus.open, _: User = Depends(require("dispute.resolve")), db: Session = Depends(get_db)):
    stmt = select(PropertyDispute)
    if status != "all":
        stmt = stmt.where(PropertyDispute.status == status)
    out = []
    for d in db.scalars(stmt.order_by(PropertyDispute.created_at)).all():
        prop = db.get(Property, d.property_id)
        out.append(DisputeOut(id=d.id, property_id=d.property_id, identity_key=prop.identity_key if prop else "", status=d.status,
                              reason=d.reason, challenger=_claim_brief(db, d.challenger_claim_id),
                              existing=_claim_brief(db, d.existing_claim_id), resolution_note=d.resolution_note, created_at=d.created_at))
    return out


@router.post("/disputes/{dispute_id}/resolve", response_model=Ok)
def resolve(dispute_id: uuid.UUID, body: ResolveIn, request: Request, admin: User = Depends(require("dispute.resolve")),
            db: Session = Depends(get_db)):
    d = db.get(PropertyDispute, dispute_id, with_for_update=True)
    if d is None:
        raise NotFound("Dispute not found")
    P.resolve_dispute(db, admin, d, DisputeStatus(body.outcome), body.note, client_ip(request))
    db.commit()
    return Ok()


class DuplicateCandidate(BaseModel):
    project_id: uuid.UUID
    district_id: uuid.UUID
    group_code: str
    building_code: str
    property_ids: list[uuid.UUID]
    identity_keys: list[str]


@router.get("/duplicates", response_model=list[DuplicateCandidate])
def duplicate_candidates(_: User = Depends(require("dispute.resolve")), db: Session = Depends(get_db)):
    """Properties in the same building where one has no unit and another does (possible mis-registration)."""
    rows = db.execute(
        select(Property.project_id, Property.district_id, Property.group_code, Property.building_code,
               func.array_agg(Property.id), func.array_agg(Property.identity_key))
        .group_by(Property.project_id, Property.district_id, Property.group_code, Property.building_code)
        .having(func.bool_or(Property.unit_code.is_(None)) & (func.count() > 1))
    ).all()
    return [DuplicateCandidate(project_id=r[0], district_id=r[1], group_code=r[2], building_code=r[3], property_ids=r[4],
                               identity_keys=r[5]) for r in rows]


# --------------------------------------------------------------------------- deals monitor
class AdminDealOut(BaseModel):
    id: uuid.UUID
    listing_id: uuid.UUID
    listing_title: str
    kind: str
    status: DealStatus
    buyer_id: uuid.UUID
    buyer_name: str
    owner_id: uuid.UUID
    owner_name: str
    offers: int
    updated_at: datetime


@router.get("/deals", response_model=list[AdminDealOut])
def admin_deals(status: list[DealStatus] = Query(default=[]), _: User = Depends(require("deal.monitor")), db: Session = Depends(get_db)):
    stmt = select(Deal).options(joinedload(Deal.listing))
    if status:
        stmt = stmt.where(Deal.status.in_(status))
    deals = db.scalars(stmt.order_by(Deal.updated_at.desc()).limit(200)).all()
    names = _names(db, {d.buyer_id for d in deals} | {d.owner_id for d in deals})
    return [AdminDealOut(id=d.id, listing_id=d.listing_id, listing_title=d.listing.title, kind=d.kind.value, status=d.status,
                         buyer_id=d.buyer_id, buyer_name=names.get(d.buyer_id, ""), owner_id=d.owner_id,
                         owner_name=names.get(d.owner_id, ""),
                         offers=db.scalar(select(func.count()).select_from(Offer).where(Offer.deal_id == d.id)) or 0,
                         updated_at=d.updated_at) for d in deals]


class ExpireOut(BaseModel):
    expired: int


@router.post("/maintenance/expire-offers", response_model=ExpireOut)
def run_expiry(_: User = Depends(require("deal.monitor")), db: Session = Depends(get_db)):
    n = expire_all_offers(db)
    db.commit()
    return {"expired": n}


# --------------------------------------------------------------------------- support
def _names(db: Session, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    return dict(db.execute(select(User.id, User.full_name).where(User.id.in_(ids))).all())


class AdminCaseOut(ORM):
    id: uuid.UUID
    reporter_id: uuid.UUID
    reporter_name: str = ""
    assignee_name: str | None = None
    category: str
    subject_type: str | None
    subject_id: str | None
    description: str
    status: SupportStatus
    assignee_id: uuid.UUID | None
    resolution_note: str | None
    created_at: datetime


class CaseUpdate(BaseModel):
    status: SupportStatus | None = None
    assign_to_me: bool = False
    resolution_note: str | None = Field(default=None, max_length=4000)


@router.get("/support", response_model=list[AdminCaseOut])
def cases(status: list[SupportStatus] = Query(default=[SupportStatus.open, SupportStatus.in_progress]),
          _: User = Depends(require("support.handle")), db: Session = Depends(get_db)):
    rows = db.scalars(select(SupportCase).where(SupportCase.status.in_(status)).order_by(SupportCase.created_at)).all()
    return [_case_out(db, c) for c in rows]


def _case_out(db: Session, c: SupportCase) -> AdminCaseOut:
    names = _names(db, {i for i in (c.reporter_id, c.assignee_id) if i})
    out = AdminCaseOut.model_validate(c)
    out.reporter_name = names.get(c.reporter_id, "")
    out.assignee_name = names.get(c.assignee_id) if c.assignee_id else None
    return out


@router.patch("/support/{case_id}", response_model=AdminCaseOut)
def update_case(case_id: uuid.UUID, body: CaseUpdate, request: Request, staff: User = Depends(require("support.handle")),
                db: Session = Depends(get_db)):
    case = db.get(SupportCase, case_id)
    if case is None:
        raise NotFound("Case not found")
    if body.assign_to_me:
        case.assignee_id = staff.id
    if body.status:
        case.status = body.status
    if body.resolution_note:
        case.resolution_note = body.resolution_note
    if case.status in (SupportStatus.resolved, SupportStatus.closed):
        notify(db, case.reporter_id, "support_case_updated", case_id=case.id)
    audit(db, "support.updated", "support_case", case.id, actor_id=staff.id, data={"status": case.status.value}, ip=client_ip(request))
    db.commit()
    return _case_out(db, case)


# --------------------------------------------------------------------------- audit & analytics
class AuditOut(ORM):
    id: uuid.UUID
    actor_id: uuid.UUID | None
    action: str
    entity_type: str
    entity_id: str | None
    data: dict
    ip: str | None
    created_at: datetime


@router.get("/audit", response_model=Page[AuditOut])
def audit_logs(action: str | None = Query(default=None, max_length=80), entity_id: str | None = Query(default=None, max_length=64),
               page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
               _: User = Depends(require("audit.read")), db: Session = Depends(get_db)):
    stmt = select(AuditLog)
    if action:
        stmt = stmt.where(AuditLog.action.startswith(action))
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(AuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return Page(items=[AuditOut.model_validate(r) for r in rows], total=total, page=page, page_size=page_size)


class AnalyticsOut(BaseModel):
    users_total: int
    users_identity_verified: int
    users_new_30d: int
    properties_total: int
    listings_by_status: dict[str, int]
    deals_by_status: dict[str, int]
    claims_by_status: dict[str, int]
    verifications_pending: int
    disputes_open: int
    support_open: int


@router.get("/analytics", response_model=AnalyticsOut)
def analytics(_: User = Depends(require("analytics.read")), db: Session = Depends(get_db)):
    def counts(col):
        return {str(k.value if hasattr(k, "value") else k): v for k, v in db.execute(select(col, func.count()).group_by(col)).all()}

    since = utcnow() - timedelta(days=30)
    return {
        "users_total": db.scalar(select(func.count()).select_from(User)) or 0,
        "users_identity_verified": db.scalar(select(func.count()).select_from(User).where(User.identity_verified_at.is_not(None))) or 0,
        "users_new_30d": db.scalar(select(func.count()).select_from(User).where(User.created_at >= since)) or 0,
        "properties_total": db.scalar(select(func.count()).select_from(Property)) or 0,
        "listings_by_status": counts(Listing.status),
        "deals_by_status": counts(Deal.status),
        "claims_by_status": counts(OwnershipClaim.status),
        "verifications_pending": db.scalar(select(func.count()).select_from(VerificationRequest).where(
            VerificationRequest.status.in_([VS.submitted, VS.under_review]))) or 0,
        "disputes_open": db.scalar(select(func.count()).select_from(PropertyDispute).where(PropertyDispute.status == DisputeStatus.open)) or 0,
        "support_open": db.scalar(select(func.count()).select_from(SupportCase).where(
            SupportCase.status.in_([SupportStatus.open, SupportStatus.in_progress]))) or 0,
    }
