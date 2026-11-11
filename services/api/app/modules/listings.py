"""Listings: owner management, publication workflow, public search/detail, favorites, comparison."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core import rate_limit
from app.core.audit import audit
from app.core.config import get_settings
from app.core.db import get_db, utcnow
from app.core.deps import client_ip, current_user, current_user_optional, request_lang
from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.core.scanning import ensure_clean
from app.core.state_machine import StateMachine
from app.core.storage import public_storage
from app.finance.engine import (
    Amount,
    Fee,
    Installment,
    PresentValue,
    RentBreakdown,
    RentInput,
    SaleBreakdown,
    SaleInput,
    compute_rent,
    compute_sale,
    present_value,
)
from app.models.entities import (
    Conversation,
    Deal,
    Favorite,
    Listing,
    ListingPhoto,
    Offer,
    Property,
    User,
    Viewing,
)
from app.models.enums import (
    LISTING_PUBLIC_STATUSES,
    DealStatus,
    DeliveryStatus,
    Finishing,
    ListingPurpose,
    OfferStatus,
    Orientation,
    Payer,
    PaymentMode,
    PropertyType,
    Provenance,
    ViewingStatus,
)
from app.models.enums import (
    ListingStatus as LS,
)
from app.modules.properties import approved_claim_for
from app.schemas.common import Ok, Page

router = APIRouter(prefix="/listings", tags=["listings"])

LISTING_FSM = StateMachine(
    "listing",
    {
        LS.draft: [LS.pending_review, LS.withdrawn],
        LS.rejected: [LS.pending_review, LS.withdrawn],
        LS.pending_review: [LS.active, LS.rejected, LS.withdrawn],
        LS.active: [LS.paused, LS.under_offer, LS.suspended, LS.withdrawn, LS.sold, LS.rented],
        LS.under_offer: [LS.active, LS.sold, LS.rented, LS.suspended],
        LS.paused: [LS.active, LS.pending_review, LS.withdrawn, LS.suspended],
        LS.suspended: [LS.active, LS.withdrawn],
    },
    terminal=[LS.withdrawn, LS.sold, LS.rented],
)
EDITABLE = (LS.draft, LS.rejected, LS.paused)
MAX_PHOTOS = 20


# --------------------------------------------------------------------------- input schemas
class SaleTermsIn(BaseModel):
    payment_mode: PaymentMode
    owner_cash_price: Amount
    original_contract_price: Amount | None = None
    paid_to_developer: Amount | None = None
    installments: list[Installment] = Field(default_factory=list, max_length=600)
    overdue_payer: Payer = Payer.seller
    maintenance_deposit_due: Amount | None = None
    maintenance_payer: Payer = Payer.buyer
    fees: list[Fee] = Field(default_factory=list, max_length=30)


class ListingIn(BaseModel):
    property_id: uuid.UUID
    purpose: ListingPurpose
    title: str = Field(min_length=5, max_length=140)
    description: str = Field(default="", max_length=5000)
    sale_terms: SaleTermsIn | None = None
    rent_terms: RentInput | None = None

    @model_validator(mode="after")
    def _terms(self) -> ListingIn:
        needs_sale = self.purpose in (ListingPurpose.sale, ListingPurpose.sale_and_rent)
        needs_rent = self.purpose in (ListingPurpose.rent, ListingPurpose.sale_and_rent)
        if needs_sale != (self.sale_terms is not None) or needs_rent != (self.rent_terms is not None):
            raise ValueError("terms must match purpose: sale_terms for sale, rent_terms for rent")
        return self


class ListingUpdate(BaseModel):
    purpose: ListingPurpose | None = None
    title: str | None = Field(default=None, min_length=5, max_length=140)
    description: str | None = Field(default=None, max_length=5000)
    sale_terms: SaleTermsIn | None = None
    rent_terms: RentInput | None = None
    clear_sale_terms: bool = False
    clear_rent_terms: bool = False


# --------------------------------------------------------------------------- output schemas
class PhotoOut(BaseModel):
    id: uuid.UUID
    url: str
    width: int
    height: int
    position: int


class ListingCard(BaseModel):
    id: uuid.UUID
    title: str
    purpose: ListingPurpose
    status: LS
    project_id: uuid.UUID
    project_name_en: str
    project_name_ar: str
    district_id: uuid.UUID
    district_name_en: str
    district_name_ar: str
    group_code: str
    property_type: PropertyType
    area_sqm: Decimal
    bedrooms: int
    bathrooms: int
    floor: int | None
    finishing: Finishing
    delivery_status: DeliveryStatus
    orientation: Orientation | None
    furnished: bool | None
    cover_photo_url: str | None
    sale_cash_price: Decimal | None
    sale_initial_cash: Decimal | None
    sale_known_total: Decimal | None
    sale_payment_mode: str | None
    sale_price_per_sqm: Decimal | None
    monthly_rent: Decimal | None
    owner_verified: bool
    financials_verified: bool
    featured: bool
    published_at: datetime | None


class ListingDetail(ListingCard):
    description: str
    garden_sqm: Decimal | None
    photos: list[PhotoOut]
    owner_display_name: str
    sale_breakdown: SaleBreakdown | None
    rent_breakdown: RentBreakdown | None
    rent_terms: RentInput | None
    is_favorite: bool
    is_owner: bool
    my_conversation_id: uuid.UUID | None
    my_open_deal_ids: list[uuid.UUID]


class OwnerStats(BaseModel):
    views: int
    favorites: int
    conversations: int
    pending_viewings: int
    pending_offers: int
    active_deals: int


class OwnerListingOut(ListingDetail):
    property_id: uuid.UUID
    building_code: str
    unit_code: str | None
    moderation_note: str | None
    sale_terms: SaleTermsIn | None
    version: int
    allowed_transitions: list[str]
    stats: OwnerStats


# --------------------------------------------------------------------------- helpers
def _sale_input(listing: Listing, prop: Property) -> SaleInput | None:
    if not listing.sale_terms:
        return None
    return SaleInput(area_sqm=prop.area_sqm, **listing.sale_terms)


def compute_listing_financials(listing: Listing, as_of: date | None = None) -> tuple[SaleBreakdown | None, RentBreakdown | None]:
    as_of = as_of or date.today()
    sale = _sale_input(listing, listing.property)
    sb = compute_sale(sale, as_of) if sale else None
    rb = compute_rent(RentInput(**listing.rent_terms)) if listing.rent_terms else None
    return sb, rb


def _refresh_denormalized(listing: Listing) -> None:
    sb, _ = compute_listing_financials(listing)
    listing.sale_cash_price = sb.owner_cash_price if sb else None
    listing.sale_initial_cash = sb.initial_cash_required if sb else None
    listing.sale_known_total = sb.known_total_cost if sb else None
    listing.sale_payment_mode = sb.payment_mode.value if sb else None
    rent = listing.rent_terms
    listing.monthly_rent = Decimal(rent["monthly_rent"]) if rent else None
    listing.furnished = bool(rent["furnished"]) if rent else None


def _reject_owner_verified(obj) -> None:
    """Owners can never self-certify amounts as verified; only reviewers can."""
    if isinstance(obj, dict):
        if obj.get("provenance") == Provenance.verified.value:
            raise ValidationFailed("Only platform reviewers can mark amounts as verified", code="cannot_self_verify")
        for v in obj.values():
            _reject_owner_verified(v)
    elif isinstance(obj, list):
        for v in obj:
            _reject_owner_verified(v)


def _validate_sale_terms(terms: SaleTermsIn | None, prop: Property) -> dict | None:
    if terms is None:
        return None
    data = terms.model_dump(mode="json")
    _reject_owner_verified(data)
    try:
        SaleInput(area_sqm=prop.area_sqm, **data)
    except ValueError as exc:
        raise ValidationFailed(str(exc), code="invalid_sale_terms") from exc
    return data


def _photo_out(p: ListingPhoto) -> PhotoOut:
    return PhotoOut(id=p.id, url=public_storage().url(p.storage_key), width=p.width, height=p.height, position=p.position)


def _card(listing: Listing) -> dict:
    prop = listing.property
    cover = listing.photos[0] if listing.photos else None
    return dict(
        id=listing.id, title=listing.title, purpose=listing.purpose, status=listing.status,
        project_id=prop.project_id, project_name_en=prop.project.name_en, project_name_ar=prop.project.name_ar,
        district_id=prop.district_id, district_name_en=prop.district.name_en, district_name_ar=prop.district.name_ar, group_code=prop.group_code,
        property_type=prop.property_type, area_sqm=prop.area_sqm, bedrooms=prop.bedrooms, bathrooms=prop.bathrooms,
        floor=prop.floor, finishing=prop.finishing, delivery_status=prop.delivery_status, orientation=prop.orientation,
        furnished=listing.furnished, cover_photo_url=public_storage().url(cover.storage_key) if cover else None,
        sale_cash_price=listing.sale_cash_price, sale_initial_cash=listing.sale_initial_cash,
        sale_known_total=listing.sale_known_total, sale_payment_mode=listing.sale_payment_mode,
        sale_price_per_sqm=(listing.sale_known_total / prop.area_sqm).quantize(Decimal("0.01")) if listing.sale_known_total else None,
        monthly_rent=listing.monthly_rent, owner_verified=listing.owner.identity_verified_at is not None,
        financials_verified=listing.financials_verified_at is not None,
        featured=bool(listing.featured_until and listing.featured_until > utcnow()), published_at=listing.published_at,
    )


def _load(db: Session, listing_id: uuid.UUID, lock: bool = False) -> Listing:
    stmt = select(Listing).where(Listing.id == listing_id).options(
        joinedload(Listing.property).joinedload(Property.project),
        joinedload(Listing.property).joinedload(Property.district),
        joinedload(Listing.owner), selectinload(Listing.photos),
    )
    if lock:
        stmt = select(Listing).where(Listing.id == listing_id).with_for_update()
        locked = db.scalar(stmt)
        if locked is None:
            raise NotFound("Listing not found")
        return locked
    listing = db.scalar(stmt)
    if listing is None:
        raise NotFound("Listing not found")
    return listing


def _owned(db: Session, user: User, listing_id: uuid.UUID, lock: bool = True) -> Listing:
    listing = _load(db, listing_id, lock=lock)
    if listing.owner_id != user.id:
        raise NotFound("Listing not found")
    return listing


def _detail(db: Session, listing: Listing, user: User | None) -> dict:
    sb, rb = compute_listing_financials(listing)
    is_fav = conv_id = None
    deal_ids: list[uuid.UUID] = []
    if user:
        is_fav = db.get(Favorite, (user.id, listing.id)) is not None
        conv_id = db.scalar(select(Conversation.id).where(Conversation.listing_id == listing.id, Conversation.buyer_id == user.id))
        deal_ids = list(db.scalars(select(Deal.id).where(
            Deal.listing_id == listing.id, Deal.buyer_id == user.id, Deal.status.notin_([DealStatus.cancelled])
        )))
    return dict(
        **_card(listing), description=listing.description, garden_sqm=listing.property.garden_sqm,
        photos=[_photo_out(p) for p in listing.photos], owner_display_name=listing.owner.full_name.split(" ")[0],
        sale_breakdown=sb, rent_breakdown=rb, rent_terms=RentInput(**listing.rent_terms) if listing.rent_terms else None,
        is_favorite=bool(is_fav), is_owner=bool(user and user.id == listing.owner_id), my_conversation_id=conv_id,
        my_open_deal_ids=deal_ids,
    )


def _owner_out(db: Session, listing: Listing, user: User) -> OwnerListingOut:
    stats = OwnerStats(
        views=listing.view_count,
        favorites=db.scalar(select(func.count()).select_from(Favorite).where(Favorite.listing_id == listing.id)) or 0,
        conversations=db.scalar(select(func.count()).select_from(Conversation).where(Conversation.listing_id == listing.id)) or 0,
        pending_viewings=db.scalar(select(func.count()).select_from(Viewing).where(
            Viewing.listing_id == listing.id, Viewing.status == ViewingStatus.requested)) or 0,
        pending_offers=db.scalar(select(func.count()).select_from(Offer).join(Deal).where(
            Deal.listing_id == listing.id, Offer.status == OfferStatus.pending, Offer.made_by == "buyer")) or 0,
        active_deals=db.scalar(select(func.count()).select_from(Deal).where(
            Deal.listing_id == listing.id, Deal.status.notin_([DealStatus.cancelled, DealStatus.completed]))) or 0,
    )
    return OwnerListingOut(
        **_detail(db, listing, user), property_id=listing.property_id, building_code=listing.property.building_code,
        unit_code=listing.property.unit_code, moderation_note=listing.moderation_note,
        sale_terms=SaleTermsIn(**listing.sale_terms) if listing.sale_terms else None, version=listing.version,
        allowed_transitions=LISTING_FSM.allowed_from(listing.status), stats=stats,
    )


def transition(db: Session, listing: Listing, target: LS, actor: User | None, ip: str | None = None, note: str | None = None) -> None:
    LISTING_FSM.assert_transition(listing.status, target)
    previous = listing.status
    listing.status = target
    if target == LS.active and listing.published_at is None:
        listing.published_at = utcnow()
    if target in (LS.active, LS.sold, LS.rented):
        from app.modules.market import record_price_event

        record_price_event(db, listing, closed=target != LS.active)
    if note is not None:
        listing.moderation_note = note
    audit(db, "listing.status_changed", "listing", listing.id, actor_id=actor.id if actor else None,
          data={"from": previous.value, "to": target.value}, ip=ip)


# --------------------------------------------------------------------------- owner endpoints
@router.post("", response_model=OwnerListingOut, status_code=201)
def create_listing(body: ListingIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    prop = db.get(Property, body.property_id)
    if prop is None:
        raise NotFound("Property not found")
    claim = approved_claim_for(db, user, prop.id, scope="list")
    listing = Listing(
        property_id=prop.id, owner_id=user.id, claim_id=claim.id, purpose=body.purpose, title=body.title.strip(),
        description=body.description.strip(), sale_terms=_validate_sale_terms(body.sale_terms, prop),
        rent_terms=body.rent_terms.model_dump(mode="json") if body.rent_terms else None, status=LS.draft,
    )
    listing.property = prop
    _refresh_denormalized(listing)
    db.add(listing)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise Conflict("This property already has a live listing", code="property_already_listed") from exc
    audit(db, "listing.created", "listing", listing.id, actor_id=user.id, ip=client_ip(request))
    db.commit()
    return _owner_out(db, _load(db, listing.id), user)


@router.get("/mine", response_model=list[OwnerListingOut])
def my_listings(user: User = Depends(current_user), db: Session = Depends(get_db)):
    ids = db.scalars(select(Listing.id).where(Listing.owner_id == user.id).order_by(Listing.created_at.desc())).all()
    return [_owner_out(db, _load(db, i), user) for i in ids]


@router.get("/mine/{listing_id}", response_model=OwnerListingOut)
def my_listing(listing_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    listing = _load(db, listing_id)
    if listing.owner_id != user.id:
        raise NotFound("Listing not found")
    return _owner_out(db, listing, user)


@router.patch("/{listing_id}", response_model=OwnerListingOut)
def update_listing(listing_id: uuid.UUID, body: ListingUpdate, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    listing = _owned(db, user, listing_id)
    if listing.status not in EDITABLE:
        raise Conflict("Pause the listing before editing it", code="listing_not_editable")
    approved_claim_for(db, user, listing.property_id, scope="list")
    prop = db.get(Property, listing.property_id)
    data = body.model_dump(exclude_unset=True)
    if "title" in data and body.title:
        listing.title = body.title.strip()
    if "description" in data and body.description is not None:
        listing.description = body.description.strip()
    terms_changed = False
    if body.sale_terms is not None:
        listing.sale_terms = _validate_sale_terms(body.sale_terms, prop)
        terms_changed = True
    if body.rent_terms is not None:
        listing.rent_terms = body.rent_terms.model_dump(mode="json")
        terms_changed = True
    if body.clear_sale_terms:
        listing.sale_terms = None
    if body.clear_rent_terms:
        listing.rent_terms = None
    if body.purpose:
        listing.purpose = body.purpose
    needs_sale = listing.purpose in (ListingPurpose.sale, ListingPurpose.sale_and_rent)
    needs_rent = listing.purpose in (ListingPurpose.rent, ListingPurpose.sale_and_rent)
    if needs_sale != bool(listing.sale_terms) or needs_rent != bool(listing.rent_terms):
        raise ValidationFailed("Terms must match the listing purpose", code="terms_purpose_mismatch")
    if terms_changed:
        listing.financials_verified_at = None  # edited figures are seller-provided again
    listing.property = prop
    _refresh_denormalized(listing)
    listing.version += 1
    audit(db, "listing.updated", "listing", listing.id, actor_id=user.id, data={"fields": sorted(data)}, ip=client_ip(request))
    db.commit()
    return _owner_out(db, _load(db, listing.id), user)


class ActionIn(BaseModel):
    action: Literal["submit", "pause", "resume", "withdraw"]


@router.post("/{listing_id}/actions", response_model=OwnerListingOut)
def listing_action(listing_id: uuid.UUID, body: ActionIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    listing = _owned(db, user, listing_id)
    ip = client_ip(request)
    if body.action in ("submit", "resume"):
        approved_claim_for(db, user, listing.property_id, scope="list")
        if user.identity_verified_at is None:
            raise Forbidden("Verify your identity before publishing", code="identity_not_verified")
    if body.action == "submit":
        if not db.scalar(select(func.count()).select_from(ListingPhoto).where(ListingPhoto.listing_id == listing.id)):
            raise ValidationFailed("Add at least one photo", code="photo_required")
        transition(db, listing, LS.pending_review, user, ip)
    elif body.action == "pause":
        transition(db, listing, LS.paused, user, ip)
    elif body.action == "resume":
        if listing.status != LS.paused:
            raise Conflict("Only paused listings can be resumed", code="invalid_state_transition")
        target = LS.active if listing.approved_version == listing.version else LS.pending_review
        transition(db, listing, target, user, ip)
    elif body.action == "withdraw":
        transition(db, listing, LS.withdrawn, user, ip)
        from app.modules.properties import cancel_open_deals
        cancel_open_deals(db, listing.id, "listing_withdrawn")
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise Conflict("This property already has a live listing", code="property_already_listed") from exc
    db.commit()
    return _owner_out(db, _load(db, listing.id), user)


@router.post("/{listing_id}/photos", response_model=PhotoOut, status_code=201, dependencies=[Depends(rate_limit.limit("photo", 120, 3600))])
async def upload_photo(listing_id: uuid.UUID, file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    listing = _owned(db, user, listing_id)
    if listing.status not in EDITABLE:
        raise Conflict("Pause the listing before editing photos", code="listing_not_editable")
    count = db.scalar(select(func.count()).select_from(ListingPhoto).where(ListingPhoto.listing_id == listing.id)) or 0
    if count >= MAX_PHOTOS:
        raise ValidationFailed(f"Maximum {MAX_PHOTOS} photos", code="too_many_photos")
    data = await file.read(get_settings().max_upload_bytes + 1)
    if len(data) > get_settings().max_upload_bytes:
        raise ValidationFailed("File too large", code="file_too_large")
    ensure_clean(data)
    key, w, h = public_storage().put_image(data)
    photo = ListingPhoto(listing_id=listing.id, storage_key=key, width=w, height=h, position=count)
    db.add(photo)
    listing.version += 1
    db.commit()
    return _photo_out(photo)


@router.delete("/{listing_id}/photos/{photo_id}", response_model=Ok)
def delete_photo(listing_id: uuid.UUID, photo_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    listing = _owned(db, user, listing_id)
    if listing.status not in EDITABLE:
        raise Conflict("Pause the listing before editing photos", code="listing_not_editable")
    photo = db.get(ListingPhoto, photo_id)
    if photo is None or photo.listing_id != listing.id:
        raise NotFound("Photo not found")
    public_storage().delete(photo.storage_key)
    db.delete(photo)
    listing.version += 1
    db.flush()
    for i, p in enumerate(db.scalars(select(ListingPhoto).where(ListingPhoto.listing_id == listing.id).order_by(ListingPhoto.position))):
        p.position = i
    db.commit()
    return Ok()


# --------------------------------------------------------------------------- public endpoints
SortKey = Literal["newest", "price_asc", "price_desc", "area_desc", "ppsqm_asc"]


class SearchFilters(BaseModel):
    """Every search filter. Shared by public search, saved searches and saved-search alerts."""

    project_id: uuid.UUID | None = None
    district_id: uuid.UUID | None = None
    group_code: str | None = Field(default=None, max_length=20)
    purpose: Literal["sale", "rent"] | None = None
    property_type: list[PropertyType] = Field(default_factory=list)
    bedrooms_min: int | None = Field(default=None, ge=0)
    bedrooms_max: int | None = Field(default=None, ge=0)
    bathrooms_min: int | None = Field(default=None, ge=0)
    area_min: Decimal | None = Field(default=None, ge=0)
    area_max: Decimal | None = Field(default=None, ge=0)
    price_min: Decimal | None = Field(default=None, ge=0)
    price_max: Decimal | None = Field(default=None, ge=0)
    floor_min: int | None = None
    floor_max: int | None = None
    finishing: list[Finishing] = Field(default_factory=list)
    delivery_status: DeliveryStatus | None = None
    orientation: list[Orientation] = Field(default_factory=list)
    payment_mode: PaymentMode | None = None
    furnished: bool | None = None
    q: str | None = Field(default=None, max_length=80)


def search_conditions(f: SearchFilters):
    """Return (SQL conditions, price column) for public listings matching ``f``."""
    conds = [Listing.status.in_(LISTING_PUBLIC_STATUSES)]
    if f.project_id:
        conds.append(Property.project_id == f.project_id)
    if f.district_id:
        conds.append(Property.district_id == f.district_id)
    if f.group_code:
        from app.modules.properties import normalize_segment
        conds.append(Property.group_code == normalize_segment(f.group_code))
    price_col = Listing.sale_cash_price
    if f.purpose == "sale":
        conds.append(Listing.purpose.in_([ListingPurpose.sale, ListingPurpose.sale_and_rent]))
    elif f.purpose == "rent":
        conds.append(Listing.purpose.in_([ListingPurpose.rent, ListingPurpose.sale_and_rent]))
        price_col = Listing.monthly_rent
    if f.property_type:
        conds.append(Property.property_type.in_(f.property_type))
    if f.bedrooms_min is not None:
        conds.append(Property.bedrooms >= f.bedrooms_min)
    if f.bedrooms_max is not None:
        conds.append(Property.bedrooms <= f.bedrooms_max)
    if f.bathrooms_min is not None:
        conds.append(Property.bathrooms >= f.bathrooms_min)
    if f.area_min is not None:
        conds.append(Property.area_sqm >= f.area_min)
    if f.area_max is not None:
        conds.append(Property.area_sqm <= f.area_max)
    if f.price_min is not None:
        conds.append(price_col >= f.price_min)
    if f.price_max is not None:
        conds.append(price_col <= f.price_max)
    if f.floor_min is not None:
        conds.append(Property.floor >= f.floor_min)
    if f.floor_max is not None:
        conds.append(Property.floor <= f.floor_max)
    if f.finishing:
        conds.append(Property.finishing.in_(f.finishing))
    if f.delivery_status:
        conds.append(Property.delivery_status == f.delivery_status)
    if f.orientation:
        conds.append(Property.orientation.in_(f.orientation))
    if f.payment_mode:
        conds.append(Listing.sale_payment_mode == f.payment_mode.value)
    if f.furnished is not None:
        conds.append(Listing.furnished.is_(f.furnished))
    if f.q:
        like = f"%{f.q.replace('%', '').replace('_', '')}%"
        conds.append(or_(Listing.title.ilike(like), Listing.description.ilike(like)))
    return conds, price_col


def run_search(db: Session, f: SearchFilters, sort: SortKey = "newest", page: int = 1, page_size: int = 20) -> Page[ListingCard]:
    conds, price_col = search_conditions(f)
    base = select(Listing).join(Property, Listing.property_id == Property.id).where(and_(*conds))
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    featured_first = (Listing.featured_until > func.now()).desc().nulls_last()
    order = {
        "newest": [featured_first, Listing.published_at.desc().nulls_last()],
        "price_asc": [price_col.asc().nulls_last()],
        "price_desc": [price_col.desc().nulls_last()],
        "area_desc": [Property.area_sqm.desc()],
        "ppsqm_asc": [(Listing.sale_known_total / Property.area_sqm).asc().nulls_last()],
    }[sort]
    rows = db.scalars(
        base.options(
            joinedload(Listing.property).joinedload(Property.project),
            joinedload(Listing.property).joinedload(Property.district),
            joinedload(Listing.owner), selectinload(Listing.photos),
        ).order_by(*order, Listing.id).offset((page - 1) * page_size).limit(page_size)
    ).unique().all()
    return Page(items=[ListingCard(**_card(r)) for r in rows], total=total, page=page, page_size=page_size)


@router.get("", response_model=Page[ListingCard])
def search(
    db: Session = Depends(get_db),
    project_id: uuid.UUID | None = None,
    district_id: uuid.UUID | None = None,
    group_code: str | None = Query(default=None, max_length=20),
    purpose: Literal["sale", "rent"] | None = None,
    property_type: list[PropertyType] = Query(default=[]),
    bedrooms_min: int | None = Query(default=None, ge=0),
    bedrooms_max: int | None = Query(default=None, ge=0),
    bathrooms_min: int | None = Query(default=None, ge=0),
    area_min: Decimal | None = Query(default=None, ge=0),
    area_max: Decimal | None = Query(default=None, ge=0),
    price_min: Decimal | None = Query(default=None, ge=0),
    price_max: Decimal | None = Query(default=None, ge=0),
    floor_min: int | None = None,
    floor_max: int | None = None,
    finishing: list[Finishing] = Query(default=[]),
    delivery_status: DeliveryStatus | None = None,
    orientation: list[Orientation] = Query(default=[]),
    payment_mode: PaymentMode | None = None,
    furnished: bool | None = None,
    q: str | None = Query(default=None, max_length=80),
    sort: SortKey = "newest",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=50),
):
    f = SearchFilters(
        project_id=project_id, district_id=district_id, group_code=group_code, purpose=purpose, property_type=property_type,
        bedrooms_min=bedrooms_min, bedrooms_max=bedrooms_max, bathrooms_min=bathrooms_min, area_min=area_min,
        area_max=area_max, price_min=price_min, price_max=price_max, floor_min=floor_min, floor_max=floor_max,
        finishing=finishing, delivery_status=delivery_status, orientation=orientation, payment_mode=payment_mode,
        furnished=furnished, q=q,
    )
    return run_search(db, f, sort, page, page_size)


@router.get("/compare", response_model=list[ListingDetail])
def compare(ids: list[uuid.UUID] = Query(min_length=2, max_length=4), user: User | None = Depends(current_user_optional), db: Session = Depends(get_db)):
    out = []
    for i in dict.fromkeys(ids):
        listing = _load(db, i)
        if listing.status not in LISTING_PUBLIC_STATUSES:
            raise NotFound("Listing not available")
        out.append(ListingDetail(**_detail(db, listing, user)))
    return out


@router.get("/favorites", response_model=list[ListingCard])
def favorites(user: User = Depends(current_user), db: Session = Depends(get_db)):
    ids = db.scalars(select(Favorite.listing_id).where(Favorite.user_id == user.id).order_by(Favorite.created_at.desc())).all()
    out = []
    for i in ids:
        listing = _load(db, i)
        if listing.status in LISTING_PUBLIC_STATUSES:
            out.append(ListingCard(**_card(listing)))
    return out


@router.get("/{listing_id}", response_model=ListingDetail)
def detail(listing_id: uuid.UUID, user: User | None = Depends(current_user_optional), db: Session = Depends(get_db)):
    listing = _load(db, listing_id)
    is_owner = user is not None and user.id == listing.owner_id
    if listing.status not in LISTING_PUBLIC_STATUSES and not is_owner:
        raise NotFound("Listing not found")
    if not is_owner:
        db.execute(update(Listing).where(Listing.id == listing.id).values(view_count=Listing.view_count + 1))
        db.commit()
    return ListingDetail(**_detail(db, listing, user))


class ScenarioOut(BaseModel):
    sale_breakdown: SaleBreakdown
    present_value: PresentValue | None


@router.get("/{listing_id}/financials", response_model=ScenarioOut)
def financial_scenario(request: Request, listing_id: uuid.UUID, as_of: date | None = None, discount_rate: Decimal | None = Query(default=None, ge=0, le=1), db: Session = Depends(get_db)):
    listing = _load(db, listing_id)
    if listing.status not in LISTING_PUBLIC_STATUSES or not listing.sale_terms:
        raise NotFound("No sale financials for this listing")
    as_of = as_of or date.today()
    sale = _sale_input(listing, listing.property)
    assert sale is not None
    pv = present_value(sale.installments, as_of, discount_rate, request_lang(request)) if discount_rate is not None else None
    return ScenarioOut(sale_breakdown=compute_sale(sale, as_of), present_value=pv)


@router.put("/{listing_id}/favorite", response_model=Ok)
def add_favorite(listing_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    listing = db.get(Listing, listing_id)
    if listing is None or listing.status not in LISTING_PUBLIC_STATUSES:
        raise NotFound("Listing not found")
    if db.get(Favorite, (user.id, listing_id)) is None:
        db.add(Favorite(user_id=user.id, listing_id=listing_id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    return Ok()


@router.delete("/{listing_id}/favorite", response_model=Ok)
def remove_favorite(listing_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    fav = db.get(Favorite, (user.id, listing_id))
    if fav:
        db.delete(fav)
        db.commit()
    return Ok()
