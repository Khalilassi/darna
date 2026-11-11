"""Canonical property identity, ownership claims and disputes.

Identity rules (docs/product/property-identity.md):
- A property is identified by (project, district, group, building[, unit]) after normalization.
- Apartment-like types REQUIRE a unit code; detached types (villa, townhouse) are identified by
  their building/house number and must not carry a unit code. Twin houses require a unit (side).
- Incomplete identities are rejected outright: we never create a property whose uniqueness
  cannot be established.
- Uniqueness is enforced by the database (``uq_properties_identity``) so concurrent registrations
  of the same unit cannot both succeed.
"""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core import rate_limit
from app.core.audit import audit
from app.core.db import get_db, utcnow
from app.core.deps import client_ip, current_user
from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.core.notify import notify
from app.core.state_machine import StateMachine
from app.core.validation import rule_error
from app.models.entities import (
    District,
    Listing,
    OwnershipClaim,
    Property,
    PropertyDispute,
    User,
    VerificationRequest,
)
from app.models.enums import (
    LISTING_OCCUPYING_STATUSES,
    ClaimCapacity,
    DeliveryStatus,
    DisputeStatus,
    DocumentKind,
    Finishing,
    ListingStatus,
    Orientation,
    PropertyType,
    VerificationKind,
    VerificationStatus,
)
from app.models.enums import (
    ClaimStatus as CS,
)
from app.modules.documents import get_owned_documents
from app.schemas.common import ORM

router = APIRouter(prefix="/properties", tags=["properties"])

UNIT_REQUIRED = {PropertyType.apartment, PropertyType.duplex, PropertyType.penthouse, PropertyType.studio, PropertyType.twin_house}
UNIT_FORBIDDEN = {PropertyType.villa, PropertyType.townhouse}
AUTHORITY_SCOPES = {"list", "negotiate", "sign"}
ACTIVE_CLAIM = (CS.submitted, CS.under_review, CS.approved, CS.disputed)

CLAIM_FSM = StateMachine(
    "ownership_claim",
    {
        CS.submitted: [CS.under_review, CS.approved, CS.rejected, CS.withdrawn, CS.disputed],
        CS.under_review: [CS.approved, CS.rejected, CS.disputed],
        CS.disputed: [CS.approved, CS.rejected, CS.withdrawn],
        CS.approved: [CS.revoked, CS.superseded],
    },
    terminal=[CS.rejected, CS.revoked, CS.superseded, CS.withdrawn],
)

_SEG = re.compile(r"[\s\-_./\\]+")


def normalize_segment(value: str | None) -> str | None:
    """'b 01' -> 'B1', ' 0012 ' -> '12', 'Gr-3' -> 'GR3'. Leading zeros dropped from numeric runs."""
    if value is None:
        return None
    v = _SEG.sub("", value.strip().upper())
    if not v:
        return None
    if not re.fullmatch(r"[A-Z0-9]{1,20}", v):
        raise ValidationFailed("Identifiers may contain only letters and digits", code="invalid_identifier")
    return re.sub(r"(?<![0-9])0+(?=[0-9])", "", v)


def identity_key(district_code: str, group: str, building: str, unit: str | None) -> str:
    return f"{district_code}|{group}|{building}|{unit or '-'}"


class IdentityIn(BaseModel):
    project_id: uuid.UUID
    district_id: uuid.UUID
    group_code: str = Field(min_length=1, max_length=20)
    building_code: str = Field(min_length=1, max_length=20)
    unit_code: str | None = Field(default=None, max_length=20)
    property_type: PropertyType


class PropertyIn(IdentityIn):
    floor: int | None = Field(default=None, ge=-2, le=60)
    area_sqm: Decimal = Field(gt=10, le=5000, max_digits=8, decimal_places=2)
    garden_sqm: Decimal | None = Field(default=None, ge=0, le=5000, max_digits=8, decimal_places=2)
    bedrooms: int = Field(ge=0, le=12)
    bathrooms: int = Field(ge=1, le=12)
    finishing: Finishing
    delivery_status: DeliveryStatus
    orientation: Orientation | None = None


