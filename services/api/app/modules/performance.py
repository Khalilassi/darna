"""Owner-only listing performance: daily activity series and an inquiry funnel."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

from app.core.db import get_db, utcnow
from app.core.deps import current_user
from app.core.errors import NotFound
from app.models.entities import Conversation, Deal, Listing, ListingDailyView, Offer, User, Viewing
from app.models.enums import PartyRole

router = APIRouter(prefix="/listings", tags=["listings"])


class DayStats(BaseModel):
    day: date
    views: int
    saves: int
    inquiries: int
    viewing_requests: int
    offers: int


class FunnelStep(BaseModel):
    step: str  # views | saves | inquiries | viewing_requests | offers
    count: int
    rate_from_previous: float | None  # share of the previous step, 0..1 (None for the first step or when it is 0)


class Performance(BaseModel):
    listing_id: uuid.UUID
    days: int
    published_at: datetime | None
    days_on_market: int | None
    total_views_all_time: int
    series: list[DayStats]
    totals: DayStats
    funnel: list[FunnelStep]
    note: str = "Views count public detail-page opens (not your own). Inquiries are new conversations; offers are buyers' opening offers."


def _by_day(db: Session, column, *conds) -> dict[date, int]:
    day = cast(column, Date)
    return {d: n for d, n in db.execute(select(day, func.count()).where(*conds).group_by(day)).all()}


@router.get("/mine/{listing_id}/performance", response_model=Performance)
def performance(listing_id: uuid.UUID, days: int = Query(default=30, ge=7, le=180),
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    listing = db.get(Listing, listing_id)
    if listing is None or listing.owner_id != user.id:
        raise NotFound("Listing not found")
    today = utcnow().date()
    start = today - timedelta(days=days - 1)
    since = datetime(start.year, start.month, start.day, tzinfo=utcnow().tzinfo)

    daily = db.execute(select(ListingDailyView.day, ListingDailyView.views, ListingDailyView.saves)
                       .where(ListingDailyView.listing_id == listing_id, ListingDailyView.day >= start)).all()
    views = {d: v for d, v, _ in daily}
    saves = {d: n for d, _, n in daily}  # save actions recorded at the time, not current favorites
    inquiries = _by_day(db, Conversation.created_at, Conversation.listing_id == listing_id, Conversation.created_at >= since)
    viewings = _by_day(db, Viewing.created_at, Viewing.listing_id == listing_id, Viewing.created_at >= since)
    # Opening offers only: a buyer's first offer in each negotiation (counters are not new interest).
    first_offer = (select(Offer.deal_id, func.min(Offer.created_at).label("at")).join(Deal, Deal.id == Offer.deal_id)
                   .where(Deal.listing_id == listing_id, Offer.made_by == PartyRole.buyer).group_by(Offer.deal_id).subquery())
    offers = _by_day(db, first_offer.c.at, first_offer.c.at >= since)

    series = []
    for i in range(days):
        d = start + timedelta(days=i)
        series.append(DayStats(day=d, views=views.get(d, 0), saves=saves.get(d, 0), inquiries=inquiries.get(d, 0),
                               viewing_requests=viewings.get(d, 0), offers=offers.get(d, 0)))
    totals = DayStats(day=today, **{k: sum(getattr(s, k) for s in series) for k in ("views", "saves", "inquiries", "viewing_requests", "offers")})

    funnel, prev = [], None
    for step in ("views", "saves", "inquiries", "viewing_requests", "offers"):
        n = getattr(totals, step)
        rate = round(n / prev, 4) if prev else None
        funnel.append(FunnelStep(step=step, count=n, rate_from_previous=rate))
        prev = n
    return Performance(
        listing_id=listing_id, days=days, published_at=listing.published_at,
        days_on_market=(today - listing.published_at.date()).days if listing.published_at else None,
        total_views_all_time=listing.view_count, series=series, totals=totals, funnel=funnel,
    )
