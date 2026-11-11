"""Seed a development database with clearly SYNTHETIC data.

Nothing here describes a real person or a real property. All demo accounts use example.com
addresses and the shared demo password printed at the end. Run: ``python seed.py [--reset]``.
"""
from __future__ import annotations

import io
import random
import sys
from datetime import UTC, date, datetime, timedelta
from datetime import date as _date
from decimal import Decimal

from PIL import Image, ImageDraw
from sqlalchemy import select, text

from app.core.config import get_settings
from app.core.db import Base, get_engine, session_factory
from app.core.security import hash_password, sha256_hex
from app.core.storage import private_storage, public_storage
from app.models.entities import (
    ChecklistItem,
    Conversation,
    Deal,
    DealEvent,
    District,
    Document,
    Listing,
    ListingPhoto,
    ListingPriceEvent,
    Message,
    Offer,
    OwnershipClaim,
    Project,
    Property,
    SupportCase,
    User,
    VerificationRequest,
)
from app.models.enums import (
    ClaimCapacity,
    ClaimStatus,
    DealKind,
    DealStatus,
    DeliveryStatus,
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
    VerificationKind,
)
from app.modules.deals import CHECKLISTS
from app.modules.listings import _refresh_denormalized

DEMO_PASSWORD = "Demo-pass-2026"
rng = random.Random(42)
NOW = datetime.now(UTC)

PROJECTS = [
    ("madinaty", "Madinaty", "مدينتي", True, [("B1", "B1", "بي ١"), ("B2", "B2", "بي ٢"), ("B3", "B3", "بي ٣"), ("B6", "B6", "بي ٦"),
                                            ("B7", "B7", "بي ٧"), ("B8", "B8", "بي ٨"), ("B10", "B10", "بي ١٠"), ("B11", "B11", "بي ١١"),
                                            ("B12", "B12", "بي ١٢"), ("B14", "B14", "بي ١٤"), ("B15", "B15", "بي ١٥"), ("VG", "Villas Area", "منطقة الفيلات")]),
    ("al-rehab", "Al Rehab", "الرحاب", False, [("P1", "Phase 1", "المرحلة ١")]),
    ("noor", "Noor", "نور", False, [("D1", "District 1", "الحي ١")]),
    ("celia", "Celia", "سيليا", False, [("D1", "District 1", "الحي ١")]),
]

TITLES = {
    PropertyType.apartment: ["Bright {b}-bedroom apartment with garden view", "Quiet {b}BR apartment close to services",
                             "Renovated {b}-bedroom flat near the park"],
    PropertyType.duplex: ["Spacious {b}-bedroom duplex with roof terrace"],
    PropertyType.penthouse: ["Top-floor {b}-bedroom penthouse with open view"],
    PropertyType.villa: ["Detached {b}-bedroom villa with private garden"],
    PropertyType.townhouse: ["Corner {b}-bedroom townhouse near the club"],
}
PALETTE = [(46, 94, 78), (189, 140, 86), (92, 118, 140), (160, 98, 82), (110, 128, 96), (70, 80, 110)]


def synthetic_photo(seed: int) -> bytes:
    """Abstract illustration (sky, building blocks, lawn). Clearly not a photo of a real unit."""
    r = random.Random(seed)
    w, h = 1200, 800
    img = Image.new("RGB", (w, h), (214, 228, 238))
    d = ImageDraw.Draw(img)
    for y in range(h // 2):
        t = y / (h / 2)
        d.line([(0, y), (w, y)], fill=(int(186 + 40 * t), int(212 + 20 * t), int(236 + 10 * t)))
    d.rectangle([0, int(h * 0.72), w, h], fill=(122, 160, 104))
    base = r.choice(PALETTE)
    x = 80
    while x < w - 120:
        bw, bh = r.randint(160, 280), r.randint(260, 460)
        tone = tuple(min(255, c + r.randint(-15, 40)) for c in base)
        top = int(h * 0.72) - bh
        d.rectangle([x, top, x + bw, int(h * 0.72)], fill=tone)
        for wy in range(top + 24, int(h * 0.72) - 40, 54):
            for wx in range(x + 18, x + bw - 30, 46):
                d.rectangle([wx, wy, wx + 24, wy + 30], fill=(236, 240, 232))
        x += bw + r.randint(20, 60)
    d.text((24, h - 36), "SYNTHETIC SAMPLE IMAGE", fill=(255, 255, 255))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=82)
    return out.getvalue()


