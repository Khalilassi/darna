from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from app.core.audit import audit
from app.core.db import get_db, utcnow
from app.core.deps import client_ip, current_user
from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.core.notify import notify
from app.core.state_machine import StateMachine
from app.models.entities import Listing, User, Viewing
from app.models.enums import LISTING_PUBLIC_STATUSES, ViewingStatus as VS
from app.schemas.common import ORM

router = APIRouter(prefix="/viewings", tags=["viewings"])

VIEWING_FSM = StateMachine(
    "viewing",
    {
        VS.requested: [VS.confirmed, VS.declined, VS.cancelled],
        VS.confirmed: [VS.completed, VS.no_show, VS.cancelled],
    },
    terminal=[VS.declined, VS.cancelled, VS.completed, VS.no_show],
)
# (action, who may perform it)
ACTIONS: dict[str, tuple[VS, set[str]]] = {
    "confirm": (VS.confirmed, {"owner"}),
    "decline": (VS.declined, {"owner"}),
    "cancel": (VS.cancelled, {"owner", "requester"}),
    "complete": (VS.completed, {"owner", "requester"}),
    "no_show": (VS.no_show, {"owner"}),
}


class ViewingIn(BaseModel):
    listing_id: uuid.UUID
    proposed_at: datetime
    note: str | None = Field(default=None, max_length=500)


class ViewingAction(BaseModel):
    action: Literal["confirm", "decline", "cancel", "complete", "no_show"]


class ViewingOut(ORM):
    id: uuid.UUID
    listing_id: uuid.UUID
    requester_id: uuid.UUID
    owner_id: uuid.UUID
    proposed_at: datetime
    status: VS
    note: str | None
    created_at: datetime


class ViewingWithListing(ViewingOut):
    listing_title: str
    my_role: str


@router.post("", response_model=ViewingOut, status_code=201)
def request_viewing(body: ViewingIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    listing = db.get(Listing, body.listing_id)
    if listing is None or listing.status not in LISTING_PUBLIC_STATUSES:
        raise NotFound("Listing not found")
    if listing.owner_id == user.id:
        raise Forbidden("You cannot book a viewing of your own listing", code="own_listing")
    if body.proposed_at.tzinfo is None:
        raise ValidationFailed("proposed_at must include a timezone", code="timezone_required")
    if not utcnow() + timedelta(hours=2) <= body.proposed_at <= utcnow() + timedelta(days=60):
        raise ValidationFailed("Choose a time between 2 hours and 60 days from now", code="invalid_viewing_time")
    open_one = db.scalar(select(Viewing.id).where(
        Viewing.listing_id == listing.id, Viewing.requester_id == user.id, Viewing.status.in_([VS.requested, VS.confirmed])))
    if open_one:
        raise Conflict("You already have an open viewing for this listing", code="viewing_exists")
    v = Viewing(listing_id=listing.id, requester_id=user.id, owner_id=listing.owner_id, proposed_at=body.proposed_at, note=body.note)
    db.add(v)
    db.flush()
    notify(db, listing.owner_id, "viewing_requested", viewing_id=v.id)
    audit(db, "viewing.requested", "viewing", v.id, actor_id=user.id, ip=client_ip(request))
    db.commit()
    return v


@router.get("", response_model=list[ViewingWithListing])
def my_viewings(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Viewing).options(joinedload(Viewing.listing))
                      .where(or_(Viewing.requester_id == user.id, Viewing.owner_id == user.id))
                      .order_by(Viewing.proposed_at.desc())).all()
    return [ViewingWithListing(**ViewingOut.model_validate(v).model_dump(), listing_title=v.listing.title,
                               my_role="owner" if v.owner_id == user.id else "requester") for v in rows]


@router.post("/{viewing_id}/actions", response_model=ViewingOut)
def act(viewing_id: uuid.UUID, body: ViewingAction, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    v = db.get(Viewing, viewing_id, with_for_update=True)
    if v is None or user.id not in (v.owner_id, v.requester_id):
        raise NotFound("Viewing not found")
    role = "owner" if user.id == v.owner_id else "requester"
    target, allowed = ACTIONS[body.action]
    if role not in allowed:
        raise Forbidden("Not allowed for your role", code="action_not_allowed")
    VIEWING_FSM.assert_transition(v.status, target)
    if target in (VS.completed, VS.no_show) and v.proposed_at > utcnow():
        raise Conflict("The viewing has not happened yet", code="viewing_in_future")
    v.status = target
    notify(db, v.requester_id if role == "owner" else v.owner_id, f"viewing_{target.value}", viewing_id=v.id)
    audit(db, "viewing.status_changed", "viewing", v.id, actor_id=user.id, data={"to": target.value}, ip=client_ip(request))
    db.commit()
    return v
