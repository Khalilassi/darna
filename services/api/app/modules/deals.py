"""Negotiation & transaction workspace.

A *Deal* is the persistent workspace for one buyer/tenant and one listing. It starts in
``negotiating`` with structured offers. Accepting an offer moves it to a PRELIMINARY,
non-binding status (``offer_accepted`` / ``terms_agreed``). Later milestones record what the
parties did off-platform (signing, developer transfer, handover). The platform never claims that
a legal ownership transfer happened: see ``LEGAL_NOTICE``.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.audit import audit
from app.core.config import get_settings
from app.core.db import get_db, utcnow
from app.core.deps import client_ip, current_user, idempotency_key
from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.core.idempotency import run_idempotent
from app.core.notify import notify
from app.core.state_machine import StateMachine
from app.models.entities import ChecklistItem, Deal, DealEvent, Document, Listing, Offer, User
from app.models.enums import (
    ChecklistStatus,
    DealKind,
    ListingPurpose,
    ListingStatus,
    OfferStatus,
    PartyRole,
)
from app.models.enums import (
    DealStatus as DS,
)
from app.modules import listings as listings_mod
from app.modules.properties import approved_claim_for
from app.schemas.common import ORM

router = APIRouter(prefix="/deals", tags=["deals"])

LEGAL_NOTICE = (
    "Statuses in this workspace record what the parties report. They are not a legal transfer of ownership, "
    "registration, developer approval or a payment. Those happen through the developer, notaries, registries and "
    "licensed professionals outside the platform."
)

Who = Literal["either", "both", "owner", "buyer", "system"]

SALE_FSM = StateMachine(
    "sale_deal",
    {
        DS.negotiating: [DS.offer_accepted, DS.cancelled],
        DS.offer_accepted: [DS.due_diligence, DS.cancelled],
        DS.due_diligence: [DS.contract_preparation, DS.cancelled],
        DS.contract_preparation: [DS.contract_signed, DS.cancelled],
        DS.contract_signed: [DS.developer_transfer, DS.cancelled],
        DS.developer_transfer: [DS.completed, DS.cancelled],
    },
    terminal=[DS.completed, DS.cancelled],
)
RENT_FSM = StateMachine(
    "rent_deal",
    {
        DS.negotiating: [DS.terms_agreed, DS.cancelled],
        DS.terms_agreed: [DS.lease_preparation, DS.cancelled],
        DS.lease_preparation: [DS.lease_signed, DS.cancelled],
        DS.lease_signed: [DS.handover_scheduled, DS.cancelled],
        DS.handover_scheduled: [DS.lease_active, DS.cancelled],
        DS.lease_active: [DS.completed],
    },
    terminal=[DS.completed, DS.cancelled],
)
FSM = {DealKind.sale: SALE_FSM, DealKind.rent: RENT_FSM}

# Who may move the deal INTO a status.
WHO: dict[DS, Who] = {
    DS.offer_accepted: "system", DS.terms_agreed: "system",
    DS.due_diligence: "either", DS.contract_preparation: "both", DS.contract_signed: "both",
    DS.developer_transfer: "either", DS.completed: "both",
    DS.lease_preparation: "either", DS.lease_signed: "both", DS.handover_scheduled: "owner",
    DS.lease_active: "both", DS.cancelled: "either",
}

# (code, responsible party, status that requires it to be complete)
CHECKLISTS: dict[DealKind, list[tuple[str, PartyRole, DS]]] = {
    DealKind.sale: [
        ("ownership_contract", PartyRole.owner, DS.contract_preparation),
        ("developer_statement", PartyRole.owner, DS.contract_preparation),
        ("buyer_identity", PartyRole.buyer, DS.contract_signed),
        ("owner_identity", PartyRole.owner, DS.contract_signed),
        ("signed_sale_contract", PartyRole.owner, DS.developer_transfer),
        ("maintenance_clearance", PartyRole.owner, DS.completed),
        ("developer_assignment_record", PartyRole.buyer, DS.completed),
    ],
    DealKind.rent: [
        ("ownership_proof", PartyRole.owner, DS.lease_preparation),
        ("tenant_identity", PartyRole.buyer, DS.lease_signed),
        ("owner_identity", PartyRole.owner, DS.lease_signed),
        ("signed_lease_contract", PartyRole.owner, DS.handover_scheduled),
        ("handover_inventory", PartyRole.owner, DS.lease_active),
    ],
}
DONE = (ChecklistStatus.accepted, ChecklistStatus.waived)


# --------------------------------------------------------------------------- schemas
class OfferTerms(BaseModel):
    # sale
    proposed_handover_date: date | None = None
    payment_note: str | None = Field(default=None, max_length=300)
    # rent
    lease_months: int | None = Field(default=None, ge=1, le=120)
    start_date: date | None = None
    furnished: bool | None = None


class OfferIn(BaseModel):
    listing_id: uuid.UUID
    kind: DealKind
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    terms: OfferTerms = Field(default_factory=OfferTerms)
    message: str | None = Field(default=None, max_length=1000)
    expires_in_hours: int | None = Field(default=None, ge=1, le=168)


class CounterIn(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    terms: OfferTerms = Field(default_factory=OfferTerms)
    message: str | None = Field(default=None, max_length=1000)
    expires_in_hours: int | None = Field(default=None, ge=1, le=168)


class OfferOut(ORM):
    id: uuid.UUID
    made_by: PartyRole
    amount: Decimal
    terms: dict
    message: str | None
    status: OfferStatus
    expires_at: datetime
    responded_at: datetime | None
    parent_offer_id: uuid.UUID | None
    created_at: datetime


class ChecklistOut(ORM):
    id: uuid.UUID
    code: str
    responsible: PartyRole
    required_for: DS
    status: ChecklistStatus
    document_id: uuid.UUID | None
    allowed_actions: list[Literal["submit", "accept", "waive", "reopen"]] = []


class EventOut(ORM):
    id: uuid.UUID
    actor_id: uuid.UUID | None
    type: str
    data: dict
    created_at: datetime


class DealSummary(BaseModel):
    id: uuid.UUID
    listing_id: uuid.UUID
    listing_title: str
    kind: DealKind
    status: DS
    my_role: PartyRole
    counterpart_name: str
    latest_offer: OfferOut | None
    updated_at: datetime


class NextStep(BaseModel):
    status: DS
    who: Who
    my_confirmation_given: bool
    counterpart_confirmation_given: bool
    blocking_items: list[str]


class DealOut(DealSummary):
    agreed_terms: dict | None
    offers: list[OfferOut]
    checklist: list[ChecklistOut]
    events: list[EventOut]
    next_steps: list[NextStep]
    can_cancel: bool
    property_disclosure: dict | None
    legal_notice: str = LEGAL_NOTICE
    cancel_reason: str | None
    closed_at: datetime | None


class AdvanceIn(BaseModel):
    target: DS


class CancelIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class ChecklistUpdate(BaseModel):
    action: Literal["submit", "accept", "waive", "reopen"]
    document_id: uuid.UUID | None = None


# --------------------------------------------------------------------------- helpers
def _role(deal: Deal, user: User) -> PartyRole:
    if deal.buyer_id == user.id:
        return PartyRole.buyer
    if deal.owner_id == user.id:
        return PartyRole.owner
    raise NotFound("Deal not found")


def _other(deal: Deal, role: PartyRole) -> uuid.UUID:
    return deal.owner_id if role == PartyRole.buyer else deal.buyer_id


def _event(db: Session, deal: Deal, actor: User | None, type_: str, **data) -> None:
    db.add(DealEvent(deal_id=deal.id, actor_id=actor.id if actor else None, type=type_, data={k: str(v) for k, v in data.items()}))


def expire_stale_offers(db: Session, deal: Deal) -> None:
    now = utcnow()
    for o in db.scalars(select(Offer).where(Offer.deal_id == deal.id, Offer.status == OfferStatus.pending, Offer.expires_at < now)):
        o.status = OfferStatus.expired
        o.responded_at = now
        _event(db, deal, None, "offer.expired", offer_id=o.id)


def expire_all_offers(db: Session) -> int:
    now = utcnow()
    n = 0
    for o in db.scalars(select(Offer).where(Offer.status == OfferStatus.pending, Offer.expires_at < now).with_for_update(skip_locked=True)):
        o.status = OfferStatus.expired
        o.responded_at = now
        db.add(DealEvent(deal_id=o.deal_id, type="offer.expired", data={"offer_id": str(o.id)}))
        n += 1
    return n


def _expiry(hours: int | None) -> datetime:
    return utcnow() + timedelta(hours=hours or get_settings().offer_default_expiry_hours)


def _load_deal(db: Session, deal_id: uuid.UUID, lock: bool = False) -> Deal:
    if lock:
        deal = db.scalar(select(Deal).where(Deal.id == deal_id).with_for_update())
    else:
        deal = db.scalar(select(Deal).where(Deal.id == deal_id).options(
            joinedload(Deal.listing), selectinload(Deal.offers), selectinload(Deal.checklist), selectinload(Deal.events)))
    if deal is None:
        raise NotFound("Deal not found")
    return deal


def _check_owner_authority(db: Session, deal: Deal, user: User, scope: str) -> None:
    listing = db.get(Listing, deal.listing_id)
    assert listing is not None
    approved_claim_for(db, user, listing.property_id, scope=scope)


def _blocking(deal: Deal, target: DS) -> list[str]:
    return [c.code for c in deal.checklist if c.required_for == target and c.status not in DONE]


CHECKLIST_ACTIONS = ("submit", "accept", "waive", "reopen")


def checklist_action_error(deal: Deal, item: ChecklistItem, role: PartyRole, action: str) -> Exception | None:
    """Single source of truth for checklist permissions: the endpoint raises the returned
    error, and responses advertise the actions for which it is None."""
    if deal.status in (DS.negotiating, DS.cancelled, DS.completed):
        return Conflict("The checklist is available once terms are agreed", code="checklist_unavailable")
    if action == "submit":
        if item.responsible != role:
            return Forbidden("This item is the other party's responsibility", code="not_responsible")
        if item.status != ChecklistStatus.pending:
            return Conflict("Item already submitted", code="checklist_item_closed")
    elif action in ("accept", "waive"):
        if item.responsible == role:
            return Forbidden("The counterparty reviews this item", code="not_reviewer")
        if action == "accept" and item.status != ChecklistStatus.submitted:
            return Conflict("Item has not been submitted", code="checklist_item_not_submitted")
        if item.status in DONE:
            return Conflict("Item already closed", code="checklist_item_closed")
    elif action == "reopen":
        if item.responsible == role or item.status != ChecklistStatus.submitted:
            return Conflict("Only a submitted item can be sent back by the reviewer", code="checklist_item_not_submitted")
    return None


def _checklist_out(deal: Deal, item: ChecklistItem, role: PartyRole) -> ChecklistOut:
    out = ChecklistOut.model_validate(item)
    out.allowed_actions = [a for a in CHECKLIST_ACTIONS if checklist_action_error(deal, item, role, a) is None]
    return out


def _out(db: Session, deal: Deal, user: User) -> DealOut:
    role = _role(deal, user)
    fsm = FSM[deal.kind]
    other = db.get(User, _other(deal, role))
    steps = []
    for target in fsm.allowed_from(deal.status):
        t = DS(target)
        if t == DS.cancelled or WHO[t] == "system":
            continue
        confirmed = deal.confirmations.get(t.value, [])
        steps.append(NextStep(status=t, who=WHO[t], my_confirmation_given=role.value in confirmed,
                              counterpart_confirmation_given=(PartyRole.owner if role == PartyRole.buyer else PartyRole.buyer).value in confirmed,
                              blocking_items=_blocking(deal, t)))
    disclosure = None
    if deal.status not in (DS.negotiating, DS.cancelled):
        prop = deal.listing.property
        disclosure = {"group": prop.group_code, "building": prop.building_code, "unit": prop.unit_code, "floor": prop.floor}
    latest = deal.offers[-1] if deal.offers else None
    return DealOut(
        id=deal.id, listing_id=deal.listing_id, listing_title=deal.listing.title, kind=deal.kind, status=deal.status,
        my_role=role, counterpart_name=other.full_name.split(" ")[0] if other else "",
        latest_offer=OfferOut.model_validate(latest) if latest else None, updated_at=deal.updated_at,
        agreed_terms=deal.agreed_terms, offers=[OfferOut.model_validate(o) for o in deal.offers],
        checklist=[_checklist_out(deal, c, role) for c in deal.checklist],
        events=[EventOut.model_validate(e) for e in deal.events], next_steps=steps,
        can_cancel=fsm.can(deal.status, DS.cancelled), property_disclosure=disclosure,
        cancel_reason=deal.cancel_reason, closed_at=deal.closed_at,
    )


def _reload_out(db: Session, deal_id: uuid.UUID, user: User) -> DealOut:
    db.expire_all()
    return _out(db, _load_deal(db, deal_id), user)


# --------------------------------------------------------------------------- offers
@router.post("/offers", response_model=DealOut, status_code=201)
def make_offer(body: OfferIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db),
               idem: str | None = Depends(idempotency_key)):
    def run():
        listing = db.scalar(select(Listing).where(Listing.id == body.listing_id).with_for_update())
        if listing is None or listing.status not in (ListingStatus.active,):
            raise Conflict("This listing is not accepting offers", code="listing_not_accepting_offers")
        if listing.owner_id == user.id:
            raise Forbidden("You cannot make an offer on your own listing", code="own_listing")
        allowed = {ListingPurpose.sale: {DealKind.sale}, ListingPurpose.rent: {DealKind.rent},
                   ListingPurpose.sale_and_rent: {DealKind.sale, DealKind.rent}}[listing.purpose]
        if body.kind not in allowed:
            raise ValidationFailed("This listing does not accept that type of offer", code="offer_kind_mismatch")
        if body.kind == DealKind.rent and not body.terms.lease_months:
            raise ValidationFailed("lease_months is required for rental offers", code="lease_months_required")
        deal = db.scalar(select(Deal).where(Deal.listing_id == listing.id, Deal.buyer_id == user.id,
                                            Deal.kind == body.kind, Deal.status == DS.negotiating).with_for_update())
        if deal is None:
            deal = Deal(listing_id=listing.id, kind=body.kind, buyer_id=user.id, owner_id=listing.owner_id, confirmations={})
            db.add(deal)
            db.flush()
            for i, (code, who, req) in enumerate(CHECKLISTS[body.kind]):
                db.add(ChecklistItem(deal_id=deal.id, code=code, responsible=who, required_for=req, position=i))
            _event(db, deal, user, "deal.opened", kind=body.kind.value)
        expire_stale_offers(db, deal)
        db.flush()
        pending = db.scalar(select(Offer).where(Offer.deal_id == deal.id, Offer.status == OfferStatus.pending))
        if pending:
            raise Conflict("There is already a pending offer in this negotiation", code="offer_pending")
        offer = Offer(deal_id=deal.id, made_by=PartyRole.buyer, author_id=user.id, amount=body.amount,
                      terms=body.terms.model_dump(mode="json", exclude_none=True), message=body.message,
                      expires_at=_expiry(body.expires_in_hours))
        db.add(offer)
        try:
            db.flush()
        except IntegrityError as exc:
            db.rollback()
            raise Conflict("There is already a pending offer in this negotiation", code="offer_pending") from exc
        _event(db, deal, user, "offer.made", offer_id=offer.id, amount=offer.amount)
        notify(db, deal.owner_id, "offer_received", deal_id=deal.id)
        audit(db, "offer.made", "offer", offer.id, actor_id=user.id, ip=client_ip(request))
        db.commit()
        return _reload_out(db, deal.id, user)

    return run_idempotent(db, user, idem, "offer.make", body, run)


def _pending_offer(db: Session, deal: Deal, offer_id: uuid.UUID) -> Offer:
    expire_stale_offers(db, deal)
    db.flush()
    offer = db.scalar(select(Offer).where(Offer.id == offer_id, Offer.deal_id == deal.id).with_for_update())
    if offer is None:
        raise NotFound("Offer not found")
    if offer.status != OfferStatus.pending:
        raise Conflict(f"Offer is {offer.status.value}", code="offer_not_pending", details={"status": offer.status.value})
    return offer


@router.post("/{deal_id}/offers/{offer_id}/counter", response_model=DealOut)
def counter(deal_id: uuid.UUID, offer_id: uuid.UUID, body: CounterIn, request: Request, user: User = Depends(current_user),
            db: Session = Depends(get_db), idem: str | None = Depends(idempotency_key)):
    def run():
        deal = _load_deal(db, deal_id, lock=True)
        role = _role(deal, user)
        if deal.status != DS.negotiating:
            raise Conflict("Negotiation is closed", code="negotiation_closed")
        if role == PartyRole.owner:
            _check_owner_authority(db, deal, user, "negotiate")
        offer = _pending_offer(db, deal, offer_id)
        if offer.made_by == role:
            raise Forbidden("You cannot counter your own offer", code="own_offer")
        if deal.kind == DealKind.rent and not (body.terms.lease_months or offer.terms.get("lease_months")):
            raise ValidationFailed("lease_months is required for rental offers", code="lease_months_required")
        offer.status = OfferStatus.countered
        offer.responded_at = utcnow()
        db.flush()
        terms = {**offer.terms, **body.terms.model_dump(mode="json", exclude_none=True)}
        new = Offer(deal_id=deal.id, made_by=role, author_id=user.id, amount=body.amount, terms=terms,
                    message=body.message, expires_at=_expiry(body.expires_in_hours), parent_offer_id=offer.id)
        db.add(new)
        db.flush()
        _event(db, deal, user, "offer.countered", offer_id=new.id, amount=new.amount)
        notify(db, _other(deal, role), "offer_countered", deal_id=deal.id)
        audit(db, "offer.countered", "offer", new.id, actor_id=user.id, ip=client_ip(request))
        deal.version += 1
        db.commit()
        return _reload_out(db, deal.id, user)

    return run_idempotent(db, user, idem, f"offer.counter.{offer_id}", body, run)


class RespondIn(BaseModel):
    action: Literal["accept", "reject", "withdraw"]


@router.post("/{deal_id}/offers/{offer_id}/respond", response_model=DealOut)
def respond(deal_id: uuid.UUID, offer_id: uuid.UUID, body: RespondIn, request: Request, user: User = Depends(current_user),
            db: Session = Depends(get_db), idem: str | None = Depends(idempotency_key)):
    def run():
        deal = _load_deal(db, deal_id, lock=True)
        role = _role(deal, user)
        if deal.status != DS.negotiating:
            raise Conflict("Negotiation is closed", code="negotiation_closed")
        offer = _pending_offer(db, deal, offer_id)
        if body.action == "withdraw":
            if offer.made_by != role:
                raise Forbidden("Only the author can withdraw an offer", code="not_offer_author")
            offer.status = OfferStatus.withdrawn
        else:
            if offer.made_by == role:
                raise Forbidden("You cannot respond to your own offer", code="own_offer")
            if role == PartyRole.owner:
                _check_owner_authority(db, deal, user, "negotiate")
            if body.action == "reject":
                offer.status = OfferStatus.rejected
            else:
                _accept(db, deal, offer, user)
        offer.responded_at = utcnow()
        _event(db, deal, user, f"offer.{body.action}ed" if body.action != "withdraw" else "offer.withdrawn", offer_id=offer.id)
        notify(db, _other(deal, role), f"offer_{body.action}ed" if body.action != "withdraw" else "offer_withdrawn", deal_id=deal.id)
        audit(db, f"offer.{body.action}", "offer", offer.id, actor_id=user.id, ip=client_ip(request))
        deal.version += 1
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise Conflict("Another offer on this listing was already accepted", code="listing_already_committed") from exc
        return _reload_out(db, deal.id, user)

    return run_idempotent(db, user, idem, f"offer.respond.{offer_id}", body, run)


def _accept(db: Session, deal: Deal, offer: Offer, user: User) -> None:
    # Lock the listing row: serializes concurrent acceptances on the same listing.
    listing = db.scalar(select(Listing).where(Listing.id == deal.listing_id).with_for_update())
    assert listing is not None
    if listing.status != ListingStatus.active:
        raise Conflict("This listing is no longer available", code="listing_not_accepting_offers")
    target = DS.offer_accepted if deal.kind == DealKind.sale else DS.terms_agreed
    FSM[deal.kind].assert_transition(deal.status, target)
    offer.status = OfferStatus.accepted
    deal.status = target
    deal.agreed_terms = {"amount": str(offer.amount), "offer_id": str(offer.id), **offer.terms, "preliminary": True}
    listings_mod.transition(db, listing, ListingStatus.under_offer, user)
    db.flush()
    # Other negotiations on this listing stay open but cannot accept while under offer; let them know.
    for other in db.scalars(select(Deal).where(Deal.listing_id == listing.id, Deal.id != deal.id, Deal.status == DS.negotiating)):
        notify(db, other.buyer_id, "listing_under_offer", deal_id=other.id)


# --------------------------------------------------------------------------- workspace
@router.get("", response_model=list[DealSummary])
def my_deals(user: User = Depends(current_user), db: Session = Depends(get_db)):
    deals = db.scalars(select(Deal).options(joinedload(Deal.listing), selectinload(Deal.offers))
                       .where(or_(Deal.buyer_id == user.id, Deal.owner_id == user.id)).order_by(Deal.updated_at.desc())).all()
    out = []
    for d in deals:
        role = _role(d, user)
        other = db.get(User, _other(d, role))
        latest = d.offers[-1] if d.offers else None
        out.append(DealSummary(id=d.id, listing_id=d.listing_id, listing_title=d.listing.title, kind=d.kind, status=d.status,
                               my_role=role, counterpart_name=other.full_name.split(" ")[0] if other else "",
                               latest_offer=OfferOut.model_validate(latest) if latest else None, updated_at=d.updated_at))
    return out


@router.get("/{deal_id}", response_model=DealOut)
def get_deal(deal_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    deal = _load_deal(db, deal_id)
    _role(deal, user)
    expire_stale_offers(db, deal)
    db.commit()
    return _reload_out(db, deal_id, user)


@router.post("/{deal_id}/advance", response_model=DealOut)
def advance(deal_id: uuid.UUID, body: AdvanceIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db),
            idem: str | None = Depends(idempotency_key)):
    def run():
        deal = _load_deal(db, deal_id, lock=True)
        role = _role(deal, user)
        target = body.target
        fsm = FSM[deal.kind]
        fsm.assert_transition(deal.status, target)
        who = WHO.get(target, "system")
        if target == DS.cancelled:
            raise ValidationFailed("Use the cancel endpoint", code="use_cancel")
        if who == "system" or (who in ("owner", "buyer") and who != role.value):
            raise Forbidden("This step is not yours to take", code="action_not_allowed")
        if role == PartyRole.owner:
            _check_owner_authority(db, deal, user, "sign" if target in (DS.contract_signed, DS.lease_signed, DS.completed) else "negotiate")
        items = db.scalars(select(ChecklistItem).where(ChecklistItem.deal_id == deal.id)).all()
        blocking = [c.code for c in items if c.required_for == target and c.status not in DONE]
        if blocking:
            raise Conflict("Complete the required checklist items first", code="checklist_incomplete", details={"items": blocking})
        confirmations = dict(deal.confirmations or {})
        if who == "both":
            given = set(confirmations.get(target.value, []))
            given.add(role.value)
            confirmations[target.value] = sorted(given)
            deal.confirmations = confirmations
            _event(db, deal, user, "milestone.confirmed", target=target.value, by=role.value)
            if given != {"buyer", "owner"}:
                notify(db, _other(deal, role), "milestone_confirmation_requested", deal_id=deal.id, target=target.value)
                deal.version += 1
                db.commit()
                return _reload_out(db, deal.id, user)
        previous = deal.status
        deal.status = target
        deal.confirmations = {}
        _event(db, deal, user, "deal.status_changed", **{"from": previous.value, "to": target.value})
        listing = db.scalar(select(Listing).where(Listing.id == deal.listing_id).with_for_update())
        assert listing is not None
        if target == DS.completed and deal.kind == DealKind.sale:
            deal.closed_at = utcnow()
            listings_mod.transition(db, listing, ListingStatus.sold, user)
        elif target == DS.lease_active:
            listings_mod.transition(db, listing, ListingStatus.rented, user)
        elif target == DS.completed:
            deal.closed_at = utcnow()
        notify(db, _other(deal, role), "deal_status_changed", deal_id=deal.id, status=target.value)
        audit(db, "deal.status_changed", "deal", deal.id, actor_id=user.id, data={"from": previous.value, "to": target.value},
              ip=client_ip(request))
        deal.version += 1
        db.commit()
        return _reload_out(db, deal.id, user)

    return run_idempotent(db, user, idem, f"deal.advance.{deal_id}", body, run)


@router.post("/{deal_id}/cancel", response_model=DealOut)
def cancel(deal_id: uuid.UUID, body: CancelIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    deal = _load_deal(db, deal_id, lock=True)
    role = _role(deal, user)
    FSM[deal.kind].assert_transition(deal.status, DS.cancelled)
    previous = deal.status
    deal.status = DS.cancelled
    deal.cancel_reason = body.reason
    deal.closed_at = utcnow()
    for o in db.scalars(select(Offer).where(Offer.deal_id == deal.id, Offer.status == OfferStatus.pending)):
        o.status = OfferStatus.withdrawn
        o.responded_at = utcnow()
    listing = db.scalar(select(Listing).where(Listing.id == deal.listing_id).with_for_update())
    assert listing is not None
    if previous != DS.negotiating and listing.status == ListingStatus.under_offer:
        listings_mod.transition(db, listing, ListingStatus.active, user)
    _event(db, deal, user, "deal.cancelled", reason=body.reason, by=role.value)
    notify(db, _other(deal, role), "deal_cancelled", deal_id=deal.id)
    audit(db, "deal.cancelled", "deal", deal.id, actor_id=user.id, data={"from": previous.value}, ip=client_ip(request))
    db.commit()
    return _reload_out(db, deal.id, user)


@router.post("/{deal_id}/checklist/{item_id}", response_model=DealOut)
def update_checklist(deal_id: uuid.UUID, item_id: uuid.UUID, body: ChecklistUpdate, request: Request,
                     user: User = Depends(current_user), db: Session = Depends(get_db)):
    deal = _load_deal(db, deal_id, lock=True)
    role = _role(deal, user)
    if deal.status in (DS.negotiating, DS.cancelled, DS.completed):
        raise Conflict("The checklist is available once terms are agreed", code="checklist_unavailable")
    item = db.scalar(select(ChecklistItem).where(ChecklistItem.id == item_id, ChecklistItem.deal_id == deal.id).with_for_update())
    if item is None:
        raise NotFound("Checklist item not found")
    err = checklist_action_error(deal, item, role, body.action)
    if err is not None:
        raise err
    if body.action == "submit":
        if body.document_id:
            doc = db.get(Document, body.document_id, with_for_update=True)  # vs. concurrent delete
            if doc is None or doc.owner_id != user.id or doc.deleted_at:
                raise ValidationFailed("Unknown document", code="invalid_document_reference")
            item.document_id = doc.id
        item.status = ChecklistStatus.submitted
    elif body.action in ("accept", "waive"):
        item.status = ChecklistStatus.accepted if body.action == "accept" else ChecklistStatus.waived
    elif body.action == "reopen":
        item.status = ChecklistStatus.pending
    _event(db, deal, user, f"checklist.{body.action}", code=item.code)
    notify(db, _other(deal, role), "checklist_updated", deal_id=deal.id, code=item.code)
    audit(db, "deal.checklist", "deal", deal.id, actor_id=user.id, data={"code": item.code, "action": body.action}, ip=client_ip(request))
    deal.version += 1
    db.commit()
    return _reload_out(db, deal.id, user)