class ClaimIn(BaseModel):
    capacity: ClaimCapacity = ClaimCapacity.owner
    principal_name: str | None = Field(default=None, max_length=160)
    authority_scope: list[str] = Field(default_factory=list)
    authority_expires_on: date | None = None
    document_ids: list[uuid.UUID] = Field(min_length=1, max_length=10)
    note: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _rep(self) -> ClaimIn:
        if self.capacity == ClaimCapacity.legal_representative:
            if not self.principal_name or not self.authority_scope:
                raise rule_error("authority_details_required", "legal representatives must name the principal and the scope of authority")
            if not set(self.authority_scope) <= AUTHORITY_SCOPES:
                raise rule_error("invalid_authority_scope", f"authority_scope must be a subset of {sorted(AUTHORITY_SCOPES)}")
            if self.authority_expires_on and self.authority_expires_on <= date.today():
                raise rule_error("authority_expired", "authority has already expired")
        elif self.principal_name or self.authority_scope:
            raise rule_error("authority_not_applicable", "principal and scope apply only to legal representatives")
        return self


class RegisterPropertyIn(BaseModel):
    property: PropertyIn
    claim: ClaimIn


class PropertyOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    district_id: uuid.UUID
    group_code: str
    building_code: str
    unit_code: str | None
    floor: int | None
    property_type: PropertyType
    area_sqm: Decimal
    garden_sqm: Decimal | None
    bedrooms: int
    bathrooms: int
    finishing: Finishing
    delivery_status: DeliveryStatus
    orientation: Orientation | None
    identity_confirmed_at: datetime | None


class ClaimOut(ORM):
    id: uuid.UUID
    property_id: uuid.UUID
    capacity: ClaimCapacity
    principal_name: str | None
    authority_scope: list[str]
    authority_expires_on: date | None
    status: CS
    decision_note: str | None
    created_at: datetime


class MyPropertyOut(BaseModel):
    property: PropertyOut
    claim: ClaimOut
    live_listing_id: uuid.UUID | None
    live_listing_status: ListingStatus | None


class RegisterOut(MyPropertyOut):
    # True when the unit was already registered and the submission became an ownership claim on it.
    claimed_existing: bool = False


# Registering or claiming a unit is the only way to learn whether it is already registered, and it
# needs an ownership document plus reviewer attention, so it is limited per user (and per property).
CLAIMS_PER_USER_PER_DAY = 10
CLAIMS_PER_USER_PROPERTY_PER_MONTH = 3


def _limit_claims(user: User, prop_id: uuid.UUID | None = None) -> None:
    rate_limit.enforce(f"claim:user:{user.id}", CLAIMS_PER_USER_PER_DAY, 86400)
    if prop_id is not None:
        rate_limit.enforce(f"claim:user:{user.id}:property:{prop_id}", CLAIMS_PER_USER_PROPERTY_PER_MONTH, 30 * 86400)


def _resolve_identity(db: Session, body: IdentityIn) -> tuple[District, str, str, str, str | None]:
    district = db.get(District, body.district_id)
    if district is None or district.project_id != body.project_id:
        raise ValidationFailed("District does not belong to project", code="invalid_district")
    group = normalize_segment(body.group_code)
    building = normalize_segment(body.building_code)
    unit = normalize_segment(body.unit_code)
    if not group or not building:
        raise ValidationFailed("Group and building are required", code="incomplete_identity")
    if body.property_type in UNIT_REQUIRED and not unit:
        raise ValidationFailed("Unit number is required for this property type", code="incomplete_identity")
    if body.property_type in UNIT_FORBIDDEN and unit:
        raise ValidationFailed("Detached houses are identified by house number only", code="unexpected_unit")
    return district, group, building, unit, identity_key(district.code, group, building, unit)


def _validate_claim_docs(db: Session, user: User, claim: ClaimIn) -> list[str]:
    docs = get_owned_documents(db, user, claim.document_ids)
    kinds = {d.kind for d in docs}
    if not kinds & {DocumentKind.ownership_contract, DocumentKind.developer_statement}:
        raise ValidationFailed("An ownership contract or developer statement is required", code="ownership_document_required")
    if claim.capacity == ClaimCapacity.legal_representative and DocumentKind.power_of_attorney not in kinds:
        raise ValidationFailed("A power of attorney document is required", code="power_of_attorney_required")
    return [str(d.id) for d in docs]


