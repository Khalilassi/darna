from enum import StrEnum


class Role(StrEnum):
    member = "member"          # buyers, tenants and owners (owner capability is earned via verification)
    reviewer = "reviewer"      # verification / moderation staff
    support = "support"        # support staff
    admin = "admin"            # platform administrators


class VerificationKind(StrEnum):
    identity = "identity"
    ownership = "ownership"
    financial = "financial"


class VerificationStatus(StrEnum):
    submitted = "submitted"
    under_review = "under_review"
    more_info_required = "more_info_required"
    approved = "approved"
    rejected = "rejected"
    withdrawn = "withdrawn"


class ClaimCapacity(StrEnum):
    owner = "owner"
    legal_representative = "legal_representative"


class ClaimStatus(StrEnum):
    submitted = "submitted"
    under_review = "under_review"
    approved = "approved"
    rejected = "rejected"
    disputed = "disputed"
    revoked = "revoked"
    superseded = "superseded"
    withdrawn = "withdrawn"


class DisputeStatus(StrEnum):
    open = "open"
    resolved_for_existing = "resolved_for_existing"
    resolved_for_challenger = "resolved_for_challenger"
    dismissed = "dismissed"


class PropertyType(StrEnum):
    apartment = "apartment"
    duplex = "duplex"
    penthouse = "penthouse"
    studio = "studio"
    villa = "villa"
    townhouse = "townhouse"
    twin_house = "twin_house"


class Finishing(StrEnum):
    core_shell = "core_shell"
    semi_finished = "semi_finished"
    fully_finished = "fully_finished"
    furnished = "furnished"


class DeliveryStatus(StrEnum):
    ready = "ready"
    under_construction = "under_construction"


class Orientation(StrEnum):
    north = "north"
    south = "south"
    east = "east"
    west = "west"
    north_east = "north_east"
    north_west = "north_west"
    south_east = "south_east"
    south_west = "south_west"


class ListingPurpose(StrEnum):
    sale = "sale"
    rent = "rent"
    sale_and_rent = "sale_and_rent"


class ListingStatus(StrEnum):
    draft = "draft"
    pending_review = "pending_review"
    active = "active"
    under_offer = "under_offer"
    paused = "paused"
    suspended = "suspended"
    rejected = "rejected"
    withdrawn = "withdrawn"
    sold = "sold"
    rented = "rented"


# Statuses in which a listing "occupies" its property. A partial unique index guarantees at most
# one listing per property in this set, which is stricter than (and therefore implies) the rule
# "at most one active public listing per physical property".
LISTING_OCCUPYING_STATUSES = (
    ListingStatus.draft,
    ListingStatus.pending_review,
    ListingStatus.active,
    ListingStatus.under_offer,
    ListingStatus.paused,
    ListingStatus.suspended,
)
LISTING_PUBLIC_STATUSES = (ListingStatus.active, ListingStatus.under_offer)


class PaymentMode(StrEnum):
    cash = "cash"                # fully paid unit resold for cash
    installments = "installments"  # buyer takes over remaining developer installments


class Provenance(StrEnum):
    verified = "verified"            # checked by platform reviewer against a document
    seller_provided = "seller_provided"
    estimate = "estimate"            # computed/assumed; must carry an assumption text
    unknown = "unknown"              # amount not known; excluded from totals


class Payer(StrEnum):
    buyer = "buyer"
    seller = "seller"
    included_in_price = "included_in_price"  # already covered by the owner cash price -> never added again
    split = "split"


class DealKind(StrEnum):
    sale = "sale"
    rent = "rent"


class DealStatus(StrEnum):
    # shared
    negotiating = "negotiating"
    cancelled = "cancelled"
    # sale
    offer_accepted = "offer_accepted"          # preliminary, NOT legally binding
    due_diligence = "due_diligence"
    contract_preparation = "contract_preparation"
    contract_signed = "contract_signed"        # recorded by parties; signing happens off-platform
    developer_transfer = "developer_transfer"  # external developer assignment / registration
    completed = "completed"                    # platform record closed; NOT a legal transfer
    # rent
    terms_agreed = "terms_agreed"
    lease_preparation = "lease_preparation"
    lease_signed = "lease_signed"
    handover_scheduled = "handover_scheduled"
    lease_active = "lease_active"


DEAL_COMMITTED_STATUSES = (
    DealStatus.offer_accepted,
    DealStatus.due_diligence,
    DealStatus.contract_preparation,
    DealStatus.contract_signed,
    DealStatus.developer_transfer,
    DealStatus.terms_agreed,
    DealStatus.lease_preparation,
    DealStatus.lease_signed,
    DealStatus.handover_scheduled,
)


class OfferStatus(StrEnum):
    pending = "pending"
    accepted = "accepted"
    rejected = "rejected"
    countered = "countered"
    withdrawn = "withdrawn"
    expired = "expired"


class PartyRole(StrEnum):
    buyer = "buyer"  # buyer or tenant
    owner = "owner"


class ChecklistStatus(StrEnum):
    pending = "pending"
    submitted = "submitted"
    accepted = "accepted"
    waived = "waived"


class ViewingStatus(StrEnum):
    requested = "requested"
    confirmed = "confirmed"
    declined = "declined"
    cancelled = "cancelled"
    completed = "completed"
    no_show = "no_show"


class DocumentKind(StrEnum):
    national_id = "national_id"
    passport = "passport"
    ownership_contract = "ownership_contract"
    power_of_attorney = "power_of_attorney"
    developer_statement = "developer_statement"
    payment_receipt = "payment_receipt"
    maintenance_receipt = "maintenance_receipt"
    sale_contract = "sale_contract"
    lease_contract = "lease_contract"
    other = "other"


class SupportCategory(StrEnum):
    broker_report = "broker_report"
    fraud = "fraud"
    listing_issue = "listing_issue"
    account = "account"
    other = "other"


class SupportStatus(StrEnum):
    open = "open"
    in_progress = "in_progress"
    resolved = "resolved"
    closed = "closed"


class ServiceCategory(StrEnum):
    lawyer = "lawyer"                  # contract review, registration, due diligence
    notary_services = "notary_services"  # help with notarization / real-estate registry paperwork
    surveyor = "surveyor"              # property inspection, area measurement
    mover = "mover"
    maintenance = "maintenance"        # handyman, AC, plumbing
    interior = "interior"              # finishing and interior works
    cleaning = "cleaning"


class ReferralStatus(StrEnum):
    requested = "requested"
    contacted = "contacted"   # provider reports they contacted the user
    completed = "completed"
    cancelled = "cancelled"