def money(v: int, prov: str = "seller_provided") -> dict:
    return {"amount": str(Decimal(v)), "provenance": prov}


def sale_terms(area: Decimal, installments: bool) -> dict:
    ppsqm = rng.randint(38000, 62000)
    paid_base = int(area * ppsqm)
    if not installments:
        price = round(paid_base, -4)
        return {"payment_mode": "cash", "owner_cash_price": money(price),
                "maintenance_deposit_due": money(round(price * 0.05, -3)) if rng.random() < 0.3 else None,
                "maintenance_payer": "buyer",
                "fees": [{"code": "transfer_fee", "value": {"provenance": "unknown"}, "payer": "buyer"}]}
    paid = round(paid_base * rng.uniform(0.35, 0.6), -4)
    premium = round(paid_base * rng.uniform(0.08, 0.2), -4)
    remaining = paid_base - paid
    n = rng.choice([8, 12, 16, 20])
    each = round(remaining / n, -3)
    start = date.today().replace(day=1)
    insts = []
    for i in range(n):
        due = (start + timedelta(days=95 * (i + 1))).replace(day=1)
        insts.append({"due_date": due.isoformat(), "amount": str(each), "schedule": "unit"})
    overdue = rng.random() < 0.25
    if overdue:
        insts.insert(0, {"due_date": (start - timedelta(days=60)).isoformat(), "amount": str(each), "schedule": "unit"})
    if rng.random() < 0.3:
        insts.append({"due_date": (start + timedelta(days=200)).isoformat(), "amount": "45000", "schedule": "garage"})
    return {"payment_mode": "installments", "owner_cash_price": money(paid + premium), "paid_to_developer": money(paid),
            "installments": insts, "overdue_payer": rng.choice(["seller", "buyer", "included_in_price"]) if overdue else "seller",
            "maintenance_deposit_due": money(round(paid_base * 0.08, -3)), "maintenance_payer": "buyer",
            "fees": [{"code": "transfer_fee", "value": {"provenance": "unknown"}, "payer": "buyer"}]}


def rent_terms(area: Decimal, furnished: bool) -> dict:
    rent = round(int(area) * rng.randint(120, 220) * (1.25 if furnished else 1), -3)
    return {"monthly_rent": str(rent), "security_deposit_months": "1", "advance_months": rng.choice([1, 3]),
            "min_lease_months": 12, "furnished": furnished, "utilities_included": False,
            "annual_increase_pct": "10", "available_from": (date.today() + timedelta(days=rng.randint(0, 45))).isoformat()}