def _create_claim(db: Session, user: User, prop: Property, claim_in: ClaimIn, doc_ids: list[str], ip: str | None) -> OwnershipClaim:
    existing_mine = db.scalar(
        select(OwnershipClaim.id).where(
            OwnershipClaim.property_id == prop.id, OwnershipClaim.claimant_id == user.id, OwnershipClaim.status.in_(ACTIVE_CLAIM)
        )
    )
    if existing_mine:
        raise Conflict("You already have an active claim on this property", code="claim_exists")
    approved = db.scalar(
        select(OwnershipClaim).where(OwnershipClaim.property_id == prop.id, OwnershipClaim.status == CS.approved).with_for_update()
    )
    claim = OwnershipClaim(
        property_id=prop.id, claimant_id=user.id, capacity=claim_in.capacity, principal_name=claim_in.principal_name,
        authority_scope=sorted(claim_in.authority_scope), authority_expires_on=claim_in.authority_expires_on,
        status=CS.disputed if approved else CS.submitted,
    )
    db.add(claim)
    db.flush()
    db.add(VerificationRequest(user_id=user.id, kind=VerificationKind.ownership, claim_id=claim.id, document_ids=doc_ids, note=claim_in.note))
    if approved:
        dispute = PropertyDispute(
            property_id=prop.id, challenger_claim_id=claim.id, existing_claim_id=approved.id, opened_by_id=user.id,
            reason=claim_in.note or "Competing ownership claim",
        )
        db.add(dispute)
        db.flush()
        notify(db, approved.claimant_id, "ownership_dispute_opened", property_id=prop.id)
        audit(db, "dispute.opened", "dispute", dispute.id, actor_id=user.id, ip=ip)
    audit(db, "claim.submitted", "claim", claim.id, actor_id=user.id, data={"property_id": str(prop.id), "capacity": claim.capacity.value}, ip=ip)
    return claim


