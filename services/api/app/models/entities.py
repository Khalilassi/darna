"""SQLAlchemy ORM models.

Key integrity guarantees enforced by the database (not only by application code):
- ``uq_properties_identity``: one canonical property per (project, normalized identity key).
- ``uq_listings_one_live_per_property``: partial unique index -> at most one live listing per property.
- ``uq_claims_one_approved_per_property``: at most one approved controlling ownership claim.
- ``uq_deals_one_committed_per_listing``: at most one deal past offer acceptance per listing.
- ``uq_offers_one_pending_per_deal``: at most one pending offer per negotiation.
- ``uq_conversations_listing_buyer``: one conversation per (listing, buyer).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, IdMixin, TimestampMixin, utcnow
from app.models.enums import (
    DEAL_COMMITTED_STATUSES,
    LISTING_OCCUPYING_STATUSES,
    ChecklistStatus,
    ClaimCapacity,
    ClaimStatus,
    DealKind,
    DealStatus,
    DeliveryStatus,
    DisputeStatus,
    DocumentKind,
    Finishing,
    ListingPurpose,
    ListingStatus,
    OfferStatus,
    Orientation,
    PartyRole,
    PropertyType,
    Role,
    SupportCategory,
    SupportStatus,
    VerificationKind,
    VerificationStatus,
    ViewingStatus,
)

Json = JSON().with_variant(JSONB(), "postgresql")
Money = Numeric(14, 2)


def E(enum_cls, name: str):  # noqa: N802 - short helper for native-less enums stored as strings
    return Enum(enum_cls, name=name, native_enum=False, length=40, validate_strings=True)


def _in_list(values) -> str:
    return ", ".join(f"'{v.value}'" for v in values)


# --------------------------------------------------------------------------- users & auth
class User(IdMixin, TimestampMixin, Base):
    __tablename__ = "users"
    # A verified phone number belongs to one account only.
    __table_args__ = (
        Index("uq_users_verified_phone", "phone", unique=True, postgresql_where=text("phone_verified_at IS NOT NULL")),
    )
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(32))
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(120))
    locale: Mapped[str] = mapped_column(String(5), default="en")
    role: Mapped[Role] = mapped_column(E(Role, "role"), default=Role.member)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Broker exclusion: users attest at sign-up that they are not acting as a broker.
    not_broker_attested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    identity_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    phone_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    suspended_reason: Mapped[str | None] = mapped_column(String(500))
    # Per-category notification preferences, e.g. {"push": {"messages": true, "offers": true, ...}}
    notification_prefs: Mapped[dict] = mapped_column(Json, default=dict, server_default="{}")
    # Staff two-factor auth: TOTP secret encrypted with the document key; enabled once confirmed.
    totp_secret_encrypted: Mapped[str | None] = mapped_column(String(300))
    mfa_enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    totp_last_counter: Mapped[int | None] = mapped_column(Integer)


class PhoneVerification(IdMixin, Base):
    """One SMS code challenge. Only a keyed hash of the code is stored."""

    __tablename__ = "phone_verifications"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    phone: Mapped[str] = mapped_column(String(32))
    code_hash: Mapped[str] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DeviceToken(IdMixin, Base):
    """Push notification address of one app install (Expo push token)."""

    __tablename__ = "device_tokens"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(200), unique=True)
    platform: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RefreshToken(IdMixin, Base):
    __tablename__ = "refresh_tokens"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# --------------------------------------------------------------------------- catalog
class Project(IdMixin, TimestampMixin, Base):
    """A residential community, e.g. Madinaty. Names are geographic, not developer branding."""

    __tablename__ = "projects"
    slug: Mapped[str] = mapped_column(String(60), unique=True)
    name_en: Mapped[str] = mapped_column(String(120))
    name_ar: Mapped[str] = mapped_column(String(120))
    city_en: Mapped[str] = mapped_column(String(120))
    city_ar: Mapped[str] = mapped_column(String(120))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    districts: Mapped[list[District]] = relationship(back_populates="project", order_by="District.code")


class District(IdMixin, Base):
    __tablename__ = "districts"
    __table_args__ = (UniqueConstraint("project_id", "code", name="uq_districts_project_code"),)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    code: Mapped[str] = mapped_column(String(20))
    name_en: Mapped[str] = mapped_column(String(120))
    name_ar: Mapped[str] = mapped_column(String(120))
    project: Mapped[Project] = relationship(back_populates="districts")


# --------------------------------------------------------------------------- property identity
class Property(IdMixin, TimestampMixin, Base):
    """Canonical physical property. Survives ownership changes and listings."""

    __tablename__ = "properties"
    __table_args__ = (UniqueConstraint("project_id", "identity_key", name="uq_properties_identity"),)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"), index=True)
    district_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("districts.id"), index=True)
    group_code: Mapped[str] = mapped_column(String(20))
    building_code: Mapped[str] = mapped_column(String(20))
    unit_code: Mapped[str | None] = mapped_column(String(20))
    floor: Mapped[int | None] = mapped_column(Integer)
    identity_key: Mapped[str] = mapped_column(String(120))
    property_type: Mapped[PropertyType] = mapped_column(E(PropertyType, "property_type"))
    area_sqm: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    garden_sqm: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    bedrooms: Mapped[int] = mapped_column(Integer)
    bathrooms: Mapped[int] = mapped_column(Integer)
    finishing: Mapped[Finishing] = mapped_column(E(Finishing, "finishing"))
    delivery_status: Mapped[DeliveryStatus] = mapped_column(E(DeliveryStatus, "delivery_status"))
    orientation: Mapped[Orientation | None] = mapped_column(E(Orientation, "orientation"))
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    identity_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project: Mapped[Project] = relationship()
    district: Mapped[District] = relationship()


class OwnershipClaim(IdMixin, TimestampMixin, Base):
    __tablename__ = "ownership_claims"
    __table_args__ = (
        Index(
            "uq_claims_one_approved_per_property",
            "property_id",
            unique=True,
            postgresql_where=text("status = 'approved'"),
        ),
    )
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id"), index=True)
    claimant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    capacity: Mapped[ClaimCapacity] = mapped_column(E(ClaimCapacity, "claim_capacity"))
    # For legal representatives: name of the principal and the explicit scope of authority.
    principal_name: Mapped[str | None] = mapped_column(String(160))
    authority_scope: Mapped[list[str]] = mapped_column(Json, default=list)
    authority_expires_on: Mapped[date | None] = mapped_column(Date)
    status: Mapped[ClaimStatus] = mapped_column(E(ClaimStatus, "claim_status"), default=ClaimStatus.submitted)
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    decision_note: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    property: Mapped[Property] = relationship()
    claimant: Mapped[User] = relationship(foreign_keys=[claimant_id])


class PropertyDispute(IdMixin, TimestampMixin, Base):
    __tablename__ = "property_disputes"
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id"), index=True)
    challenger_claim_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ownership_claims.id"))
    existing_claim_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ownership_claims.id"))
    opened_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[DisputeStatus] = mapped_column(E(DisputeStatus, "dispute_status"), default=DisputeStatus.open)
    resolution_note: Mapped[str | None] = mapped_column(Text)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


# --------------------------------------------------------------------------- verification & documents
class Document(IdMixin, TimestampMixin, Base):
    """Private, encrypted-at-rest document. Never publicly addressable."""

    __tablename__ = "documents"
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[DocumentKind] = mapped_column(E(DocumentKind, "document_kind"))
    storage_key: Mapped[str] = mapped_column(String(200), unique=True)
    original_name: Mapped[str] = mapped_column(String(200))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    retain_until: Mapped[date] = mapped_column(Date)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class VerificationRequest(IdMixin, TimestampMixin, Base):
    __tablename__ = "verification_requests"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[VerificationKind] = mapped_column(E(VerificationKind, "verification_kind"))
    status: Mapped[VerificationStatus] = mapped_column(
        E(VerificationStatus, "verification_status"), default=VerificationStatus.submitted
    )
    claim_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ownership_claims.id"))
    listing_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("listings.id"))
    note: Mapped[str | None] = mapped_column(Text)
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    decision_note: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    document_ids: Mapped[list[str]] = mapped_column(Json, default=list)

    user: Mapped[User] = relationship(foreign_keys=[user_id])


# --------------------------------------------------------------------------- listings
class Listing(IdMixin, TimestampMixin, Base):
    __tablename__ = "listings"
    __table_args__ = (
        Index(
            "uq_listings_one_live_per_property",
            "property_id",
            unique=True,
            postgresql_where=text(f"status IN ({_in_list(LISTING_OCCUPYING_STATUSES)})"),
        ),
        Index("ix_listings_status_published", "status", "published_at"),
    )
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id"), index=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    claim_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ownership_claims.id"))
    purpose: Mapped[ListingPurpose] = mapped_column(E(ListingPurpose, "listing_purpose"))
    status: Mapped[ListingStatus] = mapped_column(E(ListingStatus, "listing_status"), default=ListingStatus.draft)
    title: Mapped[str] = mapped_column(String(140))
    description: Mapped[str] = mapped_column(Text, default="")
    # Sale financial input (see app.finance.engine.SaleInput); validated JSON with Decimal strings.
    sale_terms: Mapped[dict | None] = mapped_column(Json)
    # Rent input (see app.finance.engine.RentInput).
    rent_terms: Mapped[dict | None] = mapped_column(Json)
    # Denormalized for search & sorting; recomputed from sale_terms/rent_terms on every save.
    sale_cash_price: Mapped[Decimal | None] = mapped_column(Money, index=True)
    sale_initial_cash: Mapped[Decimal | None] = mapped_column(Money)
    sale_known_total: Mapped[Decimal | None] = mapped_column(Money)
    sale_payment_mode: Mapped[str | None] = mapped_column(String(20))
    monthly_rent: Mapped[Decimal | None] = mapped_column(Money, index=True)
    furnished: Mapped[bool | None] = mapped_column(Boolean)
    financials_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    moderation_note: Mapped[str | None] = mapped_column(Text)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    featured_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    view_count: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[int] = mapped_column(Integer, default=1)
    approved_version: Mapped[int | None] = mapped_column(Integer)

    property: Mapped[Property] = relationship()
    owner: Mapped[User] = relationship()
    photos: Mapped[list[ListingPhoto]] = relationship(
        back_populates="listing", order_by="ListingPhoto.position", cascade="all, delete-orphan"
    )


class ListingPhoto(IdMixin, Base):
    __tablename__ = "listing_photos"
    listing_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("listings.id", ondelete="CASCADE"), index=True)
    storage_key: Mapped[str] = mapped_column(String(200))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    listing: Mapped[Listing] = relationship(back_populates="photos")


class Favorite(Base):
    __tablename__ = "favorites"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    listing_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("listings.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# --------------------------------------------------------------------------- messaging & viewings
class Conversation(IdMixin, TimestampMixin, Base):
    __tablename__ = "conversations"
    __table_args__ = (UniqueConstraint("listing_id", "buyer_id", name="uq_conversations_listing_buyer"),)
    listing_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("listings.id"), index=True)
    buyer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    listing: Mapped[Listing] = relationship()


class Message(IdMixin, Base):
    __tablename__ = "messages"
    conversation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Viewing(IdMixin, TimestampMixin, Base):
    __tablename__ = "viewings"
    listing_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("listings.id"), index=True)
    requester_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    proposed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[ViewingStatus] = mapped_column(E(ViewingStatus, "viewing_status"), default=ViewingStatus.requested)
    note: Mapped[str | None] = mapped_column(String(500))
    listing: Mapped[Listing] = relationship()


# --------------------------------------------------------------------------- deals (negotiation + transaction workspace)
class Deal(IdMixin, TimestampMixin, Base):
    __tablename__ = "deals"
    __table_args__ = (
        Index(
            "uq_deals_one_committed_per_listing",
            "listing_id",
            unique=True,
            postgresql_where=text(f"status IN ({_in_list(DEAL_COMMITTED_STATUSES)})"),
        ),
        Index(
            "uq_deals_one_open_negotiation_per_buyer",
            "listing_id",
            "buyer_id",
            "kind",
            unique=True,
            postgresql_where=text("status = 'negotiating'"),
        ),
    )
    listing_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("listings.id"), index=True)
    kind: Mapped[DealKind] = mapped_column(E(DealKind, "deal_kind"))
    buyer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[DealStatus] = mapped_column(E(DealStatus, "deal_status"), default=DealStatus.negotiating)
    agreed_terms: Mapped[dict | None] = mapped_column(Json)
    # Pending two-party confirmations: {"<target_status>": ["buyer", "owner"]}
    confirmations: Mapped[dict] = mapped_column(Json, default=dict)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_reason: Mapped[str | None] = mapped_column(String(500))
    version: Mapped[int] = mapped_column(Integer, default=1)

    listing: Mapped[Listing] = relationship()
    offers: Mapped[list[Offer]] = relationship(back_populates="deal", order_by="Offer.created_at")
    checklist: Mapped[list[ChecklistItem]] = relationship(back_populates="deal", order_by="ChecklistItem.position")
    events: Mapped[list[DealEvent]] = relationship(back_populates="deal", order_by="DealEvent.created_at")


class Offer(IdMixin, TimestampMixin, Base):
    __tablename__ = "offers"
    __table_args__ = (
        Index("uq_offers_one_pending_per_deal", "deal_id", unique=True, postgresql_where=text("status = 'pending'")),
    )
    deal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("deals.id", ondelete="CASCADE"), index=True)
    made_by: Mapped[PartyRole] = mapped_column(E(PartyRole, "party_role"))
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    # Sale: amount = cash to seller. Rent: amount = monthly rent.
    amount: Mapped[Decimal] = mapped_column(Money)
    terms: Mapped[dict] = mapped_column(Json, default=dict)
    message: Mapped[str | None] = mapped_column(String(1000))
    status: Mapped[OfferStatus] = mapped_column(E(OfferStatus, "offer_status"), default=OfferStatus.pending)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    parent_offer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("offers.id"))
    deal: Mapped[Deal] = relationship(back_populates="offers")


class ChecklistItem(IdMixin, Base):
    __tablename__ = "deal_checklist_items"
    deal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("deals.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(60))
    responsible: Mapped[PartyRole] = mapped_column(E(PartyRole, "party_role"))
    required_for: Mapped[DealStatus] = mapped_column(E(DealStatus, "deal_status"))
    status: Mapped[ChecklistStatus] = mapped_column(E(ChecklistStatus, "checklist_status"), default=ChecklistStatus.pending)
    document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("documents.id"))
    position: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    deal: Mapped[Deal] = relationship(back_populates="checklist")


class DealEvent(IdMixin, Base):
    __tablename__ = "deal_events"
    deal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("deals.id", ondelete="CASCADE"), index=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    type: Mapped[str] = mapped_column(String(60))
    data: Mapped[dict] = mapped_column(Json, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    deal: Mapped[Deal] = relationship(back_populates="events")


# --------------------------------------------------------------------------- platform
class Notification(IdMixin, Base):
    __tablename__ = "notifications"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(60))
    data: Mapped[dict] = mapped_column(Json, default=dict)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class AuditLog(IdMixin, Base):
    """Append-only audit trail. Metadata is redacted before persistence."""

    __tablename__ = "audit_logs"
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str | None] = mapped_column(String(64), index=True)
    data: Mapped[dict] = mapped_column(Json, default=dict)
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class SupportCase(IdMixin, TimestampMixin, Base):
    __tablename__ = "support_cases"
    reporter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    category: Mapped[SupportCategory] = mapped_column(E(SupportCategory, "support_category"))
    subject_type: Mapped[str | None] = mapped_column(String(40))
    subject_id: Mapped[str | None] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[SupportStatus] = mapped_column(E(SupportStatus, "support_status"), default=SupportStatus.open)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    resolution_note: Mapped[str | None] = mapped_column(Text)


class ListingPriceEvent(IdMixin, Base):
    """Asking-price history. Written when a listing goes live and whenever a live listing's price changes.

    ``closed`` events (sold/rented) carry no amount: agreed prices are private to the parties and are
    never exposed, not even in aggregates.
    """

    __tablename__ = "listing_price_events"
    __table_args__ = (Index("ix_price_events_district_time", "district_id", "created_at"),)
    listing_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("listings.id", ondelete="CASCADE"), index=True)
    property_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("properties.id"))
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id"))
    district_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("districts.id"))
    property_type: Mapped[PropertyType] = mapped_column(E(PropertyType, "property_type"))
    area_sqm: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    kind: Mapped[str] = mapped_column(String(20))  # listed | price_changed | closed
    sale_cash_price: Mapped[Decimal | None] = mapped_column(Money)
    sale_known_total: Mapped[Decimal | None] = mapped_column(Money)
    monthly_rent: Mapped[Decimal | None] = mapped_column(Money)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SavedSearch(IdMixin, TimestampMixin, Base):
    __tablename__ = "saved_searches"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    filters: Mapped[dict] = mapped_column(Json, default=dict)
    alerts_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Listings published after this instant are "new" for alerts.
    last_alerted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LoginThrottle(Base):
    """Per-account failed-login counter, keyed by a hash of the normalized email.

    Tracked for unknown emails too, so lockout behaviour never reveals whether an account exists.
    """

    __tablename__ = "login_throttles"
    email_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    failures: Mapped[int] = mapped_column(Integer, default=0)
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    scope: Mapped[str] = mapped_column(String(80))
    request_hash: Mapped[str] = mapped_column(String(64))
    status_code: Mapped[int] = mapped_column(Integer)
    response: Mapped[dict] = mapped_column(Json)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