def main(reset: bool) -> None:
    engine = get_engine()
    if reset:
        names = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
        with engine.begin() as c:
            c.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
    db = session_factory()()
    if db.scalar(select(Project.id).limit(1)):
        print("Database already seeded (use --reset to wipe and reseed).")
        return
    get_settings().storage_dir.mkdir(parents=True, exist_ok=True)

    districts: dict[str, list[District]] = {}
    projects: dict[str, Project] = {}
    for slug, en, ar, active, ds in PROJECTS:
        p = Project(slug=slug, name_en=en, name_ar=ar, city_en="New Cairo" if slug != "noor" else "New Capital region",
                    city_ar="القاهرة الجديدة", is_active=active)
        db.add(p)
        db.flush()
        projects[slug] = p
        districts[slug] = []
        for code, den, dar in ds:
            d = District(project_id=p.id, code=code, name_en=den, name_ar=dar)
            db.add(d)
            districts[slug].append(d)
    db.flush()

    pw = hash_password(DEMO_PASSWORD)

    def user(email, name, role=Role.member, verified=True, locale="en"):
        u = User(email=email, full_name=name, password_hash=pw, role=role, locale=locale, not_broker_attested_at=NOW,
                 identity_verified_at=NOW if verified else None)
        db.add(u)
        return u

    admin = user("admin@example.com", "Demo Admin", Role.admin)
    reviewer = user("reviewer@example.com", "Demo Reviewer", Role.reviewer)
    user("support@example.com", "Demo Support", Role.support)
    owners = [user("owner@example.com", "Omar Demo-Owner"), user("owner2@example.com", "Mona Demo-Owner", locale="ar"),
              user("owner3@example.com", "Karim Demo-Owner")]
    buyer = user("buyer@example.com", "Bassem Demo-Buyer", verified=False)
    user("tenant@example.com", "Tala Demo-Tenant", verified=False, locale="ar")
    newowner = user("newowner@example.com", "Nadia Demo-NewOwner", verified=False)
    db.flush()

    mad = districts["madinaty"]
    created = 0
    for i in range(30):
        owner = owners[i % len(owners)]
        ptype = rng.choices([PropertyType.apartment, PropertyType.duplex, PropertyType.penthouse, PropertyType.villa,
                             PropertyType.townhouse], weights=[10, 2, 1, 2, 2])[0]
        detached = ptype in (PropertyType.villa, PropertyType.townhouse)
        # Apartments concentrate in four districts so market summaries have enough samples to show.
        district = mad[-1] if detached else rng.choice(mad[:4])
        beds = {PropertyType.villa: 4, PropertyType.townhouse: 3, PropertyType.penthouse: 3, PropertyType.duplex: 4}.get(ptype, rng.choice([2, 3, 3, 4]))
        area = Decimal({PropertyType.villa: rng.randint(280, 420), PropertyType.townhouse: rng.randint(220, 300)}.get(ptype, rng.randint(85, 230)))
        group, building = str(rng.randint(1, 140)), (f"V{rng.randint(1, 600)}" if detached else str(rng.randint(1, 60)))
        unit = None if detached else str(rng.randint(1, 4) * 10 + rng.randint(1, 4))
        prop = Property(
            project_id=projects["madinaty"].id, district_id=district.id, group_code=group, building_code=building, unit_code=unit,
            floor=None if detached else rng.randint(0, 5), identity_key=f"{district.code}|{group}|{building}|{unit or '-'}",
            property_type=ptype, area_sqm=area, garden_sqm=Decimal(rng.randint(40, 200)) if detached or rng.random() < 0.2 else None,
            bedrooms=beds, bathrooms=max(1, beds - rng.choice([0, 1])), finishing=rng.choice(list(Finishing)),
            delivery_status=DeliveryStatus.ready if rng.random() < 0.8 else DeliveryStatus.under_construction,
            orientation=rng.choice(list(Orientation)), created_by_id=owner.id, identity_confirmed_at=NOW,
        )
        db.add(prop)
        db.flush()
        claim = OwnershipClaim(property_id=prop.id, claimant_id=owner.id, capacity=ClaimCapacity.owner, status=ClaimStatus.approved,
                               reviewer_id=reviewer.id, decided_at=NOW, decision_note="Synthetic seed approval")
        db.add(claim)
        db.flush()
        purpose = rng.choices([ListingPurpose.sale, ListingPurpose.rent, ListingPurpose.sale_and_rent], weights=[6, 4, 1])[0]
        furnished = rng.random() < 0.4
        listing = Listing(
            property_id=prop.id, owner_id=owner.id, claim_id=claim.id, purpose=purpose,
            title=rng.choice(TITLES[ptype]).format(b=beds),
            description=("Synthetic demo listing for development. Close to schools, services and green areas. "
                         "Figures are illustrative and not real market data."),
            sale_terms=sale_terms(area, rng.random() < 0.55) if purpose != ListingPurpose.rent else None,
            rent_terms=rent_terms(area, furnished) if purpose != ListingPurpose.sale else None,
            status=ListingStatus.active, published_at=NOW - timedelta(days=rng.randint(0, 40)), version=1, approved_version=1,
            featured_until=NOW + timedelta(days=7) if i in (2, 9) else None, view_count=rng.randint(0, 300),
        )
        listing.property = prop
        _refresh_denormalized(listing)
        db.add(listing)
        db.flush()
        db.add(ListingPriceEvent(listing_id=listing.id, property_id=prop.id, project_id=prop.project_id, district_id=prop.district_id,
                                 property_type=prop.property_type, area_sqm=prop.area_sqm, kind="listed",
                                 sale_cash_price=listing.sale_cash_price, sale_known_total=listing.sale_known_total,
                                 monthly_rent=listing.monthly_rent, created_at=listing.published_at))
        for pos in range(rng.randint(3, 5)):
            key, w, h = public_storage().put_image(synthetic_photo(i * 10 + pos))
            db.add(ListingPhoto(listing_id=listing.id, storage_key=key, width=w, height=h, position=pos))
        created += 1
    _review_and_activity_samples(db, owners, buyer, newowner, mad, projects["madinaty"])
    db.commit()
    print(f"Seeded {created} synthetic listings. Demo accounts (password: {DEMO_PASSWORD}):")
    for e in ("admin@example.com", "reviewer@example.com", "support@example.com", "owner@example.com", "owner2@example.com",
              "buyer@example.com", "tenant@example.com", "newowner@example.com"):
        print("  ", e)
    _ = admin


