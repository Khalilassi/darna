import threading

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.properties import identity_key, normalize_segment
from tests.conftest import approve_pending_claim, property_payload, register_property


@pytest.mark.parametrize("raw,expected", [("b 01", "B1"), (" 0012 ", "12"), ("Gr-3", "GR3"), ("a0b", "A0B"), ("007a", "7A"), ("0", "0")])
def test_normalize_segment(raw, expected):
    assert normalize_segment(raw) == expected


def test_identity_key():
    assert identity_key("B2", "7", "45", None) == "B2|7|45|-"


def test_register_property_creates_claim_and_verification(make_user, project, reviewer):
    owner = make_user()
    r = register_property(owner, project)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["claim"]["status"] == "submitted"
    assert owner.get("/auth/me").json()["verification"]["pending_ownership_claims"] == 1
    q = reviewer.get("/admin/verifications", params={"kind": "ownership"}).json()["items"]
    assert len(q) == 1 and q[0]["claim"]["identity_key"].endswith("|7|45|12")


def test_registering_an_existing_unit_becomes_a_claim_even_with_formatting_differences(make_user, project):
    a, b = make_user(), make_user()
    first = register_property(a, project, unit="12", building="45", group="7")
    assert first.status_code == 201 and first.json()["claimed_existing"] is False
    r = register_property(b, project, unit=" 012", building="0045", group="07")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["claimed_existing"] is True and body["property"]["id"] == first.json()["property"]["id"]
    assert body["claim"]["status"] == "submitted"  # no approved owner yet: reviewers decide between the claims


def test_same_unit_number_in_other_building_is_distinct(make_user, project):
    a = make_user()
    assert register_property(a, project, unit="12", building="45").status_code == 201
    assert register_property(a, project, unit="12", building="46").status_code == 201
    assert register_property(a, project, unit="12", building="45", district_idx=1).status_code == 201


def test_incomplete_identity_rejected(make_user, project):
    a = make_user()
    r = register_property(a, project, unit=None)
    assert r.status_code == 422 and r.json()["error"]["code"] == "incomplete_identity"
    r = register_property(a, project, unit="3", ptype="villa")
    assert r.status_code == 422 and r.json()["error"]["code"] == "unexpected_unit"
    assert register_property(a, project, unit=None, ptype="villa", building="V12").status_code == 201


