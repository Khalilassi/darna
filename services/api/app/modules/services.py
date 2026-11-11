"""Directory of independent, verified professionals and referral requests.

The platform is never a party to the service: it lists providers its staff have checked, records
referral requests (to measure usefulness and, where agreed, referral income), and shows any referral-fee
arrangement to the user BEFORE they request a referral. Contact details are shared with a provider only
when the user explicitly opts in.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import AfterValidator, BaseModel, EmailStr, Field, HttpUrl, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core import rate_limit
from app.core.audit import audit
from app.core.db import get_db, utcnow
from app.core.deps import client_ip, current_user, request_lang, require
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.validation import rule_error
from app.models.entities import Deal, ServiceProvider, ServiceReferral, User
from app.models.enums import DealStatus as DS
from app.models.enums import ReferralStatus, ServiceCategory
from app.schemas.common import ORM

router = APIRouter(prefix="/services", tags=["services"])
admin_router = APIRouter(prefix="/admin/services", tags=["admin"])

# Which kinds of professional help are typically relevant at each deal stage.
SUGGESTIONS: dict[DS, list[ServiceCategory]] = {
    DS.offer_accepted: [ServiceCategory.lawyer, ServiceCategory.surveyor],
    DS.due_diligence: [ServiceCategory.lawyer, ServiceCategory.surveyor],
    DS.contract_preparation: [ServiceCategory.lawyer, ServiceCategory.notary_services],
    DS.contract_signed: [ServiceCategory.notary_services, ServiceCategory.lawyer],
    DS.developer_transfer: [ServiceCategory.notary_services, ServiceCategory.lawyer],
    DS.completed: [ServiceCategory.mover, ServiceCategory.cleaning, ServiceCategory.maintenance, ServiceCategory.interior],
    DS.terms_agreed: [ServiceCategory.lawyer],
    DS.lease_preparation: [ServiceCategory.lawyer],
    DS.lease_signed: [ServiceCategory.mover, ServiceCategory.cleaning],
    DS.handover_scheduled: [ServiceCategory.mover, ServiceCategory.cleaning, ServiceCategory.maintenance],
    DS.lease_active: [ServiceCategory.maintenance],
}
OPEN_REFERRAL = (ReferralStatus.requested, ReferralStatus.contacted)


class ProviderOut(ORM):
    id: uuid.UUID
    category: ServiceCategory
    name_en: str
    name_ar: str
    description_en: str
    description_ar: str
    phone: str | None
    email: str | None
    website: str | None
    license_number: str | None
    project_ids: list[str]
    referral_fee_disclosure_en: str | None
    referral_fee_disclosure_ar: str | None
    verified: bool


def _provider_out(p: ServiceProvider) -> ProviderOut:
    return ProviderOut(**{k: getattr(p, k) for k in ProviderOut.model_fields if k != "verified"}, verified=p.verified_at is not None)


def _visible(p: ServiceProvider | None) -> bool:
    return p is not None and p.is_active and p.verified_at is not None


@router.get("/providers", response_model=list[ProviderOut])
def providers(category: ServiceCategory | None = None, project_id: uuid.UUID | None = None, db: Session = Depends(get_db)):
    stmt = select(ServiceProvider).where(ServiceProvider.is_active.is_(True), ServiceProvider.verified_at.is_not(None))
    if category:
        stmt = stmt.where(ServiceProvider.category == category)
    rows = db.scalars(stmt.order_by(ServiceProvider.name_en)).all()
    if project_id:  # empty project list means "serves every community"
        rows = [p for p in rows if not p.project_ids or str(project_id) in p.project_ids]
    return [_provider_out(p) for p in rows]


class SuggestionsOut(BaseModel):
    deal_id: uuid.UUID
    status: DS
    categories: list[ServiceCategory]
    note: str


NOTE = {
    "en": "Independent professionals. Darna is not a party to their services; agree terms directly with them.",
    "ar": "مهنيون مستقلون. دارنا ليست طرفًا في خدماتهم؛ اتفق على الشروط معهم مباشرة.",
}


def _deal_for(db: Session, user: User, deal_id: uuid.UUID) -> Deal:
    deal = db.get(Deal, deal_id)
    if deal is None or user.id not in (deal.buyer_id, deal.owner_id):
        raise NotFound("Deal not found")
    return deal


@router.get("/suggestions", response_model=SuggestionsOut)
def suggestions(request: Request, deal_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    deal = _deal_for(db, user, deal_id)
    return SuggestionsOut(deal_id=deal.id, status=deal.status, categories=SUGGESTIONS.get(deal.status, []),
                          note=NOTE[request_lang(request)])


class ReferralIn(BaseModel):
    provider_id: uuid.UUID
    deal_id: uuid.UUID | None = None
    message: str = Field(default="", max_length=1000)
    share_phone: bool = False
    acknowledged_disclosure: bool = False


class ReferralOut(BaseModel):
    id: uuid.UUID
    provider: ProviderOut
    deal_id: uuid.UUID | None
    message: str
    share_phone: bool
    status: ReferralStatus
    created_at: datetime


def _referral_out(r: ServiceReferral) -> ReferralOut:
    return ReferralOut(id=r.id, provider=_provider_out(r.provider), deal_id=r.deal_id, message=r.message,
                       share_phone=r.share_phone, status=r.status, created_at=r.created_at)


@router.post("/referrals", response_model=ReferralOut, status_code=201,
             dependencies=[Depends(rate_limit.limit("referral", 20, 3600))])
def request_referral(body: ReferralIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    provider = db.get(ServiceProvider, body.provider_id)
    if not _visible(provider):
        raise NotFound("Provider not found")
    assert provider is not None
    if (provider.referral_fee_disclosure_en or provider.referral_fee_disclosure_ar) and not body.acknowledged_disclosure:
        raise ValidationFailed("Please read and acknowledge the referral-fee disclosure", code="disclosure_not_acknowledged")
    if body.deal_id:
        _deal_for(db, user, body.deal_id)
    if body.share_phone and not (user.phone and user.phone_verified_at):
        raise ValidationFailed("Verify your phone number before sharing it", code="phone_not_verified")
    open_one = db.scalar(select(ServiceReferral.id).where(
        ServiceReferral.user_id == user.id, ServiceReferral.provider_id == provider.id, ServiceReferral.status.in_(OPEN_REFERRAL)))
    if open_one:
        raise Conflict("You already have an open request with this provider", code="referral_exists")
    r = ServiceReferral(provider_id=provider.id, user_id=user.id, deal_id=body.deal_id, message=body.message.strip(),
                        share_phone=body.share_phone, shared_phone=user.phone if body.share_phone else None)
    r.provider = provider
    db.add(r)
    try:
        db.flush()
    except IntegrityError as exc:  # a concurrent request created the open referral first
        db.rollback()
        raise Conflict("You already have an open request with this provider", code="referral_exists") from exc
    audit(db, "service.referral_requested", "service_referral", r.id, actor_id=user.id,
          data={"provider_id": str(provider.id), "category": provider.category.value}, ip=client_ip(request))
    db.commit()
    return _referral_out(r)


@router.get("/referrals", response_model=list[ReferralOut])
def my_referrals(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(ServiceReferral).options(joinedload(ServiceReferral.provider))
                      .where(ServiceReferral.user_id == user.id).order_by(ServiceReferral.created_at.desc())).all()
    return [_referral_out(r) for r in rows]


@router.post("/referrals/{referral_id}/cancel", response_model=ReferralOut)
def cancel_referral(referral_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = db.scalar(select(ServiceReferral).options(joinedload(ServiceReferral.provider)).where(ServiceReferral.id == referral_id).with_for_update(of=ServiceReferral))
    if r is None or r.user_id != user.id:
        raise NotFound("Referral not found")
    if r.status not in OPEN_REFERRAL:
        raise Conflict("This request is already closed", code="referral_closed")
    r.status = ReferralStatus.cancelled
    db.commit()
    return _referral_out(r)


# --------------------------------------------------------------------------- admin
WEBSITE_MAX = 200  # ServiceProvider.website column length


def _website_fits(v: HttpUrl) -> HttpUrl:
    if len(str(v)) > WEBSITE_MAX:
        raise rule_error("url_too_long", "URL must be at most {max_length} characters", {"max_length": WEBSITE_MAX})
    return v


Website = Annotated[HttpUrl, AfterValidator(_website_fits)]


class ProviderIn(BaseModel):
    category: ServiceCategory
    name_en: str = Field(min_length=2, max_length=120)
    name_ar: str = Field(min_length=2, max_length=120)
    description_en: str = Field(default="", max_length=2000)
    description_ar: str = Field(default="", max_length=2000)
    phone: str | None = Field(default=None, pattern=r"^\+?[0-9]{8,15}$")
    email: EmailStr | None = None
    website: Website | None = None
    license_number: str | None = Field(default=None, max_length=80)
    project_ids: list[uuid.UUID] = Field(default_factory=list)
    referral_fee_disclosure_en: str | None = Field(default=None, max_length=300)
    referral_fee_disclosure_ar: str | None = Field(default=None, max_length=300)
    is_active: bool = True


class ProviderPatch(BaseModel):
    category: ServiceCategory | None = None
    name_en: str | None = Field(default=None, min_length=2, max_length=120)
    name_ar: str | None = Field(default=None, min_length=2, max_length=120)
    description_en: str | None = Field(default=None, max_length=2000)
    description_ar: str | None = Field(default=None, max_length=2000)
    phone: str | None = Field(default=None, pattern=r"^\+?[0-9]{8,15}$")
    email: EmailStr | None = None
    website: Website | None = None
    license_number: str | None = Field(default=None, max_length=80)
    project_ids: list[uuid.UUID] | None = None
    referral_fee_disclosure_en: str | None = Field(default=None, max_length=300)
    referral_fee_disclosure_ar: str | None = Field(default=None, max_length=300)
    is_active: bool | None = None
    verified: bool | None = None

    # Omitting a field leaves it unchanged; an explicit null is only meaningful for optional fields.
    @field_validator("category", "name_en", "name_ar", "description_en", "description_ar", "project_ids", "is_active", "verified")
    @classmethod
    def _not_null(cls, v):
        if v is None:
            raise rule_error("null_not_allowed", "This field cannot be null")
        return v


class AdminProviderOut(ProviderOut):
    is_active: bool
    verified_at: datetime | None
    created_at: datetime


def _admin_provider_out(p: ServiceProvider) -> AdminProviderOut:
    return AdminProviderOut(**_provider_out(p).model_dump(), is_active=p.is_active, verified_at=p.verified_at, created_at=p.created_at)


def _apply(p: ServiceProvider, data: dict) -> None:
    for k, v in data.items():
        if k == "project_ids":
            v = [str(x) for x in v]
        elif k in ("website", "email") and v is not None:
            v = str(v)
        setattr(p, k, v)


@admin_router.get("/providers", response_model=list[AdminProviderOut])
def admin_providers(category: ServiceCategory | None = None, _: User = Depends(require("services.manage")),
                    db: Session = Depends(get_db)):
    stmt = select(ServiceProvider)
    if category:
        stmt = stmt.where(ServiceProvider.category == category)
    return [_admin_provider_out(p) for p in db.scalars(stmt.order_by(ServiceProvider.category, ServiceProvider.name_en))]


@admin_router.post("/providers", response_model=AdminProviderOut, status_code=201)
def create_provider(body: ProviderIn, request: Request, staff: User = Depends(require("services.manage")), db: Session = Depends(get_db)):
    p = ServiceProvider()
    _apply(p, body.model_dump())
    db.add(p)
    db.flush()
    audit(db, "service.provider_created", "service_provider", p.id, actor_id=staff.id, ip=client_ip(request))
    db.commit()
    return _admin_provider_out(p)


@admin_router.patch("/providers/{provider_id}", response_model=AdminProviderOut)
def update_provider(provider_id: uuid.UUID, body: ProviderPatch, request: Request, staff: User = Depends(require("services.manage")),
                    db: Session = Depends(get_db)):
    p = db.get(ServiceProvider, provider_id)
    if p is None:
        raise NotFound("Provider not found")
    data = body.model_dump(exclude_unset=True)
    verified = data.pop("verified", None)
    _apply(p, data)
    if verified is True and p.verified_at is None:
        p.verified_at, p.verified_by_id = utcnow(), staff.id
    elif verified is False:
        p.verified_at, p.verified_by_id = None, None
    audit(db, "service.provider_updated", "service_provider", p.id, actor_id=staff.id, data={"fields": sorted(body.model_dump(exclude_unset=True))},
          ip=client_ip(request))
    db.commit()
    return _admin_provider_out(p)


class AdminReferralOut(BaseModel):
    id: uuid.UUID
    provider_id: uuid.UUID
    provider_name: str
    provider_name_ar: str
    user_name: str
    # Only present when the user chose to share it.
    user_phone: str | None
    deal_id: uuid.UUID | None
    message: str
    status: ReferralStatus
    created_at: datetime


class ReferralStatusIn(BaseModel):
    status: Literal["contacted", "completed", "cancelled"]


@admin_router.get("/referrals", response_model=list[AdminReferralOut])
def admin_referrals(status: list[ReferralStatus] = Query(default=[]), _: User = Depends(require("services.manage")),
                    db: Session = Depends(get_db)):
    stmt = select(ServiceReferral).options(joinedload(ServiceReferral.provider))
    if status:
        stmt = stmt.where(ServiceReferral.status.in_(status))
    out = []
    for r in db.scalars(stmt.order_by(ServiceReferral.created_at.desc()).limit(500)).all():
        u = db.get(User, r.user_id)
        out.append(AdminReferralOut(id=r.id, provider_id=r.provider_id, provider_name=r.provider.name_en, provider_name_ar=r.provider.name_ar, user_name=u.full_name if u else "",
                                    user_phone=r.shared_phone if r.share_phone else None, deal_id=r.deal_id, message=r.message,
                                    status=r.status, created_at=r.created_at))
    return out


@admin_router.patch("/referrals/{referral_id}", response_model=AdminReferralOut)
def update_referral(referral_id: uuid.UUID, body: ReferralStatusIn, request: Request, staff: User = Depends(require("services.manage")),
                    db: Session = Depends(get_db)):
    r = db.scalar(select(ServiceReferral).options(joinedload(ServiceReferral.provider)).where(ServiceReferral.id == referral_id)
                  .with_for_update(of=ServiceReferral))
    if r is None:
        raise NotFound("Referral not found")
    if r.status not in OPEN_REFERRAL:
        raise Conflict("This request is already closed", code="referral_closed")
    r.status = ReferralStatus(body.status)
    audit(db, "service.referral_updated", "service_referral", r.id, actor_id=staff.id, data={"status": body.status}, ip=client_ip(request))
    db.commit()
    u = db.get(User, r.user_id)
    return AdminReferralOut(id=r.id, provider_id=r.provider_id, provider_name=r.provider.name_en, provider_name_ar=r.provider.name_ar, user_name=u.full_name if u else "",
                            user_phone=r.shared_phone if r.share_phone else None, deal_id=r.deal_id, message=r.message,
                            status=r.status, created_at=r.created_at)


