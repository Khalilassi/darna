"""Market insights built only from data on this platform.

- Per-listing asking-price history (public, like the listing itself).
- District price-per-m² summaries from live asking prices, and a monthly trend from price events.
  Groups with fewer than ``MIN_SAMPLE`` listings are suppressed (value ``null``) so a figure can never
  be traced back to one owner, and every response carries its methodology.
- Agreed transaction prices are private to the deal parties and are never used here.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.db import get_db, utcnow
from app.core.errors import NotFound, ValidationFailed
from app.finance.engine import CashComparison, compare_cash_vs_installments
from app.models.entities import District, Listing, ListingPriceEvent, Property
from app.models.enums import LISTING_PUBLIC_STATUSES, ListingPurpose, PaymentMode, PropertyType
from app.schemas.common import ORM

router = APIRouter(tags=["market"])

MIN_SAMPLE = 3
METHODOLOGY = (
    "Based on asking prices of listings published on Darna, not valuations or completed transaction prices. "
    "Sale figures use each listing's known total cost (cash price plus remaining installments and known fees) "
    "divided by area. Groups with fewer than 3 listings are hidden to protect owners' privacy."
)


# --------------------------------------------------------------------------- recording
def record_price_event(db: Session, listing: Listing, closed: bool) -> None:
    prop = db.get(Property, listing.property_id)
    assert prop is not None
    base = dict(listing_id=listing.id, property_id=prop.id, project_id=prop.project_id, district_id=prop.district_id,
                property_type=prop.property_type, area_sqm=prop.area_sqm)
    if closed:
        db.add(ListingPriceEvent(kind="closed", **base))
        return
    last = db.scalar(
        select(ListingPriceEvent).where(ListingPriceEvent.listing_id == listing.id, ListingPriceEvent.kind != "closed")
        .order_by(ListingPriceEvent.created_at.desc()).limit(1)
    )
    prices = dict(sale_cash_price=listing.sale_cash_price, sale_known_total=listing.sale_known_total, monthly_rent=listing.monthly_rent)
    if last is not None and all(getattr(last, k) == v for k, v in prices.items()):
        return
    db.add(ListingPriceEvent(kind="listed" if last is None else "price_changed", **base, **prices))


# --------------------------------------------------------------------------- per-listing history
class PricePoint(ORM):
    kind: str
    sale_cash_price: Decimal | None
    sale_known_total: Decimal | None
    monthly_rent: Decimal | None
    created_at: datetime


@router.get("/listings/{listing_id}/price-history", response_model=list[PricePoint])
def price_history(listing_id: uuid.UUID, db: Session = Depends(get_db)):
    listing = db.get(Listing, listing_id)
    if listing is None or listing.status not in LISTING_PUBLIC_STATUSES:
        raise NotFound("Listing not found")
    return db.scalars(
        select(ListingPriceEvent).where(ListingPriceEvent.listing_id == listing_id, ListingPriceEvent.kind != "closed")
        .order_by(ListingPriceEvent.created_at)
    ).all()


# --------------------------------------------------------------------------- district summary & trend
class Figure(BaseModel):
    sample_size: int
    median_per_sqm: Decimal | None  # null when sample_size < MIN_SAMPLE


class DistrictSummary(BaseModel):
    district_id: uuid.UUID
    district_name_en: str
    district_name_ar: str
    active_listings: int
    sale: Figure
    rent: Figure


class TrendPoint(BaseModel):
    month: str  # YYYY-MM
    sample_size: int
    median_per_sqm: Decimal | None


class MarketSummary(BaseModel):
    project_id: uuid.UUID
    purpose: Literal["sale", "rent"]
    property_types: list[PropertyType]
    districts: list[DistrictSummary]
    trend: list[TrendPoint]
    min_sample: int = MIN_SAMPLE
    methodology: str = METHODOLOGY
    generated_at: datetime


def _median(expr):
    return func.percentile_cont(0.5).within_group(expr)


def _q2(v) -> Decimal | None:
    return Decimal(str(v)).quantize(Decimal("1")) if v is not None else None


@router.get("/market/summary", response_model=MarketSummary)
def market_summary(
    project_id: uuid.UUID,
    purpose: Literal["sale", "rent"] = "sale",
    district_id: uuid.UUID | None = None,
    property_type: list[PropertyType] = Query(default=[]),
    months: int = Query(default=12, ge=1, le=36),
    db: Session = Depends(get_db),
):
    type_cond = [Property.property_type.in_(property_type)] if property_type else []
    dist_cond = [Property.district_id == district_id] if district_id else []
    live = [Listing.status.in_(LISTING_PUBLIC_STATUSES), Property.project_id == project_id, *type_cond, *dist_cond]

    def per_district(value_col, purposes):
        rows = db.execute(
            select(Property.district_id, func.count(), _median(value_col / Property.area_sqm))
            .select_from(Listing).join(Property, Listing.property_id == Property.id)
            .where(*live, Listing.purpose.in_(purposes), value_col.is_not(None))
            .group_by(Property.district_id)
        ).all()
        return {r[0]: (r[1], r[2]) for r in rows}

    sale = per_district(Listing.sale_known_total, [ListingPurpose.sale, ListingPurpose.sale_and_rent])
    rent = per_district(Listing.monthly_rent, [ListingPurpose.rent, ListingPurpose.sale_and_rent])
    counts = dict(db.execute(
        select(Property.district_id, func.count()).select_from(Listing).join(Property, Listing.property_id == Property.id)
        .where(*live).group_by(Property.district_id)
    ).all())
    districts = db.scalars(select(District).where(District.project_id == project_id, *([District.id == district_id] if district_id else []))
                           .order_by(District.code)).all()
    if not districts:
        raise NotFound("Project not found")

    def fig(entry) -> Figure:
        n, med = entry if entry else (0, None)
        return Figure(sample_size=n, median_per_sqm=_q2(med) if n >= MIN_SAMPLE else None)

    out = [DistrictSummary(district_id=d.id, district_name_en=d.name_en, district_name_ar=d.name_ar,
                           active_listings=counts.get(d.id, 0), sale=fig(sale.get(d.id)), rent=fig(rent.get(d.id)))
           for d in districts]

    # Monthly trend: median per m² of asking prices set (listed or changed) in each month.
    value = ListingPriceEvent.sale_known_total if purpose == "sale" else ListingPriceEvent.monthly_rent
    since = (date.today().replace(day=1) - timedelta(days=31 * (months - 1))).replace(day=1)
    month = func.to_char(func.date_trunc("month", ListingPriceEvent.created_at), "YYYY-MM")
    ev_conds = [ListingPriceEvent.project_id == project_id, ListingPriceEvent.kind != "closed", value.is_not(None),
                ListingPriceEvent.created_at >= since]
    if district_id:
        ev_conds.append(ListingPriceEvent.district_id == district_id)
    if property_type:
        ev_conds.append(ListingPriceEvent.property_type.in_(property_type))
    trend_rows = db.execute(
        select(month, func.count(), _median(value / ListingPriceEvent.area_sqm)).where(and_(*ev_conds)).group_by(month).order_by(month)
    ).all()
    trend = [TrendPoint(month=m, sample_size=n, median_per_sqm=_q2(med) if n >= MIN_SAMPLE else None) for m, n, med in trend_rows]
    return MarketSummary(project_id=project_id, purpose=purpose, property_types=property_type, districts=out, trend=trend,
                         generated_at=utcnow())


# --------------------------------------------------------------------------- cash vs installments
@router.get("/listings/{listing_id}/financials/compare", response_model=CashComparison)
def compare(listing_id: uuid.UUID, discount_rate: Decimal = Query(ge=0, le=1), cash_price: Decimal | None = Query(default=None, gt=0),
            as_of: date | None = None, db: Session = Depends(get_db)):
    from app.modules.listings import _load, _sale_input

    listing = _load(db, listing_id)
    if listing.status not in LISTING_PUBLIC_STATUSES or not listing.sale_terms:
        raise NotFound("No sale financials for this listing")
    sale = _sale_input(listing, listing.property)
    assert sale is not None
    if sale.payment_mode != PaymentMode.installments:
        raise ValidationFailed("This listing is a cash sale; there is no installment plan to compare", code="not_installment_sale")
    return compare_cash_vs_installments(sale, as_of or date.today(), discount_rate, cash_price)