def _synthetic_doc(db, owner: User, kind: DocumentKind) -> Document:
    data = b"%PDF-1.4\n% SYNTHETIC DEMO DOCUMENT - not a real record\n"
    doc = Document(owner_id=owner.id, kind=kind, storage_key=private_storage().put(data), original_name=f"demo-{kind.value}.pdf",
                   content_type="application/pdf", size_bytes=len(data), sha256=sha256_hex(data),
                   retain_until=_date.today() + timedelta(days=365))
    db.add(doc)
    db.flush()
    return doc


def _review_and_activity_samples(db, owners, buyer, newowner, mad, project) -> None:
    """Pending work for the admin console and an active negotiation for the buyer demo."""
    # 1. Pending identity verification + pending ownership claim for the new owner.
    nid = _synthetic_doc(db, newowner, DocumentKind.national_id)
    db.add(VerificationRequest(user_id=newowner.id, kind=VerificationKind.identity, document_ids=[str(nid.id)],
                               note="Synthetic demo submission"))
    prop = Property(project_id=project.id, district_id=mad[2].id, group_code="88", building_code="14", unit_code="23", floor=2,
                    identity_key=f"{mad[2].code}|88|14|23", property_type=PropertyType.apartment, area_sqm=Decimal("132"),
                    bedrooms=3, bathrooms=2, finishing=Finishing.semi_finished, delivery_status=DeliveryStatus.ready,
                    orientation=Orientation.north, created_by_id=newowner.id)
    db.add(prop)
    db.flush()
    claim = OwnershipClaim(property_id=prop.id, claimant_id=newowner.id, capacity=ClaimCapacity.owner)
    db.add(claim)
    db.flush()
    contract = _synthetic_doc(db, newowner, DocumentKind.ownership_contract)
    db.add(VerificationRequest(user_id=newowner.id, kind=VerificationKind.ownership, claim_id=claim.id,
                               document_ids=[str(contract.id)], note="Synthetic demo claim"))

    # 2. A listing waiting for moderation (owner is verified).
    listing = db.scalar(select(Listing).where(Listing.owner_id == owners[2].id).order_by(Listing.created_at.desc()))
    if listing:
        listing.status = ListingStatus.pending_review
        listing.approved_version = None
        listing.published_at = None

    # 3. An open negotiation + conversation between the demo buyer and the first owner.
    target = db.scalar(select(Listing).where(Listing.owner_id == owners[0].id, Listing.status == ListingStatus.active,
                                             Listing.sale_cash_price.is_not(None)).order_by(Listing.created_at))
    if target:
        conv = Conversation(listing_id=target.id, buyer_id=buyer.id, owner_id=owners[0].id, last_message_at=NOW)
        db.add(conv)
        db.flush()
        db.add_all([
            Message(conversation_id=conv.id, sender_id=buyer.id, body="Hello, is the apartment still available?",
                    created_at=NOW - timedelta(hours=5)),
            Message(conversation_id=conv.id, sender_id=owners[0].id, body="Yes, happy to arrange a viewing.",
                    created_at=NOW - timedelta(hours=4)),
        ])
        deal = Deal(listing_id=target.id, kind=DealKind.sale, buyer_id=buyer.id, owner_id=owners[0].id, confirmations={})
        db.add(deal)
        db.flush()
        for i, (code, who, req) in enumerate(CHECKLISTS[DealKind.sale]):
            db.add(ChecklistItem(deal_id=deal.id, code=code, responsible=who, required_for=req, position=i))
        amount = (target.sale_cash_price * Decimal("0.95")).quantize(Decimal("1000"))
        db.add(Offer(deal_id=deal.id, made_by=PartyRole.buyer, author_id=buyer.id, amount=amount, terms={},
                     message="Synthetic demo offer", status=OfferStatus.pending, expires_at=NOW + timedelta(hours=60)))
        db.add(DealEvent(deal_id=deal.id, actor_id=buyer.id, type="deal.opened", data={"kind": "sale"}))
        assert deal.status == DealStatus.negotiating

    # 4. A support case.
    db.add(SupportCase(reporter_id=buyer.id, category=SupportCategory.broker_report, subject_type="listing",
                       description="Synthetic demo report: caller said they represent an agency."))


if __name__ == "__main__":
    main(reset="--reset" in sys.argv)
