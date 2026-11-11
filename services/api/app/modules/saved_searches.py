"""Saved searches and new-listing alerts (alerts are sent by the worker, see app.worker)."""
from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.db import get_db, utcnow
from app.core.deps import current_user
from app.core.errors import Conflict, NotFound
from app.core.notify import notify
from app.models.entities import Listing, Property, SavedSearch, User
from app.modules.listings import ListingCard, SearchFilters, SortKey, run_search, search_conditions
from app.schemas.common import Ok, Page

router = APIRouter(prefix="/saved-searches", tags=["saved searches"])
MAX_PER_USER = 20


class SavedSearchIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    filters: SearchFilters
    alerts_enabled: bool = True


class SavedSearchUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    filters: SearchFilters | None = None
    alerts_enabled: bool | None = None


class SavedSearchOut(BaseModel):
    id: uuid.UUID
    name: str
    filters: SearchFilters
    alerts_enabled: bool
    new_since_last_alert: int
    created_at: datetime


def _new_count(db: Session, s: SavedSearch) -> int:
    conds, _ = search_conditions(SearchFilters(**s.filters))
    return db.scalar(
        select(func.count()).select_from(Listing).join(Property, Listing.property_id == Property.id)
        .where(and_(*conds), Listing.published_at > s.last_alerted_at, Listing.owner_id != s.user_id)
    ) or 0


def _out(db: Session, s: SavedSearch) -> SavedSearchOut:
    return SavedSearchOut(id=s.id, name=s.name, filters=SearchFilters(**s.filters), alerts_enabled=s.alerts_enabled,
                          new_since_last_alert=_new_count(db, s), created_at=s.created_at)


def _owned(db: Session, user: User, sid: uuid.UUID) -> SavedSearch:
    s = db.get(SavedSearch, sid)
    if s is None or s.user_id != user.id:
        raise NotFound("Saved search not found")
    return s


@router.get("", response_model=list[SavedSearchOut])
def list_saved(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(SavedSearch).where(SavedSearch.user_id == user.id).order_by(SavedSearch.created_at.desc())).all()
    return [_out(db, s) for s in rows]


@router.post("", response_model=SavedSearchOut, status_code=201)
def create(body: SavedSearchIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    count = db.scalar(select(func.count()).select_from(SavedSearch).where(SavedSearch.user_id == user.id)) or 0
    if count >= MAX_PER_USER:
        raise Conflict(f"You can keep up to {MAX_PER_USER} saved searches", code="too_many_saved_searches")
    s = SavedSearch(user_id=user.id, name=body.name.strip(), filters=body.filters.model_dump(mode="json", exclude_defaults=True),
                    alerts_enabled=body.alerts_enabled, last_alerted_at=utcnow())
    db.add(s)
    db.commit()
    return _out(db, s)


@router.patch("/{saved_id}", response_model=SavedSearchOut)
def update(saved_id: uuid.UUID, body: SavedSearchUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = _owned(db, user, saved_id)
    if body.name is not None:
        s.name = body.name.strip()
    if body.filters is not None:
        s.filters = body.filters.model_dump(mode="json", exclude_defaults=True)
        s.last_alerted_at = utcnow()  # changed criteria: only listings published from now on are "new"
    if body.alerts_enabled is not None:
        s.alerts_enabled = body.alerts_enabled
    db.commit()
    return _out(db, s)


@router.delete("/{saved_id}", response_model=Ok)
def delete(saved_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(_owned(db, user, saved_id))
    db.commit()
    return Ok()


@router.get("/{saved_id}/results", response_model=Page[ListingCard])
def results(saved_id: uuid.UUID, sort: SortKey = "newest", page: int = Query(default=1, ge=1),
            page_size: int = Query(default=20, ge=1, le=50), mark_seen: bool = False,
            user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = _owned(db, user, saved_id)
    out = run_search(db, SearchFilters(**s.filters), sort, page, page_size)
    if mark_seen:
        s.last_alerted_at = utcnow()
        db.commit()
    return out


# --------------------------------------------------------------------------- worker job
def send_alerts(db: Session) -> int:
    """Notify owners of saved searches about listings published since their last alert. Returns alerts sent."""
    sent = 0
    for s in db.scalars(select(SavedSearch).where(SavedSearch.alerts_enabled.is_(True)).with_for_update(skip_locked=True)):
        user = db.get(User, s.user_id)
        if user is None or not user.is_active:
            continue
        n = _new_count(db, s)
        if n:
            notify(db, s.user_id, "saved_search_match", saved_search_id=s.id, count=n)
            sent += 1
        s.last_alerted_at = utcnow()
    return sent


