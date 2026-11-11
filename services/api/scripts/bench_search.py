"""Search performance benchmark.

Fills a DEDICATED database with N synthetic listings and times representative searches through the real
search code (``run_search``), reporting p50/p95 latency and the plan of each query.

    DARNA_DATABASE_URL=postgresql+psycopg:///darna_bench?host=/var/run/postgresql \\
        python scripts/bench_search.py --listings 20000 [--explain]

Never point it at a database you care about: it truncates all tables first.
"""
from __future__ import annotations

import argparse
import random
import statistics
import time
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import text

from app.core.db import Base, get_engine, session_factory
from app.models.entities import ClaimStatus, District, Listing, OwnershipClaim, Project, Property, User
from app.models.enums import (
    DeliveryStatus,
    Finishing,
    ListingPurpose,
    ListingStatus,
    Orientation,
    PropertyType,
    Role,
)
from app.modules.listings import SearchFilters, run_search, search_conditions

WORDS = ["garden", "corner", "view", "renovated", "quiet", "spacious", "bright", "park", "club", "school", "family", "modern"]


def populate(n: int) -> dict:
    names = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    with get_engine().begin() as c:
        c.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
    db = session_factory()()
    rng = random.Random(7)
    now = datetime.now(UTC)
    project = Project(slug="bench", name_en="Bench", name_ar="بنش", city_en="X", city_ar="س")
    db.add(project)
    db.flush()
    districts = [District(project_id=project.id, code=f"D{i}", name_en=f"D{i}", name_ar=f"د{i}") for i in range(12)]
    db.add_all(districts)
    owner = User(email="bench-owner@example.com", full_name="Bench Owner", password_hash="x", role=Role.member,
                 not_broker_attested_at=now, identity_verified_at=now)
    db.add(owner)
    db.flush()
    props, claims, listings = [], [], []
    for i in range(n):
        d = districts[i % len(districts)]
        p = Property(project_id=project.id, district_id=d.id, group_code=str(i // 400), building_code=str(i // 8), unit_code=str(i),
                     floor=rng.randint(0, 6), identity_key=f"{d.code}|{i // 400}|{i // 8}|{i}",
                     property_type=rng.choice([PropertyType.apartment] * 6 + [PropertyType.villa, PropertyType.duplex]),
                     area_sqm=Decimal(rng.randint(80, 400)), bedrooms=rng.randint(1, 5), bathrooms=rng.randint(1, 4),
                     finishing=rng.choice(list(Finishing)), delivery_status=rng.choice(list(DeliveryStatus)),
                     orientation=rng.choice(list(Orientation)), created_by_id=owner.id)
        props.append(p)
    db.add_all(props)
    db.flush()
    for p in props:
        claims.append(OwnershipClaim(property_id=p.id, claimant_id=owner.id, capacity="owner", status=ClaimStatus.approved))
    db.add_all(claims)
    db.flush()
    for p, c in zip(props, claims, strict=True):
        purpose = rng.choice([ListingPurpose.sale, ListingPurpose.sale, ListingPurpose.rent, ListingPurpose.sale_and_rent])
        price = Decimal(rng.randint(1_500_000, 25_000_000)) if purpose != ListingPurpose.rent else None
        rent = Decimal(rng.randint(8_000, 90_000)) if purpose != ListingPurpose.sale else None
        status = ListingStatus.active if rng.random() < 0.7 else rng.choice([ListingStatus.sold, ListingStatus.withdrawn, ListingStatus.paused])
        listings.append(Listing(
            property_id=p.id, owner_id=owner.id, claim_id=c.id, purpose=purpose, status=status,
            title=" ".join(rng.sample(WORDS, 3)).capitalize() + f" home {p.bedrooms}BR",
            description=" ".join(rng.choices(WORDS, k=40)) + (" skylight" if rng.random() < 0.01 else ""),
            sale_cash_price=price, sale_known_total=price * Decimal("1.1") if price else None, sale_initial_cash=price,
            sale_payment_mode=rng.choice(["cash", "installments"]) if price else None, monthly_rent=rent,
            furnished=rng.random() < 0.4 if rent else None, published_at=now - timedelta(days=rng.randint(0, 365)),
        ))
    db.add_all(listings)
    db.commit()
    with get_engine().begin() as c:
        c.execute(text("ANALYZE"))
    ids = {"project": project.id, "district": districts[3].id}
    db.close()
    return ids


def cases(ids: dict) -> dict[str, tuple[SearchFilters, str]]:
    return {
        "default (newest)": (SearchFilters(project_id=ids["project"]), "newest"),
        "sale, 3+ beds, price range": (SearchFilters(project_id=ids["project"], purpose="sale", bedrooms_min=3,
                                                     price_min=Decimal(3_000_000), price_max=Decimal(8_000_000)), "price_asc"),
        "rent, district, furnished": (SearchFilters(district_id=ids["district"], purpose="rent", furnished=True), "newest"),
        "text search 'garden'": (SearchFilters(q="garden"), "newest"),
        "text search 'corner view'": (SearchFilters(q="corner view"), "newest"),
        "text search rare 'skylight'": (SearchFilters(q="skylight"), "newest"),
        "price per m2 sort": (SearchFilters(purpose="sale"), "ppsqm_asc"),
    }


def run(ids: dict, repeats: int, explain: bool) -> None:
    db = session_factory()()
    print(f"{'query':32} {'p50 ms':>8} {'p95 ms':>8} {'results':>8}")
    for name, (f, sort) in cases(ids).items():
        times, total = [], 0
        for _ in range(repeats):
            t = time.perf_counter()
            total = run_search(db, f, sort, 1, 20).total
            times.append((time.perf_counter() - t) * 1000)
        times.sort()
        print(f"{name:32} {statistics.median(times):8.1f} {times[int(len(times) * 0.95) - 1]:8.1f} {total:8d}")
        if explain:
            from sqlalchemy import and_, select

            conds, _ = search_conditions(f)
            q = select(Listing.id).join(Property, Listing.property_id == Property.id).where(and_(*conds)).limit(20)
            sql = q.compile(get_engine(), compile_kwargs={"literal_binds": True})
            plan = db.execute(text(f"EXPLAIN (ANALYZE, BUFFERS OFF, TIMING OFF) {sql}")).scalars().all()
            for line in plan[:6]:
                print("    ", line)
    db.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--listings", type=int, default=20000)
    ap.add_argument("--repeats", type=int, default=30)
    ap.add_argument("--explain", action="store_true")
    ap.add_argument("--skip-populate", action="store_true")
    a = ap.parse_args()
    t = time.perf_counter()
    if a.skip_populate:
        db = session_factory()()
        ids = {"project": db.scalar(text("select id from projects limit 1")), "district": db.scalar(text("select id from districts order by code limit 1 offset 3"))}
        db.close()
    else:
        ids = populate(a.listings)
        print(f"populated {a.listings} listings in {time.perf_counter() - t:.1f}s")
    run(ids, a.repeats, a.explain)