@router.post("", response_model=RegisterOut, status_code=201)
def register_property(body: RegisterPropertyIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Register a unit with an ownership claim; if the unit already exists, the submission becomes a claim on it.

    There is deliberately no free "does this unit exist?" lookup: combined with the public listing fields
    (group, floor, type) it would reveal the private building and unit numbers of listed homes.
    """
    district, group, building, unit, key = _resolve_identity(db, body.property)
    doc_ids = _validate_claim_docs(db, user, body.claim)
    _limit_claims(user)
    p = body.property
    prop = Property(
        project_id=p.project_id, district_id=district.id, group_code=group, building_code=building, unit_code=unit,
        floor=p.floor, identity_key=key, property_type=p.property_type, area_sqm=p.area_sqm, garden_sqm=p.garden_sqm,
        bedrooms=p.bedrooms, bathrooms=p.bathrooms, finishing=p.finishing, delivery_status=p.delivery_status,
        orientation=p.orientation, created_by_id=user.id,
    )
    db.add(prop)
    claimed_existing = False
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        prop = db.scalar(select(Property).where(Property.project_id == p.project_id, Property.identity_key == key))
        if prop is None:  # pragma: no cover - the conflicting row was deleted concurrently
            raise
        rate_limit.enforce(f"claim:user:{user.id}:property:{prop.id}", CLAIMS_PER_USER_PROPERTY_PER_MONTH, 30 * 86400)
        claimed_existing = True
    claim = _create_claim(db, user, prop, body.claim, doc_ids, client_ip(request))
    if not claimed_existing:
        audit(db, "property.registered", "property", prop.id, actor_id=user.id, ip=client_ip(request))
    db.commit()
    return RegisterOut(property=PropertyOut.model_validate(prop), claim=ClaimOut.model_validate(claim), live_listing_id=None,
                       live_listing_status=None, claimed_existing=claimed_existing)


@router.post("/{property_id}/claims", response_model=ClaimOut, status_code=201)
def claim_property(property_id: uuid.UUID, body: ClaimIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    prop = db.get(Property, property_id)
    if prop is None:
        raise NotFound("Property not found")
    doc_ids = _validate_claim_docs(db, user, body)
    _limit_claims(user, prop.id)
    claim = _create_claim(db, user, prop, body, doc_ids, client_ip(request))
    db.commit()
    return claim


@router.post("/claims/{claim_id}/withdraw", response_model=ClaimOut)
def withdraw_claim(claim_id: uuid.UUID, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    claim = db.get(OwnershipClaim, claim_id, with_for_update=True)
    if claim is None or claim.claimant_id != user.id:
        raise NotFound("Claim not found")
    CLAIM_FSM.assert_transition(claim.status, CS.withdrawn)
    claim.status = CS.withdrawn
    for d in db.scalars(select(PropertyDispute).where(PropertyDispute.challenger_claim_id == claim.id, PropertyDispute.status == DisputeStatus.open)):
        d.status = DisputeStatus.dismissed
        d.resolution_note = "Challenger withdrew the claim"
    audit(db, "claim.withdrawn", "claim", claim.id, actor_id=user.id, ip=client_ip(request))
    db.commit()
    return claim


@router.get("/mine", response_model=list[MyPropertyOut])
def my_properties(user: User = Depends(current_user), db: Session = Depends(get_db)):
    claims = db.scalars(
        select(OwnershipClaim).options(joinedload(OwnershipClaim.property))
        .where(OwnershipClaim.claimant_id == user.id, OwnershipClaim.status.in_(ACTIVE_CLAIM))
        .order_by(OwnershipClaim.created_at.desc())
    ).all()
    out = []
    for c in claims:
        live = db.scalar(
            select(Listing).where(Listing.property_id == c.property_id, Listing.status.in_(LISTING_OCCUPYING_STATUSES))
        )
        mine = live if live and live.owner_id == user.id else None
        out.append(MyPropertyOut(
            property=PropertyOut.model_validate(c.property), claim=ClaimOut.model_validate(c),
            live_listing_id=mine.id if mine else None, live_listing_status=mine.status if mine else None,
        ))
    return out


# --------------------------------------------------------------------------- authorization helpers
def approved_claim_for(db: Session, user: User, property_id: uuid.UUID, scope: str = "list") -> OwnershipClaim:
    """Return the user's approved claim, enforcing representative scope and expiry."""
    claim = db.scalar(
        select(OwnershipClaim).where(
            OwnershipClaim.property_id == property_id, OwnershipClaim.claimant_id == user.id, OwnershipClaim.status == CS.approved
        )
    )
    if claim is None:
        raise Forbidden("Only the verified owner or an authorized representative may do this", code="not_property_owner")
    if claim.capacity == ClaimCapacity.legal_representative:
        if scope not in claim.authority_scope:
            raise Forbidden(f"Your authority does not include '{scope}'", code="authority_scope_insufficient")
        if claim.authority_expires_on and claim.authority_expires_on < date.today():
            raise Forbidden("Your authority has expired", code="authority_expired")
    return claim


# --------------------------------------------------------------------------- review services (used by admin)
def approve_claim(db: Session, reviewer: User, claim: OwnershipClaim, note: str | None, supersede_existing: bool, ip: str | None) -> None:
    current = db.scalar(
        select(OwnershipClaim).where(
            OwnershipClaim.property_id == claim.property_id, OwnershipClaim.status == CS.approved, OwnershipClaim.id != claim.id
        ).with_for_update()
    )
    open_dispute = db.scalar(
        select(PropertyDispute.id).where(PropertyDispute.challenger_claim_id == claim.id, PropertyDispute.status == DisputeStatus.open)
    )
    if open_dispute:
        raise Conflict("Resolve the open dispute for this claim instead", code="dispute_open")
    if current:
        if not supersede_existing or not note:
            raise Conflict("Another approved claim exists; superseding requires an explicit note", code="approved_claim_exists")
        CLAIM_FSM.assert_transition(current.status, CS.superseded)
        current.status = CS.superseded
        current.decided_at = utcnow()
        _close_listings_of(db, current, ListingStatus.withdrawn)
        notify(db, current.claimant_id, "ownership_superseded", property_id=claim.property_id)
    CLAIM_FSM.assert_transition(claim.status, CS.approved)
    claim.status = CS.approved
    claim.reviewer_id = reviewer.id
    claim.decision_note = note
    claim.decided_at = utcnow()
    prop = db.get(Property, claim.property_id)
    if prop and not prop.identity_confirmed_at:
        prop.identity_confirmed_at = utcnow()
    _close_verification(db, claim.id, VerificationStatus.approved, reviewer, note)
    db.flush()
    notify(db, claim.claimant_id, "ownership_claim_approved", property_id=claim.property_id)
    audit(db, "claim.approved", "claim", claim.id, actor_id=reviewer.id, data={"superseded": bool(current)}, ip=ip)


def reject_claim(db: Session, reviewer: User, claim: OwnershipClaim, note: str, ip: str | None) -> None:
    CLAIM_FSM.assert_transition(claim.status, CS.rejected)
    claim.status = CS.rejected
    claim.reviewer_id = reviewer.id
    claim.decision_note = note
    claim.decided_at = utcnow()
    _close_verification(db, claim.id, VerificationStatus.rejected, reviewer, note)
    notify(db, claim.claimant_id, "ownership_claim_rejected", property_id=claim.property_id)
    audit(db, "claim.rejected", "claim", claim.id, actor_id=reviewer.id, ip=ip)


def resolve_dispute(db: Session, admin: User, dispute: PropertyDispute, outcome: DisputeStatus, note: str, ip: str | None) -> None:
    if dispute.status != DisputeStatus.open:
        raise Conflict("Dispute already resolved", code="dispute_closed")
    if outcome == DisputeStatus.open:
        raise ValidationFailed("Choose a resolution", code="invalid_outcome")
    challenger = db.get(OwnershipClaim, dispute.challenger_claim_id, with_for_update=True)
    existing = db.get(OwnershipClaim, dispute.existing_claim_id, with_for_update=True) if dispute.existing_claim_id else None
    assert challenger is not None
    dispute.status = outcome
    dispute.resolution_note = note
    dispute.resolved_by_id = admin.id
    if outcome == DisputeStatus.resolved_for_challenger:
        if existing and existing.status == CS.approved:
            CLAIM_FSM.assert_transition(existing.status, CS.revoked)
            existing.status = CS.revoked
            existing.decision_note = note
            existing.decided_at = utcnow()
            _close_listings_of(db, existing, ListingStatus.withdrawn)
            notify(db, existing.claimant_id, "ownership_revoked", property_id=dispute.property_id)
        db.flush()
        CLAIM_FSM.assert_transition(challenger.status, CS.approved)
        challenger.status = CS.approved
        challenger.reviewer_id = admin.id
        challenger.decided_at = utcnow()
        _close_verification(db, challenger.id, VerificationStatus.approved, admin, note)
        notify(db, challenger.claimant_id, "ownership_claim_approved", property_id=dispute.property_id)
    else:
        if challenger.status in (CS.disputed, CS.submitted, CS.under_review):
            challenger.status = CS.rejected
            challenger.decision_note = note
            challenger.decided_at = utcnow()
            _close_verification(db, challenger.id, VerificationStatus.rejected, admin, note)
        notify(db, challenger.claimant_id, "ownership_claim_rejected", property_id=dispute.property_id)
    audit(db, "dispute.resolved", "dispute", dispute.id, actor_id=admin.id, data={"outcome": outcome.value}, ip=ip)


def _close_verification(db: Session, claim_id: uuid.UUID, status: VerificationStatus, reviewer: User, note: str | None) -> None:
    for vr in db.scalars(select(VerificationRequest).where(VerificationRequest.claim_id == claim_id, VerificationRequest.decided_at.is_(None))):
        vr.status = status
        vr.reviewer_id = reviewer.id
        vr.decision_note = note
        vr.decided_at = utcnow()


def _close_listings_of(db: Session, claim: OwnershipClaim, status: ListingStatus) -> None:
    """When authority ends, the claimant's live listing for that property is taken down."""
    for listing in db.scalars(
        select(Listing).where(Listing.claim_id == claim.id, Listing.status.in_(LISTING_OCCUPYING_STATUSES)).with_for_update()
    ):
        listing.status = status
        listing.moderation_note = "Ownership authority ended"
        cancel_open_deals(db, listing.id, "listing_withdrawn_ownership_ended")


def cancel_open_deals(db: Session, listing_id: uuid.UUID, reason: str) -> None:
    from app.models.entities import Deal, DealEvent, Offer
    from app.models.enums import DealStatus, OfferStatus

    for deal in db.scalars(
        select(Deal).where(
            Deal.listing_id == listing_id,
            Deal.status.notin_([DealStatus.cancelled, DealStatus.completed, DealStatus.lease_active]),
        ).with_for_update()
    ):
        deal.status = DealStatus.cancelled
        deal.cancel_reason = reason
        deal.closed_at = utcnow()
        for o in db.scalars(select(Offer).where(Offer.deal_id == deal.id, Offer.status == OfferStatus.pending)):
            o.status = OfferStatus.withdrawn
            o.responded_at = utcnow()
        db.add(DealEvent(deal_id=deal.id, type="deal.cancelled", data={"reason": reason}))
        notify(db, deal.buyer_id, "deal_cancelled", deal_id=deal.id)
        notify(db, deal.owner_id, "deal_cancelled", deal_id=deal.id)
