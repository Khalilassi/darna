"""Integration test harness: real PostgreSQL, schema built by Alembic migrations."""
from __future__ import annotations

import io
import os
import tempfile
import uuid
from datetime import UTC, datetime

os.environ.setdefault("DARNA_DATABASE_URL", "postgresql+psycopg://postgres@localhost:5432/darna_test")
os.environ["DARNA_ENV"] = "test"
os.environ["DARNA_RATE_LIMIT_ENABLED"] = "false"
os.environ["DARNA_STORAGE_DIR"] = tempfile.mkdtemp(prefix="darna-test-")

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.db import Base, get_engine, session_factory  # noqa: E402
from app.main import app  # noqa: E402
from app.models.entities import District, Project, User  # noqa: E402
from app.models.enums import Role  # noqa: E402

HERE = os.path.dirname(os.path.dirname(__file__))
PASSWORD = "Sup3r-secret-pass"


@pytest.fixture(scope="session", autouse=True)
def _schema():
    engine = get_engine()
    with engine.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    cfg = Config(os.path.join(HERE, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(HERE, "alembic"))
    cfg.attributes["database_url"] = os.environ["DARNA_DATABASE_URL"]
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def _clean():
    yield
    names = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    with get_engine().begin() as c:
        c.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))


@pytest.fixture
def db():
    s = session_factory()()
    yield s
    s.close()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def project(db):
    p = Project(slug="madinaty", name_en="Madinaty", name_ar="مدينتي", city_en="New Cairo", city_ar="القاهرة الجديدة")
    db.add(p)
    db.flush()
    d1 = District(project_id=p.id, code="B2", name_en="B2", name_ar="بي ٢")
    d2 = District(project_id=p.id, code="B6", name_en="B6", name_ar="بي ٦")
    db.add_all([d1, d2])
    db.commit()
    return {"id": p.id, "districts": [d1.id, d2.id]}


class Actor:
    def __init__(self, client: TestClient, user_id: uuid.UUID, token: str, email: str):
        self.client, self.id, self.token, self.email = client, user_id, token, email

    @property
    def h(self):
        return {"Authorization": f"Bearer {self.token}"}

    def get(self, url, **kw):
        return self.client.get(url, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def post(self, url, **kw):
        return self.client.post(url, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def patch(self, url, **kw):
        return self.client.patch(url, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def put(self, url, **kw):
        return self.client.put(url, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def delete(self, url, **kw):
        return self.client.delete(url, headers={**self.h, **kw.pop("headers", {})}, **kw)

    def upload_doc(self, kind: str, content: bytes = b"%PDF-1.4 synthetic test document") -> str:
        r = self.post("/documents", data={"kind": kind}, files={"file": ("doc.pdf", content, "application/pdf")})
        assert r.status_code == 201, r.text
        return r.json()["id"]


@pytest.fixture
def make_user(client, db):
    counter = {"n": 0}

    def _make(role: Role = Role.member, name: str = "Test User", verified: bool = False) -> Actor:
        counter["n"] += 1
        email = f"user{counter['n']}-{uuid.uuid4().hex[:6]}@example.com"
        r = client.post("/auth/register", json={"email": email, "password": PASSWORD, "full_name": name, "attest_not_broker": True})
        assert r.status_code == 201, r.text
        u = db.query(User).filter_by(email=email).one()
        if role != Role.member or verified:
            u.role = role
            if verified:
                u.identity_verified_at = datetime.now(UTC)
            db.commit()
        r = client.post("/auth/login", json={"email": email, "password": PASSWORD})
        return Actor(client, u.id, r.json()["access_token"], email)

    return _make


@pytest.fixture
def reviewer(make_user):
    return make_user(Role.reviewer, "Rana Reviewer")


@pytest.fixture
def admin(make_user):
    return make_user(Role.admin, "Adam Admin")


def jpeg_bytes(color=(120, 140, 160)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), color).save(buf, format="JPEG")
    return buf.getvalue()


def property_payload(project, unit="12", building="45", group="7", ptype="apartment", district_idx=0, **extra):
    return {
        "project_id": str(project["id"]), "district_id": str(project["districts"][district_idx]),
        "group_code": group, "building_code": building, "unit_code": unit, "property_type": ptype,
        "floor": 3, "area_sqm": "150", "bedrooms": 3, "bathrooms": 2, "finishing": "fully_finished",
        "delivery_status": "ready", "orientation": "north", **extra,
    }


def register_property(owner: Actor, project, **kw):
    doc = owner.upload_doc("ownership_contract")
    r = owner.post("/properties", json={"property": property_payload(project, **kw), "claim": {"document_ids": [doc]}})
    return r


def approve_pending_claim(reviewer: Actor, claim_id: str):
    q = reviewer.get("/admin/verifications", params={"kind": "ownership"}).json()
    vr = next(v for v in q if v["claim_id"] == claim_id)
    r = reviewer.post(f"/admin/verifications/{vr['id']}/decision", json={"decision": "approve", "note": "documents match"})
    assert r.status_code == 200, r.text


SALE_TERMS = {
    "payment_mode": "installments",
    "owner_cash_price": {"amount": "2500000", "provenance": "seller_provided"},
    "paid_to_developer": {"amount": "2000000", "provenance": "seller_provided"},
    "installments": [{"due_date": "2030-01-01", "amount": "100000"}, {"due_date": "2031-01-01", "amount": "100000"}],
    "maintenance_deposit_due": {"amount": "50000", "provenance": "seller_provided"},
    "maintenance_payer": "buyer",
    "fees": [{"code": "transfer_fee", "value": {"provenance": "unknown"}, "payer": "buyer"}],
}
RENT_TERMS = {"monthly_rent": "25000", "security_deposit_months": "2", "advance_months": 1, "min_lease_months": 12, "furnished": True}


def publish_listing(owner: Actor, reviewer: Actor, project, purpose="sale", **prop_kw) -> str:
    """Full owner journey up to an active listing. Owner must be identity-verified."""
    r = register_property(owner, project, **prop_kw)
    assert r.status_code == 201, r.text
    body = r.json()
    approve_pending_claim(reviewer, body["claim"]["id"])
    payload = {"property_id": body["property"]["id"], "purpose": purpose, "title": "Bright 3BR apartment near services",
               "description": "Synthetic demo listing"}
    if purpose in ("sale", "sale_and_rent"):
        payload["sale_terms"] = SALE_TERMS
    if purpose in ("rent", "sale_and_rent"):
        payload["rent_terms"] = RENT_TERMS
    r = owner.post("/listings", json=payload)
    assert r.status_code == 201, r.text
    lid = r.json()["id"]
    r = owner.post(f"/listings/{lid}/photos", files={"file": ("a.jpg", jpeg_bytes(), "image/jpeg")})
    assert r.status_code == 201, r.text
    r = owner.post(f"/listings/{lid}/actions", json={"action": "submit"})
    assert r.status_code == 200, r.text
    r = reviewer.post(f"/admin/listings/{lid}/moderate", json={"action": "approve"})
    assert r.status_code == 200, r.text
    return lid