def test_district_must_belong_to_project(make_user, project, db):
    import uuid
    a = make_user()
    doc = a.upload_doc("ownership_contract")
    payload = property_payload(project)
    payload["district_id"] = str(uuid.uuid4())
    r = a.post("/properties", json={"property": payload, "claim": {"document_ids": [doc]}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_district"


def test_claim_requires_ownership_document(make_user, project):
    a = make_user()
    doc = a.upload_doc("national_id")
    r = a.post("/properties", json={"property": property_payload(project), "claim": {"document_ids": [doc]}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "ownership_document_required"


def test_cannot_use_someone_elses_document(make_user, project):
    a, b = make_user(), make_user()
    doc = b.upload_doc("ownership_contract")
    r = a.post("/properties", json={"property": property_payload(project), "claim": {"document_ids": [doc]}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_document_reference"


def test_representative_requires_poa_and_scope(make_user, project):
    a = make_user()
    doc = a.upload_doc("ownership_contract")
    payload = {"property": property_payload(project), "claim": {"capacity": "legal_representative", "document_ids": [doc],
                                                                "principal_name": "Owner Name", "authority_scope": ["list"]}}
    r = a.post("/properties", json=payload)
    assert r.status_code == 422 and r.json()["error"]["code"] == "power_of_attorney_required"
    poa = a.upload_doc("power_of_attorney")
    payload["claim"]["document_ids"] = [doc, poa]
    payload["claim"]["authority_scope"] = ["list", "fly"]
    assert a.post("/properties", json=payload).status_code == 422
    payload["claim"]["authority_scope"] = ["list"]
    assert a.post("/properties", json=payload).status_code == 201


def test_concurrent_registration_of_same_unit_creates_one_property(make_user, project, db):
    owners = [make_user() for _ in range(6)]
    docs = [o.upload_doc("ownership_contract") for o in owners]
    barrier = threading.Barrier(len(owners))
    results = []

    def go(owner, doc):
        c = TestClient(app)
        barrier.wait()
        r = c.post("/properties", headers=owner.h, json={"property": property_payload(project), "claim": {"document_ids": [doc]}})
        results.append((r.status_code, r.json().get("claimed_existing")))

    threads = [threading.Thread(target=go, args=(o, d)) for o, d in zip(owners, docs, strict=True)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    # One registration wins; the others become claims on the same property.
    assert sorted(results) == [(201, False)] + [(201, True)] * 5
    from sqlalchemy import func, select

    from app.models.entities import OwnershipClaim, Property
    assert db.scalar(select(func.count()).select_from(Property)) == 1
    assert db.scalar(select(func.count()).select_from(OwnershipClaim)) == 6


def test_competing_claim_opens_dispute_and_resolution(make_user, project, reviewer, admin):
    owner, challenger = make_user(verified=True), make_user()
    r = register_property(owner, project)
    pid, claim_id = r.json()["property"]["id"], r.json()["claim"]["id"]
    approve_pending_claim(reviewer, claim_id)

    doc = challenger.upload_doc("ownership_contract")
    r = challenger.post(f"/properties/{pid}/claims", json={"document_ids": [doc], "note": "I bought this unit"})
    assert r.status_code == 201 and r.json()["status"] == "disputed"
    # Duplicate active claim by the same user is blocked
    assert challenger.post(f"/properties/{pid}/claims", json={"document_ids": [doc]}).status_code == 409
    # Reviewer cannot simply approve a disputed claim
    q = reviewer.get("/admin/verifications", params={"kind": "ownership"}).json()["items"]
    vr = next(v for v in q if v["claim_id"] == r.json()["id"])
    res = reviewer.post(f"/admin/verifications/{vr['id']}/decision", json={"decision": "approve", "note": "x"})
    assert res.status_code == 409 and res.json()["error"]["code"] == "dispute_open"

    disputes = admin.get("/admin/disputes").json()
    assert len(disputes) == 1 and disputes[0]["existing"]["user_id"] == str(owner.id)
    assert any(n["type"] == "ownership_dispute_opened" for n in owner.get("/notifications").json()["items"])
    res = admin.post(f"/admin/disputes/{disputes[0]['id']}/resolve", json={"outcome": "resolved_for_challenger", "note": "Registry evidence"})
    assert res.status_code == 200
    mine = challenger.get("/properties/mine").json()
    assert mine[0]["claim"]["status"] == "approved"
    assert owner.get("/properties/mine").json() == []  # revoked claims are no longer listed


def test_withdraw_claim_dismisses_dispute(make_user, project, reviewer, admin):
    owner, challenger = make_user(), make_user()
    r = register_property(owner, project)
    approve_pending_claim(reviewer, r.json()["claim"]["id"])
    doc = challenger.upload_doc("ownership_contract")
    c = challenger.post(f"/properties/{r.json()['property']['id']}/claims", json={"document_ids": [doc]}).json()
    assert challenger.post(f"/properties/claims/{c['id']}/withdraw").json()["status"] == "withdrawn"
    assert admin.get("/admin/disputes").json() == []


def test_no_free_unit_existence_lookup_and_claims_are_rate_limited(make_user, project, reviewer, monkeypatch):
    """Public listings show group/floor/type; a free existence oracle would reveal building and unit numbers."""
    from app.core import rate_limit
    from app.core.config import get_settings
    owner, prober = make_user(), make_user()
    body = {k: v for k, v in property_payload(project).items() if k in ("project_id", "district_id", "group_code", "building_code", "unit_code", "property_type")}
    assert prober.post("/properties/identity-check", json=body).status_code in (404, 405)
    r = register_property(owner, project)
    approve_pending_claim(reviewer, r.json()["claim"]["id"])
    pid = r.json()["property"]["id"]
    # Each probe of an owned unit is a reviewable claim that opens a dispute; claim/withdraw loops are capped.
    monkeypatch.setattr(get_settings(), "rate_limit_enabled", True)
    rate_limit.reset()
    codes = []
    for _ in range(4):
        doc = prober.upload_doc("ownership_contract")
        c = prober.post(f"/properties/{pid}/claims", json={"document_ids": [doc]})
        codes.append(c.status_code)
        if c.status_code == 201:
            assert c.json()["status"] == "disputed"
            prober.post(f"/properties/claims/{c.json()['id']}/withdraw")
    rate_limit.reset()
    assert codes == [201, 201, 201, 429]